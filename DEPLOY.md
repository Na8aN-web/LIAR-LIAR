# Going live

How Wanted: True Colors runs in production, and the steps to put it online. Do them in order;
each one ends with a check.

**The setup:** one Railway service runs everything in one container (game server, web app, and
a small proxy that puts both on one address, the same layout as `pnpm playtest`). Railway's
Postgres keeps analytics, game stats, feedback and admin settings. Cloudflare sits in front for
the domain, HTTPS, caching and the extra lock on `/admin`. Sentry emails you when something breaks.

Rough cost: Railway Hobby $5/month (covers about $5 of usage; this game should use $5–8 a month
at first), Postgres included in that usage, Cloudflare and Sentry free, plus the domain.

> **One replica only.** Rooms live in the server's memory, so never scale the service to more
> than one instance (`railway.json` pins it to 1). A redeploy ends games in progress: deploy when
> nobody's playing, or turn on maintenance mode in `/admin` first.

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
them into Railway in step 3. **Also save the "Key" it prints in your password manager**: that's
your backup if you lose the phone.

**If you lose the phone or forget the password:** run `pnpm admin:setup` again on any computer
with the repo, then replace the two variables in Railway (step 3). Railway restarts with the new
login; the old codes stop working. Nothing else is lost. That means your real recovery keys are
your **Railway** and **GitHub** logins: turn on two-factor sign-in for both.

## 3. Railway (Europe), with Postgres

1. railway.com → sign in with GitHub → **New Project → Deploy from GitHub repo** →
   `Na8aN-web/LIAR-LIAR`. Railway finds `railway.json` and builds the `Dockerfile` (about 4
   minutes). It redeploys by itself on every push to `master`.
2. In the service: **Settings → Deploy → Region: EU West (Amsterdam)**.
3. In the project: **+ Create → Database → PostgreSQL**. Put it in the same region.
4. In the service: **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `ANALYTICS_STORE` | `postgres` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills it in) |
   | `ALLOWED_ORIGINS` | `https://yourdomain.com` (your real domain, https, no slash at the end) |
   | `ADMIN_PASSWORD_HASH` | from step 2 (copy what's between the quotes) |
   | `ADMIN_TOTP_SECRET` | from step 2 |
   | `SENTRY_DSN` | from step 5 (add later) |
   | `NEXT_PUBLIC_SENTRY_DSN` | the same DSN (add later) |

   `NODE_ENV=production`, the port and `TRUST_PROXY=1` are already set by the image.
5. **Settings → Networking → Generate Domain** for a first test address
   (`something.up.railway.app`). Add it to `ALLOWED_ORIGINS` for now, comma-separated:
   `https://yourdomain.com,https://something.up.railway.app`.

**Check:** the deploy log shows `Data: Postgres` and `Admin dashboard: /admin (password +
authenticator code)`, and `https://something.up.railway.app/healthz` says `ok`. Open the site,
make a room, press **Fill to 6** and play a round with the bots.

## 4. Cloudflare in front

1. Railway service → **Settings → Networking → Custom Domain** → `yourdomain.com` (and
   `www.yourdomain.com` if you want it). Railway shows a CNAME target.
2. Cloudflare → your domain → **DNS → Records** → add `CNAME`, name `@`, target the Railway
   address, **Proxied** (orange cloud). Same for `www` if used. Railway may also ask for a TXT
   record to verify; add it as shown.
3. **SSL/TLS → Overview → Full (strict)**. **SSL/TLS → Edge Certificates → Always Use HTTPS: on**.
4. **Network → WebSockets: on** (it's on by default; the game needs it).
5. **Caching → Cache Rules → Create rule** "Game files": *URI Path starts with* `/models/` *or*
   `/textures/` *or* `/audio/` *or* `/ads/` *or* `/branding/` → **Eligible for cache**, Edge TTL
   **Ignore cache-control header, 1 month**, Browser TTL **1 day**. These files rarely change;
   after replacing one, use **Caching → Purge Cache** for its URL.
6. **Access on /admin**: follow [SECURITY.md → Cloudflare Access](SECURITY.md#cloudflare-access-at-launch),
   then add `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` to the Railway variables.
7. Once the domain works: remove the `up.railway.app` address (**Settings → Networking**, the
   bin icon) and take it out of `ALLOWED_ORIGINS`. Then every player comes through Cloudflare,
   and nobody can reach the server around it.

**Check:** `https://yourdomain.com` loads with the padlock; `https://yourdomain.com/admin` asks
Cloudflare for your email first, then the game's own password and code.

## 5. Sentry (error alerts)

1. sentry.io → sign up, data region **EU** (the game runs in Europe).
2. **Create Project → Browser JavaScript** (one project covers the server and the browser), alert
   frequency "Alert me on every new issue".
3. Copy the **DSN** (`https://…@o….ingest.de.sentry.io/…`) into both `SENTRY_DSN` and
   `NEXT_PUBLIC_SENTRY_DSN` in Railway. The browser one is baked in at build time, so Railway
   rebuilds (automatic when you change variables).

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

- **Deploy:** push to `master`. Railway builds, checks `/healthz`, then switches over.
- **Something broke:** Sentry emails you; Railway → **Deployments** has the logs and a
  **Rollback** button on every earlier deploy.
- **Maintenance:** `/admin` → Controls → maintenance mode stops new rooms (games in progress
  carry on), then deploy.
- **Test the production build locally:** `docker build -t wtc . && docker run -p 8080:8080 -e ALLOWED_ORIGINS=http://localhost:8080 wtc`,
  then open http://localhost:8080.
