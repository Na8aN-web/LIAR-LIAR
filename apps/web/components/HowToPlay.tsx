export function HowToPlay() {
  return (
    <div className="prose">
      <p>
        Every player is a scarecrow wearing one colored item. You see your own color. Everyone else is a dark
        silhouette.
      </p>
      <h3>Each poster</h3>
      <ol>
        <li>A Wanted poster shows one color. One player is secretly Wanted, and only they know it.</li>
        <li>
          <b>Investigate.</b> Inspect a player to see their real color mixed in with a few decoys. Inspect them again and
          the color that repeats is the real one. Everyone sees who you inspected, but only you see the colors.
        </li>
        <li>
          <b>Talk.</b> Share what you found, or lie. The fewer people who guess right, the bigger your share.
        </li>
        <li>
          <b>Vote</b> secretly for who you think is Wanted.
        </li>
        <li>
          <b>Payout.</b> The bounty is split among correct voters. If nobody finds the Wanted player, they escape
          with 50 points.
        </li>
      </ol>
      <p>
        <b>Changing color.</b> Between posters (during the payout) you can change to a random free color, a few times
        per game. Everyone is told how many players changed, never who, so old findings can go stale.
      </p>
      <p>Most points after the last poster wins. The final replay shows everyone&apos;s true colors and who lied.</p>
    </div>
  );
}
