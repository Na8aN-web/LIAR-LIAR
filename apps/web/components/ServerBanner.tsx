'use client';

import { useEffect } from 'react';
import { useServerStatus } from '@/lib/serverStatus';

/** Messages from the admins, maintenance mode, and the banned notice: a telegram strip up top. */
export function ServerBanner() {
  const maintenance = useServerStatus((s) => s.maintenance);
  const announcements = useServerStatus((s) => s.announcements);
  const banned = useServerStatus((s) => s.banned);
  const dismiss = useServerStatus((s) => s.dismiss);

  // Announcements fade after a minute.
  useEffect(() => {
    if (!announcements.length) return;
    const t = setTimeout(() => dismiss(announcements[0].id), 60_000);
    return () => clearTimeout(t);
  }, [announcements, dismiss]);

  if (!banned && !maintenance.on && !announcements.length) return null;
  return (
    <div className="server-banner" role="status" aria-live="polite">
      {banned && (
        <div className="server-note danger">
          <b>Run out of town.</b> This browser was banned from the game.
        </div>
      )}
      {maintenance.on && !banned && (
        <div className="server-note">
          <b>Closed for repairs.</b> {maintenance.message}
        </div>
      )}
      {announcements.map((a) => (
        <div key={a.id} className="server-note">
          <span className="server-note-tag">From the sheriff’s office</span>
          {a.text}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(a.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
