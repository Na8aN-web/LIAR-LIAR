import { BILLBOARD_SLOTS, type Source } from '@wtc/shared';
import type { AnalyticsEvent, SafetyKind } from '../analytics/events';
import type { GameSummary } from '../game/summary';
import type { FeedbackEntry } from '../room';
import type { Ban } from '../store/types';

// Dashboard numbers, computed from stored records. Pure functions: the same for the file store
// and Postgres, and easy to test. Days are UTC.

export interface Window {
  from: Date;
  to: Date;
  now: number;
}

type Ev<T extends AnalyticsEvent['type']> = Extract<AnalyticsEvent, { type: T }>;
const of = <T extends AnalyticsEvent['type']>(events: AnalyticsEvent[], type: T) => events.filter((e): e is Ev<T> => e.type === type);
const inWin = (at: string, w: Window) => {
  const t = Date.parse(at);
  return t >= w.from.getTime() && t < w.to.getTime();
};
export const dayOf = (at: string | number) => new Date(at).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ratio = (a: number, b: number) => (b ? a / b : null);

export function dayList(w: Window): string[] {
  const out: string[] = [];
  for (let d = dayOf(w.from.getTime()); d <= dayOf(w.to.getTime() - 1); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Games that count as real play: not the playtest check script, and (unless asked) with people in them. */
export const realGames = (games: GameSummary[], botOnly = false) => games.filter((g) => !g.check && (botOnly || g.bots < g.players));

/** Activity by visitor: every day each anonymous id did anything (visit or funnel step). */
function activity(events: AnalyticsEvent[]) {
  const days = new Map<string, Set<string>>();
  const first = new Map<string, string>();
  for (const e of events) {
    if (!e.anon || (e.type !== 'visit' && e.type !== 'step')) continue;
    const d = dayOf(e.at);
    let set = days.get(e.anon);
    if (!set) days.set(e.anon, (set = new Set()));
    set.add(d);
    const f = first.get(e.anon);
    if (!f || d < f) first.set(e.anon, d);
  }
  return { days, first };
}

// ---------------------------------------------------------------- growth

/** `events` should reach back to the beginning (for first visits); `games` only the window. */
export function growth(events: AnalyticsEvent[], games: GameSummary[], w: Window) {
  const { days: active, first } = activity(events);
  const today = dayOf(w.now);
  const series = dayList(w).map((day) => {
    let visitors = 0;
    let fresh = 0;
    for (const [anon, ds] of active) {
      if (!ds.has(day)) continue;
      visitors++;
      if (first.get(anon) === day) fresh++;
    }
    const players = new Set(of(events, 'step').filter((e) => e.step === 'lobby' && dayOf(e.at) === day && e.anon).map((e) => e.anon)).size;
    const peak = Math.max(0, ...of(events, 'concurrency').filter((e) => dayOf(e.at) === day).map((e) => e.players));
    return { day, visitors, players, new: fresh, returning: visitors - fresh, games: realGames(games).filter((g) => dayOf(g.endedAt) === day).length, peak };
  });

  // Return rates for people whose first day is in the window (only once enough time has passed).
  let dayN = 0;
  let dayBack = 0;
  let weekN = 0;
  let weekBack = 0;
  const cohorts: { day: string; new: number; nextDay: number | null; nextWeek: number | null }[] = [];
  for (const day of dayList(w)) {
    const cohort = [...first].filter(([, f]) => f === day).map(([a]) => a);
    if (!cohort.length) continue;
    const dayReady = addDays(day, 1) < today;
    const weekReady = addDays(day, 7) < today;
    const backNext = cohort.filter((a) => active.get(a)!.has(addDays(day, 1))).length;
    const backWeek = cohort.filter((a) => [1, 2, 3, 4, 5, 6, 7].some((n) => active.get(a)!.has(addDays(day, n)))).length;
    if (dayReady) {
      dayN += cohort.length;
      dayBack += backNext;
    }
    if (weekReady) {
      weekN += cohort.length;
      weekBack += backWeek;
    }
    cohorts.push({ day, new: cohort.length, nextDay: dayReady ? backNext / cohort.length : null, nextWeek: weekReady ? backWeek / cohort.length : null });
  }

  // Devices and countries: each visitor once (their latest visit in the window).
  const visits = of(events, 'visit').filter((e) => inWin(e.at, w) && e.anon);
  const latest = new Map<string, Ev<'visit'>>();
  for (const v of visits) latest.set(v.anon!, v);
  const tally = (key: (v: Ev<'visit'>) => string) => {
    const m = new Map<string, number>();
    for (const v of latest.values()) m.set(key(v), (m.get(key(v)) ?? 0) + 1);
    return [...m].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
  };
  const windowActive = new Set<string>();
  for (const [anon, ds] of active) if ([...ds].some((d) => d >= dayOf(w.from.getTime()) && d <= dayOf(w.to.getTime() - 1))) windowActive.add(anon);

  return {
    series,
    totals: {
      visitors: windowActive.size,
      players: new Set(of(events, 'step').filter((e) => e.step === 'lobby' && inWin(e.at, w) && e.anon).map((e) => e.anon)).size,
      newVisitors: [...first.values()].filter((d) => d >= dayOf(w.from.getTime()) && d <= dayOf(w.to.getTime() - 1)).length,
      games: realGames(games).filter((g) => inWin(g.endedAt, w)).length,
      peak: Math.max(0, ...series.map((s) => s.peak)),
    },
    retention: { nextDay: ratio(dayBack, dayN), nextWeek: ratio(weekBack, weekN), nextDayCohort: dayN, nextWeekCohort: weekN, cohorts },
    devices: tally((v) => v.device),
    countries: tally((v) => v.country ?? 'Unknown'),
  };
}

// ---------------------------------------------------------------- lobby

/** How people get into rooms (Quick Play, the list, codes) and how many public rooms sit waiting. */
export function lobby(events: AnalyticsEvent[], w: Window) {
  const evs = of(events, 'lobby').filter((e) => inWin(e.at, w));
  const count = (a: string, xs = evs) => xs.filter((e) => e.action === a).length;
  const peaks = of(events, 'concurrency').filter((e) => inWin(e.at, w) && e.publicWaiting !== undefined);
  return {
    totals: {
      quickJoin: count('quick_join'),
      quickCreate: count('quick_create'),
      listJoin: count('list_join'),
      codeJoin: count('code_join'),
      createPublic: count('create_public'),
      createPrivate: count('create_private'),
      publicWaitingPeak: Math.max(0, ...peaks.map((e) => e.publicWaiting!)),
    },
    daily: dayList(w).map((day) => {
      const d = evs.filter((e) => dayOf(e.at) === day);
      return {
        day,
        quickPlay: count('quick_join', d) + count('quick_create', d),
        list: count('list_join', d),
        code: count('code_join', d),
        publicWaiting: Math.max(0, ...peaks.filter((e) => dayOf(e.at) === day).map((e) => e.publicWaiting!)),
      };
    }),
  };
}

// ---------------------------------------------------------------- sources

/** Which links bring players: each visitor credited to the source of their first visit ever. */
export function sources(events: AnalyticsEvent[], w: Window) {
  const firstSrc = new Map<string, { at: string; src: Source }>();
  for (const v of of(events, 'visit')) {
    if (!v.anon) continue;
    const f = firstSrc.get(v.anon);
    if (!f || v.at < f.at) firstSrc.set(v.anon, { at: v.at, src: v.src });
  }
  const rows = new Map<Source, { visitors: Set<string>; players: Set<string>; finishers: Set<string>; finishedGames: number }>();
  const row = (src: Source) => {
    let r = rows.get(src);
    if (!r) rows.set(src, (r = { visitors: new Set(), players: new Set(), finishers: new Set(), finishedGames: 0 }));
    return r;
  };
  for (const e of events) {
    if (!e.anon || !inWin(e.at, w)) continue;
    const src = firstSrc.get(e.anon)?.src;
    if (!src) continue;
    if (e.type === 'visit') row(src).visitors.add(e.anon);
    if (e.type === 'step' && e.step === 'lobby') row(src).players.add(e.anon);
    if (e.type === 'step' && e.step === 'game_finish') {
      row(src).finishers.add(e.anon);
      row(src).finishedGames++;
    }
  }
  // New visitors by source, per day.
  const days = dayList(w);
  const daily = days.map((day) => {
    const counts: Partial<Record<Source, number>> = {};
    for (const f of firstSrc.values()) if (dayOf(f.at) === day) counts[f.src] = (counts[f.src] ?? 0) + 1;
    return { day, ...counts };
  });
  return {
    rows: [...rows]
      .map(([src, r]) => ({
        src,
        visitors: r.visitors.size,
        players: r.players.size,
        finishers: r.finishers.size,
        finishedGames: r.finishedGames,
        playRate: ratio(r.players.size, r.visitors.size),
        finishRate: ratio(r.finishers.size, r.visitors.size),
      }))
      .sort((a, b) => b.visitors - a.visitors),
    daily,
  };
}

// ---------------------------------------------------------------- funnel

/**
 * Of the visitors in the window, how many reached each step (in the window). "Played again" =
 * started another game after finishing one. Visitors from invite links skip the homepage.
 */
export function funnel(events: AnalyticsEvent[], w: Window) {
  const win = events.filter((e) => e.anon && inWin(e.at, w));
  const visitors = new Set(win.filter((e) => e.type === 'visit').map((e) => e.anon!));
  const did = (pred: (e: AnalyticsEvent) => boolean) => new Set(win.filter((e) => visitors.has(e.anon!) && pred(e)).map((e) => e.anon!));
  const step = (s: string) => (e: AnalyticsEvent) => e.type === 'step' && e.step === s;
  const home = did((e) => e.type === 'visit' && e.page === 'home');
  const opened = did(step('howto_open'));
  const finishedHowto = did(step('howto_finish'));
  const skipped = new Set([...did(step('howto_skip'))].filter((a) => !finishedHowto.has(a)));
  const lobby = did(step('lobby'));
  const started = did(step('game_start'));
  const finished = did(step('game_finish'));
  const again = new Set<string>();
  const byAnon = new Map<string, AnalyticsEvent[]>();
  for (const e of win) if (e.type === 'step' && (e.step === 'game_start' || e.step === 'game_finish')) byAnon.set(e.anon!, [...(byAnon.get(e.anon!) ?? []), e]);
  for (const [anon, es] of byAnon) {
    if (!visitors.has(anon)) continue;
    const firstFinish = es.filter(step('game_finish')).map((e) => e.at).sort()[0];
    if (firstFinish && es.some((e) => step('game_start')(e) && e.at > firstFinish)) again.add(anon);
  }
  const stages = [
    { key: 'visit', label: 'Visited', n: visitors.size },
    { key: 'home', label: 'Saw the homepage', n: home.size },
    // Optional: plenty of people play without it, so it isn't counted as a drop-off.
    { key: 'howto', label: 'Opened How to Play', n: opened.size, optional: true, detail: { finished: finishedHowto.size, skipped: skipped.size, notOpened: visitors.size - opened.size } },
    { key: 'lobby', label: 'Reached a lobby', n: lobby.size },
    { key: 'start', label: 'Game started', n: started.size },
    { key: 'finish', label: 'Game finished', n: finished.size },
    { key: 'again', label: 'Played again', n: again.size },
  ];
  return stages.map((s, i) => {
    // Drop-off from the last required step before this one (How to Play is optional).
    const prev = stages.slice(0, i).filter((p) => !('optional' in p)).at(-1);
    return {
      ...s,
      ofVisitors: ratio(s.n, visitors.size),
      dropFromPrevious: !prev || 'optional' in s ? null : prev.n ? Math.max(0, 1 - s.n / prev.n) : null,
    };
  });
}

// ---------------------------------------------------------------- balance

export interface BalanceFilter {
  /** Posters per game. */
  posters?: number;
  minPlayers?: number;
  maxPlayers?: number;
  decoys?: number;
  inspects?: number;
  swaps?: number;
  botOnly?: boolean;
  /** humans: only games without a single bot; withBots: only games that had bots. */
  who?: 'humans' | 'withBots';
}

/** A game had bots (tagged since withBots was added; older lines are judged by their bot count). */
export const hadBots = (g: GameSummary) => !!g.withBots || g.bots > 0;

export const settingsKey = (g: GameSummary) => {
  const r = g.settings.rules;
  const t = g.settings.timers;
  return `${g.posters.length} posters · ${g.inspectLimit} searches · ${r.decoys} fakes · ${g.swapLimit} color changes · timers ${t.poster}/${t.investigation}/${t.vote}/${t.payout}s`;
};

export function balance(games: GameSummary[], events: AnalyticsEvent[], w: Window, f: BalanceFilter = {}) {
  const all = realGames(games, f.botOnly).filter((g) => inWin(g.endedAt, w));
  const options = {
    posters: [...new Set(all.map((g) => g.posters.length))].sort((a, b) => a - b),
    players: [...new Set(all.map((g) => g.players))].sort((a, b) => a - b),
    decoys: [...new Set(all.map((g) => g.settings.rules.decoys))].sort((a, b) => a - b),
    inspects: [...new Set(all.map((g) => g.inspectLimit))].sort((a, b) => a - b),
    swaps: [...new Set(all.map((g) => g.swapLimit))].sort((a, b) => a - b),
  };
  const gs = all.filter(
    (g) =>
      (f.posters === undefined || g.posters.length === f.posters) &&
      (f.minPlayers === undefined || g.players >= f.minPlayers) &&
      (f.maxPlayers === undefined || g.players <= f.maxPlayers) &&
      (f.decoys === undefined || g.settings.rules.decoys === f.decoys) &&
      (f.inspects === undefined || g.inspectLimit === f.inspects) &&
      (f.swaps === undefined || g.swapLimit === f.swaps) &&
      (f.who !== 'humans' || !hadBots(g)) &&
      (f.who !== 'withBots' || hadBots(g)),
  );
  const thirds = [[], [], []] as number[][];
  const escapes = [[], [], []] as number[][];
  for (const g of gs) {
    const n = g.posters.length;
    for (const p of g.posters) {
      const t = Math.min(2, Math.floor((p.poster / n) * 3));
      if (p.voters) thirds[t].push(p.correct / p.voters);
      escapes[t].push(p.escaped ? 1 : 0);
    }
  }
  const perPlayer = (fn: (g: GameSummary) => number) => mean(gs.map((g) => fn(g) / g.players));
  const popular = new Map<string, number>();
  for (const g of gs) popular.set(settingsKey(g), (popular.get(settingsKey(g)) ?? 0) + 1);
  const abandoned = of(events, 'abandoned').filter(
    (e) => inWin(e.at, w) && (f.botOnly || e.humans > 0) && (f.who !== 'humans' || e.humans === e.players) && (f.who !== 'withBots' || e.humans < e.players),
  );
  return {
    games: gs.length,
    accuracy: { early: thirds[0].length ? mean(thirds[0]) : null, mid: thirds[1].length ? mean(thirds[1]) : null, late: thirds[2].length ? mean(thirds[2]) : null },
    escape: {
      overall: escapes.flat().length ? mean(escapes.flat()) : null,
      early: escapes[0].length ? mean(escapes[0]) : null,
      mid: escapes[1].length ? mean(escapes[1]) : null,
      late: escapes[2].length ? mean(escapes[2]) : null,
    },
    perPlayer: {
      findingsBought: perPlayer((g) => g.offers.accepted),
      extraLooks: perPlayer((g) => g.extraInspects),
      colorChanges: perPlayer((g) => g.totalSwaps ?? 0),
      searches: perPlayer((g) => g.inspects),
    },
    // Herding: of posters with one clear most-searched player, how often that player also got
    // the most votes, and how often they really were the outlaw (games since herding was tracked).
    herding: (() => {
      const hs = gs.flatMap((g) => g.posters.map((p) => p.herd)).filter((h): h is NonNullable<typeof h> => !!h && h.topSearchedMostVoted !== null);
      return {
        posters: hs.length,
        mostVoted: hs.length ? mean(hs.map((h) => (h.topSearchedMostVoted ? 1 : 0))) : null,
        wasOutlaw: hs.length ? mean(hs.map((h) => (h.topSearchedWasWanted ? 1 : 0))) : null,
      };
    })(),
    // Covered tracks: how often a covered outlaw escaped, against outlaws who didn't cover.
    covers: (() => {
      const ps = gs.flatMap((g) => g.posters).filter((p) => p.covered !== undefined);
      const cov = ps.filter((p) => p.coveredWanted);
      const not = ps.filter((p) => !p.coveredWanted);
      return {
        perPoster: ps.length ? mean(ps.map((p) => p.covered ?? 0)) : null,
        coveredOutlawPosters: cov.length,
        coveredOutlawEscape: cov.length ? mean(cov.map((p) => (p.escaped ? 1 : 0))) : null,
        otherEscape: not.length ? mean(not.map((p) => (p.escaped ? 1 : 0))) : null,
      };
    })(),
    avgMinutes: gs.length ? mean(gs.map((g) => g.durationMs)) / 60000 : null,
    avgPlayers: gs.length ? mean(gs.map((g) => g.players)) : null,
    popularSettings: [...popular].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    abandoned: { n: abandoned.length, rate: ratio(abandoned.length, abandoned.length + gs.length) },
    recent: gs
      .slice()
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .slice(0, 40)
      .map((g) => ({
        endedAt: g.endedAt,
        players: g.players,
        bots: g.bots,
        posters: g.posters.length,
        minutes: g.durationMs / 60000,
        escaped: g.posters.filter((p) => p.escaped).length,
        settings: settingsKey(g),
        seed: !!g.seed,
      })),
    options,
  };
}

// ---------------------------------------------------------------- feedback

export function feedback(entries: FeedbackEntry[], w: Window) {
  const list = entries.filter((e) => inWin(e.at, w)).reverse();
  const tally = { yes: 0, maybe: 0, no: 0, none: 0 };
  for (const e of list) tally[e.answers.playAgain ?? 'none']++;
  return { entries: list.map(({ anon: _anon, ...rest }) => rest), playAgain: tally };
}

// ---------------------------------------------------------------- safety

export function safety(events: AnalyticsEvent[], bans: Ban[], w: Window) {
  const evs = of(events, 'safety').filter((e) => inWin(e.at, w));
  const count = (k: SafetyKind) => evs.filter((e) => e.kind === k).reduce((a, e) => a + (k === 'rate_limit' ? (e.count ?? 1) : 1), 0);
  const limits = new Map<string, number>();
  for (const e of evs) if (e.kind === 'rate_limit' && e.limit) limits.set(e.limit, (limits.get(e.limit) ?? 0) + (e.count ?? 1));
  const reported = new Map<string, number>();
  for (const e of evs) if (e.kind === 'report' && e.target) reported.set(e.target, (reported.get(e.target) ?? 0) + 1);
  return {
    counts: { report: count('report'), kick: count('kick'), mute: count('mute'), ban: count('ban'), unban: count('unban'), rate_limit: count('rate_limit') },
    daily: dayList(w).map((day) => {
      const d = evs.filter((e) => dayOf(e.at) === day);
      return {
        day,
        report: d.filter((e) => e.kind === 'report').length,
        kick: d.filter((e) => e.kind === 'kick').length,
        mute: d.filter((e) => e.kind === 'mute').length,
        ban: d.filter((e) => e.kind === 'ban').length,
        rate_limit: d.filter((e) => e.kind === 'rate_limit').reduce((a, e) => a + (e.count ?? 1), 0),
      };
    }),
    reports: evs
      .filter((e) => e.kind === 'report')
      .reverse()
      .slice(0, 100)
      .map((e) => ({ at: e.at, target: e.target ?? null, reason: e.reason ?? '', chat: e.chat ?? [], timesReported: e.target ? reported.get(e.target) : 1, seed: !!e.seed })),
    actions: evs
      .filter((e) => e.kind === 'kick' || e.kind === 'ban' || e.kind === 'unban')
      .reverse()
      .slice(0, 100)
      .map((e) => ({ at: e.at, kind: e.kind, by: e.by ?? null, target: e.target ?? null, reason: e.reason ?? '' })),
    rateLimits: [...limits].map(([limit, n]) => ({ limit, n })).sort((a, b) => b.n - a.n),
    bans: bans.slice().reverse(),
  };
}

// ---------------------------------------------------------------- billboards

/** Per ad slot: how many players had it on screen (unique) and how many times (one per page visit). */
export function billboards(events: AnalyticsEvent[], w: Window) {
  const evs = of(events, 'billboard').filter((e) => inWin(e.at, w));
  const days = dayList(w);
  return BILLBOARD_SLOTS.map((slot) => {
    const mine = evs.filter((e) => e.slot === slot);
    return {
      slot,
      views: mine.length,
      players: new Set(mine.filter((e) => e.anon).map((e) => e.anon)).size,
      daily: days.map((day) => ({ day, players: new Set(mine.filter((e) => dayOf(e.at) === day && e.anon).map((e) => e.anon)).size })),
    };
  }).sort((a, b) => b.players - a.players);
}

// ---------------------------------------------------------------- first-game tutorial

/**
 * First-time players (their browser ran the tutorial): how far they got through it, and how
 * fast they first searched on poster 1, against everyone else.
 */
export function tutorialFunnel(games: GameSummary[], w: Window) {
  const gs = games.filter((g) => !g.seed && !g.check && inWin(g.endedAt, w));
  const people = gs.flatMap((g) => g.perPlayer ?? []).filter((p) => !p.bot);
  const tut = people.filter((p) => p.tutorial !== null && p.tutorial !== undefined);
  const reached = (n: number) => tut.filter((p) => typeof p.tutorial === 'number' && p.tutorial >= n).length;
  const firstSearch = (ps: typeof people) => {
    const xs = ps.map((p) => p.firstSearchSec?.[0]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
    return { n: xs.length, median: xs.length ? xs[Math.floor(xs.length / 2)] : null, never: ps.filter((p) => p.firstSearchSec?.[0] === null).length };
  };
  return {
    players: tut.length,
    stages: [1, 2, 3, 4].map((n) => ({ stage: n, n: reached(n) })),
    skipped: tut.filter((p) => p.tutorial === 'skipped').length,
    finished: tut.filter((p) => p.finished).length,
    firstSearch: { tutorial: firstSearch(tut), others: firstSearch(people.filter((p) => !tut.includes(p))) },
  };
}
