import * as THREE from 'three';
import { glow, chrome } from '../render/materials';
import type { EngineProfile } from '../core/audio';

export type CarModelKind = 'hatch' | 'coupe' | 'muscle' | 'limo' | 'truck' | 'super' | 'ev' | 'hyper' | 'cabrio'
  | 'taxi' | 'van' | 'buggy' | 'rally' | 'pickup' | 'suv' | 'classic' | 'roadster'
  | 'sedan' | 'wagon' | 'lowrider' | 'drift' | 'interceptor' | 'gt'
  | 'jeep' | 'apc' | 'tank' | 'stealth';

/** A car from Velocity Motors. */
export interface CarDef {
  id: string;
  name: string;
  kind: CarModelKind;
  price: number;
  /** Casino level needed to buy it. */
  unlock: number;
  /** Top speed (m/s), acceleration (m/s²) and how sharply it turns. */
  top: number;
  accel: number;
  grip: number;
  colors: number[];
  blurb: string;
  /** Only found at the military base: steal it (and keep it by parking it in your garage). */
  military?: boolean;
  /** Not for sale anywhere: only got by stealing it (a police cruiser). */
  stealOnly?: boolean;
  /** Durability (default by body type, see `carHp`). */
  hp?: number;
  /** Share of bullet damage that gets through (armoured vehicles shrug off small arms). */
  armor?: number;
  /** A main gun: click (or F) fires a shell that explodes where it lands. */
  cannon?: boolean;
  /** What it's worth when it can't be bought (military vehicles), for repairs. */
  value?: number;
}

export const CARS: CarDef[] = [
  { id: 'hatch', name: 'City Hatch', kind: 'hatch', price: 8_000, unlock: 1, top: 20, accel: 7, grip: 1.15, colors: [0x39ff88, 0xffc53d, 0x2fe6ff, 0xff6fb5, 0xf4f1ea], blurb: 'Small, cheap, cheerful. Parks anywhere.' },
  { id: 'taxi', name: 'Yellow Cab', kind: 'taxi', price: 15_000, unlock: 1, top: 22, accel: 8, grip: 1.1, colors: [0xffc21a, 0x17151f, 0xf4f1ea], blurb: 'A checkered city classic with a glowing roof sign.' },
  { id: 'van', name: 'Party Van', kind: 'van', price: 32_000, unlock: 2, top: 22, accel: 7, grip: 0.9, colors: [0x6a2cc2, 0xff6fb5, 0x2fb8c9, 0xf4f1ea], blurb: 'Room for the whole crew, underglow included.' },
  { id: 'buggy', name: 'Dune Buggy', kind: 'buggy', price: 40_000, unlock: 2, top: 28, accel: 13, grip: 1.25, colors: [0xff8a1f, 0x39ff88, 0xffc53d, 0xc8102e], blurb: 'Roll cage, fat tyres and no doors. Made for the desert.' },
  { id: 'cabrio', name: 'Riviera Convertible', kind: 'cabrio', price: 28_000, unlock: 2, top: 25, accel: 8, grip: 1.1, colors: [0xc8102e, 0xf4f1ea, 0x2fb8c9, 0xffc53d], blurb: 'Top down, sunglasses on. You can see who’s driving.' },
  { id: 'coupe', name: 'Strip Coupe', kind: 'coupe', price: 45_000, unlock: 3, top: 29, accel: 10, grip: 1.2, colors: [0x1f4fbf, 0xc8102e, 0x17151f, 0xf4f1ea], blurb: 'A sleek two-door with a little spoiler.' },
  { id: 'rally', name: 'Rally Hatch', kind: 'rally', price: 55_000, unlock: 3, top: 31, accel: 13, grip: 1.45, colors: [0x1f4fbf, 0xf4f1ea, 0xc8102e, 0x39ff88], blurb: 'Big wing, race number, corners like it’s on rails.' },
  { id: 'pickup', name: 'Desert Pickup', kind: 'pickup', price: 60_000, unlock: 3, top: 27, accel: 10, grip: 1.05, colors: [0xc8102e, 0x6b4a2a, 0xf4f1ea, 0x17151f], blurb: 'Open bed, high ride, happy on and off the road.' },
  { id: 'muscle', name: 'Muscle Car', kind: 'muscle', price: 70_000, unlock: 4, top: 32, accel: 12, grip: 0.95, colors: [0xff8a1f, 0x17151f, 0xc8102e, 0x2a6bff], blurb: 'Racing stripes, a big engine and a bigger rumble.' },
  { id: 'suv', name: 'Highroller SUV', kind: 'suv', price: 85_000, unlock: 4, top: 30, accel: 11, grip: 1, colors: [0x17151f, 0xf4f1ea, 0x5a5d66, 0x1d2a5a], blurb: 'Tinted windows, roof rails and presence.' },
  { id: 'classic', name: 'Fifties Cruiser', kind: 'classic', price: 95_000, unlock: 5, top: 27, accel: 8, grip: 0.9, colors: [0x7fd6d0, 0xff6fb5, 0xc8102e, 0xf4f1ea], blurb: 'Long, low and dripping with chrome.' },
  { id: 'limo', name: 'Stretch Limo', kind: 'limo', price: 110_000, unlock: 5, top: 24, accel: 6, grip: 0.8, colors: [0x0b0b0e, 0xf4f1ea, 0xff6fb5], blurb: 'Arrive like a high roller. Turns like a boat.' },
  { id: 'truck', name: 'Monster Truck', kind: 'truck', price: 140_000, unlock: 6, top: 26, accel: 9, grip: 1, colors: [0x39ff88, 0xc8102e, 0x1f4fbf, 0xffc53d], blurb: 'Huge wheels, huge fun, huge fuel bill.' },
  { id: 'ev', name: 'Neon EV', kind: 'ev', price: 190_000, unlock: 7, top: 36, accel: 16, grip: 1.25, colors: [0xf4f1ea, 0x17151f, 0x6a2cc2], blurb: 'Silent, instant torque and glowing underlights.' },
  { id: 'roadster', name: 'Neon Roadster', kind: 'roadster', price: 240_000, unlock: 8, top: 40, accel: 16, grip: 1.3, colors: [0xff3fa4, 0x2fe6ff, 0x17151f, 0xffc53d], blurb: 'Open top, low slung, built for the Strip at night.' },
  { id: 'super', name: 'Viper Supercar', kind: 'super', price: 320_000, unlock: 8, top: 42, accel: 17, grip: 1.3, colors: [0xff2a2a, 0xffc53d, 0x39ff88, 0x2fe6ff], blurb: 'Scissor-door looks, a wing on the back and silly speed.' },
  { id: 'sedan', name: 'Executive Sedan', kind: 'sedan', price: 22_000, unlock: 1, top: 25, accel: 8, grip: 1.1, colors: [0x1b2748, 0x17151f, 0x8c9099, 0xf4f1ea, 0x5a3a1a], blurb: 'Quiet, comfortable and very respectable.' },
  { id: 'wagon', name: 'Family Wagon', kind: 'wagon', price: 26_000, unlock: 2, top: 24, accel: 8, grip: 1.05, colors: [0x1e7a46, 0xc8102e, 0xf4f1ea, 0x5a3a1a], blurb: 'A long roof, a big boot and fake wood optional.' },
  { id: 'lowrider', name: 'Lowrider', kind: 'lowrider', price: 65_000, unlock: 4, top: 26, accel: 9, grip: 0.95, colors: [0x6a2cc2, 0xff6fb5, 0x2fe6ff, 0xf2b632], blurb: 'Slammed to the ground, candy paint, chrome everywhere.' },
  { id: 'drift', name: 'Drift King', kind: 'drift', price: 130_000, unlock: 6, top: 35, accel: 14, grip: 0.85, colors: [0xf4f1ea, 0x39ff88, 0xff2a2a, 0x17151f], blurb: 'Loose rear end on purpose. Hold the slide, feel the smoke.' },
  { id: 'interceptor', name: 'Interceptor', kind: 'interceptor', price: 160_000, unlock: 6, top: 38, accel: 14, grip: 1.15, hp: 170, colors: [0x17151f, 0xf4f1ea, 0x1d2a5a], blurb: 'An ex-police pursuit car: reinforced, fast, with the light bar still fitted.' },
  { id: 'gt', name: 'Le Mans GT', kind: 'gt', price: 450_000, unlock: 9, top: 47, accel: 18, grip: 1.4, colors: [0x1f4fbf, 0xf4f1ea, 0xff8a1f, 0x17151f], blurb: 'An endurance racer with plates. Glued to the road.' },
  { id: 'hyper', name: 'Golden Hypercar', kind: 'hyper', price: 1_000_000, unlock: 10, top: 50, accel: 20, grip: 1.35, colors: [0xf2b632], blurb: 'Solid gold. The fastest thing in the city.' },
  // Steal it from the police (walk up to a cruiser that's stopped).
  { id: 'police', value: 60_000, stealOnly: true, name: 'Police Cruiser', kind: 'interceptor', price: 0, unlock: 1, top: 37, accel: 13, grip: 1.15, hp: 190, colors: [0xf4f4f6], blurb: 'Taken from the city police: light bar, siren (C) and a push bar.' },
  // Military base only: you can't buy these, you have to take them.
  { id: 'jeep', value: 120000, name: 'Army Patrol Jeep', kind: 'jeep', price: 0, unlock: 1, top: 33, accel: 13, grip: 1.25, hp: 320, armor: 0.6, military: true, colors: [0x4b5320, 0xb59a6a, 0x2c2f26], blurb: 'Armoured patrol 4x4 with a roll bar. Shrugs off small arms.' },
  { id: 'apc', value: 350000, name: 'Armoured APC', kind: 'apc', price: 0, unlock: 1, top: 27, accel: 9, grip: 0.95, hp: 900, armor: 0.3, military: true, colors: [0x4b5320, 0xb59a6a, 0x2c2f26], blurb: 'Eight tonnes of steel on six wheels. Traffic gets out of its way.' },
  { id: 'tank', value: 900000, name: 'Rhino Tank', kind: 'tank', price: 0, unlock: 1, top: 18, accel: 8, grip: 1.5, hp: 2500, armor: 0.12, cannon: true, military: true, colors: [0x4b5320, 0xb59a6a, 0x2c2f26], blurb: 'Tracks, armour, a 120 mm cannon you aim with the mouse (click or F) and a machine gun (right click). Crushes cars. Too hot for any garage.' },
  { id: 'stealth', value: 1500000, name: 'Prototype X-1', kind: 'stealth', price: 0, unlock: 1, top: 56, accel: 23, grip: 1.45, hp: 180, armor: 0.8, military: true, colors: [0x17151f, 0x2c2f26, 0x8c9099], blurb: 'A classified stealth racer. The fastest thing on wheels, anywhere.' },
];

/** The cars on sale at Velocity Motors (military vehicles aren't). */
export const DEALER_CARS: CarDef[] = CARS.filter((c) => !c.military && !c.stealOnly).sort((a, b) => a.price - b.price);
/** Vehicles parked at the military base. */
export const MILITARY_CARS: CarDef[] = CARS.filter((c) => c.military);

/** What a car is worth: its price, or its value for vehicles nobody sells. */
export function carValue(def: CarDef): number {
  return def.price || def.value || 20_000;
}

/** Fixing a car after a crash: 10% of what it cost. */
export const REPAIR_SHARE = 0.1;
export function repairCost(def: CarDef): number {
  return Math.round(carValue(def) * REPAIR_SHARE);
}

/** How much punishment a vehicle takes before it blows up. */
export function carHp(def: CarDef | null): number {
  if (!def) return 100;
  if (def.hp) return def.hp;
  switch (def.kind) {
    case 'truck':
      return 240;
    case 'limo':
    case 'suv':
    case 'pickup':
    case 'van':
      return 160;
    case 'buggy':
    case 'roadster':
    case 'cabrio':
      return 90;
    default:
      return 110;
  }
}

/** The engine note a vehicle makes. */
export function engineOf(def: CarDef | null): EngineProfile {
  switch (def?.kind) {
    case 'ev':
      return 'electric';
    case 'muscle':
    case 'classic':
    case 'lowrider':
    case 'interceptor':
    case 'limo':
    case 'suv':
    case 'truck':
    case 'pickup':
      return 'v8';
    case 'van':
    case 'apc':
      return 'diesel';
    case 'super':
    case 'hyper':
    case 'roadster':
    case 'gt':
    case 'coupe':
    case 'rally':
    case 'drift':
    case 'stealth':
      return 'sport';
    case 'buggy':
    case 'jeep':
      return 'buggy';
    case 'tank':
      return 'tank';
    default:
      return 'four';
  }
}

/** Body width of a car (metres). */
export function carWidth(def: CarDef): number {
  return shapeOf(def.kind).W;
}

export function carDef(id: string | null | undefined): CarDef | null {
  return CARS.find((c) => c.id === id) ?? null;
}

/** Seats (the driver's included) by body type: other players can ride in the rest. */
const SEATS: Partial<Record<CarModelKind, number>> = {
  hatch: 4, taxi: 4, van: 6, buggy: 2, cabrio: 4, coupe: 2, rally: 2, pickup: 4, muscle: 4, suv: 6, classic: 4, limo: 8,
  truck: 2, ev: 4, roadster: 2, super: 2, sedan: 4, wagon: 5, lowrider: 4, drift: 2, interceptor: 4, gt: 2, hyper: 2,
  jeep: 4, apc: 8, tank: 3, stealth: 1,
};

/** How many people fit in a vehicle (a car taken from the traffic seats four). */
export function seatsIn(kind: CarModelKind | null | undefined): number {
  return (kind && SEATS[kind]) ?? 4;
}

/**
 * Where everyone sits (car frame, the driver's seat first): the front passenger beside the
 * driver, then rows further back, two to a row. On a tank they ride up on the hull.
 */
export function seatSpots(kind: CarModelKind | null | undefined, driver: THREE.Vector3, length: number): THREE.Vector3[] {
  const n = seatsIn(kind);
  const out = [driver.clone()];
  const side = Math.abs(driver.x) > 0.1 ? Math.abs(driver.x) : 0.8;
  const rows = Math.ceil(n / 2);
  const gap = rows > 1 ? Math.min(1.05, Math.max(0.8, (length * 0.5) / (rows - 1))) : 0;
  for (let i = 1; i < n; i++) {
    const row = Math.floor(i / 2);
    // The driver's side for even seats, the other side for odd ones.
    const x = i % 2 === 1 ? (Math.abs(driver.x) > 0.1 ? -driver.x : side) : Math.abs(driver.x) > 0.1 ? driver.x : -side;
    const z = kind === 'tank' ? driver.z - 1.2 - (row - 1) * 1.1 : driver.z - row * gap;
    out.push(new THREE.Vector3(x, kind === 'tank' ? driver.y + 0.2 : driver.y, z));
  }
  return out;
}

/** A traffic car you took: how it drives. */
export const STOLEN_SPECS = { top: 23, accel: 8, grip: 1 };

// ------------------------------------------------------------------ customization & tuning

export type Finish = 'gloss' | 'metallic' | 'matte' | 'pearl' | 'chrome' | 'gold';
export type RimStyle = 'classic' | 'star' | 'dish' | 'mesh' | 'turbine' | 'spinner';
export type Spoiler = 'none' | 'lip' | 'ducktail' | 'wing' | 'gt';
export type Decal = 'none' | 'stripes' | 'side' | 'flames' | 'number' | 'checker';
export type Tint = 'clear' | 'smoke' | 'limo' | 'neon';

/** How you've customized and tuned a car (saved per car you own). */
export interface CarMods {
  color: number;
  finish: Finish;
  rims: RimStyle;
  rimColor: number;
  /** Underglow colour (0 = none). */
  glow: number;
  tint: Tint;
  spoiler: Spoiler;
  decal: Decal;
  decalColor: number;
  plate: string;
  /** Performance (0 = stock). */
  engine: number;
  turbo: number;
  tires: number;
  brakes: number;
  nitro: number;
}

export const FINISHES: { id: Finish; name: string; price: number }[] = [
  { id: 'gloss', name: 'Gloss', price: 0 },
  { id: 'metallic', name: 'Metallic', price: 1500 },
  { id: 'pearl', name: 'Pearl', price: 4000 },
  { id: 'matte', name: 'Matte', price: 3000 },
  { id: 'chrome', name: 'Chrome', price: 30000 },
  { id: 'gold', name: 'Gold plated', price: 75000 },
];
export const RIMS: { id: RimStyle; name: string; price: number }[] = [
  { id: 'classic', name: 'Five spoke', price: 0 },
  { id: 'star', name: 'Star', price: 1800 },
  { id: 'dish', name: 'Deep dish', price: 2500 },
  { id: 'mesh', name: 'Mesh', price: 3500 },
  { id: 'turbine', name: 'Turbine', price: 5000 },
  { id: 'spinner', name: 'Spinners', price: 9000 },
];
export const SPOILERS: { id: Spoiler; name: string; price: number }[] = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'lip', name: 'Lip', price: 1200 },
  { id: 'ducktail', name: 'Ducktail', price: 2500 },
  { id: 'wing', name: 'Wing', price: 4500 },
  { id: 'gt', name: 'GT wing', price: 8000 },
];
export const DECALS: { id: Decal; name: string; price: number }[] = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'stripes', name: 'Racing stripes', price: 1500 },
  { id: 'side', name: 'Side stripe', price: 1200 },
  { id: 'flames', name: 'Flames', price: 3500 },
  { id: 'number', name: 'Race number', price: 2000 },
  { id: 'checker', name: 'Checkered', price: 3000 },
];
export const TINTS: { id: Tint; name: string; price: number }[] = [
  { id: 'clear', name: 'Clear', price: 0 },
  { id: 'smoke', name: 'Smoke', price: 600 },
  { id: 'limo', name: 'Limo black', price: 1200 },
  { id: 'neon', name: 'Neon mirror', price: 2500 },
];
export const PAINTS = [0xf4f1ea, 0x17151f, 0x8c9099, 0xc8102e, 0xff2a2a, 0xff8a1f, 0xffc53d, 0x39ff88, 0x1e7a46, 0x2fe6ff, 0x1f4fbf, 0x1b2748, 0x6a2cc2, 0xff6fb5, 0x5a3a1a, 0xf2b632];
export const RIM_COLORS = [0xd8dde3, 0x17151f, 0xf2b632, 0xc8102e, 0x2fe6ff, 0x39ff88, 0xff6fb5, 0xffffff];
export const GLOWS = [0, 0x2fe6ff, 0xff3fa4, 0x39ff88, 0xffc53d, 0xb77bff, 0xff2a2a, 0xffffff];
export const PAINT_PRICE = 600;
export const RIM_COLOR_PRICE = 400;
export const GLOW_PRICE = 3000;
export const PLATE_PRICE = 250;

/** Performance parts: each level costs more; what it does is in `tunedSpecs`. */
export const TUNING: { id: 'engine' | 'turbo' | 'tires' | 'brakes' | 'nitro'; name: string; levels: number; prices: number[]; blurb: string }[] = [
  { id: 'engine', name: 'Engine', levels: 3, prices: [6000, 18000, 45000], blurb: 'More top speed and pull.' },
  { id: 'turbo', name: 'Turbo', levels: 3, prices: [8000, 20000, 50000], blurb: 'Faster off the line.' },
  { id: 'tires', name: 'Tires', levels: 3, prices: [3000, 9000, 22000], blurb: 'More grip in the corners.' },
  { id: 'brakes', name: 'Brakes', levels: 3, prices: [2500, 7000, 16000], blurb: 'Stop shorter (red calipers).' },
  { id: 'nitro', name: 'Nitro', levels: 3, prices: [12000, 30000, 70000], blurb: 'Hold Shift for a blue-flame boost.' },
];

export function defaultMods(def: CarDef, color?: number): CarMods {
  return {
    color: color ?? def.colors[0], finish: def.kind === 'hyper' ? 'gold' : def.kind === 'classic' || def.kind === 'lowrider' ? 'pearl' : def.military ? 'matte' : 'gloss',
    rims: def.kind === 'super' || def.kind === 'hyper' || def.kind === 'roadster' || def.kind === 'stealth' ? 'turbine' : def.kind === 'classic' || def.kind === 'drift' ? 'dish' : def.kind === 'lowrider' ? 'spinner' : def.kind === 'rally' || def.kind === 'buggy' || def.kind === 'gt' ? 'mesh' : 'classic',
    rimColor: def.kind === 'hyper' || def.kind === 'lowrider' ? 0xf2b632 : def.military || def.kind === 'interceptor' ? 0x17151f : 0xd8dde3,
    glow: def.kind === 'ev' ? 0x2fe6ff : def.kind === 'van' || def.kind === 'roadster' || def.kind === 'lowrider' ? 0xff3fa4 : def.kind === 'stealth' ? 0xff2a2a : 0,
    tint: def.kind === 'limo' || def.kind === 'suv' || def.kind === 'interceptor' || def.kind === 'stealth' || def.kind === 'apc' ? 'limo' : 'smoke',
    spoiler: def.kind === 'super' || def.kind === 'rally' ? 'wing' : def.kind === 'gt' || def.kind === 'drift' ? 'gt' : def.kind === 'coupe' ? 'lip' : 'none',
    decal: def.kind === 'muscle' ? 'stripes' : def.kind === 'taxi' ? 'checker' : def.kind === 'rally' || def.kind === 'gt' ? 'number' : def.kind === 'classic' || def.kind === 'wagon' ? 'side' : def.kind === 'lowrider' || def.kind === 'drift' ? 'flames' : 'none',
    decalColor: def.kind === 'taxi' ? 0x17151f : 0xf4f1ea,
    plate: 'JACKPOT', engine: 0, turbo: 0, tires: 0, brakes: 0, nitro: 0,
  };
}

const oneOf = <T extends string>(v: unknown, list: { id: T }[], d: T): T => (list.some((x) => x.id === v) ? (v as T) : d);
const lvl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : 0);
const col = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, Math.round(v))) : d);

/** Saved or received (untrusted) mods, cleaned up. */
export function sanitizeMods(def: CarDef, raw: unknown): CarMods {
  const d = defaultMods(def);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  return {
    color: col(r.color, d.color), finish: oneOf(r.finish, FINISHES, d.finish), rims: oneOf(r.rims, RIMS, d.rims), rimColor: col(r.rimColor, d.rimColor),
    glow: col(r.glow, d.glow), tint: oneOf(r.tint, TINTS, d.tint), spoiler: oneOf(r.spoiler, SPOILERS, d.spoiler), decal: oneOf(r.decal, DECALS, d.decal),
    decalColor: col(r.decalColor, d.decalColor), plate: typeof r.plate === 'string' ? r.plate.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 8) : d.plate,
    engine: lvl(r.engine), turbo: lvl(r.turbo), tires: lvl(r.tires), brakes: lvl(r.brakes), nitro: lvl(r.nitro),
  };
}

/** How a car drives with its tuning. */
export function tunedSpecs(def: CarDef, m: CarMods | null): { top: number; accel: number; grip: number; brake: number; nitro: number } {
  if (!m) return { top: def.top, accel: def.accel, grip: def.grip, brake: 1, nitro: 0 };
  return {
    top: def.top * (1 + 0.09 * m.engine),
    accel: def.accel * (1 + 0.08 * m.engine + 0.16 * m.turbo),
    grip: def.grip * (1 + 0.1 * m.tires),
    brake: 1 + 0.3 * m.brakes,
    nitro: m.nitro,
  };
}

// ------------------------------------------------------------------ models

export interface CarModel {
  root: THREE.Group;
  /** Front then rear wheels (they spin and the front ones steer). */
  wheels: THREE.Object3D[];
  front: THREE.Object3D[];
  /** Where the driver sits (local), for convertibles. */
  seat: THREE.Vector3;
  length: number;
  open: boolean;
  /** Nitro flames out of the exhausts (shown while boosting). */
  flames: THREE.Object3D[];
  /** Brake lights (brighter while braking). */
  brakeLights: THREE.Mesh[];
  /** A tank's turret and the end of its barrel (the shell comes out here). */
  turret?: THREE.Object3D;
  muzzle?: THREE.Object3D;
  /** Red and blue roof lights (they flash with the siren on). */
  beacons?: THREE.Mesh[];
}

interface Shape {
  L: number;
  W: number;
  /** Body bottom, beltline, nose and tail heights. */
  ride: number;
  belt: number;
  nose: number;
  tail: number;
  /** Greenhouse: rear and front base (z), roof height, how far the pillars lean in. */
  cabR: number;
  cabF: number;
  roof: number;
  rakeR: number;
  rakeF: number;
  /** Wheel radius and the wheel centres (z). */
  R: number;
  wf: number;
  wr: number;
  open?: boolean;
}

function shapeOf(k: CarModelKind): Shape {
  switch (k) {
    case 'hatch':
      return { L: 3.8, W: 1.76, ride: 0.3, belt: 0.95, nose: 0.82, tail: 0.98, cabR: -1.7, cabF: 0.5, roof: 1.5, rakeR: 0.12, rakeF: 0.6, R: 0.33, wf: 1.2, wr: -1.25 };
    case 'cabrio':
      return { L: 4.4, W: 1.9, ride: 0.3, belt: 0.88, nose: 0.8, tail: 0.88, cabR: -0.9, cabF: 0.55, roof: 1.25, rakeR: 0.3, rakeF: 0.45, R: 0.37, wf: 1.42, wr: -1.38, open: true };
    case 'coupe':
      return { L: 4.5, W: 1.92, ride: 0.26, belt: 0.86, nose: 0.7, tail: 0.9, cabR: -1.45, cabF: 0.45, roof: 1.3, rakeR: 0.75, rakeF: 0.8, R: 0.36, wf: 1.45, wr: -1.4 };
    case 'muscle':
      return { L: 4.8, W: 1.98, ride: 0.3, belt: 0.98, nose: 0.92, tail: 0.98, cabR: -1.3, cabF: 0.35, roof: 1.4, rakeR: 0.6, rakeF: 0.55, R: 0.38, wf: 1.55, wr: -1.5 };
    case 'limo':
      return { L: 7.2, W: 1.98, ride: 0.3, belt: 0.95, nose: 0.88, tail: 0.95, cabR: -2.9, cabF: 1.05, roof: 1.5, rakeR: 0.3, rakeF: 0.55, R: 0.38, wf: 2.55, wr: -2.6 };
    case 'truck':
      return { L: 4.7, W: 2.35, ride: 1.05, belt: 1.85, nose: 1.72, tail: 1.8, cabR: -0.65, cabF: 0.75, roof: 2.55, rakeR: 0.1, rakeF: 0.35, R: 0.78, wf: 1.5, wr: -1.5 };
    case 'ev':
      return { L: 4.6, W: 1.96, ride: 0.24, belt: 0.84, nose: 0.66, tail: 0.86, cabR: -1.75, cabF: 0.85, roof: 1.38, rakeR: 1.15, rakeF: 0.95, R: 0.37, wf: 1.48, wr: -1.45 };
    case 'super':
    case 'hyper':
      return { L: 4.6, W: 2.02, ride: 0.18, belt: 0.74, nose: 0.46, tail: 0.8, cabR: -1.05, cabF: 0.6, roof: 1.14, rakeR: 1.05, rakeF: 0.95, R: 0.36, wf: 1.45, wr: -1.4 };
    case 'taxi':
      return { L: 4.7, W: 1.88, ride: 0.3, belt: 0.92, nose: 0.82, tail: 0.92, cabR: -1.3, cabF: 0.72, roof: 1.46, rakeR: 0.45, rakeF: 0.6, R: 0.34, wf: 1.48, wr: -1.48 };
    case 'van':
      return { L: 5, W: 2.04, ride: 0.34, belt: 1.05, nose: 0.98, tail: 1.05, cabR: -2.35, cabF: 1.05, roof: 2.1, rakeR: 0.04, rakeF: 0.55, R: 0.38, wf: 1.75, wr: -1.7 };
    case 'buggy':
      return { L: 3.7, W: 1.95, ride: 0.55, belt: 0.95, nose: 0.85, tail: 0.98, cabR: -0.95, cabF: 0.45, roof: 1.5, rakeR: 0.15, rakeF: 0.3, R: 0.5, wf: 1.2, wr: -1.2, open: true };
    case 'rally':
      return { L: 4, W: 1.86, ride: 0.26, belt: 0.92, nose: 0.76, tail: 0.95, cabR: -1.6, cabF: 0.45, roof: 1.42, rakeR: 0.18, rakeF: 0.62, R: 0.34, wf: 1.28, wr: -1.3 };
    case 'pickup':
      return { L: 5.3, W: 2.02, ride: 0.45, belt: 1.1, nose: 1.05, tail: 1.08, cabR: -0.55, cabF: 0.85, roof: 1.86, rakeR: 0.06, rakeF: 0.5, R: 0.44, wf: 1.75, wr: -1.6 };
    case 'suv':
      return { L: 4.85, W: 2.02, ride: 0.42, belt: 1.15, nose: 1.05, tail: 1.12, cabR: -1.95, cabF: 0.78, roof: 1.86, rakeR: 0.14, rakeF: 0.55, R: 0.44, wf: 1.55, wr: -1.55 };
    case 'classic':
      return { L: 5.4, W: 2, ride: 0.3, belt: 0.95, nose: 0.9, tail: 1, cabR: -1.2, cabF: 0.6, roof: 1.42, rakeR: 0.55, rakeF: 0.5, R: 0.38, wf: 1.75, wr: -1.75 };
    case 'sedan':
      return { L: 4.85, W: 1.9, ride: 0.28, belt: 0.92, nose: 0.8, tail: 0.94, cabR: -1.35, cabF: 0.75, roof: 1.45, rakeR: 0.5, rakeF: 0.62, R: 0.35, wf: 1.5, wr: -1.5 };
    case 'wagon':
      return { L: 4.9, W: 1.9, ride: 0.3, belt: 0.95, nose: 0.82, tail: 0.98, cabR: -2.2, cabF: 0.72, roof: 1.5, rakeR: 0.1, rakeF: 0.6, R: 0.35, wf: 1.55, wr: -1.55 };
    case 'lowrider':
      return { L: 5.5, W: 2, ride: 0.12, belt: 0.78, nose: 0.72, tail: 0.8, cabR: -1.3, cabF: 0.55, roof: 1.25, rakeR: 0.4, rakeF: 0.45, R: 0.33, wf: 1.8, wr: -1.75 };
    case 'drift':
      return { L: 4.4, W: 1.94, ride: 0.2, belt: 0.82, nose: 0.62, tail: 0.86, cabR: -1.35, cabF: 0.45, roof: 1.26, rakeR: 0.7, rakeF: 0.78, R: 0.35, wf: 1.42, wr: -1.38 };
    case 'interceptor':
      return { L: 5, W: 1.96, ride: 0.3, belt: 0.96, nose: 0.86, tail: 0.96, cabR: -1.4, cabF: 0.6, roof: 1.48, rakeR: 0.55, rakeF: 0.6, R: 0.37, wf: 1.6, wr: -1.55 };
    case 'gt':
      return { L: 4.9, W: 2.05, ride: 0.15, belt: 0.7, nose: 0.42, tail: 0.78, cabR: -1.1, cabF: 0.55, roof: 1.1, rakeR: 1.15, rakeF: 0.9, R: 0.36, wf: 1.6, wr: -1.5 };
    case 'stealth':
      return { L: 4.8, W: 2.08, ride: 0.14, belt: 0.66, nose: 0.36, tail: 0.74, cabR: -1.0, cabF: 0.7, roof: 1.04, rakeR: 1.1, rakeF: 1.05, R: 0.36, wf: 1.5, wr: -1.45 };
    case 'jeep':
      return { L: 4.3, W: 2.1, ride: 0.55, belt: 1.2, nose: 1.15, tail: 1.2, cabR: -1.2, cabF: 0.55, roof: 2.0, rakeR: 0.05, rakeF: 0.15, R: 0.47, wf: 1.4, wr: -1.4, open: true };
    case 'apc':
      return { L: 6.4, W: 2.55, ride: 0.7, belt: 1.85, nose: 1.5, tail: 1.9, cabR: -2.9, cabF: 1.6, roof: 2.6, rakeR: 0.15, rakeF: 0.9, R: 0.58, wf: 2.1, wr: -2.1 };
    case 'tank':
      return { L: 6.8, W: 3.3, ride: 0.35, belt: 1.25, nose: 1.1, tail: 1.25, cabR: -1.6, cabF: 1.2, roof: 2.4, rakeR: 0.2, rakeF: 0.4, R: 0.42, wf: 2.4, wr: -2.4 };
    case 'roadster':
      return { L: 4.2, W: 1.96, ride: 0.2, belt: 0.78, nose: 0.52, tail: 0.82, cabR: -0.75, cabF: 0.4, roof: 1.05, rakeR: 0.3, rakeF: 0.4, R: 0.35, wf: 1.35, wr: -1.3, open: true };
  }
}

/** Extrude a side profile (points in z, y) across the car's width (x), with rounded edges. */
function extrudeProfile(pts: [number, number][], width: number, bevel: number, holes: { z: number; y: number; r: number }[] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
  shape.closePath();
  void holes;
  const depth = Math.max(0.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10 });
  // Shape x → car forward (z), extrusion → across (x), centred.
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** The body's side outline: bumpers, hood, deck and the wheel arches cut into the sills. */
function bodyProfile(s: Shape): [number, number][] {
  const { L, ride, belt, nose, tail, R, wf, wr } = s;
  const arch = R + 0.08;
  const pts: [number, number][] = [];
  // Along the bottom from the rear, scooping up over each wheel.
  pts.push([-L / 2 + 0.12, ride]);
  const archPts = (zc: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI;
      out.push([zc + Math.cos(a) * arch, Math.max(ride, R + Math.sin(a) * arch * 0.92)]);
    }
    return out;
  };
  pts.push([wr - arch - 0.02, ride], ...archPts(wr), [wr + arch + 0.02, ride]);
  pts.push([wf - arch - 0.02, ride], ...archPts(wf), [wf + arch + 0.02, ride]);
  // Front: bumper, nose, hood up to the windscreen.
  pts.push([L / 2 - 0.1, ride], [L / 2, ride + 0.18], [L / 2, nose - 0.1], [L / 2 - 0.12, nose]);
  pts.push([s.cabF + 0.25, belt - 0.02], [s.cabF, belt]);
  // Rear deck and tail.
  pts.push([s.cabR, belt], [-L / 2 + 0.2, tail], [-L / 2, tail - 0.1], [-L / 2, ride + 0.18]);
  return pts;
}

let plateCache = new Map<string, THREE.Texture>();
function plateTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const hit = plateCache.get(text);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#f4f1ea';
  x.fillRect(0, 0, 256, 64);
  x.strokeStyle = '#17151f';
  x.lineWidth = 4;
  x.strokeRect(3, 3, 250, 58);
  x.fillStyle = '#c8102e';
  x.font = '700 11px Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('LAS VEGAS', 128, 15);
  x.fillStyle = '#1b2748';
  x.font = '900 34px Arial, sans-serif';
  x.fillText(text || ' ', 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (plateCache.size > 40) plateCache = new Map();
  plateCache.set(text, t);
  return t;
}

let decalCache = new Map<string, THREE.Texture>();
function decalTexture(kind: Decal, color: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const key = `${kind}:${color}`;
  const hit = decalCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const x = c.getContext('2d');
  if (!x) return null;
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  x.clearRect(0, 0, 512, 128);
  if (kind === 'flames') {
    const grad = x.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, '#ffe14a');
    grad.addColorStop(0.5, '#ff8a1f');
    grad.addColorStop(1, 'rgba(200,16,46,0)');
    x.fillStyle = grad;
    x.beginPath();
    x.moveTo(512, 20);
    for (let i = 0; i < 6; i++) {
      const y = 20 + i * 18;
      x.quadraticCurveTo(300 - i * 20, y - 30, 120 + (i % 2) * 60, y + 4);
      x.quadraticCurveTo(260, y + 10, 512, y + 18);
    }
    x.lineTo(512, 128);
    x.closePath();
    x.fill();
  } else if (kind === 'number') {
    x.fillStyle = '#f4f1ea';
    x.beginPath();
    x.arc(256, 64, 56, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = hex === '#f4f1ea' ? '#17151f' : hex;
    x.font = '900 70px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('77', 256, 68);
  } else if (kind === 'checker') {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      if ((i + j) % 2) continue;
      x.fillStyle = hex;
      x.fillRect(i * 32, j * 32, 32, 32);
    }
  } else if (kind === 'side') {
    x.fillStyle = hex;
    x.fillRect(0, 52, 512, 14);
    x.fillRect(0, 74, 512, 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (decalCache.size > 40) decalCache = new Map();
  decalCache.set(key, t);
  return t;
}

let glowTex: THREE.Texture | null = null;
/** A soft oval pool of light for the underglow. */
function glowTexture(): THREE.Texture | null {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  if (!x) return null;
  const grad = x.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function paintMat(color: number, finish: Finish): THREE.Material {
  switch (finish) {
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 });
    case 'gold':
      return new THREE.MeshStandardMaterial({ color: 0xf2b632, metalness: 1, roughness: 0.16, emissive: 0x2a1a00, emissiveIntensity: 0.3 });
    case 'matte':
      return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.85 });
    case 'metallic':
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15 });
    case 'pearl':
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1, iridescence: 0.35, iridescenceIOR: 1.6 });
    default:
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.12 });
  }
}

function glassMat(t: Tint): THREE.Material {
  const c = t === 'clear' ? 0x9fc4d8 : t === 'smoke' ? 0x2c3640 : t === 'limo' ? 0x08090c : 0x6a2cc2;
  return new THREE.MeshStandardMaterial({ color: c, metalness: t === 'neon' ? 0.9 : 0.6, roughness: 0.06, transparent: t === 'clear', opacity: t === 'clear' ? 0.55 : 1, emissive: t === 'neon' ? 0x2a0f45 : 0 });
}

/** A wheel: rounded tyre, a rim in the chosen style, hub cap and (tuned) brake caliper. */
function buildWheel(R: number, width: number, style: RimStyle, rimColor: number, caliper: boolean): { wheel: THREE.Group; spin: THREE.Group } {
  const wheel = new THREE.Group();
  const spin = new THREE.Group();
  wheel.add(spin);
  // Rounded tyre from a lathe profile, turned to face sideways.
  const prof: THREE.Vector2[] = [];
  const hw = width / 2;
  const inner = R * 0.68;
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    prof.push(new THREE.Vector2(R - 0.06 + Math.cos(a) * 0.06, Math.sin(a) * hw));
  }
  prof.unshift(new THREE.Vector2(inner, -hw * 0.9));
  prof.push(new THREE.Vector2(inner, hw * 0.9));
  const tyreGeo = new THREE.LatheGeometry(prof, 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.92 });
  spin.add(new THREE.Mesh(tyreGeo, rubber));
  const rimMat = rimColor === 0xd8dde3 || rimColor === 0xffffff
    ? new THREE.MeshStandardMaterial({ color: rimColor, metalness: 1, roughness: 0.12 })
    : new THREE.MeshStandardMaterial({ color: rimColor, metalness: 0.7, roughness: 0.25 });
  const darkRim = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.6, roughness: 0.4 });
  const face = hw * 0.75;
  // Barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, width * 0.85, 24, 1, true), darkRim);
  barrel.rotation.z = Math.PI / 2;
  spin.add(barrel);
  const ringGeo = new THREE.TorusGeometry(inner - 0.015, 0.02, 6, 28);
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(ringGeo, rimMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = sx * face;
    spin.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.22, inner * 0.25, 0.06, 12), rimMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = sx * face;
    spin.add(hub);
    const n = style === 'star' ? 7 : style === 'mesh' ? 14 : style === 'turbine' ? 10 : style === 'spinner' ? 3 : 5;
    if (style === 'dish') {
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.95, inner * 0.6, 0.04, 24), rimMat);
      dish.rotation.z = Math.PI / 2;
      dish.position.x = sx * (face - 0.02);
      spin.add(dish);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), darkRim);
        bolt.position.set(sx * face, Math.cos(a) * inner * 0.45, Math.sin(a) * inner * 0.45);
        spin.add(bolt);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const len = inner * 0.82;
        const thick = style === 'mesh' ? 0.018 : style === 'spinner' ? 0.07 : 0.045;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, len, thick), rimMat);
        spoke.position.set(sx * face, Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.5);
        spoke.rotation.x = -a;
        if (style === 'turbine') spoke.rotation.y = 0.5 * sx;
        if (style === 'mesh') spoke.rotation.z = 0.25;
        spin.add(spoke);
      }
    }
  }
  if (caliper) {
    const cal = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, inner * 0.55, inner * 0.35), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4, metalness: 0.3 }));
    cal.position.set(0, inner * 0.35, -inner * 0.35);
    wheel.add(cal);
  }
  return { wheel, spin };
}

/**
 * The cars at Velocity Motors: an extruded side profile (rounded body with proper wheel
 * arches), a glass greenhouse, lights, grille, mirrors, exhausts and number plates, plus
 * whatever you've customized (paint finish, rims, spoiler, decals, tint, underglow). They
 * face +z and stand on y = 0.
 */
export function buildCar(def: CarDef, color?: number, mods?: CarMods): CarModel {
  if (def.kind === 'tank') return buildTank(def, color ?? mods?.color ?? def.colors[0]);
  const m = mods ?? defaultMods(def, color);
  const paintColor = color ?? m.color;
  const g = new THREE.Group();
  const k = def.kind;
  const s = shapeOf(k);
  const { L, W, ride, belt, R } = s;
  const paint = paintMat(paintColor, m.finish);
  const black = new THREE.MeshStandardMaterial({ color: 0x15141a, roughness: 0.6, metalness: 0.2 });
  const trim = chrome();
  const glass = glassMat(m.tint);
  const add = (mesh: THREE.Mesh, cast = true) => {
    mesh.castShadow = cast;
    g.add(mesh);
    return mesh;
  };
  const box = (mt: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    return add(mesh);
  };
  // Body
  add(new THREE.Mesh(extrudeProfile(bodyProfile(s), W, 0.09), paint));
  // Black sills and lower valance
  box(black, W * 0.96, 0.08, L * 0.96, 0, ride + 0.02, 0);
  // Greenhouse (glass) with a painted roof
  if (!s.open) {
    const gw = W * 0.84;
    const gh: [number, number][] = [[s.cabR, belt - 0.02], [s.cabF, belt - 0.02], [s.cabF - s.rakeF, s.roof], [s.cabR + s.rakeR, s.roof]];
    add(new THREE.Mesh(extrudeProfile(gh, gw, 0.06), glass));
    // Roof skin and pillars in body colour
    const roofLen = s.cabF - s.rakeF - (s.cabR + s.rakeR);
    box(paint, gw + 0.02, 0.05, Math.max(0.3, roofLen + 0.05), 0, s.roof + 0.03, (s.cabF - s.rakeF + s.cabR + s.rakeR) / 2);
    const pillar = (z0: number, z1: number) => {
      const len = Math.hypot(z1 - z0, s.roof - belt);
      const ang = Math.atan2(z1 - z0, s.roof - belt);
      for (const sx of [-1, 1]) box(paint, 0.06, len, 0.09, sx * (gw / 2 + 0.03), (belt + s.roof) / 2, (z0 + z1) / 2, ang, 0, 0);
    };
    pillar(s.cabF, s.cabF - s.rakeF);
    pillar(s.cabR, s.cabR + s.rakeR);
    if (k === 'limo') for (const zc of [-1.2, 0.1]) for (const sx of [-1, 1]) box(paint, 0.06, s.roof - belt, 0.12, sx * (gw / 2 + 0.03), (belt + s.roof) / 2, zc);
  } else {
    // Convertible: windscreen, seats and roll hoops
    const ws = box(glass, W * 0.84, 0.45, 0.04, 0, belt + 0.2, s.cabF - 0.05, -0.5);
    void ws;
    const leather = new THREE.MeshStandardMaterial({ color: 0xe9e1d3, roughness: 0.7 });
    for (const sx of [-1, 1]) {
      box(leather, 0.55, 0.12, 0.55, sx * 0.42, belt - 0.15, -0.35);
      box(leather, 0.55, 0.55, 0.12, sx * 0.42, belt + 0.1, -0.65, 0.15);
    }
    box(black, W * 0.8, 0.04, 1.2, 0, belt - 0.2, -0.3);
  }
  // Truck: a bed behind the cab and a light bar
  if (k === 'truck') {
    box(black, W * 0.86, 0.06, 1.6, 0, belt - 0.05, -1.45);
    for (let i = 0; i < 4; i++) box(glow(0xfff2c8, 2.4), 0.25, 0.1, 0.12, -0.45 + i * 0.3, s.roof + 0.12, s.cabF - s.rakeF - 0.1);
    box(black, W * 0.9, 0.12, 0.25, 0, ride - 0.15, 0); // axle beam
  }
  // Pickup: an open bed behind the cab
  if (k === 'pickup') {
    const bz0 = -L / 2 + 0.2;
    const bz1 = s.cabR - 0.08;
    box(black, W * 0.84, 0.05, bz1 - bz0, 0, belt - 0.32, (bz0 + bz1) / 2);
    box(trim, W * 0.9, 0.04, 0.06, 0, belt + 0.02, -L / 2 + 0.06);
  }
  // Taxi: a glowing sign on the roof
  if (k === 'taxi') {
    box(glow(0xffe08a, 1.8), 0.7, 0.2, 0.22, 0, s.roof + 0.16, (s.cabR + s.rakeR + s.cabF - s.rakeF) / 2);
    box(black, 0.74, 0.04, 0.26, 0, s.roof + 0.05, (s.cabR + s.rakeR + s.cabF - s.rakeF) / 2);
  }
  // SUV: roof rails
  if (k === 'suv') for (const sx of [-1, 1]) box(trim, 0.05, 0.05, (s.cabF - s.rakeF) - (s.cabR + s.rakeR) - 0.2, sx * W * 0.38, s.roof + 0.09, (s.cabR + s.rakeR + s.cabF - s.rakeF) / 2);
  // Van: a sliding door line and round porthole
  if (k === 'van') for (const sx of [-1, 1]) box(black, 0.01, (s.roof - ride) * 0.7, 0.015, sx * (W / 2 + 0.005), (s.roof + ride) / 2, -0.4);
  // Dune buggy: roll cage and a spare wheel
  if (k === 'buggy') {
    const cage = black;
    for (const sx of [-1, 1]) {
      box(cage, 0.07, 0.75, 0.07, sx * 0.75, belt + 0.37, s.cabR + 0.15);
      box(cage, 0.07, 0.07, 1.25, sx * 0.75, belt + 0.75, (s.cabR + s.cabF) / 2 + 0.1, 0.12, 0, 0);
      box(cage, 0.07, 0.7, 0.07, sx * 0.72, belt + 0.33, s.cabF + 0.1, -0.35, 0, 0);
    }
    box(cage, 1.55, 0.07, 0.07, 0, belt + 0.75, s.cabR + 0.15);
    box(cage, 1.5, 0.07, 0.07, 0, belt + 0.68, s.cabF - 0.05);
  }
  // Fifties cruiser: tail fins
  if (k === 'classic') for (const sx of [-1, 1]) box(paint, 0.08, 0.32, 1.0, sx * (W / 2 - 0.1), s.tail + 0.14, -L / 2 + 0.6, 0.18, 0, 0);
  // Interceptor: light bar and a push bar
  const beacons: THREE.Mesh[] = [];
  if (k === 'interceptor') {
    const rz = (s.cabR + s.rakeR + s.cabF - s.rakeF) / 2;
    box(black, 1.2, 0.08, 0.3, 0, s.roof + 0.08, rz);
    beacons.push(box(glow(0xff2a3a, 2.2), 0.5, 0.12, 0.26, -0.32, s.roof + 0.17, rz));
    beacons.push(box(glow(0x2a6bff, 2.2), 0.5, 0.12, 0.26, 0.32, s.roof + 0.17, rz));
    // The real thing: navy doors and POLICE down the sides.
    if (def.id === 'police') {
      const navy = new THREE.MeshStandardMaterial({ color: 0x1d2a5a, roughness: 0.35, metalness: 0.4 });
      for (const sx of [-1, 1]) box(navy, 0.02, (belt - ride) * 0.62, 2.1, sx * (W / 2 + 0.008), ride + (belt - ride) * 0.48, (s.cabR + s.cabF) / 2 + 0.1);
      const tex = policeTexture();
      if (tex) {
        const pm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
        for (const sx of [-1, 1]) {
          const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.32), pm);
          pl.position.set(sx * (W / 2 + 0.02), ride + (belt - ride) * 0.5, (s.cabR + s.cabF) / 2 + 0.1);
          pl.rotation.y = sx * Math.PI / 2;
          g.add(pl);
        }
      }
    }
    box(black, W * 0.7, 0.32, 0.08, 0, ride + 0.3, L / 2 + 0.12);
    for (const sx of [-0.25, 0.25]) box(black, 0.08, 0.5, 0.08, sx * W, ride + 0.32, L / 2 + 0.1);
  }
  // Wagon: roof rails
  if (k === 'wagon') for (const sx of [-1, 1]) box(trim, 0.05, 0.05, (s.cabF - s.rakeF) - (s.cabR + s.rakeR) - 0.2, sx * W * 0.38, s.roof + 0.09, (s.cabR + s.rakeR + s.cabF - s.rakeF) / 2);
  // Stealth racer: twin fins and sharp side intakes
  if (k === 'stealth') {
    for (const sx of [-1, 1]) {
      box(paint, 0.05, 0.38, 0.6, sx * 0.55, s.tail + 0.2, -L / 2 + 0.45, 0.35, 0, sx * 0.25);
      box(black, 0.06, 0.18, 0.9, sx * (W / 2 + 0.01), ride + 0.38, -0.3);
    }
  }
  // Army jeep: roll bar, spare wheel, a mounted gun and the white star
  if (k === 'jeep' || k === 'apc') {
    const star = militaryStar();
    star.position.set(0, (k === 'jeep' ? s.nose : s.nose) + 0.02, k === 'jeep' ? s.cabF + 0.75 : s.cabF + 0.5);
    g.add(star);
    for (const sx of [-1, 1]) {
      const side = militaryStar();
      side.rotation.set(0, sx * Math.PI / 2, 0);
      side.position.set(sx * (W / 2 + 0.02), ride + (belt - ride) * 0.55, k === 'jeep' ? -0.4 : -1.2);
      g.add(side);
    }
  }
  if (k === 'jeep') {
    for (const sx of [-1, 1]) box(black, 0.08, 0.8, 0.08, sx * 0.85, belt + 0.4, s.cabR + 0.35);
    box(black, 1.78, 0.08, 0.08, 0, belt + 0.8, s.cabR + 0.35);
    box(black, 0.08, 0.6, 0.08, 0, belt + 0.5, s.cabR + 0.35);
    // The gun on its post
    box(black, 0.12, 0.12, 1.0, 0, belt + 0.95, s.cabR + 0.6);
    box(black, 0.2, 0.25, 0.3, 0, belt + 0.95, s.cabR + 0.25);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(s.R * 0.95, s.R * 0.95, 0.28, 20), new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9 }));
    spare.rotation.x = Math.PI / 2;
    spare.position.set(0, s.tail - 0.1, -L / 2 - 0.15);
    add(spare);
  }
  // APC: roof hatch, a small turret, armour skirts
  if (k === 'apc') {
    const tur = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.4, 14), paint);
    tur.position.set(0, s.roof + 0.2, -0.3);
    add(tur);
    box(black, 0.12, 0.12, 1.2, 0, s.roof + 0.25, 0.4);
    box(black, 0.7, 0.06, 0.7, 0, s.roof + 0.03, -1.8);
    for (const sx of [-1, 1]) box(paint, 0.08, 0.35, L * 0.8, sx * (W / 2 + 0.03), ride + 0.25, 0);
  }
  // Muscle hood scoop
  if (k === 'muscle') box(black, 0.55, 0.14, 0.7, 0, s.nose + 0.07, s.cabF + 0.8);
  // Side mirrors
  for (const sx of [-1, 1]) {
    box(paint, 0.16, 0.1, 0.06, sx * (W / 2 + 0.06), belt + 0.08, s.cabF - 0.1);
    box(glass, 0.12, 0.08, 0.01, sx * (W / 2 + 0.06), belt + 0.08, s.cabF - 0.13);
  }
  // Door lines and handles
  for (const sx of [-1, 1]) {
    box(black, 0.005, (belt - ride) * 0.65, 0.012, sx * (W / 2 + 0.005), (belt + ride) / 2, s.cabF - 0.02);
    box(trim, 0.012, 0.03, 0.14, sx * (W / 2 + 0.01), belt - 0.15, s.cabR + 0.35);
  }
  // Front: grille, headlights, bumper lip
  const zF = L / 2 + 0.005;
  const lampY = Math.min(s.nose - 0.16, ride + (s.nose - ride) * 0.7);
  box(black, W * 0.5, (s.nose - ride) * 0.35, 0.03, 0, ride + (s.nose - ride) * 0.42, zF);
  if (k === 'muscle' || k === 'limo' || k === 'truck') for (let i = 0; i < 5; i++) box(trim, W * 0.5, 0.015, 0.035, 0, ride + (s.nose - ride) * (0.3 + i * 0.06), zF + 0.005);
  const headW = k === 'super' || k === 'hyper' || k === 'ev' ? 0.42 : 0.3;
  for (const sx of [-1, 1]) {
    box(glow(0xfff6dc, 2.6), headW, 0.1, 0.04, sx * W * 0.33, lampY, zF - 0.01, 0, 0, sx * (k === 'super' || k === 'hyper' ? 0.15 : 0));
    box(glow(0xffc53d, 1.8), 0.1, 0.05, 0.04, sx * W * 0.45, lampY - 0.1, zF - 0.02);
  }
  // Rear: tail lights (a full-width bar on modern cars), plate, exhausts
  const zR = -L / 2 - 0.005;
  const tailY = Math.min(s.tail - 0.12, ride + (s.tail - ride) * 0.72);
  const brakeLights: THREE.Mesh[] = [];
  if (k === 'ev' || k === 'super' || k === 'hyper') brakeLights.push(box(glow(0xff2a2a, 1.6), W * 0.86, 0.06, 0.04, 0, tailY, zR));
  else for (const sx of [-1, 1]) brakeLights.push(box(glow(0xff2a2a, 1.6), 0.36, 0.12, 0.04, sx * W * 0.34, tailY, zR));
  const plateTex = plateTexture(m.plate);
  for (const [z, ry] of [[zR - 0.01, Math.PI], [zF + 0.02, 0]] as const) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), plateTex ? new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }) : black);
    pm.position.set(0, ride + 0.2, z);
    pm.rotation.y = ry;
    g.add(pm);
  }
  const flames: THREE.Object3D[] = [];
  const exh = k === 'muscle' || k === 'super' || k === 'hyper' ? [-0.3, -0.18, 0.18, 0.3] : [-0.35];
  for (const ex of exh) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.18, 12), trim);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex * (W / 1.9), ride + 0.06, zR - 0.05);
    add(pipe);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 10), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(ex * (W / 1.9), ride + 0.06, zR - 0.4);
    flame.visible = false;
    g.add(flame);
    flames.push(flame);
  }
  // Spoiler
  const deckZ = -L / 2 + 0.3;
  const deckY = s.tail + 0.02;
  if (m.spoiler === 'lip') box(paint, W * 0.9, 0.05, 0.18, 0, deckY + 0.02, deckZ, -0.25);
  else if (m.spoiler === 'ducktail') box(paint, W * 0.92, 0.08, 0.32, 0, deckY + 0.05, deckZ, -0.4);
  else if (m.spoiler === 'wing' || m.spoiler === 'gt') {
    const hgt = m.spoiler === 'gt' ? 0.42 : 0.22;
    const wingMat = m.spoiler === 'gt' ? black : paint;
    box(wingMat, W * (m.spoiler === 'gt' ? 1.02 : 0.9), 0.04, m.spoiler === 'gt' ? 0.38 : 0.28, 0, deckY + hgt, deckZ, 0.08);
    for (const sx of [-1, 1]) {
      box(black, 0.05, hgt, 0.12, sx * W * 0.32, deckY + hgt / 2, deckZ);
      if (m.spoiler === 'gt') box(black, 0.02, 0.18, 0.4, sx * W * 0.51, deckY + hgt, deckZ);
    }
  }
  // Decals
  const dec = m.decal;
  if (dec === 'stripes') {
    const stripe = new THREE.MeshStandardMaterial({ color: m.decalColor, roughness: 0.3, metalness: 0.2 });
    for (const sx of [-0.13, 0.13]) {
      box(stripe, 0.16, 0.012, L * 0.5 - (L / 2 - s.cabF) * 0.2, sx, s.nose + 0.03, (s.cabF + L / 2) / 2 - 0.05, -Math.atan2(s.nose - belt, L / 2 - s.cabF));
      if (!s.open) box(stripe, 0.16, 0.012, Math.max(0.2, s.cabF - s.rakeF - s.cabR - s.rakeR), sx, s.roof + 0.06, (s.cabF - s.rakeF + s.cabR + s.rakeR) / 2);
      box(stripe, 0.16, 0.012, Math.abs(s.cabR + L / 2) * 0.9, sx, belt + 0.03, (s.cabR - L / 2) / 2);
    }
  } else if (dec !== 'none') {
    const tex = decalTexture(dec, m.decalColor);
    if (tex) {
      const dm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
      const len = dec === 'number' ? 0.9 : L * 0.72;
      const hgt = dec === 'number' ? (belt - ride) * 0.8 : (belt - ride) * 0.6;
      for (const sx of [-1, 1]) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), dm);
        pl.position.set(sx * (W / 2 + 0.012), ride + (belt - ride) * 0.5, dec === 'number' ? (s.cabF + s.cabR) / 2 : dec === 'flames' ? L * 0.1 : 0);
        pl.rotation.y = sx * Math.PI / 2;
        if (sx < 0) pl.scale.x = -1;
        g.add(pl);
      }
    }
  }
  // Underglow
  if (m.glow) {
    const ug = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, L * 1.25), new THREE.MeshBasicMaterial({ color: m.glow, map: glowTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ug.rotation.x = -Math.PI / 2;
    ug.position.y = 0.03;
    g.add(ug);
    for (const sx of [-1, 1]) box(glow(m.glow, 2.4), 0.03, 0.03, L * 0.7, sx * W * 0.42, ride - 0.02, 0);
  }
  // Wheels
  const tyreW = k === 'truck' ? 0.6 : k === 'apc' ? 0.5 : k === 'jeep' ? 0.4 : k === 'buggy' ? 0.42 : k === 'pickup' || k === 'suv' ? 0.32 : k === 'super' || k === 'hyper' || k === 'roadster' ? 0.34 : 0.28;
  const wheels: THREE.Object3D[] = [];
  const front: THREE.Object3D[] = [];
  for (const zc of k === 'apc' ? [s.wf, 0, s.wr] : [s.wf, s.wr]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W / 2 - tyreW / 2 + (k === 'truck' ? 0.3 : k === 'buggy' || k === 'jeep' ? 0.22 : k === 'apc' ? 0.12 : 0.04)), R, zc);
      const w = buildWheel(R, tyreW, m.rims, m.rimColor, m.brakes > 0);
      pivot.add(w.wheel);
      g.add(pivot);
      wheels.push(w.spin);
      if (zc === s.wf) front.push(pivot);
    }
  }
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = false;
  });
  return { root: g, wheels, front, seat: new THREE.Vector3(-0.38, belt - 0.3, (s.cabR + s.cabF) / 2 + 0.2), length: L, open: !!s.open, flames, brakeLights, beacons };
}

let policeTex: THREE.Texture | null = null;
/** "POLICE" lettering for the doors. */
function policeTexture(): THREE.Texture | null {
  if (policeTex || typeof document === 'undefined') return policeTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#f4f4f6';
  x.font = '900 72px Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('POLICE', 256, 52);
  policeTex = new THREE.CanvasTexture(c);
  policeTex.colorSpace = THREE.SRGBColorSpace;
  return policeTex;
}

/** The white star on army vehicles. */
function militaryStar(): THREE.Mesh {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.13 : 0.32;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xece6d2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
  return m;
}

/**
 * The Rhino tank: a sloped hull on two tracks with road wheels, a turret with a long gun.
 * Faces +z like the cars; its road wheels spin as it drives.
 */
function buildTank(def: CarDef, color: number): CarModel {
  const g = new THREE.Group();
  const s = shapeOf('tank');
  const { L, W } = s;
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1a, roughness: 0.9, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c36, roughness: 0.6, metalness: 0.5 });
  const add = (o: THREE.Mesh) => {
    o.castShadow = true;
    g.add(o);
    return o;
  };
  const box = (mt: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return add(m);
  };
  // Hull: a profile with a sloped glacis at the front.
  const hull = new THREE.Mesh(extrudeProfile([[-L / 2, 0.45], [L / 2 - 0.9, 0.45], [L / 2, 0.85], [L / 2 - 0.5, 1.35], [-L / 2 + 0.2, 1.35], [-L / 2, 1.15]], W - 1.1, 0.06), paint);
  add(hull);
  // Track guards along the top of each track.
  const trackX = W / 2 - 0.42;
  for (const sx of [-1, 1]) {
    box(paint, 0.9, 0.08, L + 0.1, sx * trackX, 1.0, 0);
    // The track itself: a dark band with a rounded front and back.
    box(dark, 0.78, 0.82, L - 0.8, sx * trackX, 0.45, 0);
    for (const ez of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.78, 16), dark);
      end.rotation.z = Math.PI / 2;
      end.position.set(sx * trackX, 0.45, ez * (L / 2 - 0.4));
      add(end);
    }
    // Side skirts
    box(paint, 0.06, 0.45, L - 0.4, sx * (trackX + 0.43), 0.75, 0);
  }
  // Road wheels (they spin)
  const wheels: THREE.Object3D[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.82, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Mesh(wheelGeo, steel);
      w.position.set(sx * trackX, 0.36, -L / 2 + 0.9 + i * ((L - 1.8) / 5));
      g.add(w);
      wheels.push(w);
    }
  }
  // Turret
  const turret = new THREE.Group();
  turret.position.set(0, 1.35, -0.3);
  g.add(turret);
  const tb = new THREE.Mesh(extrudeProfile([[-1.4, 0], [1.1, 0], [1.6, 0.25], [1.3, 0.75], [-1.2, 0.8], [-1.5, 0.4]], 2.2, 0.05), paint);
  tb.castShadow = true;
  turret.add(tb);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.14, 14), steel);
  hatch.position.set(0.45, 0.88, -0.4);
  turret.add(hatch);
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.35), steel);
  mantlet.position.set(0, 0.42, 1.55);
  turret.add(mantlet);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 12), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.45, 3.4);
  barrel.castShadow = true;
  turret.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 12), dark);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.45, 5.1);
  turret.add(brake);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.45, 5.35);
  turret.add(muzzle);
  // Stowage boxes and the star
  box(dark, 2.0, 0.3, 0.5, 0, 1.55, -L / 2 + 0.6);
  const star = militaryStar();
  star.scale.setScalar(1.3);
  star.rotation.set(0, Math.PI / 2, 0);
  star.position.set(1.12, 0.45, 0);
  turret.add(star);
  // Tail lights
  const brakeLights: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) brakeLights.push(box(glow(0xff2a2a, 1.4), 0.2, 0.1, 0.04, sx * 0.7, 1.1, -L / 2 - 0.01));
  for (const sx of [-1, 1]) box(glow(0xfff6dc, 2), 0.22, 0.12, 0.04, sx * 0.75, 1.0, L / 2 - 0.35);
  void def;
  return { root: g, wheels, front: [], seat: new THREE.Vector3(0, 1.6, 0), length: L, open: false, flames: [], brakeLights, turret, muzzle };
}
