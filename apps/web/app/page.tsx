'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAME_MAX, ROOM_CODE_LENGTH } from '@wtc/shared';
import { WantedPoster } from '@/components/WantedPoster';
import { HowToPlay } from '@/components/HowToPlay';
import { Modal } from '@/components/Modal';
import { call } from '@/lib/socket';
import { session } from '@/lib/session';

type Panel = 'play' | 'how' | 'settings' | 'profile' | 'credits' | null;

export default function MainMenu() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setName(session.getName()), []);

  const enter = async (mode: 'create' | 'join') => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name first');
    setBusy(true);
    setError('');
    session.setName(trimmed);
    const res =
      mode === 'create'
        ? await call('room:create', { name: trimmed })
        : await call('room:join', { code: code.trim(), name: trimmed });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    session.setToken(res.code, res.token);
    router.push(`/r/${res.code}`);
  };

  const items: { id: Exclude<Panel, null>; label: string }[] = [
    { id: 'play', label: 'Play' },
    { id: 'how', label: 'How to Play' },
    { id: 'settings', label: 'Settings' },
    { id: 'profile', label: 'Profile' },
    { id: 'credits', label: 'Credits' },
  ];

  return (
    <main className="menu">
      <div className="menu-fog" aria-hidden />
      <div className="menu-poster">
        <WantedPoster />
      </div>
      <nav className="menu-nav">
        <h1 className="game-title">
          Wanted:
          <span>True Colors</span>
        </h1>
        {items.map((it) => (
          <button key={it.id} className="menu-item" onClick={() => setPanel(it.id)}>
            {it.label}
          </button>
        ))}
      </nav>

      {panel === 'play' && (
        <Modal title="Play" onClose={() => setPanel(null)}>
          <form className="stack" onSubmit={(e) => (e.preventDefault(), enter('create'))}>
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                maxLength={NAME_MAX}
                autoComplete="nickname"
                placeholder="Dusty"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Create room
            </button>
          </form>
          <div className="divider">or join a friend</div>
          <form className="row" onSubmit={(e) => (e.preventDefault(), enter('join'))}>
            <input
              className="code-input"
              value={code}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="CODE"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn" disabled={busy || code.trim().length !== ROOM_CODE_LENGTH}>
              Join
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
      {panel === 'how' && (
        <Modal title="How to Play" onClose={() => setPanel(null)}>
          <HowToPlay />
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal title="Settings" onClose={() => setPanel(null)}>
          <p className="muted">Sound and graphics settings arrive with the polish pass.</p>
        </Modal>
      )}
      {panel === 'profile' && (
        <Modal title="Profile" onClose={() => setPanel(null)}>
          <label className="field">
            <span>Guest name</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                session.setName(e.target.value.trim());
              }}
            />
          </label>
          <p className="muted">Accounts and stats come later. For now you play as a guest.</p>
        </Modal>
      )}
      {panel === 'credits' && (
        <Modal title="Credits" onClose={() => setPanel(null)}>
          <p className="muted">Wanted: True Colors. A work in progress.</p>
        </Modal>
      )}
    </main>
  );
}
