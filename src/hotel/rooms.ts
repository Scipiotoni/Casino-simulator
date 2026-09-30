/**
 * How a hotel room is decorated. Everything you put in costs money, and what you spent
 * decides the room's nightly rate and its stars.
 */
export interface RoomSetup {
  /** Index into BEDS. */
  bed: number;
  /** Index into ROOM_WALLS. */
  wall: number;
  /** Index into ROOM_FLOORS. */
  floor: number;
  /** Ids from ROOM_EXTRAS. */
  extras: string[];
}

export interface RoomOption {
  name: string;
  price: number;
}

export const BEDS: RoomOption[] = [
  { name: 'Single bed', price: 0 },
  { name: 'Double bed', price: 700 },
  { name: 'King bed', price: 2400 },
  { name: 'Royal canopy bed', price: 9000 },
];

export const ROOM_WALLS: (RoomOption & { color: number })[] = [
  { name: 'Plain beige', price: 0, color: 0xd8cbb4 },
  { name: 'Sky blue', price: 150, color: 0x8fb8d8 },
  { name: 'Mint', price: 150, color: 0x9fd3b5 },
  { name: 'Blush pink', price: 150, color: 0xe8a8b8 },
  { name: 'Burgundy', price: 400, color: 0x6e1a2e },
  { name: 'Midnight', price: 400, color: 0x1f2748 },
  { name: 'Emerald silk', price: 900, color: 0x145a3e },
  { name: 'Gold leaf', price: 3000, color: 0xc89b3c },
];

export const ROOM_FLOORS: (RoomOption & { color: number; sheen: number })[] = [
  { name: 'Basic carpet', price: 0, color: 0x8a7f72, sheen: 0 },
  { name: 'Oak boards', price: 300, color: 0x9a6a3c, sheen: 0.2 },
  { name: 'Ruby carpet', price: 500, color: 0x8a1030, sheen: 0 },
  { name: 'Royal blue carpet', price: 500, color: 0x1d3f8a, sheen: 0 },
  { name: 'White marble', price: 1800, color: 0xeeeae2, sheen: 0.6 },
  { name: 'Black marble', price: 2600, color: 0x1a1820, sheen: 0.7 },
];

export interface RoomExtra extends RoomOption {
  id: string;
  icon: string;
  /** Only fits in a suite. */
  suite?: boolean;
}

export const ROOM_EXTRAS: RoomExtra[] = [
  { id: 'lamps', name: 'Bedside lamps', icon: '💡', price: 150 },
  { id: 'plant', name: 'House plant', icon: '🪴', price: 200 },
  { id: 'art', name: 'Framed art', icon: '🖼️', price: 450 },
  { id: 'rug', name: 'Fluffy rug', icon: '🟫', price: 350 },
  { id: 'tv', name: 'Flat-screen TV', icon: '📺', price: 1200 },
  { id: 'desk', name: 'Writing desk', icon: '🪑', price: 900 },
  { id: 'minibar', name: 'Minibar', icon: '🍾', price: 1800 },
  { id: 'sofa', name: 'Velvet sofa', icon: '🛋️', price: 2200 },
  { id: 'chandelier', name: 'Crystal chandelier', icon: '✨', price: 5000 },
  { id: 'jacuzzi', name: 'Private jacuzzi', icon: '🛁', price: 12000, suite: true },
  { id: 'piano', name: 'Grand piano', icon: '🎹', price: 15000, suite: true },
];

export function defaultSetup(): RoomSetup {
  return { bed: 0, wall: 0, floor: 0, extras: [] };
}

const clampIdx = (v: unknown, n: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(n - 1, Math.round(v))) : 0);

/** Keep only valid choices (saves, imports, other players). */
export function sanitizeSetup(raw: unknown, suite = true): RoomSetup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = new Set(ROOM_EXTRAS.filter((e) => suite || !e.suite).map((e) => e.id));
  const extras = Array.isArray(r.extras) ? [...new Set(r.extras.filter((x): x is string => typeof x === 'string' && ok.has(x)))] : [];
  return { bed: clampIdx(r.bed, BEDS.length), wall: clampIdx(r.wall, ROOM_WALLS.length), floor: clampIdx(r.floor, ROOM_FLOORS.length), extras };
}

/** What the decoration is worth (the room shell's own price not included). */
export function setupValue(s: RoomSetup): number {
  let v = BEDS[s.bed].price + ROOM_WALLS[s.wall].price + ROOM_FLOORS[s.floor].price;
  for (const id of s.extras) v += ROOM_EXTRAS.find((e) => e.id === id)?.price ?? 0;
  return v;
}

/** Stars from what went into the room (1 to 5). */
export function roomStars(s: RoomSetup, suite = false): number {
  const v = setupValue(s) + (suite ? 3000 : 0);
  return v >= 25000 ? 5 : v >= 12000 ? 4 : v >= 5000 ? 3 : v >= 1500 ? 2 : 1;
}

/** Nightly price: the room's base rate plus a share of what you spent decorating it. */
export function roomRate(s: RoomSetup, suite = false): number {
  const base = suite ? 180 : 60;
  return Math.round((base + setupValue(s) * 0.032) / 5) * 5;
}

/** Cost to turn one setup into another: you pay for upgrades, and get half back on what you remove. */
export function changeCost(from: RoomSetup, to: RoomSetup): number {
  const d = setupValue(to) - setupValue(from);
  return d >= 0 ? d : Math.round(d * 0.5);
}

export function sameSetup(a: RoomSetup, b: RoomSetup): boolean {
  return a.bed === b.bed && a.wall === b.wall && a.floor === b.floor && [...a.extras].sort().join() === [...b.extras].sort().join();
}
