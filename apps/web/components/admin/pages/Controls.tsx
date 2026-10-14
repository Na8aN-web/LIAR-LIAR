'use client';

import { useEffect, useState } from 'react';
import { ANNOUNCEMENT_MAX, INSPECT_RANGE, POSTER_RANGE, RULE_LIMITS, estimatedGameSeconds, SWAP_RANGE, TIMER_LIMITS, type GameRules, type PhaseTimers, type RoomSettings } from '@wtc/shared';
import { adminFetch, int, useAdmin } from '../api';
import { Badge, Card, Grid, Status, useConfirm } from '../ui';

interface ControlsData {
  maintenance: { on: boolean; message: string };
  defaults: RoomSettings;
  builtInDefaults: RoomSettings;
  billboards: Record<string, string>;
  store: 'file' | 'postgres' | null;
  seedRecords: number;
}

const TIMER_LABEL: Record<keyof PhaseTimers, string> = { poster: 'Poster', investigation: 'Searching', vote: 'Accusing', payout: 'Payout' };
const RULE_LABEL: Record<keyof GameRules, string> = {
  startingPoints: 'Starting money',
  basePot: 'Reward per poster',
  escapeBonus: 'Escape bonus',
  buyPrice: 'Price of a finding',
  extraInspectPrice: 'Price of extra searches',
  extraInspectCount: 'Searches per purchase',
  purchaseCap: 'Purchases per round',
  swapPrice: 'Dirty trick: change color',
  coverPrice: 'Dirty trick: cover your tracks',
  worthPrice: 'Look at everyone\'s worth',
  decoys: 'Fake colors per search',
};

/** Every setting that differs, as "Label: old → new". */
function changes(a: RoomSettings, b: RoomSettings): string[] {
  const out: string[] = [];
  if (a.posters !== b.posters) out.push(`Posters: ${a.posters} → ${b.posters}`);
  if (a.inspectsPerRound !== b.inspectsPerRound) out.push(`Searches per round: ${a.inspectsPerRound} → ${b.inspectsPerRound}`);
  if (a.colorSwaps !== b.colorSwaps) out.push(`Color changes: ${a.colorSwaps} → ${b.colorSwaps}`);
  for (const k of Object.keys(TIMER_LABEL) as (keyof PhaseTimers)[]) if (a.timers[k] !== b.timers[k]) out.push(`${TIMER_LABEL[k]} timer: ${a.timers[k]}s → ${b.timers[k]}s`);
  for (const k of Object.keys(RULE_LABEL) as (keyof GameRules)[]) if (a.rules[k] !== b.rules[k]) out.push(`${RULE_LABEL[k]}: ${a.rules[k]} → ${b.rules[k]}`);
  return out;
}

function SettingsEditor({ data, reload }: { data: ControlsData; reload: () => void }) {
  const confirm = useConfirm();
  const [s, setS] = useState<RoomSettings>(data.defaults);
  useEffect(() => setS(data.defaults), [data.defaults]);
  const diff = changes(data.defaults, s);
  const fromBuiltIn = changes(data.builtInDefaults, data.defaults);
  const autoOr = (v: string) => (v === 'auto' ? 'auto' : Number(v));
  const num = (label: string, value: number, [min, max]: [number, number], on: (n: number) => void, unit = '') => (
    <label className="adm-field" key={label}>
      <span>
        {label} <small>{min}–{max}{unit}</small>
      </span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => on(Math.round(Number(e.target.value)))} />
    </label>
  );
  const save = () =>
    confirm({
      title: 'Change the default game settings?',
      body: (
        <>
          <p>New rooms start with these. Rooms already open keep theirs, and hosts can still change them in the lobby.</p>
          <ul className="adm-changes">
            {diff.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      ),
      confirm: 'Save defaults',
      run: async () => {
        await adminFetch('/defaults', { body: { settings: s } });
        reload();
        return 'Saved. New rooms use these settings.';
      },
    });
  const reset = () =>
    confirm({
      title: 'Go back to the built-in defaults?',
      body: (
        <ul className="adm-changes">
          {fromBuiltIn.map((d) => (
            <li key={d}>{d.replace(/: (.*) → (.*)$/, ': $2 → $1')}</li>
          ))}
        </ul>
      ),
      confirm: 'Reset defaults',
      run: async () => {
        await adminFetch('/defaults', { body: { reset: true } });
        reload();
        return 'Built-in defaults restored.';
      },
    });

  return (
    <Card
      title="Default game settings"
      note="What a new room starts with. Checked against the same limits as the lobby."
      wide
      actions={fromBuiltIn.length ? <Badge tone="warn">{fromBuiltIn.length} changed from built-in</Badge> : <Badge tone="muted">built-in</Badge>}
    >
      <div className="adm-form-grid">
        <label className="adm-field">
          <span>Posters per game (about {Math.round(estimatedGameSeconds(s.posters, s.timers) / 60)} min)</span>
          <select value={s.posters} onChange={(e) => setS({ ...s, posters: Number(e.target.value) })}>
            {Array.from({ length: POSTER_RANGE.max - POSTER_RANGE.min + 1 }, (_, i) => POSTER_RANGE.min + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>Searches per round</span>
          <select value={String(s.inspectsPerRound)} onChange={(e) => setS({ ...s, inspectsPerRound: autoOr(e.target.value) })}>
            <option value="auto">Auto (by player count)</option>
            {Array.from({ length: INSPECT_RANGE.max - INSPECT_RANGE.min + 1 }, (_, i) => INSPECT_RANGE.min + i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>Color changes per game</span>
          <select value={String(s.colorSwaps)} onChange={(e) => setS({ ...s, colorSwaps: autoOr(e.target.value) })}>
            <option value="auto">Auto (by poster count)</option>
            {Array.from({ length: SWAP_RANGE.max - SWAP_RANGE.min + 1 }, (_, i) => SWAP_RANGE.min + i).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Off' : n}
              </option>
            ))}
          </select>
        </label>
        {(Object.keys(TIMER_LABEL) as (keyof PhaseTimers)[]).map((k) =>
          num(`${TIMER_LABEL[k]} timer`, s.timers[k], TIMER_LIMITS[k], (n) => setS({ ...s, timers: { ...s.timers, [k]: n } }), 's'),
        )}
        {(Object.keys(RULE_LABEL) as (keyof GameRules)[]).map((k) => num(RULE_LABEL[k], s.rules[k], RULE_LIMITS[k], (n) => setS({ ...s, rules: { ...s.rules, [k]: n } })))}
      </div>
      <div className="adm-row">
        <button className="adm-btn primary" disabled={!diff.length} onClick={save}>
          Save {diff.length ? `${diff.length} change${diff.length === 1 ? '' : 's'}` : ''}
        </button>
        <button className="adm-btn ghost" disabled={!diff.length} onClick={() => setS(data.defaults)}>
          Undo
        </button>
        <button className="adm-btn ghost" disabled={!fromBuiltIn.length} onClick={reset}>
          Reset to built-in
        </button>
      </div>
    </Card>
  );
}

export function ControlsPage() {
  const { data, error, loading, reload } = useAdmin<ControlsData>('/controls');
  const confirm = useConfirm();
  const [message, setMessage] = useState('');
  const [maintMsg, setMaintMsg] = useState('');
  useEffect(() => setMaintMsg(data?.maintenance.message ?? ''), [data?.maintenance.message]);
  if (!data) return <Status error={error} loading={loading} />;

  const broadcast = () =>
    confirm({
      title: 'Send this to everyone online?',
      body: <blockquote className="adm-quote">{message}</blockquote>,
      confirm: 'Send',
      run: async () => {
        await adminFetch('/broadcast', { body: { text: message } });
        setMessage('');
        return 'Sent. It shows at the top of every open game for a minute.';
      },
    });
  const toggleMaintenance = () => {
    const on = !data.maintenance.on;
    confirm({
      title: on ? 'Turn on maintenance mode?' : 'Turn off maintenance mode?',
      body: on ? (
        <p>New rooms and practice games are refused, and everyone sees the message below. Games already running carry on.</p>
      ) : (
        <p>New rooms can be opened again.</p>
      ),
      confirm: on ? 'Turn on' : 'Turn off',
      danger: on,
      run: async () => {
        await adminFetch('/maintenance', { body: { on, message: maintMsg } });
        reload();
        return on ? 'Maintenance mode is on.' : 'Maintenance mode is off.';
      },
    });
  };

  return (
    <>
      <Grid>
        <Card title="Message everyone" note="Shown at the top of every open page, homepage and games, for a minute.">
          <label className="adm-field">
            <span>
              Message <small>{message.length}/{ANNOUNCEMENT_MAX}</small>
            </span>
            <textarea rows={3} maxLength={ANNOUNCEMENT_MAX} value={message} placeholder="e.g. Server restarts in 5 minutes. Finish your round!" onChange={(e) => setMessage(e.target.value)} />
          </label>
          <button className="adm-btn primary" disabled={!message.trim()} onClick={broadcast}>
            Send to everyone
          </button>
        </Card>
        <Card title="Maintenance mode" actions={data.maintenance.on ? <Badge tone="bad">on</Badge> : <Badge tone="good">off</Badge>} note="Stops new rooms (for an update or a problem) without cutting off games in progress.">
          <label className="adm-field">
            <span>Message to players</span>
            <textarea rows={3} maxLength={ANNOUNCEMENT_MAX} value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} />
          </label>
          <button className={`adm-btn ${data.maintenance.on ? 'primary' : 'danger'}`} onClick={toggleMaintenance}>
            {data.maintenance.on ? 'Turn off maintenance' : 'Turn on maintenance'}
          </button>
        </Card>
      </Grid>
      <SettingsEditor data={data} reload={reload} />
      <Card title="Data" wide>
        <p className="adm-small">
          Stored in <b>{data.store === 'postgres' ? 'Postgres' : 'files (apps/server/logs)'}</b>. {data.seedRecords ? `${int(data.seedRecords)} seed records (bot data) are mixed in; switch them off with “Seed data” at the top, or delete them with pnpm admin:seed -- --remove.` : 'No seed data.'}
        </p>
      </Card>
    </>
  );
}
