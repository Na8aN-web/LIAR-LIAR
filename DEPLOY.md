# Going live

How Wanted: True Colors runs in production, and the steps to put it online. Do them in order;
each one ends with a check.

**The setup:** one Render web service runs everything (game server, web app, and a small proxy
that puts both on one address, the same layout as `pnpm playtest`). A hosted Postgres keeps
analytics, game stats, feedback and admin settings. Cloudflare sits in front for the domain,
HTTPS, caching and the extra lock on `/admin`. Sentry emails you when something breaks.

Rough cost: Render Free, a free Postgres (see step 3), Cloudflare and Sentry free, plus the domain.

> **Render Free, what to expect.** The service sleeps after 15 minutes with no traffic (WebSocket
> messages count as traffic), and the next visitor waits about a minute. The disk is wiped on
> every sleep, restart and deploy, so Postgres is what keeps your data.

> **One instance only.** Rooms live in the server's memory, so never scale the service to more
> than one instance. A redeploy ends games in progress: deploy when nobody's playing, or turn on
> maintenance mode in `/admin` first.

---

## 1. Buy the domain

Cloudflare Registrar is the simplest (sells at cost, and the domain is already on Cloudflare for
step 4): dash.cloudflare.com → **Domain Registration → Register Domains**. Any registrar works;
you'd then point its nameservers to Cloudflare.

Before buying, check the name on Steam, itch.io and the app stores (on the launch list).

**Check:** the domain shows under **Websites** in Cloudflare.

## 2. Make an admin login for the live site

On your PC:

```powershell
pnpm admin:setup
```

Choose a password (12+ characters) and scan the QR code with an authenticator app. It saves two
values to `apps/server/.env.local`: `ADMIN_PASSWORD_HASH` and `ADMIN_TOTP_SECRET`. You'll paste
them into Render in step 3. **Also save the "Key" it prints in your password manager**: that's
your backup if you lose the phone.

**If you lose the phone or forget the password:** run `pnpm admin:setup` again on any computer
with the repo, then replace the two variables in Render (step 3). Render restarts with the new
login; the old codes stop working. Nothing else is lost. That means your real recovery keys are
your **Render** and **GitHub** logins: turn on two-factor sign-in for both.

## 3. Render, with Postgres

1. Create a Postgres database outside this service and copy its connection string. Render's own
   free database is deleted 30 days after creation unless you upgrade it, so a host with a
   lasting free plan is the better fit.
2. render.com → sign in with GitHub → **New → Web Service** → `Na8aN-web/LIAR-LIAR`, branch
   `master`. Choose **Language: Node** (Render may suggest Docker because the repo has a
   `Dockerfile`), **Instance Type: Free**, and enter:

   - **Build Command:**
     `npx --yes pnpm@11.0.9 install --frozen-lockfile --prod=false --filter "@wtc/server..." --filter "@wtc/web..." && npx --yes pnpm@11.0.9 run build`
   - **Start Command:** `node tools/start-prod.mjs`
   - **Health Check Path** (under Advanced): `/healthz`

   Node 22 comes from `.node-version`. Render redeploys by itself on every push to `master`.
3. Under **Environment**, add:

   | Variable | Value |
   | --- | --- |
   | `ANALYTICS_STORE` | `postgres` |
   | `DATABASE_URL` | the connection string from step 1 |
   | `DATABASE_SSL` | `1` if that database requires TLS (hosted ones outside Render's network do) |
   | `ADMIN_PASSWORD_HASH` | from step 2 (copy what's between the quotes) |
   | `ADMIN_TOTP_SECRET` | from step 2 |
   | `SENTRY_DSN` | from step 5 (add later) |
   | `NEXT_PUBLIC_SENTRY_DSN` | the same DSN (add later) |

   Render sets `PORT` and `NODE_ENV`; `tools/start-prod.mjs` sets `TRUST_PROXY=1`. Leave
   `ALLOWED_ORIGINS` unset: the server then accepts its own address, whichever one is in use.

**Check:** the deploy log shows `Data: Postgres` and `Admin dashboard: /admin (password +
authenticator code)`, and `https://your-service.onrender.com/healthz` says `ok`. Open the site,
make a room, press **Fill to 6** and play a round with the bots.

## 4. Cloudflare in front

1. Render service → **Settings → Custom Domains** → `yourdomain.com` (and `www.yourdomain.com`
   if you want it). Render shows the DNS target.
2. Cloudflare → your domain → **DNS → Records** → add or update the `CNAME`, name `@`, target the
   address Render shows, **Proxied** (orange cloud). Same for `www` if used.
3. **SSL/TLS → Overview → Full (strict)**. **SSL/TLS → Edge Certificates → Always Use HTTPS: on**.
4. **Network → WebSockets: on** (it's on by default; the game needs it).
5. **Caching → Cache Rules → Create rule** "Game files": *URI Path starts with* `/models/` *or*
   `/textures/` *or* `/audio/` *or* `/ads/` *or* `/branding/` → **Eligible for cache**, Edge TTL
   **Ignore cache-control header, 1 month**, Browser TTL **1 day**. These folders only hold files
   that ship with the code, so they only change when you deploy. When a deploy changes one of
   them, either give it a new file name (nothing to purge) or use **Caching → Purge Cache** for
   its URL; otherwise players keep the old copy for up to a month.

   **Billboards replaced in `/admin` aren't affected.** They're never stored under `/ads/`: the
   game loads them from `/billboards/<slot>?v=<version>`, where the version is a fingerprint of
   the image, so every upload gets a new address and shows straight away. Resetting a billboard
   in `/admin` switches back to its built-in `/ads/` image. Don't add `/billboards/` to this rule
   (it would override the server's own caching), and leave **Caching → Configuration → Caching
   level** on **Standard** (the default), not *Ignore query string*: the `?v=` part is what makes
   each upload a new address.
6. **Access on /admin**: follow [SECURITY.md → Cloudflare Access](SECURITY.md#cloudflare-access-at-launch),
   then add `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` to the Render variables.

**Check:** `https://yourdomain.com` loads with the padlock; `https://yourdomain.com/admin` asks
Cloudflare for your email first, then the game's own password and code.

## 5. Sentry (error alerts)

1. sentry.io → sign up, data region **EU** (the game runs in Europe).
2. **Create Project → Browser JavaScript** (one project covers the server and the browser), alert
   frequency "Alert me on every new issue".
3. Copy the **DSN** (`https://…@o….ingest.de.sentry.io/…`) into both `SENTRY_DSN` and
   `NEXT_PUBLIC_SENTRY_DSN` in Render. The browser one is baked in at build time, so choose
   **Save, rebuild, and deploy**.

What gets sent: the error and where in the code it happened. No IPs, cookies, headers, chat or
player names, and room codes are blanked out of addresses.

**Check:** the deploy log says `Error reporting: Sentry on`.

## 6. Before announcing

- Play a full game on the live site, ideally with friends on phones over mobile data (one with
  a mid-round disconnect).
- `/admin` → **Live** shows the room; after the game, **Growth** and **Balance** show it. The
  seeded test data was only ever on your PC (removed with `pnpm admin:seed -- --remove`), so the
  live dashboard starts empty.
- Put the real website and Discord into the trailer end cards (`trailers/*.json`).

## Everyday

- **Deploy:** push to `master`. Render builds, checks `/healthz`, then switches over.
- **Something broke:** Sentry emails you; Render → **Logs** and **Events** have the logs and a
  **Rollback** button on every earlier deploy.
- **Maintenance:** `/admin` → Controls → maintenance mode stops new rooms (games in progress
  carry on), then deploy.
- **Test the production build locally:** `pnpm build`, then `pnpm start`, then open
  http://localhost:8080.
