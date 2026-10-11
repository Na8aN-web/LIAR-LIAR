'use client';

import { useButtonClicks } from '@/lib/audio/useGameAudio';

/** App-wide audio wiring: the soft knock on every button press. */
export function ClientAudio() {
  useButtonClicks();
  return null;
}
