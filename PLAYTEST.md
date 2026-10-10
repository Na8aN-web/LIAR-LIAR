# Playtest guide

## Before the session

1. `pnpm dev` on the host PC. Everyone joins on the same Wi-Fi at `http://<host-PC-LAN-IP>:3000`
   (find the IP with `ipconfig`; allow Node through Windows Firewall when asked).
2. Do a solo dry run: create a room, **Fill to 10**, start, play one poster.
3. Clear old stats if you want a clean sheet: delete `apps/server/logs/games.jsonl`.

Remote players need a public deploy. That isn't set up yet.

## Running it

- Aim for 6–10 people. Bots can fill gaps, but tag games that used them when you take notes.
- Play one game on defaults first. Change **one** thing per game after that (lobby → Game settings → Playtest tuning).
- Keep the host's dev "skip" button for emergencies only. It distorts the stats.

## What to watch (the simulator's predictions)

The bot simulator (`pnpm sim`) predicts problems worth confirming with people:

1. **The late game is solved.** Colors never change, so knowledge piles up. Bots are right ~100% of the time
   from mid-game on, in both poster modes. Watch for: by poster 5+, does everyone just *know*? Does chat go quiet?
2. **Early posters may be too easy too.** Bots get ~85% right on the first third. People will be noisier, but check it.
3. **The scoreboard leaks.** A +50 to one player means they escaped as Wanted, and −20/+20/−50 jumps show who bought or sold.
   Ask: did anyone notice or use it?

## Questions to ask after each game

- When did you *know* who was Wanted, versus guess? Which poster did it start feeling automatic?
- Did you ever lie? Did lying ever work?
- Did you buy or sell information? Was 20 / 50 worth it?
- Could you tell all 15 colors apart on your phone? Which ones blurred together?
- Was any phase too long or too short?
- Would you play again right now?

## After the session

```sh
pnpm stats      # per-config summary of the real games: accuracy by game stage, escapes, scores, buying, length
pnpm sim -- --players 8 --decoys 3     # compare against the simulator for the same settings
```

Tuning knobs (lobby → Game settings): inspects per round, poster order, phase timers, and under
**Playtest tuning**: starting points, bounty, escape bonus, buy prices, purchase cap, decoys per inspect.
