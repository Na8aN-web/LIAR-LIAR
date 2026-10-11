// Playtest data shared by client and server: the How to Play status each browser reports, and
// the optional end-of-game feedback form.

export type HowtoStatus = 'never' | 'skipped' | 'finished';

export const PLAY_AGAIN = ['yes', 'maybe', 'no'] as const;
export type PlayAgain = (typeof PLAY_AGAIN)[number];

export interface FeedbackAnswers {
  /** What confused you? */
  confused: string;
  /** When was it most fun? */
  fun: string;
  /** Did you ever feel there was no point lying? */
  noPointLying: string;
  /** Was anything too slow or too fast? */
  pace: string;
  /** Would you play again? */
  playAgain: PlayAgain | null;
}

export const FEEDBACK_QUESTIONS: { key: Exclude<keyof FeedbackAnswers, 'playAgain'>; label: string }[] = [
  { key: 'confused', label: 'What confused you?' },
  { key: 'fun', label: 'When was it most fun?' },
  { key: 'noPointLying', label: 'Did you ever feel there was no point lying?' },
  { key: 'pace', label: 'Was anything too slow or too fast?' },
];

/** Characters per answer. */
export const FEEDBACK_MAX = 500;

/** Plain text: control and invisible characters removed, whitespace tidied, capped. */
export function cleanFeedbackText(raw: string): string {
  return raw
    .slice(0, FEEDBACK_MAX * 2)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, FEEDBACK_MAX);
}
