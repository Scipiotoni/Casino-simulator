import { CENTER_X, DEPTH_STEP, FACADE_Z, LOT_STRIDE, ROAD_MID, SIDEWALK_Z0, START_DEPTH } from './grid';

/**
 * The city plan: a grid of east–west streets crossed by north–south avenues. Every street
 * has a row of lots on both sides (facing each other across the road, like the old single
 * street); a block is BLOCK_COLS lots wide and an avenue runs between blocks. Lots that no
 * player uses hold "filler" buildings (apartments, offices, diners, parks…) that make way
 * as soon as somebody needs the space.
 *
 * Global frame: the frame of a lot in row 0, column 0 on the north side of street 0 (the
 * original single street). Rows go south (+z), columns east (+x).
 */

/** Lots per block along a street. */
export const BLOCK_COLS = 4;
/** Width of an avenue: sidewalk, two lanes, sidewalk. */
export const AVE_W = 16;
export const AVE_WALK = 3.5;
/** The building limit is this many depth steps (lots back onto the next street's lots). */
export const MAX_DEPTH_STEPS = 14;
export const MAX_DEPTH = START_DEPTH + MAX_DEPTH_STEPS * DEPTH_STEP;
/** Strip of service alley between the backs of two rows of lots. */
export const ALLEY = 8;
/** Distance between two streets (centre to centre). */
export const ROW_GAP = 2 * (ROAD_MID - FACADE_Z) + 2 * MAX_DEPTH + ALLEY;
/** Streets in the city (rows of lots). */
export const STREET_ROWS = 3;
/** The city is at least this many lots wide. */
export const MIN_COLS = 12;
/** Half the road width (curb to centre line). */
export const ROAD_HALF = ROAD_MID - (SIDEWALK_Z0 + 4);

export const STREET_NAMES = ['Casino Strip', 'Palm Avenue', 'Downtown Boulevard'];
export const STREET_BLURBS = ['Casinos & hotels', 'Houses', 'Shops & offices'];
const AVENUE_NAMES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave', '9th Ave', '10th Ave', '11th Ave', '12th Ave'];

export function avenueName(k: number): string {
  return AVENUE_NAMES[k] ?? `${k + 1}th Ave`;
}

/** Global x offset of a lot column (lot-local x → global x on the north side). */
export function colX(c: number): number {
  return c * LOT_STRIDE + Math.floor(c / BLOCK_COLS) * AVE_W;
}

/** Global z offset of a street row. */
export function rowZ(r: number): number {
  return r * ROW_GAP;
}

/** Road centre line of street `r`. */
export function streetZ(r: number): number {
  return ROAD_MID + rowZ(r);
}

/** West edge of block `k` (where its first lot's stride starts). */
export function blockX0(k: number): number {
  return CENTER_X - LOT_STRIDE / 2 + k * (BLOCK_COLS * LOT_STRIDE + AVE_W);
}

/** Avenue `k` runs along the west side of block `k` (avenue `blocks` closes the east end). */
export function avenueX(k: number): [number, number] {
  const x1 = blockX0(k);
  return [x1 - AVE_W, x1];
}

export function avenueMid(k: number): number {
  const [a, b] = avenueX(k);
  return (a + b) / 2;
}

/** North and south edge of everything (lots included). */
export function cityZ(): [number, number] {
  return [FACADE_Z - MAX_DEPTH - ALLEY / 2, rowZ(STREET_ROWS - 1) + 2 * ROAD_MID - FACADE_Z + MAX_DEPTH + ALLEY / 2];
}

/** Walkable band of street `r` (both sidewalks and the road), global z. */
export function streetBand(r: number): [number, number] {
  return [SIDEWALK_Z0 + rowZ(r), 2 * ROAD_MID - SIDEWALK_Z0 + rowZ(r)];
}

export interface SlotRef {
  row: number;
  col: number;
  side: 0 | 1;
}

export function slotKey(s: SlotRef): number {
  return s.row * 10000 + s.col * 2 + s.side;
}

export function slotOfKey(k: number): SlotRef {
  const row = Math.floor(k / 10000);
  const rest = k - row * 10000;
  return { row, col: Math.floor(rest / 2), side: (rest % 2) as 0 | 1 };
}

/** Lot-local point → global, for a lot in this slot. */
export function slotToGlobal(s: SlotRef, x: number, z: number): { x: number; z: number } {
  const ox = colX(s.col);
  const oz = rowZ(s.row);
  return s.side === 0 ? { x: x + ox, z: z + oz } : { x: 2 * CENTER_X + ox - x, z: 2 * ROAD_MID + oz - z };
}

/** Global point → a lot's local frame (each side's transform is its own inverse). */
export function globalToSlot(s: SlotRef, x: number, z: number): { x: number; z: number } {
  const ox = colX(s.col);
  const oz = rowZ(s.row);
  return s.side === 0 ? { x: x - ox, z: z - oz } : { x: 2 * CENTER_X + ox - x, z: 2 * ROAD_MID + oz - z };
}

/** Which lot slot faces the street nearest this global point (null on an avenue or out of town). */
export function slotAt(gx: number, gz: number, cols: number): SlotRef | null {
  const r = Math.round((gz - ROAD_MID) / ROW_GAP) || 0;
  if (r < 0 || r >= STREET_ROWS) return null;
  const side: 0 | 1 = gz < streetZ(r) ? 0 : 1;
  const span = BLOCK_COLS * LOT_STRIDE + AVE_W;
  const u = gx - (CENTER_X - LOT_STRIDE / 2);
  if (u < 0) return null;
  const k = Math.floor(u / span);
  const within = u - k * span;
  if (within >= BLOCK_COLS * LOT_STRIDE) return null;
  const col = k * BLOCK_COLS + Math.floor(within / LOT_STRIDE);
  if (col >= cols) return null;
  return { row: r, col, side };
}

/** How many blocks a city of `cols` columns has. */
export function blocksFor(cols: number): number {
  return Math.ceil(cols / BLOCK_COLS);
}

/** Global x range of the whole city (outer avenues included). */
export function cityX(cols: number): [number, number] {
  return [avenueX(0)[0], avenueX(blocksFor(cols))[1]];
}

/** Can you walk here (global tile centre)? Sidewalks and roads of every street and avenue. */
export function onRoadNetwork(gx: number, gz: number, cols: number): boolean {
  const [x0, x1] = cityX(cols);
  if (gx < x0 || gx > x1) return false;
  for (let r = 0; r < STREET_ROWS; r++) {
    const [a, b] = streetBand(r);
    if (gz > a && gz < b) return true;
  }
  const [z0, z1] = cityZ();
  if (gz < z0 || gz > z1) return false;
  for (let k = 0; k <= blocksFor(cols); k++) {
    const [a, b] = avenueX(k);
    if (gx > a && gx < b) return true;
  }
  return false;
}

/** Tiny deterministic hash → 0..1 for filler variety. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export type FillerKind =
  | 'apartments' | 'office' | 'tower' | 'diner' | 'shops' | 'warehouse' | 'park' | 'parking' | 'brownstone' | 'hotelOld'
  | 'villa' | 'cottage' | 'church' | 'cinema' | 'gasstation';

const FILLERS_BY_ROW: FillerKind[][] = [
  ['shops', 'diner', 'apartments', 'parking', 'cinema', 'hotelOld', 'office', 'park'],
  ['villa', 'cottage', 'brownstone', 'apartments', 'park', 'villa', 'cottage', 'church'],
  ['office', 'tower', 'tower', 'warehouse', 'shops', 'gasstation', 'apartments', 'parking', 'office'],
];

const FILLER_NAMES: Record<FillerKind, string[]> = {
  apartments: ['Sunset Apartments', 'The Lofts', 'Maple Court', 'Skyline Flats', 'Rosewood Residences'],
  office: ['Gold Coast Offices', 'Pinnacle Plaza', 'Meridian Center', 'Union Building'],
  tower: ['Apex Tower', 'Crown Tower', 'Halcyon Tower', 'Zenith One'],
  diner: ['Lucky Diner', 'Rosie’s Diner', 'Moonlight Diner', 'Blue Plate'],
  shops: ['Corner Market', 'Pawn & Loan', 'Wedding Chapel', 'Souvenirs', 'Pizza', 'Donuts', 'Laundromat', 'Barber'],
  warehouse: ['Storage Co.', 'Depot 9', 'Freight Works'],
  park: ['City Park', 'Palm Garden', 'Rose Park', 'Dog Park'],
  parking: ['Parking', 'Valet Lot', 'Park & Go'],
  brownstone: ['Brownstones', 'Elm Row', 'Old Town Homes'],
  hotelOld: ['Desert Inn', 'Starlite Motel', 'Oasis Motor Lodge'],
  villa: ['Villa', 'Mansion', 'Estate'],
  cottage: ['Cottage', 'Bungalow', 'Ranch House'],
  church: ['Little Chapel', 'Elvis Wedding Chapel'],
  cinema: ['Grand Cinema', 'Drive-In', 'Rialto'],
  gasstation: ['Gas & Go', 'Fuel Stop'],
};

export interface FillerSpec {
  kind: FillerKind;
  name: string;
  /** Footprint width (tiles) and depth behind the facade. */
  w: number;
  d: number;
  floors: number;
  color: number;
  accent: number;
  seed: number;
}

const FILLER_WALLS = [0xd9c7a7, 0xb7a58f, 0x8c9aa8, 0xe6dccb, 0x9c6b4e, 0x6f7f8f, 0xc9b28a, 0xa8b8a0, 0xd8a48f, 0x7d8ea6, 0xe9e1d3, 0x5b6575];
const FILLER_ACCENTS = [0x2fb8c9, 0xff6fb5, 0xffc53d, 0x39ff88, 0xff8a1f, 0xb77bff, 0xff4d4d];

/** What stands in an unused lot (deterministic, so everybody sees the same city). */
export function fillerFor(s: SlotRef): FillerSpec {
  const seed = slotKey(s) * 7 + 13;
  const list = FILLERS_BY_ROW[Math.min(s.row, FILLERS_BY_ROW.length - 1)];
  const kind = list[Math.floor(hash01(seed) * list.length)];
  const names = FILLER_NAMES[kind];
  const name = names[Math.floor(hash01(seed + 1) * names.length)];
  const r = (k: number) => hash01(seed + k);
  let w = 22;
  let d = 20;
  let floors = 2;
  switch (kind) {
    case 'apartments':
      w = 20 + Math.round(r(3) * 8);
      d = 18 + Math.round(r(4) * 16);
      floors = 4 + Math.floor(r(5) * 5);
      break;
    case 'office':
      w = 22 + Math.round(r(3) * 8);
      d = 22 + Math.round(r(4) * 20);
      floors = 6 + Math.floor(r(5) * 6);
      break;
    case 'tower':
      w = 20 + Math.round(r(3) * 6);
      d = 20 + Math.round(r(4) * 10);
      floors = 14 + Math.floor(r(5) * 14);
      break;
    case 'diner':
    case 'gasstation':
      w = 18;
      d = 12;
      floors = 1;
      break;
    case 'shops':
      w = 26;
      d = 14 + Math.round(r(4) * 8);
      floors = 1 + Math.floor(r(5) * 2);
      break;
    case 'warehouse':
      w = 28;
      d = 30 + Math.round(r(4) * 20);
      floors = 2;
      break;
    case 'park':
    case 'parking':
      w = 30;
      d = 40;
      floors = 0;
      break;
    case 'brownstone':
      w = 28;
      d = 16;
      floors = 3 + Math.floor(r(5) * 2);
      break;
    case 'hotelOld':
      w = 26;
      d = 16;
      floors = 2;
      break;
    case 'villa':
      w = 20 + Math.round(r(3) * 6);
      d = 16 + Math.round(r(4) * 6);
      floors = 2;
      break;
    case 'cottage':
      w = 14 + Math.round(r(3) * 4);
      d = 12;
      floors = 1;
      break;
    case 'church':
      w = 14;
      d = 22;
      floors = 2;
      break;
    case 'cinema':
      w = 26;
      d = 30;
      floors = 3;
      break;
  }
  return {
    kind, name, w, d, floors, seed,
    color: FILLER_WALLS[Math.floor(r(6) * FILLER_WALLS.length)],
    accent: FILLER_ACCENTS[Math.floor(r(7) * FILLER_ACCENTS.length)],
  };
}
