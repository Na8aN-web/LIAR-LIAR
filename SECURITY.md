# Security

How Wanted: True Colors keeps secrets secret and cheaters out, and how to run it safely.
Tests that prove each point live in `apps/server/test/` (`security-leaks.test.ts`,
`forged-messages.test.ts`, `practice.test.ts`, `reactions.test.ts`, `cosmetics.test.ts`).

## The rule everything rests on

The server holds every secret: everyone's colors, who is Wanted, every search result, votes,
purchases. Each player gets a view built for them alone (`room.viewFor`), and every action is a
request the server checks before doing anything. The browser is never trusted.

## What a client can and can't learn

| Secret | Who gets it |
| --- | --- |
| Another player's color | Nobody, until the end-of-game replay |
| Who is Wanted | Only the Wanted player |
| Search results | The searcher, and anyone who bought that result |
| Votes, offers, color changes | Only the player who made them (offers: buyer and seller) |
| Replay | Everyone, only after the game ends |
| Session tokens | Each player their own, once, when they take a seat |

`security-leaks.test.ts` plays full games over real connections and scans every message each
client received: an exact list of allowed fields (a new field fails the test until it's
reviewed), no other player's token, no object anywhere that pairs another player with a color,
results only from your own or bought searches, the Wanted flag only for the Wanted player, no
replay before the end, and no error message that names a color. The test was checked by planting
leaks in the server; it caught each one.

**Lobby colors.** The color you're given when you join is only a suggestion: it isn't
reserved, so watching the lobby's free-color list can't reveal what a newcomer got. A color you
pick is reserved. Clashes between suggestions are settled at game start. The list is refused
once a game is running, and polling it is rate limited.

## Every action is checked

Right phase, right player, limits (searches, purchases, one vote, one color change per
payout), enough money (no debt), real targets (ids like `constructor` or `__proto__` are not
players), sane settings (every number range-checked), and correct types. Host-only actions
(start, settings, kick, lock, bots) check the host. Fields naming another player are ignored:
you always act as the seat your connection holds. `forged-messages.test.ts` sends all of these
by hand and checks they're refused, including malformed and oversized payloads.

## Limits (apps/server/src/security.ts)

| What | Limit |
| --- | --- |
| Actions per connection | 40 at once, then 10 a second |
| Wrong room codes or session tokens | 8 per connection and 20 per IP, then 1 per 15 s (successful joins and reconnects are free) |
| New rooms (and practice games) | 5 per IP, then 1 a minute; 2,000 rooms per server |
| Chat | 6 lines at once, then 1 per 2 s (and 0.4 s between lines per seat) |
| Buy offers | 6 at once, then 1 per 10 s |
| Lobby color list / color picks | 6 at once, then 1 per 3 s |
| New connections per IP | 50 at once, then 1 a second; 40 open at once |
| Message size | 8 KB; names 16 characters; chat 200 |

A five-character room code has 28.6 million combinations; at 1 guess per 15 seconds per IP,
finding a live room by guessing is impractical. Codes stop working as soon as the room closes
(the last player leaves the lobby, or 10 minutes with nobody connected).

## Rooms and players

- **Lock:** the host can lock the room; nobody new can join, seated players can still reconnect.
- **Remove:** the host can remove a player from the lobby (Remove next to their name) or mid-game
  (✕ in the Ledger). Their session stops working and their browser can't rejoin that room.
  Mid-game the seat stays in the game (still counted, can't act), so the game itself is unchanged.
- **One seat per browser:** each browser sends a random id (no personal data); a second tab
  can't take a second seat in the same room.
- **Session tokens** are 144-bit random values, kept in the browser's storage (never in a URL),
  sent only to their owner, compared in constant time, never logged, and only work for their own
  seat in their own room.

## Player text

Names and chat are cleaned on the server (control characters, invisible characters and
text-direction overrides removed, length capped) and always displayed as text: React escapes it,
3D name tags draw it onto a canvas. Nothing a player types is ever run as HTML or code. The site
also sends a Content Security Policy that only allows the game's own scripts.

## Dev tools

The server is in production mode unless started with `--dev` (which `pnpm dev` passes), and
`NODE_ENV=production` refuses `--dev`. In production: no bots (except in a player's own practice
game), no phase skipping, 6 players minimum, and the server refuses those messages even when
sent by hand. The web build leaves the "dev: skip" button out entirely, and every `/dev` page
returns 404. Simulation scripts (`pnpm sim`, `sweep`, `stats`) are command-line tools, not part of
either server.

`logs/games.jsonl` (anonymous balance stats: no names, ids or tokens) is written next to the
game server. The game server serves nothing over HTTP except `/health`, and the web app only
serves its own `public/` folder, so the log can't be downloaded.

## Deploying safely

1. Serve the site over **HTTPS** only (the site sends HSTS so browsers stay on HTTPS). The game
   connection then uses secure WebSockets automatically.
2. Start the game server without `--dev`, with `NODE_ENV=production`.
3. Set `ALLOWED_ORIGINS` to your site (e.g. `https://wanted.example.com`). The server refuses
   connections from any other website and from plain-http pages. If the web app and the game
   server share one origin behind a proxy, it can stay unset (same host only).
4. Behind a proxy or tunnel you control, set `TRUST_PROXY=1` so limits see real client IPs.
   Never set it otherwise: clients could then fake their IP.
5. The browser only receives `NEXT_PUBLIC_*` settings (just the game server URL). There are no
   secret keys anywhere in the project; keep it that way.

Run `pnpm audit` before releases.

## What can't be fully prevented

- **Friends sharing information** over voice chat, a group chat or the same couch. Nothing in a
  browser game can stop people from talking to each other. It's the same as table talk in a
  board game; private rooms with people you trust are the answer.
- **One person playing several seats.** One seat per browser stops the easy version, but someone
  can still use a private window or a second device. Hosts can remove suspicious players.
- **Bots and helper scripts.** Someone can write a program that plays for them. It gets exactly
  what their own screen shows (the server never sends more) and the same limits, so it can only
  save effort (for example, remembering every search), not reveal secrets.
- **Lobby color picks.** If you pick a color in the lobby, someone polling the free-color list
  could see that color become taken and guess it was you from the timing. Rate limits make this
  slow and unreliable; keeping the color you're given (a random suggestion) avoids it entirely.
- **Screenshots and screen sharing** of your own screen (including the Wanted banner).
- **Large-scale attacks** (many IPs at once) need protection in front of the server, such as
  Cloudflare. The per-IP limits handle single cheaters and small scripts.
