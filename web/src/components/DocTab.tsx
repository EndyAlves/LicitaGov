import { useEffect, useMemo, useState } from 'react';
import { api, type AdjustResult, type Clause, type ComplianceReport, type DocKind } from '../lib/api';
import { dateTime, SEVERITY_LABEL, STATUS_LABEL } from '../lib/format';
import type { TabProps } from './ProcessView';

const TITLE: Record<DocKind, string> = { etp: 'Estudo Técnico Preliminar', tr: 'Termo de Referência' };

export function DocTab({ kind, process, me, engine, update, run }: TabProps & { kind: DocKind }) {
  const doc = process.documents[kind];
  const [text, setText] = useState(doc.text);
  const [proposal, setProposal] = useState<AdjustResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [clauses, setClauses] = useState<Clause[] | null>(null);
  const [section, setSection] = useState('');

  useEffect(() => setText(doc.text), [doc.text]);

  const editable = me.roles.some((r) => r === 'requisitante' || r === 'planejamento') && process.phase === 'planejamento' && doc.status !== 'aprovado' && doc.status !== 'em_analise_juridica';
  const isLawyer = me.roles.includes('juridico');
  const dirty = text !== doc.text;
  const report = doc.report;

  useEffect(() => {
    api
      .clauses({ category: process.category, doc: kind, section: section || undefined })
      .then(setClauses)
      .catch(() => setClauses([]));
  }, [process.category, kind, section]);

  async function act<T>(fn: () => Promise<T>, ok?: string | ((r: T) => string)) {
    setBusy(true);
    const r = await run(fn, ok);
    setBusy(false);
    return r;
  }

  const save = () => act(() => api.saveDoc(process.id, kind, text), (p) => `Salvo · conformidade ${p.documents[kind].report?.score}/100`).then((p) => p && update(p));

  const insert = (snippet: string, heading?: string) => {
    setText((t) => `${t.trimEnd()}\n\n${heading ? `${heading}\n` : ''}${snippet}\n`);
  };

  return (
    <div className="doc-layout">
      <section className="card editor">
        <div className="card-head">
          <div>
            <h2>{TITLE[kind]}</h2>
            <p className="small muted">
              v{doc.version} · {STATUS_LABEL[doc.status]} · atualizado em {dateTime(doc.updatedAt)}
            </p>
          </div>
          <span className={`pill status-${doc.status}`}>{STATUS_LABEL[doc.status]}</span>
        </div>
        {doc.status === 'devolvido' && doc.reviewNote && (
          <div className="callout warn">
            <strong>Devolvido pelo jurídico:</strong> {doc.reviewNote}
          </div>
        )}
        <textarea
          className="doc-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!editable}
          spellCheck
          placeholder={`Cole aqui o rascunho do ${TITLE[kind]} ou comece pelo banco de cláusulas →`}
        />
        <div className="row gap wrap">
          {editable && (
            <>
              <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>
                Salvar e analisar
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || dirty || !doc.text.trim()}
                title={dirty ? 'Salve antes de ajustar' : undefined}
                onClick={() => act(() => api.adjust(process.id, kind)).then((r) => r && setProposal(r))}
              >
                {engine === 'claude' ? '✦ Ajustar com IA' : '✦ Ajustar automaticamente'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || dirty || !report?.approvable}
                title={!report?.approvable ? 'Resolva as pendências bloqueantes' : undefined}
                onClick={() => act(() => api.submit(process.id, kind), 'Enviado ao jurídico').then((p) => p && update(p))}
              >
                Enviar ao jurídico
              </button>
            </>
          )}
          {isLawyer && doc.status === 'em_analise_juridica' && (
            <div className="review">
              <input placeholder="Parecer / motivo da devolução" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="btn approve" disabled={busy} onClick={() => act(() => api.review(process.id, kind, 'approve', note || undefined), 'Aprovado').then((p) => p && update(p))}>
                Aprovar
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => api.review(process.id, kind, 'return', note), 'Devolvido ao requisitante').then((p) => p && update(p))}>
                Devolver
              </button>
            </div>
          )}
        </div>

        {proposal && (
          <div className="proposal">
            <div className="card-head">
              <h3>
                Versão ajustada ({proposal.engine === 'claude' ? 'IA' : 'regras + banco de cláusulas'}) · conformidade {proposal.before} → {proposal.after}
              </h3>
              <div className="row gap">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setText(proposal.text);
                    setProposal(null);
                  }}
                >
                  Usar esta versão
                </button>
                <button type="button" className="btn" onClick={() => setProposal(null)}>
                  Descartar
                </button>
              </div>
            </div>
            <p className="small muted">Revise os trechos entre colchetes antes de salvar: a ferramenta não inventa quantidades, valores ou dotações.</p>
            <ul className="small">
              {proposal.changes.slice(0, 8).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <pre className="doc-preview">{proposal.text}</pre>
          </div>
        )}
      </section>

      <aside className="stack">
        {report ? <ReportCard report={report} onInsert={editable ? insert : undefined} /> : <div className="card muted">Salve o rascunho para analisar.</div>}
        <section className="card">
          <div className="card-head">
            <h3>Banco de cláusulas</h3>
            <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Seção">
              <option value="">Todas as seções</option>
              {[...new Set((report?.sections ?? []).map((s) => s.key))].map((k) => (
                <option key={k} value={k}>
                  {report?.sections.find((s) => s.key === k)?.label.split(' (')[0]}
                </option>
              ))}
            </select>
          </div>
          {clauses?.length === 0 && <p className="muted small">Nenhuma cláusula para este filtro.</p>}
          {clauses?.map((c) => (
            <details key={c.id} className="clause">
              <summary>
                {c.title} <span className="muted small">· {c.basis}</span>
              </summary>
              <p>{c.text}</p>
              <div className="row between">
                <span className="small muted">{c.source}</span>
                {editable && (
                  <button type="button" className="btn small" onClick={() => insert(c.text, c.title.toUpperCase())}>
                    Inserir
                  </button>
                )}
              </div>
            </details>
          ))}
        </section>
      </aside>
    </div>
  );
}

function ReportCard({ report, onInsert }: { report: ComplianceReport; onInsert?: (text: string, heading?: string) => void }) {
  const counts = useMemo(() => {
    const c = { bloqueante: 0, alerta: 0, sugestao: 0 };
    report.findings.forEach((f) => (c[f.severity] += 1));
    return c;
  }, [report]);
  const tone = report.score >= 85 ? 'good' : report.score >= 60 ? 'mid' : 'bad';

  return (
    <section className="card">
      <div className="card-head">
        <h3>Análise de conformidade</h3>
        <div className={`score score-${tone}`} title="Pontuação de conformidade">
          {report.score}
        </div>
      </div>
      <p className="small">
        {report.approvable ? '✓ Sem pendências bloqueantes — pode seguir ao jurídico.' : `✕ ${counts.bloqueante} pendência(s) bloqueante(s).`}{' '}
        <span className="muted">
          {counts.alerta} alerta(s), {counts.sugestao} sugestão(ões).
        </span>
      </p>
      <details>
        <summary className="small">Elementos exigidos ({report.sections.filter((s) => s.present).length}/{report.sections.length})</summary>
        <ul className="sections">
          {report.sections.map((s) => (
            <li key={s.key} className={s.present ? 'ok' : s.mandatory ? 'missing' : 'optional'}>
              <span aria-hidden>{s.present ? '✓' : '✕'}</span> {s.label} <span className="muted small">({s.basis}{s.mandatory ? ', obrigatório' : ''})</span>
            </li>
          ))}
        </ul>
      </details>
      <ul className="findings">
        {report.findings.map((f) => (
          <li key={f.id} className={`finding ${f.severity}`}>
            <div className="row between gap">
              <span className={`pill sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
              <span className="small muted">{f.basis}</span>
            </div>
            <p>{f.message}</p>
            {f.excerpt && <blockquote>{f.excerpt}</blockquote>}
            {f.suggestion && (
              <details>
                <summary className="small">Texto sugerido</summary>
                <p className="small">{f.suggestion}</p>
                {onInsert && (
                  <button type="button" className="btn small" onClick={() => onInsert(f.suggestion!)}>
                    Inserir no documento
                  </button>
                )}
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
