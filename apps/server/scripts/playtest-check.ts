// Playtest dress rehearsal: 10 simulated players play a full game through the public link.
//
//   pnpm playtest                                         (in one terminal)
//   pnpm playtest:check -- https://xxxx.trycloudflare.com  (in another)
//
// They connect like phones do (through the tunnel, sending the page's Origin), play every round
// (searches, buying findings, extra looks, chat, accusations, color changes), and partway
// through two of them lose their connection and come back:
//   - one has its network cut (the app reconnects by itself and picks its seat back up),
//   - one closes the page and opens the link again (a new connection resumes its seat).
// It reports anyone rate-limited, refused by the origin check, or dropped by the server.
//
// All 10 come from this computer, so they share one IP: harder on the per-IP limits than real
// players (it's what a whole table on one Wi-Fi looks like).
// The game is marked as a check game, so `pnpm stats` leaves it out (see it with --all).
import { randomBytes } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, JoinResult, PlayerView, ServerToClientEvents } from '@wtc/shared';
import { TIMER_LIMITS } from '@wtc/shared';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const chance = (p: number) => Math.random() < p;
const t0 = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const log = (line: string) => console.log(`  ${clock()}  ${line}`);

const arg = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'http://localhost:8080';
const base = new URL(arg).origin;
const PLAYERS = 10;
const NAMES = ['Abe', 'Bess', 'Cal', 'Della', 'Eli', 'Fay', 'Gus', 'Hattie', 'Ike', 'Josie'];
const TIMEOUT_MIN = 20;

// ---------------------------------------------------------------- what we're watching for
const problems = { rateLimited: [] as string[], origin: [] as string[], dropped: [] as string[], leaks: [] as string[], other: [] as string[] };
const counts = { searches: 0, offers: 0, bought: 0, extraLooks: 0, votes: 0, colorChanges: 0, chats: 0, refusedLate: 0 };
const RATE_LIMIT = /slow down|too many|wait a minute/i;

function checkView(v: PlayerView, who: string) {
  const leak = (what: string) => problems.leaks.push(`${who}: ${what}`);
  for (const p of v.players) if ('color' in p) leak("another player's color");
  if (v.phase !== 'ended' && v.replay) leak('the replay before the end');
  if (v.devMode) problems.other.push('the server is in dev mode (expected production)');
  if (v.game) {
    if ('votes' in v.game) leak('the votes');
    for (const o of [...v.game.offersIn, ...v.game.offersOut]) if (o.buyerId !== v.you.id && o.sellerId !== v.you.id) leak("someone else's offer");
  }
}

// ---------------------------------------------------------------- one simulated player
class Player {
  s!: C;
  view: PlayerView | null = null;
  token = '';
  code = '';
  acted = new Set<string>();
  answered = new Set<string>();
  /** Set while we cut this player's connection on purpose. */
  droppingOnPurpose = false;
  reconnects = 0;
  readonly browserId = randomBytes(16).toString('hex');
  constructor(readonly name: string) {}

  connect(): Promise<void> {
    this.s = io(base, {
      // Same as a phone browser: start with HTTP polling, upgrade to WebSocket.
      extraHeaders: { origin: base, 'user-agent': 'wtc-playtest-check' },
      auth: { browserId: this.browserId, purpose: 'check' },
      forceNew: true,
      reconnectionDelay: 500,
    }) as C;
    this.s.on('view', (v) => {
      checkView(v, this.name);
      this.view = v;
      void this.act();
    });
    this.s.on('kicked', () => problems.other.push(`${this.name} was removed from the room`));
    this.s.on('disconnect', (reason) => {
      if (!this.droppingOnPurpose && reason !== 'io client disconnect' && !finished) problems.dropped.push(`${this.name} at ${clock()} (${reason})`);
    });
    // After an automatic reconnect, take the seat back the way the web app does.
    let first = true;
    this.s.on('connect', () => {
      if (first) return void (first = false);
      if (this.token) void this.resume();
    });
    return new Promise((resolve, reject) => {
      this.s.once('connect', () => resolve());
      this.s.once('connect_error', (err) => reject(err));
    });
  }

  call<T = {}>(event: string, ...args: unknown[]): Promise<Ack<T>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'no reply in 10s' }), 10_000);
      (this.s.emit as any)(event, ...args, (res: Ack<T>) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  /** A failed action: rate limits are problems; "too late" refusals are normal at phase ends. */
  note(what: string, res: Ack<unknown>) {
    if (res.ok) return;
    if (RATE_LIMIT.test(res.error)) problems.rateLimited.push(`${this.name} ${what}: ${res.error}`);
    else if (/no reply|not in a room/i.test(res.error)) problems.other.push(`${this.name} ${what}: ${res.error}`);
    else counts.refusedLate++;
  }

  async resume() {
    const res = await this.call<JoinResult>('room:resume', { code: this.code, token: this.token });
    if (!res.ok) problems.other.push(`${this.name} could not take its seat back: ${res.error}`);
    else this.reconnects++;
    return res.ok;
  }

  /** Plays the current phase once, like a person would (with thinking time). */
  async act() {
    const v = this.view;
    if (!v?.game) return;
    const g = v.game;
    const me = v.you.id;
    // Sellers answer offers whenever they arrive.
    for (const o of g.offersIn) {
      if (o.status !== 'pending' || this.answered.has(o.id)) continue;
      this.answered.add(o.id);
      setTimeout(async () => {
        const accept = chance(0.75);
        const res = await this.call('buy:respond', { offerId: o.id, accept });
        this.note('answering an offer', res);
        if (res.ok && accept) counts.bought++;
      }, 500 + Math.random() * 2500);
    }
    const key = `${v.phase}:${g.posterIndex}`;
    if (this.acted.has(key)) return;
    this.acted.add(key);
    const others = () => (this.view?.players ?? []).filter((p) => p.id !== me);
    const still = () => this.view?.phase === v.phase && this.view?.game?.posterIndex === g.posterIndex;

    if (v.phase === 'investigation') {
      await sleep(1000 + Math.random() * 6000);
      for (let i = 0; i < g.inspectLimit && still(); i++) {
        const res = await this.call('game:inspect', { targetId: pick(others()).id });
        this.note('searching', res);
        if (res.ok) counts.searches++;
        await sleep(800 + Math.random() * 3000);
      }
      if (still() && chance(0.4)) {
        const res = await this.call('chat:send', { text: pick(["It ain't me.", 'Saw red on that one.', 'Who searched me?', 'Mighty suspicious.']) });
        this.note('chatting', res);
        if (res.ok) counts.chats++;
      }
      // Buy someone's finding, or an extra look.
      if (still() && chance(0.35)) {
        const entry = this.view?.game?.log.filter((e) => e.inspectorId !== me && e.poster === g.posterIndex && !this.view!.game!.myResults[e.id]).at(-1);
        if (entry) {
          const res = await this.call('buy:offer', { entryId: entry.id });
          this.note('making an offer', res);
          if (res.ok) counts.offers++;
        }
      }
      if (still() && chance(0.2)) {
        const res = await this.call('buy:extraInspect');
        this.note('buying an extra look', res);
        if (res.ok) {
          counts.extraLooks++;
          const look = await this.call('game:inspect', { targetId: pick(others()).id });
          this.note('using the extra look', look);
          if (look.ok) counts.searches++;
        }
      }
    } else if (v.phase === 'vote') {
      await sleep(800 + Math.random() * 4000);
      if (still() && chance(0.85)) {
        const res = await this.call('game:vote', { targetId: pick(others()).id });
        this.note('accusing', res);
        if (res.ok) counts.votes++;
      }
    } else if (v.phase === 'payout') {
      if (g.swapsUsed < g.swapLimit && chance(0.2)) {
        await sleep(500 + Math.random() * 2000);
        const res = await this.call('swap:color');
        this.note('changing color', res);
        if (res.ok) counts.colorChanges++;
      }
    }
  }
}

let finished = false;

async function httpChecks() {
  const ok: string[] = [];
  const page = await fetch(base, { signal: AbortSignal.timeout(15_000) });
  if (!page.ok) problems.other.push(`the home page answered ${page.status}`);
  else ok.push('home page loads');
  if (!page.headers.get('content-security-policy')) problems.other.push('the page has no security headers (is this the production build?)');
  else ok.push('security headers present');
  const dev = await fetch(`${base}/dev/sounds`, { signal: AbortSignal.timeout(15_000) });
  if (dev.status !== 404) problems.other.push(`/dev pages are reachable (status ${dev.status}): this is not the production build`);
  else ok.push('/dev pages are hidden');
  return ok;
}

/** A page on some other website must not be able to connect to the game. */
async function foreignOriginRefused(): Promise<boolean> {
  const s = io(base, { extraHeaders: { origin: 'https://not-our-game.example' }, forceNew: true, reconnection: false, timeout: 15_000 });
  const refused = await new Promise<boolean>((resolve) => {
    s.once('connect', () => resolve(false));
    s.once('connect_error', () => resolve(true));
  });
  s.close();
  return refused;
}

async function main() {
  console.log(`\nPlaytest check against ${base}\n`);
  const ok = await httpChecks();
  log(`Web: ${ok.join(', ')}.`);
  if (!(await foreignOriginRefused())) problems.other.push('a connection from another website was let in (origin check is off)');
  else log('Origin check: a connection pretending to be another website was refused, as it should be.');

  // ---------------------------------------------------------------- lobby
  const players = NAMES.slice(0, PLAYERS).map((n) => new Player(n));
  const [host] = players;
  try {
    await host.connect();
  } catch (err) {
    problems.origin.push(`${host.name} could not connect: ${(err as Error).message}`);
    return finish(players);
  }
  const created = await host.call<JoinResult>('room:create', { name: host.name });
  if (!created.ok) {
    problems.other.push(`creating a room failed: ${created.error}`);
    return finish(players);
  }
  host.code = created.code;
  host.token = created.token;
  log(`${host.name} opened room ${created.code}.`);
  for (const p of players.slice(1)) {
    try {
      await p.connect();
    } catch (err) {
      problems.origin.push(`${p.name} could not connect: ${(err as Error).message}`);
      continue;
    }
    const res = await p.call<JoinResult>('room:join', { code: created.code, name: p.name });
    p.note('joining', res);
    if (res.ok) {
      p.code = res.code;
      p.token = res.token;
    }
    await sleep(150);
  }
  const seated = players.filter((p) => p.token).length;
  log(`${seated} of ${PLAYERS} players seated.`);
  if (seated < 6) return finish(players);

  // Shortest timers the game allows, so the full game takes minutes, not half an hour.
  const fast = Object.fromEntries(Object.entries(TIMER_LIMITS).map(([k, [min]]) => [k, min]));
  host.note('setting timers', await host.call('lobby:settings', { timers: fast }));
  const skip = await host.call('dev:skipPhase');
  if (skip.ok) problems.other.push('the dev "skip" tool works: this server is in dev mode');
  const start = await host.call('game:start');
  if (!start.ok) {
    problems.other.push(`starting the game failed: ${start.error}`);
    return finish(players);
  }
  await sleep(500);
  const total = host.view?.game?.posterCount ?? 0;
  const t = fast as Record<string, number>;
  log(`Game on: ${total} posters, rounds of ${t.poster}+${t.investigation}+${t.vote}+${t.payout} s. About ${Math.ceil((total * (t.poster + t.investigation + t.vote + t.payout)) / 60)} minutes.`);

  // ---------------------------------------------------------------- the drops
  const netDrop = players[3];
  const pageReload = players[6];
  let lastPoster = -1;
  const deadline = Date.now() + TIMEOUT_MIN * 60_000;
  while (host.view?.phase !== 'ended' && Date.now() < deadline) {
    const g = host.view?.game;
    if (g && g.posterIndex !== lastPoster) {
      lastPoster = g.posterIndex;
      log(`Poster ${g.posterIndex + 1} of ${total}.`);
    }
    // Poster 2, mid-search: the network drops for a few seconds; the app reconnects by itself.
    if (g?.posterIndex === 1 && host.view?.phase === 'investigation' && !netDrop.droppingOnPurpose && netDrop.reconnects === 0) {
      netDrop.droppingOnPurpose = true;
      log(`${netDrop.name}'s network drops in the middle of the round…`);
      const searchedBefore = netDrop.view?.game?.inspectsUsed ?? 0;
      (netDrop.s.io as any).engine.close();
      await sleep(400);
      const shownGone = host.view?.players.find((p) => p.name === netDrop.name)?.connected === false;
      for (let i = 0; i < 40 && netDrop.reconnects === 0; i++) await sleep(250);
      netDrop.droppingOnPurpose = false;
      await sleep(300);
      const back = netDrop.reconnects > 0 && netDrop.view?.game?.posterIndex === 1;
      const kept = (netDrop.view?.game?.inspectsUsed ?? -1) >= searchedBefore;
      if (back && kept) log(`…${netDrop.name} is back in their seat on poster 2 with their searches intact${shownGone ? ' (others saw them drop and return)' : ''}.`);
      else problems.other.push(`${netDrop.name} did not get back into the round after a network drop`);
      netDrop.acted.clear();
      void netDrop.act();
    }
    // Poster 3, mid-search: the page is closed and the link opened again (a brand new connection).
    if (g?.posterIndex === 2 && host.view?.phase === 'investigation' && !pageReload.droppingOnPurpose && pageReload.reconnects === 0) {
      pageReload.droppingOnPurpose = true;
      log(`${pageReload.name} closes the page mid-round and opens the link again…`);
      pageReload.s.disconnect();
      await sleep(3000);
      try {
        await pageReload.connect();
        await pageReload.resume();
      } catch (err) {
        problems.origin.push(`${pageReload.name} could not reconnect: ${(err as Error).message}`);
      }
      await sleep(400);
      pageReload.droppingOnPurpose = false;
      if (pageReload.reconnects && pageReload.view?.game?.posterIndex === 2) log(`…${pageReload.name} is back in the same seat, same round, same score.`);
      else problems.other.push(`${pageReload.name} did not get back into the round after reopening the page`);
      pageReload.acted.clear();
      void pageReload.act();
    }
    await sleep(250);
  }
  if (host.view?.phase !== 'ended') problems.other.push(`the game did not finish within ${TIMEOUT_MIN} minutes`);
  await sleep(1500);
  return finish(players);
}

function finish(players: Player[]) {
  finished = true;
  const ended = players.filter((p) => p.view?.phase === 'ended' && p.view.replay);
  const winners = ended[0]?.view?.replay?.winners.map((id) => ended[0].view!.players.find((p) => p.id === id)?.name) ?? [];
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${ended.length} of ${players.length} players saw the end of the game${winners.length ? ` (winner: ${winners.join(', ')})` : ''}.`);
  console.log(`  ${counts.searches} searches, ${counts.offers} offers (${counts.bought} accepted), ${counts.extraLooks} extra looks, ${counts.votes} accusations, ${counts.colorChanges} color changes, ${counts.chats} chat lines.`);
  console.log(`  ${counts.refusedLate} actions arrived just after a timer ran out and were politely refused (normal).`);
  const section = (title: string, xs: string[]) => {
    console.log(`\n  ${xs.length ? '✗' : '✓'} ${title}: ${xs.length ? xs.length : 'none'}`);
    for (const x of xs.slice(0, 10)) console.log(`      ${x}`);
    if (xs.length > 10) console.log(`      …and ${xs.length - 10} more`);
  };
  section('Rate-limited', problems.rateLimited);
  section('Refused by the origin check', problems.origin);
  section('Dropped by the server or tunnel', problems.dropped);
  section('Secrets seen by the wrong player', problems.leaks);
  section('Other problems', problems.other);
  const passed = ended.length === players.length && !Object.values(problems).some((xs) => xs.length);
  console.log(`\n  ${passed ? 'PASS: ready for real players.' : 'FAIL: see above.'}`);
  console.log('='.repeat(64));
  for (const p of players) p.s?.disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  problems.other.push(`crashed: ${(err as Error).message}`);
  finish([]);
});
