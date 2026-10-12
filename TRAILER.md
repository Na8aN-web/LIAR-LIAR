# Trailer mode

A director's stage for trailers, thumbnails and key art: the real game scene (town, campfire,
scarecrows, animations), driven by a made-up game you control. No UI, free camera, smooth camera
moves, 16:9 or 9:16 framing, and 4K screenshots.

**Dev builds only.** It lives at `/dev/trailer`. Production builds answer 404 for every `/dev`
page, and the trailer code isn't even included in them. Nothing in trailer mode talks to the game
server.

## Start it

```powershell
pnpm dev
```

Open **http://localhost:3000/dev/trailer** in Chrome or Edge on your computer.

The director panel is on the right. Press **H** to hide it (and again to bring it back): with it
hidden there is nothing on screen but the scene.

## Keys

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

Keys don't fire while you're typing in a panel field.

## Framing

- **16:9**: YouTube, trailers, thumbnails.
- **9:16**: TikTok, Shorts, Reels. The stage becomes a tall frame in the middle of the window and
  the camera pulls back so the whole circle fits.
- **Window**: whatever shape the browser window is.

The black bars around the frame aren't part of the shot. When recording, crop OBS to the frame
(see below).

## Directing the game

**Framing section**

- **Name plates**: off by default for clean shots.
- **Glow on**: puts the soft "this is you" glow on one scarecrow.
- **Players**: 6 to 12 around the fire.
- **Seat nearest camera**: who sits with their back to the default camera.

**The game section**

- **Wanted**: who the outlaw is. The poster shows their color.
- **Slam new poster**: a new Wanted poster slams onto the sheriff's wall (with its sound).
- **Caught!**: the outlaw slumps in despair, everyone else celebrates.
- **Escaped!**: the outlaw celebrates, everyone else despairs.
- **Searcher → searches**: everyone's heads turn toward the one being searched, like in the game.
- **Scarecrow + Victory / Despair 1 / Despair 2**: one scarecrow's reaction on its own.
- **Change color**: that scarecrow's poncho, cloak or bandana changes to a random free color, or
  pick one from the list.

**Telegram section**

Pick a preset (offer, search, deal, new poster, color change) or type your own tag, headline and
line, then **Send telegram**. It slides down at the top of the frame for 5 seconds. Telegrams are
part of the shot, so they show even with the panel hidden.

Every scarecrow shows its real color in trailer mode. That's safe because the whole game here is
made up on your computer. In the real game, other players' colors never reach your screen.

## Camera moves

Four ready-made moves, built from the scene:

| Move | What it does |
| --- | --- |
| **Orbit the fire** | A slow full circle around the campfire (about 18 s) |
| **Push in on a scarecrow** | From across the fire to a medium shot of the scarecrow chosen under "Scarecrow" |
| **Pull back to reveal the town** | From just above the flames, up and out over the rooftops |
| **The Wanted poster** | Drifts up to the poster on the sheriff's wall |

### Your own moves

1. Fly the camera to the first position and press **K** (or **Add key**).
2. Set **secs** (how long the camera takes to get to the *next* key), fly to the next position, press **K**.
   Repeat.
3. **Play keys** (or **Space**) to preview. The camera curves smoothly through every key, easing
   in at the start and out at the end.
4. **Save path** and name it. Saved moves stay in this browser and appear in the list with
   **Play** and **✕**.
5. **Export JSON** copies every saved move to the clipboard (keep it in a file, share it, put it
   in git); **Import** pastes them back, on any computer.

**Home** puts the camera back to the game's own view.

## Screenshots for thumbnails and key art

- **Screenshot 4K** (or **P**): 3840 px on the long side, at the frame's shape: 3840×2160 for 16:9,
  2160×3840 for 9:16. **1080p** saves 1920 px.
- The PNG downloads straight away, named like `wanted-keyart-3840x2160-2026-10-11-20-12-55.png`.
- It renders only the 3D scene, at full resolution: no panel, no telegram, no black bars. Turn
  name plates off for clean key art (they're part of the 3D scene).

## Recording a trailer with OBS

1. Make the browser window large (or full screen with **F11**) and press **H** to hide the panel.
2. In OBS, add a **Window Capture** of the browser. For 16:9 at 1920×1080, set the OBS canvas to
   1920×1080 and fit the capture. For 9:16, set the canvas to 1080×1920 and crop the capture to the
   tall frame: hold **Alt** and drag the capture's edges in to the frame.
3. Settings → Video → **60 FPS**; Settings → Output → recording format **mkv**.
4. Start recording, then trigger your shots: **Space** for a camera move, and the panel buttons (or
   bring the panel up with **H**, click, then **H** again) for poster slams, reactions and telegrams.
   Sounds play with each event.
5. Cut the clips together in your editor.

Tip: plan each shot as one camera move plus one or two events (for example, "Pull back to reveal
the town", then **Slam new poster** halfway through).

## Notes

- The scarecrows sit hunched with their hats tipped forward, so a tight close-up shows mostly
  hat brim. Medium shots and three-quarter angles read best. For faces, change their cosmetics in
  the cast (`components/trailer/Trailer.tsx`, `makeCast`) to ones without hats.
- The cast is the same every time (seeded), so shots are repeatable.
- From the browser console, `window.__wtcTrailer()` gives the camera controls (`pose()`,
  `setPose()`, `play()`, `capture()`) for scripted captures.
- Code: `components/trailer/` (director, camera rig, camera paths) and `app/dev/trailer/page.tsx`.
