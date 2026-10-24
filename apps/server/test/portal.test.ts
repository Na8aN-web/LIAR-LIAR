import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, guestName, portalBase, portalFromPath, portalRoomPath, roomFromInvite, roomPresence } from '@wtc/shared';

// The adapter layer's pure part (packages/shared/src/portal.ts): which portal a page belongs to,
// where its rooms live, invites, and what the portal's friends features are told.

describe('portal pages', () => {
  it('only /play/<known portal> is a portal: every website page stays the website', () => {
    expect(portalFromPath('/play/crazygames')).toBe('crazygames');
    expect(portalFromPath('/play/crazygames/')).toBe('crazygames');
    expect(portalFromPath('/play/crazygames/r/ABCDE')).toBe('crazygames');
    for (const p of ['/', '/r/ABCDE', '/privacy', '/admin', '/play', '/play/', '/play/poki', '/play/crazygamesx', '/xplay/crazygames', '/dev/trailer/studio']) {
      expect(portalFromPath(p), p).toBe('web');
    }
  });

  it('rooms live under the portal’s base; the website’s stay at /r/CODE', () => {
    expect(portalBase('web')).toBe('');
    expect(portalRoomPath('web', 'ABCDE')).toBe('/r/ABCDE');
    expect(portalBase('crazygames')).toBe('/play/crazygames');
    expect(portalRoomPath('crazygames', 'ABCDE')).toBe('/play/crazygames/r/ABCDE');
  });
});

describe('invites', () => {
  it('take a well-formed room code from the invite parameters, and nothing else', () => {
    expect(roomFromInvite({ room: 'ABCDE' })).toBe('ABCDE');
    expect(roomFromInvite({ room: ' abcde ' })).toBe('ABCDE');
    expect(roomFromInvite(null)).toBeNull();
    expect(roomFromInvite({})).toBeNull();
    expect(roomFromInvite({ room: 'ABCD' })).toBeNull();
    expect(roomFromInvite({ room: 'ABCDEF' })).toBeNull();
    // Look-alike letters (O, I, L, 0, 1) never appear in codes.
    expect(roomFromInvite({ room: 'OIL01' })).toBeNull();
    expect(roomFromInvite({ room: '../admin' })).toBeNull();
    expect(roomFromInvite({ room: 12345 as unknown as string })).toBeNull();
    // Names people type by hand in the QA tool work too; ours (room) wins.
    expect(roomFromInvite({ roomName: 'abcde' })).toBe('ABCDE');
    expect(roomFromInvite({ roomId: 'ABCDE' })).toBe('ABCDE');
    expect(roomFromInvite({ room: 'HJKMN', roomName: 'ABCDE' })).toBe('HJKMN');
    expect(roomFromInvite({ roomName: '123' })).toBeNull();
  });
});

describe('room presence (the portal’s Join / Invite buttons)', () => {
  const view = (o: Partial<Parameters<typeof roomPresence>[0]> = {}) => ({ code: 'ABCDE', phase: 'lobby' as const, players: [1, 2], maxPlayers: MAX_PLAYERS, locked: false, practice: false, ...o });

  it('is joinable in an open lobby, with the room in the invite', () => {
    expect(roomPresence(view())).toEqual({ roomId: 'ABCDE', isJoinable: true, inviteParams: { room: 'ABCDE' } });
  });

  it('is not joinable once a game starts, when full, locked, or a practice game', () => {
    for (const phase of ['poster', 'investigation', 'vote', 'payout', 'ended'] as const) expect(roomPresence(view({ phase })).isJoinable, phase).toBe(false);
    expect(roomPresence(view({ players: Array(MAX_PLAYERS).fill(0) })).isJoinable).toBe(false);
    expect(roomPresence(view({ locked: true })).isJoinable).toBe(false);
    expect(roomPresence(view({ practice: true })).isJoinable).toBe(false);
  });
});

describe('guest names', () => {
  it('are a western word and four digits, never empty, within the name limit', () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const n = guestName(rand);
      expect(n).toMatch(/^[A-Z][a-z]+ \d{4}$/);
      expect(n.length).toBeLessThanOrEqual(20);
    }
  });
});
