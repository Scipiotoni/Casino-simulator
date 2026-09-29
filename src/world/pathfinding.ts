import type { Grid } from './grid';

let N = 0;
let gScore = new Float32Array(0);
let fScore = new Float32Array(0);
let came = new Int32Array(0);
let gen = new Int32Array(0);
let closedGen = new Int32Array(0);
let heap = new Int32Array(0);
let curGen = 1;

/** Scratch buffers grow with the largest grid seen (depth is unlimited). */
function ensure(size: number): void {
  if (size <= N) return;
  N = size;
  gScore = new Float32Array(N);
  fScore = new Float32Array(N);
  came = new Int32Array(N);
  gen = new Int32Array(N);
  closedGen = new Int32Array(N);
  heap = new Int32Array(N * 8);
  curGen = 1;
}

// Binary min-heap of node indices keyed by fScore.
let heapSize = 0;

function push(i: number): void {
  let k = heapSize++;
  heap[k] = i;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (fScore[heap[p]] <= fScore[heap[k]]) break;
    const t = heap[p];
    heap[p] = heap[k];
    heap[k] = t;
    k = p;
  }
}

function pop(): number {
  const top = heap[0];
  heap[0] = heap[--heapSize];
  let k = 0;
  for (;;) {
    const l = 2 * k + 1;
    const r = l + 1;
    let m = k;
    if (l < heapSize && fScore[heap[l]] < fScore[heap[m]]) m = l;
    if (r < heapSize && fScore[heap[r]] < fScore[heap[m]]) m = r;
    if (m === k) break;
    const t = heap[m];
    heap[m] = heap[k];
    heap[k] = t;
    k = m;
  }
  return top;
}

const SQRT2 = Math.SQRT2;
const NB: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
}

/**
 * A* over tiles with 8-way movement (no corner cutting). The goal and start tiles may be
 * blocked (a seat inside a machine footprint); those are only entered/left orthogonally.
 * Returns tile coordinates from start to goal inclusive, or null.
 */
export function findPath(grid: Grid, sx: number, sz: number, gx: number, gz: number): [number, number][] | null {
  if (!grid.inBounds(sx, sz) || !grid.inBounds(gx, gz)) return null;
  if (sx === gx && sz === gz) return [[gx, gz]];
  ensure(grid.size);
  curGen++;
  if (curGen > 1e9) {
    curGen = 1;
    gen.fill(0);
    closedGen.fill(0);
  }
  heapSize = 0;
  const startI = grid.idx(sx, sz);
  const goalI = grid.idx(gx, gz);
  const goalBlocked = !grid.isWalkable(gx, gz);
  const startBlocked = !grid.isWalkable(sx, sz);
  gScore[startI] = 0;
  fScore[startI] = heuristic(sx, sz, gx, gz);
  gen[startI] = curGen;
  came[startI] = -1;
  push(startI);

  const passable = (x: number, z: number) => grid.isWalkable(x, z);

  while (heapSize > 0) {
    const cur = pop();
    if (closedGen[cur] === curGen) continue;
    closedGen[cur] = curGen;
    if (cur === goalI) {
      const out: [number, number][] = [];
      let k = cur;
      while (k !== -1) {
        out.push([grid.tileX(k), grid.tileZ(k)]);
        k = came[k];
      }
      return out.reverse();
    }
    const cx = grid.tileX(cur);
    const cz = grid.tileZ(cur);
    const leavingBlockedStart = cur === startI && startBlocked;
    for (const [dx, dz, cost] of NB) {
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal && leavingBlockedStart) continue;
      const nx = cx + dx;
      const nz = cz + dz;
      if (!grid.inBounds(nx, nz)) continue;
      const ni = grid.idx(nx, nz);
      const isGoal = ni === goalI;
      if (!isGoal && !passable(nx, nz)) continue;
      if (isGoal && goalBlocked && diagonal) continue;
      if (diagonal && (!passable(cx + dx, cz) || !passable(cx, cz + dz))) continue;
      if (closedGen[ni] === curGen) continue;
      const g = gScore[cur] + cost;
      if (gen[ni] !== curGen || g < gScore[ni]) {
        gen[ni] = curGen;
        gScore[ni] = g;
        fScore[ni] = g + heuristic(nx, nz, gx, gz) * 1.001;
        came[ni] = cur;
        push(ni);
      }
    }
  }
  return null;
}

/** True when a disc of `radius` can slide from a to b without touching blocked tiles. */
export function clearLine(
  grid: Grid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number,
  allow?: (tx: number, tz: number) => boolean,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = ax + dx * t;
    const pz = az + dz * t;
    for (const ox of [-radius, radius]) {
      for (const oz of [-radius, radius]) {
        const tx = Math.floor(px + ox);
        const tz = Math.floor(pz + oz);
        if (grid.isWalkable(tx, tz)) continue;
        if (allow && allow(tx, tz)) continue;
        return false;
      }
    }
  }
  return true;
}

/**
 * Convert a tile path into world waypoints and pull the string so agents walk in
 * straight lines instead of zig-zagging tile to tile.
 */
export function smoothPath(grid: Grid, tiles: [number, number][], fromX: number, fromZ: number, radius = 0.28): [number, number][] {
  if (tiles.length === 0) return [];
  const pts: [number, number][] = tiles.map(([x, z]) => [x + 0.5, z + 0.5]);
  const [sx, sz] = tiles[0];
  const [gx, gz] = tiles[tiles.length - 1];
  const allow = (tx: number, tz: number) => (tx === sx && tz === sz) || (tx === gx && tz === gz);
  const out: [number, number][] = [];
  let ax = fromX;
  let az = fromZ;
  let i = 1;
  if (pts.length === 1) return [pts[0]];
  while (i < pts.length) {
    // Find the farthest point visible from the current anchor.
    let far = i;
    for (let j = pts.length - 1; j > i; j--) {
      if (clearLine(grid, ax, az, pts[j][0], pts[j][1], radius, allow)) {
        far = j;
        break;
      }
    }
    out.push(pts[far]);
    ax = pts[far][0];
    az = pts[far][1];
    i = far + 1;
  }
  return out;
}
