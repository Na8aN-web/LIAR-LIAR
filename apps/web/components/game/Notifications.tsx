'use client';

import { useEffect, useRef, useState } from 'react';
import { colorInfo, type ColorId, type OfferView } from '@wtc/shared';
import { call } from '@/lib/socket';
import { playSfx, type Sfx } from '@/lib/audio/sfx';
import { useGame, usePlayerName } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ColorChip } from '../Chip';

// Slide-down telegrams:
//   1. someone offers to buy your findings (Sell / Refuse)
//   2. players searched you (batched over a few seconds)
//   3. a new poster starts (pot, and how many players changed color)
//   4. your deals: offer sent, findings bought (with the colors), refused or expired (refund),
//      and, for the seller, the sale
//   5. your own color changed

type NoteKind = 'offer' | 'inspected' | 'poster' | 'deal' | 'color';

/** Each telegram has its own sound: telegraph + bell for an offer, a crow when someone
 *  searched you, paper slapped on a post for a new poster, the telegraph key for deals (coins
 *  when money changes hands). A color change already rustles (useGameAudio), so it's silent here. */
const SOUND: Record<NoteKind, Sfx | null> = { offer: 'offer', inspected: 'crow', poster: 'poster', deal: 'telegram', color: null };
const TAG: Record<NoteKind, string> = { offer: 'OFFER', inspected: 'WATCHED', poster: 'POSTER', deal: 'DEAL', color: 'COLOR' };

interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  body?: string;
  /** Colors to show (bought findings). */
  colors?: ColorId[];
  /** Incoming offer to answer. */
  offerId?: string;
  /** "Open in Notebook" for this finding. */
  entryId?: string;
  /** Auto-dismiss time (ms since epoch). Unset: stays until answered or replaced. */
  until?: number;
}

const INSPECT_BATCH_MS = 2500;
const SHOW_MS = { inspected: 4000, poster: 4500, deal: 6000, bought: 9000, color: 5000 } as const;
/** Telegrams on screen at once: phones have less room (the rest fold into a "+2 more" chip). */
const MAX_VISIBLE = { phone: 2, desktop: 3 };

export function Notifications() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const toast = useGame((s) => s.showToast);
  const openNotebook = useGame((s) => s.openNotebook);
  const nameOf = usePlayerName();
  const streamer = useStreamerMode();
  const me = view.you.id;
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const desktop = useIsDesktop();
  const [expanded, setExpanded] = useState(false);

  const push = (n: Note, sound: Sfx | null = SOUND[n.kind]) => {
    setNotes((all) => [...all.filter((x) => x.id !== n.id), n]);
    if (sound) playSfx(sound);
  };
  const dismiss = (id: string) => setNotes((all) => all.filter((n) => n.id !== id));

  // 3. Poster start. Fires when a poster begins; not when rejoining mid-poster.
  const lastPoster = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastPoster.current;
    lastPoster.current = game.posterIndex;
    const isStart = prev === null ? view.phase === 'poster' : prev !== game.posterIndex;
    if (!isStart) return;
    push({
      id: `poster-${game.posterIndex}`,
      kind: 'poster',
      title: `New poster ${game.posterIndex + 1} of ${game.posterCount}. Bounty $${game.pot}.`,
      until: Date.now() + SHOW_MS.poster,
    });
  }, [game.posterIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Players searching you, batched. Entries already in the log at mount are old news.
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
          title: names.length === 1 ? `${names[0]} searched you${times > 1 ? ` ${times} times` : ''}.` : `${names.length} folks searched you.`,
          body: names.length > 1 ? names.join(', ') : undefined,
          until: Date.now() + SHOW_MS.inspected,
        });
      }, INSPECT_BATCH_MS);
    }
  }, [game.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (batchTimer.current) clearTimeout(batchTimer.current);
    },
    [],
  );

  // 1. Offers to buy your findings: one note per pending offer, removed once answered or expired.
  const notifiedOffers = useRef(new Set<string>());
  useEffect(() => {
    const pending = game.offersIn.filter((o) => o.status === 'pending');
    setNotes((all) => all.filter((n) => !n.offerId || pending.some((o) => o.id === n.offerId)));
    for (const o of pending) {
      if (notifiedOffers.current.has(o.id)) continue;
      notifiedOffers.current.add(o.id);
      const entry = game.log.find((e) => e.id === o.entryId);
      push({
        id: `offer-${o.id}`,
        kind: 'offer',
        offerId: o.id,
        title: `${nameOf(o.buyerId)} offers $${o.price} for your findings.`,
        body: entry ? `Your search of ${nameOf(entry.targetId)} on poster ${entry.poster + 1}.` : undefined,
      });
    }
  }, [game.offersIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Deals. Every status change of your offers (as buyer or seller) after this screen opened.
  //    What was already settled before (a reload, a reconnect) isn't announced again.
  const dealStatus = useRef<Map<string, OfferView['status']> | null>(null);
  useEffect(() => {
    const all = [...game.offersOut, ...game.offersIn];
    if (!dealStatus.current) {
      dealStatus.current = new Map(all.map((o) => [o.id, o.status]));
      return;
    }
    for (const o of all) {
      const before = dealStatus.current.get(o.id);
      if (before === o.status) continue;
      dealStatus.current.set(o.id, o.status);
      const buying = o.buyerId === me;
      const entry = game.log.find((e) => e.id === o.entryId);
      const what = entry ? `${nameOf(entry.targetId)} (poster ${entry.poster + 1})` : 'their search';
      if (buying && o.status === 'pending') {
        push({ id: `deal-${o.id}`, kind: 'deal', title: `Offer sent to ${nameOf(o.sellerId)}. Waiting…`, body: `$${o.price} for their findings on ${what}. Held from your purse until they answer.` });
      } else if (buying && o.status === 'accepted') {
        push({
          id: `deal-${o.id}`,
          kind: 'deal',
          title: `${nameOf(o.sellerId)} sold you their findings on ${what}:`,
          colors: game.myResults[o.entryId] ?? [],
          entryId: o.entryId,
          until: Date.now() + SHOW_MS.bought,
        }, 'coins');
      } else if (buying && (o.status === 'declined' || o.status === 'expired')) {
        push({
          id: `deal-${o.id}`,
          kind: 'deal',
          title: o.status === 'declined' ? `${nameOf(o.sellerId)} refused.` : `${nameOf(o.sellerId)} never answered.`,
          body: `Your $${o.price} is back in your purse.`,
          until: Date.now() + SHOW_MS.deal,
        });
      } else if (!buying && o.status === 'accepted') {
        push({ id: `deal-${o.id}`, kind: 'deal', title: `You sold your findings to ${nameOf(o.buyerId)}. +$${o.price}.`, body: entry ? `Your search of ${what}.` : undefined, until: Date.now() + SHOW_MS.deal }, 'coins');
      }
    }
  }, [game.offersOut, game.offersIn, game.myResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // 5. Your color changed (a swap during the payout). Not on first load.
  const lastColor = useRef<ColorId | null>(null);
  useEffect(() => {
    const prev = lastColor.current;
    lastColor.current = view.you.color;
    if (!prev || prev === view.you.color) return;
    push({
      id: `color-${Date.now()}`,
      kind: 'color',
      title: streamer ? 'You’re now wearing a new color.' : `You’re now wearing ${colorInfo(view.you.color).name}.`,
      body: streamer ? 'Hidden on screen: streamer mode is on.' : undefined,
      colors: streamer ? undefined : [view.you.color],
      until: Date.now() + SHOW_MS.color,
    });
  }, [view.you.color]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Offers waiting for an answer always show (they can't be missed); the rest fill the space
  // that's left, newest first, and anything beyond folds into a "+N more" chip.
  const offers = notes.filter((n) => n.offerId);
  const others = notes.filter((n) => !n.offerId).reverse();
  const room = Math.max(0, (desktop ? MAX_VISIBLE.desktop : MAX_VISIBLE.phone) - offers.length);
  const shownOthers = expanded ? others : others.slice(0, room);
  const hidden = others.length - shownOthers.length;
  const visible = [...offers, ...shownOthers];
  useEffect(() => {
    if (expanded && others.length <= room) setExpanded(false);
  }, [expanded, others.length, room]);
  if (!visible.length && !hidden) return null;

  return (
    <div className="notes-stack" role="status" aria-live="polite">
      {visible.map((n) => (
        <div key={n.id} className={`note note-${n.kind}`} onClick={() => !n.offerId && !n.entryId && dismiss(n.id)}>
          <div className="note-head">
            <span>WESTERN TELEGRAPH</span>
            <span>{TAG[n.kind]}</span>
          </div>
          <div className="note-text">
            <b>{n.title}</b>
            {n.colors && n.colors.length > 0 && (
              <span className="chip-row tight note-colors">
                {n.colors.map((c) => (
                  <ColorChip key={c} color={c} />
                ))}
              </span>
            )}
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
          {n.entryId && (
            <div className="row">
              <button
                className="btn small primary"
                onClick={() => {
                  openNotebook(n.entryId!);
                  dismiss(n.id);
                }}
              >
                Open in Notebook
              </button>
              <button className="btn small ghost" onClick={() => dismiss(n.id)}>
                Got it
              </button>
            </div>
          )}
        </div>
      ))}
      {(hidden > 0 || (expanded && others.length > room)) && (
        <button className="notes-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
