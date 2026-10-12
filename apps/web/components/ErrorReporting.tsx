'use client';

import { useEffect } from 'react';

// Browser error alerts (Sentry), on only when NEXT_PUBLIC_SENTRY_DSN was set at build time.
// No personal data: no IPs, cookies, headers or query strings; player names and chat are never
// attached. Loaded lazily so players without errors don't download it up front.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function ErrorReporting() {
  useEffect(() => {
    if (!dsn || process.env.NODE_ENV !== 'production') return;
    void import('@sentry/browser').then((Sentry) =>
      Sentry.init({
        dsn,
        environment: 'production',
        tracesSampleRate: 0,
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
        // Room codes are in the URL path (/r/CODE): keep them out of reports.
        beforeSend(event) {
          if (event.request?.url) event.request.url = event.request.url.replace(/\/r\/[^/?#]+/, '/r/[room]');
          return event;
        },
      }),
    );
  }, []);
  return null;
}
