'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { NAME_MAX, ROOM_CODE_LENGTH } from '@wtc/shared';
import { WantedPoster } from '@/components/WantedPoster';
import { Walkthrough } from '@/components/howto/Walkthrough';
import { Credits } from '@/components/credits/Credits';
import { SocialIcon } from '@/components/credits/SocialIcon';
import { YOUTUBE_URL } from '@/config/brand';
import { Modal } from '@/components/Modal';
import { Rope } from '@/components/ui/western';
import { AudioSettings } from '@/components/ui/AudioSettings';
import { BrightnessSlider } from '@/components/ui/BrightnessSlider';
import { StreamerToggle } from '@/components/ui/StreamerToggle';
import { call } from '@/lib/socket';
import { session } from '@/lib/session';
import { useMood } from '@/lib/audio/soundscape';
import { trackVisit } from '@/lib/analytics';
import { ServerBanner } from '@/components/ServerBanner';
import Link from 'next/link';

// The live campfire behind the menu (client-only WebGL).
const HomeScene = dynamic(() => import('@/components/home/HomeScene'), { ssr: false });

type Panel = 'play' | 'how' | 'settings' | 'profile' | 'credits' | null;

export default function MainMenu() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setName(session.getName()), []);
  // Menu music and the campfire, from the first tap.
  useMood('menu');
  useEffect(() => trackVisit('home'), []);

  // Join straight from the homepage: the room asks for a name if this device has none.
  const [quickCode, setQuickCode] = useState('');
  const quickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const c = quickCode.trim().toUpperCase();
    if (c.length === ROOM_CODE_LENGTH) router.push(`/r/${c}`);
  };

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

  // Practice with bots (end of How to Play): straight into a short game against bots.
  const practice = async () => {
    const trimmed = name.trim() || session.getName() || 'Greenhorn';
    session.setName(trimmed);
    const res = await call('room:practice', { name: trimmed });
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
      <ServerBanner />
      <div className="menu-scene" aria-hidden>
        <HomeScene />
      </div>
      <div className="menu-shade" aria-hidden />
      {/* Desktop: the poster nailed to a post on the right. */}
      <div className="menu-poster" aria-hidden>
        <div className="post" />
        <WantedPoster />
      </div>
      <nav className="menu-nav">
        <h1 className="game-title">
          Wanted:
          <span>True Colors</span>
        </h1>
        <p className="tagline">Everyone lies. Find the outlaw.</p>
        <form className="quick-join" onSubmit={quickJoin} aria-label="Join a room">
          <input
            className="code-input"
            value={quickCode}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ROOM CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuickCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button className="btn primary" disabled={quickCode.length !== ROOM_CODE_LENGTH}>
            Join
          </button>
        </form>
        {items.map((it, i) => (
          <div key={it.id}>
            {i > 0 && <Rope />}
            <button className="menu-item" onClick={() => setPanel(it.id)}>
              {it.label}
            </button>
          </div>
        ))}
        <a className="menu-social" href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer">
          <SocialIcon id="youtube" />
          Watch 3042Official on YouTube
        </a>
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
              Open a room
            </button>
          </form>
          <Rope />
          <div className="divider">or ride with a friend</div>
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
      {panel === 'how' && <Walkthrough onClose={() => setPanel(null)} onPractice={practice} />}
      {panel === 'settings' && (
        <Modal title="Settings" onClose={() => setPanel(null)}>
          <AudioSettings />
          <BrightnessSlider />
          <StreamerToggle />
          <p className="hint settings-privacy">
            <Link href="/privacy">Privacy: what we collect and why</Link>
          </p>
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
          <p className="muted">Accounts and records come later. For now you ride as a guest.</p>
        </Modal>
      )}
      {panel === 'credits' && (
        <Modal title="Credits" wide onClose={() => setPanel(null)}>
          <Credits />
        </Modal>
      )}
    </main>
  );
}
