// Ad slots for future sponsors: every billboard surface in the town, in one place.
//
// To sell a slot, replace its `image` with the sponsor's artwork (PNG, JPG, WebP or SVG in
// public/ads/) at the slot's aspect ratio. Nothing else needs to change.
//
// Coordinates are metres in the lot's own frame: origin at the middle of the lot's front edge
// on the ground, +x to the right as seen from the square, +y up, +z out toward the square.
// Facades sit behind the porch, at about z = -2.2 (store), -2.1 (saloon) and -1.5 (barn).
// Lots are named in components/scene/town/layout.ts (LOTS). The sheriff's office and its
// neighbours (store, saloon) are kept free of sponsors: the Wanted poster hangs there. The one
// exception is the house slot (`reserved`): 3042Official's own poster, which is never sold.

export type AdAspect = '2:1' | '16:9' | '2:3';

/** Width / height for each supported ratio. Standard outdoor and screen sizes:
 *  2:1 = 48-sheet billboard, 16:9 = widescreen, 2:3 = 6-sheet / door poster (portrait). */
export const AD_ASPECTS: Record<AdAspect, number> = { '2:1': 2, '16:9': 16 / 9, '2:3': 2 / 3 };

export type AdKind =
  /** Painted on a building's upper wall. */
  | 'wall'
  /** Framed board on posts above a roof. */
  | 'rooftop'
  /** Poster board on the porch, next to a door, at eye level. */
  | 'door'
  /** Freestanding board on two posts in the street. */
  | 'standing';

export interface AdSlot {
  id: string;
  kind: AdKind;
  lot: string;
  /** Centre of the ad surface, metres (lot frame, see above). */
  position: [number, number, number];
  /** Width and height in metres. Must match `aspect`. */
  size: [number, number];
  aspect: AdAspect;
  /** Image URL (from public/). */
  image: string;
  /** Who's advertising, for alt text and reporting. */
  advertiser: string;
  /** Turn about the vertical, radians (lot frame), e.g. to face the default camera. */
  rotationY?: number;
  /**
   * Reserved for the house: never sold, never replaced by sponsor ads. Drawn in code (the art
   * in `image` plus this copy) rather than shown as a finished image.
   */
  reserved?: true;
  house?: { title: string; line: string; handle: string };
}

export const AD_SLOTS: AdSlot[] = [
  // RESERVED: 3042Official's own poster. Permanent; never sold or replaced by sponsor ads.
  // Freestanding in the alley between the saloon and the sheriff's office: right where the default
  // camera looks, on desktop and phones, without covering the Wanted poster.
  {
    id: 'house-3042',
    kind: 'standing',
    lot: 'saloon',
    position: [-7.2, 2.85, 2.6],
    size: [2.8, 4.2],
    aspect: '2:3',
    image: '/branding/crew-print.webp',
    advertiser: '3042Official (house, reserved)',
    rotationY: 0.3,
    reserved: true,
    house: { title: '3042 GANG', line: 'Ride with us', handle: '@3042official' },
  },
  // Rooftop billboards
  {
    id: 'roof-hotel',
    kind: 'rooftop',
    lot: 'hotel',
    position: [0, 8.2, -3.2],
    size: [4.8, 2.4],
    aspect: '2:1',
    image: '/ads/your-ad-2x1.svg',
    advertiser: 'Open slot: your ad here',
  },
  {
    id: 'roof-dancehall',
    kind: 'rooftop',
    lot: 'dancehall',
    position: [0.6, 8.3, -4],
    size: [5.2, 2.6],
    aspect: '2:1',
    image: '/ads/your-ad-2x1.svg',
    advertiser: 'Open slot: your ad here',
  },
  // Painted wall signs
  {
    id: 'wall-bank',
    kind: 'wall',
    lot: 'bank',
    position: [0, 5, -2.12],
    size: [3.2, 1.8],
    aspect: '16:9',
    image: '/ads/your-ad-16x9.svg',
    advertiser: 'Open slot: your ad here',
  },
  {
    id: 'wall-assay',
    kind: 'wall',
    lot: 'assay',
    position: [0, 5, -2.12],
    size: [3.2, 1.8],
    aspect: '16:9',
    image: '/ads/your-ad-16x9.svg',
    advertiser: 'Open slot: your ad here',
  },
  // Door poster boards
  {
    id: 'door-hotel',
    kind: 'door',
    lot: 'hotel',
    position: [-2.45, 1.45, -2.1],
    size: [0.9, 1.35],
    aspect: '2:3',
    image: '/ads/your-ad-2x3.svg',
    advertiser: 'Open slot: your ad here',
  },
  {
    id: 'door-barber',
    kind: 'door',
    lot: 'barber',
    position: [2.45, 1.45, -2.1],
    size: [0.9, 1.35],
    aspect: '2:3',
    image: '/ads/your-ad-2x3.svg',
    advertiser: 'Open slot: your ad here',
  },
  {
    id: 'door-livery',
    kind: 'door',
    lot: 'livery',
    position: [-0.9, 1.5, -1.42],
    size: [1, 1.5],
    aspect: '2:3',
    image: '/ads/your-ad-2x3.svg',
    advertiser: 'Open slot: your ad here',
  },
];

/** Slots whose size doesn't match their aspect ratio (checked in dev). */
/** Slots that can be sold to sponsors (everything not reserved for the house). */
export const SPONSOR_SLOTS = (slots = AD_SLOTS) => slots.filter((s) => !s.reserved);

export function badAdSlots(slots = AD_SLOTS): string[] {
  return slots.filter((s) => Math.abs(s.size[0] / s.size[1] / AD_ASPECTS[s.aspect] - 1) > 0.02).map((s) => s.id);
}
