import * as THREE from 'three';
import { type ItemDef, footprintTiles, localTileToWorld, itemDef } from './catalog';
import { PlacedItem, type ItemHost, type SavedItem } from './placedItem';
import { DOOR_TILES, GRID_D, GRID_W, type Grid } from '../world/grid';
import { coinTexture } from '../render/textures';
import type { Effects } from '../render/effects';

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
  readonly appeal = new Float32Array(GRID_W * GRID_D);
  readonly litterGuard = new Float32Array(GRID_W * GRID_D);
  totalAppeal = 0;
  version = 0;
  private coinMesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private col = new THREE.Color();
  readonly selection = new FootprintMarker();
  readonly hover = new FootprintMarker();
  private raycaster = new THREE.Raycaster();

  constructor(private grid: Grid, private host: ItemHost, private effects: Effects) {
    this.group.name = 'items';
    const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.55, roughness: 0.3, emissive: 0xffffff, emissiveMap: coinTexture(), emissiveIntensity: 0.55 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 400);
    this.coinMesh.count = 0;
    this.coinMesh.frustumCulled = false;
    this.coinMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.coinMesh, this.selection.group, this.hover.group);
  }

  get(uid: number): PlacedItem | undefined {
    return this.byUid.get(uid);
  }

  private isEntry(x: number, z: number): boolean {
    return ENTRY_TILES.some(([ex, ez]) => ex === x && ez === z);
  }

  /** Full placement validation including "can every guest still reach a seat?". */
  canPlace(def: ItemDef, tx: number, tz: number, rot: number, ignore?: PlacedItem): PlaceCheck {
    const g = this.grid;
    const tiles = footprintTiles(def, tx, tz, rot);
    const floorLayer = def.layer === 'floor';
    for (const [x, z] of tiles) {
      if (!g.isOwned(x, z)) return { ok: false, reason: 'Outside your casino walls' };
      const i = g.idx(x, z);
      const occ = floorLayer ? g.floorOcc[i] : g.occ[i];
      if (occ && occ !== ignore?.uid) return { ok: false, reason: 'That spot is taken' };
      if (!floorLayer && this.isEntry(x, z)) return { ok: false, reason: 'Keep the entrance clear' };
    }
    if (floorLayer) return { ok: true };
    const newSet = new Set(tiles.map(([x, z]) => g.idx(x, z)));
    const ignoreUid = ignore?.uid ?? -1;
    const walk = (x: number, z: number): boolean => {
      if (!g.inBounds(x, z)) return false;
      const i = g.idx(x, z);
      if (newSet.has(i)) return false;
      if (g.isSidewalk(x, z) || g.isDoor(x, z)) return true;
      if (!g.isOwned(x, z)) return false;
      const o = g.occ[i];
      return o === 0 || o === ignoreUid;
    };
    const reach = this.flood(walk);
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
      if (it === ignore || !it.seats.length || it.def.layer === 'floor') continue;
      const own = new Set(it.tiles.map(([x, z]) => g.idx(x, z)));
      const hadAny = it.seats.some((s) => s.reachable);
      if (!hadAny) continue;
      if (!it.seats.some((s) => seatReachable(s.tileX, s.tileZ, own))) {
        return { ok: false, reason: `That would block the ${it.def.name}`, seatOk };
      }
    }
    return { ok: true, seatOk };
  }

  private flood(walk: (x: number, z: number) => boolean): Uint8Array {
    const g = this.grid;
    const seen = new Uint8Array(GRID_W * GRID_D);
    const q: number[] = [];
    for (const [x, z] of DOOR_TILES) {
      const i = g.idx(x, z);
      seen[i] = 1;
      q.push(i);
    }
    let h = 0;
    while (h < q.length) {
      const i = q[h++];
      const x = i % GRID_W;
      const z = (i / GRID_W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (!g.inBounds(nx, nz)) continue;
        const ni = g.idx(nx, nz);
        if (seen[ni] || !walk(nx, nz)) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }

  private occupy(item: PlacedItem, on: boolean): void {
    const layer = item.def.layer === 'floor' ? 'floor' : 'object';
    for (const [x, z] of item.tiles) this.grid.setOcc(x, z, on ? item.uid : 0, layer);
  }

  add(def: ItemDef, tx: number, tz: number, rot: number, color?: number, uid?: number): PlacedItem {
    const id = uid ?? this.nextUid++;
    this.nextUid = Math.max(this.nextUid, id + 1);
    const item = new PlacedItem(id, def, tx, tz, rot, this.host, color);
    item.root.userData.itemUid = id;
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

  move(item: PlacedItem, tx: number, tz: number, rot: number): void {
    item.evict('The manager is moving this machine', 2);
    this.occupy(item, false);
    item.setPosition(tx, tz, rot);
    this.occupy(item, true);
    item.playDropIn();
    this.recompute();
  }

  /** Recompute seat reachability, appeal and litter maps after any layout change. */
  recompute(): void {
    const g = this.grid;
    this.version++;
    const reach = g.reachableFromDoor();
    for (const it of this.items) {
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
    this.appeal.fill(0);
    this.litterGuard.fill(0);
    let total = 0;
    for (const it of this.items) {
      const a = it.appeal;
      const r = it.def.appealRadius;
      if (a > 0) {
        total += a;
        this.splat(this.appeal, it.cx, it.cz, r, (d) => a * (1 - d / r), false);
      }
      if (it.def.litterReduce) {
        const lr = it.def.litterReduce;
        this.splat(this.litterGuard, it.cx, it.cz, lr, (d) => 1 - d / lr, true);
      }
    }
    this.totalAppeal = total;
  }

  private splat(arr: Float32Array, cx: number, cz: number, r: number, f: (d: number) => number, max: boolean): void {
    const g = this.grid;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(GRID_W - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(GRID_D - 1, Math.ceil(cz + r));
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

  appealAt(x: number, z: number): number {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!this.grid.inBounds(tx, tz)) return 0;
    return this.appeal[this.grid.idx(tx, tz)];
  }

  litterGuardAt(x: number, z: number): number {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!this.grid.inBounds(tx, tz)) return 0;
    return this.litterGuard[this.grid.idx(tx, tz)];
  }

  itemAtTile(x: number, z: number): PlacedItem | undefined {
    if (!this.grid.inBounds(x, z)) return undefined;
    const i = this.grid.idx(x, z);
    const uid = this.grid.occ[i] || this.grid.floorOcc[i];
    return uid ? this.byUid.get(uid) : undefined;
  }

  pick(ndc: THREE.Vector2, camera: THREE.Camera): PlacedItem | undefined {
    this.raycaster.setFromCamera(ndc, camera);
    const roots = this.items.map((i) => i.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.itemUid === undefined) o = o.parent;
      if (o) {
        const it = this.byUid.get(o.userData.itemUid as number);
        if (it && it.def.layer !== 'floor') return it;
        if (it) return it;
      }
    }
    return undefined;
  }

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
    let k = 0;
    for (const it of this.items) {
      it.update(dt, t);
      if (it.wantsSmoke(dt)) this.effects.smoke(it.cx, it.model.height * 0.8, it.cz, 1);
      if (it.def.cashCap > 0 && it.cash >= 8 && k < 400) {
        const fill = Math.min(1, it.cash / it.cashCap);
        const y = it.model.height + 0.25 + Math.sin(t * 2.4 + it.uid) * 0.08 + (it.broken || it.isFull ? 0.55 : 0);
        const s = 0.55 + fill * 0.65;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 2.2 + it.uid);
        this.m4.compose(new THREE.Vector3(it.cx, y, it.cz), this.q, new THREE.Vector3(s, s, s));
        this.coinMesh.setMatrixAt(k, this.m4);
        if (it.isFull) this.col.setRGB(1.4, 0.55 + Math.sin(t * 8) * 0.3, 0.4);
        else this.col.setRGB(1, 1, 1);
        this.coinMesh.setColorAt(k, this.col);
        k++;
      }
    }
    this.coinMesh.count = k;
    this.coinMesh.instanceMatrix.needsUpdate = true;
    if (this.coinMesh.instanceColor) this.coinMesh.instanceColor.needsUpdate = true;
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
    return this.items.map((i) => i.serialize());
  }

  load(list: SavedItem[]): void {
    this.clear();
    for (const s of list) {
      let def: ItemDef;
      try {
        def = itemDef(s.id);
      } catch {
        continue;
      }
      if (!this.canPlace(def, s.tx, s.tz, s.rot).ok && def.layer !== 'floor') {
        // Keep saves robust: skip anything that no longer fits.
        const check = this.canPlaceLoose(def, s.tx, s.tz, s.rot);
        if (!check) continue;
      }
      const it = this.add(def, s.tx, s.tz, s.rot, s.color);
      it.level = Math.max(1, Math.min(5, s.level || 1));
      it.label = s.label ? String(s.label).slice(0, 14) : null;
      it.pendingXp = Math.max(0, Math.min(5000, Number(s.pxp) || 0));
      if (it.level > 1 || it.label) it.rebuildModel();
      it.cash = s.cash || 0;
      it.stats = Object.assign({ plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 }, s.stats);
      if (s.broken) it.broken = true;
    }
    this.recompute();
  }

  /** Occupancy-only check used when restoring saves. */
  private canPlaceLoose(def: ItemDef, tx: number, tz: number, rot: number): boolean {
    for (const [x, z] of footprintTiles(def, tx, tz, rot)) {
      if (!this.grid.isOwned(x, z)) return false;
      if (this.grid.occ[this.grid.idx(x, z)]) return false;
    }
    return true;
  }
}
