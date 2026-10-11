'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { setHowtoStatus } from '@/lib/howtoStatus';
import { trackStep } from '@/lib/analytics';
import { howToSlides, type Block, type SlideNumbers } from './slides';

const SEEN_KEY = 'wtc:howto-seen';

export function hasSeenWalkthrough(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWalkthroughSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === 'list')
    return (
      <ul className="walk-list">
        {b.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );
  return <p className={b.kind === 'text' ? undefined : `walk-${b.kind}`}>{b.text}</p>;
}

/**
 * How to Play: ten slides, a screenshot and a few short lines each. Next/Back, swipe on
 * touch, arrow keys, a progress row and Skip. `intro` is the first-game version. With
 * `onPractice`, the last slide offers a practice game against bots.
 */
export function Walkthrough({
  onClose,
  onPractice,
  intro = false,
  numbers,
}: {
  onClose: () => void;
  onPractice?: () => void;
  intro?: boolean;
  /** Room settings and player count, so the numbers match this table. */
  numbers?: SlideNumbers;
}) {
  const slides = useMemo(() => howToSlides(numbers), [numbers]);
  const [i, setI] = useState(0);
  const last = i === slides.length - 1;
  // Playtest stats: reaching the last slide counts as finished; closing earlier as skipped.
  const close = () => {
    markWalkthroughSeen();
    setHowtoStatus(last ? 'finished' : 'skipped');
    trackStep(last ? 'howto_finish' : 'howto_skip');
    onClose();
  };
  const go = (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n)));
  useEffect(() => trackStep('howto_open'), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe: a horizontal drag of 50 px turns the page.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => (start.current = { x: e.clientX, y: e.clientY });
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(i + (dx < 0 ? 1 : -1));
  };

  const slide = slides[i];
  return (
    <div className="modal-backdrop walk-backdrop" onClick={close}>
      <div className="modal walk" role="dialog" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <header className="walk-head">
          <h2>{intro ? 'Before you ride' : 'How to Play'}</h2>
          <button className="btn small walk-skip" onClick={close}>
            {last ? 'Close' : 'Skip'}
          </button>
        </header>
        <div className="walk-body" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (start.current = null)}>
          <figure className="walk-shot">
            {/* Plain img: these are generated screenshots with fixed sizes. */}
            <img key={slide.image} src={slide.image} alt={slide.alt} draggable={false} />
          </figure>
          <div className="walk-text">
            <p className="walk-step">
              {i + 1} of {slides.length}
            </p>
            <h3>{slide.title}</h3>
            {slide.blocks.map((b, n) => (
              <BlockView key={n} b={b} />
            ))}
          </div>
        </div>
        <footer className="walk-foot">
          <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>
            Back
          </button>
          <ol className="walk-dots" aria-label="Progress">
            {slides.map((s, n) => (
              <li key={s.id}>
                <button
                  className={n === i ? 'on' : n < i ? 'done' : ''}
                  aria-label={`Slide ${n + 1}: ${s.title}`}
                  aria-current={n === i ? 'step' : undefined}
                  onClick={() => go(n)}
                />
              </li>
            ))}
          </ol>
          {!last ? (
            <button className="btn primary" onClick={() => go(i + 1)}>
              Next
            </button>
          ) : onPractice ? (
            <button
              className="btn primary"
              onClick={() => {
                markWalkthroughSeen();
                setHowtoStatus('finished');
                trackStep('howto_finish');
                onPractice();
              }}
            >
              Practice with bots
            </button>
          ) : (
            <button className="btn primary" onClick={close}>
              Saddle up
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
