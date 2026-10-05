import { CENTER_X, FACADE_Z, LOT_STRIDE } from './grid';
import {
  AVE_W, BLOCK_COLS, MAX_DEPTH, PARK_BLOCKS, PARK_STREET, ROW_GAP, STREET_ROWS, type SlotRef, avenueMid, avenueX, blocksFor, cityX, cityZ,
  MIN_COLS, hash01, inParkSlot, slotToGlobal, streetZ,
} from './city';

/**
 * The shape of the city: which lots exist (an organic outline round a gridded core, and none
 * where the river runs), where every street and avenue starts and ends, the river itself and
 * the lake it runs into. Everything here is in the global frame and deterministic, so every
 * player sees the same city.
 */

export interface Pt {
  x: number;
  z: number;
}

/** A dense polyline with the distance along it at every point, and a grid to find it fast. */
export class Path {
  readonly pts: Pt[];
  /** Distance along the path at each point. */
  readonly at: number[];
  readonly length: number;
  private cells = new Map<number, number[]>();
  private static readonly CELL = 48;

  constructor(pts: Pt[]) {
    this.pts = pts;
    this.at = [0];
    for (let i = 1; i < pts.length; i++) this.at.push(this.at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.length = this.at[this.at.length - 1] ?? 0;
    const C = Path.CELL;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let cx = Math.floor(Math.min(a.x, b.x) / C); cx <= Math.floor(Math.max(a.x, b.x) / C); cx++) {
        for (let cz = Math.floor(Math.min(a.z, b.z) / C); cz <= Math.floor(Math.max(a.z, b.z) / C); cz++) {
          const k = (cx + 4096) * 8192 + cz + 4096;
          const l = this.cells.get(k) ?? [];
          l.push(i);
          this.cells.set(k, l);
        }
      }
    }
  }

  /**
   * Nearest point of the path to (x, z) if it's within `within` metres: the distance, the
   * distance along the path there, and which side (+1 left of travel, -1 right).
   */
  nearest(x: number, z: number, within: number): { d: number; s: number; side: number } | null {
    const C = Path.CELL;
    const r = Math.ceil(within / C);
    const cx0 = Math.floor(x / C);
    const cz0 = Math.floor(z / C);
    let best: { d: number; s: number; side: number } | null = null;
    const seen = new Set<number>();
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        const list = this.cells.get((cx + 4096) * 8192 + cz + 4096);
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          const a = this.pts[i];
          const b = this.pts[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
          const px = a.x + dx * t;
          const pz = a.z + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d <= within && (!best || d < best.d)) best = { d, s: this.at[i] + Math.sqrt(l2) * t, side: dx * (z - a.z) - dz * (x - a.x) > 0 ? 1 : -1 };
        }
      }
    }
    return best;
  }

  /** The point and heading at distance `s` along the path. */
  pointAt(s: number): Pt & { dx: number; dz: number } {
    const at = this.at;
    let lo = 0;
    let hi = at.length - 1;
    const v = Math.max(0, Math.min(this.length, s));
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= v) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[Math.min(lo + 1, this.pts.length - 1)];
    const seg = at[Math.min(lo + 1, at.length - 1)] - at[lo] || 1;
    const t = (v - at[lo]) / seg;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
  }
}

/** A smooth curve through the control points (Catmull-Rom), sampled every `step` metres. */
export function smoothPath(ctrl: Pt[], step = 6, closed = false): Path {
  const out: Pt[] = [];
  const n = ctrl.length;
  const get = (i: number) => (closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(closed ? { ...out[0] } : { ...ctrl[n - 1] });
  return new Path(out);
}

/** Ring road distance from the city's edge. */
export const BELT = 85;
/** Half the river's water, in town (where stone embankments hold it) and out in the country. */
export const RIVER_HALF_TOWN = 13;
export const RIVER_HALF = 11;
/** Lots this close to the river's water aren't built (a riverside walk instead). */
const RIVER_CLEAR = 12;
/** River water level in town (the embankments drop to it); it falls on to the lake. */
export const RIVER_LEVEL_TOWN = -2.2;
export const LAKE_LEVEL = -2.6;

/** Lake Mojave, south of town (the river runs into it). */
export function lakeOf(cols: number): { x: number; z: number; rx: number; rz: number } {
  void cols;
  const [x0, x1] = cityX(MIN_COLS);
  const [, z1] = cityZ();
  return { x: (x0 + x1) / 2 + 120, z: z1 + 245, rx: 150, rz: 78 };
}

const riverCache = new Map<number, Path>();
/**
 * The river: down from a canyon in the north-western mountains, across the plain, diagonally
 * through the middle of town (south of the gridded core, clear of Central Park) and on into
 * Lake Mojave.
 */
export function riverPath(cols: number): Path {
  // The land doesn't move when the city grows: natural features are laid out on the
  // original grid.
  cols = MIN_COLS;
  const hit = riverCache.get(cols);
  if (hit) return hit;
  const [x0, x1] = cityX(cols);
  const [z0, z1] = cityZ();
  const W = x1 - x0;
  const D = z1 - z0;
  const lake = lakeOf(cols);
  const p = smoothPath([
    { x: x0 - 2600, z: z0 - 1700 },
    { x: x0 - 1900, z: z0 - 1050 },
    { x: x0 - 1150, z: z0 - 420 },
    { x: x0 - 520, z: z0 + 0.24 * D },
    { x: x0 + 0.04 * W, z: z0 + 0.34 * D },
    { x: x0 + 0.22 * W, z: z0 + 0.43 * D },
    { x: x0 + 0.36 * W, z: z0 + 0.61 * D },
    { x: x0 + 0.52 * W, z: z0 + 0.66 * D },
    { x: x0 + 0.63 * W, z: z0 + 0.82 * D },
    { x: x0 + 0.66 * W, z: z1 + 40 },
    { x: lake.x + 110, z: lake.z - 58 },
  ], 6);
  riverCache.set(cols, p);
  return p;
}

/** How wide the river's water is (half) at a point: wider in town between its walls. */
export function riverHalfAt(gx: number, gz: number, cols: number): number {
  const [x0, x1] = cityX(Math.max(cols, MIN_COLS));
  const [z0, z1] = cityZ();
  return gx > x0 && gx < x1 && gz > z0 && gz < z1 ? RIVER_HALF_TOWN : RIVER_HALF;
}

/** Is this point in the river's water? */
export function inRiver(gx: number, gz: number, cols: number): boolean {
  const n = riverPath(cols).nearest(gx, gz, RIVER_HALF_TOWN + 1);
  return !!n && n.d < riverHalfAt(gx, gz, cols);
}

/** The lots everyone always has: the Casino Strip, Palm Avenue and Downtown on the north-west. */
function protectedSlot(s: SlotRef): boolean {
  return (s.row <= 2 && s.col < 36) || inParkSlot(s);
}

/** Centre of a lot's ground (its building sits about here). */
function lotCentre(s: SlotRef): Pt {
  return slotToGlobal(s, CENTER_X, FACADE_Z - MAX_DEPTH / 2);
}

/** Does the river (with a riverside walk) cut through this lot? */
export function riverCuts(s: SlotRef, cols: number): boolean {
  const river = riverPath(cols);
  for (const lx of [CENTER_X - LOT_STRIDE / 2 + 2, CENTER_X, CENTER_X + LOT_STRIDE / 2 - 2]) {
    for (let lz = FACADE_Z + 1; lz >= FACADE_Z - MAX_DEPTH - 4; lz -= 18) {
      const g = slotToGlobal(s, lx, lz);
      if (river.nearest(g.x, g.z, RIVER_HALF_TOWN + RIVER_CLEAR)) return true;
    }
  }
  return false;
}

/**
 * The districts the city grew from: the core round the Strip and downtown, a lobe east along
 * the middle streets, one south down the central avenues, the old town in the south-west and
 * a newer district in the south-east. Centres and radii are fractions of the grid.
 */
const DISTRICTS: { u: number; v: number; ru: number; rv: number }[] = [
  { u: 0.27, v: 0.2, ru: 0.29, rv: 0.25 },
  { u: 0.52, v: 0.42, ru: 0.19, rv: 0.17 },
  { u: 0.77, v: 0.33, ru: 0.19, rv: 0.15 },
  { u: 0.45, v: 0.68, ru: 0.14, rv: 0.27 },
  { u: 0.15, v: 0.72, ru: 0.12, rv: 0.15 },
  { u: 0.83, v: 0.75, ru: 0.12, rv: 0.14 },
];

/**
 * Is this lot inside the city's organic outline? The city is the union of its districts,
 * their edges pulled in and pushed out by slow waves, with a ragged fringe where lots drop out
 * here and there: bays of open desert between lobes, not a big square.
 */
export function inOutline(s: SlotRef, cols: number): boolean {
  void cols;
  const [x0, x1] = cityX(MIN_COLS);
  const [z0, z1] = cityZ();
  const c = lotCentre(s);
  const u = (c.x - x0) / (x1 - x0);
  const v = (c.z - z0) / (z1 - z0);
  let best = 0;
  for (const d of DISTRICTS) {
    const du = (u - d.u) / d.ru;
    const dv = (v - d.v) / d.rv;
    const a = Math.atan2(dv, du);
    const wave = 1 + 0.1 * Math.sin(3 * a + d.u * 9) + 0.07 * Math.sin(5 * a - d.v * 7);
    best = Math.max(best, wave - Math.hypot(du, dv));
  }
  // A ragged but coherent edge: smooth noise over the map, so the edge has small bays and
  // spurs rather than single missing lots.
  const fringe = (smoothNoise(u * 9, v * 7) - 0.5) * 0.22;
  return best + fringe > 0;
}

/** Smooth 2D value noise in 0..1 (deterministic). */
export function smoothNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => hash01(a * 7919 + b * 104729 + 17);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Is there a lot (built or waiting for a building) in this slot, before any player uses it? */
export function slotOpen(s: SlotRef, cols: number): boolean {
  if (s.row < 0 || s.row >= STREET_ROWS || s.col < 0 || s.col >= cols) return false;
  if (protectedSlot(s)) return true;
  return inOutline(s, cols) && !riverCuts(s, cols);
}

/** One street (a row) from the first to the last block that has a lot, or null. */
export interface StreetSpan {
  xa: number;
  xb: number;
}

/** One avenue from the first to the last street it serves, or null. */
export interface AveSpan {
  za: number;
  zb: number;
}

/** The streets and avenues of a city where `has` says which lots exist. */
export interface CityPlan {
  cols: number;
  streets: (StreetSpan | null)[];
  avenues: (AveSpan | null)[];
  has: (s: SlotRef) => boolean;
}

/** The roads of a city: every street runs as far as its outermost blocks, every avenue between the outermost streets it crosses. */
export function makePlan(cols: number, has: (s: SlotRef) => boolean): CityPlan {
  const nb = blocksFor(cols);
  // blocks[r][side][k]: any lot in that block?
  const block = (r: number, side: 0 | 1, k: number) => {
    if (k < 0 || k >= nb) return false;
    for (let c = k * BLOCK_COLS; c < Math.min(cols, (k + 1) * BLOCK_COLS); c++) if (has({ row: r, col: c, side })) return true;
    return false;
  };
  const streets: (StreetSpan | null)[] = [];
  for (let r = 0; r < STREET_ROWS; r++) {
    let kmin = Infinity;
    let kmax = -Infinity;
    for (let k = 0; k < nb; k++) {
      if (block(r, 0, k) || block(r, 1, k)) {
        kmin = Math.min(kmin, k);
        kmax = Math.max(kmax, k);
      }
    }
    streets.push(kmin <= kmax ? { xa: avenueX(kmin)[0], xb: avenueX(kmax + 1)[1] } : null);
  }
  const avenues: (AveSpan | null)[] = [];
  const half = ROW_GAP / 2;
  for (let k = 0; k <= nb; k++) {
    let rmin = Infinity;
    let rmax = -Infinity;
    for (let r = 0; r < STREET_ROWS; r++) {
      const st = streets[r];
      if (!st || avenueMid(k) < st.xa || avenueMid(k) > st.xb) continue;
      if (block(r, 0, k - 1) || block(r, 0, k) || block(r, 1, k - 1) || block(r, 1, k)) {
        rmin = Math.min(rmin, r);
        rmax = Math.max(rmax, r);
      }
    }
    if (rmin > rmax) {
      avenues.push(null);
      continue;
    }
    const northLots = block(rmin, 0, k - 1) || block(rmin, 0, k);
    const southLots = block(rmax, 1, k - 1) || block(rmax, 1, k);
    avenues.push({
      za: northLots ? streetZ(rmin) - half : streetZ(rmin) - 10,
      zb: southLots ? streetZ(rmax) + half : streetZ(rmax) + 10,
    });
  }
  return { cols, streets, avenues, has };
}

/** A plan with every lot of the grid (tests, and before the street knows its lots). */
export function fullPlan(cols: number): CityPlan {
  return makePlan(cols, () => true);
}

/** Does avenue `k` cross street `r` (an intersection)? */
export function crosses(plan: CityPlan, r: number, k: number): boolean {
  const st = plan.streets[r];
  const av = plan.avenues[k];
  if (!st || !av) return false;
  const x = avenueMid(k);
  const z = streetZ(r);
  return x >= st.xa && x <= st.xb && z >= av.za && z <= av.zb;
}

/** Walkable road surface (both sidewalks and the road) of the planned streets and avenues. */
export function onPlannedRoad(plan: CityPlan, gx: number, gz: number): boolean {
  const SIDE = 8.5;
  for (let r = 0; r < plan.streets.length; r++) {
    const st = plan.streets[r];
    if (!st) continue;
    if (Math.abs(gz - streetZ(r)) < SIDE && gx > st.xa && gx < st.xb) return true;
  }
  for (let k = 0; k < plan.avenues.length; k++) {
    const av = plan.avenues[k];
    if (!av) continue;
    const [a, b] = avenueX(k);
    if (gx > a && gx < b && gz > av.za && gz < av.zb) return true;
  }
  return false;
}

/** The edge of the city (everything built and paved), as a closed loop round it (for the beltway). */
export function outline(plan: CityPlan, out = BELT): Pt[] {
  // Per street: the ends; per avenue: the ends. Then the convex-ish hull of those, eased out.
  const pts: Pt[] = [];
  plan.streets.forEach((st, r) => {
    if (!st) return;
    pts.push({ x: st.xa, z: streetZ(r) }, { x: st.xb, z: streetZ(r) });
  });
  plan.avenues.forEach((av, k) => {
    if (!av) return;
    pts.push({ x: avenueMid(k), z: av.za }, { x: avenueMid(k), z: av.zb });
  });
  // Angular sweep round the centre: the furthest point in each sector.
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const N = 28;
  const far: (Pt | null)[] = new Array(N).fill(null);
  for (const p of pts) {
    const a = Math.atan2(p.z - cz, p.x - cx);
    const i = Math.floor(((a + Math.PI) / (Math.PI * 2)) * N) % N;
    const d = Math.hypot(p.x - cx, p.z - cz);
    const f = far[i];
    if (!f || d > Math.hypot(f.x - cx, f.z - cz)) far[i] = p;
  }
  const ring: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2 - Math.PI;
    // Missing sector: borrow the larger neighbour's reach.
    const reach = (j: number) => {
      const f = far[((j % N) + N) % N];
      return f ? Math.hypot(f.x - cx, f.z - cz) : 0;
    };
    const d = Math.max(reach(i), 0.9 * Math.max(reach(i - 1), reach(i + 1)));
    ring.push({ x: cx + Math.cos(a) * (d + out), z: cz + Math.sin(a) * (d + out) });
  }
  // Ease out the dents so the road flows.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const a = ring[(i + N - 1) % N];
      const b = ring[i];
      const c = ring[(i + 1) % N];
      const db = Math.hypot(b.x - cx, b.z - cz);
      const avg = (Math.hypot(a.x - cx, a.z - cz) + Math.hypot(c.x - cx, c.z - cz)) / 2;
      if (avg > db) {
        const k = (db + (avg - db) * 0.6) / db;
        ring[i] = { x: cx + (b.x - cx) * k, z: cz + (b.z - cz) * k };
      }
    }
  }
  return ring;
}

/** Some slot keys of a plan (for tests: how many lots there are). */
export function countLots(plan: CityPlan): number {
  let n = 0;
  for (let r = 0; r < STREET_ROWS; r++) for (let c = 0; c < plan.cols; c++) for (const side of [0, 1] as const) if (plan.has({ row: r, col: c, side })) n++;
  return n;
}

void AVE_W;
void PARK_BLOCKS;
void PARK_STREET;
