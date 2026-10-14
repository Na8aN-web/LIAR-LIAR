'use client';

import { useEffect, useState } from 'react';
import { colorInfo, type Phase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, useGameCountdown, useSecondsLeft } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { BrassBadge } from '../ui/western';
import { WantedPoster } from '../WantedPoster';
import { ActionBar } from './ActionBar';
import { Notifications } from './Notifications';
import { PayoutCard } from './PayoutCard';
import { Tutorial } from './Tutorial';
import { Replay } from './Replay';
import { SidePanel } from './SidePanel';
import { OutlawFlash, PhaseBanner, PhaseTracker, VoteSoon } from './PhaseCues';
import { VotePanel } from './VotePanel';

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'The Saloon',
  poster: 'New Wanted poster',
  investigation: 'Search for clues',
  vote: 'Name the outlaw',
  payout: 'Bounty paid',
  ended: 'The dust settles',
};

/** "YOU: ● Red", always in the top bar. Pulses when your color changes. Hidden in streamer mode. */
function YouBadge({ color }: { color: Parameters<typeof colorInfo>[0] }) {
  const streamer = useStreamerMode();
  const c = colorInfo(color);
  if (streamer) {
    return (
      <div className="you-badge hidden" title="Your color is hidden (streamer mode)">
        YOU: <i className="you-dot" /> hidden
      </div>
    );
  }
  return (
    // The key restarts the pulse animation whenever the color changes.
    <div key={color} className="you-badge pulse" aria-label={`Your color: ${c.name}`}>
      YOU: <i className="you-dot" style={{ background: c.hex, color: c.hex }} /> <b>{c.name}</b>
    </div>
  );
}

/**
 * Only on the outlaw's own screen (youAreWanted is private to them). One element that stays
 * mounted all game and is shown or hidden, never a new one per poster, so there can only ever
 * be one. It names your color, so it can be checked against the poster at a glance, and folds
 * to a small tag after a few seconds to keep the scene clear.
 */
function OutlawBanner({ show, poster, color }: { show: boolean; poster: number; color: Parameters<typeof colorInfo>[0] }) {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    setSmall(false);
    if (!show) return;
    const t = setTimeout(() => setSmall(true), 5000);
    return () => clearTimeout(t);
  }, [show, poster]);
  const c = colorInfo(color);
  return (
    <div className={`outlaw-banner${small ? ' small' : ''}`} hidden={!show} role={show ? 'alert' : undefined} onClick={() => setSmall(!small)}>
      <span className="outlaw-stamp">{small ? 'YOU’RE THE OUTLAW' : 'THAT’S YOU.'}</span>
      {!small && (
        <span className="outlaw-line">
          You wear <b style={{ color: c.hex }}>{c.name}</b>, the poster&rsquo;s color. Don&rsquo;t get caught.
        </span>
      )}
    </div>
  );
}

/** Start of the game only: "First poster coming up in 5, 4, 3, 2, 1" before the first poster shows. */
function GameCountdown({ n }: { n: number }) {
  return (
    <div className="center-card countdown" role="status" aria-live="assertive">
      <div className="countdown-card">
        <span className="countdown-line">First poster coming up in</span>
        {/* The key restarts the stamp animation on every number. */}
        <span key={n} className="countdown-num">
          {n}
        </span>
      </div>
    </div>
  );
}

export function GameHud() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const secs = useSecondsLeft();
  const toast = useGame((s) => s.showToast);
  const [showPoster, setShowPoster] = useState(false);
  const streamer = useStreamerMode();
  const poster = colorInfo(game.posterColor);
  const countdown = useGameCountdown();
  // Marked away for idling (still connected): a nudge before the server removes them.
  const meAway = !!view.players.find((p) => p.id === view.you.id && p.away && p.connected);

  if (view.phase === 'ended') return <Replay />;

  return (
    <div className="hud">
      <header className="topbar">
        <button className="mini-poster" data-tut="poster" onClick={() => setShowPoster(true)} aria-label={`Show the Wanted poster: ${poster.name}`}>
          <WantedPoster className="thumb" color={game.posterColor} pot={game.pot} number={game.posterIndex + 1} of={game.posterCount} />
          <span className="mini-color">{poster.name}</span>
        </button>
        <div className="topbar-mid">
          <div className="phase-name">{PHASE_LABEL[view.phase]}</div>
          <PhaseTracker phase={view.phase} />
          <div className="phase-sub">
            <span className="wide-only">Poster </span>
            {game.posterIndex + 1}/{game.posterCount} · ${game.pot}
          </div>
          <YouBadge color={view.you.color} />
        </div>
        <BrassBadge label="Time" className="timer" tone={secs !== null && secs <= 10 && countdown <= 0 ? 'alert' : undefined}>
          {secs === null ? '–' : countdown > 0 ? view.settings.timers.poster : secs}
        </BrassBadge>
        <BrassBadge label="Purse" className="my-score">
          ${game.myScore}
        </BrassBadge>
      </header>

      {/* Streamer mode: only a brief, wordless icon flash, so viewers can't see you're the outlaw. */}
      {countdown > 0 && <GameCountdown n={countdown} />}
      {game.youAreWanted && view.phase !== 'payout' && countdown <= 0 && streamer && <OutlawFlash poster={game.posterIndex} />}
      <OutlawBanner show={game.youAreWanted && view.phase !== 'payout' && countdown <= 0 && !streamer} poster={game.posterIndex} color={view.you.color} />

      {((view.phase === 'poster' && countdown <= 0) || showPoster) && (
        <div className="center-card" onClick={() => setShowPoster(false)}>
          <WantedPoster
            className="big"
            color={game.posterColor}
            pot={game.pot}
            number={game.posterIndex + 1}
            of={game.posterCount}
            subtitle={game.youAreWanted && !streamer ? "That's you. Don't get caught." : undefined}
          />
        </div>
      )}

      {meAway && (
        <div className="away-banner" role="alert">
          <span className="away-text">
            <b>You&rsquo;re marked away.</b> Search, chat or vote to stay in the game. If you don&rsquo;t, you&rsquo;ll be removed after the
            next poster.
          </span>
        </div>
      )}
      <Notifications />
      <Tutorial />

      {view.phase === 'payout' && <PayoutCard />}

      <PhaseBanner phase={view.phase} poster={game.posterIndex} />

      {view.phase === 'vote' ? (
        <VotePanel key={game.posterIndex} />
      ) : (
        <>
          <div className="hud-spacer" />
          <VoteSoon />
          <ActionBar key={`${view.phase}-${game.posterIndex}`} />
        </>
      )}
      <SidePanel />

      {/* Dev tool: compiled out of production builds (and production servers refuse it anyway). */}
      {process.env.NODE_ENV !== 'production' && view.devMode && view.you.isHost && (
        <button
          className="dev-skip"
          onClick={async () => {
            const r = await call('dev:skipPhase');
            if (!r.ok) toast(r.error);
          }}
        >
          dev: skip ▸
        </button>
      )}
    </div>
  );
}
