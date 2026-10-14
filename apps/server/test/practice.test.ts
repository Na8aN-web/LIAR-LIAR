import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PRACTICE, type PlayerView } from '@wtc/shared';
import { Room } from '../src/room';
import { secureRng } from '../src/rng';

// Practice with bots: one human plus bots, three posters, slower timers, never in the stats,
// and it works with bots switched off (production). Normal rooms are unchanged.

const rooms: Room[] = [];
afterEach(() => rooms.splice(0).forEach((r) => r.dispose()));

function make(practice: boolean, devMode = false) {
  const sent: { socketId: string; event: string; payload: unknown }[] = [];
  const ended: unknown[] = [];
  const room = new Room('PRACT', {
    send: (socketId, event, ...args) => sent.push({ socketId, event, payload: args[0] }),
    rng: secureRng,
    devMode,
    minPlayers: 6,
    practice,
    onGameEnd: (s) => ended.push(s),
  });
  rooms.push(room);
  return { room, sent, ended };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('practice games', () => {
  it('seat the bots and start at once, with three posters and the practice timers', async () => {
    const { room, sent } = make(true);
    const me = room.addPlayer('Newbie', 'sock0');
    if (!me.ok) throw new Error(me.error);
    expect(room.startPractice(me.seat.id).ok).toBe(true);
    expect(room.seats.size).toBe(PRACTICE.bots + 1);
    expect(room.phase).toBe('poster');
    expect(room.game!.order).toHaveLength(PRACTICE.posters);
    expect(room.settings.timers).toEqual(PRACTICE.timers);
    await flush();
    const view = sent.filter((s) => s.event === 'view').at(-1)!.payload as PlayerView;
    expect(view.practice).toBe(true);
    expect(view.game!.posterCount).toBe(PRACTICE.posters);
  });

  it('cannot be joined by anyone else', () => {
    const { room } = make(true);
    const me = room.addPlayer('Newbie', 'sock0');
    if (!me.ok) throw new Error(me.error);
    expect(room.addPlayer('Stranger', 'sock1').ok).toBe(false);
  });

  it('are not counted in the game stats', async () => {
    const { room, ended } = make(true);
    const me = room.addPlayer('Newbie', 'sock0');
    if (!me.ok) throw new Error(me.error);
    room.startPractice(me.seat.id);
    // Run the game out (dev skip isn't available outside dev mode, so drive the phases directly).
    for (let i = 0; i < 40 && room.phase !== 'ended'; i++) (room as unknown as { onPhaseEnd: () => void }).onPhaseEnd();
    expect(room.phase).toBe('ended');
    expect(ended).toHaveLength(0);
  });

  it('leave normal rooms as they were: practice can’t be started there, every player gets a poster', () => {
    const { room } = make(false);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = room.addPlayer(`P${i}`, `sock${i}`);
      if (!r.ok) throw new Error(r.error);
      ids.push(r.seat.id);
    }
    // Bots are allowed in any room now (games with them are tagged withBots).
    expect(room.addBot(ids[0]).ok).toBe(true);
    expect(room.startPractice(ids[0]).ok).toBe(false);
    expect(room.start(ids[0]).ok).toBe(true);
    expect(room.game!.order).toHaveLength(DEFAULT_SETTINGS.posters);
    expect(room.settings.timers).toEqual(DEFAULT_SETTINGS.timers);
  });
});
