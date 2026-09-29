/**
 * Tile grid for the whole lot. The building grows north and sideways from a fixed
 * south facade (row FACADE_Z) that holds the entrance; south of it is the sidewalk.
 */

export const GRID_W = 48;
export const GRID_D = 46;
export const CENTER_X = 24;
export const FACADE_Z = 40;
export const SIDEWALK_Z0 = 41;
export const SIDEWALK_Z1 = 44;
export const DOOR_TILES: [number, number][] = [
  [23, FACADE_Z],
  [24, FACADE_Z],
];

export interface Expansion {
  w: number;
  d: number;
  cost: number;
  level: number;
}

export const EXPANSIONS: Expansion[] = [
  { w: 14, d: 12, cost: 0, level: 1 },
  { w: 18, d: 15, cost: 6000, level: 3 },
  { w: 24, d: 19, cost: 18000, level: 5 },
  { w: 30, d: 24, cost: 45000, level: 7 },
  { w: 38, d: 30, cost: 110000, level: 9 },
  { w: 46, d: 36, cost: 260000, level: 11 },
];

export interface Rect {
  x0: number;
  z0: number;
  x1: number; // inclusive
  z1: number; // inclusive
}

export function expansionRect(level: number): Rect {
  const e = EXPANSIONS[Math.max(0, Math.min(EXPANSIONS.length - 1, level))];
  return {
    x0: CENTER_X - e.w / 2,
    x1: CENTER_X + e.w / 2 - 1,
    z0: FACADE_Z - e.d,
    z1: FACADE_Z - 1,
  };
}

const F_OWNED = 1;
const F_SIDEWALK = 2;
const F_DOOR = 4;

export class Grid {
  readonly w = GRID_W;
  readonly d = GRID_D;
  readonly flags = new Uint8Array(GRID_W * GRID_D);
  /** uid of the object-layer item occupying the tile (0 = free). */
  readonly occ = new Int32Array(GRID_W * GRID_D);
  /** uid of the floor-layer item (rugs) on the tile. */
  readonly floorOcc = new Int32Array(GRID_W * GRID_D);
  /** Carpet style index per tile. */
  readonly floor = new Uint8Array(GRID_W * GRID_D);
  /** Bumped whenever walkability changes so cached paths can be invalidated. */
  version = 0;
  rect: Rect = expansionRect(0);

  constructor(expansion = 0) {
    this.setExpansion(expansion);
  }

  idx(x: number, z: number): number {
    return z * GRID_W + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < GRID_W && z < GRID_D;
  }

  setExpansion(level: number): void {
    this.rect = expansionRect(level);
    this.flags.fill(0);
    for (let z = 0; z < GRID_D; z++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = this.idx(x, z);
        if (x >= this.rect.x0 && x <= this.rect.x1 && z >= this.rect.z0 && z <= this.rect.z1) this.flags[i] |= F_OWNED;
        if (z >= SIDEWALK_Z0 && z <= SIDEWALK_Z1) this.flags[i] |= F_SIDEWALK;
      }
    }
    for (const [x, z] of DOOR_TILES) this.flags[this.idx(x, z)] |= F_DOOR;
    this.version++;
  }

  isOwned(x: number, z: number): boolean {
    return this.inBounds(x, z) && (this.flags[this.idx(x, z)] & F_OWNED) !== 0;
  }

  isInside(x: number, z: number): boolean {
    return this.isOwned(x, z);
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
    if (f & (F_SIDEWALK | F_DOOR)) return true;
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

  /** Breadth-first flood from the entrance; returns a mask of reachable walkable tiles. */
  reachableFromDoor(extraBlocked?: (x: number, z: number) => boolean): Uint8Array {
    const seen = new Uint8Array(GRID_W * GRID_D);
    const queue: number[] = [];
    for (const [x, z] of DOOR_TILES) {
      const i = this.idx(x, z);
      seen[i] = 1;
      queue.push(i);
    }
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const x = i % GRID_W;
      const z = (i / GRID_W) | 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        const ni = this.idx(nx, nz);
        if (seen[ni]) continue;
        if (!this.isWalkable(nx, nz)) continue;
        if (extraBlocked && extraBlocked(nx, nz)) continue;
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
    for (let r = 1; r < 20; r++) {
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
