'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX } from '@wtc/shared';
import { call } from '@/lib/socket';
import { useGame } from '@/lib/store';

export function ChatPanel() {
  const chat = useGame((s) => s.chat);
  const me = useGame((s) => s.view?.you.id);
  const toast = useGame((s) => s.showToast);
  const [text, setText] = useState('');
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

  return (
    <div className="chat">
      <ul className="chat-list" ref={listRef}>
        {chat.length === 0 && <li className="muted">Quiet as a graveyard.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.playerId === me ? 'mine' : ''}>
            <b>{m.name}</b> {m.text}
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
