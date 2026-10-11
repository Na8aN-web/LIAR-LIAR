'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COSMETIC_SLOTS,
  NO_COSMETIC,
  cosmeticsFor,
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
  type CosmeticSlot,
  type Cosmetics,
  type GameRules,
  type PhaseTimers,
  type RoomSettings,
} from '@wtc/shared';
import { call } from '@/lib/socket';
import { session } from '@/lib/session';
import { useGame } from '@/lib/store';
import { ChatPanel } from '../game/ChatPanel';
import { AudioSettings } from '../ui/AudioSettings';
import { BrightnessSlider } from '../ui/BrightnessSlider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { Walkthrough, hasSeenWalkthrough } from '../howto/Walkthrough';

const FILL_TO = 10;

export function Lobby() {
  const view = useGame((s) => s.view)!;
  const toast = useGame((s) => s.showToast);
  const router = useRouter();
  const { you, players, settings, minPlayers, maxPlayers } = view;
  const isHost = you.isHost;
  const enough = players.length >= minPlayers;
  const desktop = useIsDesktop();
  // Before a player's first game: offer the walkthrough once (Skip closes it for good).
  const [intro, setIntro] = useState(false);
  useEffect(() => setIntro(!hasSeenWalkthrough()), []);

  const inviteLink = typeof window !== 'undefined' ? `${location.origin}/r/${view.code}` : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Wanted: True Colors', url: inviteLink });
      else {
        await navigator.clipboard.writeText(inviteLink);
        toast('Invite link copied. Send it to your posse.');
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

  const posseRows = (
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
          {isHost && !p.isBot && p.id !== you.id && (
            <button
              className="btn small kick-btn"
              aria-label={`Remove ${p.name} from the room`}
              onClick={() => {
                if (window.confirm(`Remove ${p.name}? They won't be able to rejoin this room.`)) act(call('lobby:kick', { playerId: p.id }));
              }}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="lobby">
      {intro && <Walkthrough intro numbers={{ settings, playerCount: players.length }} onClose={() => setIntro(false)} />}
      <section className="panel lobby-main">
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
              Leave town
            </button>
          </div>
        </header>

        {/* Always in reach: start (host) or waiting. */}
        <div className="lobby-actions">
          {isHost ? (
            <>
              <button className="btn primary grow" disabled={!enough} onClick={() => act(call('game:start'))}>
                {enough ? 'Start the hunt' : `Need ${minPlayers - players.length} more riders`}
              </button>
              {view.devMode && players.length < maxPlayers && (
                <>
                  <button className="btn small" onClick={() => act(call('lobby:addBot'))}>
                    + Bot
                  </button>
                  {players.length < FILL_TO && (
                    <button
                      className="btn small"
                      onClick={async () => {
                        for (let i = players.length; i < FILL_TO; i++) if (!(await act(call('lobby:addBot')))) break;
                      }}
                    >
                      Fill to {FILL_TO}
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="muted">Waiting on the host to start the hunt…</p>
          )}
        </div>

        {/* Folded on phones, open on desktop. */}
        <Fold title="Your garment & color" open={desktop}>
          <LookPicker />
        </Fold>
        <Fold title="Hat & face" open={desktop}>
          <CosmeticsPicker />
        </Fold>
        <Fold
          title={
            <>
              The posse <span className="muted">{players.length}/{maxPlayers}</span>
            </>
          }
          open={desktop}
        >
          {isHost && (
            <label className="sound-switch lock-row">
              <span className="grow">
                <b>Lock the room</b>
                <span className="hint"> {view.locked ? 'No one new can join. Players already here can reconnect.' : 'Anyone with the code can join.'}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={view.locked}
                className={`btn small${view.locked ? ' primary' : ''}`}
                onClick={() => act(call('lobby:lock', { locked: !view.locked }))}
              >
                {view.locked ? 'Locked' : 'Open'}
              </button>
            </label>
          )}
          {!isHost && view.locked && <p className="hint">The host has locked this room.</p>}
          {posseRows}
        </Fold>
        <Fold title={`House rules${isHost ? '' : ' (host sets these)'}`} open={desktop && isHost}>
          <SettingsForm settings={settings} editable={isHost} playerCount={players.length} />
        </Fold>
        <Fold title="Sound & picture" open={false}>
          <AudioSettings />
          <BrightnessSlider />
        </Fold>
      </section>

      <LobbyChat open={desktop} />
    </div>
  );
}

/** A collapsible section. `open` is only the starting state; players can fold/unfold freely. */
function Fold({ title, open, children }: { title: React.ReactNode; open: boolean; children: React.ReactNode }) {
  return (
    <details className="fold" open={open}>
      <summary>{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** Lobby chat that folds into a bar with an unread count. */
function LobbyChat({ open: startOpen }: { open: boolean }) {
  const count = useGame((s) => s.chat.length);
  const [open, setOpen] = useState(startOpen);
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (open) setSeen(count);
  }, [open, count]);
  const unread = Math.max(0, count - seen);
  return (
    <section className={`panel lobby-chat${open ? '' : ' folded'}`}>
      <button className="fold-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grow">Talk</span>
        {!open && unread > 0 && <span className="badge">{unread}</span>}
        <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button>
      {open && <ChatPanel />}
    </section>
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
        <span className="label">Your garment</span>
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
          <span className="muted">{open ? 'done' : 'change'}</span>
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
      <p className="hint">Only you can see your true color.</p>
    </div>
  );
}

const SLOT_LABELS: Record<CosmeticSlot, string> = { hat: 'Hat', face: 'Head detail' };

/** Hat and head detail: everyone sees them, so the posse can tell scarecrows apart. Built from the catalog. */
function CosmeticsPicker() {
  const mine = useGame((s) => s.view!.players.find((p) => p.id === s.view!.you.id)?.cosmetics);
  const toast = useGame((s) => s.showToast);
  const set = async (next: Partial<Cosmetics>) => {
    const res = await call('lobby:setLook', { cosmetics: next });
    if (!res.ok) toast(res.error);
  };
  if (!mine) return null;
  return (
    <div className="look">
      {COSMETIC_SLOTS.map((slot) => (
        <div className="look-row cosmetic-row" key={slot}>
          <span className="label">{SLOT_LABELS[slot]}</span>
          <div className="chips" role="radiogroup" aria-label={SLOT_LABELS[slot]}>
            {[{ id: NO_COSMETIC, name: 'None' }, ...cosmeticsFor(slot)].map((c) => (
              <button
                key={c.id}
                role="radio"
                aria-checked={mine[slot] === c.id}
                className={`chip${mine[slot] === c.id ? ' on' : ''}`}
                onClick={() => mine[slot] !== c.id && set({ [slot]: c.id })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="hint">Everyone sees these, so the posse can tell you apart. Earth tones only, never a player's color.</p>
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
    buyPrice: 'Buy findings',
    extraInspectPrice: 'Extra look',
    purchaseCap: 'Deals / round',
    decoys: 'Decoys per look',
  };
  const inspectOptions = Array.from({ length: INSPECT_RANGE.max - INSPECT_RANGE.min + 1 }, (_, i) => INSPECT_RANGE.min + i);

  return (
    <div className="settings">
      <div className="settings-grid">
        <label>
          <span>Looks per round</span>
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
          <span>Color changes per player</span>
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
        <summary>Playtest tuning (balance numbers)</summary>
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
    </div>
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
