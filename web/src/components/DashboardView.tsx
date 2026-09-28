import { useCallback, useEffect, useState } from 'react';
import type { Notify } from '../App';
import { api, type Catalog, type Dashboard, type ObjectCategory, type ObjectNature, type Process, type User } from '../lib/api';
import { money, PHASE_LABEL, STATUS_LABEL } from '../lib/format';

const NATURE: Record<ObjectNature, string> = {
  compra: 'Compra',
  servico: 'Serviço',
  servico_continuo: 'Serviço contínuo',
  obra: 'Obra / engenharia',
};

export function DashboardView({ me, catalog, notify, onOpen }: { me: User; catalog: Catalog; notify: Notify; onOpen: (id: string) => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [list, setList] = useState<Process[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [d, l] = await Promise.all([api.dashboard(), api.processes()]);
    setDash(d);
    setList(l);
  }, []);

  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'));
  }, [load, notify]);

  const canCreate = me.roles.some((r) => ['requisitante', 'planejamento', 'agente'].includes(r));
  const mine = (p: Process) => {
    if (me.roles.includes('juridico')) return Object.values(p.documents).some((d) => d.status === 'em_analise_juridica');
    if (me.roles.includes('fiscal')) return p.contract?.fiscalId === me.id;
    if (me.roles.includes('agente')) return p.phase === 'externa' || (p.documents.tr.status === 'aprovado' && p.phase === 'planejamento');
    return p.phase === 'planejamento';
  };

  return (
    <div className="stack">
      <section className="kpis">
        <Kpi label="Processos" value={dash?.total ?? '…'} />
        <Kpi label="Em planejamento" value={dash?.byPhase.planejamento ?? '…'} />
        <Kpi label="No jurídico" value={dash?.inReview ?? '…'} />
        <Kpi label="Fase externa" value={dash?.byPhase.externa ?? '…'} />
        <Kpi label="Contratos em gestão" value={dash?.byPhase.contrato ?? '…'} />
        <Kpi label="Conformidade média" value={dash?.avgScore === null || !dash ? '—' : `${dash.avgScore}/100`} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Processos</h2>
            {canCreate && (
              <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)}>
                {creating ? 'Cancelar' : 'Novo processo'}
              </button>
            )}
          </div>
          {creating && (
            <NewProcess
              catalog={catalog}
              onCreated={(p) => {
                notify(`Processo ${p.number} aberto`);
                onOpen(p.id);
              }}
              notify={notify}
            />
          )}
          {list === null ? (
            <p className="muted">Carregando…</p>
          ) : (
            <ul className="process-list">
              {[...list].sort((a, b) => Number(mine(b)) - Number(mine(a))).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)}>
                    <div className="row between">
                      <strong>
                        {p.number} · {p.title}
                      </strong>
                      <span className={`pill phase-${p.phase}`}>{PHASE_LABEL[p.phase]}</span>
                    </div>
                    <div className="muted small">{p.object}</div>
                    <div className="row gap small">
                      <span>ETP: {STATUS_LABEL[p.documents.etp.status]} {p.documents.etp.report && `(${p.documents.etp.report.score})`}</span>
                      <span>TR: {STATUS_LABEL[p.documents.tr.status]} {p.documents.tr.report && `(${p.documents.tr.report.score})`}</span>
                      <span>Estimado: {money(p.estimatedCents)}</span>
                      {mine(p) && <span className="pill accent">Aguarda você</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="stack">
          <div className="card">
            <h2>Pendências bloqueantes</h2>
            <p className="muted small">Pontos que impedem o envio ao jurídico e costumam gerar impugnação ou apontamento do TCE/TCU.</p>
            {dash?.blocking.length ? (
              <ul className="plain">
                {dash.blocking.map((b, i) => (
                  <li key={i}>
                    <button type="button" className="link" onClick={() => onOpen(b.processId)}>
                      {b.number} · {b.doc.toUpperCase()}
                    </button>{' '}
                    — {b.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nenhuma.</p>
            )}
          </div>
          <div className="card">
            <h2>Erros mais frequentes</h2>
            <p className="muted small">Use para orientar a capacitação dos setores requisitantes.</p>
            <ol className="plain">
              {dash?.topIssues.map((t) => (
                <li key={t.message}>
                  <span className="count">{t.count}×</span> {t.message}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function NewProcess({ catalog, onCreated, notify }: { catalog: Catalog; onCreated: (p: Process) => void; notify: Notify }) {
  const [form, setForm] = useState({
    title: '',
    object: '',
    unit: '',
    category: 'merenda' as ObjectCategory,
    nature: 'compra' as ObjectNature,
    perishable: false,
    dedicatedLabor: false,
    priceRegistration: true,
    largeScale: false,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { perishable, dedicatedLabor, priceRegistration, largeScale, ...rest } = form;
      onCreated(await api.create({ ...rest, features: { perishable, dedicatedLabor, priceRegistration, largeScale } }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Título
        <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Merenda escolar 2027" required />
      </label>
      <label>
        Objeto
        <textarea rows={2} value={form.object} onChange={(e) => set('object', e.target.value)} placeholder="Descreva o que será contratado" required />
      </label>
      <div className="row gap wrap">
        <label className="grow">
          Unidade requisitante
          <input value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        </label>
        <label className="grow">
          Categoria
          <select value={form.category} onChange={(e) => set('category', e.target.value as ObjectCategory)}>
            {Object.entries(catalog.categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Natureza
          <select value={form.nature} onChange={(e) => set('nature', e.target.value as ObjectNature)}>
            {Object.entries(NATURE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row gap wrap small">
        <Check label="Registro de preços" checked={form.priceRegistration} onChange={(v) => set('priceRegistration', v)} />
        <Check label="Bens perecíveis" checked={form.perishable} onChange={(v) => set('perishable', v)} />
        <Check label="Mão de obra exclusiva" checked={form.dedicatedLabor} onChange={(v) => set('dedicatedLabor', v)} />
        <Check label="Grande vulto" checked={form.largeScale} onChange={(v) => set('largeScale', v)} />
      </div>
      <button type="submit" className="btn primary">
        Abrir processo
      </button>
    </form>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
