'use client';

import { useState } from 'react';
import { int, pct, shortDay, useAdmin } from '../api';
import { Bars, Columns, PALETTE, Split } from '../charts';
import { Card, Empty, Grid, Stat, Stats, Status, query, useFilters } from '../ui';

interface GrowthData {
  series: { day: string; visitors: number; players: number; new: number; returning: number; games: number; peak: number }[];
  totals: { visitors: number; players: number; newVisitors: number; games: number; peak: number };
  retention: {
    nextDay: number | null;
    nextWeek: number | null;
    nextDayCohort: number;
    nextWeekCohort: number;
    cohorts: { day: string; new: number; nextDay: number | null; nextWeek: number | null }[];
  };
  devices: { key: string; n: number }[];
  countries: { key: string; n: number }[];
  lobby: {
    totals: { quickJoin: number; quickCreate: number; listJoin: number; codeJoin: number; createPublic: number; createPrivate: number; publicWaitingPeak: number };
    daily: { day: string; quickPlay: number; list: number; code: number; publicWaiting: number }[];
  };
}

const countryName = (code: string) => {
  if (code === 'Unknown') return 'Unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function GrowthPage() {
  const { filters } = useFilters();
  const { data, error, loading } = useAdmin<GrowthData>(`/growth${query(filters)}`);
  const [allCohorts, setAllCohorts] = useState(false);
  if (!data) return <Status error={error} loading={loading} />;
  const days = data.series.map((s) => s.day);
  const r = data.retention;
  const avg = (k: 'visitors' | 'players') => (data.series.length ? data.series.reduce((a, s) => a + s[k], 0) / data.series.length : 0);
  return (
    <>
      <Stats>
        <Stat label="Visitors" value={int(data.totals.visitors)} sub={`${int(avg('visitors'))} a day on average`} />
        <Stat label="Players" value={int(data.totals.players)} sub="reached a lobby" />
        <Stat label="New visitors" value={int(data.totals.newVisitors)} sub="first visit in this period" />
        <Stat label="Games finished" value={int(data.totals.games)} />
        <Stat label="Peak online" value={int(data.totals.peak)} sub="players at once" />
        <Stat label="Back next day" value={pct(r.nextDay)} sub={`of ${int(r.nextDayCohort)} new visitors`} />
        <Stat label="Back within a week" value={pct(r.nextWeek)} sub={`of ${int(r.nextWeekCohort)} new visitors`} />
      </Stats>
      <Grid>
        <Card title="Daily visitors" note="Each visitor counted once a day. New = their first day ever.">
          <Columns
            days={days}
            series={[
              { key: 'new', label: 'New', color: PALETTE.red, values: data.series.map((s) => s.new) },
              { key: 'returning', label: 'Returning', color: PALETTE.brass, values: data.series.map((s) => s.returning) },
            ]}
          />
        </Card>
        <Card title="Daily players" note="Visitors who reached a lobby.">
          <Columns days={days} series={[{ key: 'p', label: 'Players', color: PALETTE.sage, values: data.series.map((s) => s.players) }]} />
        </Card>
        <Card title="Games per day" note="Finished games with people in them.">
          <Columns days={days} series={[{ key: 'g', label: 'Games', color: PALETTE.ink, values: data.series.map((s) => s.games) }]} />
        </Card>
        <Card title="Peak players online" note="Highest number of seated players at once, sampled every minute.">
          <Columns days={days} series={[{ key: 'c', label: 'Peak', color: PALETTE.sky, values: data.series.map((s) => s.peak) }]} />
        </Card>
        <Card title="Phones and computers" note="Each visitor once, from their latest visit.">
          {data.devices.length ? (
            <Split parts={data.devices.map((d) => ({ label: d.key === 'mobile' ? 'Phones & tablets' : 'Computers', value: d.n, color: d.key === 'mobile' ? PALETTE.red : PALETTE.ink }))} />
          ) : (
            <Empty>No visits yet.</Empty>
          )}
        </Card>
        <Card title="Countries" note="From Cloudflare's country header. IP addresses are never stored.">
          {data.countries.length ? <Bars rows={data.countries.slice(0, 10).map((c) => ({ label: countryName(c.key), value: c.n }))} color={PALETTE.brass} /> : <Empty>No visits yet.</Empty>}
        </Card>
      </Grid>
      <Card title="Getting into a game" note="How players got into rooms: Quick Play, the Find a Lobby list, or a code / invite link." wide>
        <Stats>
          <Stat label="Quick Play" value={int(data.lobby.totals.quickJoin + data.lobby.totals.quickCreate)} sub={`${int(data.lobby.totals.quickJoin)} joined a room · ${int(data.lobby.totals.quickCreate)} opened one`} />
          <Stat label="Joined from the list" value={int(data.lobby.totals.listJoin)} />
          <Stat label="Code or invite link" value={int(data.lobby.totals.codeJoin)} />
          <Stat label="Rooms opened" value={int(data.lobby.totals.createPublic + data.lobby.totals.createPrivate)} sub={`${int(data.lobby.totals.createPublic)} public · ${int(data.lobby.totals.createPrivate)} private`} />
          <Stat label="Public rooms waiting" value={int(data.lobby.totals.publicWaitingPeak)} sub="most at once" />
        </Stats>
        <Columns
          days={days}
          series={[
            { key: 'q', label: 'Quick Play', color: PALETTE.red, values: data.lobby.daily.map((d) => d.quickPlay) },
            { key: 'l', label: 'From the list', color: PALETTE.brass, values: data.lobby.daily.map((d) => d.list) },
            { key: 'c', label: 'Code or link', color: PALETTE.sage, values: data.lobby.daily.map((d) => d.code) },
          ]}
        />
      </Card>
      <Card title="Do new visitors come back?" note="Grouped by first visit. A rate shows once enough days have passed to measure it." wide>
        {r.cohorts.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>First visit</th>
                  <th className="num">New</th>
                  <th className="num">Next day</th>
                  <th className="num">Within 7 days</th>
                </tr>
              </thead>
              <tbody>
                {r.cohorts
                  .slice()
                  .reverse()
                  .slice(0, allCohorts ? undefined : 14)
                  .map((c) => (
                    <tr key={c.day}>
                      <td>{shortDay(c.day)}</td>
                      <td className="num">{int(c.new)}</td>
                      <td className="num">{c.nextDay === null ? <span className="muted">too soon</span> : pct(c.nextDay)}</td>
                      <td className="num">{c.nextWeek === null ? <span className="muted">too soon</span> : pct(c.nextWeek)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {r.cohorts.length > 14 && (
              <button className="adm-btn small ghost adm-more" onClick={() => setAllCohorts(!allCohorts)}>
                {allCohorts ? 'Show the last 14 days' : `Show all ${r.cohorts.length} days`}
              </button>
            )}
          </div>
        ) : (
          <Empty>No new visitors in this period.</Empty>
        )}
      </Card>
    </>
  );
}
