import { useState } from 'react';
import { api, type Bid, type CertificateType, type Risk } from '../lib/api';
import { money, parseMoney } from '../lib/format';
import type { TabProps } from './ProcessView';

const LEVEL: Record<Risk['level'], string> = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto', critico: 'Crítico' };
const BID_STATUS: Record<Bid['status'], string> = { classificada: 'Classificada', habilitada: 'Habilitada', inabilitada: 'Inabilitada', vencedora: 'Vencedora' };
const GROUP: Record<string, string> = { juridica: 'Jurídica', fiscal: 'Fiscal e trabalhista', economica: 'Econômico-financeira', tecnica: 'Técnica', sancoes: 'Sanções', proposta: 'Proposta' };
const CERTS: CertificateType[] = ['cnd_federal', 'fgts', 'cndt', 'estadual', 'municipal', 'falencia'];

export function ExternalTab({ process, me, update, run }: TabProps) {
  const [basis, setBasis] = useState<string | null>(null);
  const [showEdital, setShowEdital] = useState(false);
  const isAgent = me.roles.includes('agente');
  const canRisk = me.roles.some((r) => r === 'agente' || r === 'planejamento') && process.phase !== 'contrato';

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Matriz de riscos</h2>
            <p className="small muted">{basis ?? 'Art. 22: obrigatória em contratações de grande vulto e nos regimes integrado/semi-integrado; recomendada nas demais.'}</p>
          </div>
          {canRisk && (
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                run(() => api.suggestRisks(process.id), (r) => `${r.process.risks.length} risco(s) mapeado(s)`).then((r) => {
                  if (!r) return;
                  setBasis(r.basis);
                  update(r.process);
                })
              }
            >
              {process.risks.length ? 'Remapear riscos' : 'Mapear riscos'}
            </button>
          )}
        </div>
        {process.risks.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Risco</th>
                  <th>Prob.</th>
                  <th>Impacto</th>
                  <th>Nível</th>
                  <th>Alocação</th>
                  <th>Mitigação e cláusula sugerida</th>
                </tr>
              </thead>
              <tbody>
                {process.risks.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <div className="small muted">{r.description}</div>
                    </td>
                    {(['probability', 'impact'] as const).map((k) => (
                      <td key={k}>
                        <select
                          value={r[k]}
                          disabled={!canRisk}
                          aria-label={k}
                          onChange={(e) => run(() => api.updateRisk(process.id, r.id, { [k]: Number(e.target.value) })).then((p) => p && update(p))}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <span className={`pill risk-${r.level}`}>{LEVEL[r.level]}</span>
                    </td>
                    <td>
                      <select
                        value={r.allocation}
                        disabled={!canRisk}
                        aria-label="Alocação"
                        onChange={(e) => run(() => api.updateRisk(process.id, r.id, { allocation: e.target.value as Risk['allocation'] })).then((p) => p && update(p))}
                      >
                        <option value="contratante">Contratante</option>
                        <option value="contratado">Contratado</option>
                        <option value="compartilhado">Compartilhado</option>
                      </select>
                    </td>
                    <td className="small">
                      {r.mitigation}
                      <details>
                        <summary>Cláusula</summary>
                        {r.clause}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Minuta do edital</h2>
            <p className="small muted">Montada a partir do TR aprovado, da pesquisa de preços e da matriz de riscos.</p>
          </div>
          {isAgent && process.phase !== 'contrato' && (
            <button type="button" className="btn primary" onClick={() => run(() => api.edital(process.id), 'Minuta do edital gerada').then((p) => p && (update(p), setShowEdital(true)))}>
              {process.edital ? 'Regerar minuta' : 'Gerar minuta do edital'}
            </button>
          )}
        </div>
        {process.edital ? (
          <>
            <ul className="checklist">
              {process.edital.checklist.map((c) => (
                <li key={c.item} className={c.ok ? 'ok' : 'pending'}>
                  <span aria-hidden>{c.ok ? '✓' : '○'}</span> {c.item} <span className="muted small">({c.basis})</span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn" onClick={() => setShowEdital((v) => !v)}>
              {showEdital ? 'Ocultar minuta' : 'Ver minuta'}
            </button>
            {showEdital && <pre className="doc-preview">{process.edital.text}</pre>}
          </>
        ) : (
          <p className="muted small">Requer ETP e TR aprovados pelo jurídico e valor estimado pela pesquisa de preços.</p>
        )}
      </section>

      {process.phase !== 'planejamento' && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Propostas e habilitação</h2>
              <p className="small muted">Certidões, índices contábeis (LG, SG, LC), atestados e consulta automática ao CEIS, CNEP e inidôneos do TCU.</p>
            </div>
          </div>
          {process.bids.length === 0 && <p className="muted">Nenhuma proposta registrada.</p>}
          <ol className="bids">
            {process.bids.map((b) => (
              <li key={b.id} className={`bid state-${b.status}`}>
                <div className="row between wrap gap">
                  <div>
                    <strong>{b.supplierName}</strong> <span className="muted small">CNPJ {b.cnpj}</span>
                    <div>
                      {money(b.totalCents)}
                      {process.estimatedCents && <span className="small muted"> · {((b.totalCents / process.estimatedCents - 1) * 100).toFixed(1).replace('.', ',')}% vs. estimado</span>}
                    </div>
                  </div>
                  <div className="row gap">
                    <span className={`pill bid-${b.status}`}>{BID_STATUS[b.status]}</span>
                    {isAgent && process.phase === 'externa' && (
                      <>
                        <button type="button" className="btn small" onClick={() => run(() => api.qualify(process.id, b.id), 'Habilitação analisada').then((p) => p && update(p))}>
                          {b.qualification ? 'Reanalisar' : 'Analisar habilitação'}
                        </button>
                        {b.status === 'habilitada' && (
                          <button type="button" className="btn small approve" onClick={() => run(() => api.award(process.id, b.id), 'Objeto adjudicado').then((p) => p && update(p))}>
                            Adjudicar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {b.qualification && (
                  <ul className="checks">
                    {b.qualification.checks.map((c) => (
                      <li key={c.id} className={`check-${c.status}`}>
                        <span aria-hidden>{c.status === 'ok' ? '✓' : c.status === 'atencao' ? '!' : '✕'}</span>
                        <div>
                          <strong>{c.label}</strong> <span className="small muted">· {GROUP[c.group]} · {c.basis}</span>
                          <div className="small">{c.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {isAgent && process.phase === 'externa' && <BidForm process={process} onAdd={(body) => run(() => api.addBid(process.id, body), 'Proposta registrada').then((p) => p && update(p))} />}
        </section>
      )}
    </div>
  );
}

function BidForm({ process, onAdd }: { process: TabProps['process']; onAdd: (body: Parameters<typeof api.addBid>[1]) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ supplierName: '', cnpj: '', certValid: '', atestados: '1', ac: '', rlp: '', at: '', pc: '', pnc: '', pl: '' });
  const [prices, setPrices] = useState<Record<string, string>>({});
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + Registrar proposta
      </button>
    );
  const field = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      {label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const hasBalance = f.ac && f.at && f.pc;
        onAdd({
          supplierName: f.supplierName,
          cnpj: f.cnpj,
          items: process.prices.items.map((i) => ({ itemId: i.id, unitPriceCents: parseMoney(prices[i.id] ?? '0') })),
          certificates: f.certValid ? CERTS.map((type) => ({ type, validUntil: f.certValid })) : [],
          balance: hasBalance
            ? {
                year: new Date().getFullYear() - 1,
                currentAssetsCents: parseMoney(f.ac),
                longTermAssetsCents: parseMoney(f.rlp || '0'),
                totalAssetsCents: parseMoney(f.at),
                currentLiabilitiesCents: parseMoney(f.pc),
                longTermLiabilitiesCents: parseMoney(f.pnc || '0'),
                equityCents: parseMoney(f.pl || '0'),
              }
            : undefined,
          technicalCertificates: Number(f.atestados) || 0,
        });
        setOpen(false);
      }}
    >
      <div className="row gap wrap">
        {field('supplierName', 'Licitante', { required: true })}
        {field('cnpj', 'CNPJ', { required: true, placeholder: '00.000.000/0000-00' })}
        {field('certValid', 'Certidões válidas até', { type: 'date' })}
        {field('atestados', 'Atestados técnicos', { inputMode: 'numeric' })}
      </div>
      <fieldset>
        <legend className="small">Preços unitários ofertados</legend>
        {process.prices.items.map((i) => (
          <label key={i.id} className="inline">
            <span>{i.description}</span>
            <input inputMode="decimal" placeholder="R$" value={prices[i.id] ?? ''} onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })} required />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="small">Balanço do último exercício (R$)</legend>
        <div className="row gap wrap">
          {field('ac', 'Ativo circulante')}
          {field('rlp', 'Realizável a LP')}
          {field('at', 'Ativo total')}
          {field('pc', 'Passivo circulante')}
          {field('pnc', 'Passivo não circulante')}
          {field('pl', 'Patrimônio líquido')}
        </div>
      </fieldset>
      <div className="row gap">
        <button type="submit" className="btn primary">
          Registrar
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
