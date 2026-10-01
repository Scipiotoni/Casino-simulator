import type { CasinoLook } from '../world/building';
import type { CasinoSnapshot } from './save';
import { sanitizeSnapshot } from './save';
import type { Appearance } from '../entities/appearance';

/**
 * Your house on Palm Avenue doubles as your bank: buy a vault, pick its code, and move
 * money between the vault, the casino and the hotel. House guards and security gadgets
 * raise its security rating (it will matter once heists arrive).
 */
export interface HouseState {
  /** The house's floor plan (rooms, furniture, the vault, guards). */
  snap: CasinoSnapshot;
  /** Money in the vault. */
  vault: number;
  /** Vault code the owner picked ('' until one is set). */
  code: string;
  /** Vault tier: 0 = no vault yet, 1..VAULT_TIERS.length. */
  tier: number;
  /** Recent transfers, newest first. */
  log: VaultLog[];
  /** Garage size: 0 = none yet, 1..GARAGE_TIERS.length. */
  garage: number;
  /** Cars parked in the garage. */
  parked: ParkedCar[];
}

/** A car in your garage: one you bought (its id) or one you took out of traffic and kept. */
export interface ParkedCar {
  id?: string;
  /** Kept traffic car: its body type and paint. */
  kind?: number;
  color?: number;
}

export interface GarageTier {
  tier: number;
  name: string;
  price: number;
  /** Cars it holds. */
  cap: number;
  /** Depth of the building (metres). */
  depth: number;
}

export const GARAGE_TIERS: GarageTier[] = [
  { tier: 1, name: 'Two-Car Garage', price: 25_000, cap: 2, depth: 7 },
  { tier: 2, name: 'Four-Car Garage', price: 90_000, cap: 4, depth: 13 },
  { tier: 3, name: "Collector's Garage", price: 300_000, cap: 6, depth: 19 },
];

export function garageTier(tier: number): GarageTier | null {
  return GARAGE_TIERS[tier - 1] ?? null;
}

export interface VaultLog {
  day: number;
  text: string;
  amount: number;
}

export const HOUSE_PRICE = 15000;
export const HOUSE_LEVEL = 3;
export const MAX_VAULT_LOG = 12;

export interface VaultTier {
  tier: number;
  name: string;
  /** Price of this tier (the first is the vault itself, from the shop). */
  price: number;
  /** Most it can hold. */
  cap: number;
  /** Digits in its code. */
  digits: number;
  /** Interest paid on what's inside, per game day. */
  interest: number;
  /** Bolts on the door (drawn on the model and in the unlock animation). */
  bolts: number;
  /** Security points it adds. */
  security: number;
  blurb: string;
}

export const VAULT_TIERS: VaultTier[] = [
  { tier: 1, name: 'Steel Safe Room', price: 5000, cap: 100_000, digits: 4, interest: 0.005, bolts: 4, security: 10, blurb: 'A steel door with a four-digit code.' },
  { tier: 2, name: 'Bank Vault', price: 40_000, cap: 1_000_000, digits: 5, interest: 0.0075, bolts: 6, security: 20, blurb: 'Thick steel, six bolts and a five-digit code.' },
  { tier: 3, name: 'Titanium Vault', price: 250_000, cap: 10_000_000, digits: 6, interest: 0.01, bolts: 8, security: 32, blurb: 'Titanium plating and a six-digit code.' },
  { tier: 4, name: 'Diamond Vault', price: 1_500_000, cap: 100_000_000, digits: 7, interest: 0.0125, bolts: 10, security: 45, blurb: 'Diamond-hard door, ten bolts, seven digits.' },
  { tier: 5, name: 'Fort Knox', price: 8_000_000, cap: 1_000_000_000, digits: 8, interest: 0.015, bolts: 12, security: 60, blurb: 'The ultimate vault: twelve bolts and an eight-digit code.' },
];

export function vaultTier(tier: number): VaultTier | null {
  return VAULT_TIERS[tier - 1] ?? null;
}

export function newHouse(owner: string, look: CasinoLook): HouseState {
  const name = `${owner || 'Boss'}'s House`.slice(0, 26);
  return {
    snap: {
      name,
      look: { name, signFont: look.signFont, signColor: look.signColor, wallColor: 0xe9e1d3, trimColor: look.trimColor },
      layout: { width: 0, depth: 0 },
      floors: 1,
      paint: [],
      items: [],
      staff: [],
      rating: 3,
    },
    vault: 0,
    code: '',
    tier: 0,
    log: [],
    garage: 0,
    parked: [],
  };
}

/** A code is digits only, exactly as long as the tier asks. */
export function validCode(code: string, tier: number): boolean {
  const t = vaultTier(tier);
  return !!t && new RegExp(`^\\d{${t.digits}}$`).test(code);
}

/** How much can move between the vault and somewhere else (positive deposit, negative withdraw). */
export function clampTransfer(amount: number, vault: number, tier: number, source: number): number {
  const t = vaultTier(tier);
  if (!t || !Number.isFinite(amount)) return 0;
  amount = Math.round(amount);
  if (amount > 0) return Math.max(0, Math.min(amount, source, t.cap - vault));
  return -Math.max(0, Math.min(-amount, vault));
}

/** One day of interest on what's in the vault (never past its capacity). */
export function vaultInterest(h: HouseState): number {
  const t = vaultTier(h.tier);
  if (!t || h.vault <= 0) return 0;
  return Math.max(0, Math.min(Math.round(h.vault * t.interest), t.cap - h.vault));
}

/** Security rating 0..100: the vault, guards and gadgets. */
export function securityRating(tier: number, guards: number, gateGuards: number, gadgets: number): number {
  const v = vaultTier(tier)?.security ?? 0;
  return Math.max(0, Math.min(100, Math.round(v + guards * 9 + gateGuards * 6 + gadgets)));
}

export function addLog(h: HouseState, day: number, text: string, amount: number): void {
  h.log.unshift({ day, text, amount: Math.round(amount) });
  if (h.log.length > MAX_VAULT_LOG) h.log.length = MAX_VAULT_LOG;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** A stored house, checked (saves can be edited by hand). */
export function sanitizeHouse(raw: unknown, fonts: string[], sanitizeLook: (a: unknown) => Appearance): HouseState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const snap = sanitizeSnapshot(r.snap, fonts, sanitizeLook);
  if (!snap) return null;
  // Keep the extra per-item state the snapshot sanitizer doesn't know about.
  const tier = Math.round(num(r.tier, 0, VAULT_TIERS.length, 0));
  const code = typeof r.code === 'string' && /^\d{0,8}$/.test(r.code) ? r.code : '';
  const log: VaultLog[] = [];
  for (const it of Array.isArray(r.log) ? r.log.slice(0, MAX_VAULT_LOG) : []) {
    if (!it || typeof it !== 'object') continue;
    const l = it as Record<string, unknown>;
    log.push({ day: Math.round(num(l.day, 0, 1e6, 0)), text: typeof l.text === 'string' ? l.text.slice(0, 60) : '', amount: Math.round(num(l.amount, -1e12, 1e12, 0)) });
  }
  return {
    snap,
    vault: Math.round(num(r.vault, 0, vaultTier(tier)?.cap ?? 0, 0)),
    code: validCode(code, tier) ? code : '',
    tier,
    log,
    garage: Math.round(num(r.garage, 0, GARAGE_TIERS.length, 0)),
    parked: sanitizeParked(r.parked, garageTier(Math.round(num(r.garage, 0, GARAGE_TIERS.length, 0)))?.cap ?? 0),
  };
}

/** Parked cars from a save: known car ids (once each) or kept traffic cars, at most `cap`. */
export function sanitizeParked(raw: unknown, cap: number, known: (id: string) => boolean = () => true): ParkedCar[] {
  const out: ParkedCar[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(raw) ? raw : []) {
    if (out.length >= cap) break;
    if (!it || typeof it !== 'object') continue;
    const p = it as Record<string, unknown>;
    if (typeof p.id === 'string') {
      if (p.id.length > 20 || seen.has(p.id) || !known(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id });
    } else if (typeof p.kind === 'number' && typeof p.color === 'number') {
      out.push({ kind: Math.round(num(p.kind, 0, 4, 0)), color: Math.round(num(p.color, 0, 0xffffff, 0)) });
    }
  }
  return out;
}
