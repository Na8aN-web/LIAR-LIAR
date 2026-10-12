'use client';

import { useState } from 'react';
import { colorInfo, type Phase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, useSecondsLeft } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { BrassBadge } from '../ui/western';
import { WantedPoster } from '../WantedPoster';
import { ActionBar } from './ActionBar';
import { Notifications } from './Notifications';
import { PayoutCard } from './PayoutCard';
import { PracticeHints } from './PracticeHints';
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

/** Only on the outlaw's own screen (youAreWanted is private to them). */
function OutlawBanner() {
  return (
    <div className="outlaw-banner" role="alert">
      <span className="outlaw-stamp">THAT&rsquo;S YOU.</span>
      <span className="outlaw-line">You&rsquo;re the outlaw this round. Don&rsquo;t get caught.</span>
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
  const changed = game.colorChanges[game.posterIndex] ?? 0;
  const changedText = changed ? `${changed} ${changed === 1 ? 'player' : 'players'} changed colors.` : null;

  if (view.phase === 'ended') return <Replay />;

  return (
    <div className="hud">
      <header className="topbar">
        <button className="mini-poster" onClick={() => setShowPoster(true)} aria-label={`Show the Wanted poster: ${poster.name}`}>
          <WantedPoster className="thumb" color={game.posterColor} pot={game.pot} number={game.posterIndex + 1} of={game.posterCount} />
          <span className="mini-color">{poster.name}</span>
        </button>
        <div className="topbar-mid">
          <div className="phase-name">{PHASE_LABEL[view.phase]}</div>
          <PhaseTracker phase={view.phase} />
          <div className="phase-sub">
            <span className="wide-only">Poster </span>
            {game.posterIndex + 1}/{game.posterCount} · ${game.pot}
            {changedText && ` · ${changed} swapped`}
          </div>
          <YouBadge color={view.you.color} />
        </div>
        <BrassBadge label="Time" className="timer" tone={secs !== null && secs <= 10 ? 'alert' : undefined}>
          {secs ?? '–'}
        </BrassBadge>
        <BrassBadge label="Purse" className="my-score">
          ${game.myScore}
        </BrassBadge>
      </header>

      {/* Streamer mode: only a brief, wordless icon flash, so viewers can't see you're the outlaw. */}
      {game.youAreWanted && view.phase !== 'payout' && (streamer ? <OutlawFlash poster={game.posterIndex} /> : <OutlawBanner key={game.posterIndex} />)}

      {(view.phase === 'poster' || showPoster) && (
        <div className="center-card" onClick={() => setShowPoster(false)}>
          <WantedPoster
            className="big"
            color={game.posterColor}
            pot={game.pot}
            number={game.posterIndex + 1}
            of={game.posterCount}
            subtitle={game.youAreWanted && !streamer ? "That's you. Don't get caught." : undefined}
            note={changedText}
          />
        </div>
      )}

      <Notifications />
      <PracticeHints />

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
