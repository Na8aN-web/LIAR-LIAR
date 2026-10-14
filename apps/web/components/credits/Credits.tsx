'use client';

import Link from 'next/link';
import { BRAND, SOCIALS } from '@/config/brand';
import { CREDITS } from '@/config/credits';
import { usePortal } from '@/lib/portal';
import { Rope } from '../ui/western';
import { SocialIcon } from './SocialIcon';

/** The Credits screen: who made the game, where to find them, then the asset credits. */
export function Credits() {
  // Portals allow no outgoing links except the community one (Discord) and the privacy policy.
  const all = usePortal().features.links === 'all';
  return (
    <div className="credits">
      <header className="credits-head">
        {/* Plain img: a small fixed-size image from public/. */}
        <img className="crew-art" src={BRAND.crewArt.color} alt="The 3042 crew" width={512} height={512} />
        <div className="credits-byline">
          <p className="credits-built">
            Built by <b>{BRAND.author}</b>
          </p>
          <p className="credits-studio">A {BRAND.studio} game</p>
        </div>
      </header>

      <nav className="socials" aria-label="3042Official online">
        {SOCIALS.filter((s) => s.url && (all || s.id === 'discord')).map((s) => (
          <a key={s.id} className={`btn social social-${s.id}${s.id === 'youtube' ? ' primary' : ''}`} href={s.url} target="_blank" rel="noopener noreferrer">
            <SocialIcon id={s.id} />
            <span>{s.label}</span>
          </a>
        ))}
      </nav>

      <Rope />

      {CREDITS.map((g) => (
        <section key={g.title} className="credits-group">
          <h3>{g.title}</h3>
          <ul>
            {g.items.map((it) => (
              <li key={it.name}>
                <span className="credit-name">
                  {it.url && all ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer">
                      {it.name}
                    </a>
                  ) : (
                    it.name
                  )}
                  {it.by && <span className="muted"> by {it.by}</span>}
                </span>
                <span className="credit-use">{it.use}</span>
                <span className="credit-license">{it.license}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="hint credits-foot">
        {BRAND.game} · © {BRAND.studio} ·{' '}
        {all ? (
          <Link href="/privacy">Privacy</Link>
        ) : (
          // In a portal's frame: the policy opens in its own tab.
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
        )}
      </p>
    </div>
  );
}
