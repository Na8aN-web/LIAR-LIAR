// Fills the admin dashboard with data to look at before real players arrive.
//   pnpm admin:seed               import the playtest files, then simulate 30 days of visitors
//   pnpm admin:seed -- --remove   delete everything seeded (real data is untouched)
//
// What goes in, all tagged `seed` (the dashboard's "Seed data" switch hides it):
//   1. Your playtest files: apps/server/logs/archive/*games*.jsonl and *feedback*.jsonl.
//   2. Simulated traffic: made-up anonymous visitors (sources, devices, countries, How to Play,
//      lobbies, return visits, billboard views, reports, kicks, mutes, rate-limit hits), whose
//      games are real bot games from the simulator (same engine and bots as `pnpm sim`).
// Running it again replaces the previous seed. Uses the configured store (files or Postgres).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_TIMERS, type PosterMode } from '@wtc/shared';
import type { AnalyticsEvent } from '../src/analytics/events';
import type { GameSummary } from '../src/game/summary';
import type { FeedbackEntry } from '../src/room';
import { createStore } from '../src/store';
import { runMany } from './simlib';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const store = await createStore();

if (process.argv.includes('--remove')) {
  console.log(`Removed ${await store.removeSeed()} seeded records. Real data is untouched.`);
  await store.close();
  process.exit(0);
}

// Seeded random numbers: the same shape every run.
let state = 3042;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => rand() < p;
const pickW = <T>(items: [T, number][]): T => {
  let r = rand() * items.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
};
const anon = () => Array.from({ length: 16 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[Math.floor(rand() * 64)]).join('');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

console.log('Removing the previous seed…');
await store.removeSeed();
const events: AnalyticsEvent[] = [];
const games: GameSummary[] = [];
const feedback: FeedbackEntry[] = [];

// ---------------------------------------------------------------- 1. playtest files
const archive = 'logs/archive';
let imported = 0;
if (existsSync(archive)) {
  for (const f of readdirSync(archive).filter((n) => n.endsWith('.jsonl'))) {
    const rows = readFileSync(join(archive, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (f.includes('games')) for (const g of rows) games.push({ ...g, seed: true });
    if (f.includes('feedback')) for (const e of rows) feedback.push({ ...e, seed: true });
    imported += rows.length;
  }
}
console.log(`Imported ${imported} records from the playtest files in ${archive}.`);

// ---------------------------------------------------------------- 2. bot games
const variants: { posterMode: PosterMode; decoys: number }[] = [
  { posterMode: 'randomRepeats', decoys: 3 },
  { posterMode: 'randomRepeats', decoys: 3 },
  { posterMode: 'everyoneOnce', decoys: 3 },
  { posterMode: 'randomRepeats', decoys: 2 },
];
const pool = new Map<number, GameSummary[]>();
console.log('Playing 60 bot games with the simulator, all at once (about a minute)…');
const batches = [6, 7, 8, 9, 10].flatMap((players) =>
  variants.map(async (v) => ({ players, games: await runMany(3, { players, posterMode: v.posterMode, inspects: 'auto', colorSwaps: 'auto', rules: { decoys: v.decoys }, bots: {} }, 3) })),
);
for (const b of await Promise.all(batches)) pool.set(b.players, [...(pool.get(b.players) ?? []), ...b.games]);

// ---------------------------------------------------------------- 3. visitors over 30 days
const SOURCES: [string, number][] = [['youtube', 34], ['tiktok', 24], ['discord', 14], ['direct', 13], ['instagram', 7], ['x', 6], ['other', 2]];
const COUNTRIES: [string | null, number][] = [['NG', 28], ['US', 19], ['GB', 12], ['GH', 7], ['CA', 6], ['ZA', 5], ['IN', 5], ['DE', 4], ['PH', 4], ['KE', 3], [null, 7]];
const SLOT_SEEN: [string, number][] = [['house-3042', 0.85], ['roof-hotel', 0.7], ['roof-dancehall', 0.55], ['wall-bank', 0.45], ['wall-assay', 0.35], ['door-hotel', 0.2], ['door-barber', 0.15], ['door-livery', 0.12]];
const CHATS = ['you were red last round, admit it', "it's definitely Clem", 'nah I searched you, liar', 'whatever, lol', 'who bought my finding??', 'trust me bro'];
const RUDE = ['you are trash at this game', 'shut up idiot', 'uninstall loser', 'nobody likes you'];
const NAMES = ['Dusty', 'Clem', 'Hattie', 'Rio', 'Mags', 'Tex', 'June', 'Bo', 'Ike', 'Della', 'Gus', 'Fay'];
const FEEDBACK: Partial<FeedbackEntry['answers']>[] = [
  { confused: 'Where the fake colors come from', fun: 'Catching the outlaw on the last poster', noPointLying: 'No', pace: 'Searching felt long', playAgain: 'yes' },
  { confused: '', fun: 'Lying about being red and getting away with it', noPointLying: 'Once, when everyone had searched me', pace: '', playAgain: 'yes' },
  { confused: 'Buying findings', fun: 'The chat arguments', noPointLying: '', pace: 'Voting too fast', playAgain: 'maybe' },
  { confused: 'Color changes', fun: '', noPointLying: 'Yes, late in the game', pace: 'Too slow at the start', playAgain: 'maybe' },
  { confused: 'Everything at first', fun: 'Second game', noPointLying: '', pace: '', playAgain: 'yes' },
  { confused: '', fun: '', noPointLying: 'Felt pointless when the outlaw was obvious', pace: 'Payout could be shorter', playAgain: 'no' },
];

const now = Date.now();
const today0 = Math.floor(now / DAY) * DAY;
const DAYS = 30;
interface Visitor {
  anon: string;
  src: string;
  device: 'mobile' | 'desktop';
  country: string | null;
}
const visitors: Visitor[] = [];
let tables = 0;
for (let d = DAYS - 1; d >= 0; d--) {
  const day0 = today0 - d * DAY;
  const weekday = new Date(day0).getUTCDay();
  const growth = 1 + ((DAYS - 1 - d) / DAYS) * 2.2; // from ~6 to ~20 new visitors a day
  const spike = d === 9 ? 2.4 : 1; // a video went out
  const fresh = Math.round(6 * growth * spike * (weekday === 0 || weekday === 6 ? 1.35 : 1) * (0.8 + rand() * 0.4));
  // Today's crowd: new visitors plus some returning ones.
  const crowd: { v: Visitor; returning: boolean }[] = [];
  for (let i = 0; i < fresh; i++) {
    const v: Visitor = {
      anon: anon(),
      src: pickW(SOURCES),
      device: chance(0.68) ? 'mobile' : 'desktop',
      country: pickW(COUNTRIES),
    };
    visitors.push(v);
    crowd.push({ v, returning: false });
  }
  for (const v of visitors.slice(0, -fresh || undefined)) if (chance(0.09)) crowd.push({ v, returning: true });

  const starters: Visitor[] = [];
  for (const { v, returning } of crowd) {
    const t = day0 + (15 + rand() * 7) * 3600_000; // afternoons and evenings, UTC
    const page = !returning && chance(0.25) ? 'room' : 'home';
    events.push({ at: iso(t), type: 'visit', anon: v.anon, page, src: returning ? 'direct' : (v.src as never), device: v.device, country: v.country, seed: true });
    if (page === 'home' && !returning && chance(0.55)) {
      events.push({ at: iso(t + 20_000), type: 'step', anon: v.anon, step: 'howto_open', seed: true });
      events.push({ at: iso(t + 120_000), type: 'step', anon: v.anon, step: chance(0.6) ? 'howto_finish' : 'howto_skip', seed: true });
    }
    if (!chance(page === 'room' ? 0.9 : returning ? 0.8 : 0.62)) continue;
    events.push({ at: iso(t + 180_000), type: 'step', anon: v.anon, step: 'lobby', seed: true });
    for (const [slot, p] of SLOT_SEEN) if (chance(p)) events.push({ at: iso(t + 200_000), type: 'billboard', anon: v.anon, slot, seed: true });
    if (chance(0.82)) starters.push(v);
  }

  // Tables of 6-10 from today's starters; some play a second game.
  const queue = [...starters].sort(() => rand() - 0.5);
  let hour = 18;
  while (queue.length >= 6) {
    const size = Math.min(queue.length, 6 + Math.floor(rand() * 5));
    const table = queue.splice(0, size);
    const sims = pool.get(Math.min(10, Math.max(6, size)))!;
    const sim = structuredClone(sims[Math.floor(rand() * sims.length)]);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), posterMode: sim.settings.posterMode, rules: sim.settings.rules };
    const roundSec = settings.timers.poster + settings.timers.investigation * 0.8 + settings.timers.vote + settings.timers.payout;
    const durationMs = Math.round(sim.posters.length * roundSec * 1000 * (0.85 + rand() * 0.2));
    const start = day0 + hour * 3600_000 + rand() * 1800_000;
    hour = Math.min(23, hour + 0.75);
    const gameId = `seed${(tables++).toString(36)}`;
    for (const v of table) events.push({ at: iso(start), type: 'step', anon: v.anon, step: 'game_start', gameId, seed: true });
    if (chance(0.08)) {
      events.push({ at: iso(start + durationMs / 2), type: 'abandoned', anon: null, gameId, humans: table.length, players: table.length, poster: Math.floor(sim.posters.length / 2), posters: sim.posters.length, seed: true });
      continue;
    }
    const end = start + durationMs;
    // The simulated visitors are this game's players (the bots stand in for them).
    games.push({
      ...sim,
      seed: true,
      gameId,
      endedAt: iso(end),
      durationMs,
      bots: 0,
      settings: { ...settings, timers: DEFAULT_TIMERS },
      perPlayer: (sim.perPlayer ?? []).map((p, i) => ({ ...p, bot: false, anon: table[i]?.anon ?? null, howto: pickW([['finished', 4], ['skipped', 3], ['never', 3]]) })),
    });
    for (const v of table) {
      events.push({ at: iso(end), type: 'step', anon: v.anon, step: 'game_finish', gameId, seed: true });
      if (chance(0.08)) {
        const a = FEEDBACK[Math.floor(rand() * FEEDBACK.length)];
        feedback.push({ at: iso(end + 60_000), gameId, name: NAMES[Math.floor(rand() * NAMES.length)], anon: v.anon, seed: true, answers: { confused: '', fun: '', noPointLying: '', pace: '', playAgain: null, ...a } });
      }
      if (chance(0.4)) queue.push(v); // plays again
    }
    // Safety, now and then.
    if (chance(0.12)) events.push({ at: iso(start + 600_000), type: 'safety', kind: 'mute', by: 'player', anon: table[0].anon, target: table[1].anon, seed: true });
    if (chance(0.05)) events.push({ at: iso(start + 60_000), type: 'safety', kind: 'kick', by: 'host', anon: table[0].anon, target: table[2].anon, seed: true });
    if (chance(0.06)) {
      const chat = [...Array(3)].map((_, i) => ({ text: CHATS[Math.floor(rand() * CHATS.length)], reported: false, fromReported: i === 1 }));
      chat.push({ text: RUDE[Math.floor(rand() * RUDE.length)], reported: true, fromReported: true });
      events.push({ at: iso(start + 900_000), type: 'safety', kind: 'report', by: 'player', anon: table[0].anon, target: table[3].anon, reason: chance(0.5) ? 'rude' : '', chat, seed: true });
    }
  }

  // Players online through the day (sampled hourly here; the server samples every minute).
  const players = starters.length;
  for (let h = 0; h < 24; h++) {
    const curve = Math.max(0, Math.sin(((h - 12) / 12) * Math.PI)) ** 2;
    const online = Math.round(players * 0.45 * curve * (0.8 + rand() * 0.4));
    if (online || h % 6 === 0) events.push({ at: iso(day0 + h * 3600_000 + 30 * 60_000), type: 'concurrency', anon: null, players: online, sockets: Math.round(online * 1.3), rooms: Math.ceil(online / 7), seed: true });
  }
  if (chance(0.5)) {
    events.push({ at: iso(day0 + 20 * 3600_000), type: 'safety', kind: 'rate_limit', by: 'server', anon: null, limit: pickW([['chat', 5], ['events', 2], ['joinIp', 2], ['create', 1]]), count: 1 + Math.floor(rand() * 12), seed: true });
  }
}

// ---------------------------------------------------------------- write
// Nothing simulated may be in the future: slide the whole simulated month back if needed
// (the imported playtest files keep their real times).
const latest = Math.max(...events.map((e) => Date.parse(e.at)), ...games.filter((g) => g.gameId?.startsWith('seed')).map((g) => Date.parse(g.endedAt)));
const shift = Math.max(0, latest - (now - 10 * 60_000));
if (shift) {
  const back = (at: string) => iso(Date.parse(at) - shift);
  for (const e of events) e.at = back(e.at);
  for (const g of games) if (g.gameId?.startsWith('seed')) g.endedAt = back(g.endedAt);
  for (const f of feedback) if (f.gameId.startsWith('seed')) f.at = back(f.at);
}
events.sort((a, b) => a.at.localeCompare(b.at));
games.sort((a, b) => a.endedAt.localeCompare(b.endedAt));
console.log(`Writing ${events.length} events, ${games.length} games and ${feedback.length} feedback forms…`);
for (const e of events) await store.addEvent(e);
for (const g of games) await store.addGame(g);
for (const f of feedback) await store.addFeedback(f);
await store.close();
console.log(`Done: ${visitors.length} simulated visitors over ${DAYS} days, ${tables} tables. Open /admin to look. Remove with: pnpm admin:seed -- --remove`);
process.exit(0);
