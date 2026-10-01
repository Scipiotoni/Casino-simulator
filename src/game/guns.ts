/**
 * Guns (and melee weapons) from Bullseye Guns. They only fire out on the streets and sidewalks (never inside a
 * building): tin cans, bottles, balloons, car windows and people are fair game. Knock
 * someone out and you take some of the cash they carry.
 */
export type GunKind = 'pistol' | 'revolver' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'minigun' | 'laser' | 'paint' | 'confetti' | 'cannon'
  | 'knuckles' | 'bat' | 'golf' | 'katana' | 'hammer';

export interface GunDef {
  id: string;
  name: string;
  kind: GunKind;
  price: number;
  /** Casino level needed to buy it. */
  unlock: number;
  /** Shots per second. */
  rate: number;
  /** Keeps firing while you hold the trigger. */
  auto: boolean;
  mag: number;
  reload: number;
  pellets: number;
  /** Spread in radians. */
  spread: number;
  range: number;
  /** Main colour of the gun body. */
  color: number;
  /** Tracer / beam colour. */
  tracer: number;
  /** Held with both hands. */
  twoHand: boolean;
  /** Damage per bullet (pellet) to people out on the street; headshots do double. */
  dmg: number;
  /** Field of view while aiming down the sights (first person). */
  adsFov: number;
  /** A melee weapon: swings instead of shooting (no ammo, short reach = range). */
  melee?: boolean;
  blurb: string;
}

export const GUNS: GunDef[] = [
  { id: 'paintball', name: 'Paintball Marker', kind: 'paint', price: 800, unlock: 1, rate: 5, auto: true, mag: 30, reload: 1.4, pellets: 1, spread: 0.04, range: 30, color: 0x2fb8c9, tracer: 0xff6fb5, twoHand: true, dmg: 6, adsFov: 52, blurb: 'Splats bright paint on everything. Stings a little.' },
  { id: 'pistol', name: 'Pocket Pistol', kind: 'pistol', price: 1200, unlock: 1, rate: 3, auto: false, mag: 12, reload: 1.1, pellets: 1, spread: 0.02, range: 40, color: 0x2b2b35, tracer: 0xffd27a, twoHand: false, dmg: 24, adsFov: 55, blurb: 'Small, light and quick to reload.' },
  { id: 'revolver', name: 'Six-Shooter', kind: 'revolver', price: 3500, unlock: 2, rate: 1.6, auto: false, mag: 6, reload: 1.9, pellets: 1, spread: 0.012, range: 50, color: 0x9aa0ab, tracer: 0xffd27a, twoHand: false, dmg: 48, adsFov: 50, blurb: 'A classic Western revolver. Loud and accurate.' },
  { id: 'confetti', name: 'Confetti Cannon', kind: 'confetti', price: 6000, unlock: 3, rate: 1.4, auto: false, mag: 8, reload: 2, pellets: 1, spread: 0.03, range: 28, color: 0xff6fb5, tracer: 0xffc53d, twoHand: true, dmg: 0, adsFov: 55, blurb: 'Every shot is a party: confetti explodes wherever it lands. Hurts nobody.' },
  { id: 'shotgun', name: 'Pump Shotgun', kind: 'shotgun', price: 9000, unlock: 4, rate: 1.1, auto: false, mag: 6, reload: 2.4, pellets: 8, spread: 0.13, range: 24, color: 0x6b4422, tracer: 0xffd27a, twoHand: true, dmg: 13, adsFov: 58, blurb: 'Eight pellets a shot. Clears a whole row of cans.' },
  { id: 'smg', name: 'Compact SMG', kind: 'smg', price: 14000, unlock: 5, rate: 11, auto: true, mag: 32, reload: 1.6, pellets: 1, spread: 0.06, range: 40, color: 0x17151f, tracer: 0xffd27a, twoHand: false, dmg: 14, adsFov: 55, blurb: 'Hold the trigger: 32 rounds in under three seconds.' },
  { id: 'rifle', name: 'Assault Rifle', kind: 'rifle', price: 28000, unlock: 7, rate: 8, auto: true, mag: 30, reload: 2, pellets: 1, spread: 0.025, range: 70, color: 0x4a4f3a, tracer: 0xffd27a, twoHand: true, dmg: 22, adsFov: 45, blurb: 'Full auto, long range, steady aim.' },
  { id: 'sniper', name: 'Sniper Rifle', kind: 'sniper', price: 45000, unlock: 8, rate: 0.8, auto: false, mag: 5, reload: 2.6, pellets: 1, spread: 0.002, range: 140, color: 0x2a3a2a, tracer: 0xfff2c8, twoHand: true, dmg: 95, adsFov: 14, blurb: 'Hits a tin can three blocks away.' },
  { id: 'goldcannon', name: 'Golden Hand Cannon', kind: 'cannon', price: 75000, unlock: 9, rate: 1.5, auto: false, mag: 7, reload: 1.8, pellets: 1, spread: 0.01, range: 60, color: 0xf2b632, tracer: 0xffc53d, twoHand: false, dmg: 70, adsFov: 48, blurb: 'Solid gold, ridiculous kick, enormous bang.' },
  { id: 'laser', name: 'Laser Blaster', kind: 'laser', price: 120000, unlock: 11, rate: 6, auto: true, mag: 40, reload: 1.5, pellets: 1, spread: 0.01, range: 80, color: 0xe9e1d3, tracer: 0x2fe6ff, twoHand: true, dmg: 20, adsFov: 45, blurb: 'Pew pew. Cyan beams straight out of a sci-fi movie.' },
  { id: 'minigun', name: 'Minigun', kind: 'minigun', price: 250000, unlock: 13, rate: 20, auto: true, mag: 200, reload: 3.2, pellets: 1, spread: 0.07, range: 60, color: 0x3a3c44, tracer: 0xffb45a, twoHand: true, dmg: 10, adsFov: 55, blurb: 'Six spinning barrels and two hundred rounds.' },
];

/** Melee weapons (also sold at Bullseye Guns). Swing rate, reach in metres. */
GUNS.push(
  { id: 'knuckles', name: 'Gold Knuckles', kind: 'knuckles', price: 400, unlock: 1, rate: 3, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.5, range: 1.7, color: 0xf2b632, tracer: 0xffffff, twoHand: false, dmg: 18, adsFov: 60, melee: true, blurb: 'Quick jabs. Fits in a pocket.' },
  { id: 'bat', name: 'Baseball Bat', kind: 'bat', price: 900, unlock: 1, rate: 1.6, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.3, color: 0xc89b5a, tracer: 0xffffff, twoHand: true, dmg: 34, adsFov: 60, melee: true, blurb: 'A home run every time.' },
  { id: 'golf', name: 'Golf Club', kind: 'golf', price: 2500, unlock: 2, rate: 1.4, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.5, color: 0xd8dde3, tracer: 0xffffff, twoHand: true, dmg: 30, adsFov: 60, melee: true, blurb: 'Fore! For the high rollers.' },
  { id: 'katana', name: 'Katana', kind: 'katana', price: 15000, unlock: 5, rate: 2.2, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.7, range: 2.6, color: 0xe8eef6, tracer: 0xffffff, twoHand: true, dmg: 45, adsFov: 60, melee: true, blurb: 'A gleaming blade. Fast and deadly.' },
  { id: 'hammer', name: 'Sledgehammer', kind: 'hammer', price: 6000, unlock: 3, rate: 0.8, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.4, color: 0x5a5d66, tracer: 0xffffff, twoHand: true, dmg: 70, adsFov: 60, melee: true, blurb: 'Slow, heavy, devastating.' },
);

/** Number of weapon slots (keys 1–5). */
export const SLOTS = 5;

export function gunDef(id: string | null | undefined): GunDef | null {
  return GUNS.find((g) => g.id === id) ?? null;
}

export interface GunState {
  owned: string[];
  /** The gun in your hand (null = holstered). */
  equipped: string | null;
  /** What's on keys 1–5 (weapon ids, null = empty). */
  slots: (string | null)[];
}

export function emptyGuns(): GunState {
  return { owned: [], equipped: null, slots: Array(SLOTS).fill(null) };
}

/** Put a new weapon on the first free slot (if there is one). */
export function autoSlot(st: GunState, id: string): void {
  if (st.slots.includes(id)) return;
  const i = st.slots.indexOf(null);
  if (i >= 0) st.slots[i] = id;
}

export function sanitizeGuns(raw: unknown): GunState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const owned = Array.isArray(r.owned) ? [...new Set(r.owned.filter((x): x is string => typeof x === 'string' && !!gunDef(x)))] : [];
  const eq = typeof r.equipped === 'string' && owned.includes(r.equipped) ? r.equipped : null;
  const given = Array.isArray(r.slots) ? (r.slots as unknown[]) : null;
  const slots: (string | null)[] = Array(SLOTS).fill(null);
  if (given) {
    given.slice(0, SLOTS).forEach((x, i) => {
      if (typeof x === 'string' && owned.includes(x) && !slots.includes(x)) slots[i] = x;
    });
  } else {
    // Older saves: put the guns you own on the slots in order.
    owned.slice(0, SLOTS).forEach((x, i) => (slots[i] = x));
  }
  return { owned, equipped: eq, slots };
}
