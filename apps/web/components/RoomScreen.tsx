'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { NAME_MAX, roomPresence, type Ack, type JoinResult } from '@wtc/shared';
import { call, getSocket } from '@/lib/socket';
import { session } from '@/lib/session';
import { useGame } from '@/lib/store';
import { useGameAudio } from '@/lib/audio/useGameAudio';
import { reportHowtoStatus } from '@/lib/howtoStatus';
import { trackVisit } from '@/lib/analytics';
import { useStreamerMode } from '@/lib/streamer';
import { homeHref, portal, usePortal } from '@/lib/portal';
import { adBreak, useAdBreak } from '@/lib/portal/ads';
import { useRememberedLook } from '@/lib/portal/look';
import { ClosingBanner } from './ClosingBanner';
import { useTutorialCompletion } from './game/Tutorial';
import { SceneCurtain } from './SceneCurtain';
import { ServerBanner } from './ServerBanner';
import { Lobby } from './lobby/Lobby';
import { GameHud } from './game/GameHud';
import { Toast } from './Toast';

const Scene = dynamic(() => import('./scene/Scene'), { ssr: false });

type Stage = 'connecting' | 'needName' | 'in';

export function RoomScreen({ code }: { code: string }) {
  const [stage, setStage] = useState<Stage>('connecting');
  const streamer = useStreamerMode();
  // Music, ambience and game sounds for whatever this player can see.
  useGameAudio();
  useTutorialCompletion();
  useEffect(() => trackVisit('room'), []);
  useRememberedLook();
  // Portals give the name (no name entry) and want a few events from the game.
  const ownMenus = usePortal().features.ownMenus;
  const adActive = useAdBreak();
  // Playtest stats: tell the room what this player did with How to Play, once seated.
  useEffect(() => {
    if (stage === 'in') reportHowtoStatus();
  }, [stage]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const view = useGame((s) => s.view);
  const connected = useGame((s) => s.connected);
  const resuming = useRef(false);

  /** Takes a seat (or, mid-game, a place watching). */
  const joinAs = useCallback(
    async (n: string): Promise<Ack<JoinResult>> => {
      const res = await call('room:join', { code, name: n });
      if (res.ok) session.setToken(code, res.token);
      return res;
    },
    [code],
  );

  const resume = useCallback(async () => {
    if (resuming.current) return;
    const token = session.getToken(code);
    if (!token) {
      if (portal().features.ownMenus) return setStage((s) => (s === 'in' ? s : 'needName'));
      // A portal: straight in with the portal's name (an invite, the join button, a link).
      resuming.current = true;
      const u = await portal().user();
      const res = await joinAs(u?.name || session.getName() || 'Greenhorn');
      resuming.current = false;
      if (res.ok) return setStage('in');
      setError(res.error);
      return setStage('needName');
    }
    resuming.current = true;
    const res = await call('room:resume', { code, token });
    resuming.current = false;
    if (res.ok) return setStage('in');
    session.setToken(code, null);
    useGame.getState().reset();
    setError(res.error === 'Session expired' ? 'Your seat went cold. Join again.' : res.error);
    setStage('needName');
  }, [code]);

  useEffect(() => {
    const socket = getSocket();
    const s = useGame.getState();
    s.reset();
    setName(session.getName());
    const onConnect = () => {
      useGame.getState().setConnected(true);
      resume();
    };
    const onDisconnect = () => useGame.getState().setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('view', s.setView);
    socket.on('chat', s.addChat);
    socket.on('chatHistory', s.setChat);
    // Removed by the host: forget this room's session and go back to the menu.
    const onKicked = () => {
      session.setToken(code, null);
      useGame.getState().reset();
      setError('The host removed you from this room.');
      setStage('needName');
    };
    socket.on('kicked', onKicked);
    // Closed by the admins: same as being removed, with their reason.
    const onClosed = ({ reason }: { reason: string }) => {
      session.setToken(code, null);
      useGame.getState().reset();
      setError(reason);
      setStage('needName');
    };
    socket.on('roomClosed', onClosed);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('view', s.setView);
      socket.off('chat', s.addChat);
      socket.off('chatHistory', s.setChat);
      socket.off('kicked', onKicked);
      socket.off('roomClosed', onClosed);
    };
  }, [resume, code]);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name');
    session.setName(trimmed);
    const res = await joinAs(trimmed);
    if (!res.ok) return setError(res.error);
    setError('');
    setStage('in');
  };

  // Portals: tell their friends features where we are (joinable only in the lobby, not full or
  // locked), and when we leave.
  const presence = stage === 'in' && view ? JSON.stringify(roomPresence(view)) : null;
  useEffect(() => {
    if (presence) portal().updateRoom(JSON.parse(presence));
  }, [presence]);
  useEffect(() => () => portal().updateRoom(null), []);

  // Portals: gameplay is on while seated or watching, except on the end screen and in ad breaks.
  const phase = view?.phase;
  useEffect(() => {
    if (stage === 'in' && phase && phase !== 'ended' && !adActive) portal().gameplayStart();
    else portal().gameplayStop();
  }, [stage, phase, adActive]);
  useEffect(() => () => portal().gameplayStop(), []);

  // Portals: an ad break may come on the end screen, a few seconds in (never during a round).
  useEffect(() => {
    if (phase !== 'ended') return;
    const t = setTimeout(() => void adBreak(), 4000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="room">
      <Scene />
      <SceneCurtain />
      {stage === 'in' && view ? (
        view.phase === 'lobby' ? <Lobby /> : <GameHud />
      ) : stage === 'needName' && !ownMenus ? (
        // A portal: no name entry. Say why we couldn't get in, and offer the way back.
        <div className="center-card">
          <div className="card stack">
            <h2>{error ? 'Couldn’t ride in' : 'Riding into town…'}</h2>
            {error && <p className="error">{error}</p>}
            <Link href={homeHref()} className="btn primary">
              Back to the menu
            </Link>
          </div>
        </div>
      ) : stage === 'needName' ? (
        <div className="center-card">
          <form className="card stack" onSubmit={join}>
            <h2>Join the posse{streamer ? '' : ` in room ${code}`}</h2>
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn primary">Join</button>
            {error && <p className="error">{error}</p>}
            <Link href="/" className="link-muted">
              Back to the menu
            </Link>
          </form>
        </div>
      ) : (
        <div className="center-card">
          <div className="card muted">Riding into town…</div>
        </div>
      )}
      {stage === 'in' && !connected && <div className="conn-banner">Lost the trail. Reconnecting…</div>}
      {stage === 'in' && <ClosingBanner />}
      {adActive && (
        <div className="ad-break" role="status" aria-live="polite">
          Short break…
        </div>
      )}
      <Toast />
      <ServerBanner />
    </div>
  );
}
