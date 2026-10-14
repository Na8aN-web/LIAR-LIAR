import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_IDS, defaultSwaps, type PlayerView } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';

interface Sent {
  socketId: string;
  event: string;
  payload: unknown;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
let rooms: Room[] = [];
afterEach(() => {
  for (const r of rooms) r.dispose();
  rooms = [];
});

/** A room with real seats (fake sockets), started, with colorSwaps set. */
async function startedRoom(colorSwaps: number | 'auto' = 2, players = 6) {
  const sent: Sent[] = [];
  const room = new Room('TEST1', {
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
  expect(room.updateSettings(host, { colorSwaps }).ok).toBe(true);
  expect(room.start(host).ok).toBe(true);
  const goTo = async (phase: string) => {
    for (let i = 0; i < 10 && room.phase !== phase; i++) room.skipPhase(host);
    expect(room.phase).toBe(phase);
    await flush();
  };
  const socketOf = (id: string) => room.seats.get(id)!.socketId!;
  const viewsTo = (id: string, from = 0) =>
    sent.slice(from).filter((s) => s.event === 'view' && s.socketId === socketOf(id)).map((s) => s.payload as PlayerView);
  const unique = () => {
    const colors = Object.values(room.game!.colors);
    return new Set(colors).size === colors.length;
  };
  return { room, ids, host, sent, goTo, viewsTo, unique };
}

describe('color swaps', () => {
  it('are only allowed during the payout, and never after the last poster', async () => {
    const { room, ids, goTo } = await startedRoom();
    for (const phase of ['poster', 'investigation', 'vote']) {
      await goTo(phase);
      const res = room.swapColor(ids[1]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/payout/i);
    }
    await goTo('payout');
    expect(room.swapColor(ids[1]).ok).toBe(true);

    const game = room.game!;
    while (game.posterIndex < game.order.length - 1) room.skipPhase(ids[0]);
    await goTo('payout');
    expect(room.swapColor(ids[2]).ok).toBe(false);
  });

  it('assigns a random free palette color, keeping every color unique', async () => {
    const { room, ids, goTo, unique } = await startedRoom(5, 15);
    await goTo('payout');
    for (const id of ids) {
      const before = room.game!.colors[id];
      const res = room.swapColor(id);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(COLOR_IDS).toContain(res.color);
        expect(res.color).not.toBe(before);
        expect(room.game!.colors[id]).toBe(res.color);
      }
      expect(unique()).toBe(true);
    }
  });

  it('never sends a free-color list: the reply carries only your new color', async () => {
    const { room, ids, goTo } = await startedRoom();
    await goTo('payout');
    const res = room.swapColor(ids[1]);
    expect(Object.keys(res).sort()).toEqual(['color', 'ok']);
    const failed = room.swapColor(ids[1]); // second swap this payout
    expect(Object.keys(failed).sort()).toEqual(['error', 'ok']);
  });

  it('allows one swap per payout, and it is final', async () => {
    const { room, ids, goTo } = await startedRoom(2);
    const p = ids[1];
    await goTo('payout');
    const first = room.swapColor(p);
    expect(first.ok).toBe(true);
    const again = room.swapColor(p);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/One dirty trick per round/);
    expect(room.game!.swapsUsed[p]).toBe(1);
    if (first.ok) expect(room.game!.colors[p]).toBe(first.color);
    // Next payout: allowed again.
    await goTo('poster');
    await goTo('payout');
    expect(room.swapColor(p).ok).toBe(true);
  });

  it('enforces the per-game limit across payouts', async () => {
    const { room, ids, goTo } = await startedRoom(2);
    const p = ids[1];
    for (let k = 0; k < 2; k++) {
      await goTo('payout');
      expect(room.swapColor(p).ok).toBe(true);
      await goTo('poster');
    }
    await goTo('payout');
    const third = room.swapColor(p);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toMatch(/No color changes left/);
  });

  it("'auto' allows one change per payout (each one is paid for)", async () => {
    expect([6, 8, 10, 12, 15].map(defaultSwaps)).toEqual([5, 7, 9, 11, 14]);
    const { room } = await startedRoom('auto', 10);
    expect(room.game!.swapLimit).toBe(9);
  });

  it('rejects swaps from disconnected players', async () => {
    const { room, ids, goTo } = await startedRoom();
    await goTo('payout');
    room.disconnect(ids[3], room.seats.get(ids[3])!.socketId!);
    expect(room.swapColor(ids[3]).ok).toBe(false);
  });

  it('announces nothing, charges the swapper, and the poster uses current colors', async () => {
    const { room, ids, goTo, viewsTo } = await startedRoom();
    await goTo('payout');
    const nextWanted = room.game!.order[1];
    const swappers = [nextWanted, ids.find((id) => id !== nextWanted)!];
    const newColors: Record<string, string> = {};
    const before = Object.fromEntries(swappers.map((s) => [s, room.game!.scores[s]]));
    const pot = room.game!.pots[1];
    for (const s of swappers) {
      const res = room.swapColor(s);
      if (!res.ok) throw new Error(res.error);
      newColors[s] = res.color;
    }
    const price = room.game!.rules.swapPrice;
    expect(price).toBeGreaterThan(0);
    for (const s of swappers) expect(room.game!.scores[s]).toBe(before[s] - price);
    expect(room.game!.pots[1]).toBe(pot + 2 * price);
    await goTo('poster');
    for (const id of ids) {
      const v = viewsTo(id).at(-1)!;
      expect('colorChanges' in v.game!).toBe(false);
      expect(v.game!.posterColor).toBe(newColors[nextWanted]);
    }
  });

  it('never tells another client who swapped', async () => {
    const { room, ids, sent, goTo, viewsTo } = await startedRoom();
    await goTo('payout');
    const swapper = ids.find((id) => id !== room.game!.order[1] && id !== ids[0])!;
    const before = sent.length;
    const res = room.swapColor(swapper);
    if (!res.ok) throw new Error(res.error);
    const newColor = res.color;
    await flush();
    // Only the swapper got an update at the moment of the swap.
    const recipients = new Set(sent.slice(before).map((s) => s.socketId));
    expect([...recipients]).toEqual([room.seats.get(swapper)!.socketId]);
    const own = viewsTo(swapper, before).at(-1)!;
    expect(own.you.color).toBe(newColor);
    expect(own.game!.swapsUsed).toBe(1);

    await goTo('poster');
    await goTo('investigation');
    for (const id of ids.filter((x) => x !== swapper)) {
      for (const v of viewsTo(id)) {
        expect(JSON.stringify(v)).not.toContain(`"${newColor}"`);
        if (v.game) {
          expect(v.game.myColorHistory).toEqual([{ color: room.game!.colorHistory[id][0].color, afterPoster: null }]);
          expect(v.game.trickThisPayout).toBeNull();
          expect(v.game.swapsUsed).toBe(0);
        }
      }
    }
    expect(viewsTo(swapper).at(-1)!.game!.myColorHistory).toEqual([
      { color: room.game!.colorHistory[swapper][0].color, afterPoster: null },
      { color: newColor, afterPoster: 0 },
    ]);
  });
});
