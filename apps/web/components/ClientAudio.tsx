'use client';

import { useEffect } from 'react';
import { useButtonClicks } from '@/lib/audio/useGameAudio';
import { applyQualityClass } from '@/lib/quality';

/** App-wide wiring: the soft knock on every button press, and the graphics-quality page class. */
export function ClientAudio() {
  useButtonClicks();
  useEffect(applyQualityClass, []);
  return null;
}
