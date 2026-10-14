'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { NAME_MAX } from '@wtc/shared';
import { WantedPoster } from '@/components/WantedPoster';
import { Walkthrough } from '@/components/howto/Walkthrough';
import { Credits } from '@/components/credits/Credits';
import { PlayPanel } from '@/components/play/PlayPanel';
import { SocialIcon } from '@/components/credits/SocialIcon';
import { YOUTUBE_URL } from '@/config/brand';
import { Modal } from '@/components/Modal';
import { Rope } from '@/components/ui/western';
import { AudioSettings } from '@/components/ui/AudioSettings';
import { SceneCurtain } from '@/components/SceneCurtain';
import { BrightnessSlider } from '@/components/ui/BrightnessSlider';
import { GraphicsSetting } from '@/components/ui/GraphicsSetting';
import { ShowEverythingToggle } from '@/components/ui/ShowEverythingToggle';
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
  const [error, setError] = useState('');
  const [playTitle, setPlayTitle] = useState('Play');
  // /?play=find (or create, code) opens the Play panel there: handy for links ("come find a game").
  const [playStart, setPlayStart] = useState<'menu' | 'create' | 'code' | 'find'>('menu');
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('play');
    if (p === 'find' || p === 'create' || p === 'code' || p === 'menu') {
      setPlayStart(p);
      setPanel('play');
    }
  }, []);

  useEffect(() => setName(session.getName()), []);
  // Menu music and the campfire, from the first tap.
  useMood('menu');
  useEffect(() => trackVisit('home'), []);

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
      <SceneCurtain />
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
        {error && <p className="error menu-error">{error}</p>}
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
        <Modal title={playTitle} onClose={() => setPanel(null)}>
          <PlayPanel start={playStart} onTitle={setPlayTitle} />
        </Modal>
      )}
      {panel === 'how' && <Walkthrough onClose={() => setPanel(null)} onPractice={practice} />}
      {panel === 'settings' && (
        <Modal title="Settings" onClose={() => setPanel(null)}>
          <AudioSettings />
          <BrightnessSlider />
          <GraphicsSetting />
          <ShowEverythingToggle />
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
