import * as THREE from 'three';
import { type ItemDef, footprintTiles, localTileToWorld, itemDef } from './catalog';
import { PlacedItem, loadSetup, type ItemHost, type SavedItem } from './placedItem';
import { DOOR_TILES, portalOf, type Grid } from '../world/grid';
import type { Effects } from '../render/effects';

/** Tiles just inside the front door: always kept clear so guests can get in. */
const ENTRY_TILES = DOOR_TILES.map(([x, z]) => [x, z - 1] as [number, number]);

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  seatOk?: boolean[];
}

/** Rectangle outline + fill drawn on the floor (selection and placement preview). */
export class FootprintMarker {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private edges: THREE.Mesh[] = [];
  private fillMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.22, depthWrite: false });
  private edgeMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  private seatMarks: THREE.Mesh[] = [];
  private seatGeo = new THREE.RingGeometry(0.12, 0.2, 20);
  private seatOkMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  private seatBadMat = new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.fill = new THREE.Mesh(g, this.fillMat);
    this.fill.renderOrder = 4;
    this.group.add(this.fill);
    for (let i = 0; i < 4; i++) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.06), this.edgeMat);
      e.renderOrder = 5;
      this.edges.push(e);
      this.group.add(e);
    }
    this.seatGeo.rotateX(-Math.PI / 2);
    this.group.visible = false;
  }

  show(x0: number, z0: number, x1: number, z1: number, color: number, seats: { x: number; z: number; ok: boolean }[] = []): void {
    this.group.visible = true;
    const w = x1 - x0;
    const d = z1 - z0;
    this.fill.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    this.fill.scale.set(w, 1, d);
    this.fillMat.color.setHex(color);
    this.edgeMat.color.setHex(color);
    const y = 0.03;
    this.edges[0].position.set((x0 + x1) / 2, y, z0);
    this.edges[0].scale.set(w + 0.06, 1, 1);
    this.edges[0].rotation.y = 0;
    this.edges[1].position.set((x0 + x1) / 2, y, z1);
    this.edges[1].scale.set(w + 0.06, 1, 1);
    this.edges[1].rotation.y = 0;
    this.edges[2].position.set(x0, y, (z0 + z1) / 2);
    this.edges[2].scale.set(d + 0.06, 1, 1);
    this.edges[2].rotation.y = Math.PI / 2;
    this.edges[3].position.set(x1, y, (z0 + z1) / 2);
    this.edges[3].scale.set(d + 0.06, 1, 1);
    this.edges[3].rotation.y = Math.PI / 2;
    while (this.seatMarks.length < seats.length) {
      const m = new THREE.Mesh(this.seatGeo, this.seatOkMat);
      m.renderOrder = 6;
      this.group.add(m);
      this.seatMarks.push(m);
    }
    this.seatMarks.forEach((m, i) => {
      const s = seats[i];
      m.visible = !!s;
      if (!s) return;
      m.position.set(s.x, 0.035, s.z);
      m.material = s.ok ? this.seatOkMat : this.seatBadMat;
    });
  }

  hide(): void {
    this.group.visible = false;
  }
}

export class ItemManager {
  readonly group = new THREE.Group();
  items: PlacedItem[] = [];
  private byUid = new Map<number, PlacedItem>();
  private nextUid = 1;
  /** Per-floor appeal and litter-guard maps, indexed like that floor's grid. */
  private appealMaps: Float32Array[] = [];
  private guardMaps: Float32Array[] = [];
  totalAppeal = 0;
  version = 0;
  viewFloor = 0;
  /** Set while the player is out on the street: no effects from inside. */
  hideAll = false;
  readonly selection = new FootprintMarker();
  readonly hover = new FootprintMarker();
  private raycaster = new THREE.Raycaster();

  constructor(private grids: () => Grid[], private host: ItemHost, private effects: Effects) {
    this.group.name = 'items';
    this.group.add(this.selection.group, this.hover.group);
  }

  private grid(floor: number): Grid {
    const gs = this.grids();
    return gs[floor] ?? gs[0];
  }

  get floors(): number {
    return this.grids().length;
  }

  get(uid: number): PlacedItem | undefined {
    return this.byUid.get(uid);
  }

  onFloor(floor: number): PlacedItem[] {
    return this.items.filter((i) => i.floor === floor);
  }

  /** Tiles that must stay free on a floor: the entrance and, with several floors, the elevator door. */
  private isReserved(floor: number, x: number, z: number): boolean {
    if (floor === 0 && ENTRY_TILES.some(([ex, ez]) => ex === x && ez === z)) return true;
    const pt = this.grid(floor).portal;
    return this.floors > 1 && x === pt[0] && z === pt[1];
  }

  /** Full placement validation including "can every guest still reach a seat?". */
  canPlace(def: ItemDef, floor: number, tx: number, tz: number, rot: number, ignore?: PlacedItem): PlaceCheck {
    const g = this.grid(floor);
    const tiles = footprintTiles(def, tx, tz, rot);
    const floorLayer = def.layer === 'floor';
    const outdoor = tiles.some(([x, z]) => g.isYard(x, z));
    if (outdoor && def.category !== 'decor') return { ok: false, reason: 'Only decorations can go outside' };
    for (const [x, z] of tiles) {
      if (!g.isOwned(x, z) && !g.isYard(x, z)) {
        return { ok: false, reason: floor === 0 && z > DOOR_TILES[0][1] ? 'Outside, keep to the yard in front of your casino' : 'Outside your casino walls' };
      }
      const i = g.idx(x, z);
      const occ = floorLayer ? g.floorOcc[i] : g.occ[i];
      if (occ && occ !== ignore?.uid) return { ok: false, reason: 'That spot is taken' };
      if (!floorLayer && g.wall[i]) return { ok: false, reason: 'There’s a wall there' };
      if (!floorLayer && this.isReserved(floor, x, z)) {
        return { ok: false, reason: floor === 0 && z === DOOR_TILES[0][1] - 1 ? 'Keep the entrance clear' : 'Keep the elevator door clear' };
      }
    }
    if (floorLayer) return { ok: true };
    const newSet = new Set(tiles.map(([x, z]) => g.idx(x, z)));
    const ignoreUid = ignore?.uid ?? -1;
    const walk = (x: number, z: number): boolean => {
      if (!g.inBounds(x, z)) return false;
      const i = g.idx(x, z);
      if (newSet.has(i) || g.wall[i]) return false;
      if (!g.isSidewalk(x, z) && !g.isDoor(x, z) && !g.isOwned(x, z)) return false;
      const o = g.occ[i];
      return o === 0 || o === ignoreUid;
    };
    const reach = g.flood(walk);
    if (floor === 0 && this.floors > 1 && !reach[g.idx(g.portal[0], g.portal[1])]) {
      return { ok: false, reason: 'That would block the elevator' };
    }
    const seatReachable = (sx: number, sz: number, own: Set<number>): boolean => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = sx + dx;
        const nz = sz + dz;
        if (!g.inBounds(nx, nz)) continue;
        const ni = g.idx(nx, nz);
        if (own.has(ni)) continue;
        if (reach[ni] && walk(nx, nz)) return true;
      }
      return false;
    };
    let seatOk: boolean[] | undefined;
    if (def.seats.length) {
      seatOk = def.seats.map((s) => {
        const [sx, sz] = localTileToWorld(def, tx, tz, rot, s.tile[0], s.tile[1]);
        return seatReachable(sx, sz, newSet);
      });
      if (!seatOk.some(Boolean)) return { ok: false, reason: 'Guests could not reach the seats', seatOk };
    }
    for (const it of this.items) {
      if (it === ignore || it.floor !== floor || !it.seats.length || it.def.layer === 'floor') continue;
      const own = new Set(it.tiles.map(([x, z]) => g.idx(x, z)));
      const hadAny = it.seats.some((s) => s.reachable);
      if (!hadAny) continue;
      if (!it.seats.some((s) => seatReachable(s.tileX, s.tileZ, own))) {
        return { ok: false, reason: `That would block the ${it.def.name}`, seatOk };
      }
    }
    return { ok: true, seatOk };
  }

  /** Can a wall go up on this tile without shutting guests out of anything? */
  canWall(floor: number, x: number, z: number): PlaceCheck {
    const g = this.grid(floor);
    if (!g.isOwned(x, z)) return { ok: false, reason: 'Walls go inside your building' };
    const i = g.idx(x, z);
    if (g.wall[i]) return { ok: false, reason: 'There’s already a wall there' };
    if (g.occ[i]) return { ok: false, reason: 'Something is standing there' };
    if (this.isReserved(floor, x, z)) return { ok: false, reason: floor === 0 && z === DOOR_TILES[0][1] - 1 ? 'Keep the entrance clear' : 'Keep the elevator door clear' };
    const walk = (tx: number, tz: number): boolean => {
      if (!g.inBounds(tx, tz)) return false;
      const k = g.idx(tx, tz);
      if (k === i || g.wall[k]) return false;
      if (!g.isSidewalk(tx, tz) && !g.isDoor(tx, tz) && !g.isOwned(tx, tz)) return false;
      return g.occ[k] === 0;
    };
    const reach = g.flood(walk);
    if (this.floors > 1 && floor === 0 && !reach[g.idx(g.portal[0], g.portal[1])]) return { ok: false, reason: 'That would wall off the elevator' };
    for (const it of this.items) {
      if (it.floor !== floor || !it.seats.length || it.def.layer === 'floor') continue;
      if (!it.seats.some((s) => s.reachable)) continue;
      const own = new Set(it.tiles.map(([tx, tz]) => g.idx(tx, tz)));
      const ok = it.seats.some((s) => {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = s.tileX + dx;
          const nz = s.tileZ + dz;
          if (!g.inBounds(nx, nz)) continue;
          const ni = g.idx(nx, nz);
          if (!own.has(ni) && reach[ni] && walk(nx, nz)) return true;
        }
        return false;
      });
      if (!ok) return { ok: false, reason: `That would wall off the ${it.def.name}` };
    }
    return { ok: true };
  }

  private occupy(item: PlacedItem, on: boolean): void {
    const layer = item.def.layer === 'floor' ? 'floor' : 'object';
    const g = this.grid(item.floor);
    for (const [x, z] of item.tiles) g.setOcc(x, z, on ? item.uid : 0, layer);
  }

  add(def: ItemDef, floor: number, tx: number, tz: number, rot: number, color?: number, uid?: number): PlacedItem {
    const id = uid ?? this.nextUid++;
    this.nextUid = Math.max(this.nextUid, id + 1);
    const item = new PlacedItem(id, def, tx, tz, rot, this.host, color);
    item.floor = floor;
    item.root.userData.itemUid = id;
    item.root.visible = floor === this.viewFloor;
    this.items.push(item);
    this.byUid.set(id, item);
    this.group.add(item.root);
    this.occupy(item, true);
    this.recompute();
    return item;
  }

  remove(item: PlacedItem): void {
    item.evict('Out with the old!', 0);
    this.occupy(item, false);
    item.dispose();
    this.items = this.items.filter((i) => i !== item);
    this.byUid.delete(item.uid);
    this.recompute();
  }

  move(item: PlacedItem, tx: number, tz: number, rot: number, floor = item.floor): void {
    item.evict('The manager is moving this machine', 2);
    this.occupy(item, false);
    item.floor = floor;
    item.setPosition(tx, tz, rot);
    item.root.visible = floor === this.viewFloor;
    this.occupy(item, true);
    item.playDropIn();
    this.recompute();
  }

  /** The elevator sits at the same spot on every floor once there is more than one. */
  syncElevators(): void {
    const want = this.floors > 1;
    const def = itemDef('elevator');
    for (const it of [...this.items]) {
      if (it.def.id === 'elevator' && (!want || it.floor >= this.floors)) this.remove(it);
    }
    if (!want) return;
    for (let f = 0; f < this.floors; f++) {
      if (this.items.some((i) => i.floor === f && i.def.id === 'elevator')) continue;
      const lift = this.grid(f).lift;
      this.add(def, f, lift[0], lift[1], 0, def.colors[0]);
    }
  }

  /**
   * Could the elevator shaft stand at (tx,tz)? It runs through every floor, so the spot
   * (and its door tile) must be free and inside the walls on all of them.
   */
  canPlaceLift(tx: number, tz: number): PlaceCheck {
    const def = itemDef('elevator');
    const tiles = footprintTiles(def, tx, tz, 0);
    const portal = portalOf([tx, tz]);
    for (let f = 0; f < this.floors; f++) {
      const g = this.grid(f);
      const own = this.items.find((i) => i.floor === f && i.def.id === 'elevator');
      for (const [x, z] of [...tiles, portal]) {
        if (!g.isOwned(x, z)) return { ok: false, reason: 'The elevator must stay inside your walls on every floor' };
        const o = g.occ[g.idx(x, z)];
        if (g.wall[g.idx(x, z)]) return { ok: false, reason: `A wall is in the way on ${f === 0 ? 'the ground floor' : `floor ${f + 1}`}` };
        if (o && o !== own?.uid) return { ok: false, reason: `Something is in the way on ${f === 0 ? 'the ground floor' : `floor ${f + 1}`}` };
        if (f === 0 && ENTRY_TILES.some(([ex, ez]) => ex === x && ez === z)) return { ok: false, reason: 'Keep the entrance clear' };
      }
    }
    // Guests must still be able to walk from the front door to the new elevator door.
    const g0 = this.grid(0);
    const block = new Set(tiles.map(([x, z]) => g0.idx(x, z)));
    const own0 = this.items.find((i) => i.floor === 0 && i.def.id === 'elevator')?.uid ?? -1;
    const reach = g0.flood((x, z) => {
      if (!g0.inBounds(x, z)) return false;
      const i = g0.idx(x, z);
      if (block.has(i) || g0.wall[i]) return false;
      if (!g0.isSidewalk(x, z) && !g0.isDoor(x, z) && !g0.isOwned(x, z)) return false;
      const o = g0.occ[i];
      return o === 0 || o === own0;
    });
    if (!reach[g0.idx(portal[0], portal[1])]) return { ok: false, reason: 'Guests couldn’t reach the elevator door there' };
    return { ok: true };
  }

  /** Move the elevator on every floor at once. */
  moveLift(tx: number, tz: number): void {
    const lifts = this.items.filter((i) => i.def.id === 'elevator');
    for (const it of lifts) {
      it.evict('The elevator is moving', 1);
      this.occupy(it, false);
    }
    for (let f = 0; f < this.floors; f++) this.grid(f).setLift([tx, tz]);
    for (const it of lifts) {
      it.setPosition(tx, tz, 0);
      this.occupy(it, true);
      it.playDropIn();
    }
    this.recompute();
  }

  /** Items standing where the elevator has to go (they block building a new floor). */
  elevatorBlockers(floor: number): PlacedItem[] {
    const def = itemDef('elevator');
    const g = this.grid(floor);
    const tiles = footprintTiles(def, g.lift[0], g.lift[1], 0);
    tiles.push(g.portal);
    const out = new Set<PlacedItem>();
    for (const [x, z] of tiles) {
      const uid = g.occupant(x, z);
      const it = uid ? this.byUid.get(uid) : undefined;
      if (it && it.def.id !== 'elevator') out.add(it);
    }
    return [...out];
  }

  /** Recompute seat reachability, appeal and litter maps after any layout change. */
  recompute(): void {
    this.version++;
    const gs = this.grids();
    this.appealMaps = gs.map((g) => new Float32Array(g.size));
    this.guardMaps = gs.map((g) => new Float32Array(g.size));
    const reaches = gs.map((g) => g.reachableFromDoor());
    for (const it of this.items) {
      const g = this.grid(it.floor);
      const reach = reaches[it.floor] ?? reaches[0];
      const own = new Set(it.tiles.map(([x, z]) => g.idx(x, z)));
      for (const s of it.seats) {
        s.reachable = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = s.tileX + dx;
          const nz = s.tileZ + dz;
          if (!g.inBounds(nx, nz)) continue;
          const ni = g.idx(nx, nz);
          if (own.has(ni)) continue;
          if (reach[ni] && g.isWalkable(nx, nz)) {
            s.reachable = true;
            break;
          }
        }
      }
    }
    let total = 0;
    for (const it of this.items) {
      const a = it.appeal;
      const r = it.def.appealRadius;
      const f = Math.min(it.floor, gs.length - 1);
      if (a > 0) {
        total += a;
        this.splat(f, this.appealMaps[f], it.cx, it.cz, r, (d) => a * (1 - d / r), false);
      }
      if (it.def.litterReduce) {
        const lr = it.def.litterReduce;
        this.splat(f, this.guardMaps[f], it.cx, it.cz, lr, (d) => 1 - d / lr, true);
      }
    }
    this.totalAppeal = total;
  }

  private splat(floor: number, arr: Float32Array, cx: number, cz: number, r: number, f: (d: number) => number, max: boolean): void {
    const g = this.grid(floor);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(g.w - 1, Math.ceil(cx + r));
    const z0 = Math.max(g.zMin, Math.floor(cz - r));
    const z1 = Math.min(g.zMin + g.d - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d >= r) continue;
        const i = g.idx(x, z);
        const v = f(d);
        arr[i] = max ? Math.max(arr[i], v) : arr[i] + v;
      }
    }
  }

  appealAt(x: number, z: number, floor = 0): number {
    const g = this.grid(floor);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    const arr = this.appealMaps[floor];
    if (!arr || !g.inBounds(tx, tz)) return 0;
    return arr[g.idx(tx, tz)];
  }

  litterGuardAt(x: number, z: number, floor = 0): number {
    const g = this.grid(floor);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    const arr = this.guardMaps[floor];
    if (!arr || !g.inBounds(tx, tz)) return 0;
    return arr[g.idx(tx, tz)];
  }

  itemAtTile(x: number, z: number, floor = 0): PlacedItem | undefined {
    const g = this.grid(floor);
    if (!g.inBounds(x, z)) return undefined;
    const i = g.idx(x, z);
    const uid = g.occ[i] || g.floorOcc[i];
    return uid ? this.byUid.get(uid) : undefined;
  }

  pick(ndc: THREE.Vector2, camera: THREE.Camera): PlacedItem | undefined {
    this.raycaster.setFromCamera(ndc, camera);
    const roots = this.items.filter((i) => i.floor === this.viewFloor && (this.inside || i.outdoor)).map((i) => i.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.itemUid === undefined) o = o.parent;
      if (o) {
        const it = this.byUid.get(o.userData.itemUid as number);
        if (it) return it;
      }
    }
    return undefined;
  }

  /** Only the floor being looked at is drawn; from the street, only the yard decorations. */
  setViewFloor(floor: number, inside = this.inside): void {
    this.viewFloor = floor;
    this.inside = inside;
    for (const it of this.items) it.root.visible = it.floor === floor && (inside || it.outdoor);
  }

  private inside = true;

  count(id: string): number {
    return this.items.reduce((a, i) => a + (i.def.id === id ? 1 : 0), 0);
  }

  countKind(pred: (i: PlacedItem) => boolean): number {
    return this.items.reduce((a, i) => a + (pred(i) ? 1 : 0), 0);
  }

  gamblingSeats(): number {
    let n = 0;
    for (const it of this.items) if (it.isGambling) n += it.seats.filter((s) => s.reachable).length;
    return n;
  }

  update(dt: number, t: number): void {
    for (const it of this.items) {
      this.effects.muted = this.hideAll || it.floor !== this.viewFloor;
      it.update(dt, t);
      if (it.wantsSmoke(dt)) this.effects.smoke(it.cx, it.model.height * 0.8, it.cz, 1);
    }
    this.effects.muted = false;
  }

  clear(): void {
    for (const it of [...this.items]) {
      this.occupy(it, false);
      it.dispose();
    }
    this.items = [];
    this.byUid.clear();
    this.nextUid = 1;
    this.recompute();
  }

  serialize(): SavedItem[] {
    return this.items.filter((i) => !i.def.fixed).map((i) => i.serialize());
  }

  load(list: SavedItem[]): void {
    this.clear();
    this.syncElevators();
    for (const s of list) {
      let def: ItemDef;
      try {
        def = itemDef(s.id);
      } catch {
        continue;
      }
      if (def.fixed) continue;
      const floor = Math.max(0, Math.min(this.floors - 1, s.f ?? 0));
      if (!this.canPlace(def, floor, s.tx, s.tz, s.rot).ok && def.layer !== 'floor') {
        // Keep saves robust: skip anything that no longer fits.
        if (!this.canPlaceLoose(def, floor, s.tx, s.tz, s.rot)) continue;
      }
      const it = this.add(def, floor, s.tx, s.tz, s.rot, s.color);
      it.level = Math.max(1, Math.min(5, s.level || 1));
      it.label = s.label ? String(s.label).slice(0, 14) : null;
      it.pendingXp = Math.max(0, Math.min(5000, Number(s.pxp) || 0));
      loadSetup(it, s.setup);
      it.dirty = s.dirty === true;
      // Tables from before dealers were hired come with one.
      if (it.needsDealer) it.dealer = s.dl !== false;
      if (it.level > 1 || it.label || s.setup) it.rebuildModel();
      it.stats = Object.assign({ plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 }, s.stats);
      if (s.broken) it.broken = true;
    }
    this.recompute();
  }

  /** Occupancy-only check used when restoring saves. */
  private canPlaceLoose(def: ItemDef, floor: number, tx: number, tz: number, rot: number): boolean {
    const g = this.grid(floor);
    for (const [x, z] of footprintTiles(def, tx, tz, rot)) {
      if (!g.isOwned(x, z) && !(g.isYard(x, z) && def.category === 'decor')) return false;
      if (g.occ[g.idx(x, z)]) return false;
      if (this.isReserved(floor, x, z)) return false;
    }
    return true;
  }
}
