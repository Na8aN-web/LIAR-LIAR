'use client';

import type { BillboardSlot, ClientStep, VisitPage } from '@wtc/shared';
import { call } from './socket';

// Anonymous analytics (see /privacy): which page was opened and from which link (?src=),
// How to Play steps, and which billboards were on screen. No names; the server turns this
// browser's random id into an anonymous one before storing anything.

const SRC_KEY = 'wtc:src';

/**
 * The link's ?src= (youtube, tiktok, discord, x, instagram), remembered for this visit so a
 * room link opened later in the same visit still counts for the same source. Removed from the
 * address bar so it doesn't get copied along when someone shares the page.
 */
function source(): string | undefined {
  try {
    const url = new URL(location.href);
    const src = url.searchParams.get('src');
    if (src) {
      sessionStorage.setItem(SRC_KEY, src.slice(0, 32));
      url.searchParams.delete('src');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    return sessionStorage.getItem(SRC_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function trackVisit(page: VisitPage) {
  void call('analytics:visit', { page, src: source() });
}

export function trackStep(step: ClientStep) {
  void call('analytics:step', { step });
}

const seenSlots = new Set<string>();
export function trackBillboard(slot: BillboardSlot) {
  if (seenSlots.has(slot)) return;
  seenSlots.add(slot);
  void call('analytics:billboard', { slot });
}
