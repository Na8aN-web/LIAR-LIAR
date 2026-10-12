'use client';

import { useState } from 'react';
import { adminFetch, int, useAdmin, when } from '../api';
import { Bars, Columns, PALETTE } from '../charts';
import { Anon, Badge, Card, Empty, Grid, Stat, Stats, Status, query, useConfirm, useFilters } from '../ui';

interface SafetyData {
  counts: { report: number; kick: number; mute: number; ban: number; unban: number; rate_limit: number };
  daily: { day: string; report: number; kick: number; mute: number; ban: number; rate_limit: number }[];
  reports: { at: string; target: string | null; reason: string; chat: { text: string; reported: boolean; fromReported: boolean }[]; timesReported?: number; seed: boolean }[];
  actions: { at: string; kind: string; by: string | null; target: string | null; reason: string }[];
  rateLimits: { limit: string; n: number }[];
  bans: { anon: string; at: string; reason: string }[];
}

const LIMIT_LABEL: Record<string, string> = {
  connect: 'New connections (per-IP ceiling)',
  connectBrowser: 'New connections (per browser)',
  create: 'New rooms (per browser)',
  createIp: 'New rooms (per-IP ceiling)',
  joinBrowser: 'Wrong room codes (per browser)',
  joinIp: 'Wrong room codes (per-IP ceiling)',
  lobbyWatch: 'Lobby list opens (per browser)',
  lobbyWatchIp: 'Lobby list opens (per-IP ceiling)',
  lobbyJoin: 'Quick Play / list joins (per browser)',
  lobbyJoinIp: 'Quick Play / list joins (per-IP ceiling)',
  joinSocket: 'Wrong room codes (per connection)',
  events: 'Actions (per connection)',
  chat: 'Chat messages',
  offers: 'Buy offers',
  probe: 'Color picks',
};

export function SafetyPage() {
  const { filters } = useFilters();
  const { data, error, loading, reload } = useAdmin<SafetyData>(`/safety${query(filters)}`);
  const confirm = useConfirm();
  const [manual, setManual] = useState('');

  const ban = (anon: string, context?: string) =>
    confirm({
      title: 'Ban this player?',
      body: (
        <p>
          Bans the browser behind anonymous id <Anon id={anon} />
          {context ? ` (${context})` : ''}. It's disconnected now and can't connect again. Someone determined can get round a browser ban by clearing their browser data.
        </p>
      ),
      confirm: 'Ban',
      danger: true,
      input: { label: 'Reason (for the log)', placeholder: 'e.g. abusive chat', max: 200 },
      run: async (reason) => {
        const r = await adminFetch<{ disconnected: number }>('/bans', { body: { anon, reason } });
        void reload();
        return `Banned. ${r.disconnected} connection${r.disconnected === 1 ? '' : 's'} dropped.`;
      },
    });
  const unban = (anon: string) =>
    confirm({
      title: 'Lift this ban?',
      body: (
        <p>
          The browser behind <Anon id={anon} /> can connect again.
        </p>
      ),
      confirm: 'Lift ban',
      run: async () => {
        await adminFetch('/bans/remove', { body: { anon } });
        void reload();
        return 'Ban lifted.';
      },
    });

  if (!data) return <Status error={error} loading={loading} />;
  const banned = new Set(data.bans.map((b) => b.anon));
  const c = data.counts;
  return (
    <>
      <Stats>
        <Stat label="Reports" value={int(c.report)} tone={c.report ? 'warn' : undefined} />
        <Stat label="Kicks by hosts" value={int(c.kick)} />
        <Stat label="Mutes" value={int(c.mute)} />
        <Stat label="Bans" value={int(c.ban)} sub={`${data.bans.length} in force`} />
        <Stat label="Rate-limit hits" value={int(c.rate_limit)} />
      </Stats>
      <Card title="Per day" wide>
        <Columns
          days={data.daily.map((d) => d.day)}
          series={[
            { key: 'report', label: 'Reports', color: PALETTE.red, values: data.daily.map((d) => d.report) },
            { key: 'kick', label: 'Kicks', color: PALETTE.brass, values: data.daily.map((d) => d.kick) },
            { key: 'mute', label: 'Mutes', color: PALETTE.sand, values: data.daily.map((d) => d.mute) },
            { key: 'ban', label: 'Bans', color: PALETTE.ink, values: data.daily.map((d) => d.ban) },
          ]}
          height={120}
        />
      </Card>
      <Card title="Reported messages" note="Chat is stored only when someone reports a message: that message (highlighted) and up to four before it. No names." wide>
        {data.reports.length === 0 ? (
          <Empty>No reports in this period.</Empty>
        ) : (
          <ul className="adm-reports">
            {data.reports.map((r, i) => (
              <li key={i}>
                <header>
                  <span>
                    {when(r.at)} · reported player <Anon id={r.target} />
                    {r.timesReported && r.timesReported > 1 && <Badge tone="warn">reported {r.timesReported}×</Badge>} {r.seed && <Badge tone="muted">seed</Badge>}
                  </span>
                  {r.target &&
                    (banned.has(r.target) ? (
                      <Badge tone="bad">banned</Badge>
                    ) : (
                      <button className="adm-btn small danger" onClick={() => ban(r.target!, 'reported in chat')}>
                        Ban player
                      </button>
                    ))}
                </header>
                {r.reason && <p className="adm-note">Reason given: “{r.reason}”</p>}
                <ol className="adm-chat">
                  {r.chat.map((m, j) => (
                    <li key={j} className={`${m.reported ? 'reported' : ''} ${m.fromReported ? 'them' : ''}`}>
                      <span className="who">{m.fromReported ? 'Reported player' : 'Someone else'}</span> {m.text}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Grid>
        <Card title="Bans in force">
          {data.bans.length === 0 ? (
            <Empty>Nobody is banned.</Empty>
          ) : (
            <ul className="adm-list">
              {data.bans.map((b) => (
                <li key={b.anon}>
                  <span>
                    <Anon id={b.anon} /> {when(b.at)}
                    {b.reason && <small> · {b.reason}</small>}
                  </span>
                  <button className="adm-btn small ghost" onClick={() => unban(b.anon)}>
                    Lift
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="adm-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) ban(manual.trim());
            }}
          >
            <label className="adm-field">
              <span>Ban by anonymous id</span>
              <input value={manual} placeholder="16-character id from Live or a report" maxLength={16} onChange={(e) => setManual(e.target.value)} />
            </label>
            <button className="adm-btn danger" disabled={manual.trim().length !== 16}>
              Ban
            </button>
          </form>
        </Card>
        <Card title="Kicks and bans">
          {data.actions.length === 0 ? (
            <Empty>None in this period.</Empty>
          ) : (
            <ul className="adm-list">
              {data.actions.slice(0, 15).map((a, i) => (
                <li key={i}>
                  <span>
                    <Badge tone={a.kind === 'ban' ? 'bad' : a.kind === 'unban' ? 'good' : undefined}>{a.kind}</Badge> <Anon id={a.target} /> by {a.by ?? '?'}
                    {a.reason && <small> · {a.reason}</small>}
                  </span>
                  <time>{when(a.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Rate limits hit" note="Which limits stopped someone. A lot of one kind can mean a script, or a limit set too tight.">
          {data.rateLimits.length === 0 ? <Empty>No limits hit.</Empty> : <Bars rows={data.rateLimits.map((r) => ({ label: LIMIT_LABEL[r.limit] ?? r.limit, value: r.n }))} color={PALETTE.ink} />}
        </Card>
      </Grid>
    </>
  );
}
