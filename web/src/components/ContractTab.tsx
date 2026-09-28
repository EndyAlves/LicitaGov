import { useState } from 'react';
import { api, type Occurrence } from '../lib/api';
import { date, dateTime, money, parseMoney } from '../lib/format';
import type { TabProps } from './ProcessView';

const KIND: Record<Occurrence['kind'], string> = { entrega: 'Entrega', atraso: 'Atraso', nao_conformidade: 'Não conformidade', observacao: 'Observação' };

/** Reduz a foto da câmera antes do envio (fotos de celular passam fácil de 5 MB). */
async function shrink(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

export function ContractTab({ process, me, users, update, run, notify }: TabProps) {
  const c = process.contract;
  const [fiscalId, setFiscalId] = useState(users.find((u) => u.roles.includes('fiscal'))?.id ?? '');
  const [months, setMonths] = useState('12');
  const [showText, setShowText] = useState(false);
  const winner = process.bids.find((b) => b.status === 'vencedora');
  const canCreate = me.roles.some((r) => r === 'gestor' || r === 'agente');

  if (!c) {
    return (
      <section className="card">
        <h2>{process.features.priceRegistration ? 'Ata de registro de preços' : 'Termo de contrato'}</h2>
        {winner ? (
          <>
            <p>
              Proposta vencedora: <strong>{winner.supplierName}</strong> — {money(winner.totalCents)}
            </p>
            {canCreate ? (
              <div className="row gap wrap">
                <label>
                  Fiscal designado
                  <select value={fiscalId} onChange={(e) => setFiscalId(e.target.value)}>
                    {users.filter((u) => u.roles.includes('fiscal')).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Vigência (meses)
                  <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
                </label>
                <button type="button" className="btn primary" onClick={() => run(() => api.contract(process.id, fiscalId, Number(months) || 12), 'Instrumento gerado').then((p) => p && update(p))}>
                  Gerar {process.features.priceRegistration ? 'ata' : 'contrato'}
                </button>
              </div>
            ) : (
              <p className="muted">Aguardando o gestor gerar o instrumento.</p>
            )}
          </>
        ) : (
          <p className="muted">Adjudique uma proposta habilitada na aba de habilitação.</p>
        )}
      </section>
    );
  }

  const isFiscal = c.fiscalId === me.id;
  const glosaTotal = c.receipts.reduce((a, r) => a + r.glosaCents, 0);
  const paid = c.receipts.filter((r) => r.type === 'definitivo').reduce((a, r) => a + r.payableCents, 0);

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              {c.kind === 'ata' ? 'Ata' : 'Contrato'} nº {c.number}
            </h2>
            <p className="small muted">
              {c.supplierName} · CNPJ {c.cnpj} · vigência {date(c.signedAt)} a {date(c.validUntil)} · fiscal {users.find((u) => u.id === c.fiscalId)?.name}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setShowText((v) => !v)}>
            {showText ? 'Ocultar instrumento' : 'Ver instrumento'}
          </button>
        </div>
        <div className="stats">
          <span>Valor {money(c.totalCents)}</span>
          <span>Liberado (definitivo) {money(paid)}</span>
          <span>Glosas {money(glosaTotal)}</span>
          <span>Ocorrências {c.occurrences.length}</span>
        </div>
        {showText && <pre className="doc-preview">{c.text}</pre>}
      </section>

      {isFiscal && <OccurrenceForm onSubmit={(o) => run(() => api.occurrence(process.id, o), 'Ocorrência registrada').then((p) => p && update(p))} notify={notify} />}

      <section className="card">
        <h2>Ocorrências</h2>
        {c.occurrences.length === 0 && <p className="muted">Nenhuma ocorrência registrada.</p>}
        <ul className="occurrences">
          {[...c.occurrences].reverse().map((o) => (
            <li key={o.id}>
              <div className="row between wrap">
                <strong>{KIND[o.kind]}</strong>
                <span className="small muted">
                  {dateTime(o.at)}
                  {o.glosaPercent > 0 && ` · glosa ${o.glosaPercent}%`}
                </span>
              </div>
              <p>{o.description}</p>
              {o.location && (
                <a className="small" href={`https://www.openstreetmap.org/?mlat=${o.location.lat}&mlon=${o.location.lng}#map=18/${o.location.lat}/${o.location.lng}`} target="_blank" rel="noreferrer">
                  📍 {o.location.lat.toFixed(5)}, {o.location.lng.toFixed(5)}
                </a>
              )}
              {o.photos.length > 0 && (
                <div className="photos">
                  {o.photos.map((src, i) => (
                    <img key={i} src={src} alt={`Foto ${i + 1} da ocorrência`} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isFiscal && <ReceiptForm onSubmit={(r) => run(() => api.receipt(process.id, r), 'Termo emitido').then((p) => p && update(p))} />}

      <section className="card">
        <h2>Termos de recebimento</h2>
        {c.receipts.length === 0 && <p className="muted">Nenhum termo emitido.</p>}
        {[...c.receipts].reverse().map((r) => (
          <details key={r.id} className="receipt">
            <summary>
              {r.type === 'provisorio' ? 'Provisório' : 'Definitivo'} · {r.periodLabel} · a pagar {money(r.payableCents)}
              {r.glosaCents > 0 && <span className="muted"> (glosa {money(r.glosaCents)})</span>}
            </summary>
            <pre className="doc-preview">{r.text}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}

function OccurrenceForm({ onSubmit, notify }: { onSubmit: (o: Omit<Occurrence, 'id' | 'at' | 'authorId'>) => Promise<unknown>; notify: TabProps['notify'] }) {
  const [kind, setKind] = useState<Occurrence['kind']>('entrega');
  const [description, setDescription] = useState('');
  const [glosa, setGlosa] = useState('0');
  const [photos, setPhotos] = useState<string[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | undefined>();
  const [busy, setBusy] = useState(false);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      const shrunk = await Promise.all([...files].slice(0, 6 - photos.length).map((f) => shrink(f)));
      setPhotos((p) => [...p, ...shrunk]);
    } catch {
      notify('Não foi possível ler a foto.', 'error');
    }
  }

  function locate() {
    if (!navigator.geolocation) return notify('Geolocalização indisponível neste aparelho.', 'error');
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => notify('Permissão de localização negada.', 'error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <section className="card field-card">
      <h2>Registrar em campo</h2>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSubmit({ kind, description, glosaPercent: Number(glosa.replace(',', '.')) || 0, photos, location });
          setBusy(false);
          setDescription('');
          setGlosa('0');
          setPhotos([]);
          setLocation(undefined);
        }}
      >
        <div className="segmented" role="radiogroup" aria-label="Tipo">
          {(Object.keys(KIND) as Occurrence['kind'][]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {KIND[k]}
            </button>
          ))}
        </div>
        <textarea rows={3} placeholder="O que foi verificado? Local, quantidade, desconformidade…" value={description} onChange={(e) => setDescription(e.target.value)} required />
        <div className="row gap wrap">
          <label className="btn file">
            📷 Foto
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => addPhotos(e.target.files)} hidden />
          </label>
          <button type="button" className="btn" onClick={locate}>
            📍 {location ? 'Localização registrada' : 'Registrar localização'}
          </button>
          <label className="inline">
            Glosa (IMR) %
            <input inputMode="decimal" value={glosa} onChange={(e) => setGlosa(e.target.value)} style={{ width: '5rem' }} />
          </label>
        </div>
        {photos.length > 0 && (
          <div className="photos">
            {photos.map((src, i) => (
              <button key={i} type="button" className="thumb" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remover foto">
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        )}
        <button type="submit" className="btn primary block" disabled={busy}>
          Registrar ocorrência
        </button>
      </form>
    </section>
  );
}

function ReceiptForm({ onSubmit }: { onSubmit: (r: { type: 'provisorio' | 'definitivo'; periodLabel: string; measuredCents: number }) => void }) {
  const [type, setType] = useState<'provisorio' | 'definitivo'>('provisorio');
  const [period, setPeriod] = useState(new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }));
  const [value, setValue] = useState('');
  return (
    <section className="card">
      <h2>Emitir termo de recebimento</h2>
      <p className="small muted">Art. 140: o provisório registra a entrega; o definitivo atesta a conformidade e libera o pagamento, já descontadas as glosas das ocorrências.</p>
      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ type, periodLabel: period, measuredCents: parseMoney(value) });
        }}
      >
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo de termo">
          <option value="provisorio">Provisório</option>
          <option value="definitivo">Definitivo</option>
        </select>
        <input value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período" placeholder="Período" required />
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Valor medido (R$)" required aria-label="Valor medido" />
        <button type="submit" className="btn primary">
          Emitir
        </button>
      </form>
    </section>
  );
}
