import { cleanFeedbackText, FEEDBACK_MAX, PLAY_AGAIN, type FeedbackAnswers, type HowtoStatus, type PlayAgain } from '@wtc/shared';

// Playtest data: How to Play status reported by each browser, and the end-of-game feedback form.

export { type FeedbackAnswers, type HowtoStatus };

/** In rank order: a status only ever moves right. */
export const HOWTO_STATUSES: HowtoStatus[] = ['never', 'skipped', 'finished'];

/** Checks a feedback form from a client: known fields only, text capped, play-again from the list. */
export function parseFeedback(raw: unknown): FeedbackAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const allowed = ['confused', 'fun', 'noPointLying', 'pace', 'playAgain'];
  if (Object.keys(r).some((k) => !allowed.includes(k))) return null;
  const text = (k: string) => (r[k] === undefined || r[k] === null ? '' : typeof r[k] === 'string' ? cleanFeedbackText(r[k] as string) : null);
  const out = { confused: text('confused'), fun: text('fun'), noPointLying: text('noPointLying'), pace: text('pace') };
  if (Object.values(out).some((v) => v === null)) return null;
  const again = r.playAgain === undefined || r.playAgain === null || r.playAgain === '' ? null : r.playAgain;
  if (again !== null && !PLAY_AGAIN.includes(again as PlayAgain)) return null;
  const answers = { ...(out as Record<string, string>), playAgain: again as PlayAgain | null } as FeedbackAnswers;
  // An entirely empty form isn't worth a line.
  if (!answers.confused && !answers.fun && !answers.noPointLying && !answers.pace && !answers.playAgain) return null;
  return answers;
}

export { FEEDBACK_MAX };
