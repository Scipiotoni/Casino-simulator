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

/** 0 = standard room, 1 = luxury suite, 2 = penthouse. */
export type RoomClass = 0 | 1 | 2;

export const ROOM_CLASS_NAMES = ['room', 'suite', 'penthouse'] as const;

export interface RoomOption {
  name: string;
  price: number;
}

export const BEDS: RoomOption[] = [
  { name: 'Single bed', price: 0 },
  { name: 'Double bed', price: 700 },
  { name: 'King bed', price: 2400 },
  { name: 'Royal canopy bed', price: 9000 },
  { name: 'Round velvet bed', price: 22000 },
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
  { name: 'Black lacquer', price: 6000, color: 0x15121a },
];

export const ROOM_FLOORS: (RoomOption & { color: number; sheen: number })[] = [
  { name: 'Basic carpet', price: 0, color: 0x8a7f72, sheen: 0 },
  { name: 'Oak boards', price: 300, color: 0x9a6a3c, sheen: 0.2 },
  { name: 'Ruby carpet', price: 500, color: 0x8a1030, sheen: 0 },
  { name: 'Royal blue carpet', price: 500, color: 0x1d3f8a, sheen: 0 },
  { name: 'White marble', price: 1800, color: 0xeeeae2, sheen: 0.6 },
  { name: 'Black marble', price: 2600, color: 0x1a1820, sheen: 0.7 },
  { name: 'Gold mosaic', price: 8000, color: 0xd9a53a, sheen: 0.8 },
];

export interface RoomExtra extends RoomOption {
  id: string;
  icon: string;
  /** Smallest room class it fits in (suites and penthouses are bigger). */
  min?: RoomClass;
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
  { id: 'jacuzzi', name: 'Private jacuzzi', icon: '🛁', price: 12000, min: 1 },
  { id: 'piano', name: 'Grand piano', icon: '🎹', price: 15000, min: 1 },
  { id: 'aquarium', name: 'Wall aquarium', icon: '🐠', price: 9000, min: 1 },
  { id: 'bar', name: 'Private cocktail bar', icon: '🍸', price: 18000, min: 2 },
  { id: 'cinema', name: 'Home cinema', icon: '🎬', price: 24000, min: 2 },
  { id: 'statue', name: 'Gold statue', icon: '🗿', price: 30000, min: 2 },
];

/** Quick looks for the decorator (only extras that fit the room are kept). */
export const ROOM_THEMES: { name: string; icon: string; setup: RoomSetup }[] = [
  { name: 'Budget', icon: '🧳', setup: { bed: 0, wall: 0, floor: 0, extras: ['lamps'] } },
  { name: 'Cozy', icon: '🧸', setup: { bed: 1, wall: 3, floor: 1, extras: ['lamps', 'plant', 'rug', 'art'] } },
  { name: 'Business', icon: '💼', setup: { bed: 2, wall: 5, floor: 3, extras: ['lamps', 'tv', 'desk', 'minibar'] } },
  { name: 'Tropical', icon: '🌴', setup: { bed: 2, wall: 2, floor: 1, extras: ['lamps', 'plant', 'rug', 'tv', 'sofa', 'aquarium'] } },
  { name: 'Royal', icon: '👑', setup: { bed: 3, wall: 4, floor: 4, extras: ['lamps', 'art', 'rug', 'tv', 'minibar', 'sofa', 'chandelier', 'jacuzzi'] } },
  {
    name: 'Ultra luxe', icon: '💎',
    setup: { bed: 4, wall: 8, floor: 6, extras: ['lamps', 'art', 'rug', 'tv', 'desk', 'minibar', 'sofa', 'chandelier', 'jacuzzi', 'piano', 'aquarium', 'bar', 'cinema', 'statue'] },
  },
];

export function defaultSetup(): RoomSetup {
  return { bed: 0, wall: 0, floor: 0, extras: [] };
}

const clampIdx = (v: unknown, n: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(n - 1, Math.round(v))) : 0);

export function fitsClass(e: RoomExtra, cls: number): boolean {
  return (e.min ?? 0) <= cls;
}

/** Keep only valid choices that fit this room class (saves, imports, other players). */
export function sanitizeSetup(raw: unknown, cls = 2): RoomSetup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = new Set(ROOM_EXTRAS.filter((e) => fitsClass(e, cls)).map((e) => e.id));
  const extras = Array.isArray(r.extras) ? [...new Set(r.extras.filter((x): x is string => typeof x === 'string' && ok.has(x)))] : [];
  return { bed: clampIdx(r.bed, BEDS.length), wall: clampIdx(r.wall, ROOM_WALLS.length), floor: clampIdx(r.floor, ROOM_FLOORS.length), extras };
}

/** A theme, trimmed to what the room can hold. */
export function themeFor(theme: RoomSetup, cls: number): RoomSetup {
  return sanitizeSetup(theme, cls);
}

/** What the decoration is worth (the room shell's own price not included). */
export function setupValue(s: RoomSetup): number {
  let v = BEDS[s.bed].price + ROOM_WALLS[s.wall].price + ROOM_FLOORS[s.floor].price;
  for (const id of s.extras) v += ROOM_EXTRAS.find((e) => e.id === id)?.price ?? 0;
  return v;
}

const CLASS_BONUS = [0, 3000, 12000];
const CLASS_BASE = [60, 180, 600];

/** Stars from what went into the room (1 to 5). */
export function roomStars(s: RoomSetup, cls = 0): number {
  const v = setupValue(s) + CLASS_BONUS[cls];
  return v >= 25000 ? 5 : v >= 12000 ? 4 : v >= 5000 ? 3 : v >= 1500 ? 2 : 1;
}

/** Nightly price: the room's base rate plus a share of what you spent decorating it. */
export function roomRate(s: RoomSetup, cls = 0): number {
  return Math.round((CLASS_BASE[cls] + setupValue(s) * 0.032) / 5) * 5;
}

/** Cost to turn one setup into another: you pay for upgrades, and get half back on what you remove. */
export function changeCost(from: RoomSetup, to: RoomSetup): number {
  const d = setupValue(to) - setupValue(from);
  return d >= 0 ? d : Math.round(d * 0.5);
}

export function sameSetup(a: RoomSetup, b: RoomSetup): boolean {
  return a.bed === b.bed && a.wall === b.wall && a.floor === b.floor && [...a.extras].sort().join() === [...b.extras].sort().join();
}
