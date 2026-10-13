'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  COLOR_IDS,
  DEFAULT_SETTINGS,
  ITEM_TYPES,
  colorInfo,
  randomCosmetics,
  type ColorId,
  type Cosmetics,
  type InspectLogEntry,
  type ItemType,
  type Phase,
  type PlayerView,
  type Reaction,
} from '@wtc/shared';
import { playSfx } from '@/lib/audio/sfx';
import { useGame } from '@/lib/store';
import { ringRadius } from '../scene/town/Town';
import type { SceneTrailer } from '../scene/Scene';
import { TrailerRig, type RigApi } from './TrailerRig';
import { loadPaths, pathLength, presetPaths, savePaths, type CamKey, type CamPath, type V3 } from './paths';

// Trailer mode (dev builds only, /dev/trailer): the real scene, driven by a made-up local game
// that you direct: who's Wanted, who's caught, reactions, posters, telegrams, color changes.
// Nothing talks to the game server. See TRAILER.md.

const Scene = dynamic(() => import('../scene/Scene'), { ssr: false });

interface CastMember {
  id: string;
  name: string;
  color: ColorId;
  item: ItemType;
  cosmetics: Cosmetics;
}

const NAMES = ['Dusty', 'Hattie', 'Clem', 'Rio', 'June', 'Silas', 'Mags', 'Tex', 'Pearl', 'Boone', 'Etta', 'Wyatt'];
const START_COLORS: ColorId[] = ['red', 'blue', 'yellow', 'green', 'pink', 'orange', 'teal', 'maroon', 'lime', 'tan', 'cyan', 'brown'].filter((c) =>
  (COLOR_IDS as string[]).includes(c),
) as ColorId[];

/** Seeded so the cast looks the same every time you open the page. */
function makeCast(n: number): CastMember[] {
  let s = 3042;
  const int = (k: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % k;
  };
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i % NAMES.length],
    color: START_COLORS[i % START_COLORS.length] ?? COLOR_IDS[i],
    item: ITEM_TYPES[i % ITEM_TYPES.length],
    cosmetics: randomCosmetics(int),
  }));
}

type Aspect = 'full' | '16:9' | '9:16';
const ASPECT_RATIO: Record<Exclude<Aspect, 'full'>, number> = { '16:9': 16 / 9, '9:16': 9 / 16 };

interface Telegram {
  id: number;
  tag: string;
  title: string;
  body: string;
}

const TELEGRAM_PRESETS: Omit<Telegram, 'id'>[] = [
  { tag: 'POSTER', title: 'New poster 1 of 9. Bounty $100.', body: '2 players changed colors.' },
  { tag: 'WATCHED', title: 'Hattie searched you.', body: '' },
  { tag: 'OFFER', title: 'Clem offers $20 for your findings.', body: 'Your search of Rio on poster 3.' },
  { tag: 'DEAL', title: 'June sold you their findings on Dusty (poster 2):', body: 'Red · Teal · Lime · Pink' },
  { tag: 'COLOR', title: 'You’re now wearing Teal.', body: '' },
];

export function Trailer() {
  const [count, setCount] = useState(9);
  const [cast, setCast] = useState<CastMember[]>(() => makeCast(9));
  const [youId, setYouId] = useState('p0');
  const [phase, setPhase] = useState<Phase>('lobby');
  const [posterIndex, setPosterIndex] = useState(-1);
  const [wantedId, setWantedId] = useState('p3');
  const [pot, setPot] = useState(100);
  const [reactions, setReactions] = useState<{ key: string; byPlayer: Record<string, Reaction> } | null>(null);
  const [log, setLog] = useState<InspectLogEntry[]>([]);
  const [telegram, setTelegram] = useState<Telegram | null>(null);
  const [draft, setDraft] = useState<Omit<Telegram, 'id'>>(TELEGRAM_PRESETS[2]);
  const [labels, setLabels] = useState(false);
  const [glowId, setGlowId] = useState<string | null>(null);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [ui, setUi] = useState(true);
  const [searcher, setSearcher] = useState('p1');
  const [target, setTarget] = useState('p4');
  const [focusId, setFocusId] = useState('p3');
  const [paths, setPaths] = useState<CamPath[]>([]);
  const [recording, setRecording] = useState<CamKey[]>([]);
  const [keyDur, setKeyDur] = useState(3);
  const [playingName, setPlayingName] = useState<string | null>(null);
  const [seats, setSeats] = useState<Map<string, { position: V3; head: V3 }>>(new Map());
  const rig = useRef<RigApi | null>(null);
  const reactionN = useRef(0);

  useEffect(() => setPaths(loadPaths()), []);
  // For scripted captures and debugging from the console (dev page only): window.__wtcTrailer.pose().
  useEffect(() => {
    (window as unknown as { __wtcTrailer?: () => RigApi | null }).__wtcTrailer = () => rig.current;
  }, []);
  useEffect(() => {
    setCast(makeCast(count));
    setPhase('lobby');
    setPosterIndex(-1);
    setReactions(null);
    setLog([]);
  }, [count]);

  const radius = Math.max(3.2, cast.length * 0.42);
  const ringR = ringRadius(radius);
  const nameOf = (id: string) => cast.find((c) => c.id === id)?.name ?? '?';
  const colorOf = (id: string) => cast.find((c) => c.id === id)?.color ?? 'red';

  // The made-up game, as the scene expects to receive it from a server.
  useEffect(() => {
    const you = cast.find((c) => c.id === youId) ?? cast[0];
    const started = posterIndex >= 0;
    const view = {
      code: 'TRAIL',
      serverNow: Date.now(),
      devMode: true,
      minPlayers: 6,
      maxPlayers: 15,
      you: { id: you.id, name: you.name, color: you.color, item: you.item, isHost: true },
      players: cast.map((c, i) => ({ id: c.id, name: c.name, item: c.item, cosmetics: c.cosmetics, seat: i, isHost: i === 0, isBot: false, connected: true, away: false })),
      settings: DEFAULT_SETTINGS,
      phase,
      phaseEndsAt: null,
      game: started
        ? {
            posterIndex,
            posterCount: cast.length,
            posterColor: colorOf(wantedId),
            pot,
            youAreWanted: false,
            inspectLimit: 3,
            extraInspects: 0,
            inspectsUsed: 0,
            purchasesUsed: 0,
            log,
            myResults: {},
            boughtEntryIds: [],
            offersOut: [],
            offersIn: [],
            colorChanges: [],
            swapLimit: 0,
            swapsUsed: 0,
            swappedThisPayout: false,
            myColorHistory: [],
            myVote: null,
            votesCast: 0,
            scores: {},
            scoreDeltas: {},
            myScore: 100,
            myCorrectVotes: 0,
            myHeldEscapeBonus: 0,
            myRounds: [],
            reactions,
          }
        : null,
      replay: null,
      practice: false,
      locked: false,
      room: { name: 'Trailer', visibility: 'private', autoFill: { enabled: false, afterSec: 120 }, fillOfferAt: null, closing: null },
    } as PlayerView;
    useGame.getState().setView(view);
  }, [cast, youId, phase, posterIndex, wantedId, pot, reactions, log]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => useGame.getState().reset(), []);

  // ---------------------------------------------------------------- events
  const newPoster = () => {
    setPosterIndex((i) => i + 1);
    setPot(100 + Math.floor(Math.random() * 3) * 25);
    setPhase('investigation');
    setReactions(null);
    playSfx('poster');
  };
  const react = (byPlayer: Record<string, Reaction>) => {
    setPhase('payout');
    setReactions({ key: `trailer-${++reactionN.current}`, byPlayer });
  };
  const despair = (): Reaction => (Math.random() < 0.5 ? 'despair-1' : 'despair-2');
  const caught = () => {
    react(Object.fromEntries(cast.map((c) => [c.id, c.id === wantedId ? despair() : 'victory'])));
    playSfx('victory');
  };
  const escaped = () => {
    react(Object.fromEntries(cast.map((c) => [c.id, c.id === wantedId ? 'victory' : despair()])));
    playSfx('despair');
  };
  const one = (id: string, r: Reaction) => {
    react({ [id]: r });
    playSfx(r === 'victory' ? 'victory' : 'despair');
  };
  const search = () => {
    if (searcher === target) return;
    if (posterIndex < 0) newPoster();
    setLog((l) => [...l, { id: `s${Date.now()}`, poster: Math.max(0, posterIndex), inspectorId: searcher, targetId: target, at: Date.now() }]);
    playSfx('crow');
  };
  const changeColor = (id: string, to?: ColorId) => {
    const taken = new Set(cast.map((c) => c.color));
    const next = to ?? COLOR_IDS.filter((c) => !taken.has(c))[Math.floor(Math.random() * (COLOR_IDS.length - taken.size))];
    if (!next) return;
    setCast((all) => all.map((c) => (c.id === id ? { ...c, color: next } : c)));
    playSfx('rustle');
  };
  const sendTelegram = (t: Omit<Telegram, 'id'>) => {
    setTelegram({ ...t, id: Date.now() });
    playSfx(t.tag === 'OFFER' ? 'offer' : 'telegram');
  };
  useEffect(() => {
    if (!telegram) return;
    const t = setTimeout(() => setTelegram(null), 5000);
    return () => clearTimeout(t);
  }, [telegram]);

  // ---------------------------------------------------------------- camera
  const sceneInfo = () => ({ radius, ringR, seats, poster: rig.current?.find('wanted-poster') ?? null });
  // Listed with a stand-in poster position; the real one is looked up when a preset plays.
  const presets = useMemo(() => presetPaths({ radius, ringR, seats, poster: [0, 2, -ringR] }, focusId), [radius, ringR, seats, focusId]);
  const play = (p: CamPath) => {
    // Presets are rebuilt at play time so they can find the poster on the wall.
    const fresh = p.preset ? (presetPaths(sceneInfo(), focusId).find((x) => x.name === p.name) ?? p) : p;
    setPlayingName(p.name);
    rig.current?.play(fresh, () => setPlayingName(null));
  };
  const stop = () => {
    rig.current?.stop();
    setPlayingName(null);
  };
  const addKey = useCallback(() => {
    const k = rig.current?.pose();
    if (k) setRecording((r) => [...r, { ...k, dur: r.length ? keyDur : 0 }]);
  }, [keyDur]);
  const saveRecording = () => {
    if (recording.length < 2) return;
    const name = window.prompt('Name this camera path', `Shot ${paths.filter((p) => !p.preset).length + 1}`);
    if (!name) return;
    const next = [...paths.filter((p) => p.name !== name), { name, keys: recording }];
    setPaths(next);
    savePaths(next);
    setRecording([]);
  };
  const deletePath = (name: string) => {
    const next = paths.filter((p) => p.name !== name);
    setPaths(next);
    savePaths(next);
  };
  const exportPaths = async () => {
    const json = JSON.stringify(paths, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      alert(`Copied ${paths.length} path${paths.length === 1 ? '' : 's'} to the clipboard as JSON.`);
    } catch {
      window.prompt('Copy this JSON', json);
    }
  };
  const importPaths = () => {
    const text = window.prompt('Paste camera paths JSON');
    if (!text) return;
    try {
      const incoming = (JSON.parse(text) as CamPath[]).filter((p) => p && typeof p.name === 'string' && Array.isArray(p.keys));
      const next = [...paths.filter((p) => !incoming.some((q) => q.name === p.name)), ...incoming];
      setPaths(next);
      savePaths(next);
    } catch {
      alert("That isn't camera-path JSON.");
    }
  };

  // ---------------------------------------------------------------- capture
  const capture = (longSide: number) => {
    const ratio = aspect === 'full' ? window.innerWidth / window.innerHeight : ASPECT_RATIO[aspect];
    const [w, h] = ratio >= 1 ? [longSide, Math.round(longSide / ratio)] : [Math.round(longSide * ratio), longSide];
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    rig.current?.capture(w, h, `wanted-keyart-${w}x${h}-${stamp}.png`);
  };

  // Keys: H hides the panel, P captures 4K, K adds a camera key, Space plays the last path / stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === 'h') setUi((v) => !v);
      else if (k === 'p') capture(3840);
      else if (k === 'k') addKey();
      else if (k === ' ') {
        e.preventDefault();
        if (rig.current?.playing()) stop();
        else if (recording.length > 1) play({ name: 'Recording', keys: recording });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- stage
  const [vw, setVw] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const read = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const stage = useMemo(() => {
    if (aspect === 'full') return { w: vw.w, h: vw.h };
    const r = ASPECT_RATIO[aspect];
    const w = Math.min(vw.w, vw.h * r);
    return { w: Math.round(w), h: Math.round(w / r) };
  }, [aspect, vw]);

  // Home: the game's own framing; portrait pulls back so the whole circle fits the narrow frame.
  const start: CamKey = useMemo(
    () => (aspect === '9:16' ? { p: [0, 11, radius + 12], t: [0, 1.2, 0], fov: 50, dur: 0 } : { p: [0, 6.6, radius + 6.5], t: [0, 1.6, 0], fov: 50, dur: 0 }),
    [radius, aspect],
  );
  // A new frame shape starts from its home framing.
  useEffect(() => rig.current?.setPose(start), [aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const trailer: SceneTrailer = useMemo(
    () => ({
      colors: Object.fromEntries(cast.map((c) => [c.id, colorInfo(c.color).hex])),
      labels,
      glowId,
      onSeats: (s) => setSeats(new Map([...s].map(([id, v]) => [id, { position: v.position, head: v.head }]))),
      rig: <TrailerRig api={rig} start={start} ringR={ringR} />,
    }),
    [cast, labels, glowId, start, ringR],
  );

  const sel = (value: string, set: (v: string) => void, label: string, withNone = false) => (
    <label className="tr-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        {withNone && <option value="">nobody</option>}
        {cast.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({colorInfo(c.color).name})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="trailer">
      <div className={`trailer-stage aspect-${aspect.replace(':', 'x')}`} style={{ width: stage.w, height: stage.h }}>
        <Scene trailer={trailer} />
        {telegram && (
          <div key={telegram.id} className="trailer-telegram note">
            <div className="note-head">
              <span>WESTERN TELEGRAPH</span>
              <span>{telegram.tag}</span>
            </div>
            <div className="note-text">
              <b>{telegram.title}</b>
              {telegram.body && <span>{telegram.body}</span>}
            </div>
          </div>
        )}
      </div>

      {ui ? (
        <aside className="trailer-panel" aria-label="Trailer director">
          <header>
            <b>Trailer mode</b>
            <span className="tr-hint">H hide · P 4K shot · K key · Space play</span>
            <a className="tr-hint" href="/dev/trailer/studio">Scripted trailers: open the studio →</a>
          </header>

          <section>
            <h4>Framing</h4>
            <div className="tr-row">
              {(['16:9', '9:16', 'full'] as Aspect[]).map((a) => (
                <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
                  {a === 'full' ? 'Window' : a}
                </button>
              ))}
            </div>
            <div className="tr-row">
              <button onClick={() => capture(3840)}>Screenshot 4K</button>
              <button onClick={() => capture(1920)}>1080p</button>
            </div>
            <label className="tr-check">
              <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Name plates
            </label>
            {sel(glowId ?? '', (v) => setGlowId(v || null), 'Glow on', true)}
            <label className="tr-field">
              <span>Players</span>
              <input type="number" min={6} max={12} value={count} onChange={(e) => setCount(Math.max(6, Math.min(12, Number(e.target.value) || 9)))} />
            </label>
            {sel(youId, setYouId, 'Seat nearest camera')}
          </section>

          <section>
            <h4>The game</h4>
            {sel(wantedId, setWantedId, 'Wanted')}
            <div className="tr-row">
              <button onClick={newPoster}>Slam new poster</button>
            </div>
            <div className="tr-row">
              <button onClick={caught}>Caught!</button>
              <button onClick={escaped}>Escaped!</button>
            </div>
            <div className="tr-row">
              {sel(searcher, setSearcher, 'Searcher')}
              {sel(target, setTarget, 'searches')}
            </div>
            <div className="tr-row">
              <button onClick={search}>Search (heads turn)</button>
            </div>
            {sel(focusId, setFocusId, 'Scarecrow')}
            <div className="tr-row">
              <button onClick={() => one(focusId, 'victory')}>Victory</button>
              <button onClick={() => one(focusId, 'despair-1')}>Despair 1</button>
              <button onClick={() => one(focusId, 'despair-2')}>Despair 2</button>
            </div>
            <div className="tr-row">
              <button onClick={() => changeColor(focusId)}>Change color</button>
              <select aria-label="Pick a color" value="" onChange={(e) => e.target.value && changeColor(focusId, e.target.value as ColorId)}>
                <option value="">or pick…</option>
                {COLOR_IDS.map((c) => (
                  <option key={c} value={c}>
                    {colorInfo(c).name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <h4>Telegram</h4>
            <select aria-label="Preset telegram" onChange={(e) => setDraft(TELEGRAM_PRESETS[Number(e.target.value)])} value={TELEGRAM_PRESETS.findIndex((t) => t.title === draft.title)}>
              <option value={-1}>Custom</option>
              {TELEGRAM_PRESETS.map((t, i) => (
                <option key={i} value={i}>
                  {t.tag}: {t.title}
                </option>
              ))}
            </select>
            <input aria-label="Tag" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value.toUpperCase() })} />
            <input aria-label="Headline" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input aria-label="Line" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="tr-row">
              <button onClick={() => sendTelegram(draft)}>Send telegram</button>
            </div>
          </section>

          <section>
            <h4>Camera</h4>
            <p className="tr-hint">Drag to look · WASD move · Q/E down/up · Shift fast · wheel zoom</p>
            {[...presets, ...paths].map((p) => (
              <div key={p.name} className="tr-row tr-path">
                <span>
                  {p.name} <small>{pathLength(p).toFixed(1)}s</small>
                </span>
                {playingName === p.name ? <button onClick={stop}>Stop</button> : <button onClick={() => play(p)}>Play</button>}
                {!p.preset && (
                  <button aria-label={`Delete ${p.name}`} onClick={() => deletePath(p.name)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <div className="tr-row">
              <button onClick={addKey}>Add key ({recording.length})</button>
              <label className="tr-field tiny">
                <span>secs</span>
                <input type="number" min={0.5} step={0.5} value={keyDur} onChange={(e) => setKeyDur(Number(e.target.value) || 3)} />
              </label>
            </div>
            <div className="tr-row">
              <button disabled={recording.length < 2} onClick={() => play({ name: 'Recording', keys: recording })}>
                Play keys
              </button>
              <button disabled={recording.length < 2} onClick={saveRecording}>
                Save path
              </button>
              <button disabled={!recording.length} onClick={() => setRecording([])}>
                Clear
              </button>
            </div>
            <div className="tr-row">
              <button onClick={exportPaths}>Export JSON</button>
              <button onClick={importPaths}>Import</button>
              <button onClick={() => rig.current?.setPose(start)}>Home</button>
            </div>
          </section>
          <footer className="tr-hint">
            Dev builds only. Nothing here reaches the game server.
          </footer>
        </aside>
      ) : (
        // Panel hidden: nothing but the scene on screen. Press H to bring it back.
        null
      )}
    </div>
  );
}
