/**
 * Guns (and melee weapons) from Bullseye Guns. They only fire out on the streets and sidewalks (never inside a
 * building): tin cans, bottles, balloons, car windows and people are fair game. Knock
 * someone out and you take some of the cash they carry.
 */
export type GunKind = 'pistol' | 'revolver' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'minigun' | 'laser' | 'paint' | 'confetti' | 'cannon'
  | 'launcher' | 'rocket' | 'railgun' | 'flamer'
  | 'fists' | 'knuckles' | 'bat' | 'golf' | 'katana' | 'hammer';

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
  /** Rounds fired per trigger pull (burst rifles), this many seconds apart. */
  burst?: number;
  burstGap?: number;
  /** Hold to charge (seconds to full power); releasing fires. Damage grows with the charge. */
  charge?: number;
  /** Goes through people (up to this many) instead of stopping at the first. */
  pierce?: number;
  /** Fires a projectile (m/s, gravity m/s²) instead of a bullet. */
  projectile?: { speed: number; gravity: number };
  /** Explodes where it lands: radius (m) and power (damage at the centre). */
  explosive?: { radius: number; power: number };
  /** A short cone of fire instead of bullets. */
  flame?: boolean;
  /** Headshot multiplier (default ×2; the sniper knocks out with one). */
  headMul?: number;
  /** How hard it kicks the view up per shot (radians; default by type). */
  kick?: number;
  /** Not sold anywhere: everyone has it (your fists). */
  builtin?: boolean;
  /** Not sold anywhere: stolen from the secret lab under Fort Mojave. */
  secret?: boolean;
  blurb: string;
}

export const GUNS: GunDef[] = [
  { id: 'paintball', name: 'Paintball Marker', kind: 'paint', price: 800, unlock: 1, rate: 5, auto: true, mag: 30, reload: 1.4, pellets: 1, spread: 0.04, range: 30, color: 0x2fb8c9, tracer: 0xff6fb5, twoHand: true, dmg: 6, adsFov: 52, blurb: 'Splats bright paint on everything. Stings a little.' },
  { id: 'pistol', name: 'Pocket Pistol', kind: 'pistol', price: 1200, unlock: 1, rate: 3, auto: false, mag: 12, reload: 1.1, pellets: 1, spread: 0.02, range: 40, color: 0x2b2b35, tracer: 0xffd27a, twoHand: false, dmg: 24, adsFov: 55, blurb: 'Small, light and quick to reload.' },
  { id: 'revolver', name: 'Six-Shooter', kind: 'revolver', price: 3500, unlock: 2, rate: 1.6, auto: false, mag: 6, reload: 1.9, pellets: 1, spread: 0.012, range: 50, color: 0x9aa0ab, tracer: 0xffd27a, twoHand: false, dmg: 48, adsFov: 50, blurb: 'A classic Western revolver. Loud and accurate.' },
  { id: 'confetti', name: 'Confetti Cannon', kind: 'confetti', price: 6000, unlock: 3, rate: 1.4, auto: false, mag: 8, reload: 2, pellets: 1, spread: 0.03, range: 28, color: 0xff6fb5, tracer: 0xffc53d, twoHand: true, dmg: 0, adsFov: 55, blurb: 'Every shot is a party: confetti explodes wherever it lands. Hurts nobody.' },
  { id: 'shotgun', name: 'Pump Shotgun', kind: 'shotgun', price: 9000, unlock: 4, rate: 1.1, auto: false, mag: 6, reload: 2.4, pellets: 10, spread: 0.2, range: 24, color: 0x6b4422, tracer: 0xffd27a, twoHand: true, dmg: 20, adsFov: 58, blurb: 'Ten heavy pellets in a wide cone. Devastating up close.' },
  { id: 'smg', name: 'Compact SMG', kind: 'smg', price: 14000, unlock: 5, rate: 11, auto: true, mag: 32, reload: 1.6, pellets: 1, spread: 0.06, range: 40, color: 0x17151f, tracer: 0xffd27a, twoHand: false, dmg: 14, adsFov: 55, blurb: 'Hold the trigger: 32 rounds in under three seconds.' },
  { id: 'rifle', name: 'Assault Rifle', kind: 'rifle', price: 28000, unlock: 7, rate: 8, auto: true, mag: 30, reload: 2, pellets: 1, spread: 0.025, range: 70, color: 0x4a4f3a, tracer: 0xffd27a, twoHand: true, dmg: 22, adsFov: 45, blurb: 'Full auto, long range, steady aim.' },
  { id: 'sniper', name: 'Sniper Rifle', kind: 'sniper', price: 45000, unlock: 8, rate: 0.8, auto: false, mag: 5, reload: 2.6, pellets: 1, spread: 0, range: 200, color: 0x2a3a2a, tracer: 0xfff2c8, twoHand: true, dmg: 95, adsFov: 14, blurb: 'Pinpoint precise: the bullet goes exactly where the crosshair is. One shot to the head knocks anyone out.' },
  { id: 'goldcannon', name: 'Golden Hand Cannon', kind: 'cannon', price: 75000, unlock: 9, rate: 1.5, auto: false, mag: 7, reload: 1.8, pellets: 1, spread: 0.01, range: 60, color: 0xf2b632, tracer: 0xffc53d, twoHand: false, dmg: 70, adsFov: 48, blurb: 'Solid gold, ridiculous kick, enormous bang.' },
  { id: 'laser', name: 'Laser Blaster', kind: 'laser', price: 120000, unlock: 11, rate: 6, auto: true, mag: 40, reload: 1.5, pellets: 1, spread: 0.01, range: 80, color: 0xe9e1d3, tracer: 0x2fe6ff, twoHand: true, dmg: 20, adsFov: 45, blurb: 'Pew pew. Cyan beams straight out of a sci-fi movie.' },
  { id: 'deagle', name: 'Desert Eagle', kind: 'pistol', price: 11000, unlock: 4, rate: 1.8, auto: false, mag: 7, reload: 1.5, pellets: 1, spread: 0.014, range: 55, color: 0x8c9099, tracer: 0xffd27a, twoHand: false, dmg: 52, headMul: 2.5, kick: 0.07, adsFov: 50, blurb: 'A heavy hand cannon. Big kick, ×2.5 headshots: land your first shot.' },
  { id: 'tommy', name: 'Tommy Gun', kind: 'smg', price: 22000, unlock: 6, rate: 10, auto: true, mag: 50, reload: 2.2, pellets: 1, spread: 0.065, range: 40, color: 0x6b4422, tracer: 0xffd27a, twoHand: true, dmg: 13, adsFov: 55, blurb: 'Fifty-round drum, gangster style. Climbs fast: pull it down.' },
  { id: 'burst', name: 'Burst Rifle', kind: 'rifle', price: 38000, unlock: 8, rate: 2.6, auto: false, burst: 3, burstGap: 0.065, mag: 30, reload: 2, pellets: 1, spread: 0.014, range: 75, color: 0x3a4a5a, tracer: 0xffd27a, twoHand: true, dmg: 25, adsFov: 44, blurb: 'Three rounds per pull, tight and quick. Rewards a steady aim.' },
  { id: 'dmr', name: 'Marksman Rifle', kind: 'sniper', price: 60000, unlock: 9, rate: 2.2, auto: false, mag: 10, reload: 2.2, pellets: 1, spread: 0.004, range: 140, color: 0x5a5d66, tracer: 0xfff2c8, twoHand: true, dmg: 58, headMul: 2.2, kick: 0.045, adsFov: 26, blurb: 'Semi-auto and scoped: fast follow-ups for those who can track a target.' },
  { id: 'lmg', name: 'Light Machine Gun', kind: 'rifle', price: 90000, unlock: 10, rate: 9.5, auto: true, mag: 100, reload: 4, pellets: 1, spread: 0.05, range: 65, color: 0x2c2f26, tracer: 0xffb45a, twoHand: true, dmg: 18, kick: 0.011, adsFov: 50, blurb: 'A hundred rounds of suppression. Slow to reload: don’t run dry mid-fight.' },
  { id: 'gl', name: 'Grenade Launcher', kind: 'launcher', price: 110000, unlock: 10, rate: 0.9, auto: false, mag: 6, reload: 3, pellets: 1, spread: 0.01, range: 60, color: 0x4a4f3a, tracer: 0xffc53d, twoHand: true, dmg: 0, projectile: { speed: 26, gravity: 14 }, explosive: { radius: 4.5, power: 80 }, kick: 0.05, adsFov: 55, blurb: 'Lobs grenades in an arc that blow up on impact. Lead your target, mind the splash.' },
  { id: 'flamer', name: 'Flamethrower', kind: 'flamer', price: 180000, unlock: 12, rate: 14, auto: true, mag: 120, reload: 3, pellets: 1, spread: 0.3, range: 9, color: 0xc8102e, tracer: 0xff8a1f, twoHand: true, dmg: 4, flame: true, kick: 0, adsFov: 60, blurb: 'A roaring cone of fire, nine metres long. Get close and keep it on them.' },
  { id: 'rpg', name: 'Rocket Launcher', kind: 'rocket', price: 300000, unlock: 14, rate: 0.5, auto: false, mag: 1, reload: 3.2, pellets: 1, spread: 0.004, range: 140, color: 0x3d4a2a, tracer: 0xffc53d, twoHand: true, dmg: 0, projectile: { speed: 42, gravity: 0 }, explosive: { radius: 6, power: 140 }, kick: 0.09, adsFov: 45, blurb: 'One rocket, a huge blast. Wrecks cars. Hit what you aim at, not your feet.' },
  { id: 'railgun', name: 'Railgun', kind: 'railgun', price: 400000, unlock: 15, rate: 0.8, auto: false, mag: 5, reload: 2.6, pellets: 1, spread: 0, range: 180, color: 0x1b2748, tracer: 0x9b7bff, twoHand: true, dmg: 120, charge: 1.1, pierce: 3, headMul: 2, kick: 0.08, adsFov: 30, blurb: 'Hold to charge, release to fire a beam that goes through up to three people. Full charge is deadly.' },
  { id: 'minigun', name: 'Minigun', kind: 'minigun', price: 250000, unlock: 13, rate: 20, auto: true, mag: 200, reload: 3.2, pellets: 1, spread: 0.07, range: 60, color: 0x3a3c44, tracer: 0xffb45a, twoHand: true, dmg: 10, adsFov: 55, blurb: 'Six spinning barrels and two hundred rounds.' },
];

/**
 * The black-site prototypes in the lab under Fort Mojave. Nobody sells these: you have to
 * steal them, one glass case at a time.
 */
GUNS.push(
  { id: 'gauss', secret: true, name: 'Gauss Cannon', kind: 'railgun', price: 0, unlock: 1, rate: 1.1, auto: false, mag: 6, reload: 2.2, pellets: 1, spread: 0, range: 230, color: 0x1b2748, tracer: 0x2fe6ff, twoHand: true, dmg: 260, pierce: 8, headMul: 2, kick: 0.1, adsFov: 26, blurb: 'A magnetic slug through eight people in a row. No charging, no mercy.' },
  { id: 'plasma', secret: true, name: 'Plasma Repeater', kind: 'laser', price: 0, unlock: 1, rate: 12, auto: true, mag: 90, reload: 1.3, pellets: 1, spread: 0.008, range: 120, color: 0x17151f, tracer: 0x39ff88, twoHand: true, dmg: 36, pierce: 2, kick: 0.004, adsFov: 42, blurb: 'Green plasma bolts, twelve a second, through two targets at once.' },
  { id: 'thunder', secret: true, name: 'Thunderbolt Minigun', kind: 'minigun', price: 0, unlock: 1, rate: 32, auto: true, mag: 600, reload: 2.8, pellets: 1, spread: 0.04, range: 95, color: 0x2a2c30, tracer: 0xff3fa4, twoHand: true, dmg: 24, kick: 0.004, adsFov: 52, blurb: 'Six hundred rounds at thirty-two a second. The air turns pink.' },
  { id: 'dragon', secret: true, name: 'Dragon Auto-Shotgun', kind: 'shotgun', price: 0, unlock: 1, rate: 5, auto: true, mag: 32, reload: 2, pellets: 12, spread: 0.15, range: 34, color: 0x7a0717, tracer: 0xff8a1f, twoHand: true, dmg: 34, kick: 0.035, adsFov: 56, blurb: 'Full-auto, twelve heavy pellets a shot, a drum of thirty-two.' },
  { id: 'swarm', secret: true, name: 'Swarm Launcher', kind: 'launcher', price: 0, unlock: 1, rate: 4, auto: true, mag: 16, reload: 2.6, pellets: 1, spread: 0.02, range: 110, color: 0x3a4a5a, tracer: 0xffc53d, twoHand: true, dmg: 0, projectile: { speed: 44, gravity: 2 }, explosive: { radius: 6, power: 170 }, kick: 0.03, adsFov: 50, blurb: 'Hold the trigger: sixteen mini-rockets, four a second.' },
  { id: 'nuke', secret: true, name: 'Micro-Nuke Launcher', kind: 'rocket', price: 0, unlock: 1, rate: 0.35, auto: false, mag: 1, reload: 4.5, pellets: 1, spread: 0.002, range: 200, color: 0xffd23f, tracer: 0xffe46b, twoHand: true, dmg: 0, projectile: { speed: 32, gravity: 3 }, explosive: { radius: 20, power: 900 }, kick: 0.16, adsFov: 45, blurb: 'One tiny warhead, a twenty-metre fireball. Do not fire it at your feet.' },
  { id: 'goldgun', secret: true, name: 'The Golden Gun', kind: 'cannon', price: 0, unlock: 1, rate: 0.9, auto: false, mag: 1, reload: 1.4, pellets: 1, spread: 0, range: 140, color: 0xf2b632, tracer: 0xffd23f, twoHand: false, dmg: 999, headMul: 1, kick: 0.09, adsFov: 40, blurb: 'One golden bullet. One knockout. Every time.' },
);

/** Melee weapons (also sold at Bullseye Guns). Swing rate, reach in metres. */
GUNS.push(
  { id: 'fists', name: 'Fists', kind: 'fists', price: 0, unlock: 1, rate: 3.2, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.55, range: 1.5, color: 0xd8a47a, tracer: 0xffffff, twoHand: false, dmg: 9, adsFov: 60, melee: true, builtin: true, blurb: 'Put ’em up. Everyone has a pair (X or 0).' },
  { id: 'knuckles', name: 'Gold Knuckles', kind: 'knuckles', price: 400, unlock: 1, rate: 3, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.5, range: 1.7, color: 0xf2b632, tracer: 0xffffff, twoHand: false, dmg: 18, adsFov: 60, melee: true, blurb: 'Quick jabs. Fits in a pocket.' },
  { id: 'bat', name: 'Baseball Bat', kind: 'bat', price: 900, unlock: 1, rate: 1.6, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.3, color: 0xc89b5a, tracer: 0xffffff, twoHand: true, dmg: 34, adsFov: 60, melee: true, blurb: 'A home run every time.' },
  { id: 'golf', name: 'Golf Club', kind: 'golf', price: 2500, unlock: 2, rate: 1.4, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.5, color: 0xd8dde3, tracer: 0xffffff, twoHand: true, dmg: 30, adsFov: 60, melee: true, blurb: 'Fore! For the high rollers.' },
  { id: 'katana', name: 'Katana', kind: 'katana', price: 15000, unlock: 5, rate: 2.2, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.7, range: 2.6, color: 0xe8eef6, tracer: 0xffffff, twoHand: true, dmg: 45, adsFov: 60, melee: true, blurb: 'A gleaming blade. Fast and deadly.' },
  { id: 'hammer', name: 'Sledgehammer', kind: 'hammer', price: 6000, unlock: 3, rate: 0.8, auto: false, mag: 0, reload: 0, pellets: 1, spread: 0.6, range: 2.4, color: 0x5a5d66, tracer: 0xffffff, twoHand: true, dmg: 70, adsFov: 60, melee: true, blurb: 'Slow, heavy, devastating.' },
);

// ------------------------------------------------------------------ skill: accuracy, recoil, falloff

/**
 * Damage with distance: full power out to 35% of the gun's range, then down to 55% at the
 * edge. (Melee, flames and blasts don't fall off.)
 */
export function falloff(d: GunDef, dist: number): number {
  if (d.melee || d.flame || d.explosive) return 1;
  const near = d.range * 0.35;
  if (dist <= near) return 1;
  return Math.max(0.55, 1 - ((dist - near) / Math.max(1, d.range - near)) * 0.45);
}

/** Headshot multiplier. */
export function headMul(d: GunDef): number {
  return d.headMul ?? 2;
}

/** How hard each shot kicks the view up (radians). */
export function kickOf(d: GunDef): number {
  if (d.kick !== undefined) return d.kick;
  switch (d.kind) {
    case 'cannon':
    case 'sniper':
      return 0.06;
    case 'shotgun':
      return 0.055;
    case 'revolver':
      return 0.045;
    case 'pistol':
      return 0.028;
    case 'rifle':
      return 0.016;
    case 'smg':
      return 0.013;
    case 'minigun':
    case 'laser':
    case 'paint':
      return 0.006;
    default:
      return 0.03;
  }
}

/**
 * The recoil of the n-th shot in a spray (0 = first): the view climbs a bit more with every
 * shot and wanders side to side in a fixed pattern for each gun, so you can learn to pull
 * against it. Returns [up, sideways] in radians.
 */
export function recoilStep(d: GunDef, n: number): [number, number] {
  const k = kickOf(d);
  const up = k * (1 + Math.min(n, 10) * 0.08);
  // Each gun drifts its own way: a slow sway plus a little kick that alternates.
  const seed = d.id.length * 1.7 + d.rate;
  const side = k * (0.55 * Math.sin(n * 0.55 + seed) + 0.25 * (n % 2 ? 1 : -1)) * Math.min(1, n / 3);
  return [up, side];
}

/**
 * How wide shots spread (a multiplier on the gun's spread). The first shot of a burst, aimed
 * and standing still, is pinpoint; every shot fired in quick succession blooms it open;
 * moving and jumping around makes it worse.
 */
export function spreadMul(d: GunDef, spray: number, moveSpeed: number, aiming: boolean): number {
  if (d.melee || d.flame) return 1;
  const first = spray < 0.5 && moveSpeed < 1;
  const base = aiming ? 0.35 : 0.9;
  const bloom = 1 + Math.min(spray, 12) * (d.auto ? 0.16 : 0.3);
  const move = 1 + Math.min(1.6, (moveSpeed / 4) * 1.4) * (aiming ? 0.6 : 1);
  return (first ? 0.15 : base) * bloom * move;
}

/**
 * Active reload: press reload again while the marker crosses the sweet spot and the magazine
 * snaps in at once (with a damage bonus); miss it and you fumble. Returns where the sweet
 * spot is (fractions of the reload).
 */
export const PERFECT_WINDOW: [number, number] = [0.42, 0.58];
export function reloadPress(progress: number): 'perfect' | 'fumble' {
  return progress >= PERFECT_WINDOW[0] && progress <= PERFECT_WINDOW[1] ? 'perfect' : 'fumble';
}

/** Number of weapon slots (keys 1–5). */
export const SLOTS = 5;
/** Your bare fists: always yours, raised with X (or 0). */
export const FISTS = 'fists';

/** Do you have this weapon (bought, or your fists)? */
export function hasWeapon(owned: readonly string[], id: string): boolean {
  return id === FISTS || owned.includes(id);
}

export function gunDef(id: string | null | undefined): GunDef | null {
  return GUNS.find((g) => g.id === id) ?? null;
}

export interface GunState {
  owned: string[];
  /** The gun in your hand (null = holstered). */
  equipped: string | null;
  /** What's on keys 1–5 (weapon ids, null = empty). */
  slots: (string | null)[];
  /** Skins and attachments per weapon you own. */
  mods: Record<string, GunMods>;
}

export function emptyGuns(): GunState {
  return { owned: [], equipped: null, slots: Array(SLOTS).fill(null), mods: {} };
}

// ------------------------------------------------------------------ customization

export type Sight = 'iron' | 'reddot' | 'holo' | 'scope';
export type Muzzle = 'none' | 'suppressor' | 'compensator';
export type MagSize = 'standard' | 'extended' | 'drum';
export type Charm = 'none' | 'dice' | 'chip' | 'cherry' | 'skull' | 'star';

/** How a weapon you own is customized at Bullseye Guns. */
export interface GunMods {
  skin: string;
  sight: Sight;
  muzzle: Muzzle;
  mag: MagSize;
  laser: boolean;
  charm: Charm;
}

export interface GunSkin {
  id: string;
  name: string;
  price: number;
  /** Main colour (null = the gun's own). */
  color: number | null;
  /** Second colour for grips and frames. */
  accent: number | null;
  metal: number;
  rough: number;
  /** Glows (neon skins). */
  glow?: boolean;
  /** Painted pattern. */
  pattern?: 'camo' | 'carbon' | 'tiger' | 'digital' | 'galaxy';
  swatch: string;
}

export const GUN_SKINS: GunSkin[] = [
  { id: 'stock', name: 'Factory', price: 0, color: null, accent: null, metal: 0.65, rough: 0.32, swatch: 'linear-gradient(135deg,#555,#222)' },
  { id: 'blackout', name: 'Blackout', price: 600, color: 0x111114, accent: 0x0a0a0c, metal: 0.4, rough: 0.6, swatch: '#111114' },
  { id: 'chrome', name: 'Mirror Chrome', price: 2500, color: 0xe8edf2, accent: 0x9aa0ab, metal: 1, rough: 0.06, swatch: 'linear-gradient(135deg,#fff,#9aa0ab)' },
  { id: 'gold', name: '24K Gold', price: 9000, color: 0xf2b632, accent: 0x8a5a12, metal: 1, rough: 0.15, swatch: 'linear-gradient(135deg,#ffe28a,#c98a12)' },
  { id: 'rose', name: 'Rose Gold', price: 7000, color: 0xe8a48c, accent: 0x6b3a30, metal: 1, rough: 0.18, swatch: 'linear-gradient(135deg,#f6c7b6,#b8705a)' },
  { id: 'camo', name: 'Woodland Camo', price: 1500, color: 0xffffff, accent: 0x2f3a22, metal: 0.1, rough: 0.8, pattern: 'camo', swatch: 'radial-gradient(circle at 30% 40%,#4a5a2a 0 25%,#2f3a22 26% 50%,#7a6a3a 51%)' },
  { id: 'desert', name: 'Desert Digital', price: 1500, color: 0xffffff, accent: 0x6b5a3a, metal: 0.1, rough: 0.8, pattern: 'digital', swatch: 'linear-gradient(90deg,#c8a878 0 33%,#9a7a4a 33% 66%,#e2c89a 66%)' },
  { id: 'carbon', name: 'Carbon Fibre', price: 3500, color: 0xffffff, accent: 0x111114, metal: 0.3, rough: 0.35, pattern: 'carbon', swatch: 'repeating-linear-gradient(45deg,#222 0 4px,#3a3a40 4px 8px)' },
  { id: 'tiger', name: 'Tiger Stripe', price: 4000, color: 0xffffff, accent: 0x17151f, metal: 0.2, rough: 0.5, pattern: 'tiger', swatch: 'repeating-linear-gradient(60deg,#ff8a1f 0 6px,#17151f 6px 9px)' },
  { id: 'neonpink', name: 'Neon Pink', price: 6000, color: 0xff3fa4, accent: 0x2a0a1a, metal: 0.3, rough: 0.3, glow: true, swatch: '#ff3fa4' },
  { id: 'neoncyan', name: 'Neon Ice', price: 6000, color: 0x2fe6ff, accent: 0x0a1f2a, metal: 0.3, rough: 0.3, glow: true, swatch: '#2fe6ff' },
  { id: 'galaxy', name: 'Galaxy', price: 15000, color: 0xffffff, accent: 0x1a0d33, metal: 0.4, rough: 0.25, pattern: 'galaxy', swatch: 'radial-gradient(circle at 30% 30%,#b77bff,#1a0d33 60%,#2fe6ff)' },
  { id: 'diamond', name: 'Diamond Encrusted', price: 50000, color: 0xf4fbff, accent: 0xbfe8ff, metal: 0.9, rough: 0.02, glow: true, swatch: 'linear-gradient(135deg,#fff,#bfe8ff,#fff)' },
];

export const SIGHTS: { id: Sight; name: string; price: number; blurb: string }[] = [
  { id: 'iron', name: 'Iron sights', price: 0, blurb: 'What it came with.' },
  { id: 'reddot', name: 'Red dot', price: 900, blurb: 'Aimed shots 30% tighter.' },
  { id: 'holo', name: 'Holographic', price: 1800, blurb: 'Aimed shots 40% tighter, a little zoom.' },
  { id: 'scope', name: '4× Scope', price: 3500, blurb: 'Big zoom and pinpoint aimed shots; a bit worse from the hip.' },
];

export const MUZZLES: { id: Muzzle; name: string; price: number; blurb: string }[] = [
  { id: 'none', name: 'Bare barrel', price: 0, blurb: 'Loud and proud.' },
  { id: 'suppressor', name: 'Suppressor', price: 2500, blurb: 'Quiet shots that don’t send people running. Range −10%.' },
  { id: 'compensator', name: 'Compensator', price: 1600, blurb: 'Kick −40%, spread −15%.' },
];

export const MAGS: { id: MagSize; name: string; price: number; blurb: string }[] = [
  { id: 'standard', name: 'Standard', price: 0, blurb: 'Factory magazine.' },
  { id: 'extended', name: 'Extended', price: 1200, blurb: '+50% rounds, reloads a touch slower.' },
  { id: 'drum', name: 'Drum', price: 4000, blurb: 'Double the rounds, slower reloads.' },
];

export const LASER_PRICE = 1400;

export const CHARMS: { id: Charm; name: string; price: number }[] = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'dice', name: 'Lucky dice', price: 300 },
  { id: 'chip', name: 'Poker chip', price: 300 },
  { id: 'cherry', name: 'Slot cherries', price: 400 },
  { id: 'star', name: 'Gold star', price: 500 },
  { id: 'skull', name: 'Skull', price: 500 },
];

export function defaultGunMods(): GunMods {
  return { skin: 'stock', sight: 'iron', muzzle: 'none', mag: 'standard', laser: false, charm: 'none' };
}

/** Which attachments a weapon takes (melee: skins and charms only; the sniper has its own scope). */
export function gunTakes(def: GunDef): { sight: boolean; muzzle: boolean; mag: boolean; laser: boolean } {
  if (def.melee) return { sight: false, muzzle: false, mag: false, laser: false };
  const toy = def.kind === 'paint' || def.kind === 'confetti' || def.kind === 'laser';
  const heavy = def.kind === 'minigun' || def.kind === 'rocket' || def.kind === 'flamer' || def.kind === 'railgun' || def.kind === 'launcher';
  return { sight: def.kind !== 'sniper' && def.kind !== 'minigun' && def.kind !== 'flamer' && def.kind !== 'rocket', muzzle: !toy && !heavy, mag: def.kind !== 'laser' && !heavy, laser: def.kind !== 'flamer' };
}

export function sanitizeGunMods(def: GunDef, raw: unknown): GunMods {
  const r = (raw ?? {}) as Record<string, unknown>;
  const t = gunTakes(def);
  const pick = <T extends string>(v: unknown, list: { id: T }[], d: T): T => (list.some((o) => o.id === v) ? (v as T) : d);
  return {
    skin: GUN_SKINS.some((s) => s.id === r.skin) ? (r.skin as string) : 'stock',
    sight: t.sight ? pick(r.sight, SIGHTS, 'iron') : 'iron',
    muzzle: t.muzzle ? pick(r.muzzle, MUZZLES, 'none') : 'none',
    mag: t.mag ? pick(r.mag, MAGS, 'standard') : 'standard',
    laser: t.laser && r.laser === true,
    charm: pick(r.charm, CHARMS, 'none'),
  };
}

/** A weapon's mods (made from the defaults the first time). */
export function gunModsOf(st: GunState, id: string): GunMods {
  st.mods ??= {};
  st.mods[id] ??= defaultGunMods();
  return st.mods[id];
}

/** The stats a customized weapon actually has, plus how its attachments change aiming. */
export interface TunedGun extends GunDef {
  /** Spread multiplier when aimed down the sights. */
  adsAcc: number;
  /** Spread multiplier from the hip. */
  hipAcc: number;
  /** Recoil multiplier. */
  kickMul: number;
  /** Suppressed: quieter, doesn't scare people off. */
  quiet: boolean;
  mods: GunMods;
}

export function tunedGun(def: GunDef, mods: GunMods | null | undefined): TunedGun {
  const m = mods ? sanitizeGunMods(def, mods) : defaultGunMods();
  const t: TunedGun = { ...def, adsAcc: 1, hipAcc: 1, kickMul: 1, quiet: false, mods: m };
  if (def.melee) return t;
  if (m.mag === 'extended') {
    t.mag = Math.round(def.mag * 1.5);
    t.reload = def.reload * 1.15;
  } else if (m.mag === 'drum') {
    t.mag = Math.round(def.mag * 2);
    t.reload = def.reload * 1.4;
  }
  if (m.muzzle === 'suppressor') {
    t.quiet = true;
    t.range = def.range * 0.9;
  } else if (m.muzzle === 'compensator') {
    t.kickMul = 0.6;
    t.spread = def.spread * 0.85;
  }
  if (m.sight === 'reddot') t.adsAcc = 0.7;
  else if (m.sight === 'holo') {
    t.adsAcc = 0.6;
    t.adsFov = def.adsFov * 0.88;
  } else if (m.sight === 'scope') {
    t.adsAcc = 0.45;
    t.hipAcc = 1.1;
    t.adsFov = Math.min(def.adsFov, 24);
  }
  if (m.laser) t.hipAcc *= 0.7;
  return t;
}

/** Short list of what's fitted ("Gold · Red dot · Suppressor"), '' when stock. */
export function gunModsSummary(m: GunMods): string {
  const out: string[] = [];
  if (m.skin !== 'stock') out.push(GUN_SKINS.find((s) => s.id === m.skin)?.name ?? '');
  if (m.sight !== 'iron') out.push(SIGHTS.find((s) => s.id === m.sight)?.name ?? '');
  if (m.muzzle !== 'none') out.push(MUZZLES.find((s) => s.id === m.muzzle)?.name ?? '');
  if (m.mag !== 'standard') out.push(`${MAGS.find((s) => s.id === m.mag)?.name} mag`);
  if (m.laser) out.push('Laser');
  if (m.charm !== 'none') out.push(CHARMS.find((s) => s.id === m.charm)?.name ?? '');
  return out.filter(Boolean).join(' · ');
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
  const eq = typeof r.equipped === 'string' && (owned.includes(r.equipped) || r.equipped === FISTS) ? r.equipped : null;
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
  const mods: Record<string, GunMods> = {};
  if (r.mods && typeof r.mods === 'object') {
    for (const [k, v] of Object.entries(r.mods as Record<string, unknown>)) {
      const d = gunDef(k);
      if (d && owned.includes(k)) mods[k] = sanitizeGunMods(d, v);
    }
  }
  return { owned, equipped: eq, slots, mods };
}

/** Mods in a few characters for the multiplayer presence ("skin.sight.muzzle.mag.laser.charm" as indexes). */
export function encodeGunMods(m: GunMods): string {
  const i = <T,>(list: { id: T }[], v: T) => Math.max(0, list.findIndex((o) => o.id === v));
  return [i(GUN_SKINS, m.skin), i(SIGHTS, m.sight), i(MUZZLES, m.muzzle), i(MAGS, m.mag), m.laser ? 1 : 0, i(CHARMS, m.charm)].join('.');
}

/** The other way round (anything unknown falls back to stock, and what the weapon can't take is dropped). */
export function decodeGunMods(def: GunDef, code: unknown): GunMods {
  if (typeof code !== 'string' || code.length > 24) return defaultGunMods();
  const n = code.split('.').map((x) => Number.parseInt(x, 10));
  const at = <T,>(list: { id: T }[], k: number, d: T): T => (Number.isFinite(n[k]) && list[n[k]] ? list[n[k]].id : d);
  return sanitizeGunMods(def, {
    skin: at(GUN_SKINS, 0, 'stock'), sight: at(SIGHTS, 1, 'iron'), muzzle: at(MUZZLES, 2, 'none'), mag: at(MAGS, 3, 'standard'),
    laser: n[4] === 1, charm: at(CHARMS, 5, 'none'),
  });
}
