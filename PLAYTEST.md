# Playtest guide

## Remote playtest from your Windows PC

You run the game on your machine. A Cloudflare Tunnel gives you one public `https://…trycloudflare.com` link
for testers. No account or domain needed.

### One-time setup

1. Open **PowerShell** and install Cloudflare Tunnel:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. **Close and reopen PowerShell**, then check it worked:
   ```powershell
   cloudflared --version
   ```
3. In the project folder, make sure dependencies are installed:
   ```powershell
   cd C:\Users\obliv\projects\wanted-true-colors
   pnpm install
   ```

### Each session

1. In PowerShell, from the project folder:
   ```powershell
   pnpm playtest
   ```
   This builds the web app (about a minute), starts the game server, the web app and a local proxy on port 8080,
   then opens the tunnel.
2. Wait for the banner:
   ```
   ==============================================
     SHARE THIS LINK:  https://something-random.trycloudflare.com
   ==============================================
   ```
3. Open that link yourself first, press **Play → Create room**, then use **Invite** in the lobby to copy the room
   link and send it to testers. (They can also open the main link and type the room code.)
4. Keep the PowerShell window open during the session. **Ctrl+C** stops everything.

The link changes every time you run `pnpm playtest`, so send the new one each session.

### Options

| Command | What it does |
| --- | --- |
| `pnpm playtest -- --skip-build` | Starts faster by reusing the last web build (only after a previous `pnpm playtest`) |
| `pnpm playtest -- --strict` | Production rules: no bots, no dev skip button, 6+ players to start |
| `pnpm playtest -- --no-tunnel` | Everything local on http://localhost:8080, to check before inviting people |
| `pnpm playtest -- --tunnel ngrok` | Use ngrok instead of Cloudflare |

Without `--strict`, you (the host) keep the dev tools: **+ Bot / Fill to 10** to pad a short lobby, and a
**skip** button for emergencies. Bot-padded games are tagged in the stats.

### If something goes wrong

- **"No tunnel tool found"**: reopen PowerShell after installing, or run `winget install --id Cloudflare.cloudflared` again.
- **Testers see "Game is starting up or not running"**: wait for the banner; the server may still be starting.
- **Port already in use**: something else (often a leftover `pnpm dev`) is on 3000, 3001 or 8080. Close it, or
  restart the PC, and try again.
- **Cloudflare is blocked or flaky**: use ngrok instead.
  1. `winget install --id Ngrok.Ngrok`
  2. Sign up free at ngrok.com, copy your authtoken, then run `ngrok config add-authtoken <token>`
  3. `pnpm playtest -- --tunnel ngrok`
- **Testers on the free ngrok plan** may see an ngrok warning page first; they just click "Visit Site".

### How it works

The proxy (`tools/proxy.mjs`) serves the web app and the game server on one origin: `/socket.io` (including
the WebSocket upgrade) goes to the game server on :3001, everything else to the web app on :3000. The tunnel
points at the proxy, so testers only need one link. The web app reads the server address from
`NEXT_PUBLIC_SERVER_URL`. Unset (the default), it uses the page's own origin, unless the page is on port 3000
(local dev), where it uses port 3001.

## Same Wi-Fi instead

`pnpm dev`, then everyone opens `http://<host-PC-LAN-IP>:3000` (find the IP with `ipconfig`; allow Node
through Windows Firewall when asked).

## Running the session

- Aim for 6–10 people. Bots can fill gaps, but note which games used them.
- Play one game on defaults first, then change **one** setting per game (lobby → Game settings, and
  **Playtest tuning** for the balance numbers).
- Keep the skip button for emergencies only. It distorts the stats.
- Clear old stats for a clean sheet: delete `apps/server/logs/games.jsonl`.

## What to watch

The bot simulator (`pnpm sim`, `pnpm sweep`) makes predictions worth checking with real people:

1. **Color swaps.** Do people use them? Do they swap when they feel exposed, or save them? Does
   "2 players changed color" make people doubt what they knew? Is the 10-second payout long enough to pick a color?
2. **The late game.** With the defaults (auto swaps, 3 decoys, "Random, repeats allowed"), bots are right about
   40% / 55% / 65% early / mid / late at 10 players, but still ~93% late at 15 players. Does it feel like
   knowledge builds up without being certain? Is the 15-player late game too easy?
3. **Random color assignment.** Swapping gives you a random free color. Does that feel fair, or do people
   want to choose? Does anyone use Undo?
4. **The scoreboard leaks.** A lone +50 means that player escaped as Wanted, and −20/+20/−50 jumps show buying or selling.
5. **20 colors on phones.** Which ones blur together at night?

## Questions to ask after each game

- When did you *know* who was Wanted, versus guess? Did it ever feel automatic?
- Did you change color? Why then? Did anyone's swap throw you off?
- Did you ever lie? Did lying ever work?
- Did you buy or sell information? Was 20 / 50 worth it?
- Could you tell all the colors apart on your phone? Which ones blurred together?
- Was any phase too long or too short?
- Would you play again right now?

## After the session

```powershell
pnpm stats                                   # real games: accuracy by stage, escapes, scores, buying, swaps, length
pnpm sim -- --players 8 --swaps 3            # simulator, same settings, to compare
pnpm sweep -- --players 8 --swaps 1,2,3      # grid over swaps x decoys
```
