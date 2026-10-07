// Analista jurídica com IA: o Claude lê o documento inteiro (com as linhas
// numeradas), emite uma análise no papel da assessoria jurídica e propõe cada
// correção com o lugar exato onde ela entra. As propostas são aplicadas aqui,
// localizando a linha de referência pelo conteúdo, então continuam válidas
// depois de outras edições no texto.
import type { ComplianceReport, DocKind, Severity } from '../../server/src/domain/types';
import { requirementsFor } from '../../server/src/legal/requirements';

export type ProposalAction = 'substituir_trecho' | 'substituir_linha' | 'inserir_depois' | 'inserir_antes';

export interface Proposal {
  id: string;
  gravidade: Severity;
  titulo: string;
  fundamento: string;
  analise: string;
  /** Id do apontamento automático que a proposta resolve, quando houver. */
  relacionado: string | null;
  acao: ProposalAction;
  linha: number;
  trecho: string | null;
  texto: string;
}

export interface AnalystResult {
  conclusao: 'apto' | 'apto_com_ressalvas' | 'nao_apto';
  resumo: string;
  pontos_fortes: string[];
  propostas: Proposal[];
  falsos_positivos: { id: string; motivo: string }[];
}

export interface Line {
  n: number;
  text: string;
  start: number;
  end: number;
}

/** Linhas com conteúdo, numeradas a partir de 1, com as posições no texto. */
export function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    const end = start + raw.length;
    if (raw.trim()) out.push({ n: out.length + 1, text: raw, start, end });
    start = end + 1;
  }
  return out;
}

const MAX_CHARS = 120_000;

export function buildPrompt(opts: {
  kind: DocKind;
  text: string;
  category: string;
  nature: string;
  estimated: string;
  features: string[];
  report: ComplianceReport;
}): { prompt: string; lines: string[]; truncated: boolean } {
  const all = linesOf(opts.text);
  let size = 0;
  const lines: Line[] = [];
  for (const l of all) {
    size += l.text.length + 8;
    if (size > MAX_CHARS) break;
    lines.push(l);
  }
  const doc = opts.kind === 'etp' ? 'Estudo Técnico Preliminar (ETP)' : 'Termo de Referência (TR)';
  const basis = opts.kind === 'etp' ? 'art. 18, §1º e §2º, da Lei 14.133/2021' : 'art. 6º, XXIII, e art. 40, §1º, da Lei 14.133/2021';
  const reqs = requirementsFor(opts.kind)
    .map((r) => `- [${r.key}] ${r.label} (${r.basis})${r.mandatory ? ' — OBRIGATÓRIO' : ''}`)
    .join('\n');
  const auto = opts.report.findings.length
    ? opts.report.findings.map((f) => `- id "${f.id}" [${f.severity}] ${f.message} (${f.basis})${f.suggestion ? `\n  Texto-base disponível: ${f.suggestion}` : ''}`).join('\n')
    : '- nenhum';

  const prompt = `Você é analista jurídica da procuradoria de um órgão público brasileiro e prepara a análise prévia ao parecer jurídico do art. 53 da Lei nº 14.133/2021. Revise o ${doc} abaixo para que fique adequado à lei e resistente a impugnações e a apontamentos do tribunal de contas.

CONTEXTO DA CONTRATAÇÃO
- Categoria do objeto: ${opts.category}
- Natureza: ${opts.nature}
- Valor estimado informado: ${opts.estimated || 'não informado'}
- Características: ${opts.features.join(', ') || 'nenhuma informada'}

ELEMENTOS EXIGIDOS (${basis})
${reqs}

APONTAMENTOS DA VERIFICAÇÃO AUTOMÁTICA (por palavras-chave; pode ter falsos positivos e não enxerga problemas de mérito)
${auto}

O QUE FAZER
1. Leia o documento inteiro. Confira cada elemento exigido pelo CONTEÚDO, não pelo título: um elemento pode estar presente com outro nome, ou ter título sem conteúdo suficiente.
2. Avalie o mérito também: justificativas genéricas, quantidades sem lastro, critérios subjetivos, cláusulas restritivas à competição, incoerências entre seções, obrigações sem prazo, riscos de direcionamento, legislação revogada (Lei 8.666/93, Lei 10.520/02, RDC).
3. Para cada problema relevante, redija a correção pronta para entrar no documento:
   - adapte o texto ao documento: use o objeto, os termos e o padrão de títulos dele;
   - não invente números, quantidades, valores, prazos, datas, marcas, dotações ou nomes; onde faltar dado, use colchetes, como [informar prazo em dias];
   - não renumere as seções existentes; seção nova entre seções numeradas recebe numeração que não conflite (por exemplo, 4.1);
   - em texto com título e corpo, separe o título do corpo com uma linha em branco (\\n\\n).
4. Diga exatamente onde a correção entra, usando o número da linha [Ln] do documento:
   - "substituir_trecho": troca um trecho literal da linha; "trecho" deve ser copiado EXATAMENTE como aparece nela;
   - "substituir_linha": troca a linha inteira;
   - "inserir_depois": insere depois da linha; para acrescentar uma seção depois da seção X, use a ÚLTIMA linha da seção X;
   - "inserir_antes": insere antes da linha; para criar uma seção antes da seção Y, use a linha do título de Y.
   A seção nova deve ficar na posição lógica do roteiro legal, nunca no fim do documento só por falta de lugar.
5. Para cada apontamento automático que você resolver, informe o id dele em "relacionado". Os que estiverem atendidos no texto vão em "falsos_positivos", com o motivo.
6. Cite dispositivos legais precisos. Não cite número de acórdão ou de súmula se não tiver certeza.
7. Priorize: no máximo 15 propostas, as mais graves primeiro. Não proponha mudanças só de estilo.

RESPONDA SOMENTE COM UM OBJETO JSON neste formato:
{
  "conclusao": "apto" | "apto_com_ressalvas" | "nao_apto",
  "resumo": "análise em 3 a 6 frases: situação geral, riscos principais e o que precisa mudar antes do parecer",
  "pontos_fortes": ["o que o documento já faz bem", "..."],
  "propostas": [
    {
      "id": "p1",
      "gravidade": "bloqueante" | "alerta" | "sugestao",
      "titulo": "frase curta com o problema",
      "fundamento": "Art. 18, §1º, VIII, da Lei 14.133/2021",
      "analise": "por que é um problema e qual o risco concreto para o processo (2 a 4 frases)",
      "relacionado": "id do apontamento automático resolvido, ou null",
      "acao": "substituir_trecho" | "substituir_linha" | "inserir_depois" | "inserir_antes",
      "linha": 12,
      "trecho": "trecho literal da linha (só em substituir_trecho; senão null)",
      "texto": "texto proposto, pronto para entrar no documento"
    }
  ],
  "falsos_positivos": [{ "id": "id do apontamento automático", "motivo": "onde e como o documento já atende" }]
}

DOCUMENTO (cada linha com conteúdo numerada como [Ln]):
${lines.map((l) => `[L${l.n}] ${l.text}`).join('\n')}${lines.length < all.length ? `\n[… documento cortado: ${all.length - lines.length} linhas finais não enviadas por tamanho]` : ''}`;

  return { prompt, lines: lines.map((l) => l.text), truncated: lines.length < all.length };
}

const SEVERITIES: Severity[] = ['bloqueante', 'alerta', 'sugestao'];
const ACTIONS: ProposalAction[] = ['substituir_trecho', 'substituir_linha', 'inserir_depois', 'inserir_antes'];
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Confere e normaliza a resposta: descarta propostas sem lugar ou sem texto. */
export function parseResult(raw: unknown, lineCount: number): AnalystResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const conclusao = ['apto', 'apto_com_ressalvas', 'nao_apto'].includes(o.conclusao as string) ? (o.conclusao as AnalystResult['conclusao']) : 'apto_com_ressalvas';
  const propostas = (Array.isArray(o.propostas) ? o.propostas : [])
    .map((p: Record<string, unknown>, i: number): Proposal | null => {
      const acao = ACTIONS.includes(p.acao as ProposalAction) ? (p.acao as ProposalAction) : null;
      const linha = Math.round(Number(p.linha));
      const texto = typeof p.texto === 'string' ? p.texto.replace(/\r\n?/g, '\n').trim() : '';
      if (!acao || !texto || !(linha >= 1 && linha <= lineCount)) return null;
      const trecho = str(p.trecho) || null;
      if (acao === 'substituir_trecho' && !trecho) return null;
      return {
        id: str(p.id) || `p${i + 1}`,
        gravidade: SEVERITIES.includes(p.gravidade as Severity) ? (p.gravidade as Severity) : 'alerta',
        titulo: str(p.titulo) || 'Ajuste proposto',
        fundamento: str(p.fundamento),
        analise: str(p.analise),
        relacionado: str(p.relacionado) && str(p.relacionado) !== 'null' ? str(p.relacionado) : null,
        acao,
        linha,
        trecho,
        texto,
      };
    })
    .filter((p): p is Proposal => p !== null);
  const order = { bloqueante: 0, alerta: 1, sugestao: 2 };
  propostas.sort((a, b) => order[a.gravidade] - order[b.gravidade]);
  return {
    conclusao,
    resumo: str(o.resumo),
    pontos_fortes: (Array.isArray(o.pontos_fortes) ? o.pontos_fortes : []).map(str).filter(Boolean),
    propostas,
    falsos_positivos: (Array.isArray(o.falsos_positivos) ? o.falsos_positivos : [])
      .map((f: Record<string, unknown>) => ({ id: str(f?.id), motivo: str(f?.motivo) }))
      .filter((f: { id: string; motivo: string }) => f.id && f.motivo),
  };
}

export interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Acha no texto atual a linha que era a [Ln] na análise, pelo conteúdo. Linhas
 * repetidas são desempatadas pela ordem em que aparecem.
 */
function locate(current: Line[], snapshot: string[], n: number): Line | undefined {
  const want = snapshot[n - 1];
  if (want === undefined) return undefined;
  let rank = 0;
  for (let i = 0; i < n - 1; i++) if (snapshot[i] === want) rank++;
  const hits = current.filter((l) => l.text === want);
  return hits[Math.min(rank, hits.length - 1)];
}

/** Edição que aplica a proposta ao texto atual, ou null se a linha de referência não existe mais. */
export function editFor(text: string, snapshot: string[], p: Proposal): Edit | null {
  const line = locate(linesOf(text), snapshot, p.linha);
  if (!line) return null;
  switch (p.acao) {
    case 'substituir_trecho': {
      const i = line.text.indexOf(p.trecho!);
      if (i >= 0) return { start: line.start + i, end: line.start + i + p.trecho!.length, text: p.texto };
      // O trecho citado pode atravessar linhas: procura no texto inteiro.
      const j = text.indexOf(p.trecho!);
      return j >= 0 ? { start: j, end: j + p.trecho!.length, text: p.texto } : null;
    }
    case 'substituir_linha':
      return { start: line.start, end: line.end, text: p.texto };
    case 'inserir_depois':
      return { start: line.end, end: line.end, text: `\n\n${p.texto}` };
    case 'inserir_antes':
      return { start: line.start, end: line.start, text: `${p.texto}\n\n` };
  }
}

/**
 * Aplica várias propostas de uma vez, calculando todas sobre o mesmo texto e
 * aplicando de trás para frente. Propostas que se sobrepõem a outra já
 * aplicada ficam de fora.
 */
export function applyMany(text: string, snapshot: string[], proposals: Proposal[]): { text: string; applied: string[]; skipped: string[] } {
  const edits = proposals.map((p) => ({ p, e: editFor(text, snapshot, p) }));
  const skipped = edits.filter((x) => !x.e).map((x) => x.p.id);
  const valid = edits.filter((x): x is { p: Proposal; e: Edit } => !!x.e).sort((a, b) => b.e.start - a.e.start || b.e.end - a.e.end);
  let out = text;
  let floor = Infinity; // início da última edição aplicada (nada pode passar dele)
  const applied: string[] = [];
  for (const { p, e } of valid) {
    if (e.end > floor) {
      skipped.push(p.id);
      continue;
    }
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
    applied.push(p.id);
  }
  return { text: out, applied, skipped };
}
