import type { AnalyticsEvent, EventType } from '../analytics/events';
import type { GameSummary } from '../game/summary';
import type { FeedbackEntry } from '../room';

// Where the server keeps analytics, feedback, the admin log and admin settings.
// Two interchangeable stores: files (local, playtests) and Postgres (launch). Pick one with
// ANALYTICS_STORE=file|postgres (see store/index.ts). Nothing here holds a name (except the
// display name players type on the feedback form), a session token or a player's IP address.

export interface Range {
  from?: Date;
  to?: Date;
}

/** One admin action (or login attempt). The IP is of whoever used the admin area, kept for security. */
export interface AuditEntry {
  at: string;
  action: string;
  ok: boolean;
  detail?: Record<string, unknown>;
  ip: string;
  country?: string | null;
}

export interface Ban {
  anon: string;
  at: string;
  reason: string;
}

export interface BillboardImage {
  slot: string;
  version: string;
  contentType: string;
  bytes: Buffer;
}

export interface Store {
  readonly kind: 'file' | 'postgres';
  init(): Promise<void>;

  addEvent(e: AnalyticsEvent): Promise<void>;
  addGame(g: GameSummary): Promise<void>;
  addFeedback(f: FeedbackEntry): Promise<void>;
  addAudit(a: AuditEntry): Promise<void>;

  events(q?: Range & { types?: EventType[] }): Promise<AnalyticsEvent[]>;
  games(q?: Range): Promise<GameSummary[]>;
  feedback(q?: Range): Promise<FeedbackEntry[]>;
  /** Newest first. */
  audit(q?: Range & { limit?: number }): Promise<AuditEntry[]>;

  bans(): Promise<Ban[]>;
  addBan(b: Ban): Promise<void>;
  removeBan(anon: string): Promise<void>;

  /** Small admin settings (maintenance, default game settings, billboard versions). */
  getConfig<T>(key: string): Promise<T | null>;
  setConfig(key: string, value: unknown): Promise<void>;

  putBillboard(img: BillboardImage): Promise<void>;
  getBillboard(slot: string): Promise<BillboardImage | null>;
  removeBillboard(slot: string): Promise<void>;

  /** Deletes everything `pnpm admin:seed` added. Returns how many records went. */
  removeSeed(): Promise<number>;
  close(): Promise<void>;
}

export const inRange = (at: string, r: Range = {}) => {
  const t = Date.parse(at);
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
};
