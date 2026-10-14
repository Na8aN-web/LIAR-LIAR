'use client';

import { colorInfo } from '@wtc/shared';
import { useGame } from '@/lib/store';
import { useStreamerMode } from '@/lib/streamer';
import { Modal } from '../Modal';
import { EyeIcon } from '../ui/EyeIcon';

/** Half-height sheet from the bottom: what you're looking for this round and how searching works. */
export function HintsSheet({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const game = view.game!;
  const streamer = useStreamerMode();
  const poster = colorInfo(game.posterColor);
  const left = game.inspectLimit + game.extraInspects - game.inspectsUsed;
  const { extraInspectPrice, extraInspectCount, buyPrice, decoys } = view.settings.rules;

  return (
    <Modal title="Hints" onClose={onClose} className="hints-sheet">
      <p className="hint-goal">
        You need to figure out who&rsquo;s wearing{' '}
        <b className="hint-color" style={{ color: poster.hex }}>
          <i className="you-dot" style={{ background: poster.hex, color: poster.hex }} /> {poster.name}
        </b>
        .
      </p>
      {game.youAreWanted && !streamer && (
        <p className="hint-outlaw">That&rsquo;s you this round. Search others anyway so you blend in.</p>
      )}
      <ul className="hint-list">
        <li>
          <b>Tap a player</b> to search them. You have {left} {left === 1 ? 'search' : 'searches'} left this round.
        </li>
        <li>
          A search shows {decoys + 1} colors: their real one and {decoys} {decoys === 1 ? 'fake' : 'fakes'}. If {poster.name} isn&rsquo;t among them, that player looks clear (unless they covered their tracks).
        </li>
        <li>
          <span className="eye-plate inline">
            <EyeIcon />
          </span>{' '}
          An eye over a player means someone searched them this round. The Searches tab shows who.
        </li>
        <li>
          Out of searches? Buy {extraInspectCount} more for ${extraInspectPrice}, or pay ${buyPrice} for someone else&rsquo;s findings.
        </li>
      </ul>
    </Modal>
  );
}
