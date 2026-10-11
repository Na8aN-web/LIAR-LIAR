'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminFetch, setSignedOutHandler } from './api';
import { ConfirmProvider, FiltersProvider, daysAgo, today, type Filters } from './ui';
import { LivePage } from './pages/Live';
import { GrowthPage } from './pages/Growth';
import { SourcesPage } from './pages/Sources';
import { FunnelPage } from './pages/Funnel';
import { BalancePage } from './pages/Balance';
import { FeedbackPage } from './pages/Feedback';
import { SafetyPage } from './pages/Safety';
import { BillboardsPage } from './pages/Billboards';
import { ControlsPage } from './pages/Controls';
import { AuditPage } from './pages/Audit';

const PAGES = [
  { id: 'live', label: 'Live', title: 'Live', Page: LivePage, filters: false },
  { id: 'growth', label: 'Growth', title: 'Growth', Page: GrowthPage, filters: true },
  { id: 'sources', label: 'Sources', title: 'Sources', Page: SourcesPage, filters: true },
  { id: 'funnel', label: 'Funnel', title: 'Funnel', Page: FunnelPage, filters: true },
  { id: 'balance', label: 'Balance', title: 'Balance', Page: BalancePage, filters: true },
  { id: 'feedback', label: 'Feedback', title: 'Feedback', Page: FeedbackPage, filters: true },
  { id: 'safety', label: 'Safety', title: 'Safety', Page: SafetyPage, filters: true },
  { id: 'billboards', label: 'Billboards', title: 'Billboards', Page: BillboardsPage, filters: true },
  { id: 'controls', label: 'Controls', title: 'Controls', Page: ControlsPage, filters: false },
  { id: 'log', label: 'Admin log', title: 'Admin log', Page: AuditPage, filters: false },
] as const;
type PageId = (typeof PAGES)[number]['id'];

interface Session {
  configured: boolean;
  signedIn: boolean;
  access: boolean;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminFetch('/login', { body: { password, code: code.replace(/\s/g, '') } });
      setPassword('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="adm-login" onSubmit={submit}>
      <p className="adm-login-tag">Sheriff’s office</p>
      <h1>Wanted: True Colors</h1>
      <p className="adm-note">Staff only. Every sign-in attempt is logged.</p>
      <label className="adm-field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </label>
      <label className="adm-field">
        <span>Code from your authenticator app</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
          required
        />
      </label>
      {error && <p className="adm-error">{error}</p>}
      <button className="adm-btn primary wide" disabled={busy || !password || code.replace(/\s/g, '').length !== 6}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}

const FILTER_KEY = 'wtc:admin-filters';
function initialFilters(): Filters {
  const base = { from: daysAgo(29), to: today(), seed: true };
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
    if (saved && typeof saved.seed === 'boolean') return { ...base, seed: saved.seed, ...(saved.days ? { from: daysAgo(saved.days - 1) } : {}) };
  } catch {}
  return base;
}

function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const preset = (days: number) => {
    setFilters({ ...filters, from: daysAgo(days - 1), to: today() });
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({ seed: filters.seed, days }));
    } catch {}
  };
  const span = Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / 86_400_000) + 1;
  return (
    <div className="adm-filterbar">
      <div className="adm-seg" role="group" aria-label="Period">
        {[7, 30, 90].map((d) => (
          <button key={d} className={span === d && filters.to === today() ? 'on' : ''} onClick={() => preset(d)}>
            {d} days
          </button>
        ))}
      </div>
      <label className="adm-date">
        <span className="sr-only">From</span>
        <input type="date" value={filters.from} max={filters.to} onChange={(e) => e.target.value && setFilters({ ...filters, from: e.target.value })} />
      </label>
      <span className="muted">to</span>
      <label className="adm-date">
        <span className="sr-only">To</span>
        <input type="date" value={filters.to} min={filters.from} max={today()} onChange={(e) => e.target.value && setFilters({ ...filters, to: e.target.value })} />
      </label>
      <label className="adm-check" title="Bot games and imported playtest files from pnpm admin:seed">
        <input
          type="checkbox"
          checked={filters.seed}
          onChange={(e) => {
            setFilters({ ...filters, seed: e.target.checked });
            try {
              localStorage.setItem(FILTER_KEY, JSON.stringify({ seed: e.target.checked, days: span }));
            } catch {}
          }}
        />
        Seed data
      </label>
    </div>
  );
}

export function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [fatal, setFatal] = useState('');
  const [page, setPage] = useState<PageId>('live');
  const [filters, setFilters] = useState<Filters>({ from: daysAgo(29), to: today(), seed: true });
  const [menu, setMenu] = useState(false);

  const check = useCallback(async () => {
    try {
      setSession(await adminFetch<Session>('/session'));
      setFatal('');
    } catch (e) {
      setFatal(e instanceof AdminError && e.status === 403 ? 'Access denied. Sign in through Cloudflare Access first.' : e instanceof Error ? e.message : 'Failed');
    }
  }, []);

  useEffect(() => {
    setFilters(initialFilters());
    void check();
    setSignedOutHandler(() => setSession((s) => (s ? { ...s, signedIn: false } : s)));
    const fromHash = () => {
      const id = location.hash.slice(1) as PageId;
      if (PAGES.some((p) => p.id === id)) setPage(id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => {
      setSignedOutHandler(null);
      window.removeEventListener('hashchange', fromHash);
    };
  }, [check]);

  const signOut = async () => {
    await adminFetch('/logout', { body: {} }).catch(() => {});
    void check();
  };

  if (fatal) return <div className="adm-center"><p className="adm-error">{fatal}</p></div>;
  if (!session) return <div className="adm-center"><p className="adm-loading">Loading…</p></div>;
  if (!session.configured)
    return (
      <div className="adm-center">
        <div className="adm-login">
          <h1>Admin isn’t set up</h1>
          <p>
            On the server, run <code>pnpm admin:setup</code> to choose a password and link an authenticator app, then restart the server.
          </p>
        </div>
      </div>
    );
  if (!session.signedIn)
    return (
      <div className="adm-center">
        <Login onDone={check} />
      </div>
    );

  const current = PAGES.find((p) => p.id === page)!;
  const Page = current.Page;
  return (
    <FiltersProvider value={{ filters, setFilters }}>
      <ConfirmProvider>
        <div className="adm-shell">
          <aside className={`adm-side${menu ? ' open' : ''}`}>
            <div className="adm-brand">
              <span className="adm-brand-star" aria-hidden>
                ★
              </span>
              <div>
                <b>Sheriff’s office</b>
                <small>Wanted: True Colors</small>
              </div>
            </div>
            <nav aria-label="Dashboard pages">
              {PAGES.map((p) => (
                <a key={p.id} href={`#${p.id}`} className={p.id === page ? 'on' : ''} aria-current={p.id === page ? 'page' : undefined} onClick={() => setMenu(false)}>
                  {p.label}
                </a>
              ))}
            </nav>
            <button className="adm-btn ghost small adm-signout" onClick={signOut}>
              Sign out
            </button>
          </aside>
          <main className="adm-main">
            <header className="adm-top">
              <button className="adm-menu-btn" aria-label="Pages" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                ☰
              </button>
              <h2>{current.title}</h2>
              {current.filters && <FilterBar filters={filters} setFilters={setFilters} />}
            </header>
            <div className="adm-page">
              <Page />
            </div>
          </main>
        </div>
      </ConfirmProvider>
    </FiltersProvider>
  );
}
