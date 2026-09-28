import { useCallback, useEffect, useState } from 'react';
import { api, type PriceReport, type PriceSource } from '../lib/api';
import { date, money, parseMoney } from '../lib/format';
import type { TabProps } from './ProcessView';

const SOURCES: Record<PriceSource, string> = {
  painel: 'Painel de Preços / PNCP',
  contratacao_similar: 'Contratação similar',
  midia: 'Mídia / sítio especializado',
  fornecedor: 'Cotação de fornecedor',
  nota_fiscal: 'Nota fiscal eletrônica',
};

const STATUS: Record<string, string> = { valido: 'Válido', inexequivel: 'Inexequível', excessivo: 'Excessivo', desatualizado: 'Desatualizado' };

type Row = { description: string; unit: string; quantity: string; catalogCode: string };

export function PricesTab({ process, me, update, run }: TabProps) {
  const [report, setReport] = useState<PriceReport | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [showText, setShowText] = useState(false);
  const canEdit = me.roles.some((r) => r === 'planejamento' || r === 'agente') && process.phase === 'planejamento';

  const loadReport = useCallback(() => api.priceReport(process.id).then(setReport), [process.id]);
  useEffect(() => {
    loadReport().catch(() => undefined);
  }, [loadReport, process]);
  useEffect(() => {
    setRows(process.prices.items.map((i) => ({ description: i.description, unit: i.unit, quantity: String(i.quantity), catalogCode: i.catalogCode ?? '' })));
  }, [process.prices.items]);

  const saveItems = () =>
    run(
      () =>
        api.setItems(
          process.id,
          rows.filter((r) => r.description.trim()).map((r) => ({ description: r.description, unit: r.unit || 'un', quantity: Number(r.quantity.replace(',', '.')), catalogCode: r.catalogCode || undefined })),
        ),
      'Itens salvos',
    ).then((p) => p && update(p));

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Itens e pesquisa de preços</h2>
            <p className="small muted">
              Art. 23 da Lei 14.133/2021 e IN SEGES/ME 65/2021: no mínimo 3 preços válidos por item; descartes automáticos de preços inexequíveis (&lt;
              {Math.round(process.prices.criteria.lowFactor * 100)}% da mediana), excessivos (&gt;{Math.round(process.prices.criteria.highFactor * 100)}%) e desatualizados.
            </p>
          </div>
          {canEdit && process.prices.items.length > 0 && (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                run(
                  () => api.autoPrices(process.id),
                  (r) => (r.errors.length ? `${r.imported} preço(s) importado(s); ${r.errors.length} falha(s)` : `${r.imported} preço(s) importado(s) do Painel de Preços`),
                ).then((r) => r && update(r.process))
              }
            >
              Pesquisar automaticamente
            </button>
          )}
        </div>

        {canEdit && (
          <div className="items-editor">
            <div className="items-grid head small muted">
              <span>Descrição</span>
              <span>Unidade</span>
              <span>Quantidade</span>
              <span>CATMAT/CATSER</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="items-grid">
                {(['description', 'unit', 'quantity', 'catalogCode'] as const).map((k) => (
                  <input
                    key={k}
                    aria-label={k}
                    value={r[k]}
                    inputMode={k === 'quantity' ? 'decimal' : undefined}
                    onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                  />
                ))}
                <button type="button" className="btn small" aria-label="Remover item" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <div className="row gap">
              <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, { description: '', unit: 'un', quantity: '1', catalogCode: '' }])}>
                + Item
              </button>
              <button type="button" className="btn primary" onClick={saveItems}>
                Salvar itens
              </button>
            </div>
          </div>
        )}
      </section>

      {report?.items.map((a) => (
        <section className="card" key={a.item.id}>
          <div className="card-head">
            <div>
              <h3>{a.item.description}</h3>
              <p className="small muted">
                {a.item.quantity} {a.item.unit} · {a.valid} preço(s) válido(s)
              </p>
            </div>
            <div className="estimate">
              <div className="small muted">Unitário ({a.method === 'media' ? 'média' : a.method === 'mediana' ? 'mediana' : '—'})</div>
              <strong>{money(a.estimatedUnitCents)}</strong>
              <div className="small">Total {money(a.estimatedTotalCents)}</div>
            </div>
          </div>
          <div className="stats small">
            <span>Média {money(a.meanCents)}</span>
            <span>Mediana {money(a.medianCents)}</span>
            <span>Menor {money(a.minCents)}</span>
            <span>CV {a.cv === null ? '—' : `${(a.cv * 100).toFixed(1).replace('.', ',')}%`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fonte</th>
                  <th>Fornecedor / órgão</th>
                  <th>Data</th>
                  <th className="num">Preço</th>
                  <th>Situação</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {a.samples.map((s) => (
                  <tr key={s.id} className={s.status !== 'valido' ? 'discarded' : ''}>
                    <td>{SOURCES[s.source]}</td>
                    <td>
                      {s.supplier}
                      {s.reference && <div className="small muted">{s.reference}</div>}
                    </td>
                    <td>{date(s.date)}</td>
                    <td className="num">{money(s.unitPriceCents)}</td>
                    <td>
                      <span className={`pill price-${s.status}`} title={s.reason}>
                        {STATUS[s.status]}
                      </span>
                    </td>
                    {canEdit && (
                      <td>
                        <button type="button" className="btn small" aria-label="Remover preço" onClick={() => run(() => api.removeSample(process.id, a.item.id, s.id)).then((p) => p && update(p))}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.warnings.map((w) => (
            <p key={w} className="callout warn small">
              {w}
            </p>
          ))}
          {canEdit && <SampleForm onAdd={(s) => run(() => api.addSample(process.id, a.item.id, s), 'Preço incluído').then((p) => p && update(p))} />}
        </section>
      ))}

      {report && report.items.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Valor estimado: {money(report.totalCents)}</h2>
            <div className="row gap">
              <button type="button" className="btn" onClick={() => setShowText((v) => !v)}>
                {showText ? 'Ocultar relatório' : 'Relatório para o processo'}
              </button>
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(report.text)}>
                Copiar
              </button>
            </div>
          </div>
          {!report.complete && <p className="callout warn small">Há itens com menos de 3 preços válidos: amplie a pesquisa ou junte a justificativa da autoridade competente.</p>}
          {showText && <pre className="doc-preview">{report.text}</pre>}
        </section>
      )}
    </div>
  );
}

function SampleForm({ onAdd }: { onAdd: (s: { source: PriceSource; supplier: string; unitPriceCents: number; date: string; reference?: string }) => void }) {
  const [f, setF] = useState({ source: 'fornecedor' as PriceSource, supplier: '', price: '', date: new Date().toISOString().slice(0, 10), reference: '' });
  return (
    <form
      className="sample-form"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ source: f.source, supplier: f.supplier, unitPriceCents: parseMoney(f.price), date: f.date, reference: f.reference || undefined });
        setF((x) => ({ ...x, supplier: '', price: '', reference: '' }));
      }}
    >
      <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as PriceSource })} aria-label="Fonte">
        {Object.entries(SOURCES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input placeholder="Fornecedor / órgão" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} required />
      <input placeholder="Preço unitário (R$)" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />
      <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required aria-label="Data" />
      <input placeholder="Referência (opcional)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      <button type="submit" className="btn">
        + Preço
      </button>
    </form>
  );
}
