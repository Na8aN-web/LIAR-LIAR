import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND, SOCIALS } from '@/config/brand';

export const metadata: Metadata = {
  title: 'Privacy · Wanted: True Colors',
  description: 'What Wanted: True Colors collects, and why.',
};

const UPDATED = '11 October 2026';

/** Plain-English privacy policy. Keep it in step with what the server actually stores (SECURITY.md). */
export default function PrivacyPage() {
  const discord = SOCIALS.find((s) => s.id === 'discord')?.url;
  return (
    <main className="legal">
      <article className="paper legal-card">
        <Link href="/" className="link-muted">
          ← Back to town
        </Link>
        <h1>Privacy</h1>
        <p className="hint">Last updated {UPDATED}</p>

        <p>
          {BRAND.game} is a game by {BRAND.studio}. There are no accounts, no email sign-ups, no advertising trackers and no third-party analytics. This page lists everything we
          keep and why, in plain words.
        </p>

        <h2>What we keep</h2>
        <dl className="legal-list">
          <dt>A random ID for your browser</dt>
          <dd>
            Your browser makes up a random code the first time you play and keeps it in its own storage. We only ever store a scrambled version of it (a one-way hash), which can&rsquo;t
            be turned back into the code. It lets us count players without knowing who they are, stop one browser taking two seats, and keep banned browsers out.
          </dd>

          <dt>How games go</dt>
          <dd>
            For each finished game: settings, how many players, searches, purchases, color changes, accusations, scores and how long it took. Players are numbered, never named. We use
            this to balance the game.
          </dd>

          <dt>Visits</dt>
          <dd>
            Which page you opened, the link&rsquo;s source if it had one (for example <code>?src=youtube</code>), whether you&rsquo;re on a phone or a computer, and your country.
            The country comes from Cloudflare, the network that delivers the site. We do <b>not</b> store your IP address or details of your device.
          </dd>

          <dt>Steps through the game</dt>
          <dd>Whether you opened, finished or skipped How to Play, reached a lobby, started and finished a game. This shows us where new players get stuck.</dd>

          <dt>Billboards</dt>
          <dd>Which billboards in town were on your screen, so we can count how many players saw each one.</dd>

          <dt>Your display name</dt>
          <dd>
            Shown to the people in your room while you play. It isn&rsquo;t kept in our stats. It is kept if you send the feedback form at the end of a game, next to your answers.
          </dd>

          <dt>Chat</dt>
          <dd>
            Chat goes to your room and is not stored. The one exception: if someone reports a message, that message and up to four before it are kept (text only, no names) so the
            moderators can act on it.
          </dd>

          <dt>Safety</dt>
          <dd>Reports, mutes, kicks and bans, and how often our rate limits stop someone, linked to the anonymous ID only.</dd>
        </dl>

        <h2>What stays on your device</h2>
        <p>
          Your browser keeps your name, your seat in a room (so you can reconnect), your sound and brightness settings, whether you&rsquo;ve seen How to Play, and the random ID
          above. Clearing this site&rsquo;s data in your browser removes all of it and gives you a fresh random ID. We don&rsquo;t use cookies for players.
        </p>

        <h2>Who can see it</h2>
        <p>
          Only the people running the game, in a private dashboard. While a game is running, even they see only what any player sees (names, who&rsquo;s connected, the phase);
          hidden information like colors and votes is visible to them only after the game ends. We never sell or share this data.
        </p>
        <p>
          Our server briefly uses your IP address in memory to stop floods of requests; it isn&rsquo;t written down. Cloudflare handles your connection under its own privacy
          policy. Sign-in attempts to the admin area are logged with the IP address, for security.
        </p>

        <h2>How long</h2>
        <p>Game stats, visits and feedback are kept while they help us improve the game. Reported chat is kept for moderation.</p>

        <h2>Questions or deletion</h2>
        <p>
          Ask us to delete your feedback, or anything else, {discord ? <a href={discord}>on our Discord</a> : 'on our socials'}. Because we don&rsquo;t know who you are, tell us
          roughly when you played and the name you used.
        </p>
      </article>
    </main>
  );
}
