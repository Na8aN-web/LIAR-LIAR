# Trailers

Two tools for making trailers, thumbnails and key art from the real game scene. **Dev builds
only**: they live under `/dev`, production builds answer 404 for every `/dev` page and API, and
nothing here talks to the game server.

| Tool | What it's for |
| --- | --- |
| **Trailer studio** (`/dev/trailer/studio`) | Whole trailers written as a script: shots, game moments, titles, effects and music on one timeline. Renders sharp, perfectly smooth video at 1080p or 4K, 16:9 or 9:16, off-screen and frame by frame. |
| **Director** (`/dev/trailer`) | Free play: fly the camera, trigger events by hand, take 4K screenshots for thumbnails. See [the director](#the-director-devtrailer) at the end. |

Start the dev server first:

```powershell
pnpm dev
```

---

## The trailer studio

Open **http://localhost:3000/dev/trailer/studio** (Chrome or Edge). Pick a script from the list
(they're the files in `trailers/`), press **Space** to play.

- **The stage** shows the trailer at its real shape. It's a scaled-down preview; the file is
  rendered separately at full size (see [Recording](#recording)).
- **The timeline** (bottom) shows the music's waveform with beat and bar lines, the shots (green)
  and every event: titles (red), moments (gold) and effects (blue). Click to jump there. **Drag a
  marker** to move it: it snaps to the nearest beat (**Shift**: half beats, **Alt**: no snapping)
  and the script file is saved straight away.
- **Live editing**: keep the script open in VS Code. Every time you save it, the studio picks up
  the change within a second or two, without losing your place.
- **Safe zones** (9:16): the green dashed box is where text is safe on TikTok, Reels and Shorts.
  The red hatched strips are where their captions (bottom) and buttons (right) sit. All titles and
  panels are placed inside the box automatically. The guide is never in the rendered file.

### Keys

| Key | What it does |
| --- | --- |
| **Space** | Play / pause (with music and sound effects) |
| **← / →** | One frame back / forward (**Shift**: one second) |
| **Home** | Back to the start |
| **G** | Safe zones on / off |
| **H** | Hide / show the panel and timeline |
| **R** | Record (render the file) |

### Recording

**● Record** in the panel (or **R**) renders the current script, frame shape and resolution. The
progress bar shows how far it's got. The same thing from a terminal:

```powershell
pnpm trailer:render main                          # 16:9 1080p
pnpm trailer:render vertical --res 4k             # 9:16 2160×3840
pnpm trailer:render main --format 9:16 --res 4k   # any script in either shape
pnpm trailer:render main --from 10 --to 20        # just part of it
pnpm trailer:render main --stills 3.5,12,20.25    # PNG stills (thumbnails, checking a shot)
```

Files go to `out/trailers/` (not in git):

| File | What it is |
| --- | --- |
| `main-16x9-1920x1080.mp4` | The trailer with music and sound effects |
| `main-16x9-1920x1080-nomusic.mp4` | Sound effects only, to put your own music under it |
| `…​.wav` | Both soundtracks on their own (48 kHz stereo) |
| `…-frames/` | A PNG of every frame (with `--png`) |
| `…-scene.mp4`, `…-overlay/` | Layers (see below) |

**How it stays sharp and smooth.** The renderer opens the studio in a hidden browser window
exactly the size of the output (2160×3840 for 4K vertical), whatever your monitor is, and steps
it one frame at a time: each frame moves the whole scene forward by exactly 1/60 of a second.
It doesn't matter how long a frame takes to draw, so the result is perfectly smooth even when your
PC couldn't run 4K live. Everything is rendered at full quality: full pixel density, 8× anti-
aliasing, shadows from the campfire and the moon, and the sharpest texture filtering the GPU has.
Video is H.264 (High profile, CRF 12, BT.709 colours; about 45 MB per second of 4K: big, but it is a master), which YouTube, TikTok and editors take
happily. `--crf 8` makes it even closer to lossless (bigger files).

**Speed.** Several browsers render different parts at once and the parts are joined without
re-encoding (`--workers 3` by default; each part fast-forwards the scene to its start, so the joins
are invisible: every frame is identical to a one-browser render). On this PC 4K vertical runs at
about 1.3 frames a second: the 10-second test clip took 7½ minutes, so a 30-second 4K trailer takes
about 20 minutes. 1080p is roughly 3× faster (about 9 frames a second once loaded). Draft at 1080p, render 4K at the end.

**Layers for editing.** Tick *Layers too* (or `--layers`) and the renderer also makes:

- `…-scene.mp4`: the 3D scene alone (camera moves, slow motion, freeze-frame greying), no text.
- `…-overlay/`: every overlay (titles, stamps, chips, bubbles, telegram, coins, grain, vignette,
  letterbox, end card) as a transparent PNG sequence, frame-matched to the scene.
- `…-overlay.mov` with *Overlays as ProRes 4444* (or `--alpha`): the same overlays as a video
  with alpha, for Premiere, Resolve, Final Cut or CapCut desktop. Big files.

Put the overlay layer above the scene layer in your editor and you get the trailer back, now with
every title movable and retimable.

---

## Writing a trailer script

A trailer is one JSON file in `trailers/`. The three examples are a good start:

| Script | What it is |
| --- | --- |
| `trailers/main.json` | 50-second 16:9 trailer, events placed on the music's beats |
| `trailers/vertical.json` | 27-second 9:16 cut with the poster slam in the first second (times in seconds) |
| `trailers/teaser.json` | 8-second teaser: poster slam, one line, end card |
| `trailers/test-vertical.json` | 10-second test: a slam title and the search reveal |

All follow the same arc: poster slam (hook) → **ONE OF YOU IS THE OUTLAW** → **SEARCH PLAYERS** with
the search reveal → **EVERYONE LIES** with chat bubbles and a freeze-frame → **FIND THE OUTLAW**
with the vote and ACCUSED stamp → **CLAIM THE BOUNTY** with the payout → **OUTSMART YOUR RIVALS** →
end card. Copy one to a new name (letters, numbers, `-` and `_`) and it appears in the studio's list.

### The top level

```jsonc
{
  "title": "Main trailer",          // shown in the studio
  "format": "16:9",                  // or "9:16". The same script renders in both.
  "duration": 50,                    // seconds
  "fps": 60,
  "music": {
    "file": "/audio/music-westernmusic.mp3",  // a file under apps/web/public, or one in the repo: "trailers/music/theme.mp3"
    "volume": 0.75,
    "start": 0,                      // seconds into the song where the trailer starts
    "bpm": 80.25, "offset": 0.046,   // tempo and the first beat in the song: turns on "beat:" times and snapping
    "beatsPerBar": 4,
    "fadeOut": 2.5                   // seconds of fade at the end
  },
  "sfxVolume": 1,                    // all sound effects
  "ambience": 0.25,                  // campfire crackle under everything (0 = off)
  "cast": { … },
  "look": { "grain": 0.05, "vignette": 0.45, "letterbox": 0.06 },
  "endCard": { … },
  "shots": [ … ],
  "events": [ … ]
}
```

**Don't know the tempo?** Leave `bpm` out: the timeline shows a *detected* tempo as dashed lines
(hover the timeline to read it). If they line up with the music, copy the numbers into the script.

### Times

Every `at` is either seconds (`12.5`) or a musical position, once `music.bpm` is set:

- `"beat:16"`: the 17th beat (beats count from 0, from the first beat in the trailer).
- `"bar:4"`: the start of the 5th bar (4 beats per bar unless `beatsPerBar` says otherwise).
- `"beat:16+0.1"`, `"bar:4-0.25"`: nudged by seconds.
- `"beat:24.5"`: halfway between beats.

Change the music's tempo or offset and everything placed on beats moves with it.

### The cast

```jsonc
"cast": {
  "players": 8,                                        // 6–12 around the fire
  "names": ["June", "Hank", "Dolly", "Silas", "Boone", "Pearl", "Clem", "Etta"],
  "colors": ["green", "red", "blue", "yellow", "pink", "orange", "teal", "tan"],
  "wanted": "Hank",                                    // whose color goes on the poster
  "hatless": ["Dolly"],                                // or true for everyone
  "hats": "auto"                                       // "keep" to keep everyone's hat on
}
```

The first name sits nearest the default camera. Refer to players by name (`"Hank"`) or id
(`"p1"`) anywhere in the script. **Faces**: anyone in a close-up, push-in, search reveal, freeze or
speech bubble loses their hat automatically, so their face reads on camera. Colors are the game's
palette: red, maroon, orange, tan, brown, yellow, olive, lime, green, mint, teal, cyan, sky, blue,
lavender, purple, magenta, pink, white, gray.

### Shots (the camera)

Each shot runs from its `at` until the next shot starts. The move is stretched to fit.

```jsonc
{ "at": "beat:10", "camera": { "preset": "closeUp", "target": "Hank" }, "label": "Search" }
```

| Preset | The move |
| --- | --- |
| `home` | The game's own view, drifting in a touch |
| `wide` | High and wide over the whole circle |
| `orbit` | Circles the fire at head height (about 20° a second) |
| `circleSlow` | Lower and slower circle, for chat and bubbles |
| `pushIn` + `target` | From across the fire down to a low, front-on shot of one scarecrow |
| `closeUp` + `target` | Holds on one scarecrow's face, drifting in |
| `overShoulder` + `from` + `target` | Over one player's shoulder at another |
| `lowAngle` | Low to the ground, looking up at the circle |
| `revealTown` | Up from the flames and out over the rooftops |
| `poster` | Drifts up to the Wanted poster on the sheriff's wall |

**Your own moves**: make one in the director (`/dev/trailer`: fly, **K** for each key, **Export
JSON**) and paste its keys: `"camera": { "keys": [ { "p": [x,y,z], "t": [x,y,z], "fov": 40, "dur": 0 }, … ] }`.
`p` is where the camera is, `t` what it looks at, `dur` the seconds to reach that key.

**9:16** reuses the same shots: wide ones back away and widen the lens so the circle still fits;
close ones change less. If a shot needs its own vertical version, add `"vertical": { … }` (a
preset or keys) next to `camera`.

### Events

Every event has `at` and an optional `dur` (seconds; each type has a sensible default). Players
are names or ids.

#### Titles

```jsonc
{ "at": "beat:5", "type": "title", "text": "ONE OF YOU IS THE OUTLAW", "sub": "Whoever wears the poster's color",
  "in": "slam", "out": "fade", "pos": "center", "size": 1, "color": "cream", "dur": 3 }
```

| Option | Values |
| --- | --- |
| `in` | `slam`: drops from huge with a thud, a burst of dust and a short camera shake. `slide`: whooshes in (`from`: `left` / `right`). `stamp`: an inked stamp, like ACCUSED. `type`: typed out telegram-style, a key click per letter. |
| `out` | `fade`, `slide`, `burn` (catches fire and burns away with embers), `none` |
| `pos` | `top`, `upper`, `center`, `lower`, `bottom` (always inside the safe zone) |
| `size` | 1 = default; long lines shrink to fit the frame anyway |
| `color` | `cream`, `brass` (gold), `oxblood` (red with a cream edge) |
| `sub` | A smaller line underneath |

Titles use Rye (the game's display font); `type` titles use the telegram typewriter font.

#### Staged moments (the real game visuals)

| Event | What happens |
| --- | --- |
| `posterSlam` | A Wanted poster slams toward the camera full-screen (paper slap, thud, dust, shake), then shrinks onto the sheriff's wall, where the town's poster takes over. `color` (default: the Wanted player's), `pot`, `fullScreen: false` for just the wall. Also starts a new poster in the made-up game. |
| `searchReveal` | The camera pushes in on `target`, a search card slides up, a finger taps **Search**, the target's head turns toward `searcher`, and four color chips pop out one by one. Then a second search: the real color glows as it repeats ("Shows up every time"). `chips: [[4 colors], [4 colors]]` to choose them; `camera: false` to keep the shot's camera. About 6 s. |
| `search` | Just the head turn (`searcher`, `target`) |
| `bubble` | A speech bubble over `who`'s head: `text`. Lying, visible without the chat panel. |
| `telegram` | A big telegram slides in: `tag` (`OFFER`, `WATCHED`, …), `title`, `body`, `sound` (`offer` or `telegram`) |
| `vote` | The town bell, the **NAME THE OUTLAW** panel picks through names, then a huge **ACCUSED** stamp slams onto `target` |
| `stamp` | Any stamp: `text`, `on` (a player, or the centre), `color` |
| `payout` | Coins burst and the bounty counts up: `amount`, `label`. Everyone cheers, the outlaw slumps. |
| `escape` | **ESCAPED** stamped on `who` (default: the Wanted player), who fades into the fog. The outlaw cheers, everyone else slumps. |
| `caught` | Reactions only: everyone cheers, the outlaw slumps |
| `react` | One scarecrow: `who`, `reaction` (`victory`, `despair-1`, `despair-2`) |
| `colorChange` | A flash, ring and sparks on `who`'s garment as it changes to `to` (or a free color) |
| `freeze` | Freeze frame: the scene stops and greys, a label (`label`, e.g. `"HANK — LYING"`) stamps beside `who` with a pointer, then it all unfreezes |
| `endCard` | The end card (text in `endCard`, below) |

#### Effects

| Event | Options |
| --- | --- |
| `slowmo` | `speed` (0.3 = a third), `ramp` (seconds to ease in and out), `dur`. Slows the scene and the camera; titles keep normal speed. |
| `shake` | `strength` (0–1), `dur`. Slams, stamps and the poster already shake the camera on their own. |
| `flash` | `color`: `white` or `black` (a flash cut), `dur` |
| `dust` | A dust and smoke wipe across the frame: put it on a cut between shots |
| `look` | Changes `grain`, `vignette` or `letterbox` over `dur` (e.g. letterbox off before the end card) |
| `sfx` | Any sound: `name` (below), `gain` |

The script's `look` sets the starting film grain (0–1), vignette (0–1) and letterbox (each bar as a
fraction of the height, e.g. 0.06).

**Sounds** (all synthesized, nothing to license): `impact`, `thud`, `hit`, `whoosh`, `pop`,
`reveal`, `sparkle`, `typekey`, `burn`, `freeze`, `unfreeze`, `chaching`, `wind`, and the game's
own `poster`, `stamp`, `coins`, `victory`, `despair`, `crow`, `telegram`, `offer`, `townBell`,
`rustle`, `gameEnd`, `click`, `tick`, `tock`. Every moment above already plays its own sounds at
the right instants.

### End card

```jsonc
"endCard": {
  "title": "Wanted",
  "subtitle": "True Colors",
  "tagline": "FREE IN YOUR BROWSER",
  "url": "wantedtruecolors.com",
  "discord": "discord.gg/wantedtruecolors",
  "credit": "A 3042Official game"
}
```

Any line can be changed; leave `discord` empty to drop it. **The URL and Discord in the examples
are placeholders**: put the real ones in before publishing.

### Tips

- Build a trailer one beat at a time: put the events roughly in place in the JSON, then drag them
  onto the beats in the timeline.
- Hook in the first second for vertical: a `flash` and a `posterSlam` at 0.
- One moment per shot reads best. Let a title land, then the moment.
- Check a shot quickly with `--stills`, or scrub to it in the studio and step with ← / →.
- If the studio shows a red message under the script name, a time or a name in the script is wrong;
  it says which event.

---

## The director (`/dev/trailer`)

A director's stage for screenshots and quick experiments: the real scene, driven by a made-up game
you control by hand. Press **H** to hide the panel.

| Key | What it does |
| --- | --- |
| **H** | Hide / show the panel |
| **P** | Save a 4K screenshot (PNG) of exactly what the camera sees |
| **K** | Add a camera keyframe where the camera is now |
| **Space** | Play your keyframes / stop a camera move |
| Drag | Look around |
| **W A S D** or arrows | Fly forward, left, back, right |
| **Q / E** | Down / up |
| **Shift** | Fly faster |
| Mouse wheel | Zoom (lens) |

- **Framing**: 16:9, 9:16 or the window; name plates; the "this is you" glow; 6–12 players.
- **The game**: who's Wanted, slam a new poster, caught / escaped reactions, head turns, single
  reactions, color changes.
- **Telegram**: presets or your own, slides in for 5 seconds.
- **Camera**: ready-made moves (orbit, push in, reveal the town, the poster) and your own: fly,
  **K** for each key, set the seconds between keys, **Save path**. **Export JSON** copies your
  paths, ready to paste into a trailer script's `"keys"`.
- **Screenshot 4K** (or **P**): 3840 px on the long side at the frame's shape, just the 3D scene.
  For thumbnails with titles on them, use the studio's `--stills` at 4K instead.

Every scarecrow shows its real color in trailer tools. That's safe because the whole game here is
made up on your computer; in the real game, other players' colors never reach your screen.

## Code

- `components/trailer/studio/`: the studio (`Studio.tsx`), script format and timing (`script.ts`),
  camera presets (`cameras.ts`), overlays and effects (`Overlays.tsx`, `studio.css`), sound
  (`sound.ts`), timeline (`Timeline.tsx`), the in-scene rig (`StudioRig.tsx`).
- `app/dev/trailer/studio/page.tsx` and `app/dev/trailer/api/`: the page and its dev-only API
  (scripts, music files, the Record button).
- `tools/render-trailer.mjs`: the renderer.
- `components/trailer/`: the director.
