'use client';

import { useEffect, useState } from 'react';
import { SOURCES } from '@wtc/shared';
import { int, pct, useAdmin } from '../api';
import { Bars, Columns, PALETTE } from '../charts';
import { Card, Empty, Grid, Status, query, useFilters } from '../ui';

interface SourcesData {
  rows: { src: string; visitors: number; players: number; finishers: number; finishedGames: number; playRate: number | null; finishRate: number | null }[];
  daily: ({ day: string } & Record<string, number | string>)[];
}

export const SOURCE_LABEL: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', discord: 'Discord', x: 'X', instagram: 'Instagram', other: 'Other links', direct: 'Direct / unknown' };
export const SOURCE_COLOR: Record<string, string> = {
  youtube: PALETTE.red,
  tiktok: PALETTE.ink,
  discord: PALETTE.plum,
  x: PALETTE.sky,
  instagram: PALETTE.brass,
  other: PALETTE.sand,
  direct: PALETTE.sage,
};

export function SourcesPage() {
  const { filters } = useFilters();
  const { data, error, loading } = useAdmin<SourcesData>(`/sources${query(filters)}`);
  const [origin, setOrigin] = useState('https://your-site');
  useEffect(() => setOrigin(location.origin), []);
  if (!data) return <Status error={error} loading={loading} />;
  const keys = [...SOURCES, 'other', 'direct'];
  return (
    <>
      <Card title="Where players come from" note="Each visitor is credited to the link of their very first visit." wide>
        {data.rows.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="num">Visitors</th>
                  <th className="num">Played</th>
                  <th className="num">Play rate</th>
                  <th className="num">Finished a game</th>
                  <th className="num">Games finished</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.src}>
                    <td>
                      <i className="adm-swatch" style={{ background: SOURCE_COLOR[r.src] }} /> {SOURCE_LABEL[r.src] ?? r.src}
                    </td>
                    <td className="num">{int(r.visitors)}</td>
                    <td className="num">{int(r.players)}</td>
                    <td className="num">{pct(r.playRate)}</td>
                    <td className="num">{int(r.finishers)}</td>
                    <td className="num">{int(r.finishedGames)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No visits in this period.</Empty>
        )}
      </Card>
      <Grid>
        <Card title="Players by source" note="Visitors who reached a lobby.">
          <Bars rows={data.rows.map((r) => ({ label: SOURCE_LABEL[r.src] ?? r.src, value: r.players, color: SOURCE_COLOR[r.src] }))} />
        </Card>
        <Card title="Finished games by source" note="Games finished by visitors from each source.">
          <Bars rows={data.rows.map((r) => ({ label: SOURCE_LABEL[r.src] ?? r.src, value: r.finishedGames, color: SOURCE_COLOR[r.src] }))} />
        </Card>
      </Grid>
      <Card title="New visitors by source, per day" wide>
        <Columns
          days={data.daily.map((d) => d.day)}
          series={keys
            .filter((k) => data.daily.some((d) => Number(d[k] ?? 0) > 0))
            .map((k) => ({ key: k, label: SOURCE_LABEL[k], color: SOURCE_COLOR[k], values: data.daily.map((d) => Number(d[k] ?? 0)) }))}
        />
      </Card>
      <Card title="Links to share" note="Add ?src= to any link (the homepage or a room link) so its visitors show up here. The tag is removed from the address bar once the page opens." wide>
        <ul className="adm-links">
          {SOURCES.map((s) => (
            <li key={s}>
              <span>{SOURCE_LABEL[s]}</span>
              <code>
                {origin}/?src={s}
              </code>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
