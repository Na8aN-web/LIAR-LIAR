-- Wanted: True Colors: analytics and admin database (Postgres 14+).
-- Applied automatically when the server starts with ANALYTICS_STORE=postgres (every statement is
-- idempotent). Keep in sync with store/schema.ts (a test checks they match).
--
-- Privacy: no player names (except the display name typed on a feedback form), no session tokens,
-- no player IP addresses. `anon` is a one-way hash of a random id the player's browser made up.

-- Analytics events: visits, funnel steps, billboard views, concurrency samples, abandoned games,
-- safety events (reports keep the reported chat lines in `data`; chat is stored nowhere else).
CREATE TABLE IF NOT EXISTS events (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL,
  type    TEXT NOT NULL,
  anon    TEXT CHECK (anon IS NULL OR anon ~ '^[A-Za-z0-9_-]{16}$'),
  data    JSONB NOT NULL DEFAULT '{}'::jsonb,
  seed    BOOLEAN NOT NULL DEFAULT FALSE
);
-- The allowed event types, replaced on every start so databases created by an older version
-- accept new types too.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN ('visit', 'step', 'billboard', 'concurrency', 'abandoned', 'safety', 'lobby'));
CREATE INDEX IF NOT EXISTS events_type_at ON events (type, at);
CREATE INDEX IF NOT EXISTS events_anon_at ON events (anon, at) WHERE anon IS NOT NULL;

-- One row per finished game (the same JSON as games.jsonl in file mode).
CREATE TABLE IF NOT EXISTS games (
  id          BIGSERIAL PRIMARY KEY,
  game_id     TEXT,
  ended_at    TIMESTAMPTZ NOT NULL,
  players     INTEGER NOT NULL,
  bots        INTEGER NOT NULL,
  check_game  BOOLEAN NOT NULL DEFAULT FALSE,
  seed        BOOLEAN NOT NULL DEFAULT FALSE,
  summary     JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS games_ended_at ON games (ended_at);

-- End-of-game feedback form answers.
CREATE TABLE IF NOT EXISTS feedback (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL,
  game_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  anon     TEXT,
  answers  JSONB NOT NULL,
  seed     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS feedback_at ON feedback (at);

-- Every admin action and login attempt (with the IP of whoever used the admin area).
CREATE TABLE IF NOT EXISTS admin_audit (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL,
  action   TEXT NOT NULL,
  ok       BOOLEAN NOT NULL,
  detail   JSONB,
  ip       TEXT NOT NULL,
  country  TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_at ON admin_audit (at);

-- Banned browsers, by anonymous id.
CREATE TABLE IF NOT EXISTS bans (
  anon    TEXT PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL,
  reason  TEXT NOT NULL DEFAULT ''
);

-- Small admin settings: maintenance mode, default game settings, billboard versions.
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Billboard images uploaded from the dashboard (PNG, JPEG or WebP, at most 2 MB).
CREATE TABLE IF NOT EXISTS billboards (
  slot          TEXT PRIMARY KEY,
  version       TEXT NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes         BYTEA NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
