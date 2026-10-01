import type { CasinoSnapshot } from './save';
import { sanitizeSnapshot } from './save';
import type { CasinoLook } from '../world/building';
import type { Layout } from '../world/grid';
import { emptyStats, type LifetimeStats } from './objectives';
import { itemDef } from '../items/catalog';
import { roomRate, sanitizeSetup } from '../hotel/rooms';
import type { Appearance } from '../entities/appearance';
import { ROLES } from '../entities/staff';

/** A tower (rooms and services, under a roof) or an open-air Pool Garden. */
export type HotelBuildingKind = 'tower' | 'garden';

/** One of the hotel's buildings: each stands on its own lot next to your casino. */
export interface HotelBuilding {
  id: string;
  kind: HotelBuildingKind;
  snap: CasinoSnapshot;
  /** Estimated earnings per game second while you're not inside it. */
  rate: number;
}

export interface HotelReview {
  stars: number;
  text: string;
  name: string;
  vip: boolean;
  day: number;
}

/**
 * Your hotel: a second, separate tycoon next door. It has its own bank, level, goals and
 * buildings; while you're not in a building it keeps earning on an estimate from last time.
 */
export interface HotelState {
  bank: number;
  xp: number;
  level: number;
  objectives: string[];
  stats: LifetimeStats;
  history: number[];
  /** Guests sleeping there when you left (some come over to the casino). */
  staying: number;
  buildings: HotelBuilding[];
  /** Latest guest reviews, newest first. */
  reviews: HotelReview[];
}

/** What the casino pays to build the hotel, and the hotel's own starting cash. */
export const HOTEL_PRICE = 50_000;
export const HOTEL_LEVEL = 6;
export const HOTEL_START_CASH = 12_000;
export const HOTEL_MAX_BUILDINGS = 6;
export const MAX_REVIEWS = 30;

/** Price and hotel level for another building of a kind (given how many you have). */
export function buildingCost(kind: HotelBuildingKind, have: number): { price: number; level: number } {
  if (kind === 'garden') return { price: Math.round(18_000 * Math.pow(1.8, have)), level: 3 + have * 3 };
  return { price: Math.round(45_000 * Math.pow(2, have - 1)), level: 3 + have * 2 };
}

export function hotelName(casino: string): string {
  return `${casino} Hotel`.slice(0, 26);
}

export function hotelLook(casino: CasinoLook): CasinoLook {
  return { ...casino, name: hotelName(casino.name) };
}

/** Name shown on a building's sign: the hotel name, plus which building it is. */
export function buildingName(hotel: string, b: { kind: HotelBuildingKind }, index: number, buildings: { kind: HotelBuildingKind }[]): string {
  if (b.kind === 'garden') {
    const n = buildings.slice(0, index + 1).filter((x) => x.kind === 'garden').length;
    return n > 1 ? `Pool Garden ${n}` : 'Pool Garden';
  }
  const n = buildings.slice(0, index + 1).filter((x) => x.kind === 'tower').length;
  return n > 1 ? `${hotel} · Tower ${n}` : hotel;
}

export function emptyBuilding(id: string, kind: HotelBuildingKind, look: CasinoLook): HotelBuilding {
  const layout: Layout = kind === 'garden' ? { width: 1, depth: 0 } : { width: 0, depth: 0 };
  return { id, kind, rate: 0, snap: { name: look.name, look, layout, floors: 1, paint: [''], items: [], staff: [], rating: 2 } };
}

export function newHotel(look: CasinoLook): HotelState {
  const l = hotelLook(look);
  return {
    bank: HOTEL_START_CASH, xp: 0, level: 1, objectives: [], stats: emptyStats(), history: [], staying: 0,
    buildings: [emptyBuilding('h0', 'tower', l)], reviews: [],
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

/** What a tower still needs before it can take guests. */
export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export function towerChecklist(items: { kind: string }[], housekeepers: number): ChecklistItem[] {
  const has = (k: string) => items.some((i) => i.kind === k);
  return [
    { id: 'desk', label: 'A reception desk', done: has('desk') },
    { id: 'buffet', label: 'A breakfast buffet', done: has('buffet') },
    { id: 'room', label: 'At least one guest room', done: has('room') },
    { id: 'staff', label: 'A housekeeper (Staff)', done: housekeepers > 0 },
  ];
}

function kindOf(id: string): string {
  try {
    return itemDef(id).kind;
  } catch {
    return '';
  }
}

export function snapChecklist(snap: CasinoSnapshot): ChecklistItem[] {
  return towerChecklist(snap.items.map((i) => ({ kind: kindOf(i.id) })), snap.staff.filter((s) => s.role === 'janitor').length);
}

/** Pools, hot tubs and cabanas across all Pool Gardens make every tower easier to fill. */
export function gardenBoost(h: HotelState): number {
  let b = 0;
  for (const bd of h.buildings) {
    if (bd.kind !== 'garden') continue;
    for (const it of bd.snap.items) {
      const k = kindOf(it.id);
      if (k === 'pool') b += it.id === 'waterslide' ? 0.15 : 0.08;
      else if (k === 'hottub' || k === 'lounger' || (k === 'bar' && it.id === 'tikibar')) b += 0.02;
    }
  }
  return 1 + Math.min(0.5, b);
}

/**
 * Money per game second a building makes while you're not in it. A tower sells rooms (only
 * once it passes its opening checklist); housekeepers keep them turning over. A Pool Garden
 * earns from cabanas and its bar, as long as some tower is open to send guests.
 */
export function estimateBuildingRate(b: HotelBuilding, h: HotelState): number {
  const snap = b.snap;
  if (b.kind === 'garden') {
    if (!h.buildings.some((x) => x.kind === 'tower' && snapChecklist(x.snap).every((c) => c.done))) return 0;
    let perSec = 0;
    for (const it of snap.items) {
      try {
        const def = itemDef(it.id);
        if (def.minBet > 0) perSec += ((def.minBet + def.maxBet) / 2) * def.seats.length * 0.25 / def.roundTime;
      } catch {
        /* unknown item */
      }
    }
    return perSec;
  }
  if (!snapChecklist(snap).every((c) => c.done)) return 0;
  const housekeepers = snap.staff.filter((s) => s.role === 'janitor').length;
  const laundry = snap.items.some((i) => i.id === 'laundry') ? 1.25 : 1;
  const turnover = Math.min(1, (0.5 + housekeepers * 0.15) * laundry);
  let perSec = 0;
  for (const it of snap.items) {
    let def;
    try {
      def = itemDef(it.id);
    } catch {
      continue;
    }
    if (def.kind === 'room') {
      const cls = Math.max(0, Math.min(2, Number(def.params?.cls) || 0));
      const rate = roomRate(sanitizeSetup(it.setup, cls), cls);
      // A night plus the walk in, check-in and checkout; penthouses wait for a VIP.
      perSec += (rate / (def.roundTime * 2 + 30)) * (def.vipOnly ? 0.35 : 1);
    } else if (def.minBet > 0) {
      // Breakfast, dinners and treatments on the side.
      perSec += ((def.minBet + def.maxBet) / 2) * def.seats.length * 0.15 / def.roundTime;
    }
  }
  return perSec * hotelOccupancy(snap.rating) * turnover * gardenBoost(h);
}

/** The hotel's daily wages and upkeep (paid from its own bank), for buildings not loaded. */
export function hotelDailyCosts(snaps: CasinoSnapshot[]): number {
  let c = 0;
  for (const snap of snaps) {
    for (const s of snap.staff) c += ROLES.find((r) => r.role === s.role)?.wage ?? 0;
    for (const it of snap.items) {
      try {
        c += itemDef(it.id).upkeep;
      } catch {
        /* unknown item */
      }
    }
  }
  return c;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/**
 * Check a saved hotel. One-building hotels (a single `snap`) become a hotel with that tower;
 * hotels from before the hotel was a tycoon (a tier, no floor plan) start fresh with cash.
 */
export function sanitizeHotel(raw: unknown, look: CasinoLook, fonts: string[], sanitizeLook: (a: unknown) => Appearance): HotelState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const l = hotelLook(look);
  if (!r.snap && !Array.isArray(r.buildings)) {
    const h = newHotel(look);
    h.bank = 20_000;
    return h;
  }
  const rawBuildings: unknown[] = Array.isArray(r.buildings) ? r.buildings : [{ id: 'h0', kind: 'tower', snap: r.snap, rate: r.rate }];
  const buildings: HotelBuilding[] = [];
  const ids = new Set<string>();
  for (const rb of rawBuildings.slice(0, HOTEL_MAX_BUILDINGS)) {
    const b = (rb ?? {}) as Record<string, unknown>;
    const kind: HotelBuildingKind = b.kind === 'garden' ? 'garden' : 'tower';
    let id = typeof b.id === 'string' && /^h\d{1,3}$/.test(b.id) ? b.id : `h${buildings.length}`;
    while (ids.has(id)) id = `h${Number(id.slice(1)) + 1}`;
    ids.add(id);
    const snap = sanitizeSnapshot(b.snap, fonts, sanitizeLook);
    const bd = snap ? { id, kind, snap, rate: num(b.rate, 0, 1e6, 0) } : emptyBuilding(id, kind, l);
    if (kind === 'garden') bd.snap.floors = 1;
    buildings.push(bd);
  }
  if (!buildings.some((b) => b.kind === 'tower')) buildings.unshift(emptyBuilding('h0', 'tower', l));
  const stats = emptyStats();
  const si = (r.stats ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(stats) as (keyof LifetimeStats)[]) stats[k] = num(si[k], -1e15, 1e15, 0);
  const reviews: HotelReview[] = [];
  for (const rv of Array.isArray(r.reviews) ? r.reviews.slice(0, MAX_REVIEWS) : []) {
    const o = (rv ?? {}) as Record<string, unknown>;
    if (typeof o.text !== 'string') continue;
    reviews.push({
      stars: Math.round(num(o.stars, 1, 5, 3)), text: o.text.slice(0, 200), name: typeof o.name === 'string' ? o.name.slice(0, 30) : 'A guest',
      vip: o.vip === true, day: Math.round(num(o.day, 1, 1e6, 1)),
    });
  }
  return {
    bank: Math.round(num(r.bank, -1e12, 1e15, HOTEL_START_CASH)),
    xp: Math.round(num(r.xp, 0, 1e12, 0)),
    level: Math.round(num(r.level, 1, 99, 1)),
    objectives: Array.isArray(r.objectives) ? r.objectives.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
    stats,
    history: Array.isArray(r.history) ? r.history.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-30) : [],
    staying: Math.round(num(r.staying, 0, 5000, 0)),
    buildings,
    reviews,
  };
}
