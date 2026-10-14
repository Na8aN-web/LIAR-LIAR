import { COLOR_IDS, colorInfo, type ColorId } from './palette';
import type { PlayerId } from './types';

// Quick chat: a fixed list of phrases, built by tapping a player and/or a color. The server
// turns the choice into text, so no quick-chat message ever contains anything a player typed.
// Phrases can be lies on purpose ("I'm clear", "Hank is Red"): lying is the game.
// When a portal switches chat off, quick chat is all that's left.

export type QuickChatKind = 'clear' | 'notMe' | 'accuse' | 'claimColor' | 'searched' | 'trustMe' | 'liar';

export interface QuickChat {
  kind: QuickChatKind;
  /** The player the phrase is about (accuse, claimColor, searched, and optionally liar). */
  player?: PlayerId;
  /** The color claimed (claimColor). */
  color?: ColorId;
}

export interface QuickPhrase {
  kind: QuickChatKind;
  /** Menu label, with the blanks shown. */
  label: string;
  needs: { player: 'no' | 'yes' | 'optional'; color: boolean };
}

export const QUICK_PHRASES: QuickPhrase[] = [
  { kind: 'clear', label: "I'm clear", needs: { player: 'no', color: false } },
  { kind: 'notMe', label: 'Not me!', needs: { player: 'no', color: false } },
  { kind: 'accuse', label: "It's [player]!", needs: { player: 'yes', color: false } },
  { kind: 'claimColor', label: '[player] is [color]', needs: { player: 'yes', color: true } },
  { kind: 'searched', label: 'I searched [player]', needs: { player: 'yes', color: false } },
  { kind: 'trustMe', label: 'Trust me', needs: { player: 'no', color: false } },
  { kind: 'liar', label: 'Liar!', needs: { player: 'optional', color: false } },
];

/**
 * Checks a quick-chat choice from a client: a known phrase, with exactly the player and color it
 * needs (the player must be in the room). Returns the clean choice, or null.
 */
export function parseQuickChat(raw: unknown, playerIds: readonly PlayerId[]): QuickChat | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const phrase = QUICK_PHRASES.find((p) => p.kind === r.kind);
  if (!phrase) return null;
  const player = r.player === undefined || r.player === null ? undefined : r.player;
  const color = r.color === undefined || r.color === null ? undefined : r.color;
  if (player !== undefined && (typeof player !== 'string' || !playerIds.includes(player))) return null;
  if (color !== undefined && !(COLOR_IDS as readonly unknown[]).includes(color)) return null;
  if (phrase.needs.player === 'yes' && player === undefined) return null;
  if (phrase.needs.player === 'no' && player !== undefined) return null;
  if (phrase.needs.color !== (color !== undefined)) return null;
  const out: QuickChat = { kind: phrase.kind };
  if (player !== undefined) out.player = player;
  if (color !== undefined) out.color = color as ColorId;
  return out;
}

/** The message text. `self` is the sender (so "Ada is Red" from Ada reads "I'm Red"). */
export function quickChatText(q: QuickChat, self: PlayerId, nameOf: (id: PlayerId) => string): string {
  const who = (id: PlayerId | undefined) => (id === undefined ? '' : nameOf(id));
  switch (q.kind) {
    case 'clear':
      return "I'm clear.";
    case 'notMe':
      return 'Not me!';
    case 'accuse':
      return `It's ${who(q.player)}!`;
    case 'claimColor': {
      const color = colorInfo(q.color!).name;
      return q.player === self ? `I'm ${color}.` : `${who(q.player)} is ${color}.`;
    }
    case 'searched':
      return `I searched ${who(q.player)}.`;
    case 'trustMe':
      return 'Trust me.';
    case 'liar':
      return q.player ? `${who(q.player)} is lying!` : 'Liar!';
  }
}
