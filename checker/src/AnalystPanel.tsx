import { useEffect, useState } from 'react';
import { editFor, type AnalystResult, type Proposal } from './analyst';

export interface AiState {
  status: 'idle' | 'running' | 'done' | 'error';
  result?: AnalystResult;
  /** Linhas do documento como estavam na análise (para localizar as propostas). */
  snapshot?: string[];
  analyzedText?: string;
  truncatedDoc?: boolean;
  error?: string;
  startedAt?: number;
  /** Propostas já redigidas enquanto a resposta chega. */
  streamed?: number;
  applied: string[];
}

export const IDLE: AiState = { status: 'idle', applied: [] };

const CONCLUSION: Record<AnalystResult['conclusao'], { label: string; tone: string }> = {
  apto: { label: 'Apto para o parecer jurídico', tone: 'ok' },
  apto_com_ressalvas: { label: 'Apto com ressalvas', tone: 'mid' },
  nao_apto: { label: 'Não apto: precisa de ajustes', tone: 'bad' },
};

const ACTION: Record<Proposal['acao'], string> = {
  substituir_trecho: 'Substitui um trecho da linha',
  substituir_linha: 'Substitui a linha',
  inserir_depois: 'Entra depois da linha',
  inserir_antes: 'Entra antes da linha',
};

const SEV_LABEL = { bloqueante: 'Bloqueante', alerta: 'Alerta', sugestao: 'Sugestão' } as const;

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export function AnalystPanel(props: {
  available: boolean | undefined;
  state: AiState;
  text: string;
  docName: string;
  onRun: (refresh: boolean) => void;
  onStop: () => void;
  onApply: (ids: string[]) => void;
  onCopy: (text: string) => void;
}) {
  const { available, state, text } = props;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (state.status !== 'running') return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [state.status]);

  if (available === false) {
    return (
      <div className="analyst muted-box">
        <h3>Analista jurídica (IA)</h3>
        <p className="hint">A análise com IA funciona quando esta página é aberta no Claude. A verificação automática abaixo continua disponível.</p>
      </div>
    );
  }

  if (state.status === 'idle' || state.status === 'error') {
    return (
      <div className="analyst">
        <div className="analyst-head">
          <h3>Analista jurídica (IA)</h3>
          <span className="tag">Claude</span>
        </div>
        <p>
          Lê o {props.docName} inteiro como a assessoria jurídica faria antes do parecer: confere o conteúdo de cada elemento exigido, avalia o mérito e redige cada
          correção já no ponto certo do texto.
        </p>
        <p className="hint">Usa a sua conta do Claude (na primeira vez, o Claude pede autorização). Leva de 1 a 3 minutos.</p>
        {state.status === 'error' && <p className="analyst-error">{state.error}</p>}
        <button type="button" className="btn primary" disabled={available === undefined || !text.trim()} onClick={() => props.onRun(state.status === 'error')}>
          {state.status === 'error' ? 'Tentar de novo' : 'Pedir análise jurídica'}
        </button>
      </div>
    );
  }

  if (state.status === 'running') {
    return (
      <div className="analyst running" aria-busy="true">
        <div className="analyst-head">
          <h3>Analista jurídica (IA)</h3>
          <span className="elapsed">{clock(Date.now() - (state.startedAt ?? Date.now()))}</span>
        </div>
        <div className="progress" aria-hidden>
          <span />
        </div>
        <p>{state.streamed ? `Redigindo a análise: ${state.streamed} proposta${state.streamed > 1 ? 's' : ''} até agora…` : 'Lendo o documento e conferindo cada elemento exigido…'}</p>
        <button type="button" className="btn small" onClick={props.onStop}>
          Parar
        </button>
      </div>
    );
  }

  const r = state.result!;
  const snapshot = state.snapshot ?? [];
  const pending = r.propostas.filter((p) => !state.applied.includes(p.id) && editFor(text, snapshot, p));
  const changed = state.analyzedText !== undefined && state.analyzedText !== text;
  const c = CONCLUSION[r.conclusao];

  return (
    <div className="analyst done">
      <div className="analyst-head">
        <h3>Analista jurídica (IA)</h3>
        <span className={`conclusion ${c.tone}`}>{c.label}</span>
      </div>
      {r.resumo && <p className="parecer">{r.resumo}</p>}
      {state.truncatedDoc && <p className="hint">O documento é longo: as linhas finais não couberam na análise.</p>}
      {changed && (
        <p className="hint">
          O texto mudou desde a análise. As propostas continuam aplicáveis enquanto a linha de referência existir.{' '}
          <button type="button" className="link" onClick={() => props.onRun(true)}>
            Refazer análise
          </button>
        </p>
      )}

      {r.pontos_fortes.length > 0 && (
        <details>
          <summary>O que o documento já faz bem ({r.pontos_fortes.length})</summary>
          <ul className="plain-list">
            {r.pontos_fortes.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}

      {r.falsos_positivos.length > 0 && (
        <details>
          <summary>Apontamentos automáticos que a analista considera atendidos ({r.falsos_positivos.length})</summary>
          <ul className="plain-list">
            {r.falsos_positivos.map((f) => (
              <li key={f.id}>{f.motivo}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="proposals-head">
        <h4>Correções propostas ({r.propostas.length})</h4>
        {pending.length > 1 && (
          <button type="button" className="btn small apply" onClick={() => props.onApply(pending.map((p) => p.id))}>
            Aplicar todas as pendentes ({pending.length})
          </button>
        )}
      </div>
      {r.propostas.length === 0 && <p className="hint">Nenhuma correção proposta.</p>}
      <ol className="proposals">
        {r.propostas.map((p) => {
          const applied = state.applied.includes(p.id);
          const locatable = applied || !!editFor(text, snapshot, p);
          const ref = snapshot[p.linha - 1] ?? '';
          return (
            <li key={p.id} className={`proposal ${p.gravidade} ${applied ? 'applied' : ''}`}>
              <div className="finding-top">
                <span className={`sev ${p.gravidade}`}>{SEV_LABEL[p.gravidade]}</span>
                {p.fundamento && <span className="basis">{p.fundamento}</span>}
              </div>
              <p className="proposal-title">{p.titulo}</p>
              {p.analise && <p className="analysis">{p.analise}</p>}
              <p className="where">
                <strong>{ACTION[p.acao]}</strong> {ref.trim() ? `“${short(ref.trim())}”` : ''}
              </p>
              {p.acao === 'substituir_trecho' && p.trecho && (
                <p className="old">
                  <span>Sai:</span> <del>{short(p.trecho, 240)}</del>
                </p>
              )}
              <div className="new-text">
                <span>{p.acao.startsWith('substituir') ? 'Entra:' : 'Texto proposto:'}</span>
                <p>{p.texto}</p>
              </div>
              <div className="finding-actions">
                {applied ? (
                  <span className="applied-tag">✓ Aplicada</span>
                ) : locatable ? (
                  <button type="button" className="btn small apply" onClick={() => props.onApply([p.id])}>
                    Aplicar no texto
                  </button>
                ) : (
                  <span className="hint">O trecho de referência mudou. Refaça a análise para reposicionar.</span>
                )}
                <button type="button" className="btn small" onClick={() => props.onCopy(p.texto)}>
                  Copiar texto
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="hint">Revise cada texto antes de aplicar e preencha os campos entre colchetes. A análise da IA apoia, mas não substitui o parecer jurídico.</p>
    </div>
  );
}
