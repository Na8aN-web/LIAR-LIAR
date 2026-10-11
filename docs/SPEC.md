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
| Color swaps | Host setting: Auto (about 1 per 4 posters, rounded up: 2 at 6–8 players, 3 at 9–12, 4 at 13–15) or 0–5 per player per game. Default Auto |
| Posters per game | One per player |
| Poster order | Host setting: "Random, repeats allowed" (default) or "Everyone once" |
| Decoys per inspect | 3 (playtest default; tunable 1–4) |
| Rounds per poster | 1 |
| Inspects per player per round | Host setting. Default 3 for 6–11 players, 4 for 12–15. Range 2–5 |
| Starting points | 100 |
| Base bounty pot | 100 per poster |
| Escape bonus | 50, only if nobody votes for the Wanted player. Held privately and paid at the end of the game |
| Buy someone's inspect | 20 points, paid to the seller |
| Buy an extra inspect | 50 points, added to the next poster's pot |
| Purchase cap | 3 per round, any mix |
| Round length | About 3 minutes |
| Winner | Most points after the last poster |

---

## 3. Rules

### 3.1 Setup and colors
- In the lobby, each player customizes their scarecrow's **colored item** (poncho, cloak or bandana) and picks its starting color from the palette.
- Every color can only be held by one player at a time. The color picker greys out taken colors.
- In game, a player sees their own color. Everyone else is a dark silhouette with a name.

**Changing color (color swaps)**
- Each player may change their own color a limited number of times per game. **Host setting: "Color swaps per player", Auto or 0–5, default Auto.** Auto scales with game length: about 1 swap per 4 posters, rounded up (3 at 10 players, 4 at 15). A number overrides it. 0 turns the feature off.
- **When:** only between posters, during the Payout phase. Never during Investigation or Vote, so the Wanted player can't dodge the poster. There is no swap after the final poster.
- **What to:** the server assigns a **random free color** (one in the palette that no player currently holds). Colors stay unique at all times. Requests are handled one at a time, so two swaps can never land on the same color.
- **No free-color list is shown to anyone.** Knowing which colors left or joined the free pool would reveal who swapped (e.g. "Red is free now, so Bob changed").
- **Who decides:** only the player themselves decides *whether* to swap. Nobody can change another player's color.
- **One swap per payout, and it's final.** The button asks for confirmation first ("Spend 1 of your 3 swaps?"). There is no undo: a take-back would need extra rules and could reveal that someone took your old color.
- **Announcement:** at the start of the next poster, everyone sees a public count only, e.g. "2 players changed color." Never who. If nobody swapped, nothing is shown.
- The swapping player sees their new color immediately, with a remaining-swaps counter.
- **Wanted selection:** the next poster is built after swaps are applied, so the poster always shows the Wanted player's current color.
- Disconnected players can't swap.
- The point: knowledge builds up over the game without everyone's color becoming known for certain by mid-game.

### 3.2 Posters and the Wanted player
- There is one poster per player. **Poster order is a host setting:**
  - **Random, repeats allowed (default):** each poster picks a random player. Someone can be Wanted more than once, so the late game can't be solved by elimination.
  - **Everyone once:** the server shuffles all players into a random order and poster *n* targets player *n*. Players who voted correctly on earlier posters can rule those players out, which makes late posters much easier.
- The poster shows only the Wanted player's color at the start of that poster, e.g. "Red".
- The Wanted player is told privately that they are Wanted. Nobody else is.
- **The Wanted player is never publicly revealed** during the game. Players who voted correctly are told they were right, so they learn who it was. This is intended: it's a reward that lets them rule that player out of later posters.

### 3.3 Inspecting
- On an inspect, a player picks a target. The server returns **the target's current real color plus decoys, in random order.** The playtest default is **3 decoys (4 colors shown)**, a tunable rule (1–4). The original design used 2; the simulator showed 2 lets mid and late posters be solved too easily.
- Decoys are drawn fresh and at random on every inspect, from the current colors of other players in the lobby, excluding:
  - the target's real color, and
  - the inspector's own color (they'd know it's a decoy).
- Inspecting the same player again gives new decoys, so the repeated color reveals the real one (as long as they haven't changed color in between).
- A player can inspect anyone except themselves, any number of times, within their inspect limit.
- **Inspects are public, results are private.** The public log shows "Poster 3: Ada inspected Lots". Only Ada sees the colors.
- **Every log entry is labeled with the poster it happened on.** Old results keep showing the color the target had at that time.
- Inspects are used one at a time. A player sees each result before choosing the next.
- Inspect results from the server are always true at the time of the inspect. Players can only be lied to by other players.

### 3.4 Buying
Purchases happen during the investigation phase. **All purchases are private.** Nobody else sees them in the log.

**Buy someone's inspect (20 points)**
1. The buyer picks an entry in the public log, e.g. "Poster 2: Femi inspected Tolu", and sends Femi an offer.
2. Femi gets a notification: "Ada wants to buy your information for 20 points." Yes or no. No response before the phase ends counts as no.
3. If yes, 20 points move from Ada to Femi, and Ada sees the exact 3 colors Femi got for that inspect. The server sends the stored result, so Femi can't change it.
4. If no, nothing happens and no points move.
- Buying results from earlier posters stays allowed. The buyer sees the poster number, so they can judge how stale it might be.

**Buy an extra inspect (50 points)**
- Gives one more inspect this round on top of the normal limit.
- The 50 points are added to the **next** poster's pot. A bigger pot tells everyone extra inspects were bought, but not by whom.
- On the final poster there's no next pot, so the 50 goes into the current pot.

**Limits**
- Up to 3 purchases per round, in any mix of offers and extra inspects.
- Accepted offers and extra inspects count toward the cap. A player can't have more pending offers than their remaining cap.
- **No debt.** Scores can't go below 0. If a player can't afford something, the button is disabled.

### 3.5 Voting
- Every player votes once, secretly, for who they think is Wanted.
- The Wanted player also votes, so they don't stand out, but their vote doesn't count.
- Nobody can vote for themselves.
- Not voting before the timer ends counts as no vote.

### 3.6 Payout and scoring
- The pot (100 plus any extra-inspect money from the previous poster) is split equally among correct voters. Round down; leftover points are lost.
- If **nobody** votes for the Wanted player, they earn the 50-point escape bonus, the pot is lost, and the game moves on.
- **Escape bonuses are held until the end of the game.** Paying them immediately would put a lone +50 next to the Wanted player on the public scoreboard and reveal them. During the game only the earner is told (privately, on their payout screen); the bonus is not in their spendable score, so it can't be used for buying. At the end, held bonuses are added to final scores before the winner is decided, and the replay lists them.
- If at least one person votes for them, the Wanted player gets nothing.
- After payout, each player is privately told whether their vote was right.
- A big, visible scoreboard updates after every poster.
- The payout phase is also the window for color swaps (3.1).

### 3.7 End of game
- After the last poster, held escape bonuses are paid, then a replay screen shows every player's escape bonuses, color history (starting color, plus each swap and which poster it happened after), who was Wanted each round, and the full inspect log, so everyone sees who lied.
- **Tie-breaker:** among tied players, whoever had the most correct votes wins. If still tied, they share the win.

### 3.8 Round flow
1. **Poster up** (5s): show the Wanted color, the pot size, and the public color-change count if anyone swapped.
2. **Investigation** (default 120s): inspects, chat and buying all happen at once.
3. **Vote** (default 20s).
4. **Payout** (10s): pay out, update the scoreboard, tell each player if they were right. Players may change color.
5. Next poster, or the end-of-game replay.

Phase timers are host settings.

### 3.9 Scarecrow reactions
Scarecrows sit around the campfire. Each gets one of three sitting idles at random at game start and keeps it all game. Reactions are animations only. They never change scores or rules.

- **When someone inspects a player**, that scarecrow slowly turns its head toward the inspector, then back. The inspect log is public, so this reveals nothing new.
- **After each poster (payout):**
  - Correct voters play **victory**.
  - Wrong voters and non-voters play one of two **despair** animations, picked at random.
  - Then each scarecrow blends back to sitting.
- **The Wanted player always plays despair to everyone else**, whether they were caught or escaped. Only on the Wanted player's own screen does their scarecrow show the true result: victory if they escaped, despair if caught. So in everyone else's view a reaction only repeats the public payout: cheer = got paid, despair = didn't.
- **End of game:** the winner (or every tied winner) plays victory; everyone else plays despair.
- **The server decides every reaction**, including which despair variant, and builds the reaction map per viewer. The Wanted player's true result is only ever put in their own view. It is never sent to anyone else and hidden on the client.

---

## 4. Lobby and joining

- The host creates a room and gets a short **room code** (5 characters, no look-alikes like O/0 or I/1) plus an **invite link** that contains the code.
- Players join by code or link. Opening an invite link goes straight to the lobby.
- No account needed: a player enters a display name and plays as a guest.
- Min 6 players to start, max 15. The host starts the game.
- **Host settings:** inspects per round (2–5, default based on lobby size), color swaps per player (Auto or 0–5, default Auto), poster order (default random with repeats), phase timers. Balance numbers (bounty, escape bonus, prices, purchase cap, decoys) are host-tunable under "Playtest tuning".
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

- The server is authoritative for everything: colors, the Wanted order, inspect results, purchases, votes, swaps and scores.
- **Never broadcast the full game state.** Build a per-player view for each client.
- Clients send intents ("inspect player X", "vote for Y", "change my color") and the server validates every one: whose turn, enough inspects left, enough points, under the purchase cap, valid target, swap window, free color, swaps left.
- Decoys are generated on the server.

| Data | Who receives it |
| --- | --- |
| Own color and own color history | That player |
| Other players' colors | Nobody, until the end-of-game replay |
| Which colors are free during a game | Nobody (the server assigns swaps) |
| Who changed color | Nobody, until the end-of-game replay |
| How many players changed color | Everyone, at the start of the next poster |
| Current poster color and pot | Everyone |
| Who the Wanted player is | Only the Wanted player |
| Public inspect log (who inspected whom, which poster) | Everyone |
| Inspect results | The inspector, and anyone who bought that result |
| Offers | Buyer and seller only |
| Votes | Nobody, until the end-of-game replay |
| Whether a vote was correct | That voter |
| Scores | Everyone, after each poster |
| Payout reactions (3.9) | Everyone, but the Wanted player always shows despair; their true reaction goes only to them |
| End-of-game reactions | Everyone (winners are public by then) |

### 5.3 Reconnects (plan for this from day one)
Mobile players will lose connection mid-round. Dropping them out of the game would ruin the session.

- On join, the server issues a **session token**. The client stores it in localStorage, wrapped in try/catch.
- On reconnect, the client sends the token and the server restores the player to their seat.
- The server sends a full resync of that player's view: phase, time left, poster, log, their own results, purchases, color and swaps, scores.
- A disconnected player's seat is held for 90 seconds. After that, they're marked away but still counted in the game. If they're Wanted, the round continues as normal.
- Disconnected players simply don't act. A missed vote counts as no vote. A pending offer to them expires as no. They can't change color.

### 5.4 Bots for testing
Build simple bots early so a full 10-player game can be tested by one person: they join, inspect at random, sometimes post true or false claims in chat, and vote at random or for the most-accused player. Dev builds only.

Bots change color based only on their own view: they estimate "exposure" (distinct players who inspected them since their last swap, plus chat mentions of their current color) and request a swap (the server assigns the color) once it passes a threshold. When the public count says players changed color, they trust older results less than newer ones.

---

## 6. Look and feel

- **Style:** 3D, low-poly, so it loads fast and runs on cheap phones.
- **Setting:** the Wild West at night. A ghost town lit by lanterns, with dust and fog. Other players appear as dark, half-visible silhouettes.
- **Characters:** faceless scarecrows.
- **Colored item:** each scarecrow wears one customizable item (poncho, cloak or bandana) that carries the player's color.
- **Crows and vultures:** small crows and vultures wander and occasionally land on a scarecrow's shoulder or hat. This is purely for atmosphere. Where they perch must be random and must never hint at who is Wanted or anyone's color.
- **Main menu:** dark and eerie. Options: Play, How to Play, Settings, Profile, Credits. No Quit button, since a browser game can't close its own tab.
  - Desktop: menu on the left, a Wanted poster on the right.
  - Mobile: the Wanted poster fills the background behind the menu.

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

- **Game UI** (poster, inspect results, log, chat, voting, buying, color swaps, scoreboard) is an HTML overlay on top of the 3D canvas.
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
- A 15-player game has 15 posters, about 45 minutes. Does it need a shorter mode?
- Balance of the 100 pot, 50 escape bonus, buy prices, and swaps per player.
- Text chat only, or voice too.
- Whether viewers can join games.
