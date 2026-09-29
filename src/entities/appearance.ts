import { chance, pick, pickWeighted } from '../core/rng';

export type HairStyle =
  | 'bald' | 'buzz' | 'short' | 'spiky' | 'long' | 'ponytail' | 'afro' | 'mohawk' | 'bun' | 'slick' | 'curly' | 'bob';
export type HatStyle =
  | 'none' | 'tophat' | 'fedora' | 'cowboy' | 'cap' | 'crown' | 'beanie' | 'party' | 'hardhat' | 'visor' | 'chef'
  | 'beret' | 'halo' | 'horns';
export type TopStyle =
  | 'suit' | 'tux' | 'tshirt' | 'hawaiian' | 'hoodie' | 'dress' | 'vest' | 'sequin' | 'overalls' | 'tank' | 'jacket' | 'trench';
export type BottomStyle = 'pants' | 'shorts' | 'skirt';
export type EyeStyle = 'dots' | 'lashes' | 'sleepy' | 'wide' | 'cool';
export type FacialHair = 'none' | 'mustache' | 'handlebar' | 'beard' | 'goatee';
export type Eyewear = 'none' | 'shades' | 'glasses' | 'aviators' | 'monocle' | 'hearts' | 'stars';
export type Neckwear = 'none' | 'tie' | 'bowtie' | 'chain' | 'scarf' | 'pearls' | 'camera';
export type BodyShape = 'slim' | 'regular' | 'round' | 'tall';
export type Prop = 'none' | 'broom' | 'wrench' | 'radio' | 'cashbag' | 'shaker' | 'mic' | 'cane' | 'phone' | 'cocktail';

export interface Appearance {
  skin: number;
  body: BodyShape;
  hair: HairStyle;
  hairColor: number;
  hat: HatStyle;
  hatColor: number;
  top: TopStyle;
  topColor: number;
  accentColor: number;
  bottom: BottomStyle;
  bottomColor: number;
  shoeColor: number;
  eyes: EyeStyle;
  facialHair: FacialHair;
  eyewear: Eyewear;
  neck: Neckwear;
  neckColor: number;
  blush: boolean;
  prop: Prop;
}

export const SKIN_TONES = [0xffe3cc, 0xf7cfae, 0xeab58f, 0xd59b6c, 0xb87b4f, 0x93603a, 0x6f4528, 0x4d2e1a];
export const FANTASY_SKINS = [0x9fe0a0, 0x8fb8ff, 0xd9a6ff, 0xb0b0b8];
export const HAIR_COLORS = [
  0x1b1410, 0x3b2416, 0x6b4226, 0xa0652e, 0xd9a441, 0xf2dc8a, 0xb8b8c0, 0xf2f2f2, 0xc0392b, 0xff5fae, 0x3aa0ff, 0x35d07a, 0x9b59ff,
];
export const CLOTH_COLORS = [
  0x17151f, 0xf4f1ea, 0xc8102e, 0x1f4fbf, 0x1e7a46, 0xf2b632, 0x6a2cc2, 0xff6fb5, 0x2fb8c9, 0xff8a1f, 0x7a4a2a, 0x8a8f99,
  0x0f1f4a, 0x5a0f24, 0xe8d5a8, 0x3ddc84,
];

export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'short', label: 'Short' }, { id: 'slick', label: 'Pompadour' }, { id: 'spiky', label: 'Spiky' },
  { id: 'buzz', label: 'Buzz' }, { id: 'long', label: 'Long' }, { id: 'bob', label: 'Bob' },
  { id: 'ponytail', label: 'Ponytail' }, { id: 'bun', label: 'Bun' }, { id: 'curly', label: 'Curly' },
  { id: 'afro', label: 'Afro' }, { id: 'mohawk', label: 'Mohawk' }, { id: 'bald', label: 'Bald' },
];
export const HAT_STYLES: { id: HatStyle; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'tophat', label: 'Top Hat' }, { id: 'fedora', label: 'Fedora' },
  { id: 'cowboy', label: 'Cowboy' }, { id: 'cap', label: 'Cap' }, { id: 'crown', label: 'Crown' },
  { id: 'beanie', label: 'Beanie' }, { id: 'beret', label: 'Beret' }, { id: 'party', label: 'Party' },
  { id: 'chef', label: 'Chef' }, { id: 'hardhat', label: 'Hard Hat' }, { id: 'visor', label: 'Visor' },
  { id: 'halo', label: 'Halo' }, { id: 'horns', label: 'Horns' },
];
export const TOP_STYLES: { id: TopStyle; label: string }[] = [
  { id: 'suit', label: 'Suit' }, { id: 'tux', label: 'Tuxedo' }, { id: 'sequin', label: 'Sequins' },
  { id: 'vest', label: 'Vest' }, { id: 'hawaiian', label: 'Hawaiian' }, { id: 'tshirt', label: 'T-Shirt' },
  { id: 'hoodie', label: 'Hoodie' }, { id: 'jacket', label: 'Jacket' }, { id: 'dress', label: 'Dress' },
  { id: 'tank', label: 'Tank' }, { id: 'overalls', label: 'Overalls' }, { id: 'trench', label: 'Trench' },
];
export const BOTTOM_STYLES: { id: BottomStyle; label: string }[] = [
  { id: 'pants', label: 'Pants' }, { id: 'shorts', label: 'Shorts' }, { id: 'skirt', label: 'Skirt' },
];
export const EYE_STYLES: { id: EyeStyle; label: string }[] = [
  { id: 'dots', label: 'Classic' }, { id: 'lashes', label: 'Lashes' }, { id: 'wide', label: 'Wide' },
  { id: 'sleepy', label: 'Sleepy' }, { id: 'cool', label: 'Cool' },
];
export const FACIAL_HAIR: { id: FacialHair; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'mustache', label: 'Mustache' }, { id: 'handlebar', label: 'Handlebar' },
  { id: 'goatee', label: 'Goatee' }, { id: 'beard', label: 'Beard' },
];
export const EYEWEAR: { id: Eyewear; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'shades', label: 'Shades' }, { id: 'aviators', label: 'Aviators' },
  { id: 'glasses', label: 'Glasses' }, { id: 'monocle', label: 'Monocle' }, { id: 'hearts', label: 'Hearts' },
  { id: 'stars', label: 'Stars' },
];
export const NECKWEAR: { id: Neckwear; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'tie', label: 'Tie' }, { id: 'bowtie', label: 'Bow Tie' },
  { id: 'chain', label: 'Gold Chain' }, { id: 'pearls', label: 'Pearls' }, { id: 'scarf', label: 'Scarf' },
  { id: 'camera', label: 'Camera' },
];
export const BODY_SHAPES: { id: BodyShape; label: string }[] = [
  { id: 'regular', label: 'Regular' }, { id: 'slim', label: 'Slim' }, { id: 'round', label: 'Round' }, { id: 'tall', label: 'Tall' },
];
export const PROPS: { id: Prop; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'cane', label: 'Cane' }, { id: 'cocktail', label: 'Cocktail' },
  { id: 'phone', label: 'Phone' }, { id: 'mic', label: 'Mic' },
];

export function defaultAppearance(): Appearance {
  return {
    skin: SKIN_TONES[2],
    body: 'regular',
    hair: 'slick',
    hairColor: HAIR_COLORS[1],
    hat: 'none',
    hatColor: CLOTH_COLORS[0],
    top: 'suit',
    topColor: 0x6a2cc2,
    accentColor: 0xf4f1ea,
    bottom: 'pants',
    bottomColor: 0x17151f,
    shoeColor: 0x17151f,
    eyes: 'dots',
    facialHair: 'none',
    eyewear: 'none',
    neck: 'tie',
    neckColor: 0xf2b632,
    blush: true,
    prop: 'none',
  };
}

export const PLAYER_PRESETS: { name: string; look: Partial<Appearance> }[] = [
  { name: 'The Tycoon', look: { top: 'suit', topColor: 0x6a2cc2, accentColor: 0xf4f1ea, neck: 'tie', neckColor: 0xf2b632, hair: 'slick', hat: 'none', eyewear: 'none', bottomColor: 0x17151f, facialHair: 'none', prop: 'none' } },
  { name: 'High Roller', look: { top: 'tux', topColor: 0x17151f, accentColor: 0xf4f1ea, neck: 'bowtie', neckColor: 0xc8102e, hat: 'tophat', hatColor: 0x17151f, eyewear: 'monocle', facialHair: 'handlebar', bottomColor: 0x17151f, prop: 'cane' } },
  { name: 'Vegas King', look: { top: 'sequin', topColor: 0xf4f1ea, accentColor: 0xf2b632, hair: 'slick', hairColor: 0x1b1410, hat: 'none', eyewear: 'aviators', neck: 'chain', bottomColor: 0xf4f1ea, facialHair: 'none', prop: 'mic' } },
  { name: 'Cowboy', look: { top: 'jacket', topColor: 0x7a4a2a, accentColor: 0xe8d5a8, hat: 'cowboy', hatColor: 0x7a4a2a, facialHair: 'mustache', neck: 'scarf', neckColor: 0xc8102e, eyewear: 'none', bottomColor: 0x1f4fbf, prop: 'none' } },
  { name: 'Tech Mogul', look: { top: 'hoodie', topColor: 0x8a8f99, accentColor: 0x17151f, hat: 'none', eyewear: 'glasses', neck: 'none', hair: 'short', bottomColor: 0x0f1f4a, facialHair: 'none', prop: 'phone' } },
  { name: 'Mob Boss', look: { top: 'suit', topColor: 0x17151f, accentColor: 0x5a0f24, hat: 'fedora', hatColor: 0x17151f, eyewear: 'shades', neck: 'tie', neckColor: 0xc8102e, facialHair: 'none', bottomColor: 0x17151f, prop: 'none' } },
  { name: 'Royalty', look: { top: 'sequin', topColor: 0x6a2cc2, accentColor: 0xf2b632, hat: 'crown', hatColor: 0xf2b632, eyewear: 'none', neck: 'pearls', bottomColor: 0x6a2cc2, facialHair: 'none', prop: 'cane' } },
  { name: 'Beach Boss', look: { top: 'hawaiian', topColor: 0x2fb8c9, accentColor: 0xff6fb5, hat: 'cap', hatColor: 0xff8a1f, eyewear: 'shades', bottom: 'shorts', bottomColor: 0xe8d5a8, neck: 'none', facialHair: 'none', prop: 'cocktail' } },
];

const NATURAL_HAIR = HAIR_COLORS.slice(0, 8);

export function randomCustomerAppearance(): Appearance {
  const a = defaultAppearance();
  a.skin = pick(SKIN_TONES);
  a.body = pick(['regular', 'regular', 'slim', 'round', 'tall'] as BodyShape[]);
  a.hair = pick(['short', 'short', 'long', 'bob', 'ponytail', 'bun', 'curly', 'afro', 'buzz', 'spiky', 'slick', 'bald', 'mohawk'] as HairStyle[]);
  a.hairColor = chance(0.12) ? pick(HAIR_COLORS) : pick(NATURAL_HAIR);
  a.top =
    pickWeighted<TopStyle>(
      ['tshirt', 'hawaiian', 'suit', 'dress', 'hoodie', 'vest', 'jacket', 'tank', 'sequin', 'tux'],
      (t) => ({ tshirt: 24, hawaiian: 10, suit: 12, dress: 13, hoodie: 10, vest: 8, jacket: 11, tank: 6, sequin: 4, tux: 2 } as Record<string, number>)[t],
    ) ?? 'tshirt';
  a.topColor = pick(CLOTH_COLORS);
  a.accentColor = pick(CLOTH_COLORS);
  a.bottom = a.top === 'dress' ? 'skirt' : (pickWeighted<BottomStyle>(['pants', 'shorts', 'skirt'], (b) => ({ pants: 62, shorts: 20, skirt: 18 })[b]) ?? 'pants');
  a.bottomColor = pick([0x17151f, 0x0f1f4a, 0x1f4fbf, 0x8a8f99, 0x7a4a2a, 0xe8d5a8, 0x5a0f24, 0x17151f]);
  a.shoeColor = pick([0x17151f, 0xf4f1ea, 0x7a4a2a, 0xc8102e, 0x17151f]);
  a.hat = chance(0.26) ? pick(['fedora', 'cap', 'cowboy', 'beanie', 'beret', 'party', 'tophat'] as HatStyle[]) : 'none';
  a.hatColor = pick(CLOTH_COLORS);
  a.eyes = pick(['dots', 'dots', 'lashes', 'wide', 'sleepy'] as EyeStyle[]);
  a.eyewear = chance(0.2) ? pick(['shades', 'glasses', 'aviators', 'glasses'] as Eyewear[]) : 'none';
  a.facialHair = chance(0.16) ? pick(['mustache', 'beard', 'goatee', 'handlebar'] as FacialHair[]) : 'none';
  a.neck =
    a.top === 'suit' || a.top === 'tux'
      ? pick(['tie', 'bowtie', 'none'] as Neckwear[])
      : chance(0.12)
        ? pick(['chain', 'pearls', 'scarf'] as Neckwear[])
        : 'none';
  a.neckColor = pick(CLOTH_COLORS);
  a.blush = chance(0.45);
  a.prop = chance(0.08) ? pick(['phone', 'cocktail'] as Prop[]) : 'none';
  return a;
}

export function vipAppearance(): Appearance {
  const a = randomCustomerAppearance();
  a.top = pick(['tux', 'sequin', 'suit', 'sequin'] as TopStyle[]);
  a.topColor = pick([0x17151f, 0xf2b632, 0x6a2cc2, 0xf4f1ea, 0x5a0f24]);
  a.accentColor = 0xf2b632;
  a.bottom = 'pants';
  a.bottomColor = a.topColor === 0xf4f1ea ? 0xf4f1ea : 0x17151f;
  a.hat = pick(['tophat', 'none', 'crown', 'fedora'] as HatStyle[]);
  a.hatColor = pick([0x17151f, 0xf4f1ea]);
  a.eyewear = pick(['shades', 'aviators', 'monocle', 'none'] as Eyewear[]);
  a.neck = pick(['chain', 'bowtie', 'pearls'] as Neckwear[]);
  a.neckColor = 0xc8102e;
  a.prop = pick(['cane', 'cocktail', 'none'] as Prop[]);
  return a;
}

export function cheaterAppearance(): Appearance {
  const a = randomCustomerAppearance();
  a.top = 'trench';
  a.topColor = pick([0xc9a66b, 0x8a8f99, 0x4a4035]);
  a.accentColor = 0x2b2b35;
  a.bottom = 'pants';
  a.bottomColor = 0x2b2b35;
  a.hat = 'fedora';
  a.hatColor = pick([0x2b2b35, 0x4a4035]);
  a.eyewear = 'shades';
  a.neck = 'none';
  a.prop = 'none';
  return a;
}

export function touristAppearance(): Appearance {
  const a = randomCustomerAppearance();
  a.top = 'hawaiian';
  a.topColor = pick([0xff6fb5, 0x2fb8c9, 0xff8a1f, 0x3ddc84, 0xf2b632]);
  a.accentColor = pick([0xf4f1ea, 0xff6fb5, 0xf2b632]);
  a.bottom = 'shorts';
  a.bottomColor = pick([0xe8d5a8, 0x1f4fbf, 0xf4f1ea]);
  a.hat = pick(['cap', 'visor', 'none'] as HatStyle[]);
  a.hatColor = pick(CLOTH_COLORS);
  a.neck = 'camera';
  a.eyewear = pick(['shades', 'none'] as Eyewear[]);
  return a;
}

export type StaffRole = 'janitor' | 'technician' | 'security' | 'cashier' | 'dealer' | 'bartender' | 'performer';

/** Uniform pieces forced onto a staff member's personal look. */
export function applyUniform(a: Appearance, role: StaffRole): Appearance {
  const u = { ...a };
  switch (role) {
    case 'janitor':
      Object.assign(u, { top: 'overalls', topColor: 0x1f4fbf, accentColor: 0xd9dde6, bottom: 'pants', bottomColor: 0x1f4fbf, hat: 'cap', hatColor: 0x1f4fbf, prop: 'broom', neck: 'none' });
      break;
    case 'technician':
      Object.assign(u, { top: 'overalls', topColor: 0xff8a1f, accentColor: 0x3a3a44, bottom: 'pants', bottomColor: 0xff8a1f, hat: 'hardhat', hatColor: 0xffd23f, prop: 'wrench', neck: 'none' });
      break;
    case 'security':
      Object.assign(u, { top: 'suit', topColor: 0x17151f, accentColor: 0xf4f1ea, bottom: 'pants', bottomColor: 0x17151f, hat: 'none', eyewear: 'shades', neck: 'tie', neckColor: 0x17151f, prop: 'radio' });
      break;
    case 'cashier':
      Object.assign(u, { top: 'vest', topColor: 0x1e7a46, accentColor: 0xf4f1ea, bottom: 'pants', bottomColor: 0x17151f, hat: 'visor', hatColor: 0x1e7a46, neck: 'bowtie', neckColor: 0xf2b632, prop: 'cashbag' });
      break;
    case 'dealer':
      Object.assign(u, { top: 'vest', topColor: 0x17151f, accentColor: 0xf4f1ea, bottom: 'pants', bottomColor: 0x17151f, hat: 'none', neck: 'bowtie', neckColor: 0xc8102e, prop: 'none', eyewear: 'none' });
      break;
    case 'bartender':
      Object.assign(u, { top: 'vest', topColor: 0x5a0f24, accentColor: 0xf4f1ea, bottom: 'pants', bottomColor: 0x17151f, hat: 'none', neck: 'bowtie', neckColor: 0x17151f, prop: 'shaker' });
      break;
    case 'performer':
      Object.assign(u, { top: 'sequin', topColor: pick([0xf2b632, 0xff6fb5, 0xf4f1ea]), accentColor: 0xf2b632, hair: 'slick', hairColor: 0x1b1410, eyewear: 'aviators', neck: 'chain', prop: 'mic', hat: 'none' });
      break;
  }
  return u;
}

export function randomStaffAppearance(role: StaffRole): Appearance {
  const base = randomCustomerAppearance();
  base.eyewear = 'none';
  base.hat = 'none';
  return applyUniform(base, role);
}

export function randomPlayerAppearance(): Appearance {
  const a = randomCustomerAppearance();
  if (chance(0.3)) a.skin = pick(FANTASY_SKINS);
  a.top = pick(TOP_STYLES).id;
  a.hat = chance(0.5) ? pick(HAT_STYLES).id : 'none';
  a.eyewear = chance(0.4) ? pick(EYEWEAR).id : 'none';
  a.neck = chance(0.6) ? pick(NECKWEAR).id : 'none';
  a.prop = chance(0.4) ? pick(PROPS).id : 'none';
  return a;
}
