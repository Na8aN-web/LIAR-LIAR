import { DEFAULT_SETTINGS, type BillboardSlot, type RoomSettings, type ServerStatus } from '@wtc/shared';
import { applySettings } from '../room';
import type { Store } from '../store/types';

const KEYS = { maintenance: 'maintenance', defaults: 'defaultSettings', billboards: 'billboards' };
export const DEFAULT_MAINTENANCE_MESSAGE = "The saloon's closed for repairs. Games already running carry on; new rooms open again soon.";

/**
 * Server-wide switches the admins control: maintenance mode, default game settings, replaced
 * billboard images and bans. Kept in memory for speed and saved in the store so they survive a
 * restart.
 */
export class Control {
  maintenance = { on: false, message: DEFAULT_MAINTENANCE_MESSAGE };
  defaults: RoomSettings = structuredClone(DEFAULT_SETTINGS);
  billboards: Partial<Record<BillboardSlot, string>> = {};
  private readonly bans = new Set<string>();

  constructor(private readonly store: Store | null) {}

  async load() {
    if (!this.store) return;
    const m = await this.store.getConfig<typeof this.maintenance>(KEYS.maintenance);
    if (m && typeof m.on === 'boolean') this.maintenance = { on: m.on, message: String(m.message || DEFAULT_MAINTENANCE_MESSAGE) };
    const d = await this.store.getConfig<RoomSettings>(KEYS.defaults);
    // Saved defaults are checked again: an out-of-range value (rules changed since) is dropped.
    if (d) {
      const res = applySettings(structuredClone(DEFAULT_SETTINGS), d);
      if (res.ok) this.defaults = res.settings;
    }
    this.billboards = (await this.store.getConfig<typeof this.billboards>(KEYS.billboards)) ?? {};
    for (const b of await this.store.bans()) this.bans.add(b.anon);
  }

  status(): ServerStatus {
    return { maintenance: { ...this.maintenance }, billboards: { ...this.billboards } };
  }

  async setMaintenance(on: boolean, message?: string) {
    this.maintenance = { on, message: message?.trim() || DEFAULT_MAINTENANCE_MESSAGE };
    await this.store?.setConfig(KEYS.maintenance, this.maintenance);
  }

  async setDefaults(settings: RoomSettings) {
    this.defaults = structuredClone(settings);
    await this.store?.setConfig(KEYS.defaults, settings);
  }

  async setBillboard(slot: BillboardSlot, version: string | null) {
    const next = { ...this.billboards };
    if (version) next[slot] = version;
    else delete next[slot];
    this.billboards = next;
    await this.store?.setConfig(KEYS.billboards, next);
  }

  isBanned(anon: string | null) {
    return !!anon && this.bans.has(anon);
  }

  async ban(anon: string, reason: string) {
    this.bans.add(anon);
    await this.store?.addBan({ anon, at: new Date().toISOString(), reason });
  }

  async unban(anon: string) {
    this.bans.delete(anon);
    await this.store?.removeBan(anon);
  }
}
