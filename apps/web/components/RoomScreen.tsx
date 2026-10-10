'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { NAME_MAX } from '@wtc/shared';
import { call, getSocket } from '@/lib/socket';
import { session } from '@/lib/session';
import { useGame } from '@/lib/store';
import { Lobby } from './lobby/Lobby';
import { GameHud } from './game/GameHud';
import { Toast } from './Toast';

const Scene = dynamic(() => import('./scene/Scene'), { ssr: false });

type Stage = 'connecting' | 'needName' | 'in';

export function RoomScreen({ code }: { code: string }) {
  const [stage, setStage] = useState<Stage>('connecting');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const view = useGame((s) => s.view);
  const connected = useGame((s) => s.connected);
  const resuming = useRef(false);

  const resume = useCallback(async () => {
    if (resuming.current) return;
    const token = session.getToken(code);
    if (!token) return setStage((s) => (s === 'in' ? s : 'needName'));
    resuming.current = true;
    const res = await call('room:resume', { code, token });
    resuming.current = false;
    if (res.ok) return setStage('in');
    session.setToken(code, null);
    useGame.getState().reset();
    setError(res.error === 'Session expired' ? 'Your seat expired. Join again.' : res.error);
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
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('view', s.setView);
      socket.off('chat', s.addChat);
      socket.off('chatHistory', s.setChat);
    };
  }, [resume]);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name');
    session.setName(trimmed);
    const res = await call('room:join', { code, name: trimmed });
    if (!res.ok) return setError(res.error);
    session.setToken(code, res.token);
    setError('');
    setStage('in');
  };

  return (
    <div className="room">
      <Scene />
      {stage === 'in' && view ? (
        view.phase === 'lobby' ? <Lobby /> : <GameHud />
      ) : stage === 'needName' ? (
        <div className="center-card">
          <form className="card stack" onSubmit={join}>
            <h2>Join room {code}</h2>
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn primary">Join</button>
            {error && <p className="error">{error}</p>}
            <Link href="/" className="link-muted">
              Back to menu
            </Link>
          </form>
        </div>
      ) : (
        <div className="center-card">
          <div className="card muted">Riding into town…</div>
        </div>
      )}
      {stage === 'in' && !connected && <div className="conn-banner">Reconnecting…</div>}
      <Toast />
    </div>
  );
}
