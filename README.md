# Wanted: True Colors

Real-time 3D social deduction game for 6–15 players. Rules live in the build spec; this README covers running the code.

## Layout

```
packages/shared   Event names, payload types, palette, rule constants (used by both sides)
apps/server       Node + Socket.io. Authoritative game state, per-player views, bots
  src/game/       Pure rules: engine.ts, decoys.ts, posterOrder.ts, summary.ts (no sockets/timers)
  src/bots/       Dev bots: brain.ts decides from the bot's own PlayerView only; driver.ts schedules
  src/room.ts     Lobby, phases/timers, reconnects, builds each player's view
apps/web          Next.js + React Three Fiber. 3D scene + HTML overlay UI
  components/scene/   3D scene: scarecrow model, items, labels (reads the view only)
tools/            playtest.mjs (remote playtest launcher), proxy.mjs (web + game server on one origin),
                  build-character.mjs (animated scarecrow), build-scenery.mjs (town scenery)
docs/SPEC.md      The build spec (rules)
```

Rules: [docs/SPEC.md](docs/SPEC.md).

## Run

```sh
pnpm install
pnpm dev          # server on :3001, web on :3000
```

Open http://localhost:3000. In dev, each browser tab is a separate player (tokens use sessionStorage), and the host can add bots and skip phases.

**Test on a phone:** same Wi-Fi, open `http://<your-PC-LAN-IP>:3000`. Windows Firewall may ask to allow Node.

## Checks

```sh
pnpm test        # rule tests (vitest)
pnpm smoke       # full game over real sockets: 2 humans + 4 bots, buying, reconnect, leak checks
pnpm sim         # bot-only balance simulation (see PLAYTEST.md), e.g. pnpm sim -- --players 12 --decoys 3 --swaps 2
pnpm sweep       # grid over color swaps x decoys, prints an accuracy table
pnpm stats       # summarise real games from apps/server/logs/games.jsonl
pnpm feedback    # every end-of-game feedback answer
pnpm typecheck
pnpm build
```

## 3D model

`apps/scarecrow.glb` is the original static model and is never modified. The game uses the
Mixamo-rigged copy in `assets/source/animations/` (six FBX files, also never modified).
`pnpm model` (or `pnpm model -- --triangles 6000`) converts them with FBX2glTF, checks that they
share one skeleton, and writes `apps/web/public/models/scarecrow.glb`: one skinned mesh
(~8k triangles, 34 joints) with six clips (`sit-relaxed`, `sit-hunched`, `sit-leaning`,
`despair-1`, `despair-2`, `victory`), quantized and meshopt-compressed (~270 KB).

Neither the source model (Meshy's untextured "white mesh") nor the Mixamo files carry textures,
UVs or colors, so `tools/paint-scarecrow.mjs` paints the clothes on as vertex colors from the
rig (dark patched shirt, rope belt, brown trousers, burlap head, straw tufts, wooden hands,
boots). Replace it with the real texture once a textured export exists.

Every scarecrow is a cheap clone with its own bones and mixer and shared geometry. Items
(poncho, cloak, bandana) are built in code in `components/scene/items.ts` and skinned to the
torso at load time, each player with their own material. Reactions are decided by the
server (SPEC 3.9).

## Ad slots

Every sponsor surface in town (rooftop billboards, painted wall signs, door poster boards) is
defined in `apps/web/config/adSlots.ts`: id, lot, position, size, aspect ratio (2:1, 16:9 or
2:3) and image. Placeholder ads live in `apps/web/public/ads/`. To sell a slot, add the
sponsor's image at the slot's ratio and point `image` at it.

## Sound

Every UI sound effect is synthesized in code (`apps/web/lib/audio/sfx.ts`); audition them at
`/dev/sounds`. Music and ambience come from `assets/source/audio/` (never modified): `pnpm audio`
sorts the files by name (music, fire, wind, crow), cuts long ambience to a one-minute loop,
re-encodes for the web, normalises loudness, and writes `apps/web/public/audio/` plus a
`manifest.json` the game reads. Sound starts on the first tap; Settings has a mute switch and
music, effects and ambience sliders.

## How to Play screenshots

`pnpm howto:screens` plays a scripted bot game (as Ada, with seven bots, on a phone-sized
screen), rings the relevant part of each moment, and writes the eight walkthrough images to
`apps/web/public/howto/` (PNG copies in `screenshots/howto/`). Rerun it after UI changes.
It uses the dev server (starting it if needed) and installed Edge or Chrome
(`HOWTO_BROWSER=path` to choose). Slide text is in `apps/web/components/howto/slides.ts` and
reads its numbers (prices, decoys, bounty) from the game rules.

## Town scenery

`pnpm scenery` builds `apps/web/public/models/scenery.glb` (buildings + props, ~14k triangles,
~640 KB) and the poster/ground textures from the CC0 packs in `assets/source/` (never modified):
buildings are cut out of the town kit, turned to face the square and merged per material; the FBX
props pack is converted with FBX2glTF; normal/roughness maps are dropped and textures become
WebP ≤ 512 px. In game the buildings ring the scarecrow circle (open toward the camera), repeated
props are instanced, and lighting is the moon + 2 real lanterns with the rest faked (glowing
materials and additive halos). The live Wanted poster hangs on the sheriff's office
(`components/scene/town/PosterPanel.tsx`), drawn from the same artwork as the UI poster
(`components/poster/posterArt.ts`). Empty poster spots for later are in `sceneryAnchors.json`.
Asset credits: [CREDITS.md](CREDITS.md).

- `/dev/scenery` (dev only): every building and prop, labelled. `?focus=sheriff` zooms on a building front.
- `/dev/scarecrow?view=front|side|back` (dev only): the model with each item and a silhouette.
- Add `?perf` to any page URL (also on a real phone) for FPS, draw calls and triangles.

## Admin dashboard

`/admin` (not linked anywhere): Live rooms and server health, Growth, Sources (`?src=` links),
Funnel, Balance, Feedback, Safety (reports, kicks, mutes, bans, rate limits), Billboards (views,
swap images live), Controls (message everyone, maintenance mode, default game settings) and the
Admin log.

```sh
pnpm admin:setup              # choose the password and link an authenticator app (once per server)
pnpm admin:seed               # fill it with the playtest files + 30 days of simulated visitors (tagged "seed")
pnpm admin:seed -- --remove   # delete the seed data
```

Security and Cloudflare Access: [SECURITY.md](SECURITY.md#admin-dashboard-admin). Data lives in
`apps/server/logs` by default, or Postgres with `ANALYTICS_STORE=postgres` (schema:
`apps/server/src/store/schema.sql`).

## Config (server env)

| Var | Default | |
| --- | --- | --- |
| `PORT` | 3001 | |
| `--dev` (command-line flag) | off | Dev tools: bots, skip-phase, small lobbies. `pnpm dev` passes it; refused when `NODE_ENV=production`. Without it the server is a production server. |
| `MIN_PLAYERS` | 2 | Dev only; production always needs 6 |
| `ALLOWED_ORIGINS` | this server's own host | Production: sites allowed to connect, comma-separated (`https://wanted.example.com`, or `https://*.example.com`). Must be https. |
| `TRUST_PROXY` | off | `1` behind a proxy/tunnel you run, so rate limits see real client IPs (Cloudflare / X-Forwarded-For). Never set it without a proxy: clients could fake their IP. |
| `DATA_DIR` | `logs` | File store: game stats (`games.jsonl`), feedback, analytics events, admin log and settings. Kept next to the server, never served. |
| `ANALYTICS_STORE` | `file` | `postgres` to use Postgres instead (with `DATABASE_URL`, and `DATABASE_SSL=1` if the host requires TLS). |
| `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` | none | Admin login, written by `pnpm admin:setup` to `apps/server/.env.local` (git-ignored). Unset: `/admin` stays locked. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | none | Cloudflare Access in front of `/admin`: the admin API then also requires Cloudflare's signed token. |

**Security:** see [SECURITY.md](SECURITY.md) for what the server enforces, the limits, and how to deploy safely (HTTPS, origins).

Web: `GAME_SERVER_INTERNAL_URL` (default `http://127.0.0.1:3001`): where the web server forwards `/admin/api` and `/billboards` (server to server). `NEXT_PUBLIC_SERVER_URL`: a URL, or `same-origin`. Unset: port 3001 on the same host when the page is on :3000 (local dev), otherwise the page's own origin (tunnel/proxy, `tools/proxy.mjs`).

Playtesting, including the remote setup (`pnpm playtest`, Cloudflare Tunnel): see [PLAYTEST.md](PLAYTEST.md).

Going live (Railway, Postgres, Cloudflare, Sentry, admin login): see [DEPLOY.md](DEPLOY.md). Production runs from the `Dockerfile` via `tools/start-prod.mjs`.

## Rules of the code

- The server holds every secret. Clients only get `PlayerView` from `room.viewFor()`, never the raw state.
- Color picks, color swaps and votes only update the acting player's view, so others can't time who did what. Swaps are announced only as a count at the next poster.
- Poster order is one swappable function in `apps/server/src/game/posterOrder.ts` (host picks the mode).
