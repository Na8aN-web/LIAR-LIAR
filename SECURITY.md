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

**Limits are per browser, not per IP.** Many players share one IP address: mobile carriers put
thousands of phones behind a few addresses (CGNAT, common in Nigeria), and a household or office
shares one Wi-Fi. So each person's limits follow their browser (the random id it makes up, see
below), and per-IP limits are only a much higher ceiling that stops obvious abuse, such as a
script inventing a new browser id for every request. A client that sends no browser id (the game
always sends one) is limited by its IP instead, so leaving the id out doesn't escape the limits.

| What | Per connection | Per browser | Per-IP ceiling |
| --- | --- | --- | --- |
| Actions (any message) | 40 at once, then 10 a second | | |
| Chat | 6 lines at once, then 1 per 2 s (and 0.4 s between lines per seat) | | |
| Buy offers | 6 at once, then 1 per 10 s | | |
| Lobby color list / color picks | 6 at once, then 1 per 3 s | | |
| Wrong room codes or session tokens (successful joins and reconnects are free) | 8, then 1 per 15 s | 20, then 1 per 15 s | 300, then 1 a second |
| New rooms (and practice games) | | 5, then 1 a minute | 200, then 2 a second |
| Opening Find a Lobby | | 8, then 1 per 4 s | 500, then 20 a second |
| Quick Play and joining from the list | | 8, then 1 per 3 s | 500, then 10 a second |
| New connections | | 30, then 1 per 2 s | 1,000, then 50 a second |
| Open connections at once | | 12 | 3,000 |
| Rooms per server | | | 2,000 in all |
| Message size | 8 KB; names 16 characters; room names 28; chat 200 | | |

What changed from per-IP limits, and why each ceiling is where it is:

- **Wrong codes** were 20 per IP: on a shared carrier IP a few typos by strangers would have
  locked everyone out of joining. Now 20 per browser; the IP ceiling (1 a second) is what a
  code-guessing script runs into. A five-character code has 28.6 million combinations, so even at
  the ceiling a guesser finds a live room only rarely, and all it gets is a seat in a lobby (the
  same as joining a public room). Session tokens are 18 random characters: unguessable either way.
- **New rooms** were 5 per IP, then 1 a minute: the 6th person on a carrier IP couldn't open a
  room. Now per browser; the ceiling allows 2 rooms a second from one IP.
- **Connections** were 50 new and 40 open per IP: one busy carrier IP would have filled up. Now
  12 open per browser (a few tabs) and 30 new (a phone on a flaky network reconnects a lot), with
  ceilings of 3,000 open and 50 new a second per IP.
- **Find a Lobby and Quick Play** were per connection, which a reconnect would reset. Now per
  browser.
- **Unchanged:** the per-connection limits (actions, chat, offers, color picks) and the admin
  sign-in limit (5 failures per IP, then one every 3 minutes: admins aren't sharing a carrier IP
  with players, and that one must stay strict).

Limitation: a browser id is made up by the browser, so a determined script can make up new ones;
that's exactly what the per-IP ceilings are for. Large attacks from many IPs at once need
protection in front of the server (Cloudflare).

Codes stop working as soon as the room closes (the last player leaves the lobby, or 10 minutes
with nobody connected).

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

**Bad-word filter** (`packages/shared/src/wordFilter.ts`): common profanity and slurs, including
l33t spellings, spaced or dotted letters and repeated letters, with exceptions for innocent words
that contain them (Scunthorpe, cocktail, Essex...).

- **Player names:** a name that fails becomes "Stranger 1", "Stranger 2"... on the server, so the
  original never reaches anyone: name plates, the ledger, chat, the vote screen, the lobby list,
  feedback.
- **Room names:** a name that fails falls back to "<host>'s Campfire".
- **Chat in public rooms:** filtered words are replaced with asterisks of the same length
  ("you ****"). Private rooms are among friends and are left as typed. Mute and report work in
  both.

A filter is a first line, not a guarantee: players can still report, hosts can remove, and admins
can ban.

## Dev tools

The server is in production mode unless started with `--dev` (which `pnpm dev` passes), and
`NODE_ENV=production` refuses `--dev`. In production: no phase skipping, 6 players minimum, and
the server refuses those messages even when sent by hand. Bots aren't a dev tool any more: any
host can add them (a few friends need them to reach 6), and every game with a bot is tagged
`withBots` so stats and the dashboard can keep to human-only games (`pnpm stats -- --humans`;
Balance → Players). The web build leaves the "dev: skip" button out entirely, and every `/dev` page
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
5. The browser only receives `NEXT_PUBLIC_*` settings (just the game server URL). The only
   secrets are the admin login (`ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`) and the database URL,
   and they live only in the game server's environment (`apps/server/.env.local` locally, which
   git ignores). Never prefix them with `NEXT_PUBLIC_`.
6. Put Cloudflare Access in front of `/admin` (below).

Run `pnpm audit` before releases.

## Admin dashboard (/admin)

The dashboard is a page of the web app, but everything it shows comes from the game server's
admin API (`/admin/api/*`, which the web app forwards to the game server). The page itself holds
no data and no secrets; the API checks everything. It isn't linked from anywhere, and it's marked
`noindex` for search engines.

**Signing in** needs two things: a password (stored only as a scrypt hash) and a 6-digit code from
an authenticator app (TOTP). Set both up on the server with `pnpm admin:setup`. Without them the
admin API refuses everything.

- **Rate limits:** 5 failed sign-ins per IP, then one more every 3 minutes; 50 an hour from
  everywhere together. Each authenticator code works once.
- **Session:** a random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
  (`__Host-wtc_admin`), kept on the server only as a hash. It ends after 12 hours, or 1 hour
  unused, or on a server restart.
- **Forged requests:** every API call must carry an `x-wtc-admin: 1` header. Pages on other
  sites can't add it (and the cookie isn't sent cross-site anyway).
- **Audit log:** every sign-in attempt (with its IP), every action (closing rooms, bans,
  broadcasts, maintenance, default settings, billboard swaps) and every look at a finished
  game's results. Page: Admin log.
- **Confirmations:** every action shows what it will do and needs a Confirm.
- **Secrets during a game:** the Live page and the room view show only what any player in the
  room sees (names, who's connected, the phase and timer). Colors, the Wanted player, votes and
  search results appear only once the game has ended. `apps/server/test/admin.test.ts` checks
  the API's answers through every phase of a game.
- **Billboard uploads:** PNG, JPEG or WebP only, checked by their bytes (not the file name), at
  most 2 MB, never SVG. Served with `nosniff` and a sandboxing CSP. The house slot can't be
  replaced.
- **Bans** are by anonymous browser id. They stop casual trouble-makers; someone who clears their
  browser data gets a new id (see below).

### Cloudflare Access (at launch)

Cloudflare Access makes Cloudflare check who you are before `/admin` is even reachable: a second
lock in front of the password. It needs your own domain on Cloudflare (it doesn't work with the
temporary `trycloudflare.com` playtest links). It's free for small teams.

1. In the Cloudflare dashboard, open **Zero Trust → Access → Applications → Add an application →
   Self-hosted**.
2. **Application domain:** your site's domain, **path** `admin`. Access then covers `/admin` and
   everything under it, including the API (`/admin/api/...`).
3. **Policy:** Action **Allow**, Include **Emails** → your email address (add anyone else who
   should get in). Session duration: 24 hours is fine.
4. **Login method:** the default "One-time PIN" (a code sent to your email) works with no setup.
5. Save. Open the application again and copy its **Application Audience (AUD) Tag**. Your **team
   domain** is under **Zero Trust → Settings → Custom pages** (it looks like
   `https://yourteam.cloudflareaccess.com`).
6. On the game server, set:
   ```
   CF_ACCESS_TEAM_DOMAIN=https://yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<the AUD tag>
   ```
   and restart it. It prints `Admin dashboard: /admin (password + authenticator code, behind
   Cloudflare Access)`. From then on the admin API checks Cloudflare's signed token on every
   request, so even someone who reaches the server without going through Cloudflare can't use it.
7. Check: open `https://your-site/admin` in a private window. Cloudflare should ask for your
   email first, then the dashboard asks for the password and code.

### Data the server keeps

Analytics, game stats, feedback, the admin log and admin settings go to the store chosen by
`ANALYTICS_STORE`: files in `apps/server/logs` (default), or Postgres
(`ANALYTICS_STORE=postgres`, `DATABASE_URL=...`, `DATABASE_SSL=1` for hosted databases; the
schema is `apps/server/src/store/schema.sql` and is created on start). No player names (except
the display name typed on a feedback form), no session tokens and no player IP addresses. A
player is an anonymous id: a one-way hash of the random id their browser made up; the database
refuses anything else in that column. Chat is stored only when a message is reported (that
message and up to four before it, without names). The plain-English version for players is the
Privacy page (`/privacy`), linked from Settings and Credits.

## What can't be fully prevented

- **Friends sharing information** over voice chat, a group chat or the same couch. Nothing in a
  browser game can stop people from talking to each other. It's the same as table talk in a
  board game; private rooms with people you trust are the answer.
- **Ban evasion.** Bans are per browser. Clearing browser data, a private window or another
  device gets a new anonymous id. Without accounts this can't be closed completely; bans stop
  the casual cases and make the rest a chore.
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
