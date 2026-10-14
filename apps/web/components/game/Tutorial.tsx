'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { colorInfo, type GameView, type Phase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';
import { schedule, setTutorialStatus, stageOf, useTutorial } from '@/lib/tutorial';

// First-game tutorial prompts: one short line at a time, styled as a little telegram, with an
// arrow to the thing it's about. Never a popup: nothing pauses, nothing blocks, and a prompt
// steps aside rather than cover the timer, the Accuse button or an offer waiting for an answer.
// Action prompts go away once the player does it; information goes after a few seconds.

interface Ctx {
  game: GameView;
  phase: Phase;
  selectedId: string | null;
  s: ReturnType<typeof schedule>;
  color: string;
  rules: { buyPrice: number; extraInspectPrice: number; extraInspectCount: number; worthPrice: number };
}

type Anchor = string | 'circle' | 'eyes' | 'none';

interface Prompt {
  id: string;
  text: (c: Ctx) => string;
  when: (c: Ctx) => boolean;
  /** Where it points. A list is tried in order until the note fits somewhere. */
  anchor: (c: Ctx) => Anchor | Anchor[];
  /** Information: shown this long (ms). Actions: until `done`, or this long at most. */
  ms: number;
  done?: (c: Ctx) => boolean;
}

const PROMPTS: Prompt[] = [
  // Poster 1: search and vote.
  {
    id: 'poster',
    text: () => 'This is the outlaw’s color. Someone around the fire is wearing it.',
    when: (c) => c.game.posterIndex === 0 && (c.phase === 'poster' || c.phase === 'investigation'),
    anchor: () => '[data-tut="poster"]',
    ms: 7000,
    // Steps aside as soon as the player gets going, so the search prompts aren't held back.
    done: (c) => !!c.selectedId || c.game.inspectsUsed > 0,
  },
  {
    id: 'tap',
    text: () => 'Tap a scarecrow to search them.',
    when: (c) => c.game.posterIndex === 0 && c.phase === 'investigation' && c.game.inspectsUsed === 0 && !c.selectedId,
    anchor: () => 'circle',
    ms: 30000,
    done: (c) => !!c.selectedId || c.game.inspectsUsed > 0,
  },
  {
    id: 'press',
    text: () => 'Press Search to see their colors.',
    when: (c) => c.game.posterIndex === 0 && c.phase === 'investigation' && c.game.inspectsUsed === 0 && !!c.selectedId,
    anchor: () => '.target-head .btn.primary',
    ms: 30000,
    done: (c) => c.game.inspectsUsed > 0,
  },
  {
    id: 'again',
    text: () => 'One of these is their real color. Search again, and the real one keeps showing up.',
    when: (c) => c.game.posterIndex === 0 && c.phase === 'investigation' && c.game.inspectsUsed >= 1,
    // The whole card, so the note sits beside it rather than over the Search button.
    anchor: () => '.target-card',
    ms: 9000,
    done: (c) => c.game.inspectsUsed >= 2,
  },
  {
    id: 'vote',
    text: (c) => `Pick who you think wears ${c.color}.`,
    when: (c) => c.game.posterIndex === 0 && c.phase === 'vote' && !c.game.myVote,
    // Just above the Accuse footer, clear of the cards; else above the panel.
    anchor: () => ['[data-tut="vote"] .vote-foot', '[data-tut="vote"]'],
    ms: 25000,
    done: (c) => !!c.game.myVote,
  },
  {
    id: 'payout',
    text: () => 'Everyone who guessed right splits the bounty.',
    when: (c) => c.game.posterIndex === 0 && c.phase === 'payout',
    anchor: () => '.card.payout',
    ms: 6000,
  },
  // Talk and lie.
  {
    id: 'eyes',
    text: () => 'Everyone sees who you search, but not what you found.',
    when: (c) => c.game.posterIndex === c.s.tabs && c.s.tabs > 0 && c.phase === 'investigation',
    anchor: () => 'eyes',
    ms: 7000,
  },
  {
    id: 'chat',
    text: () => 'Use the chat to share clues, or lie. The fewer people who guess right, the bigger your cut.',
    when: (c) => c.game.posterIndex === c.s.tabs && c.s.tabs > 0 && c.phase === 'investigation',
    anchor: () => '[data-tut="tab-chat"]',
    ms: 8000,
  },
  {
    id: 'notebook',
    text: () => 'Your Notebook keeps track of everything you’ve found.',
    when: (c) => c.game.posterIndex === c.s.tabs && c.s.tabs > 0 && c.phase === 'investigation',
    anchor: () => '[data-tut="tab-notes"]',
    ms: 8000,
  },
  // Buying.
  {
    id: 'buy',
    text: (c) => `Buy another player’s findings for $${c.rules.buyPrice}. They can refuse.`,
    when: (c) => c.game.posterIndex === c.s.buying && c.s.buying > 0 && c.phase === 'investigation',
    anchor: () => '[data-tut="buy"], [data-tut="tab-log"]',
    ms: 8000,
  },
  {
    id: 'extra',
    text: (c) =>
      `Out of searches? Hire ${c.rules.extraInspectCount === 1 ? 'an extra look' : `${c.rules.extraInspectCount} extra looks`} for $${c.rules.extraInspectPrice}.`,
    when: (c) => c.game.posterIndex === c.s.buying && c.s.buying > 0 && c.phase === 'investigation',
    anchor: () => '[data-tut="extra"], .hints-btn',
    ms: 7000,
  },
  {
    id: 'worth',
    text: (c) => `Everyone’s money is hidden. Pay $${c.rules.worthPrice} to peek at it.`,
    when: (c) => c.game.posterIndex === c.s.buying && c.s.buying > 0 && c.phase === 'investigation',
    anchor: () => '[data-tut="tab-scores"]',
    ms: 8000,
  },
  // Dirty tricks.
  {
    id: 'tricks',
    text: () => 'New: dirty tricks. Change your color, or cover your tracks so searches on you show false results. Secret, one per round.',
    when: (c) => c.game.posterIndex === c.s.tricksAfter && c.phase === 'payout',
    anchor: () => '[data-tut="trick"]',
    ms: 10000,
    done: (c) => !!c.game.trickThisPayout,
  },
];

const NOTE_W = 290;
const GAP = 14;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function anchorBox(anchor: Anchor): Box | null {
  if (anchor === 'none') return null;
  if (anchor === 'circle' || anchor === 'eyes') {
    const eyes = anchor === 'eyes' ? window.__wtcEyes?.() : undefined;
    if (eyes?.length) return { x: eyes[0].x - 30, y: eyes[0].y - 14, w: 60, h: 28 };
    const c = window.__wtcCircle?.();
    return c ? { x: c.x + c.w / 2 - 40, y: c.y + c.h * 0.35, w: 80, h: 30 } : null;
  }
  const el = document.querySelector(anchor);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/** Things a prompt must never cover (including the Search and buy buttons it may be asking for). */
function keepClear(): Box[] {
  const out: Box[] = [];
  for (const sel of ['.topbar .timer', '.vote-accuse', '.vote-foot', '.notes-stack .note', '.target-actions', '.vote-card']) {
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width) out.push({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    });
  }
  return out;
}

/** Below the anchor if there's room, else above; never over anything in keepClear. */
function place(anchor: Box | null, noteH: number): { x: number; y: number; arrowX: number; side: 'up' | 'down' | null } | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(NOTE_W, vw - 24);
  const clear = keepClear();
  const cx = anchor ? anchor.x + anchor.w / 2 : vw / 2;
  const x = Math.max(12, Math.min(vw - w - 12, cx - w / 2));
  const tries: { y: number; side: 'up' | 'down' | null }[] = anchor
    ? [
        { y: anchor.y + anchor.h + GAP, side: 'up' },
        { y: anchor.y - GAP - noteH, side: 'down' },
      ]
    : [{ y: vh * 0.42, side: null }];
  for (const t of tries) {
    if (t.y < 8 || t.y + noteH > vh - 8) continue;
    if (clear.some((c) => overlaps(c, { x, y: t.y, w, h: noteH }))) continue;
    return { x, y: t.y, arrowX: Math.max(16, Math.min(w - 16, cx - x)), side: t.side };
  }
  return null;
}

function placeAny(anchors: Anchor[], noteH: number): ReturnType<typeof place> {
  for (const a of anchors) {
    const p = place(anchorBox(a), noteH);
    if (p) return p;
  }
  return null;
}

export function Tutorial() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const selectedId = useGame((s) => s.selectedId);
  const { on, features } = useTutorial();
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [pos, setPos] = useState<ReturnType<typeof place>>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const reported = useRef(0);

  const ctx: Ctx = {
    game,
    phase: view.phase,
    selectedId,
    s: schedule(game.posterCount),
    color: colorInfo(game.posterColor).name,
    rules: view.settings.rules,
  };
  const prompt = on ? PROMPTS.find((p) => !done.has(p.id) && p.when(ctx)) : undefined;
  const first = prompt?.id === PROMPTS[0].id;

  // Admin funnel: how far this player got.
  const stage = stageOf(features);
  useEffect(() => {
    if (!on || stage <= reported.current) return;
    reported.current = stage;
    void call('client:tutorial', { progress: stage });
  }, [on, stage]);

  // Information prompts time out; action prompts end when the action happens (or at most ms).
  useEffect(() => {
    if (!prompt) return;
    const t = setTimeout(() => setDone((d) => new Set(d).add(prompt.id)), prompt.ms);
    return () => clearTimeout(t);
  }, [prompt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prompt?.done?.(ctx)) setDone((d) => new Set(d).add(prompt.id));
  });

  // Follow the anchor (the 3D scene and panels move); hide while an offer waits for an answer,
  // and while a sheet (e.g. the dirty tricks) is open on top.
  const offerWaiting = game.offersIn.some((o) => o.status === 'pending');
  useEffect(() => {
    if (!prompt || offerWaiting) return setPos(null);
    const update = () =>
      setPos(document.querySelector('.modal-backdrop') ? null : placeAny([prompt.anchor(ctx)].flat(), noteRef.current?.offsetHeight ?? 70));
    update();
    const id = setInterval(update, 300);
    return () => clearInterval(id);
  }, [prompt?.id, offerWaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const anchorKey = useMemo(() => prompt?.id ?? '', [prompt?.id]);
  if (!prompt) return null;
  return (
    <div
      ref={noteRef}
      key={anchorKey}
      className={`tut-note${pos ? '' : ' hidden'}${pos?.side ? ` arrow-${pos.side}` : ''}`}
      style={pos ? { left: pos.x, top: pos.y, width: Math.min(NOTE_W, window.innerWidth - 24), ['--arrow-x' as string]: `${pos.arrowX}px` } : undefined}
      role="status"
    >
      <span className="tut-tag">FIRST GAME</span>
      <span className="tut-text">{prompt.text(ctx)}</span>
      {first && (
        <button
          className="tut-skip"
          onClick={() => {
            setTutorialStatus('skipped');
            void call('client:tutorial', { progress: 'skipped' });
          }}
        >
          Skip tutorial
        </button>
      )}
    </div>
  );
}

/** Marks the tutorial done when a first game (with it on) reaches its end. Mount once per room. */
export function useTutorialCompletion() {
  const phase = useGame((s) => s.view?.phase);
  const { on } = useTutorial();
  const wasOn = useRef(false);
  useEffect(() => {
    if (on) wasOn.current = true;
    if (phase === 'ended' && wasOn.current) {
      wasOn.current = false;
      setTutorialStatus('done');
      void call('client:tutorial', { progress: 4 });
    }
  }, [on, phase]);
}
