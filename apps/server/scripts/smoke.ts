// End-to-end smoke test: 2 humans + 4 bots play a full game over real sockets,
// using dev skip-phase to go fast. Also checks reconnect and view leaks.
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, PlayerView, ServerToClientEvents } from '@wtc/shared';
import { createGameServer } from '../src/server';

type C = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function checkView(v: PlayerView, label: string) {
  for (const p of v.players) assert(!('color' in p), `${label}: public player has a color`);
  if (v.phase !== 'ended') assert(v.replay === null, `${label}: replay before end`);
  if (v.game) {
    assert(!('votes' in v.game), `${label}: votes leaked`);
    for (const o of [...v.game.offersIn, ...v.game.offersOut]) {
      assert(o.buyerId === v.you.id || o.sellerId === v.you.id, `${label}: someone else's offer leaked`);
    }
  }
}

async function main() {
  const server = createGameServer({ port: 0, devMode: true, minPlayers: 6 });
  const port = await server.listen();
  const url = `http://localhost:${port}`;
  const connect = () => io(url, { transports: ['websocket'], forceNew: true }) as C;
  const call = <T>(s: C, ev: string, ...args: unknown[]) =>
    new Promise<T>((resolve) => (s.emit as any)(ev, ...args, resolve));

  const views: Record<string, PlayerView> = {};
  let bViewCount = 0;
  const track = (s: C, label: string) =>
    s.on('view', (v) => {
      checkView(v, label);
      views[label] = v;
      if (label === 'B') bViewCount++;
    });

  const a = connect();
  track(a, 'A');
  const created: any = await call(a, 'room:create', { name: 'Ada' });
  assert(created.ok, 'create');
  assert(/^[A-HJKMNP-Z2-9]{5}$/.test(created.code), `room code format ${created.code}`);

  let b = connect();
  track(b, 'B');
  const joined: any = await call(b, 'room:join', { code: created.code.toLowerCase(), name: 'ada' });
  assert(joined.ok, 'join');

  for (let i = 0; i < 4; i++) assert(((await call(a, 'lobby:addBot')) as any).ok, 'add bot');
  const notHost: any = await call(b, 'game:start');
  assert(!notHost.ok, 'non-host cannot start');

  const colors: any = await call(b, 'lobby:colors');
  assert(colors.ok && colors.available.length === 20 - 6 + 1, `available colors ${colors.available?.length}`);
  assert(((await call(b, 'lobby:setLook', { color: views.A.you.color })) as any).ok === false, 'cannot take a taken color');

  assert(((await call(a, 'game:start')) as any).ok, 'start');
  await sleep(100);
  assert(views.B.you.name === 'ada 2', `dedupe name: ${views.B.you.name}`);
  const total = views.A.game!.posterCount;
  assert(total === 6, 'poster count');

  let reconnected = false;
  let bought = false;
  let swapped = false;
  let expectedRefund: { offerId: string; score: number } | null = null;
  for (let guard = 0; guard < 200 && views.A.phase !== 'ended'; guard++) {
    const v = views.A;
    if (v.phase === 'investigation') {
      const target = v.players.find((p) => p.id !== v.you.id)!;
      const r: any = await call(a, 'game:inspect', { targetId: target.id });
      assert(r.ok && r.result.length === v.settings.rules.decoys + 1, 'inspect: real color + decoys');
      assert(!r.result.includes(v.you.color), 'inspector color in result');
      const self: any = await call(a, 'game:inspect', { targetId: v.you.id });
      assert(!self.ok, 'self inspect blocked');
      await call(b, 'chat:send', { text: 'It is definitely not me' });

      if (v.game!.posterIndex === 0) {
        // Buying: B inspects twice, A buys one result (accepted) and offers on the other (left to expire).
        const others = views.B.players.filter((p) => p.id !== views.B.you.id);
        const r1: any = await call(b, 'game:inspect', { targetId: others[0].id });
        const r2: any = await call(b, 'game:inspect', { targetId: others[1].id });
        assert(r1.ok && r2.ok, 'B inspects');
        const scoreA = views.A.game!.myScore;
        const scoreB = views.B.game!.myScore;
        const o1: any = await call(a, 'buy:offer', { entryId: r1.entryId });
        assert(o1.ok, `offer: ${o1.error}`);
        assert(!((await call(a, 'buy:offer', { entryId: r1.entryId })) as any).ok, 'duplicate offer blocked');
        const o2: any = await call(a, 'buy:offer', { entryId: r2.entryId });
        assert(o2.ok, 'second offer');
        await sleep(60);
        assert(views.B.game!.offersIn.filter((o) => o.status === 'pending').length === 2, 'seller sees offers');
        assert(views.A.game!.myScore === scoreA - 40, 'escrow');
        assert(!((await call(a, 'buy:respond', { offerId: o1.offerId, accept: true })) as any).ok, 'buyer cannot accept');
        assert(((await call(b, 'buy:respond', { offerId: o1.offerId, accept: true })) as any).ok, 'accept');
        await sleep(60);
        assert(JSON.stringify(views.A.game!.myResults[r1.entryId]) === JSON.stringify(r1.result), 'buyer gets stored result');
        assert(views.B.game!.myScore === scoreB + 20, 'seller paid');
        assert(views.A.game!.purchasesUsed === 1, 'purchase counted');
        const ex: any = await call(a, 'buy:extraInspect');
        assert(ex.ok, `extra inspect: ${ex.error}`);
        await sleep(60);
        assert(views.A.game!.extraInspects === 1, 'extra inspect granted');
        // Cap: 1 accepted + 1 extra + 1 pending = 3.
        assert(!((await call(a, 'buy:extraInspect')) as any).ok, 'purchase cap');
        assert(views.A.game!.myScore === scoreA - 20 - 20 - 50, 'score after purchases');
        expectedRefund = { offerId: o2.offerId, score: views.A.game!.myScore + 20 };
      }

      if (!reconnected && v.game!.posterIndex === 1) {
        b.disconnect();
        await sleep(100);
        assert(views.A.players.find((p) => p.id === joined.playerId)!.connected === false, 'B shown disconnected');
        b = connect();
        track(b, 'B');
        const res: any = await call(b, 'room:resume', { code: created.code, token: joined.token });
        assert(res.ok, 'resume');
        await sleep(100);
        assert(views.B.phase === 'investigation' && views.B.game!.posterIndex === 1, 'resync after resume');
        reconnected = true;
      }
    }
    if (v.phase === 'vote' && expectedRefund) {
      const o = views.A.game!.offersOut.find((x) => x.id === expectedRefund!.offerId);
      assert(o?.status === 'expired', `offer expired at end of investigation (${o?.status})`);
      assert(views.A.game!.myScore === expectedRefund.score, 'expired offer refunded');
      expectedRefund = null;
      bought = true;
    }
    if (v.phase === 'vote') {
      const target = v.players.find((p) => p.id !== v.you.id)!;
      assert(((await call(a, 'game:vote', { targetId: target.id })) as any).ok, 'vote');
      assert(!((await call(a, 'game:vote', { targetId: target.id })) as any).ok, 'double vote blocked');
    }
    if (v.phase === 'payout' && v.game!.posterIndex === 0 && !swapped) {
      const bViewsBefore = bViewCount;
      const sw: any = await call(a, 'swap:color');
      assert(sw.ok, `swap: ${sw.error}`);
      assert(!('available' in sw), 'no free-color list in the reply');
      await sleep(80);
      assert(views.A.you.color === sw.color, 'swapper sees the assigned color');
      assert(bViewCount === bViewsBefore, 'other players get no update when someone swaps');
      swapped = true;
    }
    if (v.phase === 'poster' && swapped && v.game!.posterIndex === 1) {
      assert((views.B.game!.colorChanges[1] ?? 0) >= 1, 'public swap count at next poster');
    }
    assert(((await call(a, 'dev:skipPhase')) as any).ok, `skip ${v.phase}`);
    await sleep(60);
  }

  const end = views.A;
  assert(end.phase === 'ended', 'game ended');
  assert(reconnected, 'reconnect exercised');
  assert(bought, 'buying exercised');
  assert(swapped, 'swap exercised');
  assert(Object.values(end.replay!.colorHistory).some((h) => h.length > 1), 'replay has color history');
  assert(end.replay!.posters.length === total, 'replay posters');
  assert(end.replay!.winners.length >= 1, 'winners');
  assert(Object.keys(end.replay!.colors).length === 6, 'replay colors');
  const sum = Object.values(end.replay!.finalScores).reduce((x, y) => x + y, 0);
  console.log('scores', end.replay!.finalScores, 'sum', sum);
  console.log(`PASS: room ${created.code}, ${total} posters, ${end.replay!.log.length} inspects, winners ${end.replay!.winners.length}`);

  a.disconnect();
  b.disconnect();
  await server.close();
  process.exit(0);
}

main();
