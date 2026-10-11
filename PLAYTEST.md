# Playtest checklist (Windows)

You run the game on your laptop. Cloudflare Tunnel gives it a public `https://….trycloudflare.com` link that
your friends open on their phones. No account or domain needed.

`pnpm playtest` always runs the real production game: no bots in normal rooms, no skip button, no `/dev`
pages, 6+ players to start. It sets everything up for the tunnel by itself (each player's real IP for the
rate limits, the tunnel link allowed to connect), prints the link and a QR code, and restarts anything that
crashes.

---

## One-time setup

1. Install Cloudflare Tunnel in **PowerShell**:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. Close and reopen PowerShell, then:
   ```powershell
   cd C:\Users\obliv\projects\wanted-true-colors
   pnpm install
   ```

---

## The night before

- [ ] **Commit and push** what you have, so you can get back to it:
  ```powershell
  git add -A
  git commit -m "Playtest build"
  git push
  ```
- [ ] **Start it:**
  ```powershell
  pnpm playtest
  ```
  After about a minute you'll see:
  ```
  ==========================================================
    SHARE THIS LINK:   https://some-random-words.trycloudflare.com
  ==========================================================
  (QR code)
    ✓ 20:41:07 The link works from the internet. Send it!
  ```
- [ ] **Phone test over mobile data:** turn Wi-Fi **off** on your phone, scan the QR code, and check the home
  page loads.
- [ ] **Play a bot game through it:** on the phone, open **How to Play → Practice with bots** and play it to the
  end (3 posters, up to 15 minutes). Check sound, the ledger, buying, accusing, and the end screen.
- [ ] **Dress rehearsal (optional, 8 minutes):** in a **second** PowerShell window, with the link from the banner:
  ```powershell
  pnpm playtest:check -- https://some-random-words.trycloudflare.com
  ```
  Ten simulated players play a full game through the tunnel; two of them drop and come back mid-round. It
  should end with `PASS: ready for real players.` This game is left out of your stats.
- [ ] Press **Ctrl+C** in the first window to stop.

---

## On the day

### Laptop

- [ ] **Plugged in.**
- [ ] **Sleep off:** Settings → System → Power & battery → **Screen, sleep & hibernate timeouts** →
  **"When plugged in, put my device to sleep after"** → **Never**.
  (Or in PowerShell: `powercfg /change standby-timeout-ac 0`)
- [ ] **Lid:** if you'll close it, Control Panel → Hardware and Sound → Power Options →
  **Choose what closing the lid does** → *When I close the lid* (Plugged in) → **Do nothing** → Save changes.
- [ ] **No surprise restarts:** Settings → Windows Update → **Pause updates** (1 week).
- [ ] Close any `pnpm dev` that's running (it uses the same ports).

### Start

- [ ] ```powershell
  cd C:\Users\obliv\projects\wanted-true-colors
  pnpm playtest
  ```
- [ ] Wait for **"✓ The link works from the internet. Send it!"**
- [ ] Open the link on your own phone or laptop, **Play → Create room**, then use **Invite** to copy the room
  link. **Send the room link** (Discord / WhatsApp). Friends can also open the main link and type the code.
- [ ] Leave the PowerShell window open and **don't click inside it**: selecting text in a PowerShell window
  pauses the program in it. If its title starts with "Select", press **Esc**.

### If something breaks

- **A process crashes:** it restarts by itself in a few seconds.
  - Web app or game server: same link. A game-server restart ends any game in progress; everyone reopens the
    link and you start a new room.
  - Tunnel: a **new link** and QR code are printed with **NEW LINK** above them. Send it to everyone; the old
    one stops working.
- **"No tunnel tool found":** reopen PowerShell, or run `winget install --id Cloudflare.cloudflared` again.
- **"Port already in use":** a leftover `pnpm dev` or old playtest is running. Close it (or restart the PC).
- **Someone's phone lost signal:** they just reopen the same link on the same phone. They get their seat back,
  with their score and searches.
- **Cloudflare blocked:** use ngrok: `winget install --id Ngrok.Ngrok`, sign up free at ngrok.com,
  `ngrok config add-authtoken <token>`, then `pnpm playtest -- --tunnel ngrok`.
- Everything the server printed is also saved in `apps/server/logs/playtest-<date>.log`.

---

## Recording with OBS

1. **Tell everyone you're recording** before you start.
2. OBS → Sources → **+** → **Display Capture** (your screen, where you play) and keep **Desktop Audio** (game
   sounds and Discord voices) and **Mic/Aux** on.
3. Settings → Output → **Recording Format: mkv** (if OBS or the laptop crashes, the recording survives).
   Afterwards: File → **Remux Recordings** to get an mp4.
4. Optional: ask one friend to screen-record their phone (iPhone: Control Centre → Screen Recording; Android:
   quick settings → Screen recorder). Phones show you what *they* see.
5. Press **Start Recording** before game 1. Check the file is growing after a minute.

---

## Session plan (about 90 minutes)

| | Game | How |
| --- | --- | --- |
| 1 | **No explanations, text chat only** | Send the link, say nothing about the rules. People can use How to Play if they want. All talk happens in the in-game chat. This shows whether the game teaches itself. |
| 2 | **Discord voice** | Everyone joins a Discord voice channel. Same settings. This shows how lying and accusing feel out loud. |
| 3 | **Optional** | If people want more: change **one** setting (lobby → Game settings), or just play again. |

After each game, the end screen shows a short **feedback telegram** (5 optional questions). Ask people to fill
it in before pressing "Play again". Keep 5 minutes between games for chat.

---

## What to watch for and write down

Keep a notepad open. Write the **time** next to each note, so you can find it in the recording.

- **Confusion:** any "wait, what do I do?", wrong taps, people asking the chat how something works. Which screen?
- **The first search:** how long people sit before searching once a poster appears. (Also in `pnpm stats`.)
- **Lying:** does anyone lie about their color? Does it work? Does anyone say "there's no point lying"?
- **Buying:** do people buy other players' findings or extra looks, or ignore the shop?
- **Color changes:** do people use them? Does "2 players changed color" make anyone doubt what they knew?
- **Accusing:** do people feel they *know* who's Wanted, or guess? Too easy late in the game?
- **Colors on phones:** which colors get mixed up at night?
- **Pace:** groans at a timer (too short), or people waiting around (too long)?
- **Fun moments:** laughs, shouting, "no way!", who got caught or escaped.
- **Tech:** anyone dropping, a phone getting hot, slow loading, sound problems.
- **Drop-off:** anyone leaving early, and when.

---

## After

- [ ] **Ctrl+C** in the PowerShell window. Stop OBS recording.
- [ ] See what happened:
  ```powershell
  pnpm stats
  pnpm feedback
  ```
  - `pnpm stats`: each game's accusations per round (right / wrong / no vote), and per player (numbered, never
    named): time to first search, searches, findings bought, extra looks, color changes, drops and reconnects,
    whether they finished, and whether they finished, skipped or never opened How to Play. Then the totals across
    all games and the balance report.
  - `pnpm feedback`: every answer to the end-of-game questions, by game, with a "would play again" tally.
- [ ] The raw files are in `apps/server/logs/`: `games.jsonl` (stats), `feedback.jsonl` (answers),
  `playtest-<date>.log` (server output). They're never served to the web and aren't committed to git.
- [ ] Turn sleep back on, unpause Windows Update.

Older test games from development were moved to `apps/server/logs/archive/`, so `pnpm stats` shows only this
playtest. For a clean sheet next time, move `games.jsonl` and `feedback.jsonl` there too.

---

## Other options

| Command | What it does |
| --- | --- |
| `pnpm playtest -- --skip-build` | Starts faster by reusing the last build (after a previous `pnpm playtest`) |
| `pnpm playtest -- --no-tunnel` | Everything local on http://localhost:8080, no public link |
| `pnpm playtest -- --tunnel ngrok` | ngrok instead of Cloudflare |
| `pnpm stats -- --all` | Also show bot-only games and `playtest:check` games |

**Same Wi-Fi instead of a tunnel:** `pnpm dev`, then everyone opens `http://<laptop's IP>:3000` (find the IP
with `ipconfig`; allow Node through Windows Firewall when asked). That's the dev build, with bots and the skip
button.

### How it works

`tools/playtest.mjs` builds the web app, then runs the game server (`NODE_ENV=production`, `TRUST_PROXY=1`),
the web app (`next start`), a proxy on port 8080 (`tools/proxy.mjs`: `/socket.io` → game server on :3001,
everything else → web app on :3000) and `cloudflared` pointing at the proxy. Each time the tunnel prints its
URL, it's written to a small allowed-origins file the server re-reads, so a new tunnel URL works at once
without restarting the server.

### Balance questions from the simulator

`pnpm sim` and `pnpm sweep` predict a few things worth checking with people: with the defaults, bots accuse
correctly about 40% / 55% / 65% early / mid / late at 10 players. Does it feel like knowledge builds without
being certain? Does random color assignment on a swap feel fair? Do the scoreboard jumps (+50 for an escape,
±20 / −50 for buying) give too much away? Compare afterwards:

```powershell
pnpm sim -- --players 8 --swaps 3
pnpm sweep -- --players 8 --swaps 1,2,3
```
