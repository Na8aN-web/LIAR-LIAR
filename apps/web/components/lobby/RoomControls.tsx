'use client';

import { useEffect, useState } from 'react';
import { AUTO_FILL } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
  const res = await p;
  if (!res.ok && res.error) useGame.getState().showToast(res.error);
  return res.ok;
};

/** Host: public (in Find a Lobby) or private (code and invite link only), before the game starts. */
export function VisibilitySwitch() {
  const view = useGame((s) => s.view)!;
  const isPublic = view.room.visibility === 'public';
  if (view.practice) return null;
  if (!view.you.isHost) {
    return <p className="hint">{isPublic ? 'Public room: listed in Find a Lobby.' : 'Private room: code and invite link only.'}</p>;
  }
  return (
    <label className="sound-switch lock-row">
      <span className="grow">
        <b>{isPublic ? 'Public room' : 'Private room'}</b>
        <span className="hint">
          {' '}
          {isPublic ? (view.locked ? 'Hidden from Find a Lobby while locked.' : 'Listed in Find a Lobby: strangers can join.') : 'Only people with the code or invite link can join.'}
        </span>
      </span>
      <span className="segmented small" role="radiogroup" aria-label="Who can join">
        {(['private', 'public'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view.room.visibility === v} className={view.room.visibility === v ? 'on' : ''} onClick={() => act(call('lobby:visibility', { visibility: v }))}>
            {v}
          </button>
        ))}
      </span>
    </label>
  );
}

/** Host of a public room: offer to fill the empty seats with bots after a while. */
export function AutoFillSetting() {
  const view = useGame((s) => s.view)!;
  if (view.room.visibility !== 'public' || !view.you.isHost) return null;
  const { enabled, afterSec } = view.room.autoFill;
  const minutes = [0.5, 1, 2, 3, 5, 10].filter((m) => m * 60 >= AUTO_FILL.minSec && m * 60 <= AUTO_FILL.maxSec);
  return (
    <label className="sound-switch lock-row">
      <span className="grow">
        <b>Offer bots if it&rsquo;s quiet</b>
        <span className="hint"> If fewer than {view.minPlayers} people have joined, offer to fill the seats with bots so you can start.</span>
      </span>
      <select
        aria-label="After how long"
        value={enabled ? String(afterSec) : 'off'}
        onChange={(e) => act(call('lobby:autoFill', e.target.value === 'off' ? { enabled: false } : { enabled: true, afterSec: Number(e.target.value) }))}
      >
        <option value="off">Off</option>
        {minutes.map((m) => (
          <option key={m} value={m * 60}>
            after {m < 1 ? '30 s' : `${m} min`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The host's offer, once the public room has waited long enough with too few people. */
export function FillOffer() {
  const view = useGame((s) => s.view)!;
  const offset = useGame((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const at = view.room.fillOfferAt;
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [at]);
  if (!view.you.isHost || !at || now + offset < at || dismissedAt === at) return null;
  const humans = view.players.filter((p) => !p.isBot).length;
  const missing = view.minPlayers - view.players.length;
  return (
    <div className="fill-offer" role="status">
      <p>
        <b>Quiet night at the fire.</b> {humans} {humans === 1 ? 'rider has' : 'riders have'} shown up. Fill the {missing} empty {missing === 1 ? 'seat' : 'seats'} with bots so the hunt can start?
      </p>
      <div className="row">
        <button className="btn small primary" onClick={() => act(call('lobby:fill'))}>
          Fill with bots
        </button>
        <button className="btn small ghost" onClick={() => setDismissedAt(at)}>
          Keep waiting
        </button>
      </div>
    </div>
  );
}
