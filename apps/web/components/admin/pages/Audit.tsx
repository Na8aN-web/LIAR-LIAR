'use client';

import { useAdmin, when } from '../api';
import { Badge, Card, Empty, Status } from '../ui';

interface AuditData {
  entries: { at: string; action: string; ok: boolean; detail?: Record<string, unknown>; ip: string; country?: string | null }[];
}

const ACTION: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  view_game_secrets: 'Viewed game results',
  close_room: 'Closed a room',
  ban: 'Banned a player',
  unban: 'Lifted a ban',
  broadcast: 'Messaged everyone',
  maintenance: 'Maintenance mode',
  default_settings: 'Default settings',
  billboard_upload: 'Replaced a billboard',
  billboard_reset: 'Reset a billboard',
};

const describe = (d?: Record<string, unknown>) =>
  d
    ? Object.entries(d)
        .filter(([k]) => k !== 'settings')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' · ')
    : '';

export function AuditPage() {
  const { data, error, loading } = useAdmin<AuditData>('/audit?limit=300');
  if (!data) return <Status error={error} loading={loading} />;
  const failedLogins = data.entries.filter((e) => e.action === 'login' && !e.ok).length;
  return (
    <Card title="Admin log" note={`Every sign-in attempt and admin action, newest first.${failedLogins ? ` ${failedLogins} failed sign-ins in this list.` : ''}`} wide>
      {data.entries.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Details</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={i}>
                  <td>{when(e.at)}</td>
                  <td>
                    {ACTION[e.action] ?? e.action} {!e.ok && <Badge tone="bad">failed</Badge>}
                  </td>
                  <td className="adm-small">{describe(e.detail)}</td>
                  <td className="adm-small">
                    <code>{e.ip}</code>
                    {e.country && ` · ${e.country}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
