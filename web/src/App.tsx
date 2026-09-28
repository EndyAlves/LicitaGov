import { useCallback, useEffect, useState } from 'react';
import { DashboardView } from './components/DashboardView';
import { ProcessView } from './components/ProcessView';
import { api, setApiUser, type Catalog, type User } from './lib/api';
import { initials, ROLE_LABEL } from './lib/format';

const STORAGE_KEY = 'licitagov:user';

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export type Notify = (text: string, tone?: 'ok' | 'error') => void;

export function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [meId, setMeId] = useState<string | null>(stored);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [engine, setEngine] = useState<'regras' | 'claude'>('regras');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const notify: Notify = useCallback((text, tone = 'ok') => setToast({ text, tone }), []);
  const me = users.find((u) => u.id === meId) ?? null;

  useEffect(() => {
    Promise.all([api.users(), api.catalog(), api.health()])
      .then(([list, cat, health]) => {
        setUsers(list);
        setCatalog(cat);
        setEngine(health.adjuster);
        setMeId((cur) => (cur && list.some((u) => u.id === cur) ? cur : list[0]?.id ?? null));
      })
      .catch((e) => notify(e.message, 'error'));
  }, [notify]);

  useEffect(() => {
    setApiUser(meId);
    if (!meId) return;
    try {
      localStorage.setItem(STORAGE_KEY, meId);
    } catch {
      /* armazenamento indisponível: a escolha só não persiste */
    }
  }, [meId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => setOpenId(null)}>
          <span className="logo">§</span>
          <span>
            LicitaGov <small>co-piloto de compras públicas · Lei 14.133/2021</small>
          </span>
        </button>
        {me && (
          <label className="who">
            <span className="avatar">{initials(me.name)}</span>
            <select value={me.id} onChange={(e) => setMeId(e.target.value)} aria-label="Servidor">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.roles.map((r) => ROLE_LABEL[r]).join(', ')}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <main key={meId ?? ''}>
        {me && catalog && (openId ? (
          <ProcessView id={openId} me={me} users={users} catalog={catalog} engine={engine} notify={notify} onBack={() => setOpenId(null)} />
        ) : (
          <DashboardView me={me} catalog={catalog} notify={notify} onOpen={setOpenId} />
        ))}
      </main>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
