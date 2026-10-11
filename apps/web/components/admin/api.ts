'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Talks to the admin API (/admin/api, forwarded to the game server). Every request carries the
// x-wtc-admin header, which the server requires (pages on other sites can't add it). The session
// is an HttpOnly cookie this code never sees.

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Set by the app shell: called when the session has ended, to show the login again. */
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: (() => void) | null) => (onSignedOut = fn);

export async function adminFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; file?: File } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-wtc-admin': '1' };
  let body: BodyInit | undefined;
  if (init.file) {
    headers['content-type'] = init.file.type || 'application/octet-stream';
    body = init.file;
  } else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/admin/api${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') onSignedOut?.();
  if (!res.ok) throw new AdminError(res.status, data.error ?? `Error ${res.status}`);
  return data as T;
}

/** Loads `path` (re-loads when it changes, or every `pollMs`). */
export function useAdmin<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await adminFetch<T>(path);
      if (n === seq.current) {
        setData(d);
        setError('');
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, loading, reload: load };
}

// ---------------------------------------------------------------- formatting

export const int = (n: number | null | undefined) => (n === null || n === undefined ? '–' : Math.round(n).toLocaleString('en-GB'));
export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '–' : `${(n * 100).toFixed(digits)}%`);
export const dec = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '–' : n.toFixed(digits));
export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const ago = (iso: string | number) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const duration = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
