'use client';

import { useState } from 'react';
import { FEEDBACK_MAX, FEEDBACK_QUESTIONS, PLAY_AGAIN, type FeedbackAnswers, type PlayAgain } from '@wtc/shared';
import { call } from '@/lib/socket';

type Text = Omit<FeedbackAnswers, 'playAgain'>;
const EMPTY: Text = { confused: '', fun: '', noPointLying: '', pace: '' };
const AGAIN_LABEL: Record<PlayAgain, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' };

/**
 * Optional feedback after a game, styled as a telegram home. Every question can be left blank,
 * and the whole form can be skipped. Answers are saved on the game server with your name.
 */
export function FeedbackForm() {
  const [open, setOpen] = useState(true);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState<Text>(EMPTY);
  const [again, setAgain] = useState<PlayAgain | null>(null);
  const empty = !again && Object.values(text).every((v) => !v.trim());

  if (sent) return <p className="feedback-thanks">Telegram sent. Much obliged, partner.</p>;
  if (!open)
    return (
      <button className="btn ghost small feedback-reopen" onClick={() => setOpen(true)}>
        Send the makers a note
      </button>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (empty) return;
    setBusy(true);
    const r = await call('feedback:send', { ...text, playAgain: again });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.error);
  };

  return (
    <form className="feedback" onSubmit={submit} aria-label="Feedback">
      <header className="feedback-head">
        <span className="feedback-tag">Western Telegraph</span>
        <h2>A word for the makers?</h2>
        <p className="hint">All optional. A line or two helps a lot.</p>
      </header>
      {FEEDBACK_QUESTIONS.map((q) => (
        <label key={q.key} className="field feedback-q">
          <span>{q.label}</span>
          <textarea
            rows={2}
            maxLength={FEEDBACK_MAX}
            value={text[q.key]}
            onChange={(e) => setText((t) => ({ ...t, [q.key]: e.target.value }))}
          />
        </label>
      ))}
      <fieldset className="feedback-again">
        <legend>Would you play again?</legend>
        <div className="segmented">
          {PLAY_AGAIN.map((v) => (
            <button type="button" key={v} className={again === v ? 'on' : ''} aria-pressed={again === v} onClick={() => setAgain(again === v ? null : v)}>
              {AGAIN_LABEL[v]}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="row feedback-actions">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Skip
        </button>
        <button className="btn primary grow" disabled={busy || empty}>
          Send it
        </button>
      </div>
    </form>
  );
}
