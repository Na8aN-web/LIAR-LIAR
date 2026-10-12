import * as Sentry from '@sentry/node';

// Error alerts (Sentry), on only when SENTRY_DSN is set. No personal data: no IPs, no request
// bodies, no chat. Just the error and where it happened.

let on = false;

export function initErrorReporting() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    // Nothing personal: no user info, cookies, headers, bodies, query strings or local variables.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false },
    tracesSampleRate: 0,
  });
  on = true;
  console.log('Error reporting: Sentry on');
}

/** Reports an error caught by a handler (uncaught ones Sentry catches by itself). */
export function reportError(err: unknown, where: string) {
  if (on) Sentry.captureException(err, { tags: { where } });
}
