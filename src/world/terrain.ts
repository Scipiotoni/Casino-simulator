import { MIN_COLS, cityX, cityZ, slotAt } from './city';
import { type CityPlan, LAKE_LEVEL, type Path, RIVER_HALF, RIVER_HALF_TOWN, RIVER_LEVEL_TOWN, lakeOf, onPlannedRoad, riverPath } from './plan';

/**
 * The land round the city, as one height field (global frame). The city and everything near it
 * is flat; further out the plain rolls gently, red-rock mesas and buttes stand to the east, a
 * mountain range rises in the north-west (the river comes down out of it through a canyon),
 * foothills climb behind the military base in the west, dunes roll to the south, and far ranges
 * close the horizon all round. You can walk and drive anywhere it isn't too steep; roads are cut
 * into the hills, the river runs in its channel and pours into Lake Mojave.
 */

// ------------------------------------------------------------------ noise

function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x: number, z: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, z * f) * amp;
    norm += amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s / norm;
}

export const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Height of the flat ground the city stands on (just under every pavement and lawn). */
export const CITY_GROUND = -0.04;
/** The flat apron round the city (the ring road runs on it). */
export const FLAT = 120;
/** Steeper than this (rise over run) and you can't walk or drive up it. */
export const MAX_SLOPE = 0.62;
/** Out to here from the edge of the land you can go; beyond, it's just scenery. */
export const EDGE = 320;

/** A place that has to be level: a rectangle or an ellipse at height `y`, blending out over `blend`. */
export interface Site {
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** Its height (the land's at its centre if not given). */
  y?: number;
  blend: number;
  round?: boolean;
}

/** A road cut into the land: the ground under it follows its smoothed profile. */
export interface RoadLine {
  path: Path;
  /** Half its width. */
  half: number;
  /** Steepest grade allowed (rise over run). */
  grade?: number;
  /** Elevation at each path point (filled in by the terrain). */
  profile?: Float32Array;
  /** Hold the profile at this height near its start / end (it meets a flat road or site there). */
  y0?: number;
  y1?: number;
  /** The height it wants at a point, if not the land's (a road along the bottom of a canyon). */
  base?: (x: number, z: number) => number;
}

/** Where the landscapes are, on the fixed grid of the original city (they don't move as it grows). */
let frameCache: { cx: number; cz: number; hx: number; hz: number } | null = null;
function frame(): { cx: number; cz: number; hx: number; hz: number } {
  if (frameCache) return frameCache;
  const [x0, x1] = cityX(MIN_COLS);
  const [z0, z1] = cityZ();
  frameCache = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
  return frameCache;
}

/** How much of each landscape is at a point (0..1): the mountains, the western hills, the mesas, the dunes. */
export function regions(x: number, z: number): { mtn: number; west: number; east: number; south: number } {
  const { cx, cz, hx, hz } = frame();
  // Warp the boundaries between landscapes so they wander instead of running straight.
  const ux = x + (fbm(x / 900 + 3.1, z / 900 - 1.7, 2) - 0.5) * 900 - cx;
  const uz = z + (fbm(x / 900 - 8.3, z / 900 + 4.4, 2) - 0.5) * 900 - cz;
  const mtn = smooth((-ux * 0.5 - uz * 0.87 - (hz * 0.8 + 950)) / 1300);
  const west = smooth((-ux - (hx + 1250)) / 1100) * (1 - mtn);
  const east = smooth((ux - (hx + 520)) / 520) * (1 - mtn);
  const south = smooth((uz - (hz + 650)) / 600) * (1 - east) * (1 - mtn);
  return { mtn, west, east, south };
}

/**
 * The landforms on their own (before the city, the sites, the roads and the river shape them),
 * as a function of the position and the distance `d` from the city's edge.
 */
export function landform(x: number, z: number, d: number): number {
  const { mtn, west, east, south } = regions(x, z);
  // The plain: long low swells and smaller hummocks, growing away from town.
  const roll = (fbm(x / 520, z / 520, 3) - 0.38) * 22 + (fbm(x / 160 + 9, z / 160 - 4, 3) - 0.5) * 5;
  let h = roll * smooth((d - FLAT) / 700);
  // North-west: a mountain range with sharp ridges.
  if (mtn > 0) {
    const ridge = 1 - Math.abs(fbm(x / 900 + 11, z / 900 - 5, 3) * 2 - 1);
    const detail = fbm(x / 160 + 2, z / 160 + 7, 3);
    h += Math.pow(mtn, 1.3) * (90 + 300 * ridge * ridge + 26 * detail);
  }
  // West, behind the base: foothills climbing to the same range.
  if (west > 0) h += west * (30 + 120 * fbm(x / 640 - 3, z / 640 + 8, 3));
  // East: red-rock mesas with flat tops and sheer sides, and lone buttes.
  if (east > 0) {
    const m = fbm(x / 360 + 50, z / 360 - 20, 3);
    const top = 38 + 34 * fbm(x / 900 + 5, z / 900 + 5, 2);
    const mesa = smooth((m - 0.52) / 0.05) * top;
    const b = fbm(x / 110 - 30, z / 110 + 12, 2);
    const butte = smooth((b - 0.72) / 0.03) * (26 + 18 * fbm(x / 50, z / 50, 2));
    h += east * Math.max(mesa, butte) + east * (fbm(x / 200, z / 200, 3) - 0.5) * 6;
  }
  // South: dunes in long rows.
  if (south > 0) {
    const dune = Math.sin((x * 0.6 + z * 0.8) / 46 + fbm(x / 300, z / 300, 2) * 7) * 0.5 + 0.5;
    h += south * (dune * dune * dune * 15 + fbm(x / 400 + 2, z / 400, 2) * 6);
  }
  // Far ranges all round the horizon.
  const far = smooth((d - 2300) / 1300);
  if (far > 0) {
    const ridge = 1 - Math.abs(fbm(x / 500 - 21, z / 500 + 13) * 2 - 1);
    h += far * (90 + 300 * ridge * ridge);
  }
  return h;
}

/** One road segment in the lookup grid. */
interface RoadSeg {
  road: RoadLine;
  i: number;
}

/**
 * The land as a height field sampled every `step` metres, plus what it takes to walk on it:
 * its slope, the roads cut into it and the water in it.
 */
export class Terrain {
  readonly step = 12;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  /** Distance to the city (lots and roads), metres. */
  readonly dist: Float32Array;
  /** Steepest slope round each sample. */
  readonly slope: Float32Array;
  /** Cells (by their lower corner) that are dead flat city ground. */
  private flat: Uint8Array;
  roads: RoadLine[] = [];
  readonly river: Path;
  /** Along the river: a stone-walled channel through town (1) or natural banks (0), per point. */
  readonly walled: Uint8Array;
  readonly lake: { x: number; z: number; rx: number; rz: number };
  /** Where the river enters and leaves town (distance along it). */
  sIn = 0;
  sOut = 0;
  /** Water level at each river point. */
  private levels: Float32Array;
  private stamp: Int32Array;
  private gen = 0;
  private cd: Float32Array;
  private cs: Float32Array;
  private segs = new Map<number, RoadSeg[]>();
  private bbox: [number, number, number, number];

  constructor(readonly plan: CityPlan, readonly sites: Site[] = [], margin = 2800) {
    const [x0, x1] = cityX(Math.max(MIN_COLS, plan.cols));
    const [z0, z1] = cityZ();
    this.bbox = [x0, x1, z0, z1];
    this.x0 = Math.floor((x0 - margin) / this.step) * this.step;
    this.z0 = Math.floor((z0 - margin) / this.step) * this.step;
    this.nx = Math.ceil((x1 + margin - this.x0) / this.step) + 1;
    this.nz = Math.ceil((z1 + margin - this.z0) / this.step) + 1;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.dist = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.flat = new Uint8Array(n);
    this.stamp = new Int32Array(n);
    this.cd = new Float32Array(n);
    this.cs = new Float32Array(n);
    this.river = riverPath(plan.cols);
    this.walled = new Uint8Array(this.river.pts.length);
    this.levels = new Float32Array(this.river.pts.length);
    this.lake = lakeOf(plan.cols);
    this.cityDistance();
    this.findTown();
    this.lay();
    this.riverLevels();
  }

  get width(): number {
    return (this.nx - 1) * this.step;
  }

  get depth(): number {
    return (this.nz - 1) * this.step;
  }

  idx(i: number, j: number): number {
    return j * this.nx + i;
  }

  /** Mark the city (its lots and roads) and spread the distance from it over the whole map. */
  private cityDistance(): void {
    const { nx, nz, step } = this;
    const d = this.dist;
    const plan = this.plan;
    const [x0, x1, z0, z1] = this.bbox;
    for (let j = 0; j < nz; j++) {
      const z = this.z0 + j * step;
      for (let i = 0; i < nx; i++) {
        const x = this.x0 + i * step;
        let city = false;
        if (x > x0 - 10 && x < x1 + 10 && z > z0 - 10 && z < z1 + 10) {
          if (onPlannedRoad(plan, x, z)) city = true;
          else {
            const s = slotAt(x, z, plan.cols);
            city = !!s && plan.has(s);
          }
        }
        d[this.idx(i, j)] = city ? 0 : 1e9;
      }
    }
    // Two-pass chamfer distance (8 neighbours).
    const a = step;
    const b = step * Math.SQRT2;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = this.idx(i, j);
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, d[k - nx] + a);
          if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
          if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
        }
        d[k] = v;
      }
    }
    for (let j = nz - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = this.idx(i, j);
        let v = d[k];
        if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
        if (j < nz - 1) {
          v = Math.min(v, d[k + nx] + a);
          if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
          if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
        }
        d[k] = v;
      }
    }
  }

  /** Which stretch of the river runs through town between stone walls (the rest has natural banks). */
  private findTown(): void {
    const r = this.river;
    const [x0, x1, z0, z1] = this.bbox;
    const w = this.walled;
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      w[i] = p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && this.cityDist(p.x, p.z) < 70 ? 1 : 0;
    }
    // No short runs either way: the walls go on (or stay off) for at least ~60 m.
    for (const v of [0, 1]) {
      let i = 0;
      while (i < w.length) {
        if (w[i] !== v) {
          i++;
          continue;
        }
        let j = i;
        while (j < w.length && w[j] === v) j++;
        if (i > 0 && j < w.length && r.at[j - 1] - r.at[i] < 60) for (let k = i; k < j; k++) w[k] = 1 - v;
        i = j;
      }
    }
    let first = -1;
    let last = -1;
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
        if (first < 0) first = i;
        last = i;
      }
    }
    this.sIn = first < 0 ? 0 : r.at[first];
    this.sOut = last < 0 ? r.length : r.at[last];
  }

  /**
   * The water level all along the river: it runs a little below the land, never faster than a
   * 2.8% fall (so in the mountains it sits deep in a canyon), always downhill, level through
   * town and on down to the lake.
   */
  private riverLevels(): void {
    const r = this.river;
    const n = r.pts.length;
    const lv = this.levels;
    const fixed = (s: number) => {
      const mid = RIVER_LEVEL_TOWN - 0.2;
      if (s <= this.sOut) return RIVER_LEVEL_TOWN - (clamp01((s - this.sIn) / Math.max(1, this.sOut - this.sIn))) * 0.2;
      const k = clamp01((s - this.sOut) / Math.max(1, r.length - this.sOut));
      return mid + (LAKE_LEVEL - mid) * k;
    };
    for (let i = 0; i < n; i++) {
      const s = r.at[i];
      if (s >= this.sIn) {
        lv[i] = fixed(s);
        continue;
      }
      const land = this.sample(r.pts[i].x, r.pts[i].z) - 1.6;
      lv[i] = Math.max(RIVER_LEVEL_TOWN, Math.min(land, RIVER_LEVEL_TOWN + (this.sIn - s) * 0.028));
    }
    // Smooth it, then make sure it only ever runs downhill.
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (r.at[i] >= this.sIn) {
        sm[i] = lv[i];
        continue;
      }
      let a = 0;
      let c = 0;
      for (let j = Math.max(0, i - 8); j <= Math.min(n - 1, i + 8); j++) {
        a += lv[j];
        c++;
      }
      sm[i] = a / c;
    }
    for (let i = 1; i < n; i++) sm[i] = Math.min(sm[i], sm[i - 1]);
    for (let i = 0; i < n; i++) lv[i] = r.at[i] < this.sIn ? Math.max(sm[i], fixed(this.sIn)) : sm[i];
  }

  /** River water level at distance `s` along it. */
  riverLevel(s: number): number {
    const at = this.river.at;
    let lo = 0;
    let hi = at.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = clamp01((s - at[lo]) / Math.max(1e-6, at[hi] - at[lo]));
    return this.levels[lo] + (this.levels[hi] - this.levels[lo]) * t;
  }

  /** Half the river's width at distance `s` along it. */
  riverHalf(s: number): number {
    const p = this.river.pointAt(s);
    const [x0, x1, z0, z1] = this.bbox;
    return p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 ? RIVER_HALF_TOWN : RIVER_HALF;
  }

  /** Is the river walled in (through town) at distance `s` along it? */
  isWalled(s: number): boolean {
    const at = this.river.at;
    let lo = 0;
    let hi = at.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= s) lo = mid;
      else hi = mid;
    }
    return this.walled[lo] === 1;
  }

  /** The base landforms, the city's flat ground and the level sites. */
  private lay(): void {
    const { nx, nz, step } = this;
    const h = this.h;
    // The landforms every other sample first; in between, interpolate where the land is gentle
    // and work it out exactly where it isn't (cliffs, ridges).
    const raw = new Float32Array(nx * nz);
    const at = (i: number, j: number) => {
      const k = this.idx(i, j);
      return this.dist[k] > FLAT - 30 ? landform(this.x0 + i * step, this.z0 + j * step, this.dist[k]) : 0;
    };
    for (let j = 0; j < nz; j += 2) for (let i = 0; i < nx; i += 2) raw[this.idx(i, j)] = at(i, j);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (i % 2 === 0 && j % 2 === 0) continue;
        const i0 = i - (i % 2);
        const j0 = j - (j % 2);
        const i1 = Math.min(nx - 1, i0 + 2) - ((Math.min(nx - 1, i0 + 2) - i0) % 2);
        const j1 = Math.min(nz - 1, j0 + 2) - ((Math.min(nz - 1, j0 + 2) - j0) % 2);
        const a = raw[this.idx(i0, j0)];
        const b = raw[this.idx(i1, j0)];
        const c = raw[this.idx(i0, j1)];
        const d = raw[this.idx(i1, j1)];
        const lo = Math.min(a, b, c, d);
        const hi = Math.max(a, b, c, d);
        if (hi - lo > 2.5 || i1 === i0 || j1 === j0) {
          raw[this.idx(i, j)] = at(i, j);
          continue;
        }
        const u = (i - i0) / (i1 - i0);
        const v = (j - j0) / (j1 - j0);
        raw[this.idx(i, j)] = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
      }
    }
    for (let k = 0; k < nx * nz; k++) {
      const d = this.dist[k];
      // The city and its apron are dead flat; the land eases in beyond.
      h[k] = d > FLAT ? CITY_GROUND + (raw[k] - CITY_GROUND) * smooth((d - FLAT) / 160) : CITY_GROUND;
    }
    for (const s of this.sites) this.level(s);
  }

  /** Level a site, blending into the land round it. */
  private level(s: Site): void {
    const reach = Math.max(s.rx, s.rz) + s.blend;
    const y = s.y ?? this.sample(s.x, s.z);
    this.box(s.x - reach, s.z - reach, s.x + reach, s.z + reach, (k, x, z) => {
      const u = Math.abs(x - s.x) / s.rx;
      const v = Math.abs(z - s.z) / s.rz;
      const out = s.round ? (Math.hypot(u, v) - 1) * Math.min(s.rx, s.rz) : Math.max((u - 1) * s.rx, (v - 1) * s.rz);
      if (out < s.blend) this.h[k] = y + (this.h[k] - y) * smooth(out / s.blend);
    });
  }

  /** Run `fn` for every sample in a box. */
  private box(xa: number, za: number, xb: number, zb: number, fn: (k: number, x: number, z: number) => void): void {
    const i0 = Math.max(0, Math.floor((xa - this.x0) / this.step));
    const i1 = Math.min(this.nx - 1, Math.ceil((xb - this.x0) / this.step));
    const j0 = Math.max(0, Math.floor((za - this.z0) / this.step));
    const j1 = Math.min(this.nz - 1, Math.ceil((zb - this.z0) / this.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(this.idx(i, j), this.x0 + i * this.step, this.z0 + j * this.step);
  }

  /**
   * Every sample within `reach` (which may vary along the path) of a path, with its distance
   * to it and the distance along it there. Fast: it only looks round each segment.
   */
  private corridor(path: Path, reach: (s: number) => number, fn: (k: number, d: number, s: number) => void): void {
    const gen = ++this.gen;
    const hit: number[] = [];
    const pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const R = reach(path.at[i]);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      const l = Math.sqrt(l2);
      this.box(Math.min(a.x, b.x) - R, Math.min(a.z, b.z) - R, Math.max(a.x, b.x) + R, Math.max(a.z, b.z) + R, (k, x, z) => {
        const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2);
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d > R) return;
        if (this.stamp[k] !== gen) {
          this.stamp[k] = gen;
          this.cd[k] = d;
          this.cs[k] = path.at[i] + l * t;
          hit.push(k);
        } else if (d < this.cd[k]) {
          this.cd[k] = d;
          this.cs[k] = path.at[i] + l * t;
        }
      });
    }
    for (const k of hit) fn(k, this.cd[k], this.cs[k]);
  }

  /**
   * Lay the roads into the land (each gets a smooth, gently graded profile, and the ground is
   * cut and filled to it), then carve the lake and the river, and work out the slopes.
   */
  finish(roads: RoadLine[]): void {
    this.roads = roads;
    for (const road of roads) this.profile(road);
    // The bed is level well past the road's edges: the land is drawn in 12 m cells, and any cell
    // touching the road must be flat or a steep bank would poke up through it.
    for (const road of roads) {
      this.corridor(road.path, () => road.half + 50, (k, d, s) => {
        const y = this.roadY(road, s);
        const t = smooth((d - (road.half + 18)) / 30);
        this.h[k] = y + (this.h[k] - y) * t;
      });
    }
    this.carveLake();
    this.carveRiver();
    this.computeSlopes();
    this.computeFlat();
    this.indexRoads();
  }

  /** A road's elevation: the land along it, smoothed, with the grade held in check. */
  private profile(road: RoadLine): void {
    const p = road.path;
    const n = p.pts.length;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = road.base ? road.base(p.pts[i].x, p.pts[i].z) : this.sample(p.pts[i].x, p.pts[i].z);
    // Average over ~100 m (prefix sums), pinned to the ends it meets.
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
    const prof = new Float32Array(n);
    const win = 9;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - win);
      const b = Math.min(n - 1, i + win);
      prof[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
    }
    const hold = (y: number | undefined, from: number, dir: 1 | -1) => {
      if (y === undefined) return;
      const s0 = p.at[from];
      for (let i = from; i >= 0 && i < n; i += dir) {
        const t = smooth((Math.abs(p.at[i] - s0) - 20) / 60);
        prof[i] = y + (prof[i] - y) * t;
        if (t >= 1) break;
      }
    };
    hold(road.y0, 0, 1);
    hold(road.y1, n - 1, -1);
    const g = road.grade ?? 0.07;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) {
        const ds = p.at[i] - p.at[i - 1];
        prof[i] = Math.max(prof[i - 1] - g * ds, Math.min(prof[i - 1] + g * ds, prof[i]));
      }
      for (let i = n - 2; i >= 0; i--) {
        const ds = p.at[i + 1] - p.at[i];
        prof[i] = Math.max(prof[i + 1] - g * ds, Math.min(prof[i + 1] + g * ds, prof[i]));
      }
    }
    road.profile = prof;
  }

  /** A road's elevation at distance `s` along it. */
  roadY(road: RoadLine, s: number): number {
    const prof = road.profile;
    const at = road.path.at;
    if (!prof) return 0;
    let lo = 0;
    let hi = at.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = clamp01((s - at[lo]) / Math.max(1e-6, at[hi] - at[lo]));
    return prof[lo] + (prof[hi] - prof[lo]) * t;
  }

  /** Lake Mojave: a basin with sloping sandy shores. */
  private carveLake(): void {
    const l = this.lake;
    this.box(l.x - l.rx * 1.7, l.z - l.rz * 1.7, l.x + l.rx * 1.7, l.z + l.rz * 1.7, (k, x, z) => {
      const e = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
      if (e > 1.6) return;
      const bed = LAKE_LEVEL - 1.2;
      let y: number;
      if (e < 1) y = bed - (1 - e) * 5;
      else if (e < 1.14) y = bed + ((e - 1) / 0.14) * (CITY_GROUND - bed);
      else y = CITY_GROUND + (this.h[k] - CITY_GROUND) * smooth((e - 1.14) / 0.46);
      this.h[k] = Math.min(this.h[k], y);
    });
  }

  /**
   * The river channel: a bed below the water and banks back up to the land (steep canyon walls
   * up in the mountains). Through town it's a walled channel with its own mesh: the land there
   * is left alone (its mesh has a hole where the channel runs).
   */
  private carveRiver(): void {
    const river = this.river;
    const reach = (s: number) => {
      const p = river.pointAt(s);
      const rise = Math.max(0, this.sample(p.x, p.z) - this.riverLevel(s));
      return Math.min(300, RIVER_HALF_TOWN + 30 + rise * 0.8);
    };
    this.corridor(river, reach, (k, d, s) => {
      const half = this.riverHalf(s);
      const level = this.riverLevel(s);
      const bed = level - 2;
      const land = this.h[k];
      if (this.isWalled(s)) return;
      if (d < half) {
        this.h[k] = Math.min(land, bed);
        return;
      }
      // Banks: a few metres in the plain, steep walls where the land is high (a canyon); a low
      // levee where the land dips below the water.
      const rise = Math.max(0, land - level);
      const bank = Math.max(10, rise * 0.7);
      const t = smooth((d - half) / bank);
      this.h[k] = level + 0.4 + (land - level - 0.4) * t;
    });
  }

  private computeSlopes(): void {
    const { nx, nz, step, h } = this;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = this.idx(i, j);
        const c = h[k];
        let m = 0;
        if (i > 0) m = Math.max(m, Math.abs(c - h[k - 1]));
        if (i < nx - 1) m = Math.max(m, Math.abs(c - h[k + 1]));
        if (j > 0) m = Math.max(m, Math.abs(c - h[k - nx]));
        if (j < nz - 1) m = Math.max(m, Math.abs(c - h[k + nx]));
        this.slope[k] = m / step;
      }
    }
  }

  /** Cells whose four corners are all flat city ground (the ground there is simply 0). */
  private computeFlat(): void {
    const { nx, nz, h } = this;
    const f = (v: number) => Math.abs(v - CITY_GROUND) < 0.005;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = this.idx(i, j);
        this.flat[k] = f(h[k]) && f(h[k + 1]) && f(h[k + nx]) && f(h[k + nx + 1]) ? 1 : 0;
      }
    }
  }

  /** Every road segment in a grid of 32 m cells. */
  private indexRoads(): void {
    this.segs.clear();
    const C = 32;
    for (const road of this.roads) {
      const pts = road.path.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const r = road.half + 1;
        for (let cx = Math.floor((Math.min(a.x, b.x) - r) / C); cx <= Math.floor((Math.max(a.x, b.x) + r) / C); cx++) {
          for (let cz = Math.floor((Math.min(a.z, b.z) - r) / C); cz <= Math.floor((Math.max(a.z, b.z) + r) / C); cz++) {
            const key = (cx + 4096) * 8192 + cz + 4096;
            const l = this.segs.get(key) ?? [];
            l.push({ road, i });
            this.segs.set(key, l);
          }
        }
      }
    }
  }

  /** Height of the land at a point (bilinear between samples). */
  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.step;
    const fz = (z - this.z0) / this.step;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = clamp01(fx - i);
    const tz = clamp01(fz - j);
    const k = this.idx(i, j);
    const h = this.h;
    const a = h[k] + (h[k + 1] - h[k]) * tx;
    const b = h[k + this.nx] + (h[k + this.nx + 1] - h[k + this.nx]) * tx;
    return a + (b - a) * tz;
  }

  /** Steepness at a point (the steepest round the nearest sample). */
  slopeAt(x: number, z: number): number {
    const i = Math.round((x - this.x0) / this.step);
    const j = Math.round((z - this.z0) / this.step);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 99;
    return this.slope[this.idx(i, j)];
  }

  /** Distance to the city at a point. */
  cityDist(x: number, z: number): number {
    const i = Math.round((x - this.x0) / this.step);
    const j = Math.round((z - this.z0) / this.step);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 1e9;
    return this.dist[this.idx(i, j)];
  }

  /** Inside the land you can reach (not out at the very edge of the map)? */
  inBounds(x: number, z: number): boolean {
    return x > this.x0 + EDGE && z > this.z0 + EDGE && x < this.x0 + this.width - EDGE && z < this.z0 + this.depth - EDGE;
  }

  /** On one of the roads out in the country (within `pad` of its edge): its deck height there (bridges included), or null. */
  roadDeck(x: number, z: number, pad = 0.5): number | null {
    const C = 32;
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    const r = pad > 0.5 ? 1 : 0;
    let best: number | null = null;
    let bestD = Infinity;
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const list = this.segs.get((ix + 4096) * 8192 + iz + 4096);
        if (!list) continue;
        for (const { road, i } of list) {
          const a = road.path.pts[i];
          const b = road.path.pts[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const l2 = dx * dx + dz * dz || 1;
          const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2);
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          if (d <= road.half + pad && d < bestD) {
            bestD = d;
            best = this.roadY(road, road.path.at[i] + Math.sqrt(l2) * t);
          }
        }
      }
    }
    return best;
  }

  /** In the river (not on a bridge over it)? */
  inRiverWater(x: number, z: number): boolean {
    const n = this.river.nearest(x, z, RIVER_HALF_TOWN + 0.5);
    return !!n && n.d < this.riverHalf(n.s) + 0.5;
  }

  /** On the riverside walk along the walled channel through town? */
  onRiverWalk(x: number, z: number): boolean {
    const n = this.river.nearest(x, z, RIVER_HALF_TOWN + 18);
    return !!n && n.d >= this.riverHalf(n.s) && this.isWalled(n.s);
  }

  /**
   * The ground under a point (global): the city's streets, lots, bridges and riverside walk
   * are at 0, roads out in the country at their deck height, everything else on the land.
   */
  groundAt(x: number, z: number): number {
    const fx = Math.floor((x - this.x0) / this.step);
    const fz = Math.floor((z - this.z0) / this.step);
    if (fx >= 0 && fz >= 0 && fx < this.nx - 1 && fz < this.nz - 1 && this.flat[this.idx(fx, fz)]) return 0;
    const [x0, x1, z0, z1] = this.bbox;
    if (x > x0 && x < x1 && z > z0 && z < z1 && onPlannedRoad(this.plan, x, z)) return 0;
    const deck = this.roadDeck(x, z);
    if (deck !== null) return Math.abs(deck - CITY_GROUND) < 0.06 ? 0 : deck;
    if (this.onRiverWalk(x, z)) return 0;
    const y = this.sample(x, z);
    return Math.abs(y - CITY_GROUND) < 0.06 ? 0 : y;
  }

  /** Can you walk (or drive) here, as far as the land goes: on a road, or not too steep and not in the water? */
  walkable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    if (this.roadDeck(x, z) !== null) return true;
    if (this.inRiverWater(x, z)) return false;
    return this.slopeAt(x, z) < MAX_SLOPE;
  }
}

let active: Terrain | null = null;
let ground: ((gx: number, gz: number) => number) | null = null;
/** The land everyone stands on, and the ground over it (piers and the like), set by the outskirts. */
export function setTerrain(t: Terrain | null, fn: ((gx: number, gz: number) => number) | null = null): void {
  active = t;
  ground = fn;
}

export function currentTerrain(): Terrain | null {
  return active;
}

/** Ground height at a global point (0 before the land exists, and all over town). */
export function groundAt(gx: number, gz: number): number {
  if (ground) return ground(gx, gz);
  return active ? active.groundAt(gx, gz) : 0;
}
