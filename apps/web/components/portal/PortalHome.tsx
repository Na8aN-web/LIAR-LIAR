'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { Ack, JoinResult } from '@wtc/shared';
import { Credits } from '@/components/credits/Credits';
import { SocialIcon } from '@/components/credits/SocialIcon';
import { Walkthrough } from '@/components/howto/Walkthrough';
import { Modal } from '@/components/Modal';
import { SceneCurtain } from '@/components/SceneCurtain';
import { ServerBanner } from '@/components/ServerBanner';
import { AudioSettings } from '@/components/ui/AudioSettings';
import { BrightnessSlider } from '@/components/ui/BrightnessSlider';
import { GraphicsSetting } from '@/components/ui/GraphicsSetting';
import { ShowEverythingToggle } from '@/components/ui/ShowEverythingToggle';
import { StreamerToggle } from '@/components/ui/StreamerToggle';
import { Rope } from '@/components/ui/western';
import { SOCIALS } from '@/config/brand';
import { useMood } from '@/lib/audio/soundscape';
import { trackVisit } from '@/lib/analytics';
import { portal, roomHref } from '@/lib/portal';
import { session } from '@/lib/session';
import { call } from '@/lib/socket';
import { PrivacyNotice } from './PrivacyNotice';

const HomeScene = dynamic(() => import('@/components/home/HomeScene'), { ssr: false });

type Panel = 'how' | 'settings' | 'credits' | null;

/**
 * A portal's front page (e.g. /play/crazygames). The portal knows who you are, so there's no
 * name entry: one tap on Play puts you in a quick-start lobby (bots fill the empty seats and the
 * game starts by itself). Arriving from a friend's invite or the portal's multiplayer button
 * skips this page altogether.
 */
export function PortalHome() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef(false);
  useMood('menu');
  useEffect(() => trackVisit('home'), []);
  useEffect(() => portal().gameplayStop(), []);

  /** The player's name: the portal's username, or a guest name kept on this device. */
  const who = useCallback(async () => {
    const u = await portal().user();
    const n = u?.name || session.getName() || 'Greenhorn';
    session.setName(n);
    setName(n);
    return n;
  }, []);

  const enter = useCallback(
    async (what: string, request: (name: string) => Promise<Ack<JoinResult>>) => {
      setBusy(what);
      setError('');
      const res = await request(await who());
      if (!res.ok) {
        setBusy(null);
        return setError(res.error);
      }
      session.setToken(res.code, res.token);
      router.replace(roomHref(res.code));
    },
    [router, who],
  );

  const play = () => enter('play', (n) => call('room:quickPlay', { name: n, autoStart: true }));
  const friends = () => enter('friends', (n) => call('room:create', { name: n, visibility: 'private' }));
  const practice = () => enter('practice', (n) => call('room:practice', { name: n }));

  // Straight past this page: a friend's invite, or the portal's instant multiplayer.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const invited = portal().inviteRoom();
    if (invited) {
      router.replace(roomHref(invited));
      return;
    }
    if (portal().instantMultiplayer()) {
      void friends();
      return;
    }
    void who();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const discord = SOCIALS.find((s) => s.id === 'discord' && s.url);

  return (
    <main className="menu portal-menu">
      <ServerBanner />
      <SceneCurtain />
      <div className="menu-scene" aria-hidden>
        <HomeScene />
      </div>
      <div className="menu-shade" aria-hidden />
      <nav className="menu-nav">
        <h1 className="game-title">
          Wanted:
          <span>True Colors</span>
        </h1>
        <p className="tagline">Everyone lies. Find the outlaw.</p>
        {name && <p className="portal-name">Riding as {name}</p>}
        {error && <p className="error menu-error">{error}</p>}
        <button className="btn primary portal-play" disabled={!!busy} onClick={() => void play()}>
          {busy === 'play' ? 'Saddling up…' : 'Play'}
        </button>
        <Rope />
        <button className="menu-item" disabled={!!busy} onClick={() => void friends()}>
          {busy === 'friends' ? 'Building the fire…' : 'Play with friends'}
        </button>
        <Rope />
        <button className="menu-item" onClick={() => setPanel('how')}>
          How to Play
        </button>
        <Rope />
        <button className="menu-item" onClick={() => setPanel('settings')}>
          Settings
        </button>
        <Rope />
        <button className="menu-item" onClick={() => setPanel('credits')}>
          Credits
        </button>
        {/* The one outgoing link portals allow on the menu: the community. */}
        {discord && (
          <a className="menu-social" href={discord.url} target="_blank" rel="noopener noreferrer">
            <SocialIcon id="discord" />
            Join the Discord
          </a>
        )}
      </nav>
      <PrivacyNotice />

      {panel === 'how' && <Walkthrough onClose={() => setPanel(null)} onPractice={() => void practice()} />}
      {panel === 'settings' && (
        <Modal title="Settings" onClose={() => setPanel(null)}>
          <AudioSettings />
          <BrightnessSlider />
          <GraphicsSetting />
          <ShowEverythingToggle />
          <StreamerToggle />
          <p className="hint settings-privacy">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy: what we collect and why
            </a>
          </p>
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
