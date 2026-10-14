# Wanted: True Colors on CrazyGames

How the game runs on CrazyGames, and a step-by-step checklist for submitting it. Based on their
docs (docs.crazygames.com: Requirements, SDK, FAQ, Payouts) as read in October 2026.

## How it works

- **Same game, same server, same lobbies.** CrazyGames players and website players meet in the
  same public lobbies. Nothing about the website (wantedtruecolors.com) changes.
- **Portal mode** lives at **`/play/crazygames`** (rooms at `/play/crazygames/r/CODE`). Those pages
  have their own headers: only crazygames.com may frame them, and they may load the CrazyGames SDK
  and the ad scripts it brings. Every other page keeps the website's strict headers.
- **The adapter layer** (`apps/web/lib/portal/`) is the only place that knows which portal it's on:
  `web.ts` (the website, no-ops) and `crazygames.ts` (SDK v3). A new portal (Vatar/Lagos Life,
  Poki) is a new adapter plus a line in `PORTALS` (`packages/shared/src/portal.ts`) and its
  `frame-ancestors` list in `apps/web/next.config.ts`.
- **Hosting: our URL, not an upload.** CrazyGames frames independent domains (FAQ), and their SDK
  doesn't check our domain. It asks the CrazyGames page around it to confirm, so it should run
  normally inside their frame. **This still has to be confirmed in their Preview** (see below). If it
  fails, the fallback is an uploaded build: a static export of the web app, with
  `ALLOWED_ORIGINS` gaining `https://*.crazygames.com`.

### What portal mode does

| Requirement | How |
| --- | --- |
| Land in gameplay, at most one click | One **Play** tap → a quick-start lobby: bots fill the empty seats and the game starts by itself after 30 s; people who join take bots' seats. Invites and instant multiplayer skip the menu entirely. |
| SDK events | `loadingStart` at start-up, `loadingStop` when the scene is in, `gameplayStart`/`gameplayStop` (on in a room, off on menus, the end screen and ad breaks). |
| CrazyGames usernames, automatic login, guests | The username replaces our name entry. Guests get a made-up name ("Coyote 4821"), kept on their device. Logging in mid-game reloads the game. Names pass our word filter as always. |
| Progress linked to the account | Tutorial, settings, How to Play, name and look go through the **Data module** (turn on **Progress Save** when submitting). Room-rejoin tokens stay local. |
| `muteAudio` | Wins over our in-game sound switch (and the Settings screen says so). |
| `disableChat` | Typed chat disappears (sending and showing): only **quick chat** remains. |
| Online with Friends | `updateRoom` on every change: joinable only in the lobby, not full, not locked; invite params `{ room: CODE }`. **Invite** uses their invite link. Room join listener: accepting an invite while playing moves you to that room, without a reload. |
| Instant multiplayer | `instantJoin=true` → straight into a new private room (default settings, joinable at once). |
| Rounds | "Back to the saloon" keeps the group in the same room. Quick-start lobbies count down again. |
| Joining mid-game | You watch (public information only) and take a seat when the room goes back to the lobby. The website does the same. |
| Onboarding | No pop-up walkthrough on CrazyGames. The first-game tutorial prompts never block and have "Skip tutorial". |
| Ads | Only SDK midgame ads, **only on the end screen** (never during a round), game locked while it runs, audio muted when it starts. Their SDK paces them (one per 3 min at most). No rewarded ads, no banners. |
| No external ads or links | Sponsor billboards show the town's own signs instead. The 3042 GANG board keeps its art without the @3042official handle. The only outgoing links are **Discord** (menu, allowed as a community link) and the **privacy policy** (opens in a new tab). |
| Privacy | A one-line, non-blocking notice for new players, linking the policy. Our analytics and Sentry are first-party only, with no cross-site tracking (see Privacy below). |
| Small screens | Compact layout for short landscape screens (tested at their 800×450 and 821×462). |

### Size and loading

Measured on a production build of `/play/crazygames` with a fresh browser profile (like
incognito), up to the first `gameplayStart` (in a lobby, after one tap on Play):

| | Menu | Scene in | In a lobby | Downloaded |
| --- | --- | --- | --- | --- |
| Desktop, 20 Mbps | 1.3 s | 3.2 s | 5.3 s | 4.6 MB |
| Phone 800×450, 20 Mbps | 1.3 s | 3.3 s | 5.4 s | 4.6 MB |

Their limits: 50 MB initial download (20 MB to be eligible for the mobile homepage), gameplay
within 20 s. Music loads later, after the first tap. Locally the SDK answers at once; outside a
CrazyGames frame it waits up to 7 s before switching itself off, so opening `/play/crazygames`
directly shows a dark screen for that long (inside their frame it doesn't wait).

### Quick chat (all versions)

A phrase menu next to the chat box: *I'm clear · Not me! · It's [player]! · [player] is [color] ·
I searched [player] · Trust me · Liar!*, filled by tapping a player and/or a color. **Quick chat
contains no user-written text**: the client only sends which phrase, player and color; the server
writes the message from a fixed list (`packages/shared/src/quickChat.ts`). Phrases can be lies on
purpose: lying is the game.

## Submission checklist

### 1. Account and payouts (do this first)

1. Sign up at **developer.crazygames.com**.
2. **Account → Billing**: complete steps 1–4 (personal or company details, address, the tax form
   Tipalti picks for you, bank / PayPal details). Payouts are monthly once you're over €100, NET 60
   (they aim for the 10th of the next month). If you're not ready, choose **Hold Payments** in
   step 2: you can still submit.

### 2. Make the portal pages live

1. Merge the `feature/crazygames` branch to `master` and deploy (Railway).
2. Open **https://wantedtruecolors.com/play/crazygames** in a normal browser tab. The menu should
   load within about 7 seconds (outside CrazyGames the SDK waits, then switches itself off).
3. If CrazyGames' frame shows a blank page and the browser console mentions `frame-ancestors`,
   add the origin it names to `CRAZYGAMES_FRAME_ANCESTORS` (space-separated) in Railway's build
   variables, and redeploy. Their mobile app origins aren't documented, so this is the likely case.

### 3. Submit the game (Developer Portal → Submit a game)

- **Engine:** HTML5. **Hosting:** external URL, if offered:
  `https://wantedtruecolors.com/play/crazygames`. If only uploads are offered, stop here and ask
  for the uploaded build (static export).
- **Title:** Wanted: True Colors
- **Descriptions:** see below.
- **Controls:** see below.
- **Category / tags:** Multiplayer, Social deduction, Strategy, Western, 3D, Casual.
- **Multiplayer:** yes. **Lobby size: 6–15 players** (bots fill empty seats, so a game always starts).
- **Orientation:** desktop landscape. On mobile it works in both; pick portrait (the phone layout
  was designed for it). Landscape works too, at 800×450 and up.
- **SDK features used:** Game (gameplay, loading, rooms, invites, instant multiplayer, settings),
  User (username, picture, login), Data (**turn on "Progress Save"**), Ads (midgame only).
- **In-game purchases:** none (theirs are invite-only).
- **Launch:** ask for **Full Launch**. Their multiplayer page says games that need a large audience
  can skip Basic Launch; their QA team decides.

### 4. Covers and videos

Made in the trailer studio. The title is the only text on the covers, as their rules require.
The files are in `screenshots/crazygames/submission/` (not in git). To make them again:

1. `pnpm dev`, open `/dev/trailer/studio?mode=thumbnail`, choose **Cover**, then each shape, and
   download both sizes (the larger one is for the videos' opening still).
2. `pnpm trailer:render crazygames-landscape` and `pnpm trailer:render crazygames-portrait`
   (these scripts show the town as on CrazyGames: town signs, no handle, no end card).
3. Cover first, sound off, limits checked:
   `node tools/portal-preview.mjs out/trailers/crazygames-landscape-16x9-1920x1080-nomusic.mp4 <cover-landscape-3840x2160.png> preview-landscape-1920x1080.mp4`
   (and the same with the portrait files).

| Asset | Spec | File |
| --- | --- | --- |
| Landscape cover | 1920×1080, 16:9 | `wanted-true-colors-cover-landscape-1920x1080.png` |
| Portrait cover | 800×1200, 2:3 | `wanted-true-colors-cover-portrait-800x1200.png` |
| Square cover | 800×800, 1:1 | `wanted-true-colors-cover-square-800x800.png` |
| Landscape preview | 1080p 16:9, 15–20 s, no sound, ≤50 MB, opens on the cover | `preview-landscape-1920x1080.mp4` |
| Portrait preview | 1080p 2:3 (1080×1620), 15–20 s, no sound, ≤50 MB, opens on the cover | `preview-portrait-1080x1620.mp4` |

The previews have no end card (it shows the website URL and Discord), no "Play now", no black
frames and no cursor.

### 5. Test in their Preview tool (crazygames.com/preview)

Their docs say the QA preview is the only fully realistic environment. Test each of these:

1. **The SDK runs in their frame.** The console shows `CrazyGames HTML SDK initialized` with
   `environment: "crazygames"` (not `disabled`). **This is the hosted-URL check.**
2. **Solo:** one tap on Play → lobby with "The hunt starts in 30s" → a game with bots.
3. **A friend via invite:** Invite (their link) → the friend lands in your lobby; their Join button
   works from the friends list.
4. **Instant multiplayer:** launch from their multiplayer button → straight into a private room.
5. **Play again:** finish a game, "Back to the saloon", start again with the same group.
6. **Joining mid-game:** the friend joins during a round → "You're watching", then a seat after.
7. **Ads:** on the end screen an ad (or nothing, if unfilled) plays, the game stays locked, sound
   is muted, then everything comes back.
8. **Chat off and mute:** switch them on in their settings: typed chat disappears (quick chat
   stays), and all sound goes.
9. **Login:** log in as a guest mid-game → the game reloads with your username. Progress
   (tutorial done, settings, look) follows you to another device.
10. Desktop (non-fullscreen and fullscreen), a phone, and an incognito window.

## Descriptions

**Short:**
A Wild West social deduction game for 6–15 players. Search scarecrows for the outlaw's secret
color, trade clues, lie through your teeth, and claim the bounty.

**Long:**
One of you is the outlaw. Around a campfire in a ghost town, every scarecrow wears a secret
color. When a Wanted poster goes up, everyone races to work out who's wearing it.

Search other players to see their colors, but every search shows a few fakes alongside the real
one. Search again to narrow it down. Everyone can see who you searched, but only you see what you
found. Share clues in chat, or lie: the fewer people who guess right, the bigger your cut of the
bounty.

Buy other players' findings, peek at everyone's hidden money, and use dirty tricks: change your
color, or cover your tracks so searches on you show false results. The richest detective at the
end wins.

- 6–15 players, with bots filling empty seats so a game always starts
- Play with friends: invite them straight into your room
- Quick chat for phones: accuse, claim colors and lie with a tap
- Short rounds, about 25 minutes for a full game

**Controls:**
- Mouse or touch: tap a scarecrow to select them, then **Search**.
- Drag to look around the fire.
- Chat: type, or use **Quick** for ready-made phrases.
- Vote: tap a suspect, then **Accuse**.
- Between posters: **Use a dirty trick** on the payout screen.

## Privacy

- **Our analytics** are first-party, on our own server: anonymous per-browser ids (a hash, never a
  name or account), no cookies, no third-party trackers, and nothing shared with other sites.
- **Sentry** receives error reports from the browser to fix crashes. The game sends no user info,
  cookies, headers or URL query strings, and room codes are removed from URLs
  (`apps/web/components/ErrorReporting.tsx`). Sentry can still see the IP address a report comes
  from: in the Sentry project's **Settings → Security & Privacy**, turn on **"Prevent Storing of
  IP Addresses"**.
- CrazyGames' rules allow this, with a notice for new players; the notice is the one-line
  message on the portal menu, linking `/privacy` in a new tab.

## Things only you can do, and things not yet verified

**You:**
1. The developer account and payout details (above).
2. Deploy, then test the Preview checklist above. **The SDK running in their frame (item 1) has
   only been checked against their SDK's code, not in a real CrazyGames frame.**
3. Fill in the submission form, upload the covers and videos, and declare lobby size 6–15.
4. In Sentry, turn on "Prevent Storing of IP Addresses" (see Privacy).

**Not verified (needs their Preview or real players):**
- Real ads (locally the SDK only shows a placeholder).
- Their mobile app origins (step 2.3).
- Real usernames and avatars (locally the SDK always returns a demo "User1"). Avatars aren't
  shown in the game yet; usernames are.
- The friends list / invite notifications (they need two logged-in accounts).
