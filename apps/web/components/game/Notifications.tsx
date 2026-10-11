'use client';

import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/socket';
import { playSfx, type Sfx } from '@/lib/audio/sfx';
import { useGame, usePlayerName } from '@/lib/store';

// Slide-down notifications. Only three things ever pop up:
//   1. someone offers to buy your info (Accept / Decline)
//   2. players inspected you (batched over a few seconds)
//   3. a new poster starts (pot, and how many players changed color)

type NoteKind = 'offer' | 'inspected' | 'poster';

/** Each telegram has its own sound: telegraph + bell for an offer, a crow when someone
 *  searched you, paper slapped on a post for a new poster. */
const SOUND: Record<NoteKind, Sfx> = { offer: 'offer', inspected: 'crow', poster: 'poster' };

interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  body?: string;
  offerId?: string;
  /** Auto-dismiss time (ms since epoch). Offers stay until answered or expired. */
  until?: number;
}

const INSPECT_BATCH_MS = 2500;
const SHOW_MS = { inspected: 4000, poster: 4500 } as const;
const MAX_VISIBLE = 3;

export function Notifications() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const nameOf = usePlayerName();
  const me = view.you.id;
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const push = (n: Note) => {
    setNotes((all) => [...all.filter((x) => x.id !== n.id), n]);
    playSfx(SOUND[n.kind]);
  };
  const dismiss = (id: string) => setNotes((all) => all.filter((n) => n.id !== id));

  // 3. Poster start. Fires when a poster begins; not when rejoining mid-poster.
  const lastPoster = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastPoster.current;
    lastPoster.current = game.posterIndex;
    const isStart = prev === null ? view.phase === 'poster' : prev !== game.posterIndex;
    if (!isStart) return;
    const changed = game.colorChanges[game.posterIndex] ?? 0;
    push({
      id: `poster-${game.posterIndex}`,
      kind: 'poster',
      title: `New poster ${game.posterIndex + 1} of ${game.posterCount}. Bounty $${game.pot}.`,
      body: changed ? `${changed} ${changed === 1 ? 'player' : 'players'} changed colors.` : undefined,
      until: Date.now() + SHOW_MS.poster,
    });
  }, [game.posterIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Players inspecting you, batched. Entries already in the log at mount are old news.
  const seen = useRef<Set<string> | null>(null);
  const batch = useRef<string[]>([]);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(game.log.map((e) => e.id));
      return;
    }
    for (const e of game.log) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (e.targetId === me && e.inspectorId !== me) batch.current.push(e.inspectorId);
    }
    if (batch.current.length && !batchTimer.current) {
      batchTimer.current = setTimeout(() => {
        const ids = batch.current;
        batch.current = [];
        batchTimer.current = null;
        const names = [...new Set(ids)].map((id) => nameOf(id));
        const times = ids.length;
        push({
          id: `inspected-${Date.now()}`,
          kind: 'inspected',
          title:
            names.length === 1
              ? `${names[0]} searched you${times > 1 ? ` ${times} times` : ''}.`
              : `${names.length} folks searched you.`,
          body: names.length > 1 ? names.join(', ') : undefined,
          until: Date.now() + SHOW_MS.inspected,
        });
      }, INSPECT_BATCH_MS);
    }
  }, [game.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (batchTimer.current) clearTimeout(batchTimer.current);
  }, []);

  // 1. Offers to buy your info: one note per pending offer, removed once it's answered or expires.
  const notifiedOffers = useRef(new Set<string>());
  useEffect(() => {
    const pending = game.offersIn.filter((o) => o.status === 'pending');
    setNotes((all) => all.filter((n) => !n.offerId || pending.some((o) => o.id === n.offerId)));
    for (const o of pending) {
      const id = `offer-${o.id}`;
      if (notifiedOffers.current.has(o.id)) continue;
      notifiedOffers.current.add(o.id);
      const entry = game.log.find((e) => e.id === o.entryId);
      push({
        id,
        kind: 'offer',
        offerId: o.id,
        title: `${nameOf(o.buyerId)} offers $${o.price} for your findings.`,
        body: entry ? `Your search of ${nameOf(entry.targetId)} on poster ${entry.poster + 1}.` : undefined,
      });
    }
  }, [game.offersIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss timed notes.
  useEffect(() => {
    const timed = notes.filter((n) => n.until);
    if (!timed.length) return;
    const next = Math.min(...timed.map((n) => n.until!));
    const t = setTimeout(() => setNotes((all) => all.filter((n) => !n.until || n.until > Date.now())), Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
  }, [notes]);

  const respond = async (n: Note, accept: boolean) => {
    if (!n.offerId) return;
    setBusy(n.id);
    const res = await call('buy:respond', { offerId: n.offerId, accept });
    setBusy(null);
    if (!res.ok) toast(res.error);
    dismiss(n.id);
  };

  // Offers first, then newest.
  const visible = [...notes.filter((n) => n.offerId), ...notes.filter((n) => !n.offerId).reverse()].slice(0, MAX_VISIBLE);
  if (!visible.length) return null;

  return (
    <div className="notes-stack" role="status" aria-live="polite">
      {visible.map((n) => (
        <div key={n.id} className={`note note-${n.kind}`} onClick={() => !n.offerId && dismiss(n.id)}>
          <div className="note-head">
            <span>WESTERN TELEGRAPH</span>
            <span>{n.kind === 'offer' ? 'OFFER' : n.kind === 'inspected' ? 'WATCHED' : 'POSTER'}</span>
          </div>
          <div className="note-text">
            <b>{n.title}</b>
            {n.body && <span>{n.body}</span>}
          </div>
          {n.offerId && (
            <div className="row">
              <button className="btn small primary" disabled={busy === n.id} onClick={() => respond(n, true)}>
                Sell
              </button>
              <button className="btn small" disabled={busy === n.id} onClick={() => respond(n, false)}>
                Refuse
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
