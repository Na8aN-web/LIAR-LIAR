'use client';

import { int, pct, useAdmin } from '../api';
import { PALETTE, Split } from '../charts';
import { Card, Empty, Grid, Stat, Stats, Status, query, useFilters } from '../ui';

interface Stage {
  key: string;
  label: string;
  n: number;
  ofVisitors: number | null;
  dropFromPrevious: number | null;
  optional?: boolean;
  detail?: { finished: number; skipped: number; notOpened: number };
}

export function FunnelPage() {
  const { filters } = useFilters();
  const { data, error, loading } = useAdmin<Stage[]>(`/funnel${query(filters)}`);
  if (!data) return <Status error={error} loading={loading} />;
  const top = data[0]?.n ?? 0;
  if (!top) return <Empty>No visitors in this period.</Empty>;
  const howto = data.find((s) => s.key === 'howto')?.detail;
  const worst = data.slice(1).reduce((a, s) => ((s.dropFromPrevious ?? 0) > (a?.dropFromPrevious ?? -1) ? s : a), null as Stage | null);
  return (
    <>
      <Stats>
        <Stat label="Visitors" value={int(top)} />
        <Stat label="Reached a game" value={pct(data.find((s) => s.key === 'start')?.ofVisitors)} sub="of visitors" />
        <Stat label="Finished a game" value={pct(data.find((s) => s.key === 'finish')?.ofVisitors)} sub="of visitors" />
        <Stat label="Played again" value={pct(data.find((s) => s.key === 'again')?.ofVisitors)} sub="of visitors" />
        {worst && <Stat label="Biggest drop" value={pct(worst.dropFromPrevious)} sub={`before “${worst.label}”`} tone="warn" />}
      </Stats>
      <Card title="From first visit to playing again" note="Of everyone who visited in this period, how many reached each step. People who arrive on a room link skip the homepage." wide>
        <ol className="adm-funnel">
          {data.map((s) => (
            <li key={s.key} className={s.optional ? 'optional' : ''}>
              <div className="adm-funnel-head">
                <span className="adm-funnel-label">{s.label}</span>
                <span className="adm-funnel-n">
                  {int(s.n)} <small>{pct(s.ofVisitors)}</small>
                </span>
              </div>
              <div className="adm-funnel-track">
                <div className="adm-funnel-fill" style={{ width: `${Math.max(0.5, (s.n / top) * 100)}%` }} />
              </div>
              {s.optional && <span className="adm-funnel-opt">Optional step: not counted as a drop-off</span>}
              {s.dropFromPrevious !== null && s.dropFromPrevious > 0 && <span className="adm-funnel-drop">−{pct(s.dropFromPrevious)} from the step before</span>}
            </li>
          ))}
        </ol>
      </Card>
      {howto && (
        <Grid>
          <Card title="How to Play" note="What visitors did with the walkthrough.">
            <Split
              parts={[
                { label: 'Finished', value: howto.finished, color: PALETTE.sage },
                { label: 'Skipped', value: howto.skipped, color: PALETTE.brass },
                { label: 'Never opened', value: howto.notOpened, color: PALETTE.sand },
              ]}
            />
          </Card>
        </Grid>
      )}
    </>
  );
}
