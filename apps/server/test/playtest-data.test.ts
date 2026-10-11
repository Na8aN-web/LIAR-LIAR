import { afterEach, describe, expect, it } from 'vitest';
import type { GameSummary } from '../src/game/summary';
import type { FeedbackEntry } from '../src/room';
import { type Client, sleep, startServer, until } from './helpers/net';

// Playtest data: the per-game stats line, the How to Play status, the end-of-game feedback
// form, and the playtest tunnel's changing origin.

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

const NO_LIMITS = { events: { burst: 1000, perSecond: 1000 }, colorProbe: { burst: 1000, perSecond: 1000 } };

/** Host + one more person + 4 bots, both people seated; returns everything needed to play. */
async function table(purpose?: string) {
  const ended: GameSummary[] = [];
  const feedback: FeedbackEntry[] = [];
  const t = await startServer({ onGameEnd: (s) => ended.push(s), onFeedback: (f) => feedback.push(f), limits: NO_LIMITS });
  cleanup = t.close;
  const a = await t.connect('A', { purpose });
  const created = await t.call(a, 'room:create', { name: 'Ada' });
  let b = await t.connect('B');
  const joined = await t.call(b, 'room:join', { code: created.code, name: 'Bo' });
  for (let i = 0; i < 4; i++) await t.call(a, 'lobby:addBot');
  return { ...t, a, b, created, joined, ended, feedback, setB: (c: Client) => (b = c), getB: () => b };
}

/** Skips through the whole game; A searches once per poster, B drops and reconnects on poster 2. */
async function playThrough(x: Awaited<ReturnType<typeof table>>) {
  const { a, call } = x;
  let dropped = false;
  for (let guard = 0; guard < 100 && a.latest!.phase !== 'ended'; guard++) {
    const v = a.latest!;
    if (v.phase === 'investigation') {
      await call(a, 'game:inspect', { targetId: v.players.find((p) => p.id !== v.you.id)!.id });
      if (v.game!.posterIndex === 1 && !dropped) {
        x.getB().disconnect();
        await sleep(50);
        const b = await x.connect('B2', { browserId: x.getB().browserId });
        expect((await call(b, 'room:resume', { code: x.created.code, token: x.joined.token })).ok).toBe(true);
        x.setB(b);
        dropped = true;
      }
    }
    if (v.phase === 'vote') await call(a, 'game:vote', { targetId: v.players.find((p) => p.id !== v.you.id)!.id });
    await call(a, 'dev:skipPhase');
    await sleep(20);
  }
  await until(a, (v) => v.phase === 'ended');
}

describe('playtest stats line', () => {
  it('records searches, accusations, drops, reconnects and How to Play per player, with no names or tokens', async () => {
    const x = await table();
    expect((await x.call(x.a, 'client:howto', { status: 'finished' })).ok).toBe(true);
    await x.call(x.b, 'client:howto', { status: 'skipped' });
    // Only ever upgrades: a later "never" (another device, cleared storage) doesn't erase "skipped".
    await x.call(x.b, 'client:howto', { status: 'never' });
    expect((await x.call(x.b, 'client:howto', { status: 'read it twice' })).ok).toBe(false);
    expect((await x.call(x.a, 'game:start')).ok).toBe(true);
    await playThrough(x);
    await sleep(50);

    expect(x.ended).toHaveLength(1);
    const s = x.ended[0];
    expect(s.check).toBeUndefined();
    expect(s.gameId).toMatch(/^[A-Za-z0-9_-]{6,}$/);
    expect(s.accusations).toHaveLength(s.posters.length);
    for (const r of s.accusations!) expect(r.correct + r.wrong + r.none).toBe(5);
    const ps = s.perPlayer!;
    expect(ps).toHaveLength(6);
    const [ada, bo] = ps;
    expect([ada.bot, bo.bot, ps[2].bot]).toEqual([false, false, true]);
    expect(ada.searches).toBe(s.posters.length);
    expect(ada.firstSearchSec).toHaveLength(s.posters.length);
    expect(ada.firstSearchSec.every((t) => typeof t === 'number' && t >= 0)).toBe(true);
    expect(bo.firstSearchSec.every((t) => t === null)).toBe(true);
    expect([ada.howto, bo.howto, ps[2].howto]).toEqual(['finished', 'skipped', null]);
    expect([bo.disconnects, bo.reconnects, ada.disconnects]).toEqual([1, 1, 0]);
    expect(ada.finished && bo.finished).toBe(true);

    const line = JSON.stringify(s);
    expect(line).not.toContain('Ada');
    expect(line).not.toContain('Bo"');
    expect(line).not.toContain(x.joined.token);
    expect(line).not.toContain(x.joined.playerId);
  });

  it('marks games played by the playtest check script, so the stats can leave them out', async () => {
    const x = await table('check');
    await x.call(x.a, 'game:start');
    await playThrough(x);
    await sleep(50);
    expect(x.ended[0].check).toBe(true);
  });
});

describe('feedback form', () => {
  it('opens only when the game ends, takes one form per player per game, and saves only the display name', async () => {
    const x = await table();
    const form = { confused: 'The fake colors', fun: 'Lying about red', noPointLying: 'No', pace: 'Votes too fast', playAgain: 'yes' };
    expect((await x.call(x.a, 'feedback:send', form)).ok).toBe(false);
    await x.call(x.a, 'game:start');
    expect((await x.call(x.a, 'feedback:send', form)).ok).toBe(false);
    await playThrough(x);

    expect((await x.call(x.a, 'feedback:send', form)).ok).toBe(true);
    expect((await x.call(x.a, 'feedback:send', form)).ok).toBe(false);
    expect((await x.call(x.getB(), 'feedback:send', {})).ok).toBe(false);
    expect((await x.call(x.getB(), 'feedback:send', { playAgain: 'definitely' })).ok).toBe(false);
    // Unknown fields (a token, anything else) get the whole form refused.
    expect((await x.call(x.getB(), 'feedback:send', { pace: 'ok', token: x.joined.token })).ok).toBe(false);
    const sneaky = { pace: `ok\u202e${'x'.repeat(2000)}`, playAgain: 'maybe' };
    expect((await x.call(x.getB(), 'feedback:send', sneaky)).ok).toBe(true);

    expect(x.feedback).toHaveLength(2);
    const [fa, fb] = x.feedback;
    expect(fa).toMatchObject({ name: 'Ada', gameId: x.ended[0].gameId, answers: form });
    expect(fb.name).toBe('Bo');
    expect(fb.answers.pace!.length).toBeLessThanOrEqual(500);
    expect(fb.answers.pace).not.toContain('\u202e');
    expect(fb.answers).toMatchObject({ confused: '', fun: '', noPointLying: '', playAgain: 'maybe' });
    expect(JSON.stringify(x.feedback)).not.toContain(x.joined.token);
  });
});

describe('playtest tunnel origin', () => {
  it('lets a new tunnel URL in without restarting the server', async () => {
    let allowed: string[] = [];
    const t = await startServer({ devMode: false, corsOrigin: () => allowed });
    cleanup = t.close;
    await expect(t.connect('before', { origin: 'https://first-try.trycloudflare.com' })).rejects.toThrow();
    allowed = ['https://first-try.trycloudflare.com'];
    await expect(t.connect('after', { origin: 'https://first-try.trycloudflare.com' })).resolves.toBeTruthy();
    // The tunnel restarted with a new URL: the old one stops working, the new one works.
    allowed = ['https://second-go.trycloudflare.com'];
    await expect(t.connect('old', { origin: 'https://first-try.trycloudflare.com' })).rejects.toThrow();
    await expect(t.connect('new', { origin: 'https://second-go.trycloudflare.com' })).resolves.toBeTruthy();
  });
});
