'use client';

import { Fragment, useEffect, useState } from 'react';
import { colorInfo, type ColorId, type ReplayView } from '@wtc/shared';
import { adminFetch, ago, dec, duration, int, useAdmin, when } from '../api';
import { Anon, Badge, Card, Empty, Grid, Stat, Stats, Status, useConfirm } from '../ui';

interface RoomRow {
  code: string;
  createdAt: string;
  phase: string;
  phaseEndsAt: number | null;
  poster: number | null;
  posters: number | null;
  locked: boolean;
  practice: boolean;
  visibility: 'public' | 'private';
  name: string;
  host: string | null;
  players: { name: string; bot: boolean; connected: boolean; away: boolean; host: boolean; anon: string | null }[];
}
interface Finished {
  gameId: string;
  code: string;
  endedAt: string;
  names: Record<string, string>;
  replay: ReplayView;
}
interface LiveData {
  now: number;
  online: { sockets: number; players: number };
  rooms: { total: number; open: number; public: number; private: number; locked: number; practice: number; inGame: number; list: RoomRow[] };
  server: {
    uptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; machineMb: number };
    cpuPercent: number;
    cores: number;
    eventLoopDelayMs: { p50: number; p99: number; max: number };
    node: string;
  };
  errors: { at: string; message: string }[];
  history: { at: number; rooms: number; players: number; heapMb: number; rssMb: number }[];
  closed: Record<string, number>;
  finished: { gameId: string; code: string; endedAt: string; players: number }[];
  maintenance: { on: boolean; message: string };
}

const PHASE: Record<string, string> = { lobby: 'Lobby', poster: 'Poster', investigation: 'Searching', vote: 'Accusing', payout: 'Payout', ended: 'Ended' };

function Countdown({ endsAt, offset }: { endsAt: number | null; offset: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return null;
  return <span className="adm-timer">{Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000))}s</span>;
}

const swatch = (c: ColorId) => <i className="adm-swatch" style={{ background: colorInfo(c)?.hex }} title={c} />;

/** A finished game's secrets: colors, who was Wanted each round, and the votes. */
function Reveal({ f }: { f: Finished }) {
  const name = (id: string | null) => (id ? (f.names[id] ?? '?') : 'nobody');
  return (
    <div className="adm-reveal">
      <p className="adm-note">
        Game {f.gameId} in room {f.code}, ended {when(f.endedAt || new Date().toISOString())}. Winner{f.replay.winners.length > 1 ? 's' : ''}: {f.replay.winners.map(name).join(', ')}.
      </p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Final color</th>
              <th className="num">Score</th>
              <th className="num">Right</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(f.replay.colors).map((id) => (
              <tr key={id}>
                <td>{name(id)}</td>
                <td>
                  {swatch(f.replay.colors[id])} {f.replay.colors[id]}
                </td>
                <td className="num">{int(f.replay.finalScores[id])}</td>
                <td className="num">{int(f.replay.correctVotes[id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Poster</th>
              <th>Outlaw</th>
              <th>Color</th>
              <th>Caught by</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {f.replay.posters.map((p) => (
              <tr key={p.poster}>
                <td>{p.poster + 1}</td>
                <td>{name(p.wantedId)}</td>
                <td>
                  {swatch(p.color)} {p.color}
                </td>
                <td>{p.correctIds.map(name).join(', ') || '–'}</td>
                <td>{p.escaped ? <Badge tone="warn">escaped</Badge> : <Badge tone="good">caught</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LivePage() {
  const { data, error, loading, reload } = useAdmin<LiveData>('/live', 5000);
  const confirm = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Finished | null>(null);
  const offset = data ? data.now - Date.now() : 0;

  const closeRoom = (r: RoomRow) =>
    confirm({
      title: `Close room ${r.code}?`,
      body: (
        <p>
          Everyone in it ({r.players.filter((p) => !p.bot).length} {r.players.filter((p) => !p.bot).length === 1 ? 'person' : 'people'}) is sent back to the menu with your
          message.{r.phase !== 'lobby' && r.phase !== 'ended' ? ' The game in progress ends and counts as abandoned.' : ''}
        </p>
      ),
      confirm: 'Close room',
      danger: true,
      input: { label: 'Message to the players', initial: 'The admins closed this room.', max: 120 },
      run: async (reason) => {
        await adminFetch(`/rooms/${r.code}/close`, { body: { reason } });
        void reload();
        return `Room ${r.code} closed.`;
      },
    });
  const ban = (p: RoomRow['players'][number]) =>
    confirm({
      title: `Ban ${p.name}?`,
      body: (
        <p>
          Bans the browser behind anonymous id <Anon id={p.anon} />: it's disconnected now and can't connect again. (Someone determined can get round this by clearing their
          browser data.)
        </p>
      ),
      confirm: 'Ban',
      danger: true,
      input: { label: 'Reason (for the log)', placeholder: 'e.g. abusive chat', max: 200 },
      run: async (reason) => {
        const r = await adminFetch<{ disconnected: number }>('/bans', { body: { anon: p.anon, reason } });
        void reload();
        return `Banned. ${r.disconnected} connection${r.disconnected === 1 ? '' : 's'} dropped.`;
      },
    });
  const showFinished = async (gameId: string, code?: string) => {
    try {
      if (code) {
        const r = await adminFetch<{ finished: Finished | null }>(`/rooms/${code}`);
        if (r.finished) return setReveal({ ...r.finished, endedAt: r.finished.endedAt || new Date().toISOString() });
      }
      setReveal(await adminFetch<Finished>(`/finished/${gameId}`));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (!data) return <Status error={error} loading={loading} />;
  const s = data.server;
  const humans = (r: RoomRow) => r.players.filter((p) => !p.bot);
  return (
    <>
      {data.maintenance.on && (
        <p className="adm-banner warn">
          <b>Maintenance mode is on.</b> New rooms are refused. {data.maintenance.message}
        </p>
      )}
      <Stats>
        <Stat label="Players in rooms" value={int(data.online.players)} sub={`${int(data.online.sockets)} connections open`} />
        <Stat label="Active rooms" value={int(data.rooms.total)} sub={`${data.rooms.public} public · ${data.rooms.private} private · ${data.rooms.practice} practice · ${data.rooms.locked} locked`} />
        <Stat label="Games running" value={int(data.rooms.inGame)} />
        <Stat label="CPU" value={`${dec(s.cpuPercent, 0)}%`} sub={`${s.cores} cores`} tone={s.cpuPercent > 80 ? 'bad' : undefined} />
        <Stat label="Memory" value={`${int(s.memory.rssMb)} MB`} sub={`heap ${int(s.memory.heapUsedMb)} / ${int(s.memory.heapTotalMb)} MB`} />
        <Stat label="Response delay" value={`${dec(s.eventLoopDelayMs.p99, 0)} ms`} sub={`worst ${dec(s.eventLoopDelayMs.max, 0)} ms · up ${duration(s.uptimeSec)}`} tone={s.eventLoopDelayMs.p99 > 100 ? 'warn' : undefined} />
      </Stats>

      <Card
        title="Leak watch"
        note="Once a minute for the last 3 hours. Rooms should rise and fall with players; memory that keeps climbing while rooms don't is a leak."
        wide
      >
        <div className="adm-leak">
          <Spark label="Rooms" points={data.history.map((h) => h.rooms)} unit="" />
          <Spark label="Players" points={data.history.map((h) => h.players)} unit="" />
          <Spark label="Heap" points={data.history.map((h) => h.heapMb)} unit=" MB" />
          <Spark label="Total memory" points={data.history.map((h) => h.rssMb)} unit=" MB" />
        </div>
        <p className="adm-note">
          Rooms closed since the server started:{' '}
          {Object.keys(data.closed).length
            ? Object.entries(data.closed)
                .sort((a, b) => b[1] - a[1])
                .map(([why, n]) => `${why} (${n})`)
                .join(' · ')
            : 'none yet'}
        </p>
      </Card>

      <Card title="Rooms" note="Live, public information only. Colors, the outlaw, votes and search results appear only once a game has ended." wide>
        {data.rooms.list.length === 0 ? (
          <Empty>No rooms open right now.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-stack">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Host</th>
                  <th className="num">People</th>
                  <th>Phase</th>
                  <th>Opened</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rooms.list.map((r) => (
                  <Fragment key={r.code}>
                    <tr className={open === r.code ? 'open' : ''}>
                      <td className="adm-cell-main">
                        <button className="adm-link" onClick={() => setOpen(open === r.code ? null : r.code)} aria-expanded={open === r.code}>
                          <code>{r.code}</code>
                        </button>{' '}
                        {r.practice ? <Badge tone="muted">practice</Badge> : r.visibility === 'public' ? <Badge tone="good">public</Badge> : <Badge>private</Badge>} {r.locked && <Badge tone="warn">locked</Badge>}
                        <small className="adm-room-name">{r.name}</small>
                      </td>
                      <td data-label="Host">{r.host ?? '–'}</td>
                      <td className="num" data-label="People">
                        {humans(r).filter((p) => p.connected).length}/{humans(r).length}
                        {r.players.length > humans(r).length && <small> +{r.players.length - humans(r).length} bots</small>}
                      </td>
                      <td data-label="Phase">
                        {PHASE[r.phase] ?? r.phase}
                        {r.poster !== null && (
                          <small>
                            {' '}
                            · poster {r.poster + 1}/{r.posters}
                          </small>
                        )}{' '}
                        <Countdown endsAt={r.phaseEndsAt} offset={offset} />
                      </td>
                      <td data-label="Opened">{ago(r.createdAt)}</td>
                      <td className="adm-row-actions">
                        {r.phase === 'ended' && (
                          <button className="adm-btn small" onClick={() => showFinished('', r.code)}>
                            Results
                          </button>
                        )}
                        <button className="adm-btn small danger" onClick={() => closeRoom(r)}>
                          Close
                        </button>
                      </td>
                    </tr>
                    {open === r.code && (
                      <tr className="adm-subrow">
                        <td colSpan={6}>
                          <ul className="adm-players">
                            {r.players.map((p) => (
                              <li key={p.name}>
                                <span className={`adm-dot ${p.bot ? 'bot' : p.connected ? 'on' : 'off'}`} />
                                <b>{p.name}</b> {p.host && <Badge>host</Badge>} {p.bot && <Badge tone="muted">bot</Badge>} {p.away && <Badge tone="warn">left</Badge>}
                                {!p.bot && (
                                  <>
                                    <Anon id={p.anon} />
                                    {p.anon && (
                                      <button className="adm-btn small ghost" onClick={() => ban(p)}>
                                        Ban
                                      </button>
                                    )}
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Grid>
        <Card title="Recently finished games" note="Kept in memory for 3 hours after they end, with the full results.">
          {data.finished.length === 0 ? (
            <Empty>None since the server started.</Empty>
          ) : (
            <ul className="adm-list">
              {data.finished.map((f) => (
                <li key={f.gameId}>
                  <span>
                    Room <code>{f.code}</code> · {f.players} players · {ago(f.endedAt)}
                  </span>
                  <button className="adm-btn small" onClick={() => showFinished(f.gameId)}>
                    Results
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent errors" note={`Node ${s.node}. Messages only, never player data.`}>
          {data.errors.length === 0 ? (
            <Empty>No errors. Quiet as a Sunday.</Empty>
          ) : (
            <ul className="adm-errors">
              {data.errors.map((e, i) => (
                <li key={i}>
                  <time>{ago(e.at)}</time> <code>{e.message}</code>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Grid>

      {reveal && (
        <div className="adm-modal-backdrop" onClick={() => setReveal(null)}>
          <div className="adm-modal wide" role="dialog" aria-modal="true" aria-label="Game results" onClick={(e) => e.stopPropagation()}>
            <h3>Game results</h3>
            <Reveal f={reveal} />
            <div className="adm-modal-actions">
              <button className="adm-btn" onClick={() => setReveal(null)}>
                Close
              </button>
            </div>
            <p className="adm-modal-foot">Viewing results is recorded in the admin log.</p>
          </div>
        </div>
      )}
    </>
  );
}

/** A small line chart: one value per minute, with the latest value and the range. */
function Spark({ label, points, unit }: { label: string; points: number[]; unit: string }) {
  const W = 220;
  const H = 54;
  if (points.length < 2) {
    return (
      <div className="adm-spark">
        <div className="adm-spark-head">
          <span>{label}</span>
          <b>{points.length ? `${Math.round(points[0])}${unit}` : '–'}</b>
        </div>
        <p className="adm-note">Collecting (one point a minute)…</p>
      </div>
    );
  }
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`).join(' ');
  return (
    <div className="adm-spark">
      <div className="adm-spark-head">
        <span>{label}</span>
        <b>
          {Math.round(points[points.length - 1])}
          {unit}
        </b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${label}, last ${points.length} minutes`}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="adm-spark-range">
        {Math.round(lo)}–{Math.round(hi)}
        {unit} over {points.length} min
      </div>
    </div>
  );
}
