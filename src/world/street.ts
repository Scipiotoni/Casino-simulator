import * as THREE from 'three';
import { Exterior, type LotLook } from './exterior';
import { CENTER_X, DOOR_TILES, FACADE_Z } from './grid';
import {
  MIN_COLS, BLOCK_COLS, STREET_ROWS, type SlotRef, cityX, cityZ, fillerFor, globalToSlot, inCityOpen, inWilds, onRoadNetwork,
  setCityObstacles, slotAt, slotKey, slotToGlobal,
} from './city';
import { type SolidRect, lotHeight, lotSolids } from './footprint';
import { CentralPark } from './park';
import { cullChunks } from './nature';
import { CityView } from './cityView';
import { Crowd, type DoorSpot } from './crowd';
import { Police } from './police';
import { Outskirts } from './outskirts';
import { SIDEWALK_Z0 } from './grid';
export { ROAD_MID } from './grid';

export type LotKind = 'me' | 'rival' | 'player' | 'hotel' | 'house' | 'filler' | 'shop';

/** One building in the city. */
export interface StreetLot {
  /** 'me', 'rival', another player's id, 'hotel:h0', 'house', 'filler:…', 'shop:guns'… */
  id: string;
  kind: LotKind;
  info: LotLook;
  /** Owner's display name. */
  owner: string;
  /** Sort key: when the casino opened (the rival is always first). */
  order: number;
  /** Is the owner playing right now? */
  online: boolean;
  /** For a hotel: the id of the casino it belongs to (it stands right next to it). */
  hotelOf?: string;
  /** For a house: the id of the casino whose owner lives there. */
  houseOf?: string;
}

/** Exteriors are built within this distance of the camera focus (further out: the skyline boxes). */
const VIEW_R = 150;

/** A filler lot with nothing built on it (Central Park). */
function emptyLot(l: StreetLot): boolean {
  return l.info.filler?.kind === 'centralpark';
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Fixed buildings everybody shares (they never move, whoever plays). */
const SPECIALS: { id: string; slot: SlotRef; name: string; tagline: string; style: 'gunshop' | 'dealer'; color: number }[] = [
  { id: 'shop:guns', slot: { row: 0, col: 1, side: 0 }, name: 'Bullseye Guns', tagline: 'PISTOLS · SHOTGUNS · RIFLES', style: 'gunshop', color: 0xff4d4d },
  { id: 'shop:cars', slot: { row: 2, col: 1, side: 0 }, name: 'Velocity Motors', tagline: 'SUPERCARS · MUSCLE · LIMOS', style: 'dealer', color: 0x2fe6ff },
];

/** Uncle Sal's house on Palm Avenue: an NPC house anyone can rob (each player has their own Sal). */
export const NPC_OWNER = 'npc';
export const NPC_HOUSE_ID = 'npc:house';
export const NPC_HOUSE_LOOK = { name: "Uncle Sal's House", signFont: 'bungee', signColor: 0xffc53d, wallColor: 0xd9c7a0, trimColor: 0x5a3a1a };
const NPC_HOUSE_SLOT: SlotRef = { row: 1, col: 1, side: 0 };

/**
 * Every building of the city: casinos, hotels and houses of the players, the rival, the gun
 * shop and the filler buildings in between. Lots sit in slots (street row, column, side);
 * casinos and hotels line the Casino Strip, houses go on Palm Avenue.
 *
 * Every lot has its own local frame (the one its floor plan is built in: facade at
 * FACADE_Z, facing +z, door at CENTER_X). The global frame is the city's; the world is
 * always drawn in the frame of the lot whose interior is loaded ("active").
 */
export class Street {
  readonly group = new THREE.Group();
  readonly city = new CityView();
  /** People walking the sidewalks (drawn in the city's global frame). */
  readonly crowd = new Crowd();
  /** The city police (they come when you shoot people). */
  readonly police = new Police();
  /** The desert, roads and mountains around the city. */
  readonly outskirts = new Outskirts();
  /** Central Park in the middle of town. */
  readonly park = new CentralPark();
  private doors: DoorSpot[] = [];
  /** What's solid in every lot (lot frame), by slot. */
  private solids = new Map<number, SolidRect[]>();
  private readonly solidFn = (gx: number, gz: number): boolean => this.solidAt(gx, gz);
  /** Every building far away, as one instanced box each (the near ones are hidden: they're built in full). */
  private skyline: THREE.InstancedMesh | null = null;
  private skyIds: string[] = [];
  private skyMats: THREE.Matrix4[] = [];
  private skyDirty = true;
  private skyRebuild = true;
  /** The camera (world frame as drawn): buildings between it and you are hidden. */
  camPos: { x: number; y: number; z: number } | null = null;
  /** Seconds a building in the way stays hidden (no flicker at the edges). */
  private hideT = new Map<string, number>();
  lots: StreetLot[] = [];
  activeId = 'me';
  /** Lot columns along each street. */
  cols = MIN_COLS;
  private built = new Map<string, { ext: Exterior; key: string }>();
  private slots = new Map<string, SlotRef>();
  private bySlot = new Map<number, StreetLot>();
  private byId = new Map<string, StreetLot>();
  private builtCols = -1;

  constructor() {
    this.group.add(this.city.group);
    this.city.group.add(this.crowd.group, this.police.group, this.outskirts.group, this.park.group);
    setCityObstacles(this.solidFn);
  }

  /** Is a building, the park lake or a fountain standing at this global point? */
  solidAt(gx: number, gz: number): boolean {
    const s = slotAt(gx, gz, this.cols);
    if (s) {
      const rects = this.solids.get(slotKey(s));
      if (rects && rects.length) {
        const l = globalToSlot(s, gx, gz);
        for (const r of rects) if (l.x > r[0] && l.x < r[1] && l.z > r[2] && l.z < r[3]) return true;
      }
    }
    return this.park.blocked(gx, gz) || this.city.props.blocked(gx, gz);
  }

  /** Open ground (global): roads, sidewalks, backyards, alleys, parks and the desert. */
  isOpen(gx: number, gz: number): boolean {
    return onRoadNetwork(gx, gz, this.cols) || inCityOpen(gx, gz, this.cols, this.solidFn) || inWilds(gx, gz, this.cols);
  }

  private prints = new Map<string, { x0: number; x1: number; z0: number; z1: number; h: number } | null>();

  /** Global footprint (x0, x1, z0, z1) and height of a lot's main building, or null for an empty lot. */
  footprint(id: string): { x0: number; x1: number; z0: number; z1: number; h: number } | null {
    if (this.prints.has(id)) return this.prints.get(id)!;
    const f = this.computeFootprint(id);
    this.prints.set(id, f);
    return f;
  }

  private computeFootprint(id: string): { x0: number; x1: number; z0: number; z1: number; h: number } | null {
    const l = this.byId.get(id);
    if (!l) return null;
    const r = lotSolids(l.info)[0];
    const h = lotHeight(l.info);
    if (!r || h <= 0) return null;
    const a = this.toGlobal(id, r[0], r[2]);
    const b = this.toGlobal(id, r[1], r[3]);
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), h };
  }

  /**
   * Casinos fill the Casino Strip in opening order, alternating sides; a casino's hotel
   * buildings line up beside it on the same side. Houses go on Palm Avenue, right behind
   * their owner's casino when that lot is free. Every slot left over gets a filler building.
   */
  setLots(lots: StreetLot[]): void {
    const casinos = lots.filter((l) => l.kind === 'me' || l.kind === 'rival' || l.kind === 'player')
      .sort((a, b) => (a.kind === 'rival' ? -1 : b.kind === 'rival' ? 1 : a.order - b.order));
    const group = (key: 'hotelOf' | 'houseOf') => {
      const m = new Map<string, StreetLot[]>();
      for (const l of lots) {
        const owner = l[key];
        if (!owner || (key === 'hotelOf' ? l.kind !== 'hotel' : l.kind !== 'house')) continue;
        const list = m.get(owner) ?? [];
        list.push(l);
        m.set(owner, list);
      }
      for (const list of m.values()) list.sort((a, b) => a.order - b.order);
      return m;
    };
    const hotels = group('hotelOf');
    const houses = group('houseOf');
    this.slots.clear();
    this.bySlot.clear();
    const take = (l: StreetLot, s: SlotRef) => {
      this.slots.set(l.id, s);
      this.bySlot.set(slotKey(s), l);
    };
    const taken = (s: SlotRef) => this.bySlot.has(slotKey(s));
    const strip = (i: number): SlotRef => ({ row: 0, col: Math.floor(i / 2), side: (i % 2) as 0 | 1 });
    const out: StreetLot[] = [];
    for (const sp of SPECIALS) {
      const lot: StreetLot = {
        id: sp.id, kind: 'shop', owner: sp.name, order: 0, online: true,
        info: { look: { name: sp.name, signFont: 'bungee', signColor: sp.color, wallColor: 0x3b3f46, trimColor: sp.color }, width: 1, depth: 1, floors: 1, tagline: sp.tagline, style: sp.style },
      };
      take(lot, sp.slot);
      out.push(lot);
    }
    const sal: StreetLot = {
      id: NPC_HOUSE_ID, kind: 'house', houseOf: NPC_OWNER, owner: 'Uncle Sal', order: 0, online: false,
      info: { look: { ...NPC_HOUSE_LOOK }, width: 0, depth: 1, floors: 1, style: 'house', tagline: '' },
    };
    take(sal, NPC_HOUSE_SLOT);
    out.push(sal);
    let next = 0;
    for (const c of casinos) {
      while (taken(strip(next))) next++;
      take(c, strip(next));
      out.push(c);
      let i = next;
      for (const h of hotels.get(c.id) ?? []) {
        i += 2;
        while (taken(strip(i))) i += 2;
        take(h, strip(i));
        out.push(h);
      }
    }
    // Houses on Palm Avenue, behind their owner's casino if they can.
    let hn = 0;
    for (const c of casinos) {
      for (const h of houses.get(c.id) ?? []) {
        const s = this.slots.get(c.id)!;
        const want: SlotRef[] = [{ row: 1, col: s.col, side: 0 }, { row: 1, col: s.col, side: 1 }];
        let spot = want.find((w) => !taken(w));
        if (!spot) {
          while (taken({ row: 1, col: Math.floor(hn / 2), side: (hn % 2) as 0 | 1 })) hn++;
          spot = { row: 1, col: Math.floor(hn / 2), side: (hn % 2) as 0 | 1 };
        }
        take(h, spot);
        out.push(h);
      }
    }
    let maxCol = 0;
    for (const s of this.slots.values()) maxCol = Math.max(maxCol, s.col);
    this.cols = Math.max(MIN_COLS, Math.ceil((maxCol + 1) / BLOCK_COLS) * BLOCK_COLS);
    for (let row = 0; row < STREET_ROWS; row++) {
      for (let col = 0; col < this.cols; col++) {
        for (const side of [0, 1] as const) {
          const s = { row, col, side };
          if (taken(s)) continue;
          const f = fillerFor(s);
          const lot: StreetLot = {
            id: `filler:${row}:${col}:${side}`, kind: 'filler', owner: '', order: 0, online: false,
            info: { look: { name: f.name, signFont: 'nunito', signColor: f.accent, wallColor: f.color, trimColor: f.accent }, width: 0, depth: 0, floors: f.floors, style: 'filler', filler: f },
          };
          take(lot, s);
          out.push(lot);
        }
      }
    }
    this.lots = out;
    this.byId = new Map(out.map((l) => [l.id, l]));
    this.solids.clear();
    this.prints.clear();
    for (const l of out) this.solids.set(slotKey(this.slots.get(l.id)!), lotSolids(l.info));
    this.skyRebuild = true;
    // Doors people walk in and out of: casinos and hotels are the busy ones.
    this.doors = out.map((l) => {
      const s = this.slots.get(l.id)!;
      const d = slotToGlobal(s, CENTER_X - 0.5 + Math.random(), FACADE_Z + 0.3);
      const w = slotToGlobal(s, CENTER_X, SIDEWALK_Z0 + 1.8);
      const weight = l.kind === 'filler' ? (l.info.filler?.kind === 'park' || l.info.filler?.kind === 'parking' || emptyLot(l) ? 0 : 0.35)
        : l.kind === 'house' ? 0.25 : l.kind === 'shop' ? 1 : l.kind === 'hotel' ? (l.info.style === 'garden' ? 1 : 2.5) : 3;
      return { lotId: l.id, x: d.x, z: d.z, wx: w.x, wz: w.z, row: s.row, weight };
    }).filter((d) => d.weight > 0);
    this.crowd.cols = this.cols;
    this.police.cols = this.cols;
  }

  get(id: string): StreetLot | undefined {
    return this.byId.get(id);
  }

  /** Street row, column along the road and side (0 = north, 1 = south) of a lot. */
  placeOf(id: string): SlotRef {
    return this.slots.get(id) ?? { row: 0, col: 0, side: 0 };
  }

  /** Lot-local point → global frame. */
  toGlobal(id: string, x: number, z: number): Vec2 {
    return slotToGlobal(this.placeOf(id), x, z);
  }

  /** Global point → a lot's local frame. */
  fromGlobal(id: string, x: number, z: number): Vec2 {
    return globalToSlot(this.placeOf(id), x, z);
  }

  /** A point in one lot's frame expressed in another's. */
  map(from: string, to: string, x: number, z: number): Vec2 {
    const g = this.toGlobal(from, x, z);
    return this.fromGlobal(to, g.x, g.z);
  }

  /** Lot-local point → the world as drawn now. */
  toActive(id: string, x: number, z: number): Vec2 {
    return this.map(id, this.activeId, x, z);
  }

  /** Extra yaw of a lot's frame in the world as drawn now (0 or π). */
  rotOf(id: string): number {
    return this.placeOf(id).side === this.placeOf(this.activeId).side ? 0 : Math.PI;
  }

  /** The world as drawn now → global frame. */
  worldToGlobal(x: number, z: number): Vec2 {
    return this.toGlobal(this.activeId, x, z);
  }

  globalToWorld(x: number, z: number): Vec2 {
    return this.fromGlobal(this.activeId, x, z);
  }

  /** Global bounds of the city. */
  get bounds(): { x0: number; x1: number; z0: number; z1: number } {
    const [x0, x1] = cityX(this.cols);
    const [z0, z1] = cityZ();
    return { x0, x1, z0, z1 };
  }

  /** The lot whose frontage is nearest a world point (on the side of the road it's on). */
  lotAt(x: number, z: number): StreetLot | null {
    const g = this.worldToGlobal(x, z);
    const s = slotAt(g.x, g.z, this.cols);
    return s ? this.bySlot.get(slotKey(s)) ?? null : null;
  }

  private tileTo(id: string, tx: number, tz: number): [number, number] {
    const p = this.toGlobal(this.activeId, tx + 0.5, tz + 0.5);
    const l = this.fromGlobal(id, p.x, p.z);
    return [Math.floor(l.x), Math.floor(l.z)];
  }

  /** Is world tile (tx,tz) the front door of a lot (not the active one) you can walk into? */
  doorAt(tx: number, tz: number): StreetLot | null {
    const lot = this.lotAt(tx + 0.5, tz + 0.5);
    if (!lot || lot.id === this.activeId || lot.kind === 'filler' || lot.kind === 'shop') return null;
    const [lx, lz] = this.tileTo(lot.id, tx, tz);
    return lz === FACADE_Z && DOOR_TILES.some(([dx]) => dx === lx) ? lot : null;
  }

  /**
   * The player may stroll every sidewalk, cross any road, walk round the back of the buildings
   * and through the parks, and step into a lot's doorway.
   */
  isStreetWalkable(tx: number, tz: number): boolean {
    const g = this.worldToGlobal(tx + 0.5, tz + 0.5);
    if (this.isOpen(g.x, g.z)) return true;
    return this.doorAt(tx, tz) !== null;
  }

  /** Is this world point outside (not inside any building, nor in the park lake)? */
  isOutdoors(x: number, z: number): boolean {
    const g = this.worldToGlobal(x, z);
    return this.isOpen(g.x, g.z);
  }

  /** One instanced box per building, drawn only far away (near ones are built in full). */
  private buildSkyline(): void {
    if (this.skyline) {
      this.skyline.removeFromParent();
      this.skyline.dispose();
      this.skyline = null;
    }
    const ids: string[] = [];
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    for (const l of this.lots) {
      const f = this.footprint(l.id);
      if (!f || f.h < 2) continue;
      ids.push(l.id);
      const m = new THREE.Matrix4().makeScale(f.x1 - f.x0, f.h, f.z1 - f.z0);
      m.setPosition((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
      mats.push(m);
      cols.push(new THREE.Color(l.info.filler?.color ?? l.info.look.wallColor ?? 0x8c9aa8));
    }
    if (!ids.length) return;
    const im = new THREE.InstancedMesh(skylineGeometry(), skylineMaterial(), ids.length);
    mats.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, cols[i]);
    });
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = false;
    im.userData.sharedGeo = true;
    this.skyline = im;
    this.skyIds = ids;
    this.skyMats = mats;
    this.skyDirty = true;
    this.city.group.add(im);
  }

  /** Hide the skyline boxes of the buildings that are built in full. */
  private updateSkyline(): void {
    const im = this.skyline;
    if (!im || !this.skyDirty) return;
    this.skyDirty = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.skyIds.forEach((id, i) => im.setMatrixAt(i, this.built.has(id) ? zero : this.skyMats[i]));
    im.instanceMatrix.needsUpdate = true;
  }

  /**
   * Is this building between the camera and you (global frame)? A segment from your chest to
   * the camera against the building's box.
   */
  private blocksView(id: string, px: number, pz: number, cx: number, cy: number, cz: number): boolean {
    const f = this.footprint(id);
    if (!f) return false;
    const pad = 0.6;
    const o = [px, 1.1, pz];
    const d = [cx - px, cy - 1.1, cz - pz];
    const lo = [f.x0 - pad, 0, f.z0 - pad];
    const hi = [f.x1 + pad, f.h + 1, f.z1 + pad];
    let t0 = 0.02;
    let t1 = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-6) {
        if (o[k] < lo[k] || o[k] > hi[k]) return false;
        continue;
      }
      let a = (lo[k] - o[k]) / d[k];
      let b = (hi[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  }

  /** Build/refresh exteriors near the focus point; the active lot's shell hides while you're inside. */
  update(dt: number, focusX: number, focusZ: number, inside: boolean, sim = dt): void {
    const f = this.worldToGlobal(focusX, focusZ);
    const keep = new Set<string>();
    // The roads are (re)built lazily, when the city first gets drawn or grows wider.
    if (this.builtCols !== this.cols) {
      this.builtCols = this.cols;
      this.city.build(this.cols);
      this.outskirts.build(this.cols);
      this.park.build();
    }
    this.park.update(dt);
    cullChunks(f.x, f.z);
    if (this.skyRebuild) {
      this.skyRebuild = false;
      this.buildSkyline();
    }
    const act = this.placeOf(this.activeId);
    // The city is drawn in the global frame: carry it into the active lot's frame.
    const o = this.fromGlobal(this.activeId, 0, 0);
    this.city.group.position.set(o.x, 0, o.z);
    this.city.group.rotation.y = act.side === 1 ? Math.PI : 0;
    this.city.update(dt, sim, f.x, f.z);
    // Your own building's door has real guests; the crowd uses everybody else's.
    if (sim > 0) this.crowd.update(sim, f.x, f.z, this.doors.filter((d) => d.lotId !== this.activeId), true);
    // The camera in the global frame: buildings between it and you get out of the way.
    const cam = !inside && this.camPos ? { ...this.worldToGlobal(this.camPos.x, this.camPos.z), y: this.camPos.y } : null;
    for (const l of this.lots) {
      if (emptyLot(l)) continue;
      const c = this.toGlobal(l.id, CENTER_X, FACADE_Z - 12);
      if (l.id !== this.activeId && Math.hypot(c.x - f.x, c.z - f.z) > VIEW_R) continue;
      keep.add(l.id);
      const key = JSON.stringify(l.info);
      let b = this.built.get(l.id);
      if (!b || b.key !== key) {
        b?.ext.dispose();
        b = { ext: new Exterior(l.info), key };
        this.built.set(l.id, b);
        this.group.add(b.ext.group);
        this.skyDirty = true;
      }
      const p = this.toActive(l.id, 0, 0);
      b.ext.group.position.set(p.x, 0, p.z);
      b.ext.group.rotation.y = this.rotOf(l.id);
      let hidden = inside && l.id === this.activeId;
      if (cam && !hidden) {
        let t = this.hideT.get(l.id) ?? 0;
        if (this.blocksView(l.id, f.x, f.z, cam.x, cam.y, cam.z)) t = 0.35;
        else t = Math.max(0, t - dt);
        if (t > 0) this.hideT.set(l.id, t);
        else this.hideT.delete(l.id);
        hidden = t > 0;
      }
      b.ext.shell.visible = !hidden;
      b.ext.update(dt);
    }
    for (const [id, b] of this.built) {
      if (!keep.has(id)) {
        b.ext.dispose();
        this.built.delete(id);
        this.hideT.delete(id);
        this.skyDirty = true;
      }
    }
    this.updateSkyline();
  }

  /** Throw away every exterior (e.g. after a look change) so they rebuild next frame. */
  refresh(id?: string): void {
    for (const [k, b] of this.built) {
      if (id && k !== id) continue;
      b.ext.dispose();
      this.built.delete(k);
    }
    this.skyDirty = true;
  }
}

let skyGeo: THREE.BufferGeometry | null = null;
/** A unit box standing on the ground; the roof's UVs point at the plain corner of the texture. */
function skylineGeometry(): THREE.BufferGeometry {
  if (skyGeo) return skyGeo;
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each).
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.01, 0.99);
  skyGeo = g;
  return g;
}

let skyMat: THREE.MeshStandardMaterial | null = null;
/** Windows on a light wall, tinted per building; some of them lit at night. */
function skylineMaterial(): THREE.MeshStandardMaterial {
  if (skyMat) return skyMat;
  const N = 128;
  const wall = document.createElement('canvas');
  wall.width = wall.height = N;
  const lit = document.createElement('canvas');
  lit.width = lit.height = N;
  const a = wall.getContext('2d');
  const b = lit.getContext('2d');
  if (a && b) {
    a.fillStyle = '#ffffff';
    a.fillRect(0, 0, N, N);
    b.fillStyle = '#000';
    b.fillRect(0, 0, N, N);
    let k = 7;
    for (let r = 1; r < 8; r++) {
      for (let c = 0; c < 6; c++) {
        const x = 6 + c * 20;
        const y = 4 + r * 15;
        a.fillStyle = '#3a4250';
        a.fillRect(x, y, 12, 9);
        k = (k * 1103515245 + 12345) & 0x7fffffff;
        if (k % 3 === 0) {
          b.fillStyle = k % 2 ? '#ffd9a0' : '#cfe6ff';
          b.fillRect(x, y, 12, 9);
        }
      }
    }
    a.fillStyle = '#9a96a0';
    a.fillRect(0, 0, 8, 8);
  }
  const map = new THREE.CanvasTexture(wall);
  map.colorSpace = THREE.SRGBColorSpace;
  const em = new THREE.CanvasTexture(lit);
  em.colorSpace = THREE.SRGBColorSpace;
  skyMat = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 0.35, roughness: 0.85 });
  return skyMat;
}
