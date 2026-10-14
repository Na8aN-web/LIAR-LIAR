'use client';

import { kv } from '@/lib/portal/storage';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAME_MAX, ROOM_CODE_LENGTH, ROOM_NAME_MAX, defaultRoomName, type Ack, type JoinResult, type LobbyListUpdate, type Visibility } from '@wtc/shared';
import { getSocket, call } from '@/lib/socket';
import { session } from '@/lib/session';
import { roomHref } from '@/lib/portal';
import { Rope } from '../ui/western';

type View = 'menu' | 'create' | 'code' | 'find';

const TITLES: Record<View, string> = { menu: 'Play', create: 'Create a Room', code: 'Enter a Code', find: 'Find a Lobby' };

/**
 * Everything about getting into a game: your name, then Create a Room, Enter a Code, or Find a
 * Lobby (Quick Play and the live list of public rooms). Invite links (/r/CODE) skip this.
 */
export function PlayPanel({ start = 'menu', onTitle }: { start?: View; onTitle?: (t: string) => void }) {
  const router = useRouter();
  const [view, setView] = useState<View>(start);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(session.getName()), []);
  useEffect(() => onTitle?.(TITLES[view]), [view, onTitle]);

  const go = (v: View) => {
    setError('');
    setView(v);
  };
  /** Every way in needs a name; remembered on this device. */
  const named = () => {
    const n = name.trim();
    if (!n) {
      setError('Enter your name first');
      document.getElementById('play-name')?.focus();
      return null;
    }
    session.setName(n);
    return n;
  };
  const enter = async (res: Promise<Ack<JoinResult>>) => {
    setBusy(true);
    setError('');
    const r = await res;
    setBusy(false);
    if (!r.ok) return setError(r.error);
    session.setToken(r.code, r.token);
    router.push(roomHref(r.code));
  };

  return (
    <div className="play">
      {view !== 'menu' && (
        <button className="link-btn play-back" onClick={() => go('menu')}>
          ‹ Back to Play
        </button>
      )}
      <label className="field play-name">
        <span>Your name</span>
        <input
          id="play-name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          placeholder="Dusty"
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
        />
      </label>

      {view === 'menu' && (
        <div className="play-options">
          <button className="play-option" onClick={() => go('create')}>
            <b>Create a Room</b>
            <span>Your own campfire: invite friends, or open it to strangers.</span>
          </button>
          <button className="play-option" onClick={() => go('code')}>
            <b>Enter a Code</b>
            <span>Got a room code from a friend? Ride in.</span>
          </button>
          <button className="play-option" onClick={() => go('find')}>
            <b>Find a Lobby</b>
            <span>Join strangers at a public campfire, or Quick Play.</span>
          </button>
        </div>
      )}
      {view === 'create' && <CreateRoom busy={busy} hostName={name} create={(v, roomName) => { const n = named(); if (n) void enter(call('room:create', { name: n, visibility: v, roomName })); }} />}
      {view === 'code' && <EnterCode busy={busy} join={(code) => { const n = named(); if (n) void enter(call('room:join', { code, name: n })); }} />}
      {view === 'find' && (
        <FindLobby
          busy={busy}
          quickPlay={() => { const n = named(); if (n) void enter(call('room:quickPlay', { name: n })); }}
          join={(id) => { const n = named(); if (n) void enter(call('room:joinListed', { id, name: n })); }}
          startOne={() => { const n = named(); if (n) void enter(call('room:create', { name: n, visibility: 'public' })); }}
        />
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Create a Room

const VIS_KEY = 'wtc:room-visibility';
const lastVisibility = (): Visibility => {
  try {
    return kv.get(VIS_KEY) === 'public' ? 'public' : 'private';
  } catch {
    return 'private';
  }
};

function CreateRoom({ busy, hostName, create }: { busy: boolean; hostName: string; create: (v: Visibility, roomName: string) => void }) {
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [roomName, setRoomName] = useState('');
  useEffect(() => setVisibility(lastVisibility()), []);
  const pick = (v: Visibility) => {
    setVisibility(v);
    try {
      kv.set(VIS_KEY, v);
    } catch {}
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        create(visibility, roomName.trim());
      }}
    >
      <div className="vis-choice" role="radiogroup" aria-label="Who can join">
        <button type="button" role="radio" aria-checked={visibility === 'private'} className={visibility === 'private' ? 'on' : ''} onClick={() => pick('private')}>
          <b>Private</b>
          <span>Friends join with the code or invite link.</span>
        </button>
        <button type="button" role="radio" aria-checked={visibility === 'public'} className={visibility === 'public' ? 'on' : ''} onClick={() => pick('public')}>
          <b>Public</b>
          <span>Listed in Find a Lobby for anyone to join.</span>
        </button>
      </div>
      <label className="field">
        <span>Room name (optional)</span>
        <input value={roomName} maxLength={ROOM_NAME_MAX} placeholder={defaultRoomName(hostName.trim() || 'Your')} onChange={(e) => setRoomName(e.target.value)} />
      </label>
      <button className="btn primary" disabled={busy}>
        {busy ? 'Building the fire…' : `Open a ${visibility} room`}
      </button>
      <p className="hint">You can switch between public and private in the lobby, until the game starts.</p>
    </form>
  );
}

// ---------------------------------------------------------------- Enter a Code

function EnterCode({ busy, join }: { busy: boolean; join: (code: string) => void }) {
  const [code, setCode] = useState('');
  const ready = code.length === ROOM_CODE_LENGTH;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) join(code);
      }}
    >
      <label className="field">
        <span>Room code</span>
        <input
          className="code-input big"
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="ABCDE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
      </label>
      <button className="btn primary" disabled={busy || !ready}>
        {busy ? 'Riding in…' : 'Join'}
      </button>
      <p className="hint">Got an invite link instead? Just open it.</p>
    </form>
  );
}

// ---------------------------------------------------------------- Find a Lobby

function FindLobby({ busy, quickPlay, join, startOne }: { busy: boolean; quickPlay: () => void; join: (id: string) => void; startOne: () => void }) {
  const [list, setList] = useState<LobbyListUpdate | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const socket = getSocket();
    const onList = (u: LobbyListUpdate) => setList(u);
    socket.on('lobby:list', onList);
    // (Re)subscribe on every connection: a reconnect starts a fresh socket on the server.
    const watch = async () => {
      const res = await call('lobby:watch');
      if (res.ok) setList({ rooms: res.rooms, online: res.online });
      else setError(res.error);
    };
    socket.on('connect', watch);
    if (socket.connected) void watch();
    return () => {
      socket.off('lobby:list', onList);
      socket.off('connect', watch);
      socket.emit('lobby:unwatch');
    };
  }, []);

  return (
    <div className="find">
      <button className="btn primary quick-play" disabled={busy} onClick={quickPlay}>
        {busy ? 'Saddling up…' : 'Quick Play'}
        <small>The fullest open campfire, or a new one</small>
      </button>
      <Rope />
      <div className="find-head">
        <b>Open campfires</b>
        {list && (
          <span className="online">
            {list.online} {list.online === 1 ? 'outlaw' : 'outlaws'} in town
          </span>
        )}
      </div>
      {!list ? (
        <p className="muted">{error || 'Scouting the town…'}</p>
      ) : list.rooms.length === 0 ? (
        <div className="find-empty">
          <p>No open campfires right now. Start one!</p>
          <button className="btn" disabled={busy} onClick={startOne}>
            Start a public room
          </button>
        </div>
      ) : (
        <ul className="lobby-list" aria-live="polite">
          {list.rooms.map((r) => (
            <li key={r.id}>
              <div className="lobby-row-main">
                <b className="lobby-row-name">{r.name}</b>
                <span className="lobby-row-host">host {r.host}</span>
                <span className="lobby-row-meta">
                  {r.posters} posters · {r.searches} searches a round
                </span>
              </div>
              <div className="lobby-row-count">
                <b>
                  {r.players}/{r.maxPlayers}
                </b>
                <span>{r.bots ? `${r.bots} ${r.bots === 1 ? 'bot' : 'bots'}` : 'no bots'}</span>
              </div>
              <button className="btn small" disabled={busy} onClick={() => join(r.id)} aria-label={`Join ${r.name}`}>
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
