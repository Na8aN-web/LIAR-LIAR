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
  components/scene/   Placeholder 3D (swap models here; reads the view only)
```

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
pnpm sim         # bot-only balance simulation (see PLAYTEST.md), e.g. pnpm sim -- --players 12 --decoys 3
pnpm stats       # summarise real games from apps/server/logs/games.jsonl
pnpm typecheck
pnpm build
```

## Config (server env)

| Var | Default | |
| --- | --- | --- |
| `PORT` | 3001 | |
| `MIN_PLAYERS` | 2 in dev, 6 in prod | |
| `CORS_ORIGIN` | any | Comma-separated origins in prod |
| `NODE_ENV=production` | | Disables bots and skip-phase |
| `GAME_LOG` | `logs/games.jsonl` | Per-game stats (JSON lines). `off` disables |

Web: `NEXT_PUBLIC_SERVER_URL` (defaults to the page's host on port 3001).

Playtesting: see [PLAYTEST.md](PLAYTEST.md).

## Rules of the code

- The server holds every secret. Clients only get `PlayerView` from `room.viewFor()`, never the raw state.
- Color picks and votes only update the acting player's view, so others can't time who did what.
- Poster order is one swappable function in `apps/server/src/game/posterOrder.ts` (host picks the mode).
