'use client';

import { useState } from 'react';
import { dec, int, pct, useAdmin, when } from '../api';
import { Bars, PALETTE } from '../charts';
import { Badge, Card, Empty, Grid, Stat, Stats, Status, query, useFilters } from '../ui';

interface BalanceData {
  games: number;
  accuracy: { early: number | null; mid: number | null; late: number | null };
  escape: { overall: number | null; early: number | null; mid: number | null; late: number | null };
  perPlayer: { findingsBought: number; extraLooks: number; colorChanges: number; searches: number };
  avgMinutes: number | null;
  avgPlayers: number | null;
  popularSettings: { key: string; n: number }[];
  abandoned: { n: number; rate: number | null };
  recent: { endedAt: string; players: number; bots: number; posters: number; minutes: number; escaped: number; settings: string; seed: boolean }[];
  options: { posterModes: string[]; players: number[]; decoys: number[]; inspects: number[]; swaps: number[] };
}

const MODE: Record<string, string> = { everyoneOnce: 'Everyone once', randomRepeats: 'Random repeats' };

export function BalancePage() {
  const { filters } = useFilters();
  const [f, setF] = useState({ posterMode: '', minPlayers: '', maxPlayers: '', decoys: '', inspects: '', swaps: '', botOnly: '', who: '' });
  const { data, error, loading } = useAdmin<BalanceData>(`/balance${query(filters, f)}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? ((e.target as HTMLInputElement).checked ? '1' : '') : e.target.value });
  const opts = data?.options;
  const select = (k: keyof typeof f, label: string, values: (string | number)[] | undefined, show: (v: string | number) => string = String) => (
    <label className="adm-field inline">
      <span>{label}</span>
      <select value={f[k]} onChange={set(k)}>
        <option value="">Any</option>
        {(values ?? []).map((v) => (
          <option key={v} value={v}>
            {show(v)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <div className="adm-filters">
        {select('posterMode', 'Posters', opts?.posterModes, (v) => MODE[v] ?? String(v))}
        {select('minPlayers', 'Players from', opts?.players)}
        {select('maxPlayers', 'to', opts?.players)}
        {select('inspects', 'Searches', opts?.inspects)}
        {select('decoys', 'Fakes', opts?.decoys)}
        {select('swaps', 'Color changes', opts?.swaps)}
        <label className="adm-field inline">
          <span>Players</span>
          <select value={f.who} onChange={set('who')}>
            <option value="">All games</option>
            <option value="humans">Human-only games</option>
            <option value="withBots">Games with bots</option>
          </select>
        </label>
        <label className="adm-check">
          <input type="checkbox" checked={f.botOnly === '1'} onChange={set('botOnly')} /> Include bot-only games
        </label>
      </div>
      {!data ? (
        <Status error={error} loading={loading} />
      ) : !data.games ? (
        <Empty>No finished games match these filters.</Empty>
      ) : (
        <>
          <Stats>
            <Stat label="Games" value={int(data.games)} sub={`${dec(data.avgPlayers)} players on average`} />
            <Stat label="Average length" value={`${dec(data.avgMinutes)} min`} />
            <Stat label="Outlaw escapes" value={pct(data.escape.overall)} sub="of rounds" />
            <Stat label="Abandoned" value={int(data.abandoned.n)} sub={`${pct(data.abandoned.rate)} of games started`} tone={(data.abandoned.rate ?? 0) > 0.2 ? 'warn' : undefined} />
          </Stats>
          <Grid>
            <Card title="Right accusations, by stage" note="Share of accusers who named the outlaw, in the first, middle and last third of each game.">
              <Bars
                format={(n) => pct(n)}
                max={1}
                rows={[
                  { label: 'Early', value: data.accuracy.early ?? 0, color: PALETTE.brass },
                  { label: 'Middle', value: data.accuracy.mid ?? 0, color: PALETTE.red },
                  { label: 'Late', value: data.accuracy.late ?? 0, color: PALETTE.ink },
                ]}
              />
            </Card>
            <Card title="Outlaw escapes, by stage" note="Rounds where nobody accused the outlaw.">
              <Bars
                format={(n) => pct(n)}
                max={1}
                rows={[
                  { label: 'Early', value: data.escape.early ?? 0, color: PALETTE.brass },
                  { label: 'Middle', value: data.escape.mid ?? 0, color: PALETTE.red },
                  { label: 'Late', value: data.escape.late ?? 0, color: PALETTE.ink },
                ]}
              />
            </Card>
            <Card title="Per player, per game">
              <Bars
                format={(n) => dec(n, 2)}
                color={PALETTE.sage}
                rows={[
                  { label: 'Searches', value: data.perPlayer.searches },
                  { label: 'Findings bought', value: data.perPlayer.findingsBought },
                  { label: 'Extra looks bought', value: data.perPlayer.extraLooks },
                  { label: 'Color changes', value: data.perPlayer.colorChanges },
                ]}
              />
            </Card>
          </Grid>
          <Card title="Popular settings" note="Games played with each combination." wide>
            <Bars rows={data.popularSettings.map((s) => ({ label: <span className="adm-small">{s.key}</span>, value: s.n }))} color={PALETTE.brass} />
          </Card>
          <Card title="Recent games" wide>
            <div className="adm-table-wrap">
              <table className="adm-table adm-stack">
                <thead>
                  <tr>
                    <th>Ended</th>
                    <th className="num">Players</th>
                    <th className="num">Posters</th>
                    <th className="num">Escapes</th>
                    <th className="num">Minutes</th>
                    <th>Settings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((g, i) => (
                    <tr key={i}>
                      <td className="adm-cell-main">
                        {when(g.endedAt)} {g.seed && <Badge tone="muted">seed</Badge>}
                      </td>
                      <td className="num" data-label="Players">
                        {g.players}
                        {g.bots > 0 && <small> ({g.bots} bots)</small>}
                      </td>
                      <td className="num" data-label="Posters">{g.posters}</td>
                      <td className="num" data-label="Escapes">{g.escaped}</td>
                      <td className="num" data-label="Minutes">{dec(g.minutes)}</td>
                      <td className="adm-small adm-cell-wide">{g.settings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
