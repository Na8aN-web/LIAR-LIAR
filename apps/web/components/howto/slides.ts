import { DEFAULT_SETTINGS, defaultInspects, type RoomSettings } from '@wtc/shared';

// The How to Play walkthrough, written for someone who has never played. The wording is fixed;
// only the numbers come from the game settings (searches per round, prices, starting money,
// fakes per search, reward, escape bonus), so the slides stay right when they change.
// Screenshots are public/howto/slide-N.webp, made by `pnpm howto:screens`.

export type Block =
  | { kind: 'text'; text: string }
  /** A worked example, set apart from the rule. */
  | { kind: 'example'; text: string }
  | { kind: 'tip'; text: string }
  | { kind: 'list'; items: string[] };

export interface Slide {
  id: string;
  title: string;
  blocks: Block[];
  image: string;
  alt: string;
}

export interface SlideNumbers {
  settings?: RoomSettings;
  /** Players in the room (sets 'auto' searches per round). A typical table when unknown. */
  playerCount?: number;
}

const TYPICAL_TABLE = 8;

export function howToSlides({ settings = DEFAULT_SETTINGS, playerCount = TYPICAL_TABLE }: SlideNumbers = {}): Slide[] {
  const r = settings.rules;
  const searches = settings.inspectsPerRound === 'auto' ? defaultInspects(playerCount) : settings.inspectsPerRound;
  const shown = r.decoys + 1;
  const fakes = r.decoys;
  const $ = (n: number) => `$${n}`;
  const text = (t: string): Block => ({ kind: 'text', text: t });
  const example = (t: string): Block => ({ kind: 'example', text: t });
  const tip = (t: string): Block => ({ kind: 'tip', text: t });
  const slide = (n: number, id: string, title: string, blocks: Block[], alt: string): Slide => ({ id, title, blocks, image: `/howto/slide-${n}.webp`, alt });

  return [
    slide(
      1,
      'game',
      'What is this game?',
      [text('You and your friends are scarecrows around a campfire. Each round, one of you is the outlaw. Your job: figure out who. The best detective ends the game with the most money.')],
      'The circle of scarecrows around the campfire.',
    ),
    slide(
      2,
      'color',
      'Your secret color',
      [text('Before the game, you pick a color for your poncho, cloak or bandana. Only you can see your real color. Everyone else sees a dull, colorless garment.')],
      'The color picker in the lobby.',
    ),
    slide(
      3,
      'poster',
      'The Wanted poster',
      [text('Each round, a Wanted poster appears, showing one color, like Red. Whoever is wearing red is the outlaw. The outlaw knows it’s them. Nobody else does.')],
      'A new Wanted poster appearing.',
    ),
    slide(
      4,
      'search',
      'Searching someone',
      [
        text(`Tap a scarecrow and press Search. You’ll see ${shown} colors. One of them is their real color; the other ${fakes} are fakes.`),
        example('Example: you search Hank and see Pink, Green, Lavender, Red.'),
      ],
      'The result of a first search.',
    ),
    slide(
      5,
      'again',
      'Search again to find the truth',
      [
        text('Search the same person again and you get new fakes, but the real color always shows up.'),
        example('Example: second search: Cyan, Lavender, Red, Pink. Third: Green, Lavender, Cyan, Blue. Lavender showed up every time, so Hank wears Lavender.'),
        tip(`Quick trick: if the poster color isn’t among the ${shown}, that person is definitely not the outlaw.`),
        text(`You get ${searches} searches per round.`),
      ],
      'Three searches of the same scarecrow, with the color that showed up every time circled.',
    ),
    slide(
      6,
      'eyes',
      'Everyone can see who you search',
      [text('The little 👁 number over each scarecrow shows how many times they’ve been searched. Everyone sees who searched whom, but only you see what you found.')],
      'Eye badges over the scarecrows.',
    ),
    slide(
      7,
      'talk',
      'Talk, or lie',
      [
        text(
          'Use the chat to share clues, accuse, or defend yourself. Anyone can lie. The outlaw lies to escape. Other players lie too, because fewer correct guesses means a bigger reward for them. Only trust your own searches.',
        ),
      ],
      'The chat with a few claims.',
    ),
    slide(
      8,
      'buy',
      'Buying clues',
      [
        {
          kind: 'list',
          items: [
            `${$(r.buyPrice)}: buy someone else’s search results. They can say no. If they say yes, they get your ${$(r.buyPrice)}.`,
            `${$(r.extraInspectPrice)}: buy one extra search for this round.`,
          ],
        },
        text(`Everyone starts with ${$(r.startingPoints)}. You can make up to ${r.purchaseCap} purchases per round, and you can’t go below $0.`),
      ],
      'The button to buy someone’s search, and the extra search button.',
    ),
    slide(
      9,
      'accuse',
      'Accuse the outlaw',
      [
        text('When time runs out, everyone picks one player to accuse. Everyone who picks right splits the reward.'),
        example(
          `Example: the reward is ${$(r.basePot)} and 2 people guessed right, so each gets ${$(Math.floor(r.basePot / 2))}. If only you guessed right, you get all ${$(r.basePot)}.`,
        ),
        text(`If nobody catches the outlaw, they escape with a secret ${$(r.escapeBonus)} bonus, revealed at the end.`),
      ],
      'The accuse panel.',
    ),
    slide(
      10,
      'win',
      'Changing colors, and winning',
      [
        text(
          'After each round, you can change your color a few times per game. You get a random new color. Everyone hears how many players changed, but never who. Use it when too many people know your color.',
        ),
        text('The player with the most money after the last poster wins.'),
      ],
      'The change color option and the ledger.',
    ),
  ];
}
