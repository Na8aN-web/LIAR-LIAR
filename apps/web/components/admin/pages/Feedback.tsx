'use client';

import { useEffect, useState } from 'react';
import { FEEDBACK_QUESTIONS, type FeedbackAnswers } from '@wtc/shared';
import { int, when, useAdmin } from '../api';
import { PALETTE, Split } from '../charts';
import { Badge, Card, Empty, Stat, Stats, Status, query, useFilters } from '../ui';

interface FeedbackData {
  entries: { at: string; gameId: string; name: string; answers: FeedbackAnswers; seed?: boolean }[];
  playAgain: { yes: number; maybe: number; no: number; none: number };
}

export function FeedbackPage() {
  const { filters } = useFilters();
  const { data, error, loading } = useAdmin<FeedbackData>(`/feedback${query(filters)}`);
  const [shown, setShown] = useState(24);
  const [answer, setAnswer] = useState<'all' | 'yes' | 'maybe' | 'no'>('all');
  useEffect(() => setShown(24), [filters, answer]);
  if (!data) return <Status error={error} loading={loading} />;
  const list = answer === 'all' ? data.entries : data.entries.filter((e) => e.answers.playAgain === answer);
  const t = data.playAgain;
  return (
    <>
      <Stats>
        <Stat label="Answers" value={int(data.entries.length)} />
        <Stat label="Would play again" value={int(t.yes)} tone="good" />
        <Stat label="Maybe" value={int(t.maybe)} />
        <Stat label="Wouldn't" value={int(t.no)} tone={t.no ? 'bad' : undefined} />
      </Stats>
      {t.yes + t.maybe + t.no > 0 && (
        <Card title="Would you play again?" wide>
          <Split
            parts={[
              { label: 'Yes', value: t.yes, color: PALETTE.sage },
              { label: 'Maybe', value: t.maybe, color: PALETTE.brass },
              { label: 'No', value: t.no, color: PALETTE.red },
            ]}
          />
        </Card>
      )}
      <div className="adm-filters">
        <div className="adm-seg" role="group" aria-label="Would play again">
          {(['all', 'yes', 'maybe', 'no'] as const).map((a) => (
            <button key={a} className={answer === a ? 'on' : ''} onClick={() => setAnswer(a)}>
              {a === 'all' ? 'All answers' : `Play again: ${a}`}
            </button>
          ))}
        </div>
        <span className="adm-count">
          Showing {Math.min(shown, list.length)} of {list.length}, newest first
        </span>
      </div>
      {list.length === 0 ? (
        <Empty>No feedback in this period. It arrives when players send the form at the end of a game.</Empty>
      ) : (
        <div className="adm-telegrams">
          {list.slice(0, shown).map((e, i) => (
            <article key={i} className="adm-telegram">
              <header>
                <b>{e.name}</b>
                <span>
                  {when(e.at)} {e.seed && <Badge tone="muted">seed</Badge>}
                </span>
              </header>
              {e.answers.playAgain && (
                <p className="adm-telegram-again">
                  Play again: <Badge tone={e.answers.playAgain === 'yes' ? 'good' : e.answers.playAgain === 'no' ? 'bad' : 'warn'}>{e.answers.playAgain}</Badge>
                </p>
              )}
              <dl>
                {FEEDBACK_QUESTIONS.filter((q) => e.answers[q.key]).map((q) => (
                  <div key={q.key}>
                    <dt>{q.label}</dt>
                    <dd>{e.answers[q.key]}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
      {shown < list.length && (
        <button className="adm-btn adm-more" onClick={() => setShown(shown + 48)}>
          Show more ({list.length - shown} left)
        </button>
      )}
    </>
  );
}
