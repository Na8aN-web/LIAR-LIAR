'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

// Building blocks for the admin pages: cards, stat tiles, tables, the confirm dialog and the
// shared filters (date range, seed data).

export function Card({ title, note, children, wide, actions }: { title?: string; note?: ReactNode; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <section className={`adm-card${wide ? ' wide' : ''}`}>
      {(title || actions) && (
        <header className="adm-card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="adm-card-actions">{actions}</div>}
        </header>
      )}
      {note && <p className="adm-note">{note}</p>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`adm-stat${tone ? ` ${tone}` : ''}`}>
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {sub && <span className="adm-stat-sub">{sub}</span>}
    </div>
  );
}

export const Stats = ({ children }: { children: ReactNode }) => <div className="adm-stats">{children}</div>;
export const Grid = ({ children }: { children: ReactNode }) => <div className="adm-grid">{children}</div>;

export function Empty({ children }: { children: ReactNode }) {
  return <p className="adm-empty">{children}</p>;
}

export function Status({ error, loading }: { error?: string; loading?: boolean }) {
  if (error) return <p className="adm-error">{error}</p>;
  if (loading) return <p className="adm-loading">Loading…</p>;
  return null;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'muted' }) {
  return <span className={`adm-badge${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** Anonymous player id, shortened, with the full id on hover. */
export const Anon = ({ id }: { id: string | null | undefined }) => (id ? <code className="adm-anon" title={id}>{id.slice(0, 8)}…</code> : <span className="muted">–</span>);

// ---------------------------------------------------------------- confirm

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  /** Ask for a short text (e.g. a reason); passed to run. */
  input?: { label: string; placeholder?: string; required?: boolean; max?: number; initial?: string };
  run: (text: string) => Promise<ReactNode | void>;
}

const ConfirmCtx = createContext<(r: ConfirmRequest) => void>(() => {});
export const useConfirm = () => useContext(ConfirmCtx);

/** Every admin action goes through this: what will happen, then Confirm. The server logs it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: ReactNode } | null>(null);
  const open = (r: ConfirmRequest) => {
    setReq(r);
    setText(r.input?.initial ?? '');
    setResult(null);
  };
  const close = () => !busy && setReq(null);
  const go = async () => {
    if (!req) return;
    setBusy(true);
    try {
      const msg = await req.run(text.trim());
      setResult({ ok: true, msg: msg ?? 'Done.' });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmCtx.Provider value={open}>
      {children}
      {req && (
        <div className="adm-modal-backdrop" onClick={close}>
          <div className="adm-modal" role="dialog" aria-modal="true" aria-label={req.title} onClick={(e) => e.stopPropagation()}>
            <h3>{req.title}</h3>
            <div className="adm-modal-body">{req.body}</div>
            {req.input && !result?.ok && (
              <label className="adm-field">
                <span>{req.input.label}</span>
                <input value={text} maxLength={req.input.max ?? 200} placeholder={req.input.placeholder} autoFocus onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            {result && <p className={result.ok ? 'adm-ok' : 'adm-error'}>{result.msg}</p>}
            <div className="adm-modal-actions">
              {result?.ok ? (
                <button className="adm-btn" onClick={() => setReq(null)}>
                  Close
                </button>
              ) : (
                <>
                  <button className="adm-btn ghost" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button className={`adm-btn ${req.danger ? 'danger' : 'primary'}`} onClick={go} disabled={busy || (!!req.input?.required && !text.trim())}>
                    {busy ? 'Working…' : req.confirm}
                  </button>
                </>
              )}
            </div>
            <p className="adm-modal-foot">This action is recorded in the admin log.</p>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------------------------------------------------------------- filters

export interface Filters {
  from: string;
  to: string;
  seed: boolean;
}

const FiltersCtx = createContext<{ filters: Filters; setFilters: (f: Filters) => void }>({ filters: { from: '', to: '', seed: true }, setFilters: () => {} });
export const useFilters = () => useContext(FiltersCtx);
export const FiltersProvider = FiltersCtx.Provider;

/** ?from=&to=&seed= for the current filters (plus extras). */
export function query(f: Filters, extra: Record<string, string | number | undefined | null> = {}) {
  const p = new URLSearchParams({ from: f.from, to: f.to, seed: f.seed ? '1' : '0' });
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return `?${p}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
