import { afterEach, describe, expect, it } from 'vitest';
import * as engine from '../src/game/engine';
import { sleep, startServer, until } from './helpers/net';

// The vote screen shows "6/9 have voted": everyone sees how many have voted, never who or for whom.

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('vote count', () => {
  it('reaches every player as a number only', async () => {
    const t = await startServer({ limits: { events: { burst: 1000, perSecond: 1000 } } });
    cleanup = t.close;
    const a = await t.connect('A');
    const b = await t.connect('B');
    const created = await t.call(a, 'room:create', { name: 'Ada' });
    await t.call(b, 'room:join', { code: created.code, name: 'Bo' });
    for (let i = 0; i < 4; i++) await t.call(a, 'lobby:addBot');
    await t.call(a, 'game:start');
    await until(a, (v) => v.phase === 'poster');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'investigation');
    await t.call(a, 'dev:skipPhase');
    await until(b, (v) => v.phase === 'vote');
    const before = b.latest!.game!.votesCast;

    const target = a.latest!.players.find((p) => p.isBot)!.id;
    expect((await t.call(a, 'game:vote', { targetId: target })).ok).toBe(true);
    // B is told one more vote is in, and nothing about whose or for whom.
    const seen = await until(b, (v) => v.game!.votesCast === before + 1);
    expect(seen.game!.myVote).toBeNull();
    const raw = JSON.stringify(b.inbox.filter((m) => m.event === 'view').at(-1));
    expect(raw).not.toMatch(/"votes"/);

  });

  it("counts the outlaw's vote exactly like everyone else's", async () => {
    const t = await startServer({ limits: { events: { burst: 1000, perSecond: 1000 } } });
    cleanup = t.close;
    const a = await t.connect('A');
    const created = await t.call(a, 'room:create', { name: 'Ada' });
    const others = await Promise.all([1, 2, 3, 4, 5].map((i) => t.connect(`P${i}`)));
    for (const [i, c] of others.entries()) await t.call(c, 'room:join', { code: created.code, name: `P${i}` });
    const all = [a, ...others];
    await t.call(a, 'game:start');
    await until(a, (v) => v.phase === 'poster');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'investigation');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'vote');
    const room = t.server.rooms.get(created.code)!;
    const outlawId = engine.wantedId(room.game!);
    const outlaw = all.find((c) => c.latest!.you.id === outlawId)!;
    const someoneElse = all.find((c) => c !== outlaw)!;

    // The outlaw votes first: the count goes up by one on everyone's screen, same as anyone's.
    const target = outlaw.latest!.players.find((p) => p.id !== outlawId)!.id;
    expect((await t.call(outlaw, 'game:vote', { targetId: target })).ok).toBe(true);
    for (const c of all) await until(c, (v) => v.game!.votesCast === 1);
    const voterTarget = someoneElse.latest!.players.find((p) => p.id !== someoneElse.latest!.you.id)!.id;
    expect((await t.call(someoneElse, 'game:vote', { targetId: voterTarget })).ok).toBe(true);
    for (const c of all) await until(c, (v) => v.game!.votesCast === 2);
  });

  it('resets each poster', async () => {
    const t = await startServer({ limits: { events: { burst: 1000, perSecond: 1000 } } });
    cleanup = t.close;
    const a = await t.connect('A');
    await t.call(a, 'room:create', { name: 'Ada' });
    for (let i = 0; i < 5; i++) await t.call(a, 'lobby:addBot');
    await t.call(a, 'game:start');
    await until(a, (v) => v.phase === 'poster');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'investigation');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'vote');
    await t.call(a, 'game:vote', { targetId: a.latest!.players.find((p) => p.isBot)!.id });
    await until(a, (v) => v.game!.votesCast >= 1);

    // Next poster: back to zero.
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'payout');
    await t.call(a, 'dev:skipPhase');
    await until(a, (v) => v.phase === 'poster');
    await sleep(50);
    expect(a.latest!.game!.votesCast).toBe(0);
  });
});
