import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView, Reaction } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';

// Payout reactions are decided on the server and filtered per viewer. These tests watch
// every view the room sends to every player and check that no reaction ever gives away
// who was Wanted: to everyone but the Wanted player, a reaction is only ever what the
// public payout already shows (cheer = got paid, despair = didn't).

interface Sent {
  socketId: string;
  event: string;
  payload: unknown;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const isDespair = (r: Reaction | undefined) => r === 'despair-1' || r === 'despair-2';
let rooms: Room[] = [];
afterEach(() => {
  for (const r of rooms) r.dispose();
  rooms = [];
});

/** Plays a whole game with real seats. `voteFor(poster, wanted, voters)` returns who votes for the Wanted player. */
async function playGame(players: number, voteFor: (poster: number, wanted: string, ids: string[]) => string[]) {
  const sent: Sent[] = [];
  const room = new Room('REACT', {
    send: (socketId, event, ...args) => sent.push({ socketId, event, payload: args[0] }),
    rng: secureRng,
    devMode: true,
    minPlayers: 2,
  });
  rooms.push(room);
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const res = room.addPlayer(`P${i}`, `sock${i}`);
    if (!res.ok) throw new Error(res.error);
    ids.push(res.seat.id);
  }
  const host = ids[0];
  expect(room.updateSettings(host, { posters: players }).ok).toBe(true);
  expect(room.start(host).ok).toBe(true);
  const wantedByPoster: string[] = [];
  const skipTo = async (phase: string) => {
    for (let i = 0; i < 10 && room.phase !== phase; i++) room.skipPhase(host);
    await flush();
  };
  for (;;) {
    await skipTo('vote');
    const game = room.game!;
    const poster = game.posterIndex;
    const wanted = game.order[poster];
    wantedByPoster[poster] = wanted;
    const others = ids.filter((p) => p !== wanted);
    const right = new Set(voteFor(poster, wanted, others));
    for (const p of others) {
      // Wrong voters pick someone else who isn't Wanted; some players don't vote at all.
      if (right.has(p)) expect(room.vote(p, wanted).ok).toBe(true);
      else if (others.indexOf(p) % 3 !== 0) room.vote(p, others.find((o) => o !== p)!);
    }
    await skipTo('payout');
    if (room.phase === 'payout' && !room.game!.order[poster + 1]) {
      room.skipPhase(host);
      await flush();
      break;
    }
  }
  expect(room.phase).toBe('ended');
  const socketOf = new Map(ids.map((id) => [room.seats.get(id)!.socketId!, id]));
  const views = sent
    .filter((s) => s.event === 'view')
    .map((s) => ({ viewer: socketOf.get(s.socketId)!, view: s.payload as PlayerView }));
  return { room, ids, views, wantedByPoster };
}

/** Mix of outcomes: escapes, single catches, crowds, everyone-but-one. */
const pattern = (poster: number, _wanted: string, voters: string[]) => {
  switch (poster % 4) {
    case 0:
      return []; // escaped
    case 1:
      return voters.slice(0, 1);
    case 2:
      return voters.slice(0, Math.ceil(voters.length / 2));
    default:
      return voters; // everyone caught them
  }
};

describe('payout reactions', () => {
  it('never reveal the Wanted player to anyone else, in any view sent', async () => {
    for (const players of [6, 9, 15]) {
      const { views, wantedByPoster, ids } = await playGame(players, pattern);
      let payoutViews = 0;
      for (const { viewer, view } of views) {
        const g = view.game;
        if (!g?.reactions || view.phase !== 'payout') continue;
        payoutViews++;
        const poster = Number(g.reactions.key.replace('poster-', ''));
        expect(g.reactions.key).toBe(`poster-${g.posterIndex}`);
        const wanted = wantedByPoster[poster];
        // Everyone appears, nobody extra.
        expect(Object.keys(g.reactions.byPlayer).sort()).toEqual([...ids].sort());
        for (const [p, r] of Object.entries(g.reactions.byPlayer)) {
          if (p === viewer) continue;
          // What others see is exactly the public payout: cheer if paid, else despair.
          if ((g.scoreDeltas[p] ?? 0) > 0) expect(r).toBe('victory');
          else expect(isDespair(r)).toBe(true);
        }
        if (viewer !== wanted) expect(isDespair(g.reactions.byPlayer[wanted])).toBe(true);
      }
      expect(payoutViews).toBeGreaterThan(0);
    }
  });

  it('every non-Wanted viewer gets the identical reaction map', async () => {
    const { views, wantedByPoster } = await playGame(8, pattern);
    const seen = new Map<string, string>();
    for (const { viewer, view } of views) {
      const r = view.game?.reactions;
      if (!r || !r.key.startsWith('poster-')) continue;
      if (viewer === wantedByPoster[Number(r.key.slice(7))]) continue;
      const json = JSON.stringify(Object.entries(r.byPlayer).sort());
      const prev = seen.get(r.key);
      if (prev) expect(json).toBe(prev);
      else seen.set(r.key, json);
    }
    expect(seen.size).toBe(8);
  });

  it('shows the Wanted player their true result: cheer on escape, despair when caught', async () => {
    const { views, wantedByPoster } = await playGame(8, pattern);
    let checked = 0;
    for (const { viewer, view } of views) {
      const r = view.game?.reactions;
      if (!r || !r.key.startsWith('poster-')) continue;
      const poster = Number(r.key.slice(7));
      if (viewer !== wantedByPoster[poster]) continue;
      const escaped = poster % 4 === 0;
      if (escaped) expect(r.byPlayer[viewer]).toBe('victory');
      else expect(isDespair(r.byPlayer[viewer])).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('correct voters cheer and everyone else despairs', async () => {
    const { views, wantedByPoster } = await playGame(6, pattern);
    for (const { viewer, view } of views) {
      const r = view.game?.reactions;
      if (!r || !r.key.startsWith('poster-')) continue;
      const poster = Number(r.key.slice(7));
      if (viewer === wantedByPoster[poster]) continue;
      // Views are captured by reference here, so look the round up by poster number.
      const mine = view.game!.myRounds.find((x) => x.poster === poster)!;
      if (mine.correct) expect(r.byPlayer[viewer]).toBe('victory');
      else expect(isDespair(r.byPlayer[viewer])).toBe(true);
    }
  });

  it('are cleared when the next poster starts', async () => {
    const { views } = await playGame(6, pattern);
    for (const { view } of views) {
      if (view.phase === 'poster' || view.phase === 'investigation' || view.phase === 'vote') {
        expect(view.game?.reactions).toBeNull();
      }
    }
  });

  it('at the end of the game: winners cheer, everyone else despairs, same for everyone', async () => {
    const { views, ids } = await playGame(7, pattern);
    const end = views.filter((v) => v.view.phase === 'ended');
    expect(end.length).toBeGreaterThanOrEqual(ids.length);
    const first = JSON.stringify(end[0].view.game!.reactions);
    for (const { view } of end) {
      const r = view.game!.reactions!;
      expect(r.key).toBe('end');
      expect(JSON.stringify(r)).toBe(first);
      for (const p of ids) {
        if (view.replay!.winners.includes(p)) expect(r.byPlayer[p]).toBe('victory');
        else expect(isDespair(r.byPlayer[p])).toBe(true);
      }
    }
  });
});
