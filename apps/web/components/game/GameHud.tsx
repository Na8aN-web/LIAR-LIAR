'use client';

import { useState } from 'react';
import { colorInfo, type Phase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, useSecondsLeft } from '@/lib/store';
import { BrassBadge } from '../ui/western';
import { WantedPoster } from '../WantedPoster';
import { ActionBar } from './ActionBar';
import { Notifications } from './Notifications';
import { PayoutCard } from './PayoutCard';
import { Replay } from './Replay';
import { SidePanel } from './SidePanel';

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'The Saloon',
  poster: 'New Wanted poster',
  investigation: 'Search for clues',
  vote: 'Name the outlaw',
  payout: 'Bounty paid',
  ended: 'The dust settles',
};

export function GameHud() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const secs = useSecondsLeft();
  const toast = useGame((s) => s.showToast);
  const [showPoster, setShowPoster] = useState(false);
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
          <div className="phase-sub">
            <span className="wide-only">Poster </span>
            {game.posterIndex + 1}/{game.posterCount} · ${game.pot}
            {changedText && ` · ${changed} swapped`}
          </div>
        </div>
        <BrassBadge label="Time" className="timer" tone={secs !== null && secs <= 10 ? 'alert' : undefined}>
          {secs ?? '–'}
        </BrassBadge>
        <BrassBadge label="Purse" className="my-score">
          ${game.myScore}
        </BrassBadge>
      </header>

      {game.youAreWanted && view.phase !== 'payout' && <div className="wanted-banner">You&apos;re the outlaw. Blend in.</div>}

      {(view.phase === 'poster' || showPoster) && (
        <div className="center-card" onClick={() => setShowPoster(false)}>
          <WantedPoster
            className="big"
            color={game.posterColor}
            pot={game.pot}
            number={game.posterIndex + 1}
            of={game.posterCount}
            subtitle={game.youAreWanted ? "That's you. Don't get caught." : undefined}
            note={changedText}
          />
        </div>
      )}

      <Notifications />

      {view.phase === 'payout' && <PayoutCard />}

      <div className="hud-spacer" />
      <ActionBar key={`${view.phase}-${game.posterIndex}`} />
      <SidePanel />

      {view.devMode && view.you.isHost && (
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
