import type {
  ComplianceReport,
  TextFix,
  DocKind,
  Finding,
  ObjectCategory,
  ObjectNature,
  PriceResearch,
  ProcessFeatures,
  SectionCoverage,
} from '../domain/types.js';
import { bestClause, findClauses } from './clauses.js';
import { requirementsFor } from './requirements.js';
import { anyMatch, excerptAt, normalize, paragraphs } from './text.js';

export interface AnalysisContext {
  category: ObjectCategory;
  nature: ObjectNature;
  estimatedCents: number | null;
  features: ProcessFeatures;
  prices?: PriceResearch;
}

/** Limite para participação exclusiva de ME/EPP por item (LC 123/2006, art. 48, I). */
export const MEEPP_EXCLUSIVE_LIMIT_CENTS = 80_000_00;

const VAGUE_TERMS: { re: RegExp; label: string }[] = [
  { re: /\bde (boa|otima|primeira) qualidade\b/, label: '"de boa qualidade"' },
  { re: /\bde primeira linha\b/, label: '"de primeira linha"' },
  { re: /\baproximadamente\b/, label: '"aproximadamente"' },
  { re: /\bentre outros\b|\betc\.?(\s|$)/, label: '"entre outros"/"etc."' },
  { re: /\bquando necessario\b|\bsempre que necessario\b/, label: '"quando necessário"' },
  { re: /\ba criterio da (administracao|contratante)\b/, label: '"a critério da Administração"' },
  { re: /\bsimilar(es)? aos? atuais\b/, label: '"similar ao atual"' },
];

const PAYMENT_VAGUE = [
  /\boportunamente\b/,
  /\bem tempo habil\b/,
  /\bconforme (a )?disponibilidade (financeira|de recursos)\b/,
  /\bapos (a )?(aprovacao|liberacao) (dos recursos|financeira)\b/,
  /\bquando (houver|da) disponibilidade\b/,
  /\ba criterio da (administracao|contratante)\b/,
];

const DAYS = /\b\d+\s*(\([^)]*\)\s*)?dias?\b/;

const JUSTIFY = /\b(porque|pois|uma vez que|em razao|tendo em vista|justifica|economia de escala|competitividade|inviavel|prejuizo|visto que|dado que)\b/;

interface Hit {
  excerpt: string;
  at: Anchor;
}

/** Posição no texto que motivou um apontamento; usada para montar a correção. */
interface Anchor {
  index: number;
  length: number;
}

function find(original: string, norm: string, re: RegExp): Hit | null {
  const m = re.exec(norm);
  if (!m || m.index === undefined) return null;
  return { excerpt: excerptAt(original, m.index, m[0].length), at: { index: m.index, length: m[0].length } };
}

/**
 * Cruza o rascunho com os elementos exigidos pela Lei 14.133/2021 e com
 * verificações de qualidade que costumam motivar impugnações e apontamentos
 * dos tribunais de contas. É determinístico e explicável: cada apontamento
 * traz o dispositivo legal e, quando possível, o trecho que o motivou.
 */
export function analyzeDocument(kind: DocKind, text: string, ctx: AnalysisContext, now = new Date()): ComplianceReport {
  const norm = normalize(text);
  const findings: Finding[] = [];
  const anchors = new Map<string, Anchor>();
  const push = (f: Finding, at?: Anchor) => {
    findings.push(f);
    if (at) anchors.set(f.id, at);
  };

  // 1. Cobertura dos elementos legais
  const sections: SectionCoverage[] = requirementsFor(kind).map((r) => ({
    key: r.key,
    label: r.label,
    basis: r.basis,
    mandatory: r.mandatory,
    present: anyMatch(norm, r.patterns) !== null,
  }));

  const hasWaiver = /\bnao se aplica\b|\bdispensad[oa] (a|o) (apresentacao|elemento)\b/.test(norm);
  for (const s of sections.filter((x) => !x.present)) {
    const req = requirementsFor(kind).find((r) => r.key === s.key)!;
    const clause = bestClause(ctx.category, kind, s.key);
    if (s.mandatory) {
      push({
        id: `falta-${s.key}`,
        severity: 'bloqueante',
        basis: s.basis,
        message: `Falta ${lower(s.label)}.`,
        suggestion: clause?.text ?? req.hint,
      });
    } else if (!hasWaiver) {
      push({
        id: `falta-${s.key}`,
        severity: 'alerta',
        basis: `${s.basis}; art. 18, §2º`,
        message: `Elemento ausente sem justificativa: ${lower(s.label)}. Inclua o conteúdo ou justifique por que não se aplica.`,
        suggestion: clause?.text ?? req.hint,
      });
    }
  }

  // 2. Parcelamento mencionado mas não justificado
  if (sections.some((s) => s.key === 'parcelamento' && s.present)) {
    const paras = paragraphs(text).filter((p) => /parcel|lote unico|por item|por lote/.test(normalize(p.text)));
    if (paras.length && !paras.some((p) => JUSTIFY.test(normalize(p.text)))) {
      push({
        id: 'parcelamento-sem-justificativa',
        severity: 'alerta',
        basis: 'Art. 18, §1º, VIII; art. 40, §§2º e 3º',
        message: 'O parcelamento é mencionado, mas sem justificativa técnica ou econômica da opção adotada.',
        excerpt: excerptAt(text, paras[0].index, paras[0].text.length > 200 ? 200 : paras[0].text.length),
        suggestion: parcelamentoClause(normalize(paras.map((p) => p.text).join(' '))),
      }, { index: paras[0].index, length: paras[0].text.length });
    }
  }

  // 3. Medição e pagamento ambíguos (TR)
  if (kind === 'tr') {
    const payParas = paragraphs(text).filter((p) => /pagamento|medicao/.test(normalize(p.text)));
    const vague = payParas
      .map((p) => ({ p, m: PAYMENT_VAGUE.map((re) => re.exec(normalize(p.text))).find(Boolean) }))
      .find((x) => x.m);
    if (vague?.m) {
      push({
        id: 'pagamento-ambiguo',
        severity: 'bloqueante',
        basis: 'Art. 6º, XXIII, "g"; art. 92, V e VI; art. 141',
        message:
          'O critério de medição e pagamento está ambíguo: condiciona o pagamento a evento indeterminado. Defina a unidade de medição e o prazo em dias.',
        excerpt: excerptAt(text, vague.p.index + (vague.m.index ?? 0), vague.m[0].length),
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      }, { index: vague.p.index + (vague.m.index ?? 0), length: vague.m[0].length });
    } else if (payParas.length && !payParas.some((p) => DAYS.test(normalize(p.text)))) {
      push({
        id: 'pagamento-sem-prazo',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "g"; art. 92, V',
        message: 'O TR trata de pagamento, mas não fixa o prazo em dias contado do recebimento/atesto.',
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      }, { index: payParas[0].index, length: payParas[0].text.length });
    }
    if (payParas.length && !/\b(medicao|imr|instrumento de medicao|unidade de medida|aferi)/.test(norm)) {
      push({
        id: 'medicao-ausente',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "g"',
        message: 'Não há critério objetivo de medição (unidade de medida, IMR ou forma de aferição do que foi entregue).',
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      }, { index: payParas[0].index, length: payParas[0].text.length });
    }
  }

  // 4. Legislação revogada
  const revoked = find(text, norm, /\blei (n[oº.]*\s*)?(8\.?666|10\.?520|12\.?462)(\/(19|20)?\d{2})?\b/);
  if (revoked) {
    push({
      id: 'lei-revogada',
      severity: 'bloqueante',
      basis: 'Art. 193, II, da Lei 14.133/2021',
      message: 'O texto fundamenta-se em lei revogada (Lei 8.666/93, 10.520/02 ou RDC). Atualize as referências para a Lei 14.133/2021.',
      excerpt: revoked.excerpt,
      suggestion: 'Lei nº 14.133/2021',
    }, revoked.at);
  }

  // 5. Indicação de marca sem "ou equivalente"
  const brand = find(text, norm, /\bmarca\b(?![^\n]{0,400}(equivalente|similar|melhor qualidade|referencia))/);
  if (brand && !/\bpadronizacao\b/.test(norm)) {
    push({
      id: 'marca',
      severity: 'alerta',
      basis: 'Art. 41, I',
      message:
        'Há indicação de marca sem a expressão "ou equivalente/similar" e sem justificativa de padronização — risco de direcionamento.',
      excerpt: brand.excerpt,
      suggestion: bestClause('expediente', 'tr', 'requisitos')?.text,
    }, brand.at);
  }

  // 6. Cláusulas restritivas à competição
  const origin = find(text, norm, /\b(sediad[ao]s?|domiciliad[ao]s?|estabelecid[ao]s?) (no|neste|em|na) (municipio|estado|cidade)/);
  if (origin) {
    push({
      id: 'restricao-sede',
      severity: 'bloqueante',
      basis: 'Art. 9º, I, "b"',
      message: 'Exigência de sede ou domicílio do licitante na localidade é vedada: restringe o caráter competitivo.',
      excerpt: origin.excerpt,
      suggestion:
        'A contratada deverá cumprir os prazos de entrega e atendimento fixados neste instrumento, independentemente da localização de sua sede.',
    }, origin.at);
  }
  const visit = find(text, norm, /\bvisita tecnica (e |sera )?obrigatoria/);
  if (visit) {
    push({
      id: 'visita-obrigatoria',
      severity: 'alerta',
      basis: 'Art. 63, §§2º e 3º',
      message: 'A vistoria obrigatória deve admitir substituição por declaração de conhecimento pleno das condições do local.',
      excerpt: visit.excerpt,
      suggestion:
        'A vistoria é facultativa; o licitante que não a realizar deverá apresentar declaração de que conhece as condições e peculiaridades do objeto.',
    }, visit.at);
  }

  // 7. Quantidades sem memória de cálculo (ETP)
  if (kind === 'etp' && sections.find((s) => s.key === 'quantidades')?.present) {
    if (!/\b(memoria de calculo|serie historica|consumo medio|per capita|historico de consumo)\b/.test(norm)) {
      push({
        id: 'quantidades-sem-memoria',
        severity: 'alerta',
        basis: 'Art. 18, §1º, IV',
        message: 'As quantidades não estão acompanhadas de memória de cálculo (série histórica, consumo médio, per capita).',
        suggestion: bestClause(ctx.category, 'etp', 'quantidades')?.text,
      }, anchorOf(norm, 'quantidades', kind));
    }
  }

  // 8. Pesquisa de preços com menos de 3 fontes
  if (ctx.prices?.items.length) {
    const thin = ctx.prices.items.filter((i) => i.samples.length < 3);
    if (thin.length) {
      push({
        id: 'precos-insuficientes',
        severity: 'alerta',
        basis: 'Art. 23, §1º; IN SEGES/ME 65/2021, art. 6º',
        message: `${thin.length} item(ns) da pesquisa de preços têm menos de 3 preços válidos: ${thin
          .slice(0, 3)
          .map((i) => i.description)
          .join('; ')}. Amplie a pesquisa ou justifique.`,
      });
    }
  } else if (kind === 'etp') {
    push({
      id: 'precos-ausentes',
      severity: 'sugestao',
      basis: 'Art. 23',
      message: 'Nenhuma pesquisa de preços registrada no processo. Use a pesquisa automática para gerar o relatório do valor estimado.',
    });
  }

  // 9. ME/EPP
  if (
    ctx.estimatedCents !== null &&
    ctx.estimatedCents <= MEEPP_EXCLUSIVE_LIMIT_CENTS &&
    !/\b(microempresas?|empresas? de pequeno porte|me\/epp|lc 123|complementar (n[oº.]*\s*)?123)\b/.test(norm)
  ) {
    push({
      id: 'me-epp',
      severity: 'alerta',
      basis: 'LC 123/2006, art. 48, I; art. 4º da Lei 14.133/2021',
      message: 'Valor estimado até R$ 80.000,00: a participação deve ser exclusiva para ME/EPP, salvo justificativa (art. 49 da LC 123).',
      suggestion: 'A participação neste certame é exclusiva para microempresas e empresas de pequeno porte, nos termos do art. 48, I, da LC nº 123/2006.',
    });
  }

  // 10. Garantia e reajuste (TR)
  if (kind === 'tr') {
    if (ctx.nature === 'compra' && !/\bgarantia\b/.test(norm)) {
      push({
        id: 'garantia-produto',
        severity: 'alerta',
        basis: 'Art. 40, §1º, III',
        message: 'O TR de compra deve indicar a garantia exigida e as condições de manutenção e assistência técnica, quando for o caso.',
        suggestion:
          'Os bens deverão ter garantia mínima de [informar] meses contra defeitos de fabricação, contados do recebimento definitivo, cabendo à contratada a substituição do item defeituoso em até [informar] dias.',
      });
    }
    if (!/\breajust/.test(norm)) {
      push({
        id: 'reajuste',
        severity: 'alerta',
        basis: 'Art. 25, §7º; art. 92, V',
        message: 'Não há índice de reajuste. O edital deve prevê-lo obrigatoriamente, independentemente do prazo do contrato.',
        suggestion: bestClause(ctx.category, 'tr', 'reajuste')?.text,
      });
    }
  }

  // 11. Regras por tipo de objeto
  categoryChecks(kind, norm, ctx).forEach((f) => push(f));

  // 12. Termos vagos
  const vagueHits = VAGUE_TERMS.map((v) => ({ v, hit: find(text, norm, v.re) })).filter((x) => x.hit);
  if (vagueHits.length) {
    push({
      id: 'termos-vagos',
      severity: 'sugestao',
      basis: 'Art. 6º, XXIII, "a" e "d"; Súmula TCU 177',
      message: `Termos subjetivos dificultam o julgamento objetivo: ${vagueHits.map((x) => x.v.label).join(', ')}. Substitua por critérios mensuráveis.`,
      excerpt: vagueHits[0].hit!.excerpt,
    });
  }

  // Pontuação: cobertura ponderada menos penalidades por severidade
  const weight = (s: SectionCoverage) => (s.mandatory ? 2 : 1);
  const coverage = sections.reduce((a, s) => a + (s.present ? weight(s) : 0), 0) / sections.reduce((a, s) => a + weight(s), 0);
  const penalty = findings.reduce((a, f) => a + (f.severity === 'bloqueante' ? 8 : f.severity === 'alerta' ? 3 : 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(coverage * 100 - penalty / 2)));

  attachFixes(kind, text, norm, findings, anchors);

  const order = { bloqueante: 0, alerta: 1, sugestao: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    kind,
    score,
    approvable: !findings.some((f) => f.severity === 'bloqueante'),
    sections,
    findings,
    analyzedAt: now.toISOString(),
  };
}

function categoryChecks(kind: DocKind, norm: string, ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  const clause = (section: string, doc: DocKind = kind) => bestClause(ctx.category, doc, section)?.text;

  if (ctx.category === 'merenda') {
    if (kind === 'etp' && !/agricultura familiar/.test(norm)) {
      out.push({
        id: 'pnae-agricultura-familiar',
        severity: 'alerta',
        basis: 'Lei 11.947/2009, art. 14',
        message: 'O ETP de alimentação escolar não trata da parcela mínima destinada à agricultura familiar (chamada pública correlata).',
        suggestion: bestClause('merenda', 'etp', 'correlatas')?.text,
      });
    }
    if (!/\b(nutricionista|cardapio)\b/.test(norm)) {
      out.push({
        id: 'pnae-nutricionista',
        severity: 'sugestao',
        basis: 'Resolução CD/FNDE nº 06/2020',
        message: 'Vincule as especificações e quantidades aos cardápios elaborados pela nutricionista responsável técnica.',
      });
    }
  }
  if ((ctx.category === 'merenda' || ctx.category === 'medicamentos' || ctx.features.perishable) && kind === 'tr') {
    if (!/\bvalidade\b/.test(norm)) {
      out.push({
        id: 'validade',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "d"',
        message: 'Para bens perecíveis, o TR deve fixar o prazo de validade mínimo no ato da entrega.',
        suggestion: clause('requisitos', 'tr'),
      });
    }
  }
  if ((ctx.category === 'limpeza' || ctx.features.dedicatedLabor) && kind === 'tr') {
    if (!/\b(conta[- ](deposito )?vinculada|fato gerador)\b/.test(norm)) {
      out.push({
        id: 'mao-de-obra-garantias',
        severity: 'alerta',
        basis: 'Art. 121, §3º',
        message:
          'Serviço com dedicação exclusiva de mão de obra sem mecanismo de proteção trabalhista (conta vinculada ou pagamento pelo fato gerador): risco de responsabilização subsidiária.',
        suggestion: bestClause('limpeza', 'tr', 'medicao')?.text,
      });
    }
  }
  if (ctx.category === 'ti' && kind === 'tr' && !/\b(lgpd|13\.?709|dados pessoais)\b/.test(norm)) {
    out.push({
      id: 'lgpd',
      severity: 'sugestao',
      basis: 'Lei 13.709/2018',
      message: 'Inclua obrigações de proteção de dados pessoais e comunicação de incidentes.',
      suggestion: bestClause('ti', 'tr', 'requisitos')?.text,
    });
  }
  if (ctx.category === 'engenharia' && kind === 'tr' && !/\b(art|rrt|responsavel tecnico)\b/.test(norm)) {
    out.push({
      id: 'engenharia-rt',
      severity: 'alerta',
      basis: 'Art. 67',
      message: 'Serviço de engenharia sem exigência de responsável técnico e ART/RRT.',
      suggestion: bestClause('engenharia', 'tr', 'requisitos')?.text,
    });
  }
  return out;
}

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function parcelamentoClause(norm: string): string | undefined {
  const notSplit = /\bnao\b[^.\n]{0,40}parcel|lote unico|\bsem parcelamento\b/.test(norm);
  return findClauses({ section: 'parcelamento', doc: 'etp' }).find((c) => c.id === (notSplit ? 'g-parcelamento-nao' : 'g-parcelamento-sim'))?.text;
}

// ---------- correções aplicáveis ao texto ----------

/** Seções que não fazem parte do roteiro legal, mas são inseridas como bloco próprio. */
const EXTRA_SECTIONS: Record<string, string> = {
  'me-epp': 'PARTICIPAÇÃO EXCLUSIVA DE ME/EPP',
  reajuste: 'REAJUSTE',
  'garantia-produto': 'GARANTIA DOS BENS',
  validade: 'PRAZO DE VALIDADE',
  'mao-de-obra-garantias': 'GARANTIAS TRABALHISTAS',
  'pnae-agricultura-familiar': 'AGRICULTURA FAMILIAR',
  lgpd: 'PROTEÇÃO DE DADOS PESSOAIS',
  'engenharia-rt': 'RESPONSABILIDADE TÉCNICA',
};

/** Trechos em que a sugestão substitui a frase inteira. */
const REPLACE_SENTENCE = new Set(['pagamento-ambiguo', 'restricao-sede', 'visita-obrigatoria']);

function anchorOf(norm: string, key: string, kind: DocKind): Anchor | undefined {
  const req = requirementsFor(kind).find((r) => r.key === key);
  const m = req && anyMatch(norm, req.patterns);
  return m && m.index !== undefined ? { index: m.index, length: m[0].length } : undefined;
}

const lineStart = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1;

/** Fim do bloco (linha em branco seguinte); sem linhas em branco no texto, fim da linha. */
function blockEnd(text: string, at: Anchor): number {
  const from = at.index + at.length;
  const blank = text.indexOf('\n\n', at.index);
  if (blank >= 0 && blank >= from - 1) return blank;
  const line = text.indexOf('\n', from);
  return blank >= 0 ? Math.max(blank, line) : line >= 0 ? line : text.trimEnd().length;
}

/** Frase que contém a posição: delimitada por quebra de linha ou por ponto/ponto e vírgula seguido de espaço. */
export function sentenceAt(text: string, i: number): { start: number; end: number } {
  let s = i;
  while (s > 0) {
    const c = text[s - 1];
    if (c === '\n' || ((c === '.' || c === ';' || c === ':') && /\s/.test(text[s] ?? ' '))) break;
    s -= 1;
  }
  while (s < i && /[ \t]/.test(text[s])) s += 1;
  let e = i;
  while (e < text.length) {
    const c = text[e];
    if (c === '\n') break;
    e += 1;
    if ((c === '.' || c === ';') && (e >= text.length || /\s/.test(text[e]))) break;
  }
  return { start: s, end: e };
}

const isHeadingLine = (line: string) => {
  const t = line.trim();
  return t.length > 0 && t.length <= 80 && !/[.;:,]$/.test(t);
};

/**
 * Início do bloco que contém a posição. Se a linha for corpo de texto e houver
 * um título logo acima (só com linhas em branco no meio), recua até o título,
 * para que a seção nova não caia entre um título e o seu texto.
 */
function sectionStart(text: string, i: number): number {
  const start = lineStart(text, i);
  const line = text.slice(start, text.indexOf('\n', start) < 0 ? undefined : text.indexOf('\n', start));
  if (isHeadingLine(line)) return start;
  let prevEnd = start - 1;
  while (prevEnd > 0 && text[prevEnd - 1] === '\n') prevEnd -= 1;
  if (prevEnd <= 0) return start;
  const prevStart = lineStart(text, prevEnd);
  return isHeadingLine(text.slice(prevStart, prevEnd)) ? prevStart : start;
}

function sectionFix(text: string, title: string, body: string, beforeIndex: number | undefined): TextFix {
  if (beforeIndex !== undefined) {
    const at = sectionStart(text, beforeIndex);
    return { start: at, end: at, text: `${title}\n\n${body}\n\n`, label: 'Inserir seção' };
  }
  const end = text.trimEnd().length;
  return { start: end, end, text: `${end ? '\n\n' : ''}${title}\n\n${body}`, label: 'Inserir seção' };
}

/** Posição da primeira seção presente que vem depois de `key` no roteiro legal: a nova seção entra antes dela. */
function nextPresent(norm: string, kind: DocKind, key: string): number | undefined {
  const reqs = requirementsFor(kind);
  for (const r of reqs.slice(reqs.findIndex((x) => x.key === key) + 1)) {
    const m = anyMatch(norm, r.patterns);
    if (m?.index !== undefined) return m.index;
  }
  return undefined;
}

function attachFixes(kind: DocKind, text: string, norm: string, findings: Finding[], anchors: Map<string, Anchor>) {
  const reqs = requirementsFor(kind);
  const conclusion = kind === 'etp' ? anchorOf(norm, 'conclusao', kind)?.index : undefined;
  for (const f of findings) {
    if (!f.suggestion) continue;
    const req = f.id.startsWith('falta-') ? reqs.find((r) => `falta-${r.key}` === f.id) : undefined;
    if (req) {
      // Sem cláusula modelo, a orientação entra marcada para ser completada.
      const body = f.suggestion === req.hint ? `[COMPLETAR: ${req.hint}]` : f.suggestion;
      f.fix = sectionFix(text, req.label.split(' (')[0].toUpperCase(), body, nextPresent(norm, kind, req.key));
      continue;
    }
    if (EXTRA_SECTIONS[f.id]) {
      f.fix = sectionFix(text, EXTRA_SECTIONS[f.id], f.suggestion, conclusion);
      continue;
    }
    const at = anchors.get(f.id);
    if (!at) continue;
    if (f.id === 'lei-revogada') {
      f.fix = { start: at.index, end: at.index + at.length, text: f.suggestion, label: 'Trocar pela Lei 14.133/2021' };
    } else if (REPLACE_SENTENCE.has(f.id)) {
      const r = sentenceAt(text, at.index);
      f.fix = { start: r.start, end: r.end, text: f.suggestion, label: 'Substituir o trecho' };
    } else if (f.id === 'marca') {
      const r = sentenceAt(text, at.index);
      f.fix = { start: r.end, end: r.end, text: ` ${f.suggestion}`, label: 'Inserir após o trecho' };
    } else {
      const end = blockEnd(text, at);
      f.fix = { start: end, end, text: `\n\n${f.suggestion}`, label: 'Inserir após o parágrafo' };
    }
  }
}

/** Aplica uma correção ao texto. */
export function applyFix(text: string, fix: TextFix): string {
  return text.slice(0, fix.start) + fix.text + text.slice(fix.end);
}
