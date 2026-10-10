'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  INSPECT_RANGE,
  SWAP_RANGE,
  ITEM_TYPES,
  PALETTE,
  RULE_LIMITS,
  TIMER_LIMITS,
  colorInfo,
  defaultInspects,
  defaultSwaps,
  type ColorId,
  type GameRules,
  type PhaseTimers,
  type RoomSettings,
} from '@wtc/shared';
import { call } from '@/lib/socket';
import { session } from '@/lib/session';
import { useGame } from '@/lib/store';
import { ChatPanel } from '../game/ChatPanel';

const FILL_TO = 10;

export function Lobby() {
  const view = useGame((s) => s.view)!;
  const toast = useGame((s) => s.showToast);
  const router = useRouter();
  const { you, players, settings, minPlayers, maxPlayers } = view;
  const isHost = you.isHost;
  const enough = players.length >= minPlayers;

  const inviteLink = typeof window !== 'undefined' ? `${location.origin}/r/${view.code}` : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Wanted: True Colors', url: inviteLink });
      else {
        await navigator.clipboard.writeText(inviteLink);
        toast('Invite link copied');
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const res = await p;
    if (!res.ok && res.error) toast(res.error);
    return res.ok;
  };

  const leave = () => {
    call('room:leave');
    session.setToken(view.code, null);
    router.push('/');
  };

  return (
    <div className="lobby">
      <section className="panel">
        <header className="lobby-head">
          <div>
            <div className="label">Room code</div>
            <div className="room-code">{view.code}</div>
          </div>
          <div className="row">
            <button className="btn" onClick={share}>
              Invite
            </button>
            <button className="btn ghost" onClick={leave}>
              Leave
            </button>
          </div>
        </header>

        <LookPicker />

        <h3>
          Posse <span className="muted">{players.length}/{maxPlayers}</span>
        </h3>
        <ul className="player-list">
          {players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'faded'}>
              <span className="dot" />
              <span className="grow">
                {p.name}
                {p.id === you.id && <span className="muted"> (you)</span>}
              </span>
              {p.isHost && <span className="tag">host</span>}
              {p.isBot && <span className="tag">bot</span>}
              {!p.connected && <span className="tag">offline</span>}
              {isHost && p.isBot && (
                <button className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => act(call('lobby:removeBot', { playerId: p.id }))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>

        <SettingsForm settings={settings} editable={isHost} playerCount={players.length} />

        <div className="lobby-actions">
          {isHost ? (
            <>
              {view.devMode && players.length < maxPlayers && (
                <>
                  <button className="btn" onClick={() => act(call('lobby:addBot'))}>
                    + Bot
                  </button>
                  {players.length < FILL_TO && (
                    <button
                      className="btn"
                      onClick={async () => {
                        for (let i = players.length; i < FILL_TO; i++) if (!(await act(call('lobby:addBot')))) break;
                      }}
                    >
                      Fill to {FILL_TO}
                    </button>
                  )}
                </>
              )}
              <button className="btn primary grow" disabled={!enough} onClick={() => act(call('game:start'))}>
                {enough ? 'Start game' : `Need ${minPlayers - players.length} more`}
              </button>
            </>
          ) : (
            <p className="muted">Waiting for the host to start…</p>
          )}
        </div>
      </section>

      <section className="panel lobby-chat">
        <ChatPanel />
      </section>
    </div>
  );
}

function LookPicker() {
  const you = useGame((s) => s.view!.you);
  const toast = useGame((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<ColorId[]>([]);

  // Availability is fetched on demand, not pushed live, so players can't watch who takes which color.
  const refresh = async () => {
    const res = await call('lobby:colors');
    if (res.ok) setAvailable(res.available);
  };
  const toggle = () => {
    if (!open) refresh();
    setOpen(!open);
  };
  const pickColor = async (color: ColorId) => {
    const res = await call('lobby:setLook', { color });
    if (!res.ok) {
      toast(res.error);
      refresh();
    } else setOpen(false);
  };

  const info = colorInfo(you.color);
  return (
    <div className="look">
      <div className="look-row">
        <span className="label">Your item</span>
        <div className="segmented">
          {ITEM_TYPES.map((it) => (
            <button key={it} className={it === you.item ? 'on' : ''} onClick={() => call('lobby:setLook', { item: it })}>
              {it}
            </button>
          ))}
        </div>
      </div>
      <div className="look-row">
        <span className="label">Your color</span>
        <button className="btn color-btn" onClick={toggle}>
          <span className="swatch lg" style={{ background: info.hex }} />
          {info.name}
          <span className="muted">{open ? 'close' : 'change'}</span>
        </button>
      </div>
      {open && (
        <div className="color-grid">
          {PALETTE.map((c) => {
            const mine = c.id === you.color;
            const free = mine || available.includes(c.id);
            return (
              <button
                key={c.id}
                className={`color-cell${mine ? ' on' : ''}`}
                disabled={!free}
                onClick={() => !mine && pickColor(c.id)}
                aria-label={free ? c.name : `${c.name} (taken)`}
              >
                <span className="swatch xl" style={{ background: c.hex }} />
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="hint">Only you can see your color. Everyone else sees a silhouette.</p>
    </div>
  );
}

function SettingsForm({ settings, editable, playerCount }: { settings: RoomSettings; editable: boolean; playerCount: number }) {
  const toast = useGame((s) => s.showToast);
  const update = async (p: Partial<RoomSettings>) => {
    const res = await call('lobby:settings', p);
    if (!res.ok) toast(res.error);
  };
  const timerLabels: Record<keyof PhaseTimers, string> = {
    poster: 'Poster',
    investigation: 'Investigation',
    vote: 'Vote',
    payout: 'Payout',
  };
  const ruleLabels: Record<keyof GameRules, string> = {
    startingPoints: 'Starting points',
    basePot: 'Bounty per poster',
    escapeBonus: 'Escape bonus',
    buyPrice: 'Buy a result',
    extraInspectPrice: 'Extra inspect',
    purchaseCap: 'Purchases / round',
    decoys: 'Decoys per inspect',
  };
  const inspectOptions = Array.from({ length: INSPECT_RANGE.max - INSPECT_RANGE.min + 1 }, (_, i) => INSPECT_RANGE.min + i);

  return (
    <details className="settings" open={editable}>
      <summary>Game settings{!editable && ' (host only)'}</summary>
      <div className="settings-grid">
        <label>
          <span>Inspects per round</span>
          <select
            disabled={!editable}
            value={String(settings.inspectsPerRound)}
            onChange={(e) => update({ inspectsPerRound: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
          >
            <option value="auto">Auto ({defaultInspects(playerCount)})</option>
            {inspectOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Color swaps per player</span>
          <select
            disabled={!editable}
            value={String(settings.colorSwaps)}
            onChange={(e) => update({ colorSwaps: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
          >
            <option value="auto">Auto ({defaultSwaps(playerCount)})</option>
            {Array.from({ length: SWAP_RANGE.max - SWAP_RANGE.min + 1 }, (_, i) => SWAP_RANGE.min + i).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Off' : n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Poster order</span>
          <select
            disabled={!editable}
            value={settings.posterMode}
            onChange={(e) => update({ posterMode: e.target.value as RoomSettings['posterMode'] })}
          >
            <option value="everyoneOnce">Everyone once</option>
            <option value="randomRepeats">Random, repeats allowed</option>
          </select>
        </label>
        {(Object.keys(timerLabels) as (keyof PhaseTimers)[]).map((k) => (
          <NumberSetting
            key={k}
            label={`${timerLabels[k]} (s)`}
            limits={TIMER_LIMITS[k]}
            value={settings.timers[k]}
            editable={editable}
            onCommit={(v) => update({ timers: { ...settings.timers, [k]: v } })}
          />
        ))}
      </div>
      <details className="tuning">
        <summary>Playtest tuning</summary>
        <div className="settings-grid">
          {(Object.keys(ruleLabels) as (keyof GameRules)[]).map((k) => (
            <NumberSetting
              key={k}
              label={ruleLabels[k]}
              limits={RULE_LIMITS[k]}
              value={settings.rules[k]}
              editable={editable}
              onCommit={(v) => update({ rules: { ...settings.rules, [k]: v } })}
            />
          ))}
        </div>
      </details>
    </details>
  );
}

function NumberSetting(props: {
  label: string;
  limits: [number, number];
  value: number;
  editable: boolean;
  onCommit: (v: number) => void;
}) {
  const [min, max] = props.limits;
  return (
    <label>
      <span>
        {props.label} <span className="muted">({min}–{max})</span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        disabled={!props.editable}
        min={min}
        max={max}
        defaultValue={props.value}
        key={props.value}
        onBlur={(e) => {
          const v = Math.round(Number(e.target.value));
          if (v !== props.value) props.onCommit(v);
        }}
      />
    </label>
  );
}
