import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ComplianceReport, DocKind, Finding, ObjectCategory, ObjectNature, Severity } from '../../server/src/domain/types';
import { CATEGORY_LABELS } from '../../server/src/legal/clauses';
import { analyzeDocument, applyFix, type AnalysisContext } from '../../server/src/legal/compliance';
import { DRAFT_ETP_MERENDA, DRAFT_TR_MERENDA } from '../../server/src/seed';
import { applyMany, buildPrompt, editFor, parseResult, type AnalystResult } from './analyst';
import { AnalystPanel, IDLE, type AiState } from './AnalystPanel';
import { PERMANENT_SAMPLE_ERRORS, sampleErrorMessage, type SampleError, type SampleFn } from './claude';
import { saveFile } from './save';

const DOC: Record<DocKind, { short: string; long: string; basis: string }> = {
  etp: { short: 'ETP', long: 'Estudo Técnico Preliminar', basis: 'art. 18 da Lei 14.133/2021' },
  tr: { short: 'TR', long: 'Termo de Referência', basis: 'art. 6º, XXIII, da Lei 14.133/2021' },
};

const NATURE: Record<ObjectNature, string> = {
  compra: 'Compra',
  servico: 'Serviço',
  servico_continuo: 'Serviço contínuo',
  obra: 'Obra / engenharia',
};

const SEVERITY: Record<Severity, { label: string; plural: string }> = {
  bloqueante: { label: 'Bloqueante', plural: 'bloqueantes' },
  alerta: { label: 'Alerta', plural: 'alertas' },
  sugestao: { label: 'Sugestão', plural: 'sugestões' },
};

const EXAMPLE: Record<DocKind, string> = { etp: DRAFT_ETP_MERENDA, tr: DRAFT_TR_MERENDA };

interface Context {
  category: ObjectCategory;
  nature: ObjectNature;
  estimated: string;
  perishable: boolean;
  dedicatedLabor: boolean;
}

/** Arquivo de onde veio o texto; define o formato do arquivo corrigido. */
interface Source {
  type: 'docx' | 'txt';
  name: string;
}

interface Draft {
  texts: Record<DocKind, string>;
  example: Record<DocKind, boolean>;
  sources: Record<DocKind, Source | null>;
  ctx: Context;
}

const STORAGE_KEY = 'verificador-etp-tr:rascunho';
const AI_KEY = 'verificador-etp-tr:analise-ia';

function loadAi(): Record<DocKind, AiState> {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_KEY) ?? 'null');
    if (raw?.etp && raw?.tr) {
      // Uma análise interrompida pelo recarregamento volta ao início.
      const fix = (s: AiState): AiState => (s.status === 'done' ? s : IDLE);
      return { etp: fix(raw.etp), tr: fix(raw.tr) };
    }
  } catch {
    /* sem análise guardada */
  }
  return { etp: IDLE, tr: IDLE };
}
const FILE_KEY = (k: DocKind) => `verificador-etp-tr:arquivo:${k}`;

/** Guarda o .docx original no navegador para gerar o corrigido mesmo depois de recarregar. */
function storeBytes(kind: DocKind, bytes: ArrayBuffer | null): boolean {
  try {
    if (!bytes) {
      localStorage.removeItem(FILE_KEY(kind));
      return true;
    }
    let bin = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
    localStorage.setItem(FILE_KEY(kind), btoa(bin));
    return true;
  } catch {
    return false;
  }
}

function loadBytes(kind: DocKind): ArrayBuffer | null {
  try {
    const b64 = localStorage.getItem(FILE_KEY(kind));
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  } catch {
    return null;
  }
}
const INITIAL: Draft = {
  texts: { ...EXAMPLE },
  example: { etp: true, tr: true },
  sources: { etp: null, tr: null },
  ctx: { category: 'merenda', nature: 'compra', estimated: '', perishable: true, dedicatedLabor: false },
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...INITIAL, ...JSON.parse(raw) };
  } catch {
    /* sem armazenamento: começa pelo exemplo */
  }
  return INITIAL;
}

function parseMoney(input: string): number | null {
  const clean = input.replace(/[^\d,.]/g, '');
  if (!clean) return null;
  const n = Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function toContext(c: Context): AnalysisContext {
  return {
    category: c.category,
    nature: c.nature,
    estimatedCents: parseMoney(c.estimated),
    features: { perishable: c.perishable, dedicatedLabor: c.dedicatedLabor },
  };
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CONCLUSION_TEXT = { apto: 'apto para o parecer jurídico', apto_com_ressalvas: 'apto com ressalvas', nao_apto: 'não apto: precisa de ajustes' };

function reportText(kind: DocKind, r: ComplianceReport, ai?: AnalystResult): string {
  const aiLines = ai
    ? [
        'ANÁLISE JURÍDICA (IA)',
        `Conclusão: ${CONCLUSION_TEXT[ai.conclusao]}`,
        ai.resumo,
        '',
        ...ai.propostas.flatMap((p, i) => [
          `${i + 1}. [${SEVERITY[p.gravidade].label.toUpperCase()}] ${p.titulo}${p.fundamento ? ` (${p.fundamento})` : ''}`,
          ...(p.analise ? [`   ${p.analise}`] : []),
          `   Texto proposto: ${p.texto.replace(/\n+/g, ' / ')}`,
        ]),
        '',
      ]
    : [];
  const lines = [
    `VERIFICAÇÃO DE CONFORMIDADE — ${DOC[kind].long.toUpperCase()}`,
    `Data: ${new Date(r.analyzedAt).toLocaleString('pt-BR')}`,
    `Pontuação: ${r.score}/100 — ${r.approvable ? 'sem pendências bloqueantes' : 'com pendências bloqueantes'}`,
    '',
    ...aiLines,
    `ELEMENTOS EXIGIDOS (${r.sections.filter((s) => s.present).length}/${r.sections.length}) — ${DOC[kind].basis}`,
    ...r.sections.map((s) => `[${s.present ? 'x' : ' '}] ${s.label} (${s.basis}${s.mandatory ? ', obrigatório' : ''})`),
    '',
    'APONTAMENTOS',
    ...r.findings.flatMap((f, i) => [
      `${i + 1}. [${SEVERITY[f.severity].label.toUpperCase()}] ${f.message} (${f.basis})`,
      ...(f.why ? [`   Por que importa: ${f.why}`] : []),
      ...(f.excerpt ? [`   Trecho: ${f.excerpt}`] : []),
      ...(f.suggestion ? [`   Sugestão: ${f.suggestion}`] : []),
    ]),
    ...(r.findings.length ? [] : ['Nenhum apontamento.']),
    '',
    'Análise automática de apoio. Não substitui o parecer jurídico (art. 53 da Lei 14.133/2021).',
  ];
  return lines.join('\n');
}

export function App() {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [kind, setKind] = useState<DocKind>('etp');
  const [filter, setFilter] = useState<Severity | 'todos'>('todos');
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error'; undo?: { kind: DocKind; text: string; applied?: string[] } } | null>(null);
  const [ai, setAi] = useState<Record<DocKind, AiState>>(loadAi);
  const [sampleFn, setSampleFn] = useState<SampleFn | null | undefined>(undefined);
  const aiCtl = useRef<AbortController | null>(null);
  const [creating, setCreating] = useState(false);
  const files = useRef<Record<DocKind, ArrayBuffer | null>>({ etp: loadBytes('etp'), tr: loadBytes('tr') });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [importing, setImporting] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const text = draft.texts[kind];
  const deferredTexts = useDeferredValue(draft.texts);
  const ctx = useMemo(() => toContext(draft.ctx), [draft.ctx]);
  const reports = useMemo(
    () => ({
      etp: deferredTexts.etp.trim() ? analyzeDocument('etp', deferredTexts.etp, ctx) : null,
      tr: deferredTexts.tr.trim() ? analyzeDocument('tr', deferredTexts.tr, ctx) : null,
    }),
    [deferredTexts, ctx],
  );
  const report = reports[kind];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* rascunho só não persiste */
    }
  }, [draft]);

  useEffect(() => {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(ai));
    } catch {
      /* análise só não persiste */
    }
  }, [ai]);

  // A IA só existe quando a página roda dentro do Claude.
  useEffect(() => {
    let alive = true;
    if (!window.claude) {
      setSampleFn(null);
      return;
    }
    window.claude
      .use('sample')
      .then((s) => alive && setSampleFn(() => s))
      .catch(() => alive && setSampleFn(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? 7000 : 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const notify = (t: string, tone: 'ok' | 'error' = 'ok') => setToast({ text: t, tone });
  const setText = (value: string, example = false) =>
    setDraft((d) => ({ ...d, texts: { ...d.texts, [kind]: value }, example: { ...d.example, [kind]: example } }));
  const setSource = (k: DocKind, source: Source | null, bytes: ArrayBuffer | null) => {
    files.current[k] = bytes;
    const kept = storeBytes(k, bytes);
    setDraft((d) => ({ ...d, sources: { ...d.sources, [k]: source } }));
    return kept;
  };
  const source = draft.sources[kind];
  const docxReady = source?.type === 'docx' && !!files.current[kind];

  /** Seleciona no editor o trecho [from, to) e rola até ele. */
  function selectRange(from: number, to: number) {
    requestAnimationFrame(() => {
      const ta = textRef.current;
      if (!ta) return;
      // Altura do texto anterior ao trecho: encurta o valor por um instante e lê scrollHeight.
      const full = ta.value;
      ta.value = full.slice(0, from);
      const top = ta.scrollHeight;
      ta.value = full;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(from, to);
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  /** Seleciona o texto efetivamente inserido por uma edição (sem as linhas em branco em volta). */
  function selectInserted(start: number, inserted: string) {
    const lead = inserted.length - inserted.trimStart().length;
    selectRange(start + lead, start + inserted.trimEnd().length);
  }

  const aiState = ai[kind];
  const aiResult: AnalystResult | undefined = aiState.status === 'done' ? aiState.result : undefined;

  /** Proposta da analista que resolve um apontamento automático e ainda pode ser aplicada. */
  function aiProposalFor(findingId: string) {
    if (!aiResult || !aiState.snapshot) return undefined;
    return aiResult.propostas.find((p) => p.relacionado === findingId && !aiState.applied.includes(p.id) && editFor(draft.texts[kind], aiState.snapshot!, p));
  }

  function applyProposals(ids: string[]) {
    const st = ai[kind];
    if (!st.result || !st.snapshot) return;
    const current = draft.texts[kind];
    const chosen = st.result.propostas.filter((p) => ids.includes(p.id) && !st.applied.includes(p.id));
    const single = chosen.length === 1 ? editFor(current, st.snapshot, chosen[0]) : null;
    const r = applyMany(current, st.snapshot, chosen);
    if (!r.applied.length) {
      notify('O trecho de referência mudou no texto. Refaça a análise para reposicionar.', 'error');
      return;
    }
    setText(r.text);
    setAi((a) => ({ ...a, [kind]: { ...a[kind], applied: [...a[kind].applied, ...r.applied] } }));
    const msg =
      r.applied.length === 1
        ? 'Correção da analista aplicada. Revise o texto e preencha os campos entre colchetes.'
        : `${r.applied.length} correções aplicadas${r.skipped.length ? `; ${r.skipped.length} não couberam e ficaram pendentes` : ''}. Revise o texto.`;
    setToast({ text: msg, tone: 'ok', undo: { kind, text: current, applied: st.applied } });
    if (single) selectInserted(single.start, single.text);
  }

  /** Aplica a correção de um apontamento: na posição da analista, se houver; senão, pela regra automática. */
  function applyFinding(id: string) {
    const proposal = aiProposalFor(id);
    if (proposal) {
      applyProposals([proposal.id]);
      return;
    }
    const current = draft.texts[kind];
    const fix = analyzeDocument(kind, current, ctx).findings.find((f) => f.id === id)?.fix;
    if (!fix) {
      notify('Esse apontamento já foi resolvido no texto.', 'error');
      return;
    }
    setText(applyFix(current, fix), false);
    setToast({ text: 'Sugestão inserida. Complete os campos entre colchetes.', tone: 'ok', undo: { kind, text: current } });
    selectInserted(fix.start, fix.text);
  }

  async function runAnalysis(refresh: boolean) {
    if (!sampleFn) return;
    const k = kind;
    const current = draft.texts[k];
    const features = [draft.ctx.perishable && 'bens perecíveis', draft.ctx.dedicatedLabor && 'mão de obra com dedicação exclusiva'].filter(Boolean) as string[];
    const { prompt, lines, truncated } = buildPrompt({
      kind: k,
      text: current,
      category: CATEGORY_LABELS[draft.ctx.category],
      nature: NATURE[draft.ctx.nature],
      estimated: draft.ctx.estimated ? `R$ ${draft.ctx.estimated}` : '',
      features,
      report: analyzeDocument(k, current, ctx),
    });
    aiCtl.current?.abort();
    const ctl = new AbortController();
    aiCtl.current = ctl;
    setAi((a) => ({ ...a, [k]: { status: 'running', startedAt: Date.now(), streamed: 0, applied: [] } }));
    try {
      const raw = await sampleFn.json(prompt, {
        modelTier: 'complex',
        signal: ctl.signal,
        cache: refresh ? false : true,
        onText: ({ text: t }) => {
          const n = (t.match(/"gravidade"/g) ?? []).length;
          setAi((a) => (a[k].status === 'running' && a[k].streamed !== n ? { ...a, [k]: { ...a[k], streamed: n } } : a));
        },
      });
      const result = parseResult(raw, lines.length);
      setAi((a) => ({ ...a, [k]: { status: 'done', result, snapshot: lines, analyzedText: current, truncatedDoc: truncated, applied: [] } }));
    } catch (e) {
      const code = (e as SampleError)?.code;
      if (code === 'cancelled') {
        setAi((a) => ({ ...a, [k]: IDLE }));
        return;
      }
      if (PERMANENT_SAMPLE_ERRORS.has(code)) setSampleFn(null);
      setAi((a) => ({ ...a, [k]: { status: 'error', error: sampleErrorMessage(code), applied: [] } }));
    }
  }

  async function createFile() {
    const current = draft.texts[kind];
    if (!current.trim()) return;
    setCreating(true);
    try {
      const { newDocx, writeDocx } = await import('./docx');
      const base = source ? source.name.replace(/\.[^.]+$/, '') : DOC[kind].short;
      let blob: Blob;
      let filename: string;
      if (source?.type === 'txt') {
        blob = new Blob([current], { type: 'text/plain;charset=utf-8' });
        filename = `${base}-corrigido.txt`;
      } else if (docxReady) {
        blob = await writeDocx({ bytes: files.current[kind]!.slice(0), name: source!.name }, current);
        filename = `${base}-corrigido.docx`;
      } else {
        blob = await newDocx(current);
        filename = `${base}-corrigido.docx`;
      }
      const result = await saveFile(filename, blob);
      if (result === 'saved') notify(`${filename} criado`);
      else if (result === 'unavailable') notify('Este navegador não permitiu salvar o arquivo.', 'error');
    } catch {
      notify('Não foi possível criar o arquivo. Tente de novo.', 'error');
    } finally {
      setCreating(false);
    }
  }
  const setCtx = <K extends keyof Context>(k: K, v: Context[K]) => setDraft((d) => ({ ...d, ctx: { ...d.ctx, [k]: v } }));

  async function importFile(file: File) {
    setImporting(true);
    try {
      const name = file.name.toLowerCase();
      let content: string;
      let next: Source;
      let bytes: ArrayBuffer | null = null;
      if (name.endsWith('.docx')) {
        const { readDocx } = await import('./docx');
        bytes = await file.arrayBuffer();
        content = await readDocx(bytes.slice(0));
        next = { type: 'docx', name: file.name };
      } else if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
        content = await file.text();
        next = { type: 'txt', name: file.name };
      } else {
        notify('Envie um arquivo .docx ou .txt. Para PDF, copie o texto e cole no campo.', 'error');
        return;
      }
      if (!content.trim()) {
        notify('O arquivo não tem texto legível.', 'error');
        return;
      }
      setText(next.type === 'docx' ? content : content.replace(/\r\n?/g, '\n'));
      const kept = setSource(kind, next, bytes);
      notify(kept ? `${file.name} carregado` : `${file.name} carregado. O arquivo é grande demais para ficar salvo: se recarregar a página, envie de novo.`);
    } catch {
      notify('Não foi possível ler o arquivo. Copie o texto e cole no campo.', 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { bloqueante: 0, alerta: 0, sugestao: 0 };
    report?.findings.forEach((f) => (c[f.severity] += 1));
    return c;
  }, [report]);
  const visible = report?.findings.filter((f) => filter === 'todos' || f.severity === filter) ?? [];

  return (
    <div className="page">
      <header className="masthead">
        <div className="mark" aria-hidden>
          §
        </div>
        <div>
          <h1>Verificador de ETP e TR</h1>
          <p>Confere o rascunho com os elementos exigidos pela Lei 14.133/2021 e aponta o que costuma gerar impugnação ou apontamento do tribunal de contas.</p>
        </div>
      </header>

      <div className="layout">
        <section className="panel editor" aria-label="Documento">
          <div className="doc-switch" role="tablist" aria-label="Documento">
            {(['etp', 'tr'] as const).map((k) => {
              const r = reports[k];
              return (
                <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                  <span className="doc-name">{DOC[k].long}</span>
                  <span className={`doc-score ${r ? (r.approvable ? 'ok' : 'bad') : ''}`}>{r ? `${r.score}/100` : 'vazio'}</span>
                </button>
              );
            })}
          </div>

          <details className="context" open>
            <summary>Sobre a contratação</summary>
            <p className="hint">Essas informações ativam as regras específicas do objeto (merenda, mão de obra, perecíveis, ME/EPP).</p>
            <div className="fields">
              <label>
                Categoria do objeto
                <select id="category" value={draft.ctx.category} onChange={(e) => setCtx('category', e.target.value as ObjectCategory)}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Natureza
                <select id="nature" value={draft.ctx.nature} onChange={(e) => setCtx('nature', e.target.value as ObjectNature)}>
                  {Object.entries(NATURE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valor estimado (R$, opcional)
                <input id="estimated" inputMode="decimal" placeholder="Ex.: 75.000,00" value={draft.ctx.estimated} onChange={(e) => setCtx('estimated', e.target.value)} />
              </label>
            </div>
            <div className="checks">
              <label className="check">
                <input id="perishable" type="checkbox" checked={draft.ctx.perishable} onChange={(e) => setCtx('perishable', e.target.checked)} /> Bens perecíveis
              </label>
              <label className="check">
                <input id="labor" type="checkbox" checked={draft.ctx.dedicatedLabor} onChange={(e) => setCtx('dedicatedLabor', e.target.checked)} /> Mão de obra com dedicação exclusiva
              </label>
            </div>
          </details>

          {draft.example[kind] && (
            <p className="example-note">
              Exemplo carregado: rascunho fictício de {DOC[kind].short} de merenda escolar, com erros comuns. Apague e cole o seu texto.
            </p>
          )}

          <label className="sr-only" htmlFor="doc-text">
            Texto do {DOC[kind].long}
          </label>
          <textarea
            id="doc-text"
            ref={textRef}
            className="doc-text"
            value={text}
            spellCheck
            onChange={(e) => setText(e.target.value)}
            placeholder={`Cole aqui o texto do ${DOC[kind].long} ou envie um arquivo .docx.`}
          />

          <div className="actions">
            <button type="button" className="btn" disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? 'Lendo arquivo…' : 'Enviar .docx ou .txt'}
            </button>
            <input ref={fileRef} type="file" accept=".docx,.txt,.md,text/plain" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <button type="button" className="btn primary" disabled={!text.trim() || creating} onClick={createFile}>
              {creating ? 'Criando arquivo…' : source?.type === 'txt' ? 'Criar .txt corrigido' : 'Criar .docx corrigido'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!text}
              onClick={() => {
                setText('');
                setSource(kind, null, null);
              }}
            >
              Limpar
            </button>
            <button
              type="button"
              className="btn"
              disabled={draft.example[kind]}
              onClick={() => {
                setText(EXAMPLE[kind], true);
                setSource(kind, null, null);
              }}
            >
              Carregar exemplo
            </button>
            <span className="counter">{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString('pt-BR')} palavras` : ''}</span>
          </div>
          <p className="hint file-hint">
            {docxReady
              ? `O arquivo corrigido mantém a formatação de ${source!.name}: só os parágrafos que você alterou são reescritos.`
              : source?.type === 'docx'
                ? `Envie ${source.name} de novo para que o arquivo corrigido mantenha a formatação dele. Sem isso, ele sai com formatação padrão.`
                : source?.type === 'txt'
                  ? `O arquivo corrigido sai em .txt, como ${source.name}.`
                  : 'Envie o seu .docx para que o arquivo corrigido mantenha a formatação dele. Texto colado gera um .docx com formatação padrão.'}
          </p>
        </section>

        <section className="panel results" aria-label="Resultado" aria-live="polite">
          {!report ? (
            <div className="empty">
              <h2>Nada para analisar ainda</h2>
              <p>Cole o texto do {DOC[kind].long} ao lado ou envie o arquivo. A análise aparece aqui enquanto você digita.</p>
            </div>
          ) : (
            <>
              <div className="verdict">
                <Gauge score={report.score} />
                <div>
                  <h2>{report.approvable ? 'Pode seguir para o jurídico' : 'Precisa de ajustes antes do jurídico'}</h2>
                  <p>
                    {counts.bloqueante > 0 && (
                      <>
                        <strong className="t-bad">{counts.bloqueante} {counts.bloqueante === 1 ? 'pendência bloqueante' : 'pendências bloqueantes'}</strong>
                        {', '}
                      </>
                    )}
                    {counts.alerta} {counts.alerta === 1 ? 'alerta' : 'alertas'} e {counts.sugestao} {counts.sugestao === 1 ? 'sugestão' : 'sugestões'}.
                  </p>
                  <button
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      const t = reportText(kind, report, aiResult);
                      if (await copy(t)) notify('Relatório copiado');
                      else setFallbackText(t);
                    }}
                  >
                    Copiar relatório
                  </button>
                </div>
              </div>

              {fallbackText && (
                <div className="fallback">
                  <p className="hint">Não foi possível copiar automaticamente. Selecione o texto abaixo e copie.</p>
                  <textarea readOnly value={fallbackText} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn small" onClick={() => setFallbackText(null)}>
                    Fechar
                  </button>
                </div>
              )}

              <AnalystPanel
                available={sampleFn === undefined ? undefined : sampleFn !== null}
                state={aiState}
                text={text}
                docName={DOC[kind].long}
                onRun={runAnalysis}
                onStop={() => aiCtl.current?.abort()}
                onApply={applyProposals}
                onCopy={async (t) => notify((await copy(t)) ? 'Texto copiado' : 'Selecione o texto e copie manualmente.', 'ok')}
              />

              <div className="block">
                <h3>
                  Elementos exigidos{' '}
                  <span className="muted">
                    {report.sections.filter((s) => s.present).length} de {report.sections.length} · {DOC[kind].basis}
                  </span>
                </h3>
                <ul className="elements">
                  {report.sections.map((s) => (
                    <li key={s.key} className={s.present ? 'present' : s.mandatory ? 'missing' : 'optional'}>
                      <span className="tick" aria-label={s.present ? 'presente' : 'ausente'}>
                        {s.present ? '✓' : '✕'}
                      </span>
                      <span>
                        {s.label}
                        {s.mandatory && <span className="tag">obrigatório</span>}
                      </span>
                      <span className="basis">{s.basis}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="block">
                <div className="findings-head">
                  <h3>Apontamentos</h3>
                  <div className="filters" role="group" aria-label="Filtrar por gravidade">
                    {(['todos', 'bloqueante', 'alerta', 'sugestao'] as const).map((f) => (
                      <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                        {f === 'todos' ? `Todos (${report.findings.length})` : `${SEVERITY[f].label} (${counts[f]})`}
                      </button>
                    ))}
                  </div>
                </div>
                {visible.length === 0 ? (
                  <p className="muted">{report.findings.length ? 'Nenhum apontamento com essa gravidade.' : 'Nenhum apontamento. Revise mesmo assim antes de enviar.'}</p>
                ) : (
                  <ol className="findings">
                    {visible.map((f) => (
                      <FindingItem
                        key={f.id}
                        finding={f}
                        aiPlaced={!!aiProposalFor(f.id)}
                        aiCleared={aiResult?.falsos_positivos.find((x) => x.id === f.id)?.motivo}
                        onApply={() => applyFinding(f.id)}
                        onCopied={(ok) => notify(ok ? 'Texto sugerido copiado' : 'Selecione o texto sugerido e copie manualmente.', ok ? 'ok' : 'error')}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
          <p className="disclaimer">
            Análise automática por regras, feita no seu navegador: o texto não é enviado a nenhum servidor. Serve de apoio e não substitui o parecer jurídico (art. 53 da
            Lei 14.133/2021) nem as normas locais do seu órgão.
          </p>
        </section>
      </div>

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const u = toast.undo!;
                setDraft((d) => ({ ...d, texts: { ...d.texts, [u.kind]: u.text } }));
                if (u.applied) setAi((a) => ({ ...a, [u.kind]: { ...a[u.kind], applied: u.applied! } }));
                setToast({ text: 'Alteração desfeita', tone: 'ok' });
              }}
            >
              Desfazer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Gauge({ score }: { score: number }) {
  const tone = score >= 85 ? 'ok' : score >= 60 ? 'mid' : 'bad';
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className={`gauge ${tone}`} role="img" aria-label={`Pontuação ${score} de 100`}>
      <svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r={r} className="track" />
        <circle cx="36" cy="36" r={r} className="value" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 36 36)" />
      </svg>
      <span>{score}</span>
    </div>
  );
}

function FindingItem({
  finding: f,
  aiPlaced,
  aiCleared,
  onApply,
  onCopied,
}: {
  finding: Finding;
  aiPlaced: boolean;
  aiCleared?: string;
  onApply: () => void;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <li className={`finding ${f.severity}`}>
      <div className="finding-top">
        <span className={`sev ${f.severity}`}>{SEVERITY[f.severity].label}</span>
        <span className="basis">{f.basis}</span>
      </div>
      <p>{f.message}</p>
      {f.why && (
        <p className="why">
          <strong>Por que importa:</strong> {f.why}
        </p>
      )}
      {aiCleared && (
        <p className="ai-note">
          <strong>A analista considera atendido:</strong> {aiCleared}
        </p>
      )}
      {f.excerpt && <blockquote>{f.excerpt}</blockquote>}
      {f.suggestion && (
        <details>
          <summary>Texto sugerido</summary>
          <p className="suggestion">{f.suggestion}</p>
        </details>
      )}
      {f.suggestion && (
        <div className="finding-actions">
          {(f.fix || aiPlaced) && (
            <button type="button" className="btn small apply" onClick={onApply} title={aiPlaced ? 'Usa o texto e a posição propostos pela analista' : undefined}>
              {aiPlaced ? 'Inserir no texto (posição da IA)' : f.fix!.label === 'Inserir seção' ? 'Inserir no texto' : f.fix!.label}
            </button>
          )}
          <button type="button" className="btn small" onClick={async () => onCopied(await copy(f.suggestion!))}>
            Copiar sugestão
          </button>
        </div>
      )}
    </li>
  );
}
