import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from '../render/materials';
import { asphaltTexture, canvasTexture, drawNeonText, lotTexture, makeCanvas, roundRect, seeded } from '../render/textures';
import { MIN_COLS, ROAD_HALF, STREET_ROWS, WILDS, avenueMid, avenueX, blocksFor, cityX, cityZ, colX, rowZ, setWilds, slotAt, streetZ } from './city';
import { BASE_HD, BASE_HW, baseSite, inBaseArea } from './militaryBase';
import { Obstacles, TreeBatch, instancedChunks, place } from './nature';
import { BELT, type CityPlan, LAKE_LEVEL, Path, type Pt, RIVER_HALF_TOWN, lakeOf, onPlannedRoad, outline, smoothPath } from './plan';
import { CITY_GROUND, type RoadLine, type Site, Terrain, setTerrain, smooth } from './terrain';
import { TerrainMesh } from './terrainMesh';

/**
 * Everything around the city, in the global frame: real land (see `Terrain`) with a ring road
 * that follows the city's edge, roads out of every street and avenue that ends at it, highways
 * cut into the hills (up the river canyon into the mountains, east to an overlook on the
 * mesas, south across the dunes to the bay, where the Interstate 15 bridge to Jackpot Island
 * runs out over the water), the river through town between stone walls with bridges where
 * the streets cross it, and things to find out there: the "Welcome to Jackpot City" sign,
 * billboards, Lake Mojave, Pinewood Forest, an oasis, a solar farm, wind turbines, a radio
 * mast and hot-air balloons drifting over the Strip.
 */

/** Old ring road distance from the city's box (the military base is laid out from it). */
export const RING = 70;
const BELT_HALF = 5.5;
const HIGHWAY_HALF = 5.5;

/** Water level of the bay at the end of Interstate 15 (its bridge runs out over it to Jackpot Island). */
export const BAY_LEVEL = 2;
/** Half the bridge deck's width: the interstate's two lanes and a kerb each side. */
const BRIDGE_HALF = 8;
/** How high the bridge's main span runs over the bay (it leaves the clifftop a little lower). */
const BRIDGE_SPAN_Y = BAY_LEVEL + 42;
/** How far out the bridge is drawn (on past the haze, even at the far view distance). */
const BRIDGE_LEN = 4400;
/** The pylons of its cable-stayed main span, metres out from the shore. */
const PYLONS = [1000, 1760];

/** The last two points of Interstate 15 (on the original grid): it reaches the bay at the second. */
function i15Tail(): [Pt, Pt] {
  const [, fx1] = cityX(MIN_COLS);
  const [, z1] = cityZ();
  return [{ x: fx1 + 640, z: z1 + 1500 }, { x: fx1 + 980, z: z1 + 2300 }];
}

/** The Interstate 15 bridge: where it leaves the highway (global) and at what height, the way it runs (unit) and how far it's drawn. */
export interface BridgeLine {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  len: number;
}

/** Height of the bridge's deck `s` metres out from the shore: from the end of the highway up to the main span. */
export function bridgeY(b: BridgeLine, s: number): number {
  return b.y + (BRIDGE_SPAN_Y - b.y) * smooth(s / 900);
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

/** A road out in the country with a name (shown on the map). */
export interface NamedRoad {
  name: string;
  road: RoadLine;
}

/** A point on a road with its direction and height. */
interface Station {
  x: number;
  z: number;
  y: number;
  /** Unit direction along the road. */
  dx: number;
  dz: number;
}

/** A straight road from a to b, as a path with a point every 6 m. */
function straight(a: Pt, b: Pt): Path {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 6));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  return new Path(pts);
}

/** Clip a convex polygon to one side of an axis-aligned line. */
function clipPoly(poly: Pt[], axis: 'x' | 'z', v: number, keepBelow: boolean): Pt[] {
  const out: Pt[] = [];
  const inside = (p: Pt) => (keepBelow ? p[axis] <= v : p[axis] >= v);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (v - a[axis]) / (b[axis] - a[axis]);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** A convex polygon minus an axis-aligned rectangle: up to four convex pieces. */
function subtractRect(poly: Pt[], r: { x0: number; x1: number; z0: number; z1: number }): Pt[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (maxX <= r.x0 || minX >= r.x1 || maxZ <= r.z0 || minZ >= r.z1) return [poly];
  const out: Pt[][] = [];
  const keep = (p: Pt[]) => {
    if (p.length >= 3) out.push(p);
  };
  keep(clipPoly(poly, 'x', r.x0, true));
  keep(clipPoly(poly, 'x', r.x1, false));
  const mid = clipPoly(clipPoly(poly, 'x', r.x0, false), 'x', r.x1, true);
  if (mid.length >= 3) {
    keep(clipPoly(mid, 'z', r.z0, true));
    keep(clipPoly(mid, 'z', r.z1, false));
  }
  return out;
}

/** Collects triangles (positions, uvs) and turns them into one mesh. */
class Tris {
  pos: number[] = [];
  uv: number[] = [];

  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], uvScale: number): void {
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.uv.push(p[0] / uvScale, p[2] / uvScale);
    }
  }

  /** A flat convex polygon facing up. */
  poly(pts: Pt[], y: number, uvScale: number): void {
    // Wind it counter-clockwise seen from above.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.z - b.x * a.z;
    }
    const p = area > 0 ? [...pts].reverse() : pts;
    for (let i = 1; i < p.length - 1; i++) this.tri([p[0].x, y, p[0].z], [p[i].x, y, p[i].z], [p[i + 1].x, y, p[i + 1].z], uvScale);
  }

  mesh(m: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * A shape swept along a line of stations: `shape` is a closed cross-section of (across, up)
 * points (across is to the left of travel). Both ends are capped.
 */
function sweep(st: Station[], shape: [number, number][], into: Tris, uvScale = 2): void {
  if (st.length < 2) return;
  const at = (s: Station, p: [number, number]): [number, number, number] => [s.x - s.dz * p[0], s.y + p[1], s.z + s.dx * p[0]];
  for (let i = 0; i < st.length - 1; i++) {
    for (let j = 0; j < shape.length; j++) {
      const p = shape[j];
      const q = shape[(j + 1) % shape.length];
      const a = at(st[i], p);
      const b = at(st[i], q);
      const c = at(st[i + 1], q);
      const d = at(st[i + 1], p);
      into.tri(a, c, b, uvScale);
      into.tri(a, d, c, uvScale);
    }
  }
  for (const [s, flip] of [[st[0], true], [st[st.length - 1], false]] as const) {
    const ring = shape.map((p) => at(s, p));
    for (let i = 1; i < ring.length - 1; i++) {
      if (flip) into.tri(ring[0], ring[i], ring[i + 1], uvScale);
      else into.tri(ring[0], ring[i + 1], ring[i], uvScale);
    }
  }
}

/** A box cross-section `w` wide from `y0` to `y1`, centred `u` to the left of the line. */
function boxShape(u: number, w: number, y0: number, y1: number): [number, number][] {
  return [
    [u - w / 2, y0],
    [u + w / 2, y0],
    [u + w / 2, y1],
    [u - w / 2, y1],
  ];
}

export class Outskirts {
  readonly group = new THREE.Group();
  private key = '';
  private cols = -1;
  private plan: CityPlan | null = null;
  private x0 = 0;
  private x1 = 0;
  private z0 = 0;
  private z1 = 0;
  private cells = new Map<number, Circle[]>();
  private rects: [number, number, number, number][] = [];
  private rotors: THREE.Object3D[] = [];
  private balloons: { o: THREE.Object3D; cx: number; cz: number; r: number; a: number; w: number; y: number }[] = [];
  private beacon: THREE.Mesh | null = null;
  private signMats: THREE.MeshStandardMaterial[] = [];
  private t = 0;
  /** More solid things out in the country (the military base's fence and buildings). */
  extraBlock: ((gx: number, gz: number) => boolean) | null = null;
  /** Trees, cabins and rocks of the lake shore and the forest. */
  private wild = new Obstacles();
  /** Lake Mojave, south of town (its pier sticks out into the water). */
  lake: { x: number; z: number; rx: number; rz: number; pierX: number; pierZ0: number; pierZ1: number } | null = null;
  /** Pinewood Forest, north-east of town, and the pond in it. */
  forest: { x0: number; x1: number; z0: number; z1: number } | null = null;
  pond: { x: number; z: number; rx: number; rz: number } | null = null;
  private sailboats: { o: THREE.Object3D; a: number; r: number; w: number }[] = [];
  private campfire: THREE.Mesh | null = null;
  /** The land, and how it's drawn. */
  terrain: Terrain | null = null;
  private mesh: TerrainMesh | null = null;
  /** The ring road round town. */
  belt: Path | null = null;
  /** Every road out in the country (the ring road first). */
  roads: RoadLine[] = [];
  /** The highways, by name. */
  highways: NamedRoad[] = [];
  /** The oasis, the overlook and the end of the canyon road (map labels). */
  oasis: { x: number; z: number } | null = null;
  overlook: { x: number; z: number; y: number } | null = null;
  /**
   * The Interstate 15 bridge to Jackpot Island (the next game): it leaves the end of the
   * highway on the shore of the bay and runs out over the water into the haze.
   */
  bridge: BridgeLine | null = null;
  /** The bay it crosses, south-east of town (the box it's carved in; water wherever the land is below BAY_LEVEL). */
  bay: { x0: number; x1: number; z0: number; z1: number } | null = null;
  private waterTex: THREE.CanvasTexture | null = null;

  /** Ground height (global) round the city: the land, the roads and bridges, the pier. */
  groundAt(gx: number, gz: number): number {
    const l = this.lake;
    if (l && Math.abs(gx - l.pierX) < 1.8 && gz > l.pierZ0 && gz < l.pierZ1) return 0.2;
    const b = this.bridge;
    if (b) {
      const rx = gx - b.x;
      const rz = gz - b.z;
      const s = rx * b.dx + rz * b.dz;
      if (s > 0 && s < b.len && Math.abs(rz * b.dx - rx * b.dz) < BRIDGE_HALF) return bridgeY(b, s);
    }
    return this.terrain ? this.terrain.groundAt(gx, gz) : 0;
  }

  /** Where a point is against the bridge: `s` metres out along it from the shore, `u` across it (0 down the middle). */
  private bridgeAt(gx: number, gz: number): { s: number; u: number } | null {
    const b = this.bridge;
    if (!b) return null;
    const rx = gx - b.x;
    const rz = gz - b.z;
    return { s: rx * b.dx + rz * b.dz, u: rz * b.dx - rx * b.dz };
  }

  /** On the bridge's deck (`pad` metres either side of it counts too)? */
  onBridge(gx: number, gz: number, pad = 0): boolean {
    const p = this.bridgeAt(gx, gz);
    return !!p && p.s > -pad && p.s < this.bridge!.len && Math.abs(p.u) < BRIDGE_HALF + pad;
  }

  /**
   * Round the end of the bridge: 'ask' on the end of the highway and the first stretch of the
   * deck (where the trip to Jackpot Island is offered), 'near' further along it or back down the
   * road a little (still there: no asking again), null once you've left.
   */
  bridgeZone(gx: number, gz: number): 'ask' | 'near' | null {
    const p = this.bridgeAt(gx, gz);
    if (!p) return null;
    const u = Math.abs(p.u);
    if (p.s > -20 && p.s < 140 && u < BRIDGE_HALF + 2) return 'ask';
    if (p.s > -90 && p.s < this.bridge!.len && u < BRIDGE_HALF + 14) return 'near';
    return null;
  }

  /** Where you come back to from Jackpot Island: on the highway just short of the bridge, in the lane into town, facing town (global). */
  bridgeArrival(): { x: number; z: number; yaw: number } | null {
    const hw = this.highways.find((h) => h.name === 'Interstate 15');
    if (!this.bridge || !hw) return null;
    const p = hw.road.path.pointAt(hw.road.path.length - 45);
    // Heading back up the highway, on the right-hand side of the road.
    const fx = -p.dx;
    const fz = -p.dz;
    return { x: p.x - fz * 3.2, z: p.z + fx * 3.2, yaw: Math.atan2(fx, fz) };
  }

  /** Same as groundAt (kept for older callers). */
  height(gx: number, gz: number): number {
    return this.groundAt(gx, gz);
  }

  /** In the water of the lake or the forest pond (the pier is dry; the river is the land's business)? */
  inWater(gx: number, gz: number): boolean {
    const l = this.lake;
    if (l) {
      const u = (gx - l.x) / l.rx;
      const v = (gz - l.z) / l.rz;
      if (u * u + v * v < 1.09 && !(Math.abs(gx - l.pierX) < 1.8 && gz < l.pierZ1)) return true;
    }
    const p = this.pond;
    if (p) {
      const u = (gx - p.x) / p.rx;
      const v = (gz - p.z) / p.rz;
      if (u * u + v * v < 1) return true;
    }
    return this.inBay(gx, gz) && !this.onBridge(gx, gz);
  }

  /** Over the water of the bay (`above` metres up the shore counts too)? */
  private inBay(gx: number, gz: number, above = 0): boolean {
    const b = this.bay;
    return !!b && !!this.terrain && gx > b.x0 - 220 && gx < b.x1 + 220 && gz > b.z0 - 220 && gz < b.z1 + 220 && this.terrain.sample(gx, gz) < BAY_LEVEL + above;
  }

  /** In the lake, the forest, the bay, under the bridge or on their shores (no cacti there). */
  private inNature(gx: number, gz: number, pad = 0): boolean {
    if (this.inBay(gx, gz, 3) || this.onBridge(gx, gz, 6 + pad)) return true;
    const l = this.lake;
    if (l) {
      const u = (gx - l.x) / (l.rx + 40 + pad);
      const v = (gz - l.z) / (l.rz + 40 + pad);
      if (u * u + v * v < 1) return true;
    }
    const o = this.oasis;
    if (o && Math.hypot(gx - o.x, gz - o.z) < 40 + pad) return true;
    const f = this.forest;
    return !!f && gx > f.x0 - pad && gx < f.x1 + pad && gz > f.z0 - pad && gz < f.z1 + pad;
  }

  /** Is this point taken by a rock, cactus, pond or landmark? */
  blocked(gx: number, gz: number): boolean {
    if (this.inWater(gx, gz) || this.wild.blocked(gx, gz)) return true;
    for (const [a, b, c, d] of this.rects) if (gx > a && gx < b && gz > c && gz < d) return true;
    const list = this.cells.get(this.cellKey(gx, gz));
    if (!list) return false;
    for (const c of list) if ((gx - c.x) ** 2 + (gz - c.z) ** 2 < c.r * c.r) return true;
    return false;
  }

  /** Out of town (not on a lot): can you walk or drive here? */
  open(gx: number, gz: number): boolean {
    const t = this.terrain;
    if (!t) return false;
    const s = slotAt(gx, gz, this.cols);
    if (s && this.plan?.has(s)) return false;
    // On the bridge: anywhere between its kerbs (as far as the land goes); its guard rails stop you.
    const p = this.bridgeAt(gx, gz);
    if (p && p.s > 0 && p.s < this.bridge!.len && Math.abs(p.u) < BRIDGE_HALF + 1.5) return Math.abs(p.u) < BRIDGE_HALF - 0.8 && t.inBounds(gx, gz);
    return t.walkable(gx, gz) && !this.blocked(gx, gz) && !(this.extraBlock?.(gx, gz) ?? false);
  }

  private cellKey(x: number, z: number): number {
    return Math.floor(x / 16 + 4096) * 10000 + Math.floor(z / 16 + 4096);
  }

  private block(x: number, z: number, r: number): void {
    const c = { x, z, r };
    for (let ix = Math.floor((x - r) / 16); ix <= Math.floor((x + r) / 16); ix++) {
      for (let iz = Math.floor((z - r) / 16); iz <= Math.floor((z + r) / 16); iz++) {
        const k = (ix + 4096) * 10000 + iz + 4096;
        const l = this.cells.get(k) ?? [];
        l.push(c);
        this.cells.set(k, l);
      }
    }
  }

  /** On or near a road out in the country (keep scenery off it)? */
  private onRoad(gx: number, gz: number, pad = 3): boolean {
    return !!this.terrain && this.terrain.roadDeck(gx, gz, pad) !== null;
  }

  /** Pick each terrain tile's detail for a viewer at this global point. */
  lod(fx: number, fz: number): void {
    this.mesh?.update(fx, fz);
  }

  /** Triangles of land drawn right now. */
  terrainTriangles(): number {
    return this.mesh?.triangles() ?? 0;
  }

  private mapCanvas: HTMLCanvasElement | null = null;
  /**
   * The land for the map: one pixel per terrain sample, coloured like the land and shaded by
   * its slopes (lit from the north-west). Made once per layout.
   */
  mapImage(): HTMLCanvasElement | null {
    const t = this.terrain;
    const m = this.mesh;
    if (!t || !m || typeof document === 'undefined') return null;
    if (this.mapCanvas) return this.mapCanvas;
    const cv = document.createElement('canvas');
    cv.width = t.nx;
    cv.height = t.nz;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(t.nx, t.nz);
    const lx = -0.5;
    const ly = 0.75;
    const lz = -0.45;
    for (let k = 0; k < t.nx * t.nz; k++) {
      const nx = m.normals[k * 3];
      const ny = m.normals[k * 3 + 1];
      const nz = m.normals[k * 3 + 2];
      const shade = Math.max(0.35, Math.min(1.25, (nx * lx + ny * ly + nz * lz) / 0.75));
      img.data[k * 4] = Math.min(255, m.colors[k * 3] * 255 * shade);
      img.data[k * 4 + 1] = Math.min(255, m.colors[k * 3 + 1] * 255 * shade);
      img.data[k * 4 + 2] = Math.min(255, m.colors[k * 3 + 2] * 255 * shade);
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapCanvas = cv;
    return cv;
  }

  /** Lay out the land for a city plan (`key` names the plan: nothing to do if it hasn't changed). */
  build(plan: CityPlan, key = JSON.stringify([plan.cols, plan.streets, plan.avenues])): void {
    if (key === this.key) return;
    this.key = key;
    this.plan = plan;
    this.cols = plan.cols;
    [this.x0, this.x1] = cityX(this.cols);
    [this.z0, this.z1] = cityZ();
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        if (!(o as THREE.InstancedMesh).userData?.sharedGeo) (o as THREE.Mesh).geometry?.dispose();
      });
    }
    this.mesh?.dispose();
    this.mapCanvas = null;
    this.cells.clear();
    this.rects = [];
    this.rotors = [];
    this.balloons = [];
    this.signMats = [];
    this.sailboats = [];
    this.wild.clear();
    this.beacon = null;
    this.campfire = null;
    // Natural features stay where they are as the city grows: laid out on the original grid.
    const [fx0, fx1] = cityX(MIN_COLS);
    const midX = (fx0 + fx1) / 2;
    const l = lakeOf(this.cols);
    this.lake = { ...l, pierX: l.x - 40, pierZ0: l.z - l.rz - 8, pierZ1: l.z - l.rz + 42 };
    this.forest = { x0: midX + 90, x1: midX + 520, z0: this.z0 - RING - 340, z1: this.z0 - RING - 40 };
    const fcx = (this.forest.x0 + this.forest.x1) / 2;
    const fcz = (this.forest.z0 + this.forest.z1) / 2;
    this.pond = { x: fcx + 20, z: fcz - 30, rx: 22, rz: 14 };
    this.oasis = { x: midX - 60, z: this.z0 - RING - 120 };
    this.overlook = { x: fx1 + 900, z: (this.z0 + this.z1) / 2, y: 26 };
    // Interstate 15 meets the bay at its end; the bridge carries on the way it was heading.
    const [back, end] = i15Tail();
    const dl = Math.hypot(end.x - back.x, end.z - back.z);
    this.bridge = { x: end.x, z: end.z, y: BAY_LEVEL + 8, dx: (end.x - back.x) / dl, dz: (end.z - back.z) / dl, len: BRIDGE_LEN };
    this.bay = { x0: end.x - 450, x1: end.x + 1150, z0: end.z + 100, z1: end.z + 1500 };

    const t = new Terrain(plan, this.sites());
    this.terrain = t;
    // The bridge leaves the highway where the land meets the bay (never lower than a clear span over the water).
    this.bridge.y = Math.max(BAY_LEVEL + 8, t.sample(end.x, end.z));
    const belt = this.makeBelt(t, plan);
    this.belt = belt;
    this.roads = [{ path: belt, half: BELT_HALF }];
    this.roads.push(...this.connectors(plan, belt, t));
    this.highways = this.makeHighways(t, belt);
    this.roads.push(...this.highways.map((h) => h.road));
    t.finish(this.roads);
    setTerrain(t, (x, z) => this.groundAt(x, z));

    this.mesh = new TerrainMesh(t, (x, z, c) => this.tint(x, z, c));
    this.mesh.update((this.x0 + this.x1) / 2, (this.z0 + this.z1) / 2);
    this.group.add(this.mesh.group);
    this.buildCityGround(plan);
    this.buildRoads();
    this.buildRiver(plan);
    this.buildRiverPark(plan);
    this.buildLake();
    this.buildForest();
    this.buildScatter();
    this.buildLandmarks();
    this.buildBay();
    this.buildBridge();
    setWilds((x, z) => this.open(x, z));
  }

  /**
   * The places the land is levelled for: the base, the lake shore, the oasis, the solar farm,
   * the overlook, the forest clearings, and the floor of the bay at the end of Interstate 15.
   */
  private sites(): Site[] {
    const b = baseSite(this.cols);
    const l = this.lake!;
    const f = this.forest!;
    const o = this.oasis!;
    const ov = this.overlook!;
    const p = this.pond!;
    const bay = this.bay!;
    const fcx = (f.x0 + f.x1) / 2;
    const fcz = (f.z0 + f.z1) / 2;
    const [, fx1] = cityX(MIN_COLS);
    return [
      { x: b.cx, z: b.cz, rx: BASE_HW + 24, rz: BASE_HD + 24, y: CITY_GROUND, blend: 160 },
      { x: (b.roadX0 + b.roadX1) / 2, z: b.cz, rx: (b.roadX1 - b.roadX0) / 2 + 12, rz: 16, y: CITY_GROUND, blend: 60 },
      { x: l.x, z: l.z, rx: l.rx + 70, rz: l.rz + 62, y: CITY_GROUND, blend: 120, round: true },
      { x: o.x, z: o.z, rx: 48, rz: 48, blend: 50, round: true },
      { x: fx1 + RING + 85, z: this.z1 + RING + 68, rx: 44, rz: 32, blend: 50 },
      { x: ov.x, z: ov.z, rx: 46, rz: 46, y: ov.y, blend: 180, round: true },
      { x: fcx - 40, z: fcz + 12, rx: 26, rz: 26, blend: 30, round: true },
      { x: fcx + 60, z: f.z0 + 60, rx: 12, rz: 12, blend: 20, round: true },
      { x: p.x, z: p.z, rx: p.rx + 10, rz: p.rz + 10, blend: 30, round: true },
      { x: fcx, z: f.z1 - 6, rx: 18, rz: 14, blend: 30, round: true },
      { x: (bay.x0 + bay.x1) / 2, z: (bay.z0 + bay.z1) / 2, rx: (bay.x1 - bay.x0) / 2, rz: (bay.z1 - bay.z0) / 2, y: BAY_LEVEL - 14, blend: 200 },
    ];
  }

  /** Is this point by the walled river in town, off the lots and streets (the riverside park)? */
  private riverPark(x: number, z: number, plan: CityPlan): boolean {
    const t = this.terrain;
    if (!t || x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return false;
    const d = t.cityDist(x, z);
    if (d <= 0 || d > 80) return false;
    const n = t.river.nearest(x, z, 125);
    return !!n && t.isWalled(n.s) && n.d > RIVER_HALF_TOWN + 17 && !onPlannedRoad(plan, x, z);
  }

  /** Lawns and shade trees on the empty ground along the river through town. */
  private buildRiverPark(plan: CityPlan): void {
    const t = this.terrain!;
    const r = t.river;
    const rnd = seeded(2024);
    const trees = new TreeBatch();
    for (let i = 0; i < r.pts.length; i++) {
      if (!t.walled[i] || rnd() < 0.25) continue;
      const p = r.pointAt(r.at[i]);
      for (const side of [-1, 1]) {
        const off = RIVER_HALF_TOWN + 22 + rnd() * 50;
        const x = p.x - p.dz * off * side + (rnd() - 0.5) * 4;
        const z = p.z + p.dx * off * side + (rnd() - 0.5) * 4;
        const s = slotAt(x, z, this.cols);
        if ((s && plan.has(s)) || !this.riverPark(x, z, plan) || this.onRoad(x, z, 4)) continue;
        const k = 0.9 + rnd() * 0.6;
        trees.add(rnd() < 0.3 ? 'palm' : 'leafy', x, z, k, rnd() * 6, t.sample(x, z));
        this.wild.circle(x, z, 0.4 * k);
      }
    }
    trees.build(this.group);
  }

  /** Recolour the land: mossy forest floor, beach sand round the lake and the bay (its floor water blue, for the map), green round the oasis, lawns by the river. */
  private tint(x: number, z: number, c: THREE.Color): void {
    if (this.plan && this.riverPark(x, z, this.plan)) {
      c.copy(LAWN);
      return;
    }
    if (this.inBay(x, z, 4)) {
      const y = this.terrain!.sample(x, z);
      if (y < BAY_LEVEL) c.copy(BAY_WATER);
      else c.lerp(BEACH, smooth((BAY_LEVEL + 4 - y) / 3));
      return;
    }
    const f = this.forest;
    if (f) {
      const e = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z);
      if (e > -20) c.lerp(FOREST_FLOOR, smooth((e + 20) / 40) * 0.9);
    }
    const l = this.lake;
    if (l) {
      const e = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
      if (e < 1.5) c.lerp(BEACH, smooth((1.5 - e) / 0.3));
    }
    const o = this.oasis;
    if (o) {
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < 45) c.lerp(OASIS, smooth((45 - d) / 15) * 0.7);
    }
  }

  /**
   * The ring road: a smooth loop round the city's outline, pushed out wherever it would run
   * too close to a lot or a street.
   */
  private makeBelt(t: Terrain, plan: CityPlan): Path {
    const ring = outline(plan, BELT);
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    const angle = (p: Pt) => Math.atan2(p.z - cz, p.x - cx);
    for (let it = 0; it < 10; it++) {
      const path = smoothPath(ring, 6, true);
      const push = new Set<number>();
      for (const p of path.pts) {
        if (t.cityDist(p.x, p.z) >= 26) continue;
        const a = angle(p);
        let best = 0;
        let bd = Infinity;
        ring.forEach((q, i) => {
          let d = Math.abs(angle(q) - a);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        push.add(best);
      }
      if (!push.size) return path;
      for (const i of push) {
        const q = ring[i];
        const d = Math.hypot(q.x - cx, q.z - cz) || 1;
        ring[i] = { x: q.x + ((q.x - cx) / d) * 14, z: q.z + ((q.z - cz) / d) * 14 };
      }
    }
    return smoothPath(ring, 6, true);
  }

  /** Short roads from every street and avenue that ends at the edge of town out to the ring road. */
  private connectors(plan: CityPlan, belt: Path, t: Terrain): RoadLine[] {
    const out: RoadLine[] = [];
    const march = (x: number, z: number, dx: number, dz: number) => {
      let left = false;
      for (let d = 3; d < 900; d += 3) {
        const px = x + dx * d;
        const pz = z + dz * d;
        if (!t.inBounds(px, pz)) return;
        if (belt.nearest(px, pz, 2)) {
          out.push({ path: straight({ x, z }, { x: px + dx * 3, z: pz + dz * 3 }), half: ROAD_HALF, y0: 0, y1: 0 });
          return;
        }
        const on = onPlannedRoad(plan, px, pz);
        if (!on) left = true;
        else if (left) {
          // It runs into another street first: join that instead.
          if (d > 16) out.push({ path: straight({ x, z }, { x: px, z: pz }), half: ROAD_HALF, y0: 0, y1: 0 });
          return;
        }
      }
    };
    plan.streets.forEach((st, r) => {
      if (!st) return;
      march(st.xa, streetZ(r), -1, 0);
      march(st.xb, streetZ(r), 1, 0);
    });
    plan.avenues.forEach((av, k) => {
      if (!av) return;
      march(avenueMid(k), av.za, 0, -1);
      march(avenueMid(k), av.zb, 0, 1);
    });
    return out;
  }

  /** The belt's point nearest to (x, z). */
  private beltPoint(belt: Path, x: number, z: number): Pt {
    let best = belt.pts[0];
    let bd = Infinity;
    for (const p of belt.pts) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { x: best.x, z: best.z };
  }

  /**
   * The highways: River Road up the canyon into the mountains, Mesa Drive east to the overlook,
   * Interstate 15 south across the dunes to its bridge, and the roads to the lake, the forest
   * and the base.
   */
  private makeHighways(t: Terrain, belt: Path): NamedRoad[] {
    const out: NamedRoad[] = [];
    const [fx0, fx1] = cityX(MIN_COLS);
    const W = fx1 - fx0;
    const z0 = this.z0;
    const z1 = this.z1;
    const mid = (z0 + z1) / 2;
    const r = t.river;
    // River Road: from the ring road up the river's north bank, into the canyon.
    let sB = t.sIn;
    for (let s = t.sIn; s > 0; s -= 12) {
      const p = r.pointAt(s);
      if (t.cityDist(p.x, p.z) > BELT + 60) {
        sB = s;
        break;
      }
    }
    const canyon: Pt[] = [];
    for (let s = sB; s > 600; s -= 90) {
      const p = r.pointAt(s);
      canyon.push({ x: p.x + p.dz * 38, z: p.z - p.dx * 38 });
    }
    if (canyon.length > 2) {
      const start = this.beltPoint(belt, canyon[0].x, canyon[0].z);
      const path = smoothPath([start, ...canyon], 6);
      out.push({
        name: 'River Road',
        road: {
          path,
          half: HIGHWAY_HALF,
          y0: 0,
          grade: 0.08,
          base: (x, z) => {
            const n = r.nearest(x, z, 90);
            const land = t.sample(x, z);
            return n ? Math.min(land, t.riverLevel(n.s) + 4.5) : land;
          },
        },
      });
    }
    // Mesa Drive: east to the overlook up on the mesas.
    const ov = this.overlook!;
    let east = belt.pts[0];
    for (const p of belt.pts) if (Math.abs(p.z - mid) < 80 && p.x > east.x) east = p;
    out.push({
      name: 'Mesa Drive',
      road: {
        path: smoothPath([{ x: east.x, z: east.z }, { x: east.x + 220, z: mid + 40 }, { x: east.x + 480, z: mid - 30 }, { x: ov.x - 170, z: ov.z + 30 }, { x: ov.x - 26, z: ov.z }], 6),
        half: HIGHWAY_HALF,
        y0: 0,
        y1: ov.y,
      },
    });
    // Interstate 15: south-east across the dunes and down to the bay, where its bridge to
    // Jackpot Island takes over.
    const s0 = this.beltPoint(belt, fx0 + 0.8 * W, z1 + 100);
    out.push({
      name: 'Interstate 15',
      road: {
        path: smoothPath([s0, { x: s0.x + 110, z: s0.z + 300 }, { x: fx1 + 250, z: z1 + 820 }, ...i15Tail()], 6),
        half: HIGHWAY_HALF + 1,
        y0: 0,
        y1: this.bridge!.y,
      },
    });
    // Lake Road down to the beach car park.
    const l = this.lake!;
    const lk = this.beltPoint(belt, l.x, z1 + 60);
    const parkZ = l.z - l.rz - 30;
    out.push({ name: 'Lake Road', road: { path: smoothPath([lk, { x: l.x, z: (lk.z + parkZ) / 2 }, { x: l.x, z: parkZ - 8 }], 6), half: 4.5, y0: 0, y1: 0 } });
    // Forest Road up to the trailhead.
    const f = this.forest!;
    const fcx = (f.x0 + f.x1) / 2;
    const fk = this.beltPoint(belt, fcx, z0 - 60);
    out.push({ name: 'Forest Road', road: { path: smoothPath([fk, { x: fcx, z: (fk.z + f.z1) / 2 }, { x: fcx, z: f.z1 + 2 }], 6), half: 4, y0: 0 } });
    // Fort Mojave road: from the base gate east to the ring road.
    const b = baseSite(this.cols);
    for (let d = 0; d < 1200; d += 3) {
      const x = b.roadX1 - 2 + d;
      if (belt.nearest(x, b.cz, 2)) {
        out.push({ name: 'Fort Mojave Rd', road: { path: straight({ x: b.roadX1 - 2, z: b.cz }, { x: x + 3, z: b.cz }), half: 6, y0: 0, y1: 0 } });
        break;
      }
    }
    return out;
  }

  /** The ground of every lot (under the buildings, yards and alleys). */
  private buildCityGround(plan: CityPlan): void {
    const tris = new Tris();
    const nb = blocksFor(plan.cols);
    for (let r = 0; r < STREET_ROWS; r++) {
      for (const side of [0, 1] as const) {
        const za = side === 0 ? rowZ(r) - 32 : rowZ(r) + 58;
        const zb = side === 0 ? rowZ(r) + 41 : rowZ(r) + 131;
        for (let k = 0; k < nb; k++) {
          let run = -1;
          for (let c = k * 4; c <= Math.min(plan.cols, (k + 1) * 4); c++) {
            const has = c < Math.min(plan.cols, (k + 1) * 4) && plan.has({ row: r, col: c, side });
            if (has && run < 0) run = c;
            if (!has && run >= 0) {
              const xa = colX(run) + 6;
              const xb = colX(c - 1) + 42;
              tris.poly([{ x: xa, z: za }, { x: xb, z: za }, { x: xb, z: zb }, { x: xa, z: zb }], -0.03, 2);
              run = -1;
            }
          }
        }
      }
    }
    const lot = lotTexture().clone();
    lot.repeat.set(1, 1);
    lot.needsUpdate = true;
    const m = tris.mesh(new THREE.MeshStandardMaterial({ map: lot, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    if (m) {
      m.name = 'cityGround';
      this.group.add(m);
    }
  }

  /** Stations every few metres along a road (its height from its profile). */
  private stations(road: RoadLine, lift: number, from = 0, to = road.path.pts.length - 1): Station[] {
    const t = this.terrain!;
    const out: Station[] = [];
    const pts = road.path.pts;
    for (let i = from; i <= to; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      out.push({ x: pts[i].x, z: pts[i].z, y: t.roadY(road, road.path.at[i]) + lift, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l });
    }
    return out;
  }

  /** The roads as ribbons draped over the land, with bridges where they cross the river. */
  private buildRoads(): void {
    const t = this.terrain!;
    const ribbon = (list: RoadLine[], lift: number, offset: number) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (const road of list) {
        const st = this.stations(road, lift);
        const base = pos.length / 3;
        st.forEach((s, i) => {
          const nx = -s.dz * road.half;
          const nz = s.dx * road.half;
          pos.push(s.x + nx, s.y, s.z + nz, s.x - nx, s.y, s.z - nz);
          const v = road.path.at[i] / 12;
          uv.push(0, v, 1, v);
          if (i > 0) {
            const a = base + (i - 1) * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2 }));
      m.receiveShadow = true;
      this.group.add(m);
    };
    ribbon([this.roads[0]], 0.07, -3);
    ribbon(this.roads.slice(1), 0.06, -2);
    // Bridges: a deck under the road and a parapet each side wherever it crosses the river.
    const deck = new Tris();
    const rail = new Tris();
    for (const road of this.roads) {
      const pts = road.path.pts;
      const wet = pts.map((p) => {
        const n = t.river.nearest(p.x, p.z, RIVER_HALF_TOWN + road.half + 4);
        return !!n && n.d < t.riverHalf(n.s) + road.half * 0.7 + 3;
      });
      for (let i = 0; i < pts.length; i++) {
        if (!wet[i]) continue;
        let j = i;
        while (j < pts.length - 1 && wet[j + 1]) j++;
        const a = Math.max(0, i - 1);
        const b = Math.min(pts.length - 1, j + 1);
        const st = this.stations(road, 0.06, a, b);
        sweep(st, boxShape(0, road.half * 2 + 0.6, -1.3, -0.02), deck, 3);
        for (const side of [-1, 1]) sweep(st, boxShape(side * (road.half + 0.2), 0.4, -0.02, 0.95), rail, 2);
        i = j;
      }
    }
    const stone = new THREE.MeshStandardMaterial({ color: 0xb9ab98, roughness: 0.9, side: THREE.DoubleSide });
    for (const m of [deck.mesh(stone), rail.mesh(stone)]) if (m) this.group.add(m);
  }

  /**
   * The river: flowing water all the way from the canyon to the lake; through town, stone
   * walls with a railing, a paved riverside walk each side and bridges where the streets and
   * avenues cross.
   */
  private buildRiver(plan: CityPlan): void {
    const t = this.terrain!;
    const r = t.river;
    const n = r.pts.length;
    // Flowing water (sloped where the river runs downhill).
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = r.at[i];
      const p = r.pointAt(s);
      const half = t.riverHalf(s) + (t.walled[i] ? 0.1 : 5);
      const y = t.riverLevel(s);
      pos.push(p.x - p.dz * half, y, p.z + p.dx * half, p.x + p.dz * half, y, p.z - p.dx * half);
      uv.push(0, s / 14, 1, s / 14);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.waterTex = waterTexture();
    const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3f9fc0, map: this.waterTex, roughness: 0.25, metalness: 0.1, emissive: 0x06303f, emissiveIntensity: 0.6 }));
    water.receiveShadow = true;
    water.name = 'river';
    this.group.add(water);
    // Every street and avenue (with its sidewalks) as a rectangle: the walk stops there, the bridge takes over.
    const rects: { x0: number; x1: number; z0: number; z1: number }[] = [];
    plan.streets.forEach((st, k) => {
      if (st) rects.push({ x0: st.xa, x1: st.xb, z0: streetZ(k) - 8.5, z1: streetZ(k) + 8.5 });
    });
    plan.avenues.forEach((av, k) => {
      if (!av) return;
      const [a, b] = avenueX(k);
      rects.push({ x0: a, x1: b, z0: av.za, z1: av.zb });
    });
    const onRect = (x: number, z: number, pad = 0) => rects.some((q) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad);
    // Walled runs (a few metres longer each end, under the natural banks).
    const walls = new Tris();
    const walk = new Tris();
    const cope = new Tris();
    const rails: THREE.Matrix4[] = [];
    const railBars = new Tris();
    const WALK = 18;
    for (let i = 0; i < n; i++) {
      if (!t.walled[i]) continue;
      let j = i;
      while (j < n - 1 && t.walled[j + 1]) j++;
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, j + 2);
      for (let q = a; q < b; q++) {
        const p0 = r.pointAt(r.at[q]);
        const p1 = r.pointAt(r.at[q + 1]);
        const h0 = t.riverHalf(r.at[q]);
        const h1 = t.riverHalf(r.at[q + 1]);
        const y0 = t.riverLevel(r.at[q]) - 0.5;
        const y1 = t.riverLevel(r.at[q + 1]) - 0.5;
        for (const side of [-1, 1]) {
          // Left of travel is (-dz, dx).
          const e = (p: typeof p0, d: number) => ({ x: p.x - p.dz * d * side, z: p.z + p.dx * d * side });
          const w0 = e(p0, h0);
          const w1 = e(p1, h1);
          const mx = (w0.x + w1.x) / 2;
          const mz = (w0.z + w1.z) / 2;
          const under = onRect(mx, mz, 0.5);
          const top = under ? -0.06 : 0.12;
          // The wall faces the water.
          const A: [number, number, number] = [w0.x, y0, w0.z];
          const B: [number, number, number] = [w1.x, y1, w1.z];
          const C: [number, number, number] = [w1.x, top, w1.z];
          const D: [number, number, number] = [w0.x, top, w0.z];
          if (side > 0) {
            walls.tri(A, C, B, 3);
            walls.tri(A, D, C, 3);
          } else {
            walls.tri(A, B, C, 3);
            walls.tri(A, C, D, 3);
          }
          if (under) continue;
          // Coping stones along the top, the walk behind them.
          const c0 = e(p0, h0 + 0.7);
          const c1 = e(p1, h1 + 0.7);
          cope.poly([w0, w1, c1, c0], 0.12, 2);
          const o0 = e(p0, h0 + WALK);
          const o1 = e(p1, h1 + WALK);
          let pieces: Pt[][] = [[c0, c1, o1, o0]];
          for (const q of rects) pieces = pieces.flatMap((pp) => subtractRect(pp, q));
          for (const pp of pieces) walk.poly(pp, -0.02, 3);
          // A railing post every other point, a rail between.
          const rp = e(p0, h0 + 0.3);
          if (q % 2 === 0) rails.push(place(rp.x, 0.62, rp.z));
          const rq = e(p1, h1 + 0.3);
          const len = Math.hypot(rq.x - rp.x, rq.z - rp.z) || 1;
          const dx = (rq.x - rp.x) / len;
          const dz = (rq.z - rp.z) / len;
          sweep([{ x: rp.x, z: rp.z, y: 0, dx, dz }, { x: rq.x, z: rq.z, y: 0, dx, dz }], boxShape(0, 0.08, 1.02, 1.1), railBars, 2);
        }
      }
      // Close the ends of the walk (nothing to see under it).
      for (const q of [a, b]) {
        const p = r.pointAt(r.at[q]);
        const h = t.riverHalf(r.at[q]);
        for (const side of [-1, 1]) {
          const e = (d: number) => ({ x: p.x - p.dz * d * side, z: p.z + p.dx * d * side });
          const u = e(h);
          const v = e(h + WALK);
          const y = t.riverLevel(r.at[q]) - 0.5;
          walls.tri([u.x, y, u.z], [v.x, y, v.z], [v.x, -0.02, v.z], 3);
          walls.tri([u.x, y, u.z], [v.x, -0.02, v.z], [u.x, -0.02, u.z], 3);
          walls.tri([u.x, y, u.z], [v.x, -0.02, v.z], [v.x, y, v.z], 3);
          walls.tri([u.x, y, u.z], [u.x, -0.02, u.z], [v.x, -0.02, v.z], 3);
        }
      }
      i = j;
    }
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9, side: THREE.DoubleSide });
    const wm = walls.mesh(stone);
    if (wm) this.group.add(wm);
    const cm = cope.mesh(mat(0xcfc4b2, { rough: 0.8 }));
    if (cm) this.group.add(cm);
    const pm = walk.mesh(new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    if (pm) {
      pm.name = 'riverWalk';
      this.group.add(pm);
    }
    const iron = new THREE.MeshStandardMaterial({ color: 0x2d3036, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
    const rg = instancedChunks(new THREE.BoxGeometry(0.08, 1.0, 0.08), iron, rails, false, 200, 380);
    if (rg) this.group.add(rg);
    const rb = railBars.mesh(iron);
    if (rb) this.group.add(rb);
    // City bridges: a deck under each street or avenue where it crosses the walled river, parapets over the water.
    const deck = new Tris();
    const para = new Tris();
    const span = (ax: number, az: number, bx: number, bz: number, halfW: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const near: boolean[] = [];
      const wet: boolean[] = [];
      const N = Math.ceil(len / 2);
      for (let i = 0; i <= N; i++) {
        const x = ax + dx * (i * 2);
        const z = az + dz * (i * 2);
        const q = r.nearest(x, z, RIVER_HALF_TOWN + WALK + halfW);
        const walled = !!q && t.isWalled(q.s);
        near.push(walled && q!.d < t.riverHalf(q!.s) + WALK + 1);
        wet.push(walled && q!.d < t.riverHalf(q!.s) + 0.5);
      }
      const run = (flags: boolean[], fn: (s0: number, s1: number) => void) => {
        for (let i = 0; i <= N; i++) {
          if (!flags[i]) continue;
          let j = i;
          while (j < N && flags[j + 1]) j++;
          fn(Math.max(0, i * 2 - 2), Math.min(len, j * 2 + 2));
          i = j;
        }
      };
      const line = (s0: number, s1: number, y: number): Station[] => [
        { x: ax + dx * s0, z: az + dz * s0, y, dx, dz },
        { x: ax + dx * s1, z: az + dz * s1, y, dx, dz },
      ];
      run(near, (s0, s1) => sweep(line(s0, s1, 0), boxShape(0, halfW * 2, -1.2, -0.03), deck, 3));
      run(wet, (s0, s1) => {
        for (const side of [-1, 1]) sweep(line(s0, s1, 0), boxShape(side * (halfW - 0.2), 0.4, 0, 0.95), para, 2);
      });
    };
    plan.streets.forEach((st, k) => {
      if (st) span(st.xa, streetZ(k), st.xb, streetZ(k), 8.5);
    });
    plan.avenues.forEach((av, k) => {
      if (av) span(avenueMid(k), av.za, avenueMid(k), av.zb, (avenueX(k)[1] - avenueX(k)[0]) / 2);
    });
    for (const m of [deck.mesh(stone), para.mesh(new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.85, side: THREE.DoubleSide }))]) if (m) this.group.add(m);
  }

  /**
   * Lake Mojave, south of town: a big blue lake in its basin with a sandy beach, palms,
   * umbrellas, a lifeguard tower, a wooden pier you can walk out on and sailboats on the
   * water. Lake Road comes down from the ring road to the beach car park.
   */
  private buildLake(): void {
    const l = this.lake!;
    const rnd = seeded(808);
    const g = this.group;
    const ground = (x: number, z: number) => this.terrain!.sample(x, z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshStandardMaterial({ color: 0x1f7fa8, map: this.waterTex ?? waterTexture(), roughness: 0.3, metalness: 0, emissive: 0x052838 }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(l.rx * 1.08, l.rz * 1.08, 1);
    water.position.set(l.x, LAKE_LEVEL, l.z);
    water.name = 'lake';
    g.add(water);
    // Car park at the top of the beach.
    const parkZ = l.z - l.rz - 30;
    const lot = new Tris();
    lot.poly([{ x: l.x - 22, z: parkZ - 8 }, { x: l.x + 22, z: parkZ - 8 }, { x: l.x + 22, z: parkZ + 8 }, { x: l.x - 22, z: parkZ + 8 }], 0.02, 4);
    const lm = lot.mesh(new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    if (lm) g.add(lm);
    // The pier: a long deck on posts with a rail, out over the water.
    const wood = mat(0x8a5a2e, { rough: 0.8 });
    const pz0 = l.pierZ0;
    const len = l.pierZ1 - pz0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, len), wood);
    deck.position.set(l.pierX, 0.12, pz0 + len / 2);
    deck.receiveShadow = true;
    g.add(deck);
    const posts: THREE.Matrix4[] = [];
    for (let z = pz0; z <= l.pierZ1; z += 3) {
      const y0 = Math.min(0, ground(l.pierX, z)) - 0.5;
      for (const sx of [-1, 1]) posts.push(place(l.pierX + sx * 1.7, (y0 + 1.1) / 2, z, 0, 1, 1.1 - y0, 1));
    }
    const pg = instancedChunks(new THREE.BoxGeometry(0.16, 1, 0.16), wood, posts);
    if (pg) g.add(pg);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), wood);
      rail.position.set(l.pierX + sx * 1.7, 1.05, pz0 + len / 2);
      g.add(rail);
    }
    // Palms round the shore, umbrellas and towels on the north beach.
    const trees = new TreeBatch();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const k = 1.2 + rnd() * 0.16;
      const x = l.x + Math.cos(a) * l.rx * k;
      const z = l.z + Math.sin(a) * l.rz * k;
      if (Math.abs(x - l.x) < 26 && z < l.z) continue;
      if (Math.abs(x - l.pierX) < 5 && z < l.z) continue;
      if (this.terrain!.inRiverWater(x, z) || this.onRoad(x, z, 2)) continue;
      const s = 0.8 + rnd() * 0.5;
      trees.add('palm', x, z, s, rnd() * 6, ground(x, z));
      this.wild.circle(x, z, 0.35 * s);
    }
    trees.build(g);
    const poles: THREE.Matrix4[] = [];
    const towels: THREE.Matrix4[] = [];
    const tColors = [0xff6fb5, 0x2fb8c9, 0xffc53d, 0xff8a1f, 0xf4f1ea, 0x39ff88];
    const topsByColor = new Map<number, THREE.Matrix4[]>();
    for (let i = 0; i < 26; i++) {
      const x = l.x - l.rx * 0.8 + rnd() * l.rx * 1.6;
      const u = (x - l.x) / l.rx;
      const z = l.z - l.rz * Math.sqrt(Math.max(0, 1 - u * u)) * 1.18 - 4 - rnd() * 10;
      if (Math.abs(x - l.pierX) < 4) continue;
      const y = ground(x, z);
      poles.push(place(x, y + 1.1, z));
      const c = tColors[i % tColors.length];
      const list = topsByColor.get(c) ?? [];
      list.push(place(x, y + 2.2, z, rnd() * 3));
      topsByColor.set(c, list);
      towels.push(place(x + 1.4, ground(x + 1.4, z + 0.4) + 0.03, z + 0.4, rnd() * 0.6));
      this.wild.circle(x, z, 0.12);
    }
    const pgeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6);
    const pp = instancedChunks(pgeo, mat(0xf4f1ea, { rough: 0.5 }), poles);
    if (pp) g.add(pp);
    const cone = new THREE.ConeGeometry(1.4, 0.5, 10);
    for (const [c, list] of topsByColor) {
      const tg = instancedChunks(cone, mat(c, { rough: 0.8 }), list, true);
      if (tg) g.add(tg);
    }
    const towel = new THREE.BoxGeometry(0.9, 0.03, 1.9);
    const tw = instancedChunks(towel, mat(0xff4d6d, { rough: 0.9 }), towels);
    if (tw) g.add(tw);
    // Lifeguard tower.
    const lx = l.x - 40;
    const lz = l.z - l.rz * 1.16 - 6;
    const ly = ground(lx, lz);
    const white = mat(0xf4f1ea, { rough: 0.6 });
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3, 0.14), white);
      leg.position.set(lx + ox * 1, ly + 0.9, lz + oz * 1);
      g.add(leg);
    }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), mat(0xff4d4d, { rough: 0.6 }));
    hut.position.set(lx, ly + 3.2, lz);
    hut.castShadow = true;
    g.add(hut);
    const hroof = new THREE.Mesh(new THREE.ConeGeometry(2, 0.8, 4), white);
    hroof.rotation.y = Math.PI / 4;
    hroof.position.set(lx, ly + 4.4, lz);
    g.add(hroof);
    this.wild.rect(lx - 1.2, lx + 1.2, lz - 1.2, lz + 1.2);
    // Sailboats out on the water.
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 5), mat(0xf4f1ea, { rough: 0.5 }));
      hull.position.y = 0.3;
      b.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), mat(0xd8d2c6));
      mast.position.set(0, 3.3, 0.4);
      b.add(mast);
      const sailGeo = new THREE.BufferGeometry();
      sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.8, 0.5, 0, 6.2, 0.5, 0, 0.8, -2.2], 3));
      sailGeo.computeVertexNormals();
      const sail = new THREE.Mesh(sailGeo, mat([0xff4d4d, 0x2fb8c9, 0xffc53d, 0xf4f1ea][i], { rough: 0.7, side: THREE.DoubleSide }));
      b.add(sail);
      g.add(b);
      this.sailboats.push({ o: b, a: rnd() * Math.PI * 2, r: 0.35 + rnd() * 0.45, w: (0.01 + rnd() * 0.01) * (i % 2 ? 1 : -1) });
    }
    const sign = billboard('LAKE MOJAVE', 'Beach · Pier · Sailing', '#2fe6ff', '#0b2a3a');
    sign.position.set(l.x + 28, ground(l.x + 28, parkZ - 4), parkZ - 4);
    sign.rotation.y = Math.PI;
    g.add(sign);
    this.wild.circle(l.x + 28 - 4.5, parkZ - 4, 0.5);
    this.wild.circle(l.x + 28 + 4.5, parkZ - 4, 0.5);
    this.glow(sign);
  }

  /** Signs that glow after dark. */
  private glow(o: THREE.Object3D): void {
    o.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.emissiveMap) this.signMats.push(m);
    });
  }

  /**
   * Pinewood Forest, north-east of town, over gently rolling ground: hundreds of pines and
   * birches, dirt trails, a log cabin, a campfire, a fire lookout tower and a pond. Forest
   * Road leads up from the ring road to the trailhead.
   */
  private buildForest(): void {
    const f = this.forest!;
    const t = this.terrain!;
    const rnd = seeded(5150);
    const g = this.group;
    const ground = (x: number, z: number) => t.sample(x, z);
    const cx = (f.x0 + f.x1) / 2;
    const cz = (f.z0 + f.z1) / 2;
    // Trails through the trees, draped over the ground.
    const trails = new Tris();
    const segs: [number, number, number, number][] = [];
    const trail = (ax: number, az: number, bx: number, bz: number) => {
      segs.push([ax, az, bx, bz]);
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 4));
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const st: Station[] = [];
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        st.push({ x, z, y: ground(x, z) + 0.05, dx, dz });
      }
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i];
        const b = st[i + 1];
        const w = 1.5;
        trails.tri([a.x + dz * w, a.y, a.z - dx * w], [a.x - dz * w, a.y, a.z + dx * w], [b.x + dz * w, b.y, b.z - dx * w], 3);
        trails.tri([a.x - dz * w, a.y, a.z + dx * w], [b.x - dz * w, b.y, b.z + dx * w], [b.x + dz * w, b.y, b.z - dx * w], 3);
      }
    };
    const pts: [number, number][] = [[cx, f.z1], [cx, cz + 40], [cx - 70, cz], [cx - 40, f.z0 + 50], [cx + 60, f.z0 + 40], [cx + 90, cz - 10], [cx, cz + 40]];
    for (let i = 0; i < pts.length - 1; i++) trail(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    trail(cx - 70, cz, f.x0 + 4, cz + 20);
    trail(cx + 90, cz - 10, f.x1 - 4, cz - 30);
    const tm = trails.mesh(new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
    if (tm) g.add(tm);
    const nearTrail = (x: number, z: number, pad: number) => segs.some(([ax, az, bx, bz]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (ax + dx * u), z - (az + dz * u)) < pad;
    });
    // Clearings: the cabin and campfire, the lookout tower, the pond.
    const cabin = { x: cx - 40, z: cz + 8 };
    const tower = { x: cx + 60, z: f.z0 + 60 };
    const pond = this.pond!;
    const clear: [number, number, number][] = [[cabin.x, cabin.z + 4, 20], [tower.x, tower.z, 9], [pond.x, pond.z, pond.rx + 6], [cx, f.z1 - 6, 14]];
    const trees = new TreeBatch();
    let n = 0;
    for (let i = 0; i < 9000 && n < 2600; i++) {
      const x = f.x0 + 3 + rnd() * (f.x1 - f.x0 - 6);
      const z = f.z0 + 3 + rnd() * (f.z1 - f.z0 - 6);
      if (nearTrail(x, z, 3.2) || this.onRoad(x, z, 3)) continue;
      if (clear.some(([a, b, r]) => Math.hypot(x - a, z - b) < r)) continue;
      // Thinner towards the edges.
      const edge = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z);
      if (edge < 25 && rnd() > edge / 25) continue;
      const s = 0.9 + rnd() * 0.9;
      trees.add(rnd() < 0.78 ? 'pine' : 'birch', x, z, s, rnd() * 6, ground(x, z) - 0.1);
      this.wild.circle(x, z, 0.38 * s);
      n++;
    }
    trees.build(g);
    // Pond
    const py = ground(pond.x, pond.z);
    const pw = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x2a6f7a, roughness: 0.3, metalness: 0, emissive: 0x04202a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    pw.rotation.x = -Math.PI / 2;
    pw.scale.set(pond.rx, pond.rz, 1);
    pw.position.set(pond.x, py + 0.03, pond.z);
    g.add(pw);
    // Log cabin with a pitched roof, a porch and a chimney.
    const cy = ground(cabin.x, cabin.z);
    const logs = mat(0x7a4f2a, { rough: 0.9 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 7), logs);
    cab.position.set(cabin.x, cy + 1.5, cabin.z);
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.2, 9.8, 3, 1), mat(0x4a3a2a, { rough: 0.85, flat: true }));
    // A three-sided prism laid along x, one edge up.
    roof.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    roof.scale.set(1, 1, 0.5);
    roof.position.set(cabin.x, cy + 4.4, cabin.z);
    g.add(roof);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), mat(0x8a8178, { rough: 0.9 }));
    chim.position.set(cabin.x + 3, cy + 5, cabin.z - 1.5);
    g.add(chim);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), mat(0x4a2a14, { rough: 0.7 }));
    door.position.set(cabin.x, cy + 1.1, cabin.z + 3.52);
    g.add(door);
    const win = mat(0x26303d, { emissive: 0xffc874, emissiveIntensity: 0.6, rough: 0.2 });
    for (const dx of [-2.8, 2.8]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.1), win);
      w.position.set(cabin.x + dx, cy + 1.8, cabin.z + 3.52);
      g.add(w);
    }
    this.wild.rect(cabin.x - 4.6, cabin.x + 4.6, cabin.z - 3.6, cabin.z + 3.6);
    // Campfire: a ring of stones, logs to sit on and a flickering flame.
    const fx = cabin.x + 2;
    const fz = cabin.z + 10;
    const fy = ground(fx, fz);
    const stones: THREE.Matrix4[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      stones.push(place(fx + Math.cos(a) * 1.1, fy + 0.12, fz + Math.sin(a) * 1.1, a, 0.35));
    }
    const sg = instancedChunks(new THREE.DodecahedronGeometry(1, 0), mat(0x8a8178, { rough: 0.95, flat: true }), stones);
    if (sg) g.add(sg);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6a10, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 }));
    flame.position.set(fx, fy + 0.7, fz);
    g.add(flame);
    this.campfire = flame;
    this.wild.circle(fx, fz, 1.4);
    for (const a of [0, 2.1, 4.2]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8), logs);
      log.rotation.set(0, a, Math.PI / 2);
      log.position.set(fx + Math.cos(a) * 3, ground(fx + Math.cos(a) * 3, fz + Math.sin(a) * 3) + 0.22, fz + Math.sin(a) * 3);
      g.add(log);
    }
    // Fire lookout tower.
    const ty = ground(tower.x, tower.z);
    const steel = mat(0x6a6f76, { metal: 0.5, rough: 0.5 });
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 14.5, 0.2), steel);
      leg.position.set(tower.x + ox * 2, ty + 6.75, tower.z + oz * 2);
      g.add(leg);
      this.wild.circle(tower.x + ox * 2, tower.z + oz * 2, 0.3);
    }
    const look = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 5), mat(0xb5a27a, { rough: 0.8 }));
    look.position.set(tower.x, ty + 15.3, tower.z);
    look.castShadow = true;
    g.add(look);
    const lroof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.6, 4), mat(0x5a2a2a, { rough: 0.8 }));
    lroof.rotation.y = Math.PI / 4;
    lroof.position.set(tower.x, ty + 17.4, tower.z);
    g.add(lroof);
    const sign = billboard('PINEWOOD FOREST', 'Trails · Cabin · Lookout', '#39ff88', '#0c2a1a');
    sign.position.set(cx + 12, ground(cx + 12, f.z1 + 4), f.z1 + 4);
    sign.rotation.y = Math.PI;
    g.add(sign);
    this.block(cx + 12 - 4.5, f.z1 + 4, 0.6);
    this.block(cx + 12 + 4.5, f.z1 + 4, 0.6);
    this.glow(sign);
  }

  /**
   * Cacti, Joshua trees, rocks and scrub all over the plain, boulders and pines up the
   * mountain slopes, everything standing on the land.
   */
  private buildScatter(): void {
    const t = this.terrain!;
    const rnd = seeded(1234 + this.cols);
    const lo = { x: t.x0 + 340, z: t.z0 + 340 };
    const span = { x: t.width - 680, z: t.depth - 680 };
    const pick = (ok: (x: number, z: number, y: number, slope: number, d: number) => boolean): { x: number; z: number; y: number; d: number } | null => {
      for (let tries = 0; tries < 30; tries++) {
        const x = lo.x + rnd() * span.x;
        const z = lo.z + rnd() * span.z;
        const d = t.cityDist(x, z);
        if (d < 14) continue;
        const y = t.sample(x, z);
        if (!ok(x, z, y, t.slopeAt(x, z), d)) continue;
        if (this.onRoad(x, z) || inBaseArea(x, z, this.cols, 14) || this.inNature(x, z) || t.river.nearest(x, z, RIVER_HALF_TOWN + 5)) continue;
        return { x, z, y, d };
      }
      return null;
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const scatter = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, ok: (x: number, z: number, y: number, slope: number, d: number) => boolean, size: () => number, radius: number, tilt = 0, far = 360, chunk = 400) => {
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const p = pick(ok);
        if (!p) continue;
        const s = size();
        e.set((rnd() - 0.5) * tilt, rnd() * Math.PI * 2, (rnd() - 0.5) * tilt);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p.x, p.y - 0.08, p.z), q, new THREE.Vector3(s, s, s));
        mats.push(m4.clone());
        if (radius > 0) this.block(p.x, p.z, radius * s);
      }
      const g = instancedChunks(geo, material, mats, true, chunk, far);
      if (g) this.group.add(g);
    };
    const plain = (_x: number, _z: number, y: number, slope: number) => slope < 0.35 && y < 60;
    scatter(cactusGeometry(), mat(0x3f7f3a, { rough: 0.8 }), 1700, plain, () => 0.7 + rnd() * 0.8, 0.5);
    scatter(joshuaGeometry(), mat(0x6f6a3a, { rough: 0.9, flat: true }), 800, (x, z, y, sl) => plain(x, z, y, sl) && z < this.z1 + 500, () => 0.8 + rnd() * 0.7, 0.45);
    scatter(new THREE.DodecahedronGeometry(1, 0), mat(0x9c6a48, { rough: 0.95, flat: true }), 1700, (_x, _z, _y, sl) => sl < 0.6, () => 0.5 + rnd() ** 2 * 3.5, 0.9, 0.8);
    // Boulders on the slopes and at the feet of the cliffs: part of the skyline, drawn far out.
    scatter(new THREE.DodecahedronGeometry(1, 1), mat(0x7f4c34, { rough: 0.95, flat: true }), 700, (_x, _z, y, sl, d) => d > 300 && (sl > 0.3 || y > 30), () => 3 + rnd() * 9, 0.8, 0.6, 1600, 900);
    scatter(new THREE.IcosahedronGeometry(0.6, 0), mat(0x8a8a4a, { rough: 1, flat: true }), 3000, (_x, _z, _y, sl) => sl < 0.5, () => 0.4 + rnd() * 0.9, 0, 0, 220);
    // Pines up the mountains, thicker in the valleys.
    const pines = new TreeBatch();
    for (let i = 0; i < 2600; i++) {
      const p = pick((_x, _z, y, sl, d) => d > 600 && y > 45 && y < 330 && sl < 0.9);
      if (!p) continue;
      const s = 1 + rnd() * 1.1;
      pines.add('pine', p.x, p.z, s, rnd() * 6, p.y - 0.2);
      this.block(p.x, p.z, 0.4 * s);
    }
    pines.build(this.group, false, 700, 400);
  }

  private buildLandmarks(): void {
    const t = this.terrain!;
    const belt = this.belt!;
    const { x0, x1, z0, z1 } = this;
    const ground = (x: number, z: number) => this.groundAt(x, z);
    // Welcome sign on River Road, just before the ring road, facing the traffic coming in from
    // the canyon (on the road's right: the river runs on its left).
    const river = this.highways.find((h) => h.name === 'River Road');
    if (river) {
      const p = river.road.path.pointAt(150);
      const off = HIGHWAY_HALF + 10;
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      const sign = welcomeSign();
      sign.position.set(x, ground(x, z), z);
      sign.rotation.y = Math.atan2(p.dx, p.dz);
      this.group.add(sign);
      this.block(x, z, 3.2);
      this.glow(sign);
      const end = river.road.path.pointAt(river.road.path.length - 30);
      const ex = end.x + end.dz * off;
      const ez = end.z - end.dx * off;
      const trail = billboard('RED ROCK CANYON', 'Trailhead · Waterfalls · Camping', '#ff8a1f', '#2a1206');
      trail.position.set(ex, ground(ex, ez), ez);
      trail.rotation.y = Math.atan2(-end.dx, -end.dz);
      this.group.add(trail);
      this.block(ex, ez, 5);
      this.glow(trail);
    }
    // Billboards round the ring road, facing the traffic.
    const ads: [string, string, string, string][] = [
      ['JACKPOT TYCOON', 'Build the biggest casino in the city', '#ffd24a', '#3a0d4d'],
      ['VELOCITY MOTORS', 'Supercars · Muscle · Limos', '#2fe6ff', '#0d2236'],
      ['BULLSEYE GUNS', 'Downtown since 1962', '#ff4d4d', '#2a0c0c'],
      ['THE OASIS', 'Cool water · 2 miles north', '#39ff88', '#0c2a1a'],
      ['SUNSET DRIVE', 'Where the night begins', '#ff8a1f', '#2a1206'],
      ['MESA DRIVE', 'Scenic overlook · 1 mile east', '#ffd24a', '#2a1206'],
    ];
    const cx = belt.pts.reduce((s, p) => s + p.x, 0) / belt.pts.length;
    const cz = belt.pts.reduce((s, p) => s + p.z, 0) / belt.pts.length;
    ads.forEach((ad, i) => {
      const s = belt.length * ((i + 0.37) / ads.length);
      const p = belt.pointAt(s);
      // Outside the loop.
      const outSide = (p.x - p.dz - cx) ** 2 + (p.z + p.dx - cz) ** 2 > (p.x - cx) ** 2 + (p.z - cz) ** 2 ? 1 : -1;
      const off = outSide * (BELT_HALF + 16);
      const x = p.x - p.dz * off;
      const z = p.z + p.dx * off;
      if (t.inRiverWater(x, z) || this.onRoad(x, z, 4) || !t.inBounds(x, z)) return;
      const b = billboard(...ad);
      b.position.set(x, ground(x, z), z);
      b.rotation.y = Math.atan2(cx - x, cz - z);
      this.group.add(b);
      const yaw = b.rotation.y;
      const dx = Math.cos(yaw) * 4.5;
      const dz = -Math.sin(yaw) * 4.5;
      this.block(x + dx, z + dz, 0.6);
      this.block(x - dx, z - dz, 0.6);
      this.glow(b);
    });

    // The oasis, north of town
    const o = this.oasis!;
    const oy = t.sample(o.x, o.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(22, 48), new THREE.MeshStandardMaterial({ color: 0x2aa6c4, roughness: 0.08, metalness: 0.2, emissive: 0x06303a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(o.x, oy + 0.04, o.z);
    this.group.add(water);
    const shore = new THREE.Mesh(new THREE.RingGeometry(21.5, 27, 48), new THREE.MeshStandardMaterial({ color: 0x9a8a4a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(o.x, oy + 0.02, o.z);
    this.group.add(shore);
    this.block(o.x, o.z, 21.5);
    const prnd = seeded(77);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + prnd() * 0.3;
      const r = 24 + prnd() * 5;
      const px = o.x + Math.cos(a) * r;
      const pz = o.z + Math.sin(a) * r;
      const palm = palmTree(px, pz, 6 + prnd() * 5, prnd);
      palm.position.y = t.sample(px, pz);
      this.group.add(palm);
      this.block(px, pz, 0.45);
    }

    // Solar farm, south-east
    const [, fx1] = cityX(MIN_COLS);
    const sx = fx1 + RING + 85 - 22.5;
    const sz = z1 + RING + 68 - 17.5;
    const sy = t.sample(sx + 22, sz + 17);
    const panel = new THREE.Group();
    const pGeo = new THREE.BoxGeometry(4, 0.08, 2.2);
    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6);
    const pMat = new THREE.MeshStandardMaterial({ color: 0x1a2a5a, roughness: 0.15, metalness: 0.6 });
    const pm: THREE.Matrix4[] = [];
    const lm: THREE.Matrix4[] = [];
    for (let r = 0; r < 8; r++) {
      for (let k = 0; k < 10; k++) {
        const x = sx + k * 5;
        const z = sz + r * 5;
        pm.push(new THREE.Matrix4().compose(new THREE.Vector3(x, sy + 1.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0)), new THREE.Vector3(1, 1, 1)));
        lm.push(new THREE.Matrix4().makeTranslation(x, sy + 0.6, z));
      }
    }
    const pi = new THREE.InstancedMesh(pGeo, pMat, pm.length);
    pm.forEach((m, i) => pi.setMatrixAt(i, m));
    const li = new THREE.InstancedMesh(legGeo, mat(0x9aa0aa, { metal: 0.6, rough: 0.4 }), lm.length);
    lm.forEach((m, i) => li.setMatrixAt(i, m));
    pi.castShadow = true;
    panel.add(pi, li);
    this.group.add(panel);
    this.rects.push([sx - 2.5, sx + 47.5, sz - 1.5, sz + 36.5]);

    // Scenic overlook at the end of Mesa Drive, up on its own mesa: railing, telescopes, a neon sign.
    const ov = this.overlook!;
    const look = new THREE.Group();
    look.position.set(ov.x, ov.y, ov.z);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(28, 40), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.03;
    look.add(pad);
    const rail = mat(0xb8b2a8, { rough: 0.5, metal: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (i / 13) * Math.PI;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), rail);
      post.position.set(Math.cos(a) * 27, 0.55, Math.sin(a) * 27);
      look.add(post);
      this.block(ov.x + Math.cos(a) * 27, ov.z + Math.sin(a) * 27, 0.3);
    }
    const bar = new THREE.Mesh(new THREE.TorusGeometry(27, 0.05, 6, 48, Math.PI), rail);
    bar.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    bar.position.y = 1.1;
    look.add(bar);
    for (const dz of [-6, 6]) {
      const scope = new THREE.Group();
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.2, 8), mat(0x2b6a8a, { metal: 0.5, rough: 0.4 }));
      stand.position.y = 0.6;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 10), mat(0x2b6a8a, { metal: 0.5, rough: 0.4 }));
      tube.rotation.z = Math.PI / 2 - 0.25;
      tube.position.set(0.2, 1.35, 0);
      scope.add(stand, tube);
      scope.position.set(23, 0, dz);
      look.add(scope);
      this.block(ov.x + 23, ov.z + dz, 0.4);
    }
    const ovTex = neonPanel('SCENIC OVERLOOK', '#2fe6ff', '#0b1020');
    const ovs = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshStandardMaterial({ map: ovTex, emissive: 0xffffff, emissiveMap: ovTex, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    ovs.position.set(-22, 4.5, -18);
    ovs.rotation.y = Math.PI / 2;
    this.signMats.push(ovs.material as THREE.MeshStandardMaterial);
    for (const dz of [-4, 4]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), rail);
      p.position.set(-22, 2.25, -18 + dz);
      look.add(p);
      this.block(ov.x - 22, ov.z - 18 + dz, 0.4);
    }
    look.add(ovs);
    this.group.add(look);

    // Wind turbines along the southern hills (turning in the wind).
    const trnd = seeded(31);
    for (let i = 0; i < 11; i++) {
      const x = x0 - 200 + ((i + 0.5) / 11) * (x1 - x0 + 400) + (trnd() - 0.5) * 60;
      const z = z1 + 950 + trnd() * 160;
      if (this.onRoad(x, z, 12)) continue;
      const wt = windTurbine();
      wt.position.set(x, t.sample(x, z) - 1, z);
      wt.rotation.y = Math.PI + (trnd() - 0.5) * 0.4;
      this.rotors.push(wt.userData.rotor as THREE.Object3D);
      (wt.userData.rotor as THREE.Object3D).rotation.z = trnd() * 6;
      this.group.add(wt);
      this.block(x, z, 1.4);
    }

    // Radio mast on the north-east hills with a blinking light
    const rx = x1 + 160;
    const rz = z0 - WILDS - 90;
    const mast = radioMast();
    mast.position.set(rx, t.sample(rx, rz) - 1, rz);
    this.beacon = mast.userData.beacon as THREE.Mesh;
    this.group.add(mast);
    this.block(rx, rz, 2);

    // Hot-air balloons drifting over town
    const brnd = seeded(5);
    const cols = [[0xff3fa4, 0xffd24a], [0x2fe6ff, 0xffffff], [0xff8a1f, 0x7a1f5a], [0x39ff88, 0x173a4a], [0xb77bff, 0xffd24a], [0xff4d4d, 0xffffff]];
    for (let i = 0; i < 6; i++) {
      const b = balloon(cols[i][0], cols[i][1]);
      const bx = x0 + brnd() * (x1 - x0);
      const bz = z0 + brnd() * (z1 - z0);
      this.balloons.push({ o: b, cx: bx, cz: bz, r: 80 + brnd() * 220, a: brnd() * Math.PI * 2, w: (0.006 + brnd() * 0.01) * (brnd() < 0.5 ? -1 : 1), y: 70 + brnd() * 60 });
      this.group.add(b);
    }
  }

  /**
   * The bay at the end of Interstate 15: water over its floor, and on out past the edge of the
   * land to the horizon (Jackpot Island is somewhere out there in the haze).
   */
  private buildBay(): void {
    const t = this.terrain!;
    const b = this.bridge!;
    const bay = this.bay!;
    const tz1 = t.z0 + t.depth;
    const pos: number[] = [];
    const quad = (xa: number, za: number, xb: number, zb: number) => {
      pos.push(xa, BAY_LEVEL, za, xa, BAY_LEVEL, zb, xb, BAY_LEVEL, zb, xa, BAY_LEVEL, za, xb, BAY_LEVEL, zb, xb, BAY_LEVEL, za);
    };
    // Over the land: only where it's under water (no puddles in the dunes round about).
    const C = 24;
    for (let z = bay.z0 - 220; z < tz1; z += C) {
      for (let x = bay.x0 - 220; x < bay.x1 + 220; x += C) {
        const lo = Math.min(t.sample(x, z), t.sample(x + C, z), t.sample(x, z + C), t.sample(x + C, z + C), t.sample(x + C / 2, z + C / 2));
        if (lo < BAY_LEVEL + 0.5) quad(x, z, x + C, Math.min(tz1, z + C));
      }
    }
    // Past the edge of the land: open water out beyond the haze.
    quad(b.x - 3800, tz1 - 12, b.x + 3800, b.z + 4800);
    const uv: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 48, pos[i + 2] / 48);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1f7fa8, map: (this.waterTex ?? waterTexture()).clone(), roughness: 0.3, metalness: 0, emissive: 0x052838 }));
    water.receiveShadow = true;
    water.name = 'bay';
    this.group.add(water);
  }

  /**
   * Interstate 15's bridge to Jackpot Island: from the end of the highway on the shore it climbs
   * on concrete piers to a cable-stayed main span between two tall pylons and runs on over the
   * water into the haze, with kerbs, guard rails and lamps all the way. A big overhead sign over
   * the highway just before it points the way (and, the other way, back to town).
   */
  private buildBridge(): void {
    const b = this.bridge!;
    const t = this.terrain!;
    const hw = this.highways.find((h) => h.name === 'Interstate 15');
    if (!hw) return;
    const g = this.group;
    const ax = (s: number, u: number) => b.x + b.dx * s - b.dz * u;
    const az = (s: number, u: number) => b.z + b.dz * s + b.dx * u;
    const st: Station[] = [];
    for (let s = 0; s <= b.len; s += 20) st.push({ x: ax(s, 0), z: az(s, 0), y: bridgeY(b, s), dx: b.dx, dz: b.dz });
    // Deck, kerbs and guard rails, swept along it.
    const deck = new Tris();
    const kerb = new Tris();
    const rail = new Tris();
    sweep(st, boxShape(0, BRIDGE_HALF * 2, -2.2, 0.04), deck, 3);
    for (const side of [-1, 1]) {
      sweep(st, boxShape(side * (BRIDGE_HALF - 0.6), 1.2, 0.04, 0.5), kerb, 2);
      for (const y of [0.55, 0.95]) sweep(st, boxShape(side * (BRIDGE_HALF - 0.1), 0.12, y - 0.11, y + 0.11), rail, 2);
    }
    const concrete = mat(0xd9d4ca, { rough: 0.85 });
    const steel = mat(0x8fa3b8, { rough: 0.4, metal: 0.6 });
    for (const [tris, m] of [[deck, mat(0xb9b4aa, { rough: 0.9 })], [kerb, concrete], [rail, steel]] as const) {
      const mesh = tris.mesh(m);
      if (!mesh) continue;
      mesh.castShadow = true;
      g.add(mesh);
    }
    // The interstate's lanes carry on over it (the markings in step with the highway's).
    {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const half = HIGHWAY_HALF + 1;
      const v0 = hw.road.path.length / 12;
      st.forEach((p, i) => {
        const s = i * 20;
        pos.push(p.x - p.dz * half, p.y + 0.07, p.z + p.dx * half, p.x + p.dz * half, p.y + 0.07, p.z - p.dx * half);
        uv.push(0, v0 + s / 12, 1, v0 + s / 12);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      });
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
      road.receiveShadow = true;
      g.add(road);
    }
    // Guard rail posts, and lamp posts every 60 m on alternate sides (lit after dark).
    const across = Math.atan2(-b.dz, b.dx);
    const posts: THREE.Matrix4[] = [];
    for (let s = 2; s < b.len; s += 8) for (const side of [-1, 1]) posts.push(place(ax(s, side * (BRIDGE_HALF - 0.1)), bridgeY(b, s) + 0.55, az(s, side * (BRIDGE_HALF - 0.1))));
    const pp = instancedChunks(new THREE.BoxGeometry(0.15, 1.1, 0.15), steel, posts, false, 400, 500);
    if (pp) g.add(pp);
    const poles: THREE.Matrix4[] = [];
    const arms: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    for (let s = 30, k = 0; s < b.len; s += 60, k++) {
      const side = k % 2 ? 1 : -1;
      const y = bridgeY(b, s);
      const u = side * (BRIDGE_HALF - 0.4);
      poles.push(place(ax(s, u), y + 4.5, az(s, u)));
      arms.push(place(ax(s, u - side * 1.1), y + 9, az(s, u - side * 1.1), across));
      heads.push(place(ax(s, u - side * 2.1), y + 8.85, az(s, u - side * 2.1), across));
    }
    const lampSteel = mat(0x5a6470, { rough: 0.4, metal: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xfff1c8, emissiveIntensity: 1 });
    this.signMats.push(glow);
    for (const ig of [
      instancedChunks(new THREE.CylinderGeometry(0.12, 0.18, 9, 8), lampSteel, poles, true, 800, 1200),
      instancedChunks(new THREE.BoxGeometry(0.15, 0.15, 2.4), lampSteel, arms, false, 800, 1200),
      instancedChunks(new THREE.BoxGeometry(0.6, 0.18, 0.9), glow, heads, false, 5000, Infinity),
    ]) if (ig) g.add(ig);
    // Piers on the approach spans (none under the main span: it hangs from the pylons).
    const cols: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    for (let s = 70; s < b.len; s += 110) {
      if (s > PYLONS[0] - 60 && s < PYLONS[1] + 60) continue;
      const top = bridgeY(b, s) - 2.2;
      for (const side of [-1, 1]) {
        const x = ax(s, side * 5.5);
        const z = az(s, side * 5.5);
        const foot = Math.min(t.sample(x, z), BAY_LEVEL) - 3;
        if (top - foot > 1) cols.push(place(x, (top + foot) / 2, z, 0, 1, top - foot, 1));
      }
      caps.push(place(ax(s, 0), top - 1.25, az(s, 0), across));
    }
    for (const ig of [
      instancedChunks(new THREE.CylinderGeometry(1.6, 2, 1, 12), concrete, cols, true, 2000, Infinity),
      instancedChunks(new THREE.BoxGeometry(4, 2.5, BRIDGE_HALF * 2 + 3), concrete, caps, true, 2000, Infinity),
    ]) if (ig) g.add(ig);
    // The pylons: A-frames leaning in over the deck, a red band at the head, warning lights,
    // and a fan of stay cables down to each side of the deck.
    const white: THREE.BufferGeometry[] = [];
    const red: THREE.BufferGeometry[] = [];
    const lights: THREE.BufferGeometry[] = [];
    const cables = new Tris();
    const TOP = BAY_LEVEL + 160;
    for (const sp of PYLONS) {
      // Built in the pylon's own frame (x across the deck, z along it), then set in place.
      const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(b.dz, 0, -b.dx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.dx, 0, b.dz)).setPosition(ax(sp, 0), 0, az(sp, 0));
      const add = (list: THREE.BufferGeometry[], geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
        geo.rotateZ(rz);
        geo.translate(x, y, z);
        geo.applyMatrix4(frame);
        list.push(geo.toNonIndexed());
      };
      const base = BAY_LEVEL - 3;
      for (const side of [-1, 1]) {
        const lean = Math.atan2(side * 13, TOP - base);
        add(white, new THREE.BoxGeometry(6, Math.hypot(TOP - base, 13), 5), side * 10.5, (TOP + base) / 2, 0, lean);
        add(lights, new THREE.SphereGeometry(0.8, 8, 6), side * 4, TOP + 1, 0);
      }
      add(white, new THREE.BoxGeometry(12, 5, 7), 0, TOP - 8, 0);
      add(white, new THREE.BoxGeometry(30, 4, 7), 0, bridgeY(b, sp) - 4.2, 0);
      add(white, new THREE.BoxGeometry(38, 6, 14), 0, base, 0);
      add(red, new THREE.BoxGeometry(12.4, 1.2, 7.4), 0, TOP - 4, 0);
      for (const dir of [-1, 1]) {
        for (let i = 1; i <= 14; i++) {
          const s = sp + dir * i * 26;
          const hy = TOP - 12 - i * 3.2;
          for (const side of [-1, 1]) {
            const x0 = ax(sp, side * 4.5);
            const z0 = az(sp, side * 4.5);
            const x1 = ax(s, side * (BRIDGE_HALF - 0.6));
            const z1 = az(s, side * (BRIDGE_HALF - 0.6));
            const l = Math.hypot(x1 - x0, z1 - z0);
            const dx = (x1 - x0) / l;
            const dz = (z1 - z0) / l;
            sweep([{ x: x0, z: z0, y: hy, dx, dz }, { x: x1, z: z1, y: bridgeY(b, s) + 0.8, dx, dz }], boxShape(0, 0.24, -0.12, 0.12), cables, 2);
          }
        }
      }
    }
    const beacon = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 1 });
    this.signMats.push(beacon);
    for (const [list, m] of [[white, mat(0xeeeae2, { rough: 0.7 })], [red, mat(0xd8452f, { rough: 0.6 })], [lights, beacon]] as const) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = m !== beacon;
      g.add(mesh);
    }
    const cm = cables.mesh(mat(0xf4f4f4, { rough: 0.4, metal: 0.3 }));
    if (cm) g.add(cm);
    // The overhead sign on the highway before it: Jackpot Island ahead; on its back, the way back to town.
    const len = hw.road.path.length;
    const p = hw.road.path.pointAt(len - 75);
    const sign = gantry(highwaySign('JACKPOT ISLAND', 'BRIDGE · KEEP STRAIGHT ON'), highwaySign('JACKPOT CITY', 'THE STRIP · DOWNTOWN'), HIGHWAY_HALF + 3.6);
    sign.position.set(p.x, t.roadY(hw.road, len - 75), p.z);
    sign.rotation.y = Math.atan2(p.dx, p.dz);
    g.add(sign);
    this.glow(sign);
    for (const side of [-1, 1]) this.block(p.x - p.dz * side * (HIGHWAY_HALF + 3.6), p.z + p.dx * side * (HIGHWAY_HALF + 3.6), 0.6);
  }

  /** Spin the turbines, drift the balloons, blink the mast, run the river; signs glow brighter after dark. */
  update(dt: number, night: number): void {
    this.t += dt;
    for (const r of this.rotors) r.rotation.z += dt * 1.1;
    for (const b of this.balloons) {
      b.a += b.w * dt;
      b.o.position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(this.t * 0.3 + b.r) * 3, b.cz + Math.sin(b.a) * b.r);
      b.o.rotation.y += dt * 0.05;
    }
    if (this.beacon) (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = (this.t % 1.6) < 0.5 ? 4 : 0.2;
    const l = this.lake;
    if (l) {
      for (const b of this.sailboats) {
        b.a += b.w * dt;
        b.o.position.set(l.x + Math.cos(b.a) * l.rx * b.r + 30, LAKE_LEVEL + Math.sin(this.t + b.r * 9) * 0.08, l.z + Math.sin(b.a) * l.rz * b.r + 10);
        b.o.rotation.y = -b.a + (b.w > 0 ? 0 : Math.PI);
      }
    }
    if (this.waterTex) this.waterTex.offset.y = -this.t * 0.09;
    if (this.campfire) {
      this.campfire.scale.set(1 + Math.sin(this.t * 13) * 0.1, 1 + Math.sin(this.t * 9.3) * 0.18, 1 + Math.cos(this.t * 11) * 0.1);
      (this.campfire.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + Math.sin(this.t * 17) * 0.5;
    }
    for (const m of this.signMats) m.emissiveIntensity = 0.06 + night * 1.1;
  }
}

// ------------------------------------------------------------------ models and textures

const FOREST_FLOOR = new THREE.Color(0x3d5a2e);
const LAWN = new THREE.Color(0x5c9a45);
const BEACH = new THREE.Color(0xe8d39c);
const OASIS = new THREE.Color(0x7a8f4a);
const BAY_WATER = new THREE.Color(0x2a8fc4);

let waterTexCache: THREE.CanvasTexture | null = null;
/** Ripples on the water (scrolled along the river so it flows). */
function waterTexture(): THREE.CanvasTexture {
  if (waterTexCache) return waterTexCache;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(404);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const w = 8 + rnd() * 26;
    ctx.strokeStyle = `rgba(150,200,225,${0.25 + rnd() * 0.35})`;
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w / 2, y + (rnd() - 0.5) * 6, x + w, y);
    ctx.stroke();
  }
  waterTexCache = canvasTexture(canvas, true);
  return waterTexCache;
}

let stoneTex: THREE.CanvasTexture | null = null;
/** Dressed stone blocks (the river walls and the bridges). */
function stoneTexture(): THREE.CanvasTexture {
  if (stoneTex) return stoneTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(77);
  ctx.fillStyle = '#7c7266';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 4; col++) {
      const v = 150 + rnd() * 50;
      ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.84})`;
      ctx.fillRect(col * 32 + off + 1.5, row * 32 + 1.5, 29, 29);
    }
  }
  stoneTex = canvasTexture(canvas, true);
  return stoneTex;
}

let paveTex: THREE.CanvasTexture | null = null;
/** Square paving slabs (the riverside walk). */
function pavingTexture(): THREE.CanvasTexture {
  if (paveTex) return paveTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(91);
  ctx.fillStyle = '#9d958a';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 180 + rnd() * 30;
      ctx.fillStyle = `rgb(${v},${v * 0.96},${v * 0.9})`;
      ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  }
  paveTex = canvasTexture(canvas, true);
  return paveTex;
}

let roadTex: THREE.CanvasTexture | null = null;
/** Desert highway: asphalt, white edge lines and a dashed yellow centre line (runs along v). */
function roadTexture(): THREE.CanvasTexture {
  if (roadTex) return roadTex;
  const { canvas, ctx } = makeCanvas(128, 256);
  const rnd = seeded(8);
  ctx.fillStyle = '#2a2730';
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 30 + rnd() * 40;
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect(rnd() * 128, rnd() * 256, 1, 1);
  }
  ctx.fillStyle = '#d8d4cc';
  ctx.fillRect(6, 0, 3, 256);
  ctx.fillRect(119, 0, 3, 256);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(62, 0, 4, 120);
  roadTex = canvasTexture(canvas, true);
  return roadTex;
}

function neonPanel(text: string, color: string, bg: string, sub = ''): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  roundRect(ctx, 8, 8, 496, 112, 14);
  ctx.stroke();
  drawNeonText(ctx, text, 256, sub ? 52 : 66, 460, sub ? 60 : 76, 'Bungee, "Arial Black", sans-serif', color);
  if (sub) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px Nunito, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sub, 256, 100);
  }
  return canvasTexture(canvas);
}

function cactusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  add(new THREE.CylinderGeometry(0.28, 0.32, 3.4, 9), 0, 1.7, 0);
  add(new THREE.SphereGeometry(0.28, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 3.4, 0);
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.8, 8), 0.5, 1.5, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 8), 0.86, 2.05, 0);
  add(new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.86, 2.65, 0);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 8), -0.45, 2.1, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8), -0.78, 2.5, 0);
  add(new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), -0.78, 2.95, 0);
  return mergeGeometries(parts)!;
}

function joshuaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
  };
  add(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 7), 0, 1.1, 0);
  add(new THREE.CylinderGeometry(0.1, 0.13, 1.4, 6), 0.45, 2.6, 0, 0, -0.6);
  add(new THREE.CylinderGeometry(0.1, 0.13, 1.2, 6), -0.4, 2.5, 0.1, 0.2, 0.7);
  add(new THREE.CylinderGeometry(0.09, 0.12, 1.0, 6), 0, 2.6, -0.4, -0.6, 0);
  for (const [x, y, z] of [[0.85, 3.3, 0], [-0.78, 3.1, 0.2], [0, 3.1, -0.75]]) add(new THREE.IcosahedronGeometry(0.42, 0), x, y, z);
  return mergeGeometries(parts)!;
}

function palmTree(x: number, z: number, hgt: number, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const lean = (rnd() - 0.5) * 0.25;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, hgt, 8, 6), mat(0x7a5232, { rough: 0.95 }));
  trunk.position.y = hgt / 2;
  trunk.rotation.z = lean;
  g.add(trunk);
  const topX = -Math.sin(lean) * hgt;
  const leaf = mat(0x2f9a4a, { rough: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 5), leaf);
    l.scale.set(0.5, 0.15, 4.2);
    const a = (i / 9) * Math.PI * 2;
    l.position.set(topX + Math.sin(a) * 1.4, hgt - 0.2, Math.cos(a) * 1.4);
    l.rotation.set(0.45, a, 0, 'YXZ');
    g.add(l);
  }
  return g;
}

function welcomeSign(): THREE.Group {
  const g = new THREE.Group();
  const { canvas, ctx } = makeCanvas(512, 384);
  ctx.fillStyle = '#f4f1e6';
  ctx.beginPath();
  ctx.moveTo(256, 4);
  ctx.lineTo(508, 120);
  ctx.lineTo(470, 380);
  ctx.lineTo(42, 380);
  ctx.lineTo(4, 120);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = 10;
  ctx.stroke();
  const dots = ['#ff3fa4', '#2fe6ff', '#ffd24a'];
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = '#d23a2a';
    ctx.beginPath();
    ctx.arc(80 + i * 44, 70, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 22px Nunito, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WELCOME'[i - 1] ?? '', 80 + i * 44, 71);
  }
  ctx.fillStyle = '#2a6fd6';
  ctx.font = 'italic 900 40px Nunito, Arial';
  ctx.fillText('to fabulous', 256, 130);
  drawNeonText(ctx, 'JACKPOT', 256, 200, 440, 86, 'Bungee, "Arial Black", sans-serif', '#d23a2a');
  drawNeonText(ctx, 'CITY', 256, 270, 300, 70, 'Bungee, "Arial Black", sans-serif', '#d23a2a');
  ctx.fillStyle = '#2a6fd6';
  ctx.font = '900 30px Nunito, Arial';
  ctx.fillText('★ NEVADA ★', 256, 340);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = dots[i % 3];
    ctx.beginPath();
    ctx.arc(30 + i * 18, 372, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = canvasTexture(canvas);
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), face);
  board.position.y = 6;
  g.add(board);
  const pole = mat(0xd8d2c6, { rough: 0.5, metal: 0.3 });
  for (const x of [-2.6, 2.6]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.2, 10), pole);
    p.position.set(x, 3.1, -0.05);
    p.castShadow = true;
    g.add(p);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 1.6), mat(0x8a6a4a, { rough: 0.9 }));
  base.position.y = 0.25;
  g.add(base);
  return g;
}

function billboard(title: string, sub: string, color: string, bg: string): THREE.Group {
  const g = new THREE.Group();
  const tex = neonPanel(title, color, bg, sub);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }));
  face.position.y = 7.5;
  const back = new THREE.Mesh(new THREE.BoxGeometry(12.4, 3.4, 0.25), mat(0x3a3a42, { rough: 0.6, metal: 0.4 }));
  back.position.set(0, 7.5, -0.15);
  g.add(face, back);
  const steel = mat(0x5a5a62, { rough: 0.5, metal: 0.6 });
  for (const x of [-4.5, 4.5]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), steel);
    p.position.set(x, 3, -0.2);
    p.castShadow = true;
    g.add(p);
  }
  const walk = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.7), steel);
  walk.position.set(0, 5.8, 0.25);
  g.add(walk);
  return g;
}

/** A green overhead highway sign: the Interstate 15 shield, a place, a line under it and an arrow straight on. */
function highwaySign(where: string, sub: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 360);
  ctx.fillStyle = '#0d6b3a';
  roundRect(ctx, 0, 0, 1024, 360, 28);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  roundRect(ctx, 14, 14, 996, 332, 20);
  ctx.stroke();
  // The shield: red band over a blue body, white edge.
  ctx.save();
  ctx.translate(150, 180);
  ctx.beginPath();
  ctx.moveTo(-90, -100);
  ctx.lineTo(90, -100);
  ctx.quadraticCurveTo(100, 60, 0, 120);
  ctx.quadraticCurveTo(-100, 60, -90, -100);
  ctx.closePath();
  ctx.fillStyle = '#1d3f9e';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#c8202f';
  ctx.fillRect(-100, -100, 200, 46);
  ctx.restore();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '900 26px Nunito, Arial, sans-serif';
  ctx.fillText('INTERSTATE', 0, -68, 160);
  ctx.font = '900 104px Nunito, Arial, sans-serif';
  ctx.fillText('15', 0, 58, 150);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 80px Nunito, Arial, sans-serif';
  ctx.fillText(where, 280, 168, 560);
  ctx.fillStyle = '#ffe9a0';
  ctx.font = '800 38px Nunito, Arial, sans-serif';
  ctx.fillText(sub, 284, 248, 560);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(920, 48);
  ctx.lineTo(985, 132);
  ctx.lineTo(942, 132);
  ctx.lineTo(942, 300);
  ctx.lineTo(898, 300);
  ctx.lineTo(898, 132);
  ctx.lineTo(855, 132);
  ctx.closePath();
  ctx.fill();
  return canvasTexture(canvas);
}

/**
 * An overhead sign gantry across a highway: two steel posts `half` metres either side of it, a
 * truss, and a panel each way (`ahead` faces traffic heading along +z, `back` the other way).
 */
function gantry(ahead: THREE.CanvasTexture, back: THREE.CanvasTexture, half: number): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0x8a8f96, { rough: 0.4, metal: 0.6 });
  const dark = mat(0x3a3d42, { rough: 0.6, metal: 0.4 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.6, 0.7), steel);
    post.position.set(side * half, 4.3, 0);
    post.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), dark);
    foot.position.set(side * half, 0.2, 0);
    g.add(post, foot);
  }
  for (const y of [7.2, 8.6]) {
    for (const z of [-0.25, 0.25]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, 0.18, 0.18), steel);
      beam.position.set(0, y, z);
      g.add(beam);
    }
  }
  for (let x = -half + 1.2; x < half; x += 2.4) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.6), steel);
    strut.position.set(x, 7.9, 0);
    g.add(strut);
  }
  for (const [tex, face] of [[ahead, -1], [back, 1]] as const) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.9), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }));
    // Each panel over the right-hand lane of the traffic reading it.
    panel.position.set(face * 3.6, 7.9, face * 0.62);
    if (face < 0) panel.rotation.y = Math.PI;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(11.2, 4.1, 0.2), dark);
    backing.position.set(face * 3.6, 7.9, face * 0.5);
    g.add(backing, panel);
  }
  return g;
}

function windTurbine(): THREE.Group {
  const g = new THREE.Group();
  const white = mat(0xf0f0f0, { rough: 0.4 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 48, 12), white);
  tower.position.y = 24;
  g.add(tower);
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 5), white);
  nacelle.position.set(0, 48.5, 0.5);
  g.add(nacelle);
  const rotor = new THREE.Group();
  rotor.position.set(0, 48.5, 3.2);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), white);
  rotor.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 20, 0.3), white);
    blade.geometry.translate(0, 10.5, 0);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    rotor.add(blade);
  }
  g.add(rotor);
  g.userData.rotor = rotor;
  return g;
}

function radioMast(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xd23a2a, { rough: 0.5, metal: 0.4 });
  const white = mat(0xeeeeee, { rough: 0.5, metal: 0.4 });
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.5 - i * 0.04, 0.55 - i * 0.04, 10, 4, 1, true), i % 2 ? red : white);
    seg.position.y = 5 + i * 10;
    g.add(seg);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 4 }));
  beacon.position.y = 81;
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

function balloon(c1: number, c2: number): THREE.Group {
  const g = new THREE.Group();
  const { canvas, ctx } = makeCanvas(256, 64);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `#${(i % 2 ? c2 : c1).toString(16).padStart(6, '0')}`;
    ctx.fillRect(i * 32, 0, 32, 64);
  }
  const tex = canvasTexture(canvas);
  const env = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  env.scale.set(1, 1.25, 1);
  env.position.y = 9;
  g.add(env);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.5, 3, 16, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
  neck.position.y = 2.2;
  g.add(neck);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), mat(0x8a5a2e, { rough: 0.9 }));
  basket.position.y = -0.6;
  g.add(basket);
  const rope = mat(0x3a2a1a);
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 4), rope);
    r.position.set(x, 0.6, z);
    g.add(r);
  }
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff8020, emissiveIntensity: 3 }));
  flame.position.y = 0.6;
  g.add(flame);
  return g;
}
