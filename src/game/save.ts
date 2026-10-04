import type { CasinoLook } from '../world/building';
import { GRID_W, type Layout } from '../world/grid';
import type { SavedItem } from '../items/placedItem';
import type { WorkerRole } from '../entities/staff';
import type { Appearance } from '../entities/appearance';
import type { LifetimeStats } from './objectives';
import { sanitizeSetup } from '../hotel/rooms';
import { MAX_DEPTH_STEPS } from '../world/city';

export interface SavedStaff {
  role: WorkerRole;
  name: string;
  look: Appearance;
}

/** Everything needed to rebuild a casino's floor plan (yours, the rival's or another player's). */
export interface CasinoSnapshot {
  name: string;
  look: CasinoLook;
  layout: Layout;
  floors: number;
  /** Carpet per floor, run-length encoded over the owned rect. */
  paint: string[];
  /** Built walls per floor, encoded like the carpet (style + 1, 0 = none). */
  walls?: string[];
  items: SavedItem[];
  staff: SavedStaff[];
  rating: number;
  jackpotPot?: number;
}

export interface RivalState {
  bank: number;
  /** Size tier the rival has grown to. */
  tier: number;
  /** Epoch ms until which the rival's security won't let you in. */
  banUntil: number;
  /** Your net result at the rival over all visits. */
  net: number;
}

/** Per-player multiplayer bookkeeping. Tied to you, not to a casino: it survives starting over. */
export interface NetState {
  /** Cumulative amount you have lost (+) or won (-) at each owner's casino. */
  owes: Record<string, number>;
  /** How much of each visitor's cumulative debt you have already credited to your bank. */
  credited: Record<string, number>;
  /** Players you blacklisted: pid → epoch ms the ban ends. */
  bans: Record<string, number>;
  /** pid → epoch ms before which you can't blacklist them again. */
  banCooldown: Record<string, number>;
  /**
   * Id of your `owes` running totals. A fresh one is made whenever they start again from
   * zero (lost browser storage), so casino owners rebase instead of "paying back" the drop.
   */
  ep?: string;
  /** The running-total id each visitor's `credited` amount belongs to. */
  creditedEp?: Record<string, string>;
  /** Gifts you sent (kept in your ledger until they expire). */
  gifts?: import('./social').GiftOut[];
  /** Gifts you opened: gift id → when. */
  giftSeen?: Record<string, number>;
  /** Gifts you opened, newest last (for the history). */
  giftLog?: import('./social').GiftIn[];
  /** Gifts sent before this moment aren't yours to open (a fresh player id starts here). */
  giftSince?: number;
  /** Gift cash that arrived while you ran the hotel (it goes into the casino's bank later). */
  giftHeld?: number;
  /** Daily login reward streak. */
  daily?: import('./social').DailyState;
  /** What you owe the bank (it follows you through rebirths and new casinos). */
  loan?: number;
}

export function newNetEpoch(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface SaveData extends CasinoSnapshot {
  v: 2;
  money: number;
  xp: number;
  level: number;
  day: number;
  dayMinutes: number;
  satAvg: number;
  player: { look: Appearance; name: string; x: number; z: number; floor: number };
  objectives: string[];
  stats: LifetimeStats;
  trash: [number, number, number][];
  history: number[];
  floorPainted: number;
  lookEdited: boolean;
  renamed: boolean;
  speed: number;
  rival: RivalState;
  createdAt: number;
  /** Cosmetics bought and switched on (see src/cosmetics). */
  cosmetics?: { owned: string[]; on: string[] };
  /** Your hotel tower (see src/game/hotel.ts). */
  hotel?: import('./hotel').HotelState | null;
  /** Times you've been reborn. */
  rebirths?: number;
  /** Your house and its vault (see src/game/house.ts). */
  house?: import('./house').HouseState | null;
  /** Guns you own (see src/game/guns.ts). */
  guns?: import('./guns').GunState;
  garage?: import('./driving').GarageState;
  /** Pretend chips for practice play (home slot machine, your own tables). */
  playChips?: number;
  /** When this save was written (epoch ms): the newest of the local and cloud copies wins. */
  savedAt?: number;
  /** Multiplayer bookkeeping (also kept in its own browser key; this copy rides the cloud save). */
  net?: NetState;
}

export function emptyNet(): NetState {
  return { owes: {}, credited: {}, bans: {}, banCooldown: {}, ep: newNetEpoch(), creditedEp: {}, giftSince: Date.now() };
}

export function newRival(): RivalState {
  return { bank: 250000, tier: 0, banUntil: 0, net: 0 };
}

/** Old v1 expansions (0..5) mapped onto the new width steps and depth steps. */
const V1_LAYOUT: Layout[] = [
  { width: 0, depth: 0 },
  { width: 1, depth: 1 },
  { width: 2, depth: 2 },
  { width: 2, depth: 3 },
  { width: 2, depth: 5 },
  { width: 2, depth: 6 },
];

/** Accept any stored save and bring it up to the current format (null if unusable). */
export function migrateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.v === 2) {
    const d = s as unknown as SaveData;
    d.rival ??= newRival();
    d.createdAt ??= Date.now();
    return d;
  }
  if (s.v !== 1) return null;
  const e = Math.max(0, Math.min(5, Number(s.expansion) || 0));
  const layout = V1_LAYOUT[e];
  // v1 stored the whole 48-wide grid (rows from z = 0) run-length encoded.
  const paint = convertV1Floor(String(s.floor ?? ''), layout);
  const player = s.player as { look: Appearance; name: string; x: number; z: number };
  const trash = ((s.trash as [number, number][]) ?? []).map(([x, z]) => [x, z, 0] as [number, number, number]);
  return {
    v: 2,
    name: String(s.name ?? 'My Casino'),
    look: s.look as CasinoLook,
    layout,
    floors: 1,
    paint: [paint],
    items: (s.items as SavedItem[]) ?? [],
    staff: ((s.staff as SavedStaff[]) ?? []).map((st) => ({ ...st, role: (st.role as string) === 'cashier' ? 'doorman' : st.role })),
    rating: Number(s.rating) || 2,
    jackpotPot: Number(s.jackpotPot) || undefined,
    money: Number(s.money) || 0,
    xp: Number(s.xp) || 0,
    level: Number(s.level) || 1,
    day: Number(s.day) || 1,
    dayMinutes: Number(s.dayMinutes) || 0,
    satAvg: Number(s.satAvg) || 55,
    player: { ...player, floor: 0 },
    objectives: (s.objectives as string[]) ?? [],
    stats: s.stats as LifetimeStats,
    trash,
    history: (s.history as number[]) ?? [],
    floorPainted: Number(s.floorPainted) || 0,
    lookEdited: !!s.lookEdited,
    renamed: !!s.renamed,
    speed: Number(s.speed) || 1,
    rival: newRival(),
    createdAt: Date.now(),
  };
}

function convertV1Floor(s: string, layout: Layout): string {
  if (!s) return '';
  const cells = new Map<number, number>();
  let i = 0;
  for (const part of s.split(',')) {
    const [v, n] = part.split(':').map(Number);
    if (v) for (let k = 0; k < n; k++) cells.set(i + k, v);
    i += n || 0;
  }
  // Re-encode over the new owned rect, row by row.
  const widths = [14, 18, 22];
  const w = widths[layout.width];
  const d = 12 + layout.depth * 4;
  const x0 = 24 - w / 2;
  const z0 = 40 - d;
  const out: string[] = [];
  let cur = -1;
  let n = 0;
  for (let z = z0; z < 40; z++) {
    for (let x = x0; x < x0 + w; x++) {
      const v = z >= 0 ? cells.get(z * GRID_W + x) ?? 0 : 0;
      if (v === cur) n++;
      else {
        if (n) out.push(`${cur}:${n}`);
        cur = v;
        n = 1;
      }
    }
  }
  if (n) out.push(`${cur}:${n}`);
  return out.join(',');
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt);
const str = (v: unknown, max: number, dflt: string) => (typeof v === 'string' ? v.slice(0, max) : dflt);

/** Floor plans shared by other players are untrusted: clamp everything before loading one. */
export function sanitizeSnapshot(raw: unknown, fonts: string[], sanitizeLook: (a: unknown) => Appearance): CasinoSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const lookRaw = (s.look ?? {}) as Record<string, unknown>;
  const look: CasinoLook = {
    name: str(lookRaw.name, 26, 'Casino').trim() || 'Casino',
    signFont: fonts.includes(lookRaw.signFont as string) ? (lookRaw.signFont as string) : fonts[0],
    signColor: num(lookRaw.signColor, 0, 0xffffff, 0xff3fa4),
    wallColor: num(lookRaw.wallColor, 0, 0xffffff, 0x3a1d4d),
    trimColor: num(lookRaw.trimColor, 0, 0xffffff, 0x2fe6ff),
  };
  const lay = (s.layout ?? {}) as Record<string, unknown>;
  const layout: Layout = { width: num(lay.width, 0, 2, 0), depth: num(lay.depth, 0, MAX_DEPTH_STEPS, 0) };
  if (Array.isArray(lay.lift) && lay.lift.length === 2) layout.lift = [num(lay.lift[0], 0, 47, 17), num(lay.lift[1], -600, 45, 36)];
  const floors = num(s.floors, 1, 12, 1);
  const items: SavedItem[] = [];
  for (const it of Array.isArray(s.items) ? s.items.slice(0, 1500) : []) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length > 24) continue;
    items.push({
      id: r.id, f: num(r.f, 0, floors - 1, 0) || undefined, tx: num(r.tx, 0, GRID_W, 0), tz: num(r.tz, -600, 46, 0), rot: num(r.rot, 0, 3, 0),
      level: num(r.level, 1, 5, 1), color: num(r.color, 0, 0xffffff, 0xffffff), broken: false,
      stats: { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 },
      label: typeof r.label === 'string' ? r.label.slice(0, 14).toUpperCase() : undefined,
      setup: r.setup && typeof r.setup === 'object' ? sanitizeSetup(r.setup) : undefined,
      dirty: r.dirty === true || undefined,
      dl: typeof r.dl === 'boolean' ? r.dl : undefined,
    });
  }
  const roles = ['janitor', 'technician', 'security', 'doorman'];
  const staff: SavedStaff[] = [];
  for (const st of Array.isArray(s.staff) ? s.staff.slice(0, 60) : []) {
    const r = (st ?? {}) as Record<string, unknown>;
    if (!roles.includes(r.role as string)) continue;
    staff.push({ role: r.role as WorkerRole, name: str(r.name, 24, 'Staff'), look: sanitizeLook(r.look) });
  }
  const paint = (Array.isArray(s.paint) ? s.paint : []).slice(0, floors).map((p) => (typeof p === 'string' && /^[0-9:,]*$/.test(p) ? p.slice(0, 60000) : ''));
  const walls = (Array.isArray(s.walls) ? s.walls : []).slice(0, floors).map((p) => (typeof p === 'string' && /^[0-9:,]*$/.test(p) ? p.slice(0, 60000) : ''));
  return {
    name: look.name, look, layout, floors, paint, walls: walls.some((w) => w) ? walls : undefined, items, staff,
    rating: Math.max(0.5, Math.min(5, typeof s.rating === 'number' && Number.isFinite(s.rating) ? s.rating : 2)),
    jackpotPot: num(s.jackpotPot, 1000, 10_000_000, 5000),
  };
}
