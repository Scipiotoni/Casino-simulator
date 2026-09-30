import type { CasinoSnapshot } from './save';
import type { SavedItem } from '../items/placedItem';
import type { CasinoLook } from '../world/building';
import { CENTER_X, layoutRect, PORTAL, STAIR_TILE, type Layout } from '../world/grid';
import { itemDef, rotatedSize } from '../items/catalog';

/** Your hotel tower next to the casino. */
export interface HotelState {
  /** Storeys, lobby included (rooms are on every floor above it). */
  floors: number;
  /** Index into HOTEL_TIERS. */
  tier: number;
  /** Guests who slept here last night; they bring extra gamblers today. */
  staying: number;
  /** Last night's result, for the panel. */
  last: { guests: number; rooms: number; revenue: number; costs: number } | null;
}

export const HOTEL_PRICE = 120_000;
export const HOTEL_LEVEL = 8;
export const ROOMS_PER_FLOOR = 8;
export const HOTEL_MAX_FLOORS = 20;
/** The tower's footprint on its lot (narrowest width, one depth step). */
export const HOTEL_LAYOUT: Layout = { width: 0, depth: 1 };

export const HOTEL_TIERS: { name: string; stars: number; rate: number; cost: number; level: number }[] = [
  { name: 'Budget Inn', stars: 1, rate: 90, cost: 0, level: HOTEL_LEVEL },
  { name: 'Comfort Hotel', stars: 2, rate: 180, cost: 80_000, level: 10 },
  { name: 'Deluxe Resort', stars: 3, rate: 360, cost: 250_000, level: 13 },
  { name: 'Luxury Towers', stars: 4, rate: 750, cost: 700_000, level: 16 },
  { name: 'Grand Palace Suites', stars: 5, rate: 1500, cost: 2_000_000, level: 20 },
];

export function newHotel(): HotelState {
  return { floors: 2, tier: 0, staying: 0, last: null };
}

export function hotelRooms(h: HotelState): number {
  return (h.floors - 1) * ROOMS_PER_FLOOR;
}

/** Price of the next storey. */
export function hotelFloorCost(h: HotelState): number {
  return Math.round((40_000 * Math.pow(1.35, h.floors - 2)) / 1000) * 1000;
}

/** Share of rooms booked tonight: a better casino fills more rooms, fancier rooms are harder to sell. */
export function hotelOccupancy(tier: number, rating: number, rnd = Math.random()): number {
  const occ = 0.3 + rating * 0.13 - tier * 0.05 + (rnd - 0.5) * 0.12;
  return Math.max(0.05, Math.min(0.98, occ));
}

/** Nightly housekeeping and staff, per room. */
export function hotelCostPerRoom(tier: number): number {
  return Math.round(15 * (1 + tier * 0.8));
}

/** One night at the hotel: who checks in, what they pay, what it costs. Mutates the state. */
export function hotelNight(h: HotelState, rating: number, rnd = Math.random()): { guests: number; revenue: number; costs: number } {
  const rooms = hotelRooms(h);
  const guests = Math.round(rooms * hotelOccupancy(h.tier, rating, rnd));
  const revenue = guests * HOTEL_TIERS[h.tier].rate;
  const costs = rooms * hotelCostPerRoom(h.tier);
  h.staying = guests;
  h.last = { guests, rooms, revenue, costs };
  return { guests, revenue, costs };
}

/** Hotel guests visit the casino: more arrivals (up to double) and more high rollers. */
export function hotelGuestBoost(h: HotelState | null): { spawn: number; vip: number } {
  if (!h) return { spawn: 1, vip: 0 };
  return { spawn: 1 + Math.min(1, h.staying / 80), vip: h.staying > 0 ? 0.01 + h.tier * 0.012 : 0 };
}

export function hotelName(casino: string): string {
  return `${casino} Hotel`.slice(0, 26);
}

export function hotelLook(casino: CasinoLook): CasinoLook {
  return { ...casino, name: hotelName(casino.name) };
}

export function sanitizeHotel(raw: unknown): HotelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  const h: HotelState = { floors: n(r.floors, 2, HOTEL_MAX_FLOORS, 2), tier: n(r.tier, 0, HOTEL_TIERS.length - 1, 0), staying: 0, last: null };
  h.staying = n(r.staying, 0, hotelRooms(h), 0);
  const l = r.last as Record<string, unknown> | null | undefined;
  if (l && typeof l === 'object') {
    h.last = { guests: n(l.guests, 0, 1e5, 0), rooms: n(l.rooms, 0, 1e5, 0), revenue: n(l.revenue, 0, 1e9, 0), costs: n(l.costs, 0, 1e9, 0) };
  }
  return h;
}

/**
 * The inside of the tower: a lobby with the front desk, lounge and greenery, and a floor
 * of made-up rooms on every storey above.
 */
export function generateHotel(h: { floors: number; tier: number }, look: CasinoLook): CasinoSnapshot {
  const rect = layoutRect(HOTEL_LAYOUT);
  const items: SavedItem[] = [];
  const taken = new Set<string>();
  const put = (id: string, f: number, tx: number, tz: number, rot: number, color?: number): boolean => {
    const def = itemDef(id);
    const [w, d] = rotatedSize(def, rot);
    const tiles: string[] = [];
    for (let z = tz; z < tz + d; z++) {
      for (let x = tx; x < tx + w; x++) {
        if (x < rect.x0 || x > rect.x1 || z < rect.z0 || z > rect.z1) return false;
        if (x >= STAIR_TILE[0] - 1 && x <= PORTAL[0] + 1 && z >= STAIR_TILE[1] - 1 && z <= STAIR_TILE[1] + 3) return false;
        if (f === 0 && z >= rect.z1 - 3 && x >= CENTER_X - 2 && x <= CENTER_X + 1) return false;
        const key = `${f}:${x},${z}`;
        if (taken.has(key)) return false;
        tiles.push(key);
      }
    }
    tiles.forEach((k) => taken.add(k));
    items.push({ id, f: f || undefined, tx, tz, rot, level: 1, color: color ?? itemDef(id).colors[0], broken: false, stats: { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 } });
    return true;
  };
  const bedColors = [0x8a1030, 0x1d4fa0, 0x0f7a45, 0x6a2cc2, 0xc89b3c];
  const bed = bedColors[Math.max(0, Math.min(bedColors.length - 1, h.tier))];
  // Lobby
  put('frontdesk', 0, CENTER_X - 2, rect.z0 + 1, 0, look.wallColor);
  put('rug', 0, CENTER_X - 1, rect.z0 + 5, 0, 0x8a1030);
  put('rug', 0, CENTER_X - 1, rect.z0 + 7, 0, 0x8a1030);
  put('bench', 0, rect.x0 + 1, rect.z0 + 6, 1, 0x5a1426);
  put('bench', 0, rect.x1 - 1, rect.z0 + 6, 3, 0x5a1426);
  put('bench', 0, rect.x1 - 1, rect.z0 + 9, 3, 0x5a1426);
  put('fountain', 0, CENTER_X - 1, rect.z0 + 9, 0);
  for (const [x, z, id] of [
    [rect.x0, rect.z0, 'palm'], [rect.x1, rect.z0, 'palm'], [rect.x1, rect.z1, 'plant'], [CENTER_X - 3, rect.z1 - 1, 'pillar'],
    [CENTER_X + 2, rect.z1 - 1, 'pillar'], [rect.x0 + 3, rect.z0, 'plant'], [rect.x1 - 3, rect.z0, 'plant'], [rect.x1, rect.z0 + 3, 'lamp'],
  ] as [number, number, string][]) put(id, 0, x, z, 0);
  if (h.tier >= 3) put('statue', 0, rect.x0 + 3, rect.z0 + 10, 0);
  // Rooms: a row along the back wall and a row facing it
  for (let f = 1; f < h.floors; f++) {
    let n = 0;
    for (let x = rect.x0 + 1; x <= rect.x1 - 1 && n < ROOMS_PER_FLOOR / 2; x += 3) if (put('hotelbed', f, x, rect.z0, 0, bed)) n++;
    for (let x = rect.x1 - 2; x >= rect.x0 + 1 && n < ROOMS_PER_FLOOR; x -= 3) if (put('hotelbed', f, x, rect.z0 + 7, 0, bed)) n++;
    put('plant', f, rect.x1, rect.z1, 0);
    put('bench', f, rect.x1 - 1, rect.z1 - 3, 3, 0x5a1426);
    put('rug', f, CENTER_X - 1, rect.z0 + 4, 1, 0x8a1030);
  }
  return {
    name: look.name, look, layout: { ...HOTEL_LAYOUT }, floors: h.floors, paint: Array.from({ length: h.floors }, () => ''),
    items, staff: [], rating: 3 + h.tier * 0.4,
  };
}
