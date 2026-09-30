/**
 * Tile grid for one floor of the casino lot. The building has a fixed maximum width and
 * grows backwards (towards -z) from a fixed south facade (row FACADE_Z) that holds the
 * entrance; south of it is the sidewalk. Depth is unlimited: the grid reallocates as it
 * grows, so world z may go negative. Every floor has its own Grid; floors are linked by a
 * stairwell at a fixed spot near the entrance.
 */

export const GRID_W = 48;
export const CENTER_X = 24;
export const FACADE_Z = 40;
export const SIDEWALK_Z0 = 41;
export const SIDEWALK_Z1 = 44;
export const DOOR_TILES: [number, number][] = [
  [23, FACADE_Z],
  [24, FACADE_Z],
];

/** Mirror line of the road (world z): the south side of the street is the north side turned around it. */
export const ROAD_MID = 49.5;

/** The street is a row of lots this far apart (building width limit + a gap). */
export const LOT_STRIDE = 30;

/** Width steps. The last one is the width limit of every lot on the street. */
export const WIDTHS: { w: number; cost: number; level: number }[] = [
  { w: 14, cost: 0, level: 1 },
  { w: 18, cost: 6000, level: 3 },
  { w: 22, cost: 18000, level: 5 },
];
export const MAX_WIDTH = WIDTHS[WIDTHS.length - 1].w;
export const START_DEPTH = 12;
export const DEPTH_STEP = 4;

/** Cost to add depth step number `n` (0-based), growing but never capped. */
export function depthCost(n: number): number {
  return Math.round((2500 * Math.pow(1.32, n)) / 100) * 100;
}

export function depthLevel(n: number): number {
  return Math.min(2 + Math.floor(n / 2), 14);
}

/** Cost to build floor number `k` (1 = the first upper floor). */
export function floorCost(k: number): number {
  return Math.round((20000 * Math.pow(2.1, k - 1)) / 1000) * 1000;
}

export function floorLevel(k: number): number {
  return 4 + (k - 1) * 2;
}

/** Rows of sidewalk in front of your casino that you may decorate. */
export const YARD_Z0 = SIDEWALK_Z0;
export const YARD_Z1 = SIDEWALK_Z0 + 1;
/** Columns kept clear for the red carpet, rope posts and door guards. */
export const YARD_GAP: [number, number] = [CENTER_X - 2, CENTER_X + 1];

/** Stairwell footprint (2×3 tiles) and the tile where walkers change floors. */
export const STAIR_TILE: [number, number] = [CENTER_X - 7, FACADE_Z - 4];
export const PORTAL: [number, number] = [CENTER_X - 5, FACADE_Z - 3];

export interface Layout {
  width: number; // index into WIDTHS
  depth: number; // number of depth steps bought
  /** Top-left tile of the elevator (defaults to STAIR_TILE). */
  lift?: [number, number];
}

/** The tile walkers step onto to ride an elevator standing at `lift`. */
export function portalOf(lift: [number, number]): [number, number] {
  return [lift[0] + PORTAL[0] - STAIR_TILE[0], lift[1] + PORTAL[1] - STAIR_TILE[1]];
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number; // inclusive
  z1: number; // inclusive
}

export function layoutRect(l: Layout): Rect {
  const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, l.width))].w;
  const d = START_DEPTH + Math.max(0, l.depth) * DEPTH_STEP;
  return { x0: CENTER_X - w / 2, x1: CENTER_X + w / 2 - 1, z0: FACADE_Z - d, z1: FACADE_Z - 1 };
}

const F_OWNED = 1;
const F_SIDEWALK = 2;
const F_DOOR = 4;
const F_YARD = 8;

export class Grid {
  readonly w = GRID_W;
  /** Lowest allocated world row. */
  zMin = 0;
  /** Allocated rows. */
  d = 0;
  flags = new Uint8Array(0);
  /** uid of the object-layer item occupying the tile (0 = free). */
  occ = new Int32Array(0);
  /** uid of the floor-layer item (rugs) on the tile. */
  floorOcc = new Int32Array(0);
  /** Carpet style index per tile. */
  floor = new Uint8Array(0);
  /** Bumped whenever walkability changes so cached paths can be invalidated. */
  version = 0;
  rect: Rect = layoutRect({ width: 0, depth: 0 });
  /** Where walkers enter this floor: the front door on the ground floor, the stairs above. */
  entries: [number, number][] = DOOR_TILES;
  /** Elevator footprint origin and its door tile on this floor. */
  lift: [number, number] = STAIR_TILE;
  portal: [number, number] = PORTAL;

  constructor(readonly level: number, layout: Layout = { width: 0, depth: 0 }) {
    this.setLayout(layout);
  }

  get size(): number {
    return this.w * this.d;
  }

  idx(x: number, z: number): number {
    return (z - this.zMin) * GRID_W + x;
  }

  tileX(i: number): number {
    return i % GRID_W;
  }

  tileZ(i: number): number {
    return ((i / GRID_W) | 0) + this.zMin;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && x < GRID_W && z >= this.zMin && z < this.zMin + this.d;
  }

  /** Grow the arrays (keeping contents) so the rect fits. */
  private ensure(rect: Rect): void {
    const zMin = Math.min(0, rect.z0 - 2);
    const zMax = SIDEWALK_Z1 + 2;
    const d = zMax - zMin;
    if (zMin === this.zMin && d === this.d) return;
    const old = { zMin: this.zMin, d: this.d, occ: this.occ, floorOcc: this.floorOcc, floor: this.floor };
    this.zMin = zMin;
    this.d = d;
    this.flags = new Uint8Array(GRID_W * d);
    this.occ = new Int32Array(GRID_W * d);
    this.floorOcc = new Int32Array(GRID_W * d);
    this.floor = new Uint8Array(GRID_W * d);
    for (let r = 0; r < old.d; r++) {
      const z = old.zMin + r;
      if (z < zMin || z >= zMin + d) continue;
      const src = r * GRID_W;
      const dst = (z - zMin) * GRID_W;
      this.occ.set(old.occ.subarray(src, src + GRID_W), dst);
      this.floorOcc.set(old.floorOcc.subarray(src, src + GRID_W), dst);
      this.floor.set(old.floor.subarray(src, src + GRID_W), dst);
    }
  }

  /** Put the elevator (and its door) somewhere else on this floor. */
  setLift(lift: [number, number]): void {
    this.lift = [lift[0], lift[1]];
    this.portal = portalOf(this.lift);
    this.entries = this.level === 0 ? DOOR_TILES : [this.portal];
    this.version++;
  }

  setLayout(layout: Layout): void {
    this.setLift(layout.lift ?? STAIR_TILE);
    this.rect = layoutRect(layout);
    this.ensure(this.rect);
    this.flags.fill(0);
    const r = this.rect;
    for (let z = this.zMin; z < this.zMin + this.d; z++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = this.idx(x, z);
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) this.flags[i] |= F_OWNED;
        if (this.level === 0 && z >= SIDEWALK_Z0 && z <= SIDEWALK_Z1) this.flags[i] |= F_SIDEWALK;
        if (this.level === 0 && z >= YARD_Z0 && z <= YARD_Z1 && x >= r.x0 && x <= r.x1 && (x < YARD_GAP[0] || x > YARD_GAP[1])) this.flags[i] |= F_YARD;
      }
    }
    if (this.level === 0) for (const [x, z] of DOOR_TILES) this.flags[this.idx(x, z)] |= F_DOOR;
    this.version++;
  }

  isOwned(x: number, z: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)] & F_OWNED) !== 0;
  }

  isInside(x: number, z: number): boolean {
    return this.isOwned(x, z);
  }

  /** Outdoor tile in front of the casino where decorations may be placed. */
  isYard(x: number, z: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)] & F_YARD) !== 0;
  }

  isSidewalk(x: number, z: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)] & F_SIDEWALK) !== 0;
  }

  isDoor(x: number, z: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)] & F_DOOR) !== 0;
  }

  isWalkable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.idx(x, z);
    const f = this.flags[i];
    if (f & (F_SIDEWALK | F_DOOR)) return this.occ[i] === 0;
    if (!(f & F_OWNED)) return false;
    return this.occ[i] === 0;
  }

  /** Walkability test on continuous world coordinates. */
  walkableAt(wx: number, wz: number): boolean {
    return this.isWalkable(Math.floor(wx), Math.floor(wz));
  }

  occupant(x: number, z: number): number {
    return this.inBounds(x, z) ? this.occ[this.idx(x, z)] : 0;
  }

  setOcc(x: number, z: number, uid: number, layer: 'object' | 'floor' = 'object'): void {
    if (!this.inBounds(x, z)) return;
    if (layer === 'floor') this.floorOcc[this.idx(x, z)] = uid;
    else this.occ[this.idx(x, z)] = uid;
    this.version++;
  }

  getFloor(x: number, z: number): number {
    return this.inBounds(x, z) ? this.floor[this.idx(x, z)] : 0;
  }

  setFloor(x: number, z: number, style: number): void {
    if (this.inBounds(x, z)) this.floor[this.idx(x, z)] = style;
  }

  /** Breadth-first flood from this floor's entries; returns a mask of reachable walkable tiles. */
  reachableFromDoor(extraBlocked?: (x: number, z: number) => boolean): Uint8Array {
    return this.flood((x, z) => this.isWalkable(x, z) && !(extraBlocked && extraBlocked(x, z)));
  }

  /** Flood fill from the entries through tiles where `walk` is true. */
  flood(walk: (x: number, z: number) => boolean): Uint8Array {
    const seen = new Uint8Array(this.size);
    const queue: number[] = [];
    for (const [x, z] of this.entries) {
      if (!this.inBounds(x, z)) continue;
      const i = this.idx(x, z);
      seen[i] = 1;
      queue.push(i);
    }
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const x = this.tileX(i);
      const z = this.tileZ(i);
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        const ni = this.idx(nx, nz);
        if (seen[ni]) continue;
        if (!walk(nx, nz)) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return seen;
  }

  /** Nearest walkable tile to (x,z) searching outward in rings. */
  nearestWalkable(x: number, z: number, insideOnly = false): [number, number] | null {
    const ok = (tx: number, tz: number) => this.isWalkable(tx, tz) && (!insideOnly || this.isOwned(tx, tz));
    if (ok(x, z)) return [x, z];
    for (let r = 1; r < 24; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const tx = x + dx;
          const tz = z + dz;
          if (!ok(tx, tz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = [tx, tz];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  randomInsideWalkable(): [number, number] | null {
    const r = this.rect;
    for (let tries = 0; tries < 60; tries++) {
      const x = r.x0 + Math.floor(Math.random() * (r.x1 - r.x0 + 1));
      const z = r.z0 + Math.floor(Math.random() * (r.z1 - r.z0 + 1));
      if (this.isWalkable(x, z)) return [x, z];
    }
    return null;
  }

  /** Floor paint as run-length text ("style:count,…") over the owned rect, row by row. */
  encodeFloor(): string {
    const r = this.rect;
    const out: string[] = [];
    let cur = -1;
    let n = 0;
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const v = this.getFloor(x, z);
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

  decodeFloor(s: string): void {
    this.floor.fill(0);
    if (!s) return;
    const r = this.rect;
    const w = r.x1 - r.x0 + 1;
    let i = 0;
    const total = w * (r.z1 - r.z0 + 1);
    for (const part of s.split(',')) {
      const [v, n] = part.split(':').map(Number);
      for (let k = 0; k < n && i < total; k++, i++) this.setFloor(r.x0 + (i % w), r.z0 + Math.floor(i / w), v || 0);
    }
  }
}

export const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const DIRS8: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
