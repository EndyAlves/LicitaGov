import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ComplianceReport, DocKind, Finding, ObjectCategory, ObjectNature, Severity } from '../../server/src/domain/types';
import { CATEGORY_LABELS } from '../../server/src/legal/clauses';
import { analyzeDocument, type AnalysisContext } from '../../server/src/legal/compliance';
import { DRAFT_ETP_MERENDA, DRAFT_TR_MERENDA } from '../../server/src/seed';

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

interface Draft {
  texts: Record<DocKind, string>;
  example: Record<DocKind, boolean>;
  ctx: Context;
}

const STORAGE_KEY = 'verificador-etp-tr:rascunho';
const INITIAL: Draft = {
  texts: { ...EXAMPLE },
  example: { etp: true, tr: true },
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

function reportText(kind: DocKind, r: ComplianceReport): string {
  const lines = [
    `VERIFICAÇÃO DE CONFORMIDADE — ${DOC[kind].long.toUpperCase()}`,
    `Data: ${new Date(r.analyzedAt).toLocaleString('pt-BR')}`,
    `Pontuação: ${r.score}/100 — ${r.approvable ? 'sem pendências bloqueantes' : 'com pendências bloqueantes'}`,
    '',
    `ELEMENTOS EXIGIDOS (${r.sections.filter((s) => s.present).length}/${r.sections.length}) — ${DOC[kind].basis}`,
    ...r.sections.map((s) => `[${s.present ? 'x' : ' '}] ${s.label} (${s.basis}${s.mandatory ? ', obrigatório' : ''})`),
    '',
    'APONTAMENTOS',
    ...r.findings.flatMap((f, i) => [
      `${i + 1}. [${SEVERITY[f.severity].label.toUpperCase()}] ${f.message} (${f.basis})`,
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
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
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
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const notify = (t: string, tone: 'ok' | 'error' = 'ok') => setToast({ text: t, tone });
  const setText = (value: string, example = false) =>
    setDraft((d) => ({ ...d, texts: { ...d.texts, [kind]: value }, example: { ...d.example, [kind]: example } }));
  const setCtx = <K extends keyof Context>(k: K, v: Context[K]) => setDraft((d) => ({ ...d, ctx: { ...d.ctx, [k]: v } }));

  async function importFile(file: File) {
    setImporting(true);
    try {
      const name = file.name.toLowerCase();
      let content: string;
      if (name.endsWith('.docx')) {
        const mammoth = await import('mammoth');
        content = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      } else if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
        content = await file.text();
      } else {
        notify('Envie um arquivo .docx ou .txt. Para PDF, copie o texto e cole no campo.', 'error');
        return;
      }
      if (!content.trim()) {
        notify('O arquivo não tem texto legível.', 'error');
        return;
      }
      setText(content.replace(/\n{3,}/g, '\n\n'));
      notify(`${file.name} carregado`);
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
            className="doc-text"
            value={text}
            spellCheck
            onChange={(e) => setText(e.target.value)}
            placeholder={`Cole aqui o texto do ${DOC[kind].long} ou envie um arquivo .docx.`}
          />

          <div className="actions">
            <button type="button" className="btn primary" disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? 'Lendo arquivo…' : 'Enviar .docx ou .txt'}
            </button>
            <input ref={fileRef} type="file" accept=".docx,.txt,.md,text/plain" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <button type="button" className="btn" disabled={!text} onClick={() => setText('')}>
              Limpar
            </button>
            <button type="button" className="btn" disabled={draft.example[kind]} onClick={() => setText(EXAMPLE[kind], true)}>
              Carregar exemplo
            </button>
            <span className="counter">{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString('pt-BR')} palavras` : ''}</span>
          </div>
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
                      const t = reportText(kind, report);
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
                      <FindingItem key={f.id} finding={f} onCopied={(ok) => notify(ok ? 'Texto sugerido copiado' : 'Selecione o texto sugerido e copie manualmente.', ok ? 'ok' : 'error')} />
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
          {toast.text}
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

function FindingItem({ finding: f, onCopied }: { finding: Finding; onCopied: (ok: boolean) => void }) {
  return (
    <li className={`finding ${f.severity}`}>
      <div className="finding-top">
        <span className={`sev ${f.severity}`}>{SEVERITY[f.severity].label}</span>
        <span className="basis">{f.basis}</span>
      </div>
      <p>{f.message}</p>
      {f.excerpt && <blockquote>{f.excerpt}</blockquote>}
      {f.suggestion && (
        <details>
          <summary>Texto sugerido</summary>
          <p className="suggestion">{f.suggestion}</p>
          <button type="button" className="btn small" onClick={async () => onCopied(await copy(f.suggestion!))}>
            Copiar texto sugerido
          </button>
        </details>
      )}
    </li>
  );
}
