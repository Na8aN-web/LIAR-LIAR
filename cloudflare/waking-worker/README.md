# The "waking up" Worker

Render's free tier puts the game to sleep after 15 quiet minutes, and the first visitor then
waits about a minute. This Cloudflare Worker sits in front of `wantedtruecolors.com`:

- **Server awake:** every request passes straight through to Render: pages, files, the admin
  API and the game's WebSocket connections.
- **Server asleep or slow:** a page load gets a "waking up" page in the game's style at once
  (after at most ~2.5 s of checking). That page polls `/healthz` every few seconds and loads the
  game by itself the moment the server answers. The check itself wakes Render.
- Only page loads ever see the waking page (tabs, and the CrazyGames frame). Files, POSTs and
  WebSockets are never touched. During a deploy or restart (Render answering 502/503/504) the
  waking page shows instead of an error.

Free plan: 100,000 Worker requests a day, and every request to the site counts (a full game load
is a few dozen). Set the route's failure mode to **fail open** (step B4): past the limit, requests
go straight to Render, so the site keeps working, just without the waking page.

## A. Point the domain at Render (DNS only first, then proxied with Full (strict))

Render must see the domain directly once to issue its certificate. After that, the orange cloud
and Full (strict) work, because Render's certificate is a real, publicly trusted one for your
domain.

1. **Render** → the service → **Settings → Custom Domains → Add Custom Domain**:
   `wantedtruecolors.com`. Add `www.wantedtruecolors.com` too if you want it. Note the
   `something.onrender.com` address Render shows.
2. **Cloudflare** → `wantedtruecolors.com` → **DNS → Records**:
   - Delete any **AAAA** records for `wantedtruecolors.com` and `www` (Render has no IPv6, and
     they break the custom domain).
   - Edit the `wantedtruecolors.com` record (Name `@`): **Type CNAME**, **Target**
     `something.onrender.com`, **Proxy status: DNS only** (grey cloud). If it's an A record now,
     delete it and add the CNAME. Same for `www` if you added it.

   From this moment the domain goes to Render instead of Railway (games on Railway end).
3. **Render** → **Custom Domains**: wait for **Certificate Issued** next to each domain (a few
   minutes; press **Verify** if it waits). Check `https://wantedtruecolors.com/healthz` says `ok`.
4. **Cloudflare** → **SSL/TLS → Overview → Configure → Full (strict)** → Save.
5. **Cloudflare** → **DNS → Records**: edit each CNAME → **Proxy status: Proxied** (orange
   cloud) → Save.
6. Check: `https://wantedtruecolors.com/healthz` still says `ok`, and the browser shows the
   padlock. If you get Cloudflare **error 526** (invalid certificate), Render's certificate isn't
   ready yet: set the record back to **DNS only**, wait for step 3, then repeat 5.

Cloudflare settings from before (WebSockets on, Always Use HTTPS, the cache rule for game files,
Access on `/admin`) carry over as they are.

**Certificate renewals:** Render renews its certificate by itself. If Render ever shows a
certificate error for the domain, switch the record to **DNS only** until it says issued again,
then back to **Proxied**.

## B. Deploy the Worker

Either way works on a free account.

**With the command line** (this folder has everything: `wrangler.jsonc` and `src/index.js`):

1. `cd cloudflare/waking-worker`
2. `npx wrangler login` (opens the browser to allow it).
3. `npx wrangler deploy`. It creates the Worker `wtc-waking` and its routes
   `wantedtruecolors.com/*` and `www.wantedtruecolors.com/*`.
4. Cloudflare → **Workers & Pages → wtc-waking → Settings → Domains & Routes** → each route →
   **Request limit failure mode: Fail open (proceed)** → Save.

**In the dashboard:**

1. Cloudflare → **Workers & Pages → Create → Create Worker** (Hello World) → name `wtc-waking` →
   **Deploy**.
2. **Edit code** → replace everything with the contents of `src/index.js` → **Deploy**.
3. **Settings → Domains & Routes → Add → Route**: zone `wantedtruecolors.com`, route
   `wantedtruecolors.com/*`, **Request limit failure mode: Fail open (proceed)** → Add route.
   Repeat with `www.wantedtruecolors.com/*` if you use www.

Do part A before part B: the route only works while the DNS record is **Proxied**.

## Check it

1. Awake: open the site; it loads as usual. Make a room and play a round (WebSockets work).
2. Asleep: leave the site alone for 20 minutes (nobody playing), then open it. You should see
   the campfire page with "Waking up…", and after about a minute the game loads by itself.
3. Render → **Logs** shows the server starting at that moment.

To change the timings, edit the constants at the top of `src/index.js` and deploy again.
