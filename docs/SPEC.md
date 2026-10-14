# Wanted: True Colors — Build Spec

Working name: **Wanted: True Colors**. This file is the single source of truth for the game's rules and how to build it. Read it fully before writing game logic, and follow it over any assumptions.

---

## 1. What the game is

A free-for-all, real-time multiplayer browser social deduction game for **6–15 players**.

**The game is fully 3D** (see section 6). Every player is a scarecrow wearing one colored item, standing in a Wild West ghost town at night. To everyone else, they appear as a dark silhouette. Each round a Wanted poster shows one color, and players race to work out who is wearing it. There are **no teams and nobody is eliminated**. The bounty is split among everyone who guesses right, so players lie out of greed: the fewer people who guess right, the bigger your share.

---

## 2. Key numbers

| Setting | Value |
| --- | --- |
| Players | 6–15 |
| Clothing | 1 colored item per player, every color unique at all times |
| Palette | 20 colors |
| Posters per game | Host setting: 3–20, default 10, independent of the number of players. The lobby shows the estimated length |
| Poster order | A random player each poster; repeats allowed (never the same player twice in a row) |
| Decoys per inspect | 3 (playtest default; tunable 1–4) |
| Rounds per poster | 1 |
| Inspects per player per round | Host setting. Default 3 for 6–11 players, 4 for 12–15. Range 2–5 |
| Starting points | 100 |
| Base bounty pot | 100 per poster |
| Escape bonus | $100, only if nobody votes for the Wanted player. Held privately and paid at the end of the game |
| Buy someone's findings | $20, paid to the seller |
| Buy extra looks | $50 for 2 more searches, added to the next poster's pot |
| See everyone's worth | $20, a private snapshot of everyone's money. Once per poster, added to the next pot |
| Purchase cap | 3 per round, any mix of findings and extra looks (not worth snapshots or dirty tricks) |
| Dirty trick: Change color | $25, during a payout. Limit per game: host setting (Auto = one per payout) |
| Dirty trick: Cover your tracks | $50, during a payout, protects you for the next poster |
| Dirty tricks per payout | 1 per player, secret, money added to the next pot |
| Round length | About 3 minutes |
| Winner | Most points after the last poster |

---

## 3. Rules

### 3.1 Setup and colors
- In the lobby, each player customizes their scarecrow's **colored item** (poncho, cloak or bandana) and picks its starting color from the palette.
- Every color can only be held by one player at a time. The color picker greys out taken colors.
- In game, a player sees their own color. Everyone else is a dark silhouette with a name.

Colors can change during the game through the **Change color** dirty trick (3.7).

### 3.2 Posters and the Wanted player
- **Number of posters is a host setting: 3–20, default 10**, independent of the number of players. The lobby shows the estimated game length from the posters and the phase timers.
- Each poster picks a **random player**. Someone can be Wanted more than once (never twice in a row, and nobody far more often than the rest), so the late game can't be solved by elimination. There is no "everyone once" mode.
- The poster shows only the Wanted player's color at the start of that poster, e.g. "Red".
- The Wanted player is told privately that they are Wanted. Nobody else is.
- **The Wanted player is never publicly revealed** during the game. Players who voted correctly are told they were right, so they learn who it was. Since posters repeat, that never rules anyone out.

### 3.3 Inspecting
- On an inspect, a player picks a target. The server returns **the target's current real color plus decoys, in random order.** The playtest default is **3 decoys (4 colors shown)**, a tunable rule (1–4). The original design used 2; the simulator showed 2 lets mid and late posters be solved too easily.
- Decoys are drawn fresh and at random on every inspect, from the current colors of other players in the lobby, excluding:
  - the target's real color, and
  - the inspector's own color (they'd know it's a decoy).
- **Searching the same player again narrows it down by one:** of the colors still possible after that searcher's earlier searches, one fewer survives each time, and the rest are fresh decoys. With 3 decoys: 4 possible after the first search, 3 after the second, 2 after the third, then the real color alone. Each searcher's narrowing is their own. If the target changes color, it starts over.
- **Covered tracks (3.7):** while a player is covered, searches of them use a **stand-in color** in place of their real one: the color another player is wearing, picked once per poster. The stand-in repeats and narrows exactly like a real color, with fresh decoys, and the result never contains the covered player's real color. If the covered player is Wanted, the stand-in is never the poster color. The stand-in's own wearer would see their own color and know it's fake, so they get a different stand-in. Nothing in the result shows it's covered.
- A player can inspect anyone except themselves, any number of times, within their inspect limit.
- **Inspects are public, results are private.** The public log shows "Poster 3: Ada inspected Lots". Only Ada sees the colors.
- **Every log entry is labeled with the poster it happened on.** Old results keep showing the color the target had at that time.
- Inspects are used one at a time. A player sees each result before choosing the next.
- Search results are always true at the time of the search, **unless the target covered their tracks** (3.7). The verdict tags read "Looks clear" and "Looks possible", never "certain", for that reason. How to Play says: "A player who covered their tracks can fool your searches."
- **Eye icons:** a plain eye over a scarecrow shows they've been searched this poster. No numbers anywhere (the vote panel has none either), so players reason instead of following the crowd.

### 3.4 Buying
Purchases happen during the investigation phase. **All purchases are private.** Nobody else sees them in the log.

**Buy someone's findings ($20)**
1. The buyer picks an entry in the public log, e.g. "Poster 2: Femi inspected Tolu", and sends Femi an offer.
2. Femi gets a notification: "Ada wants to buy your information for 20 points." Yes or no. No response before the phase ends counts as no.
3. If yes, 20 points move from Ada to Femi, and Ada sees the exact 3 colors Femi got for that inspect. The server sends the stored result, so Femi can't change it.
4. If no, nothing happens and no points move.
- Buying results from earlier posters stays allowed. The buyer sees the poster number, so they can judge how stale it might be.
- Bought findings show exactly what the searcher saw, including a covered player's stand-in.

**Buy extra looks ($50)**
- Gives 2 more searches this round on top of the normal limit (so a search costs $25, more than buying someone's findings).
- The money is added to the **next** poster's pot. A bigger pot tells everyone something was bought, but not what or by whom.
- On the final poster there's no next pot, so it goes into the current pot.

**See everyone's worth ($20)**
- Everyone's money is hidden during the game (3.6). This buys a private snapshot of everyone's money as of the last payout, ranked. Once per poster.
- Nobody is told. The money goes to the next pot like other purchases. It doesn't count toward the purchase cap.

**Limits**
- Up to 3 purchases per round, in any mix of findings and extra looks.
- Accepted offers and extra looks count toward the cap. A player can't have more pending offers than their remaining cap.
- **No debt.** Scores can't go below 0. If a player can't afford something, the button is disabled.

### 3.5 Voting
- Every player votes once, secretly, for who they think is Wanted.
- The Wanted player also votes, so they don't stand out, but their vote doesn't count.
- Nobody can vote for themselves.
- Not voting before the timer ends counts as no vote.

### 3.6 Payout and scoring
- The pot (100 plus any extra-inspect money from the previous poster) is split equally among correct voters. Round down; leftover points are lost.
- If **nobody** votes for the Wanted player, they earn the $100 escape bonus, the pot is lost, and the game moves on.
- **Escape bonuses are held until the end of the game.** Paying them immediately would show up in a worth snapshot and reveal the Wanted player. During the game only the earner is told (privately, on their payout screen); the bonus is not in their spendable score, so it can't be used for buying. At the end, held bonuses are added to final scores before the winner is decided, and the replay lists them.
- If at least one person votes for them, the Wanted player gets nothing.
- After payout, each player is privately told whether their vote was right.
- **Hidden wealth:** nobody sees anyone else's total or ranking during the game. The payout screen shows what each correct voter earned from that bounty (who was paid and how much), never totals. The vote panel says "Fewer correct guesses = bigger cut." A worth snapshot (3.4) is the only way to see totals mid-game. The end screen reveals everything.
- The payout phase (15s) is also the window for dirty tricks (3.7).

### 3.7 Dirty tricks
During a payout (not after the final poster), the payout screen has a big **USE A DIRTY TRICK** button. It opens a panel with two tricks. **One trick per player per payout.** Tricks are **secret** (nobody is told, no announcement or count), the money goes to the **next** poster's pot, and they don't count toward the purchase cap. Prices are host-tunable.

**Change color ($25)**
- The server assigns a **random free color** (one no player holds). Colors stay unique at all times. Requests are handled one at a time.
- **No free-color list is shown to anyone**, since it would reveal who changed.
- Per-game limit: host setting "Color changes per player", Auto (one per payout) or 0–5.
- Final, no undo. The player sees their new color immediately.
- The next poster is built after color changes, so the poster always shows the Wanted player's current color.

**Cover your tracks ($50)**
- For the next poster, searches of this player show a stand-in color instead of their real one (see 3.3). It works whether or not they turn out to be Wanted, and nobody knows who is covered.
- If they're Wanted, the stand-in is never the poster color, so searchers are steered away from them.
- Covering doesn't change the player's color, the poster, or anyone's votes.

Disconnected players can't use tricks.

### 3.8 End of game
- After the last poster, held escape bonuses are paid, then a replay screen shows everyone's final money and ranking, escape bonuses, color history (starting color, plus each change and which poster it happened after), who was Wanted each round, and the full search log, so everyone sees who lied.
- **Tie-breaker:** among tied players, whoever had the most correct votes wins. If still tied, they share the win.

### 3.9 Round flow
1. **Poster up** (5s): show the Wanted color and the pot size.
2. **Investigation** (default 120s): searches, chat and buying all happen at once.
3. **Vote** (default 20s).
4. **Payout** (15s): pay out, show each correct voter's earnings from this bounty, tell each player if they were right. Players may use a dirty trick.
5. Next poster, or the end-of-game replay.

Phase timers are host settings.

### 3.10 Scarecrow reactions
Scarecrows sit around the campfire. Each gets one of three sitting idles at random at game start and keeps it all game. Reactions are animations only. They never change scores or rules.

- **When someone inspects a player**, that scarecrow slowly turns its head toward the inspector, then back. The inspect log is public, so this reveals nothing new.
- **After each poster (payout):**
  - Correct voters play **victory**.
  - Wrong voters and non-voters play one of two **despair** animations, picked at random.
  - Then each scarecrow blends back to sitting.
- **The Wanted player always plays despair to everyone else**, whether they were caught or escaped. Only on the Wanted player's own screen does their scarecrow show the true result: victory if they escaped, despair if caught. So in everyone else's view a reaction only repeats the public payout: cheer = got paid, despair = didn't.
- **End of game:** the winner (or every tied winner) plays victory; everyone else plays despair.
- **The server decides every reaction**, including which despair variant, and builds the reaction map per viewer. The Wanted player's true result is only ever put in their own view. It is never sent to anyone else and hidden on the client.

### 3.11 First-game tutorial
A player's first game teaches the game as it goes. Features unlock in stages on that player's screen only; the game runs normally for everyone else.
1. **Poster 1:** search, chat and vote only. Prompts: "This is the outlaw's color. Someone around the fire is wearing it." → "Tap a scarecrow to search them." → after the first search, "One of these is their real color. Search again, and the real one keeps showing up." → at the vote, "Pick who you think wears [color]." → at the payout, "Everyone who guessed right splits the bounty."
2. **Poster 2:** the Searches and Notebook tabs. "Everyone sees who you search, but not what you found.", a chat prompt about lying for a bigger cut, "Your Notebook keeps track of everything you've found."
3. **Poster 3:** buying findings ($20, the seller can refuse), extra looks, and the worth snapshot ("Everyone's money is hidden. Pay $20 to peek at it.").
4. **The payout after poster 3:** dirty tricks.

Shorter games squeeze the stages so everything is unlocked by the final payout (schedule in `packages/shared/src/tutorial.ts`, tested). Prompts are one line with an arrow, telegram style, never block play, close on the matching action or after a timeout, and never cover the timer, the Accuse button or an offer. In the first game only urgent telegrams pop up; the rest are batched into a "While you were busy" note at the payout. The first prompt has "Skip tutorial". Settings has "Show everything" to turn it off. Completion is stored per browser (a key hook allows a per-player key for an embedded host). Practice games always run it. The server records how far each player got and their first search time for the admin funnel.

---

## 4. Lobby and joining

- The host creates a room and gets a short **room code** (5 characters, no look-alikes like O/0 or I/1) plus an **invite link** that contains the code.
- Players join by code or link. Opening an invite link goes straight to the lobby.
- No account needed: a player enters a display name and plays as a guest.
- Min 6 players to start, max 15. The host starts the game.
- **Host settings:** posters (3–20, default 10, with the estimated length shown), searches per round (2–5, default based on lobby size), color changes per player (Auto or 0–5, default Auto), phase timers. Fake colors per search (decoys) sits with the main settings. Money numbers (starting money, bounty, escape reward, prices including tricks and the worth snapshot, purchase cap) are host-tunable under "Price settings".
- If the host leaves, host passes to the longest-connected player.

---

## 5. Architecture

### 5.1 Stack
- **Frontend:** Next.js + React + TypeScript. 3D with React Three Fiber (Three.js) and drei.
- **Realtime server:** Node + TypeScript + Socket.io. Colyseus is an acceptable alternative if room and state syncing are easier with it.
- **Shared types:** one shared package for event names and payload types used by both client and server.
- Game state lives in server memory per room for v1. No database needed until accounts.

### 5.2 The server holds all secrets (most important rule)
This is a deduction game. If a secret ever reaches a client, players will find it in dev tools and the game is broken.

- The server is authoritative for everything: colors, the Wanted order, inspect results, purchases, votes, color changes, covered tracks and money.
- **Never broadcast the full game state.** Build a per-player view for each client.
- Clients send intents ("inspect player X", "vote for Y", "change my color") and the server validates every one: whose turn, enough searches left, enough money, under the purchase cap, valid target, trick window (one per payout), free color, color changes left.
- Decoys are generated on the server.
- **Lobby colors:** the color a player gets on joining is only a suggestion and isn't reserved, so the lobby's free-color list can't reveal it. Picked colors are reserved; clashing suggestions are re-rolled at game start. The free-color list is lobby-only and rate limited.
- Abuse limits, room locking, removing players, one seat per browser, connection checks and production hardening are described in [SECURITY.md](../SECURITY.md).

| Data | Who receives it |
| --- | --- |
| Own color and own color history | That player |
| Other players' colors | Nobody, until the end-of-game replay |
| Which colors are free during a game | Nobody (the server assigns color changes) |
| Who changed color or covered their tracks | Nobody, until the end-of-game replay |
| A covered player's stand-in | Only appears inside search results; never marked as such |
| Current poster color and pot | Everyone |
| Who the Wanted player is | Only the Wanted player |
| Public inspect log (who inspected whom, which poster) | Everyone |
| Inspect results | The inspector, and anyone who bought that result |
| Offers | Buyer and seller only |
| Votes | Nobody, until the end-of-game replay |
| Whether a vote was correct | That voter |
| Own money | That player |
| Others' money and rankings | Nobody during the game, except a bought worth snapshot (as of the last payout) to its buyer; everyone at the end |
| Each bounty's earnings (who was paid, how much) | Everyone, at the payout |
| Who has been searched this poster | Everyone (a plain eye, no count) |
| Garment type, hat and head detail | Everyone (public, purely visual) |
| Payout reactions (3.10) | Everyone, but the Wanted player always shows despair; their true reaction goes only to them |
| End-of-game reactions | Everyone (winners are public by then) |

### 5.3 Reconnects (plan for this from day one)
Mobile players will lose connection mid-round. Dropping them out of the game would ruin the session.

- On join, the server issues a **session token**. The client stores it in localStorage, wrapped in try/catch.
- On reconnect, the client sends the token and the server restores the player to their seat.
- The server sends a full resync of that player's view: phase, time left, poster, log, their own results, purchases, color and color changes, own money, worth snapshot.
- A disconnected player's seat is held for 90 seconds. After that, they're marked away but still counted in the game. If they're Wanted, the round continues as normal.
- Disconnected players simply don't act. A missed vote counts as no vote. A pending offer to them expires as no. They can't change color.

### 5.4 Bots for testing
Build simple bots early so a full 10-player game can be tested by one person: they join, inspect at random, sometimes post true or false claims in chat, and vote at random or for the most-accused player. Dev builds only.

Bots use dirty tricks based only on their own view: they estimate "exposure" (distinct players who searched them since their last change, plus chat mentions of their current color) and, once it passes a threshold and they can afford it, change color or (with a small chance) cover their tracks. They trust older results less than newer ones.

---

## 6. Look and feel

- **Style:** 3D, low-poly, so it loads fast and runs on cheap phones.
- **Setting:** the Wild West at night. A ghost town lit by a campfire and lanterns, with dust and fog. Other players' colored items appear in one neutral tone (see Colored item).
- **Characters:** faceless scarecrows.
- **Colored item:** each scarecrow wears one customizable item (poncho, cloak or bandana) that carries the player's color. On your screen only your own item shows its color; everyone else's is drawn as dark, undyed jute with a visible weave, so it reads as "unknown" rather than as a color. It's unlit so no light can tint it, and every shade of it stays far from all 20 palette colors and every cosmetic tone (tested). Their real colors never reach your client.
- **Cosmetics (identity):** separate from the colored item, each player picks a hat (none, straw hat, battered cowboy hat, top hat, bowler) and a head detail (none, stitched grin, cross-stitch scar, button eye, eye patch) in the lobby, so scarecrows are easy to tell apart, also for people watching a video. Cosmetics are public and purely visual. They use earthy natural tones only, each measurably far from all 20 palette colors (CIEDE2000 ≥ 16, tested), so they can never be mistaken for a player's color. The neutral item tone follows the same rule. The catalog is data-driven (`packages/shared/src/cosmetics.ts`), so more items can be added later.
- **Crows and vultures:** small crows and vultures wander and occasionally land on a scarecrow's shoulder or hat. This is purely for atmosphere. Where they perch must be random and must never hint at who is Wanted or anyone's color.
- **Main menu:** dark and eerie. Options: Play, How to Play, Settings, Profile, Credits. No Quit button, since a browser game can't close its own tab.
  - Background: the live campfire scene, a few scarecrows sitting around the fire, embers rising, the camera slowly circling.
  - Under the title: "Everyone lies. Find the outlaw." and a room-code box to join directly.
  - Desktop: menu on the left, the Wanted poster nailed to a post on the right.
  - Mobile: the scene sits behind the menu, with the fire above it.
- **How to Play:** a slide walkthrough (the hunt, your color, the poster, searching, talking and lying, buying, voting and the bounty, dirty tricks and winning), one screenshot and a sentence or two each, with Next/Back, swipe, progress dots and Skip. Numbers come from the game rules. It's offered automatically before a player's first game. Screenshots are regenerated with `pnpm howto:screens`.
- **Sound:** UI effects are synthesized in code (wooden knock, telegraph clicks, bell for offers, a crow when you're searched, paper slap and sting for a new poster, clock ticks for the last 10 seconds, a stamp when your vote locks, coins at the payout, victory and despair stings for your own reaction, cloth rustle when you change color, a longer sting at game end). Music and ambience (fire, wind, crows) loop quietly: music plays low in the lobby, quieter while searching, with a tension layer for the last 20 seconds and the vote. Settings has a mute switch and separate music, effects and ambience volumes. Audio starts on the first tap. Sounds only ever reflect what this player's screen already shows.

### 20-color palette
Red, maroon, orange, tan, brown, yellow, olive, lime, green, mint, teal, cyan, sky, blue, lavender, purple, magenta, pink, white, gray.

20 colors leave at least 5 free colors in a full 15-player game, so a swap always has options. The set avoids near-duplicates in a dark night scene (no black, no navy, no two similar greens). It lives in one palette config file (`packages/shared/src/palette.ts`). Test on a phone screen and replace any colors that are hard to tell apart.

---

## 7. Sign-up
- **First visit:** pick a name and play as a guest. No account.
- **After the first match:** offer to save the name and stats by signing up.
- **Accounts are required** only for features added later, like ranked play or cosmetics.
- Accounts are not part of the first build.

---

## 8. Build order
The game is 3D from the first playable build. The 3D scene starts with placeholder models and gets real art once the rules are proven in playtests, so art work isn't thrown away if the rules change.

- **Game UI** (poster, search results, log, chat, voting, buying, dirty tricks, payout earnings) is an HTML overlay on top of the 3D canvas.
- **Keep game logic separate from rendering.** The server and client state shouldn't depend on the 3D scene, so models can be swapped without touching the rules.

1. **Server and lobby:** rooms, codes, invite links, guest names, color picking, host settings, reconnect tokens.
2. **Playable 3D game loop with placeholders:** a React Three Fiber scene with a simple ground, basic lighting and fog, and placeholder figures (e.g. capsules) standing in a circle, one per player, shown as dark silhouettes. Clicking a figure inspects that player. The full game loop runs on top: posters, inspects, public log, chat, voting, payout, scoreboard, end-of-game replay.
3. **Buying:** offers, extra inspects, purchase cap, no-debt rule, pot carry-over.
4. **Bots** for solo testing.
5. **Playtest** with real players and tune the numbers.
6. **Real 3D art:** the ghost town, lanterns and fog, low-poly scarecrow models with the customizable colored item, crows and vultures, the 3D main menu.
7. **Polish:** sound, animations, camera work, mobile performance and layout.
8. **Later:** accounts, profile, stats, cosmetics.

---

## 9. Still open (decide after playtests)
- Final name.
- Whether 20 colors are distinguishable on mobile, or the item also needs a pattern (stripes, stars).
- Default poster count (10, about 25 minutes with default timers).
- Balance of the $100 pot, $100 escape bonus, buy prices, trick prices and the worth snapshot price.
- Text chat only, or voice too.
- Whether viewers can join games.
