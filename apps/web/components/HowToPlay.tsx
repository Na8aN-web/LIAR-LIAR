export function HowToPlay() {
  return (
    <div className="prose">
      <p>
        Every player is a scarecrow wearing one colored garment. You can see your own color. Everyone else is a shadow
        in the dark.
      </p>
      <h3>Each poster</h3>
      <ol>
        <li>A Wanted poster shows one color. One player is the outlaw, and only they know it.</li>
        <li>
          <b>Search for clues.</b> Searching a player shows their real color mixed in with a few decoys. Search them again
          and the color that shows up every time is the real one. Everyone sees who you searched, but only you see the
          colors.
        </li>
        <li>
          <b>Talk.</b> Share what you found, or lie. The fewer folks who get it right, the bigger your cut.
        </li>
        <li>
          <b>Accuse</b> the player you think is the outlaw. Accusations are sealed.
        </li>
        <li>
          <b>Bounty.</b> The bounty is split between everyone who named the outlaw. If nobody does, the outlaw rides off
          with $50.
        </li>
      </ol>
      <p>
        <b>Changing colors.</b> Between posters you can change to a random free color, a few times per game. Folks only
        hear how many changed, never who, so old findings can go stale.
      </p>
      <p>The fattest purse after the last poster wins. The final reckoning shows everyone&apos;s true colors and who lied.</p>
    </div>
  );
}
