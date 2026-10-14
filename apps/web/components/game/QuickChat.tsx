'use client';

import { useState } from 'react';
import { COLOR_IDS, QUICK_PHRASES, colorInfo, type ColorId, type QuickChat as Phrase, type QuickPhrase } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

/**
 * Quick chat: tap a phrase, then a player and/or a color ("It's [player]!", "[player] is
 * [color]"). The server writes the message from the choice, so nothing typed is ever sent.
 * Built for phones, and all that's left when a portal turns typed chat off. Lies welcome.
 */
export function QuickChat({ onSent }: { onSent?: () => void }) {
  const view = useGame((s) => s.view)!;
  const toast = useGame((s) => s.showToast);
  const [phrase, setPhrase] = useState<QuickPhrase | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (q: Phrase) => {
    setBusy(true);
    const res = await call('chat:quick', q);
    setBusy(false);
    if (!res.ok) return toast(res.error);
    setPhrase(null);
    setPlayer(null);
    onSent?.();
  };

  const pickPhrase = (p: QuickPhrase) => {
    if (p.needs.player === 'no' && !p.needs.color) return void send({ kind: p.kind });
    setPhrase(p);
    setPlayer(null);
  };
  const pickPlayer = (id: string) => {
    if (!phrase) return;
    if (phrase.needs.color) return setPlayer(id);
    void send({ kind: phrase.kind, player: id });
  };
  const pickColor = (color: ColorId) => phrase && player && void send({ kind: phrase.kind, player, color });

  // "[player] is [color]" can be about yourself ("I'm Red"); the others are about someone else.
  const players = view.players.filter((p) => phrase?.kind === 'claimColor' || p.id !== view.you.id);

  if (!phrase) {
    return (
      <div className="quick-chat" role="group" aria-label="Quick chat">
        {QUICK_PHRASES.map((p) => (
          <button key={p.kind} className="btn small quick-phrase" disabled={busy} onClick={() => pickPhrase(p)}>
            {p.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="quick-chat picking" role="group" aria-label={`Quick chat: ${phrase.label}`}>
      <div className="quick-head">
        <button className="link-btn" onClick={() => (player ? setPlayer(null) : setPhrase(null))}>
          ‹ Back
        </button>
        <b>{phrase.label}</b>
      </div>
      {!player ? (
        <div className="quick-options">
          {phrase.needs.player === 'optional' && (
            <button className="btn small" disabled={busy} onClick={() => void send({ kind: phrase.kind })}>
              Just say it
            </button>
          )}
          {players.map((p) => (
            <button key={p.id} className="btn small" disabled={busy} onClick={() => pickPlayer(p.id)}>
              {p.id === view.you.id ? 'Me' : p.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="quick-options colors">
          {COLOR_IDS.map((c) => (
            <button key={c} className="btn small quick-color" disabled={busy} onClick={() => pickColor(c)} aria-label={colorInfo(c).name}>
              <i style={{ background: colorInfo(c).hex }} />
              {colorInfo(c).name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
