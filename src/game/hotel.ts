import type { CasinoSnapshot } from './save';
import { sanitizeSnapshot } from './save';
import type { CasinoLook } from '../world/building';
import type { Layout } from '../world/grid';
import { emptyStats, type LifetimeStats } from './objectives';
import { itemDef } from '../items/catalog';
import { roomRate, sanitizeSetup } from '../hotel/rooms';
import type { Appearance } from '../entities/appearance';
import { ROLES } from '../entities/staff';

/**
 * Your hotel: a second, separate tycoon next door. It has its own bank, level, goals and
 * floor plan; while you're in the casino it keeps earning on an estimate from last time.
 */
export interface HotelState {
  bank: number;
  xp: number;
  level: number;
  snap: CasinoSnapshot;
  objectives: string[];
  stats: LifetimeStats;
  history: number[];
  /** Estimated earnings per game second while you're not inside. */
  rate: number;
  /** Guests sleeping there when you left (some come over to the casino). */
  staying: number;
}

/** What the casino pays to build the hotel, and the hotel's own starting cash. */
export const HOTEL_PRICE = 50_000;
export const HOTEL_LEVEL = 6;
export const HOTEL_START_CASH = 8_000;
export const HOTEL_START_LAYOUT: Layout = { width: 0, depth: 0 };

export function hotelName(casino: string): string {
  return `${casino} Hotel`.slice(0, 26);
}

export function hotelLook(casino: CasinoLook): CasinoLook {
  return { ...casino, name: hotelName(casino.name) };
}

export function newHotel(look: CasinoLook): HotelState {
  const l = hotelLook(look);
  return {
    bank: HOTEL_START_CASH, xp: 0, level: 1,
    snap: { name: l.name, look: l, layout: { ...HOTEL_START_LAYOUT }, floors: 1, paint: [''], items: [], staff: [], rating: 2 },
    objectives: [], stats: emptyStats(), history: [], rate: 0, staying: 0,
  };
}

/** Guests at the hotel spill over into the casino: more arrivals and more high rollers. */
export function hotelGuestBoost(h: HotelState | null): { spawn: number; vip: number } {
  if (!h || !h.staying) return { spawn: 1, vip: 0 };
  return { spawn: 1 + Math.min(0.8, h.staying / 60), vip: Math.min(0.06, h.staying * 0.002) };
}

/** Share of rooms that sell each night at a given star rating. */
export function hotelOccupancy(rating: number): number {
  return Math.max(0.1, Math.min(0.95, 0.25 + rating * 0.13));
}

/**
 * Money per game second the hotel makes while you're not there: every room sells at the
 * rating's occupancy, one guest after another. Needs a reception, and rooms only turn
 * over quickly with housekeepers to make them up.
 */
export function estimateHotelRate(snap: CasinoSnapshot): number {
  const items = snap.items;
  if (!items.some((i) => i.id === 'reception')) return 0;
  const housekeepers = snap.staff.filter((s) => s.role === 'janitor').length;
  const turnover = housekeepers ? Math.min(1, 0.55 + housekeepers * 0.15) : 0.15;
  let perSec = 0;
  for (const it of items) {
    let def;
    try {
      def = itemDef(it.id);
    } catch {
      continue;
    }
    if (def.kind !== 'room') continue;
    const suite = Number(def.params?.suite) === 1;
    const rate = roomRate(sanitizeSetup(it.setup, suite), suite);
    // A night plus the walk in, check-in and checkout.
    perSec += rate / (def.roundTime * 2 + 30);
  }
  return perSec * hotelOccupancy(snap.rating) * turnover;
}

/** The hotel's daily wages and upkeep (paid from its own bank). */
export function hotelDailyCosts(snap: CasinoSnapshot): number {
  let c = 0;
  for (const s of snap.staff) c += ROLES.find((r) => r.role === s.role)?.wage ?? 0;
  for (const it of snap.items) {
    try {
      c += itemDef(it.id).upkeep;
    } catch {
      /* unknown item */
    }
  }
  return c;
}

export function hotelLotInfo(h: HotelState): { width: number; depth: number; floors: number } {
  return { width: h.snap.layout.width, depth: h.snap.layout.depth, floors: h.snap.floors };
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/**
 * Check a saved hotel. Hotels from before the hotel became its own tycoon (a tier and a
 * floor count, no floor plan) turn into a fresh empty hotel with some cash to start over.
 */
export function sanitizeHotel(raw: unknown, look: CasinoLook, fonts: string[], sanitizeLook: (a: unknown) => Appearance): HotelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.snap) {
    const h = newHotel(look);
    h.bank = 20_000;
    return h;
  }
  const snap = sanitizeSnapshot(r.snap, fonts, sanitizeLook);
  if (!snap) return newHotel(look);
  const stats = emptyStats();
  const si = (r.stats ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(stats) as (keyof LifetimeStats)[]) stats[k] = num(si[k], -1e15, 1e15, 0);
  return {
    bank: Math.round(num(r.bank, -1e12, 1e15, HOTEL_START_CASH)),
    xp: Math.round(num(r.xp, 0, 1e12, 0)),
    level: Math.round(num(r.level, 1, 99, 1)),
    snap,
    objectives: Array.isArray(r.objectives) ? r.objectives.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
    stats,
    history: Array.isArray(r.history) ? r.history.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-30) : [],
    rate: num(r.rate, 0, 1e6, 0),
    staying: Math.round(num(r.staying, 0, 5000, 0)),
  };
}
