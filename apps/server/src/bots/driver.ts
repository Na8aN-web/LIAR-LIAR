import type { ChatMessage, OfferView, Phase, PlayerId, PlayerView } from '@wtc/shared';
import { chance, type Rng } from '../rng';
import type { Room, Seat } from '../room';
import * as brain from './brain';

/**
 * Dev-only bots. They act through the same Room intents as humans and decide
 * from their own PlayerView (see brain.ts). Timing scales with phase length,
 * so they also work in fast headless simulations.
 */
export interface BotConfig {
  /** Swap color once exposure (distinct inspectors + chat mentions of my color) reaches this. */
  swapThreshold: number;
  /** Chance per payout of covering tracks (when somewhat exposed and flush). */
  coverChance: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = { swapThreshold: 4, coverChance: 0.15 };

export class BotDriver {
  private timers: NodeJS.Timeout[] = [];
  private minds = new Map<PlayerId, brain.Mind>();
  private readonly config: BotConfig;

  constructor(private readonly room: Room, private readonly rng: Rng, config: Partial<BotConfig> = {}) {
    this.config = { ...DEFAULT_BOT_CONFIG, ...config };
  }

  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private bots(): Seat[] {
    return [...this.room.seats.values()].filter((s) => s.isBot);
  }

  private mind(bot: Seat, poster: number): brain.Mind {
    let m = this.minds.get(bot.id);
    if (!m) this.minds.set(bot.id, (m = brain.newMind(this.rng)));
    if (m.poster !== poster) Object.assign(m, { poster, fakeColor: null, repliesThisPoster: 0 });
    return m;
  }

  private view(bot: Seat): PlayerView | null {
    const v = this.room.viewFor(bot);
    return v.game ? v : null;
  }

  private phaseMs(): number {
    return Math.max(0, (this.room.phaseEndsAt ?? Date.now()) - Date.now());
  }

  /** Say something unless it's word for word what this bot said last. */
  private say(bot: Seat, mind: brain.Mind, text: string | null) {
    if (!text || text === mind.lastLine) return;
    mind.lastLine = text;
    this.room.sendChat(bot.id, text);
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  onPhase(phase: Phase) {
    this.clear();
    if (phase === 'lobby') this.minds.clear();
    const game = this.room.game;
    if (!game || !this.room.phaseEndsAt) return;
    const dur = this.phaseMs();
    const at = (from: number, to: number, fn: () => void) => this.later(dur * (from + chance(this.rng) * (to - from)), fn);

    for (const bot of this.bots()) {
      const mind = this.mind(bot, game.posterIndex);
      if (phase === 'investigation') {
        // Spread inspects out so later ones can use earlier results.
        for (let k = 0; k < game.inspectLimit; k++) {
          const slot = 0.05 + (0.7 * k) / game.inspectLimit;
          at(slot, slot + 0.15, () => this.inspect(bot));
        }
        const talks = mind.persona === 'quiet' ? (chance(this.rng) < 0.35 ? 1 : 0) : 1 + (chance(this.rng) < 0.5 ? 1 : 0);
        for (let k = 0; k < talks; k++) at(0.35 + 0.3 * k, 0.6 + 0.3 * k, () => this.chat(bot));
        if (mind.persona !== 'quiet' || chance(this.rng) < 0.4) at(0.3, 0.7, () => this.buyInfo(bot));
        at(0.75, 0.85, () => this.maybeBuyExtraInspect(bot));
      } else if (phase === 'payout') {
        at(0.1, 0.6, () => this.maybeSwap(bot));
      } else if (phase === 'vote') {
        if (chance(this.rng) < 0.03) continue; // occasionally miss the vote, like people do
        at(0.1, 0.6, () => this.vote(bot));
      }
    }
  }

  /** Called by the Room for every chat line. Accused bots sometimes answer back. */
  onChat(msg: ChatMessage) {
    if (this.room.phase !== 'investigation' && this.room.phase !== 'vote') return;
    for (const bot of this.bots()) {
      const view = this.view(bot);
      if (!view || !brain.accusesMe(view, msg)) continue;
      const mind = this.mind(bot, view.game!.posterIndex);
      if (mind.repliesThisPoster >= 2 || chance(this.rng) < 0.25) continue;
      mind.repliesThisPoster += 1;
      const delay = Math.min(4000, 400 + this.phaseMs() * 0.06 * (0.5 + chance(this.rng)));
      this.later(delay, () => {
        const v = this.view(bot);
        if (v) this.say(bot, mind, brain.composeDenial(v, mind, this.rng));
      });
    }
  }

  /** Bots answer offers after a short think. */
  onOffer(offer: OfferView) {
    const seller = this.room.seats.get(offer.sellerId);
    if (!seller?.isBot) return;
    const delay = Math.min(7000, 300 + this.phaseMs() * 0.08 * (0.3 + chance(this.rng)));
    this.later(delay, () => {
      const view = this.view(seller);
      if (!view) return;
      const accept = chance(this.rng) < brain.sellChance(view, this.mind(seller, view.game!.posterIndex));
      this.room.respondOffer(seller.id, offer.id, accept);
    });
  }

  private inspect(bot: Seat) {
    const view = this.view(bot);
    const g = view?.game;
    if (!view || !g || g.inspectLimit + g.extraInspects - g.inspectsUsed <= 0) return;
    const target = brain.chooseInspect(view, brain.know(view), this.rng);
    if (target) this.room.inspect(bot.id, target);
  }

  private chat(bot: Seat) {
    const view = this.view(bot);
    if (!view) return;
    const mind = this.mind(bot, view.game!.posterIndex);
    this.say(bot, mind, brain.composeClaim(view, brain.know(view), mind, this.rng));
  }

  private buyInfo(bot: Seat) {
    const view = this.view(bot);
    const g = view?.game;
    if (!view || !g || g.youAreWanted) return;
    const { buyPrice } = view.settings.rules;
    if (g.myScore < buyPrice + 40) return; // keep a cushion
    const entryId = brain.chooseEntryToBuy(view, brain.know(view), this.rng);
    if (entryId) this.room.offer(bot.id, entryId);
  }

  /** Out of inspects with a suspect one look away from resolved: pay for one more. */
  private maybeBuyExtraInspect(bot: Seat) {
    const view = this.view(bot);
    const g = view?.game;
    if (!view || !g || g.youAreWanted) return;
    if (g.inspectLimit + g.extraInspects - g.inspectsUsed > 0) return;
    if (g.myScore < view.settings.rules.extraInspectPrice + 50 || chance(this.rng) < 0.5) return;
    const k = brain.know(view);
    const close = brain.suspects(k).some((p) => k.possible.get(p)?.length === 2);
    if (close && this.room.buyExtraInspect(bot.id).ok) this.inspect(bot);
  }

  private maybeSwap(bot: Seat) {
    const view = this.view(bot);
    if (!view) return;
    if (brain.shouldSwap(view, this.room.chat, this.config.swapThreshold)) this.room.swapColor(bot.id);
    else if (brain.shouldCover(view, this.room.chat, this.config.coverChance, chance(this.rng))) this.room.coverTracks(bot.id);
  }

  private vote(bot: Seat) {
    const view = this.view(bot);
    if (!view || view.game!.myVote) return;
    const target = brain.chooseVote(view, brain.know(view), this.room.chat, this.rng);
    if (target) this.room.vote(bot.id, target);
  }
}
