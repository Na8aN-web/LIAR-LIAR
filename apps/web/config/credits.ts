// Asset and audio credits as shown on the in-game Credits screen. CREDITS.md (repo root) is the
// full record (files, sources still to find); keep the two in step when assets change.

export interface CreditItem {
  name: string;
  by?: string;
  use: string;
  license: string;
  url?: string;
}

export interface CreditGroup {
  title: string;
  items: CreditItem[];
}

export const CREDITS: CreditGroup[] = [
  {
    title: 'Town and props',
    items: [
      {
        name: 'Old West asset pack',
        by: 'NaiveGoblin',
        use: 'Saloon, sheriff’s office, store, livery barn, church, well',
        license: 'CC0',
        url: 'https://naivegoblin.itch.io/old-west-asset-pack',
      },
      {
        name: 'Low poly Western Objects',
        by: 'OpenGameArt',
        use: 'Barrels, crates, fences, wagon, lanterns, cacti, seats around the fire',
        license: 'CC0',
        url: 'https://opengameart.org/content/low-poly-cc0-western-objects-pack',
      },
      { name: 'Tumbleweed', use: 'Tumbleweed', license: 'CC0' },
    ],
  },
  {
    title: 'Textures',
    items: [
      { name: 'Ground111', by: 'ambientCG', use: 'The dirt of the town square', license: 'CC0', url: 'https://ambientcg.com/view?id=Ground111' },
      { name: 'Building materials', by: 'ambientCG', use: 'Planks, bricks, paving, metal and wallpaper on the buildings', license: 'CC0', url: 'https://ambientcg.com' },
      { name: 'Paper texture', use: 'The Wanted posters', license: 'CC0' },
    ],
  },
  {
    title: 'Scarecrows',
    items: [
      { name: 'Scarecrow model', by: '3042Official', use: 'Every player at the fire (made with Meshy AI)', license: '3042Official' },
      {
        name: 'Rig and animations',
        by: 'Mixamo (Adobe)',
        use: 'Sitting, talking, despair and victory',
        license: 'Mixamo terms',
        url: 'https://www.mixamo.com',
      },
    ],
  },
  {
    title: 'Music and sound',
    items: [
      { name: 'Western music', use: 'Menu, lobby and the hunt', license: 'See CREDITS.md' },
      { name: 'Victory song', use: 'Plays when a game ends', license: 'See CREDITS.md' },
      { name: 'Fire, wind and crows', use: 'The night around the fire', license: 'See CREDITS.md' },
      { name: 'Sound effects', by: '3042Official', use: 'Every click, telegram, stamp and sting, made in code', license: 'Original' },
    ],
  },
  {
    title: 'Fonts',
    items: [
      { name: 'Rye', by: 'Nicole Fally', use: 'Titles', license: 'OFL', url: 'https://fonts.google.com/specimen/Rye' },
      { name: 'Special Elite', by: 'Astigmatic', use: 'Telegrams', license: 'OFL', url: 'https://fonts.google.com/specimen/Special+Elite' },
      { name: 'Libre Baskerville', by: 'Impallari Type', use: 'Body text', license: 'OFL', url: 'https://fonts.google.com/specimen/Libre+Baskerville' },
    ],
  },
];
