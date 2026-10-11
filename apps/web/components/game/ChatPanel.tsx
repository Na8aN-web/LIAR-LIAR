'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX, type ChatMessage } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

export function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const me = useGame((s) => s.view?.you.id);
  const toast = useGame((s) => s.showToast);
  const mute = useGame((s) => s.mute);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const res = await call('chat:send', { text: t });
    if (!res.ok) {
      toast(res.error);
      setText(t);
    }
  };

  // Mute hides someone's chat on this device only; the server just counts it.
  const muteSender = (m: ChatMessage) => {
    setMenu(null);
    mute(m.playerId);
    void call('chat:mute', { playerId: m.playerId });
    toast(`${m.name} muted. You won't see their messages.`);
  };
  // Report sends this message (and a few before it) to the admins. Nothing else in chat is kept.
  const report = async (m: ChatMessage) => {
    setMenu(null);
    const res = await call('chat:report', { messageId: m.id });
    if (res.ok) setReported((r) => [...r, m.id]);
    toast(res.ok ? 'Reported. The sheriff will take a look.' : res.error);
  };

  return (
    <div className="chat">
      <ul className="chat-list" ref={listRef}>
        {chat.length === 0 && <li className="muted">Quiet as a graveyard.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.playerId === me ? 'mine' : ''}>
            <b>{m.name}</b> {m.text}
            {m.playerId !== me && (
              <button className="chat-more" aria-label={`Mute or report ${m.name}`} aria-expanded={menu === m.id} onClick={() => setMenu(menu === m.id ? null : m.id)}>
                ⋯
              </button>
            )}
            {menu === m.id && (
              <span className="chat-actions">
                <button className="btn small" onClick={() => muteSender(m)}>
                  Mute {m.name}
                </button>
                <button className="btn small" disabled={reported.includes(m.id)} onClick={() => report(m)}>
                  {reported.includes(m.id) ? 'Reported' : 'Report message'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          maxLength={CHAT_MAX}
          placeholder="Speak up (or lie)…"
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
