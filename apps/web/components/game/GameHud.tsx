'use client';

import { useState } from 'react';
import { colorInfo, type Phase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame, useSecondsLeft } from '@/lib/store';
import { WantedPoster } from '../WantedPoster';
import { ActionBar } from './ActionBar';
import { OfferPrompts, useOfferNotices } from './Offers';
import { PayoutCard } from './PayoutCard';
import { Replay } from './Replay';
import { SidePanel } from './SidePanel';

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby',
  poster: 'New poster',
  investigation: 'Investigate',
  vote: 'Vote',
  payout: 'Payout',
  ended: 'Game over',
};

export function GameHud() {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const secs = useSecondsLeft();
  const toast = useGame((s) => s.showToast);
  const [showPoster, setShowPoster] = useState(false);
  const poster = colorInfo(game.posterColor);
  useOfferNotices();

  if (view.phase === 'ended') return <Replay />;

  return (
    <div className="hud">
      <header className="topbar">
        <button className="mini-poster" onClick={() => setShowPoster(true)} aria-label="Show poster">
          <span className="mini-title">WANTED</span>
          <span className="swatch lg" style={{ background: poster.hex }} />
          <span className="mini-color">{poster.name}</span>
        </button>
        <div className="topbar-mid">
          <div className="phase-name">{PHASE_LABEL[view.phase]}</div>
          <div className="phase-sub">
            Poster {game.posterIndex + 1}/{game.posterCount} · Pot ${game.pot}
          </div>
        </div>
        <div className={`timer${secs !== null && secs <= 10 ? ' urgent' : ''}`}>{secs ?? '–'}</div>
        <div className="my-score" title="Your points">
          <span className="label">You</span>
          {game.myScore}
        </div>
      </header>

      {game.youAreWanted && view.phase !== 'payout' && (
        <div className="wanted-banner">You are Wanted. Blend in.</div>
      )}

      {(view.phase === 'poster' || showPoster) && (
        <div className="center-card" onClick={() => setShowPoster(false)}>
          <WantedPoster
            className="big"
            color={game.posterColor}
            pot={game.pot}
            subtitle={
              game.youAreWanted ? "That's you. Don't get caught." : `Poster ${game.posterIndex + 1} of ${game.posterCount}`
            }
          />
        </div>
      )}

      <OfferPrompts />

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
