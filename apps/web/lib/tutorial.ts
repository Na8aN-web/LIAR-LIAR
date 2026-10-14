'use client';

import { kv, onStorageReset } from '@/lib/portal/storage';

import { useSyncExternalStore } from 'react';
import { tutorialSchedule, tutorialStage, tutorialUnlocked, type GameView, type Phase, type PlayerView, type TutorialFeature, type TutorialProgress } from '@wtc/shared';
import { useGame } from './store';

// The first-game tutorial: a new player's first game teaches the game as it goes. Features
// unlock in stages, on this player's screen only (the game runs normally for everyone else):
//   1. poster 1: searching, chat and voting
//   2. poster 2: the Searches and Notebook tabs (talk and lie)
//   3. poster 3: buying findings, extra looks, the worth snapshot (and the Rankings tab)
//   4. the payout after poster 3: dirty tricks
// Shorter games squeeze the stages so everything is unlocked by the final payout. Completion is
// remembered per browser (an embedded host could key it by its own player id instead: see
// tutorialKey). Practice games always run it. "Show everything" in Settings turns it off.

export type Feature = TutorialFeature;

const STATUS_KEY = 'wtc:tutorial';
const SHOW_ALL_KEY = 'wtc:show-everything';
/** Where completion is stored. An embedded mode with its own player ids would add that id here. */
export const tutorialKey = (playerId?: string) => (playerId ? `${STATUS_KEY}:${playerId}` : STATUS_KEY);

type Status = 'new' | 'done' | 'skipped';
let status: Status = 'new';
let showAll = false;
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const s = kv.get(tutorialKey());
    status = s === 'done' || s === 'skipped' ? s : 'new';
    showAll = kv.get(SHOW_ALL_KEY) === '1';
  } catch {
    /* ignore */
  }
}

function save(key: string, value: string) {
  try {
    kv.set(key, value);
  } catch {
    /* ignore */
  }
}

onStorageReset(() => {
  loaded = false;
  notify();
});

export function setTutorialStatus(s: Status) {
  load();
  status = s;
  save(tutorialKey(), s);
  notify();
}

export function setShowEverything(on: boolean) {
  load();
  showAll = on;
  save(SHOW_ALL_KEY, on ? '1' : '0');
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useShowEverything(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return showAll;
    },
    () => false,
  );
}

function useStatus(): Status {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return status;
    },
    () => 'done',
  );
}

/** The unlock schedule lives in @wtc/shared (tested there). */
export const schedule = tutorialSchedule;
export const unlocked = (game: Pick<GameView, 'posterIndex' | 'posterCount'>, phase: Phase) => tutorialUnlocked(game.posterIndex, game.posterCount, phase);
export const stageOf = tutorialStage;

/** Whether the tutorial runs for this view: a first game (or practice), unless switched off. */
export function tutorialOn(view: PlayerView | null, st: Status, all: boolean): boolean {
  // Watching someone else's game (joined mid-game) isn't your first game: no prompts, not counted.
  if (!view?.game || view.phase === 'lobby' || view.phase === 'ended' || view.spectating || all) return false;
  return view.practice || st === 'new';
}

export function useTutorial(): { on: boolean; features: Record<Feature, boolean> } {
  const view = useGame((s) => s.view);
  const st = useStatus();
  const all = useShowEverything();
  const on = tutorialOn(view, st, all);
  const features = on && view?.game ? unlocked(view.game, view.phase) : { tabs: true, buying: true, tricks: true };
  return { on, features };
}

/** Whether a feature is visible (always, once the tutorial is off or done). */
export function useFeature(f: Feature): boolean {
  return useTutorial().features[f];
}

export type { TutorialProgress };
