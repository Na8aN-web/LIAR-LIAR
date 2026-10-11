'use client';

import { ColorChip } from '@/components/Chip';
import { EyeIcon } from '@/components/ui/EyeIcon';
import { BrassBadge, Paper, Rope, StampButton, WoodBar } from '@/components/ui/western';

// Dev-only style guide: tokens, type and the five building blocks. /dev/style
const TOKENS = [
  ['--parchment', '#ecdcb4'],
  ['--ink', '#2e1c0e'],
  ['--wood', '#3b2416'],
  ['--brass', '#c9a24a'],
  ['--oxblood', '#7b1e1e'],
  ['--telegram', '#f2e5b4'],
  ['--cream', '#f3e6c4'],
  ['--night', '#0b0806'],
];

export default function StyleGuide() {
  if (process.env.NODE_ENV !== 'development') return null;
  return (
    <main className="styleguide">
      <h1 style={{ color: 'var(--brass-light)' }}>Design system</h1>
      <div className="swatches">
        {TOKENS.map(([name, hex]) => (
          <div key={name} style={{ background: hex, color: ['--ink', '--wood', '--oxblood', '--night'].includes(name) ? '#f3e6c4' : '#2e1c0e' }}>
            {name}
          </div>
        ))}
      </div>

      <Paper className="card">
        <h2 style={{ color: 'var(--oxblood)' }}>Paper panel · Rye title</h2>
        <p>
          Body text is Libre Baskerville, sized for phones. Decorative fonts are kept to titles and big numbers.
        </p>
        <Rope />
        <div className="row wrap">
          <StampButton variant="primary">Search them</StampButton>
          <StampButton>$20 for their findings</StampButton>
          <StampButton variant="ghost" size="small">
            Keep mine
          </StampButton>
          <span className="tag">offer wired</span>
        </div>
        <div className="chip-row tight">
          <ColorChip color="red" />
          <ColorChip color="teal" strong />
          <ColorChip color="lavender" dim />
        </div>
      </Paper>

      <WoodBar className="row" style={{ padding: 10, borderRadius: 4 }}>
        <span className="grow" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>
          Wood bar
        </span>
        <BrassBadge label="Time">42</BrassBadge>
        <BrassBadge label="Purse">$120</BrassBadge>
        <BrassBadge label="Time" tone="alert">
          8
        </BrassBadge>
        <span className="eye-plate">
          <EyeIcon /> 3
        </span>
      </WoodBar>

      <div className="note note-offer" style={{ position: 'relative' }}>
        <div className="note-head">
          <span>WESTERN TELEGRAPH</span>
          <span>OFFER</span>
        </div>
        <div className="note-text">
          <b>Bot Pearl offers $20 for your findings.</b>
          <span>Your search of Bot Hank on poster 1.</span>
        </div>
        <div className="row">
          <StampButton variant="primary" size="small">
            Sell
          </StampButton>
          <StampButton size="small">Refuse</StampButton>
        </div>
      </div>
    </main>
  );
}
