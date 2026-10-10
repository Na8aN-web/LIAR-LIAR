import { COLOR_IDS, colorInfo, type ChatMessage, type ColorId, type PlayerId, type PlayerView } from '@wtc/shared';
import { chance, pick, shuffle, type Rng } from '../rng';

// Bot decisions. Everything here works from a bot's own PlayerView and public
// chat only, exactly what a human client could see, so bots can't cheat.

export type Persona = 'honest' | 'sly' | 'quiet';

export interface Mind {
  persona: Persona;
  /** Color a Wanted bot pretends to be this poster. */
  fakeColor: ColorId | null;
  repliesThisPoster: number;
  poster: number;
  /** Last thing this bot said, so it doesn't repeat itself word for word. */
  lastLine: string | null;
}

export function newMind(rng: Rng): Mind {
  const r = chance(rng);
  return { persona: r < 0.5 ? 'honest' : r < 0.85 ? 'sly' : 'quiet', fakeColor: null, repliesThisPoster: 0, poster: -1, lastLine: null };
}

export interface StaleEvidence {
  colors: ColorId[];
  /** Chance this is still true: shrinks with every round of color swaps since. */
  reliability: number;
}

export interface Knowledge {
  me: PlayerId;
  poster: ColorId;
  others: PlayerId[];
  /** Colors still possible per player from own + bought results since the last swap round. Missing = no fresh look. */
  possible: Map<PlayerId, ColorId[]>;
  /** Older results (before the last swap round), discounted by how many players swapped since. */
  stale: Map<PlayerId, StaleEvidence>;
  /** Players this bot knows were already Wanted (it voted right, or was Wanted itself). */
  pastWanted: Set<PlayerId>;
  everyoneOnce: boolean;
}

/**
 * Swap rounds split the game into eras. Results only intersect within an era, because
 * anyone might have changed color in between. The public count of swappers says how
 * much older eras can still be trusted.
 */
export function know(view: PlayerView): Knowledge {
  const game = view.game!;
  const me = view.you.id;
  const changes = game.colorChanges;
  const eraOf = (poster: number) => changes.slice(1, poster + 1).filter((n) => n > 0).length;
  const currentEra = eraOf(game.posterIndex);
  const myOwnSwapAfter = new Set(game.myColorHistory.map((h) => h.afterPoster).filter((p) => p !== null));

  // Per target, per era: intersection of results.
  const byEra = new Map<PlayerId, Map<number, ColorId[]>>();
  for (const e of game.log) {
    const r = game.myResults[e.id];
    if (!r || e.targetId === me) continue;
    const eras = byEra.get(e.targetId) ?? new Map<number, ColorId[]>();
    const era = eraOf(e.poster);
    const prev = eras.get(era);
    eras.set(era, prev ? prev.filter((c) => r.includes(c)) : r.slice());
    byEra.set(e.targetId, eras);
  }

  const possible = new Map<PlayerId, ColorId[]>();
  const stale = new Map<PlayerId, StaleEvidence>();
  const otherCount = view.players.filter((p) => p.id !== me).length || 1;
  for (const [p, eras] of byEra) {
    const fresh = eras.get(currentEra);
    if (fresh) possible.set(p, fresh);
    const older = [...eras.keys()].filter((era) => era < currentEra).sort((a, b) => b - a)[0];
    if (older === undefined) continue;
    // Reliability: for each swap round since that era, the chance this player wasn't among the swappers.
    let reliability = 1;
    for (let q = 1; q <= game.posterIndex; q++) {
      if (!changes[q] || eraOf(q) <= older) continue;
      const othersSwapped = changes[q] - (myOwnSwapAfter.has(q - 1) ? 1 : 0);
      reliability *= Math.max(0, 1 - othersSwapped / otherCount);
    }
    stale.set(p, { colors: eras.get(older)!, reliability });
  }

  // Propagate within the current era: my color and anyone's resolved color can't belong to someone else.
  for (let pass = 0; pass < 3; pass++) {
    const resolved = new Map<ColorId, PlayerId>();
    for (const [p, cs] of possible) if (cs.length === 1) resolved.set(cs[0], p);
    for (const [p, cs] of possible) {
      if (cs.length <= 1) continue;
      const next = cs.filter((c) => c !== view.you.color && (resolved.get(c) ?? p) === p);
      if (next.length) possible.set(p, next);
    }
  }
  const pastWanted = new Set<PlayerId>();
  for (const r of game.myRounds) if (r.wantedId && r.wantedId !== me) pastWanted.add(r.wantedId);
  return {
    me,
    poster: game.posterColor,
    others: view.players.filter((p) => p.id !== me).map((p) => p.id),
    possible,
    stale,
    pastWanted,
    everyoneOnce: view.settings.posterMode === 'everyoneOnce',
  };
}

const ruledOut = (k: Knowledge, p: PlayerId) => {
  const cs = k.possible.get(p);
  return (cs && !cs.includes(k.poster)) || (k.everyoneOnce && k.pastWanted.has(p));
};
const isKnownWanted = (k: Knowledge, p: PlayerId) => {
  const cs = k.possible.get(p);
  return !!cs && cs.length === 1 && cs[0] === k.poster;
};

/** How strongly the evidence points at p being Wanted. Fresh results beat stale ones. */
function evidence(k: Knowledge, p: PlayerId): number {
  const cs = k.possible.get(p);
  if (cs) return cs.includes(k.poster) ? 12 / cs.length : 0;
  const old = k.stale.get(p);
  if (!old) return 2; // never seen: neutral prior
  const r = old.reliability;
  return old.colors.includes(k.poster) ? r * (12 / old.colors.length) + (1 - r) * 2 : (1 - r) * 2;
}

/** Players still in the running, best evidence first. */
export function suspects(k: Knowledge): PlayerId[] {
  const score = (p: PlayerId) => (isKnownWanted(k, p) ? 100 : evidence(k, p));
  return k.others.filter((p) => !ruledOut(k, p)).sort((a, b) => score(b) - score(a));
}

/** Accusations per player in this poster's chat (name + poster color or "it's"). */
export function accusations(view: PlayerView, chat: ChatMessage[]): Map<PlayerId, number> {
  const game = view.game!;
  const colorWord = colorInfo(game.posterColor).name.toLowerCase();
  const counts = new Map<PlayerId, number>();
  for (const m of chat) {
    if (m.poster !== game.posterIndex || m.playerId === view.you.id) continue;
    const t = m.text.toLowerCase();
    if (/\bnot\b|\bclear\b/.test(t)) continue;
    if (!t.includes(colorWord) && !/\bit'?s\b|\bwanted\b/.test(t)) continue;
    for (const p of view.players) {
      if (p.id !== m.playerId && t.includes(p.name.toLowerCase())) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
  }
  return counts;
}

export function chooseInspect(view: PlayerView, k: Knowledge, rng: Rng): PlayerId | null {
  if (!k.others.length) return null;
  if (view.game!.youAreWanted) return pick(k.others, rng); // look busy
  const open = suspects(k).filter((p) => !isKnownWanted(k, p));
  // Closest to resolving first: a suspect with 2 possible colors needs one more look.
  const narrowing = open.filter((p) => (k.possible.get(p)?.length ?? 0) > 1);
  if (narrowing.length && chance(rng) < 0.75) return narrowing[0];
  // Then the strongest lead not looked at this era (suspects are sorted, so stale leads come first).
  const unseen = open.filter((p) => !k.possible.has(p));
  if (unseen.length) return unseen[0];
  return pick(open.length ? open : k.others, rng);
}

export function chooseVote(view: PlayerView, k: Knowledge, chat: ChatMessage[], rng: Rng): PlayerId | null {
  if (!k.others.length) return null;
  const acc = accusations(view, chat);
  if (view.game!.youAreWanted) {
    // Vote with the crowd so the vote doesn't stand out.
    const crowd = [...acc.entries()].filter(([p]) => p !== k.me).sort((a, b) => b[1] - a[1]);
    return crowd[0]?.[0] ?? pick(k.others, rng);
  }
  const known = k.others.find((p) => isKnownWanted(k, p));
  if (known) return known;
  const pool = suspects(k);
  const candidates = pool.length ? pool : k.others;
  const weight = (p: PlayerId) => evidence(k, p) + 3 * (acc.get(p) ?? 0) + chance(rng);
  return candidates.slice().sort((a, b) => weight(b) - weight(a))[0];
}

/**
 * "Exposure" for the swap policy: distinct players who inspected me since my last
 * color change, plus chat lines naming my current color since then.
 */
export function exposure(view: PlayerView, chat: ChatMessage[]): number {
  const game = view.game!;
  const me = view.you.id;
  const last = game.myColorHistory[game.myColorHistory.length - 1];
  const since = !last || last.afterPoster === null ? 0 : last.afterPoster + 1;
  const inspectors = new Set(game.log.filter((e) => e.targetId === me && e.poster >= since).map((e) => e.inspectorId));
  const word = new RegExp(`\\b${colorInfo(view.you.color).name.toLowerCase()}\\b`);
  const mentions = chat.filter(
    (m) => m.poster !== null && m.poster >= since && m.playerId !== me && word.test(m.text.toLowerCase()),
  ).length;
  return inspectors.size + mentions;
}

/** Swap once exposure passes the threshold, if swaps are left and this payout's swap is unused. */
export function shouldSwap(view: PlayerView, chat: ChatMessage[], threshold: number): boolean {
  const game = view.game!;
  if (game.swapLockedThisPayout || game.swapsUsed >= game.swapLimit) return false;
  return exposure(view, chat) >= threshold;
}

/** One chat line for the investigation phase, shaped by persona. Null = stay quiet. */
export function composeClaim(view: PlayerView, k: Knowledge, mind: Mind, rng: Rng): string | null {
  const game = view.game!;
  const name = (id: PlayerId) => view.players.find((p) => p.id === id)?.name ?? '?';
  const color = colorInfo(k.poster).name;
  const others = k.others;
  if (!others.length) return null;

  if (game.youAreWanted) {
    mind.fakeColor ??= pick(COLOR_IDS.filter((c) => c !== k.poster && c !== view.you.color), rng);
    const scapegoat = pick(others, rng);
    return pick(
      [
        `I think it's ${name(scapegoat)}.`,
        `${name(scapegoat)} showed ${color} for me.`,
        `I'm ${colorInfo(mind.fakeColor).name}, not me.`,
        `Anyone checked ${name(scapegoat)} yet?`,
      ],
      rng,
    );
  }

  const ranked = suspects(k);
  const known = ranked.find((p) => isKnownWanted(k, p));
  const cleared = others.filter((p) => k.possible.has(p) && !k.possible.get(p)!.includes(k.poster));

  if (mind.persona === 'sly') {
    // Lie to shrink the number of correct voters: frame an innocent, clear the guilty.
    const innocent = cleared.length ? pick(cleared, rng) : pick(others, rng);
    if (known && chance(rng) < 0.5) return `${name(known)} is clear, I checked twice.`;
    return pick([`It's ${name(innocent)}. Saw ${color} twice.`, `${name(innocent)} showed ${color} for me.`], rng);
  }

  if (known) return pick([`It's ${name(known)}. Saw ${color} twice.`, `${name(known)} is ${color}. Confirmed.`], rng);
  if (ranked.length && k.possible.has(ranked[0])) return `${name(ranked[0])} might be ${color}, checking again.`;
  if (cleared.length) return `${name(pick(cleared, rng))} is not ${color}.`;
  if (chance(rng) < 0.4) return `I'm ${colorInfo(view.you.color).name}, for what it's worth.`;
  return pick(['No idea yet.', 'Who keeps inspecting me?', 'Somebody share something.'], rng);
}

/** Reply when someone accuses this bot by name. */
export function composeDenial(view: PlayerView, mind: Mind, rng: Rng): string {
  const game = view.game!;
  if (game.youAreWanted) {
    mind.fakeColor ??= pick(COLOR_IDS.filter((c) => c !== game.posterColor && c !== view.you.color), rng);
    return pick([`Not me, I'm ${colorInfo(mind.fakeColor).name}.`, `Wrong. Inspect me and see.`, 'Nice try.'], rng);
  }
  if (mind.persona === 'sly') return pick(['Not me. Ask yourself why they said that.', 'Wrong scarecrow.'], rng);
  return `Not me, I'm ${colorInfo(view.you.color).name}.`;
}

/** True if this chat line accuses `me` of being Wanted. */
export function accusesMe(view: PlayerView, m: ChatMessage): boolean {
  const game = view.game;
  if (!game || m.playerId === view.you.id) return false;
  const t = m.text.toLowerCase();
  if (!t.includes(view.you.name.toLowerCase()) || /\bnot\b|\bclear\b/.test(t)) return false;
  return t.includes(colorInfo(game.posterColor).name.toLowerCase()) || /\bit'?s\b|\bwanted\b/.test(t);
}

/** A log entry worth buying: someone else's look at an unresolved suspect. */
export function chooseEntryToBuy(view: PlayerView, k: Knowledge, rng: Rng): string | null {
  const game = view.game!;
  const owned = new Set(Object.keys(game.myResults));
  const asked = new Set(game.offersOut.filter((o) => o.status === 'pending' || o.poster === game.posterIndex).map((o) => o.entryId));
  const open = new Set(suspects(k).filter((p) => !isKnownWanted(k, p)));
  const entries = shuffle(
    game.log.filter((e) => e.inspectorId !== k.me && e.targetId !== k.me && !owned.has(e.id) && !asked.has(e.id) && open.has(e.targetId)),
    rng,
  );
  return (entries.find((e) => e.poster === game.posterIndex) ?? entries[0])?.id ?? null;
}

export function sellChance(view: PlayerView, mind: Mind): number {
  if (view.game!.youAreWanted) return 0.5;
  return mind.persona === 'honest' ? 0.8 : mind.persona === 'quiet' ? 0.7 : 0.6;
}
