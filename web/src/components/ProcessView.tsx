import { useCallback, useEffect, useState } from 'react';
import type { Notify } from '../App';
import { api, type Catalog, type Process, type User } from '../lib/api';
import { dateTime, money, PHASE_LABEL } from '../lib/format';
import { ContractTab } from './ContractTab';
import { DocTab } from './DocTab';
import { ExternalTab } from './ExternalTab';
import { PricesTab } from './PricesTab';

type Tab = 'etp' | 'tr' | 'precos' | 'externa' | 'contrato' | 'historico';

const TABS: { id: Tab; label: string }[] = [
  { id: 'etp', label: 'ETP' },
  { id: 'tr', label: 'Termo de Referência' },
  { id: 'precos', label: 'Pesquisa de preços' },
  { id: 'externa', label: 'Riscos, edital e habilitação' },
  { id: 'contrato', label: 'Contrato e fiscalização' },
  { id: 'historico', label: 'Histórico' },
];

const PHASES: Process['phase'][] = ['planejamento', 'externa', 'contrato'];

export interface TabProps {
  process: Process;
  me: User;
  users: User[];
  catalog: Catalog;
  engine: 'regras' | 'claude';
  notify: Notify;
  update: (p: Process) => void;
  run: <T>(action: () => Promise<T>, ok?: string | ((r: T) => string)) => Promise<T | undefined>;
}

export function ProcessView(props: { id: string; me: User; users: User[]; catalog: Catalog; engine: 'regras' | 'claude'; notify: Notify; onBack: () => void }) {
  const { id, notify } = props;
  const [process, setProcess] = useState<Process | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    api
      .process(id)
      .then((p) => {
        setProcess(p);
        setTab((t) => t ?? (p.phase === 'contrato' ? 'contrato' : p.phase === 'externa' ? 'externa' : 'etp'));
      })
      .catch((e) => notify(e.message, 'error'));
  }, [id, notify]);

  const run: TabProps['run'] = useCallback(
    async (action, ok) => {
      try {
        const r = await action();
        if (ok) notify(typeof ok === 'function' ? ok(r) : ok);
        return r;
      } catch (e) {
        notify((e as Error).message, 'error');
        return undefined;
      }
    },
    [notify],
  );

  if (!process || !tab) return <p className="muted">Carregando…</p>;
  const tabProps: TabProps = { ...props, process, update: setProcess, run };
  const phaseIdx = PHASES.indexOf(process.phase);

  return (
    <div className="stack">
      <button type="button" className="link" onClick={props.onBack}>
        ← Todos os processos
      </button>
      <section className="card process-head">
        <div className="row between wrap gap">
          <div>
            <h1>
              {process.number} · {process.title}
            </h1>
            <p className="muted">{process.object}</p>
            <p className="small muted">
              {props.catalog.categories[process.category]} · {process.unit} · Valor estimado {money(process.estimatedCents)}
            </p>
          </div>
          <ol className="stepper" aria-label="Fases">
            {PHASES.map((ph, i) => (
              <li key={ph} className={i < phaseIdx ? 'done' : i === phaseIdx ? 'current' : ''}>
                {PHASE_LABEL[ph]}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {(tab === 'etp' || tab === 'tr') && <DocTab key={tab} kind={tab} {...tabProps} />}
      {tab === 'precos' && <PricesTab {...tabProps} />}
      {tab === 'externa' && <ExternalTab {...tabProps} />}
      {tab === 'contrato' && <ContractTab {...tabProps} />}
      {tab === 'historico' && (
        <section className="card">
          <h2>Trilha de auditoria</h2>
          <ul className="timeline">
            {[...process.audit].reverse().map((a, i) => (
              <li key={i}>
                <span className="muted small">{dateTime(a.at)}</span> <strong>{a.action}</strong>
                {a.actorId && <span className="muted"> — {props.users.find((u) => u.id === a.actorId)?.name ?? a.actorId}</span>}
                {a.note && <div className="small">{a.note}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
