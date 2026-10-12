'use client';

import { useEffect, useRef } from 'react';
import { useGame, useSecondsLeft } from '@/lib/store';
import { playSfx } from './sfx';
import { useMood, type Mood } from './soundscape';

// Turns what this client already sees into sound. Uses only this player's own view, so a
// sound can never reveal more than the screen does (e.g. victory/despair is your own reaction,
// as the server decided it for you).

/** Ticks for the final seconds of a timed phase. */
const TICK_FROM = 10;
/** Tension music for the final seconds of the search phase (and the whole vote). */
const TENSION_FROM = 20;
/** The vote's last seconds: louder ticks if you haven't voted (matches the vote panel's warning). */
const URGENT_FROM = 5;

export function useGameAudio() {
  const view = useGame((s) => s.view);
  const left = useSecondsLeft();
  const phase = view?.phase ?? null;
  const game = view?.game ?? null;
  const me = view?.you.id;

  let mood: Mood = 'lobby';
  if (phase === 'investigation') mood = left !== null && left <= TENSION_FROM ? 'tension' : 'investigation';
  else if (phase === 'vote') mood = 'tension';
  else if (phase === 'poster') mood = 'investigation';
  else if (phase === 'payout') mood = 'payout';
  else if (phase === 'ended') mood = 'ended';
  useMood(mood);

  // Clock ticks: last ten seconds of searching and of the vote. Louder in the last five seconds of
  // the vote if you still haven't voted.
  const lastTick = useRef<number | null>(null);
  const hurry = phase === 'vote' && !game?.myVote && left !== null && left <= URGENT_FROM;
  useEffect(() => {
    if ((phase !== 'investigation' && phase !== 'vote') || left === null || left > TICK_FROM || left <= 0) return;
    if (lastTick.current === left) return;
    lastTick.current = left;
    playSfx(left % 2 ? 'tick' : 'tock', 0, hurry ? 2.4 : 1);
  }, [left, phase, hurry]);

  // Phase changes.
  const prev = useRef<{ phase: string | null; poster: number | null; vote: string | null; color: string | null; reaction: string | null }>({
    phase: null,
    poster: null,
    vote: null,
    color: null,
    reaction: null,
  });
  useEffect(() => {
    const p = prev.current;
    const poster = game?.posterIndex ?? null;
    // Each phase starts with its own sound (the new poster's plays with its telegram, in
    // Notifications): a slam as the search opens, the town bell for the vote, coins at the payout.
    if (phase !== p.phase && p.phase !== null) {
      if (phase === 'investigation') playSfx('poster');
      if (phase === 'vote') playSfx('townBell');
      if (phase === 'payout') playSfx('coins');
      if (phase === 'ended') playSfx('gameEnd', 0.3);
    }
    // Your vote stamped.
    const vote = game?.myVote ?? null;
    if (vote && vote !== p.vote && phase === 'vote') playSfx('stamp');
    // Your own color changed (a swap during the payout).
    const color = view?.you.color ?? null;
    if (p.color && color && color !== p.color && phase === 'payout') playSfx('rustle');
    // Your own reaction, as your scarecrow plays it.
    const r = game?.reactions;
    const mine = r && me ? r.byPlayer[me] : undefined;
    const key = r && mine ? `${r.key}:${mine}` : null;
    if (key && key !== p.reaction && r?.key !== 'end') playSfx(mine === 'victory' ? 'victory' : 'despair', 0.9);
    prev.current = { phase, poster, vote, color, reaction: key ?? p.reaction };
  }, [phase, game, me, view?.you.color]);
}

/** A soft wooden knock on every button press, app-wide. */
export function useButtonClicks() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // Not on the admin dashboard: it's a tool, not the game.
      if (location.pathname.startsWith('/admin')) return;
      const el = (e.target as HTMLElement | null)?.closest?.('button, [role="button"], a.btn');
      if (el && !(el as HTMLButtonElement).disabled) playSfx('click');
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
}
