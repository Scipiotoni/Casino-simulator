import * as THREE from 'three';
import type { Game } from './game';
import { type ItemDef, footprintCenter, localPosToWorld, rotatedSize } from '../items/catalog';
import { buildModel } from '../items/models';
import type { ItemModel } from '../items/types';
import type { PlacedItem } from '../items/placedItem';
import { FLOOR_STYLES } from '../render/textures';
import { audio } from '../core/audio';
import { formatMoney } from '../core/math';
import { floorName } from './game';
import { WALL_STYLES } from '../world/walls';
import { WALL_H } from '../world/building';

export type Mode =
  | { kind: 'play' }
  | { kind: 'place'; def: ItemDef; rot: number; color: number; moving: PlacedItem | null }
  | { kind: 'paint'; style: number }
  | { kind: 'wall'; style: number; erase: boolean };

const MAX_WALL_RUN = 48;

/** Buying, moving and painting: ghost preview, validation and confirmation. */
export class BuildController {
  mode: Mode = { kind: 'play' };
  private ghost: ItemModel | null = null;
  private ghostMat = new THREE.MeshStandardMaterial({
    color: 0x3ddc84, transparent: true, opacity: 0.5, emissive: 0x3ddc84, emissiveIntensity: 0.35, depthWrite: false,
  });
  tile: [number, number] | null = null;
  valid = false;
  reason = '';
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private floorDirty = false;
  private lastPaint = '';
  private checkKey = '';

  /** Where a wall drag started (tile), and the line it covers now. */
  private wallStart: [number, number] | null = null;
  wallLine: [number, number][] = [];
  /** Total price of the wall line under the pointer (0 when erasing). */
  wallCost = 0;
  private wallPreview: THREE.InstancedMesh | null = null;
  private wallKey = '';
  private wallAbort = false;

  constructor(private g: Game) {}

  get active(): boolean {
    return this.mode.kind !== 'play';
  }

  /** World point under the pointer on the floor plane. */
  groundAt(px: number, py: number): THREE.Vector3 | null {
    const { w, h } = this.g.renderer.size;
    const ndc = new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.g.renderer.camera);
    return this.raycaster.ray.intersectPlane(this.plane, this.hit) ? this.hit.clone() : null;
  }

  startPlace(def: ItemDef, color?: number): void {
    this.cancel(false);
    this.mode = { kind: 'place', def, rot: this.lastRot, color: color ?? def.colors[0] ?? 0xffffff, moving: null };
    this.makeGhost();
    this.placeGhostNearPlayer();
    this.g.floor.showGrid(true);
    this.g.emitMode();
    audio.play('pop');
  }

  private lastRot = 0;

  startMove(item: PlacedItem): void {
    this.cancel(false);
    this.mode = { kind: 'place', def: item.def, rot: item.rot, color: item.color, moving: item };
    item.root.visible = false;
    this.makeGhost();
    this.tile = [item.tx, item.tz];
    this.checkKey = '';
    this.g.floor.showGrid(true);
    this.g.emitMode();
    audio.play('pop');
  }

  startPaint(style: number): void {
    this.cancel(false);
    this.mode = { kind: 'paint', style };
    this.g.floor.showGrid(true);
    this.g.emitMode();
  }

  startWall(style = 0, erase = false): void {
    this.cancel(false);
    this.mode = { kind: 'wall', style, erase };
    this.g.floor.showGrid(true);
    this.g.emitMode();
    audio.play('pop');
  }

  setWallStyle(style: number, erase = false): void {
    if (this.mode.kind !== 'wall') return;
    this.mode.style = style;
    this.mode.erase = erase;
    this.wallKey = '';
    this.g.emitMode();
  }

  setPaintStyle(style: number): void {
    if (this.mode.kind === 'paint') {
      this.mode.style = style;
      this.g.emitMode();
    }
  }

  /** The item being moved, if any. */
  get movingItem(): PlacedItem | null {
    return this.mode.kind === 'place' ? this.mode.moving : null;
  }

  cancel(emit = true): void {
    if (this.mode.kind === 'place' && this.mode.moving) this.mode.moving.root.visible = this.mode.moving.floor === this.g.viewFloor;
    this.disposeGhost();
    this.mode = { kind: 'play' };
    this.tile = null;
    this.wallStart = null;
    this.wallLine = [];
    if (this.wallPreview) this.wallPreview.visible = false;
    this.g.items.selection.hide();
    this.g.floor.showGrid(false);
    this.g.floor.showTileHighlight(null, null);
    if (emit) this.g.emitMode();
  }

  rotate(): void {
    if (this.mode.kind !== 'place' || this.mode.def.id === 'elevator') return;
    this.mode.rot = (this.mode.rot + 1) % 4;
    this.lastRot = this.mode.rot;
    this.checkKey = '';
    audio.play('rotate');
    if (this.tile) {
      // Keep the footprint centred on the same spot while it turns.
      const [w, d] = rotatedSize(this.mode.def, this.mode.rot);
      const [ow, od] = rotatedSize(this.mode.def, (this.mode.rot + 3) % 4);
      this.tile = [this.tile[0] + Math.round((ow - w) / 2), this.tile[1] + Math.round((od - d) / 2)];
    }
  }

  private makeGhost(): void {
    this.disposeGhost();
    if (this.mode.kind !== 'place') return;
    const d = this.mode.def;
    this.ghost = buildModel(d.model, { color: this.mode.color, level: 1, params: d.params ?? {}, statueLook: this.g.player.appearance });
    this.ghost.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.ghostMat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.ghost.root.renderOrder = 8;
    this.g.renderer.scene.add(this.ghost.root);
  }

  private disposeGhost(): void {
    if (this.ghost) {
      this.ghost.root.removeFromParent();
      this.ghost.dispose();
      this.ghost = null;
    }
  }

  private placeGhostNearPlayer(): void {
    if (this.mode.kind !== 'place') return;
    const p = this.g.player;
    const [w, d] = rotatedSize(this.mode.def, this.mode.rot);
    const fx = p.x + Math.sin(p.yaw) * 2.2;
    const fz = p.z + Math.cos(p.yaw) * 2.2;
    this.tile = [Math.round(fx - w / 2), Math.round(fz - d / 2)];
    this.checkKey = '';
  }

  /** Move the ghost so its footprint is centred on a world point. */
  aimAt(wx: number, wz: number): void {
    if (this.mode.kind !== 'place') return;
    const [w, d] = rotatedSize(this.mode.def, this.mode.rot);
    const t: [number, number] = [Math.round(wx - w / 2), Math.round(wz - d / 2)];
    if (!this.tile || t[0] !== this.tile[0] || t[1] !== this.tile[1]) {
      this.tile = t;
      this.checkKey = '';
    }
  }

  private evaluate(): void {
    if (this.mode.kind !== 'place' || !this.tile) return;
    const grid = this.g.gridAt(this.g.viewFloor);
    const key = `${this.tile[0]},${this.tile[1]},${this.mode.rot},${this.g.items.version},${grid.version},${this.g.viewFloor}`;
    if (key === this.checkKey) return;
    this.checkKey = key;
    const m = this.mode;
    // Moving works across floors: the item lands on whichever floor you're looking at.
    const check = m.def.id === 'elevator'
      ? this.g.items.canPlaceLift(this.tile[0], this.tile[1])
      : this.g.items.canPlace(m.def, this.g.viewFloor, this.tile[0], this.tile[1], m.rot, m.moving && m.moving.floor === this.g.viewFloor ? m.moving : undefined);
    const affordable = m.moving || this.g.money >= m.def.price;
    const zone = this.g.placeBlock(m.def);
    this.valid = check.ok && !!affordable && !zone;
    this.reason = zone ?? (!check.ok ? check.reason ?? 'Can’t place here' : !affordable ? `Need ${formatMoney(m.def.price)}` : '');
    const [w, d] = rotatedSize(m.def, m.rot);
    const color = this.valid ? 0x3ddc84 : 0xff4d5e;
    const seats = m.def.seats.map((s, i) => {
      const [x, z] = localPosToWorld(m.def, this.tile![0], this.tile![1], m.rot, s.pos[0], s.pos[1]);
      return { x, z, ok: check.seatOk ? check.seatOk[i] : true };
    });
    this.g.items.selection.show(this.tile[0], this.tile[1], this.tile[0] + w, this.tile[1] + d, color, seats);
    this.ghostMat.color.setHex(color);
    this.ghostMat.emissive.setHex(color);
    if (this.ghost) {
      const [cx, cz] = footprintCenter(m.def, this.tile[0], this.tile[1], m.rot);
      this.ghost.root.position.set(cx, 0.02, cz);
      this.ghost.root.rotation.y = (m.rot * Math.PI) / 2;
    }
  }

  confirm(): boolean {
    if (this.mode.kind !== 'place' || !this.tile) return false;
    this.checkKey = '';
    this.evaluate();
    const m = this.mode;
    if (!this.valid) {
      audio.play('error');
      this.g.notify(this.reason || 'Can’t place that here', 'bad');
      return false;
    }
    const [tx, tz] = this.tile;
    if (m.moving) {
      const item = m.moving;
      if (item.def.id === 'elevator') this.g.moveLift(tx, tz);
      else {
        const from = item.floor;
        this.g.items.move(item, tx, tz, m.rot, this.g.viewFloor);
        if (from !== item.floor) this.g.notify(`${item.def.name} moved to the ${floorName(item.floor).toLowerCase()}.`, 'good');
      }
      item.root.visible = true;
      this.g.afterLayoutChange();
      audio.play('place');
      this.g.effects.dust(item.cx, item.cz, 1.2);
      this.mode = { kind: 'play' };
      this.cancel();
      this.g.select({ kind: 'item', item });
      return true;
    }
    const item = this.g.purchase(m.def, tx, tz, m.rot, m.color);
    if (!item) return false;
    this.checkKey = '';
    if (this.g.money < m.def.price) {
      this.cancel();
    }
    return true;
  }

  update(): void {
    const input = this.g.input;
    if (this.mode.kind === 'place') {
      if (input.hit('KeyR')) this.rotate();
      if (!input.isTouch && input.pointer.over) {
        const p = this.groundAt(input.pointer.x, input.pointer.y);
        if (p) this.aimAt(p.x, p.z);
      }
      for (const c of input.clicks) {
        const p = this.groundAt(c.x, c.y);
        if (!p) continue;
        if (c.touch) {
          const m = this.mode;
          const [w, d] = rotatedSize(m.def, m.rot);
          const inside = this.tile && p.x >= this.tile[0] && p.x <= this.tile[0] + w && p.z >= this.tile[1] && p.z <= this.tile[1] + d;
          if (inside) this.confirm();
          else this.aimAt(p.x, p.z);
        } else {
          this.aimAt(p.x, p.z);
          this.confirm();
        }
        if (this.mode.kind !== 'place') break;
      }
      if (input.rightClicks > 0) this.cancel();
      this.evaluate();
      return;
    }
    if (this.mode.kind === 'wall') {
      this.updateWall();
      return;
    }
    if (this.mode.kind === 'paint') {
      const style = this.mode.style;
      if (input.rightClicks > 0) {
        this.cancel();
        return;
      }
      const p = input.pointer.over || input.isTouch ? this.groundAt(input.pointer.x, input.pointer.y) : null;
      const tx = p ? Math.floor(p.x) : null;
      const tz = p ? Math.floor(p.z) : null;
      const grid = this.g.gridAt(this.g.viewFloor);
      const owned = tx !== null && tz !== null && grid.isOwned(tx, tz);
      this.g.floor.showTileHighlight(owned ? tx : null, owned ? tz : null, 0x9fe8ff);
      const paintAt = (x: number, z: number) => {
        const key = `${x},${z}`;
        if (!grid.isOwned(x, z) || grid.getFloor(x, z) === style) return;
        const price = FLOOR_STYLES[style].price;
        if (this.g.money < price) {
          if (this.lastPaint !== 'broke') this.g.notify('Not enough cash to paint', 'bad');
          this.lastPaint = 'broke';
          return;
        }
        this.lastPaint = key;
        grid.setFloor(x, z, style);
        this.g.spend(price, 'paint');
        this.g.floorPainted++;
        this.floorDirty = true;
        audio.play('paint', { pitch: 0.9 + Math.random() * 0.3 });
      };
      if (input.primaryDown && owned) paintAt(tx!, tz!);
      for (const c of input.clicks) {
        const q = this.groundAt(c.x, c.y);
        if (q) paintAt(Math.floor(q.x), Math.floor(q.z));
      }
      if (this.floorDirty) {
        this.floorDirty = false;
        this.g.floor.rebuild();
      }
    }
  }

  // ------------------------------------------------------------------ walls

  /** Tiles from a to b in a straight line along whichever axis you dragged further. */
  private lineTiles(a: [number, number], b: [number, number]): [number, number][] {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const out: [number, number][] = [];
    if (Math.abs(dx) >= Math.abs(dz)) {
      const n = Math.min(MAX_WALL_RUN, Math.abs(dx));
      for (let k = 0; k <= n; k++) out.push([a[0] + Math.sign(dx) * k, a[1]]);
    } else {
      const n = Math.min(MAX_WALL_RUN, Math.abs(dz));
      for (let k = 0; k <= n; k++) out.push([a[0], a[1] + Math.sign(dz) * k]);
    }
    return out;
  }

  private updateWall(): void {
    const m = this.mode;
    if (m.kind !== 'wall') return;
    const input = this.g.input;
    if (input.rightClicks > 0) {
      if (this.wallStart) this.wallStart = null;
      else {
        this.cancel();
        return;
      }
    }
    // A two-finger pan or pinch isn't a wall.
    if (input.touchCount >= 2) {
      this.wallStart = null;
      this.wallAbort = true;
    }
    if (this.wallAbort) {
      if (input.touchCount === 0 && !input.primaryDown) this.wallAbort = false;
      this.wallLine = [];
      this.showWallPreview([]);
      return;
    }
    const p = input.pointer.over || input.isTouch ? this.groundAt(input.pointer.x, input.pointer.y) : null;
    const cur: [number, number] | null = p ? [Math.floor(p.x), Math.floor(p.z)] : null;
    if (input.primaryDown && cur && !this.wallStart) this.wallStart = cur;
    const line = this.wallStart && cur ? this.lineTiles(this.wallStart, cur) : cur ? [cur] : [];
    this.wallLine = line;
    this.showWallPreview(line);
    // Let go (or a quick tap/click) and the line is built.
    const tap = input.clicks.length > 0 && !this.wallStart;
    if ((this.wallStart && !input.primaryDown) || tap) {
      const tiles = tap ? (() => {
        const c = input.clicks[input.clicks.length - 1];
        const q = this.groundAt(c.x, c.y);
        return q ? [[Math.floor(q.x), Math.floor(q.z)] as [number, number]] : [];
      })() : line;
      this.wallStart = null;
      this.applyWall(tiles);
    }
  }

  private showWallPreview(line: [number, number][]): void {
    const m = this.mode;
    if (m.kind !== 'wall') return;
    const grid = this.g.gridAt(this.g.viewFloor);
    const key = `${line.map((t) => t.join(',')).join(';')}|${m.style}|${m.erase}|${grid.version}|${this.g.money > 0}`;
    if (key === this.wallKey) return;
    this.wallKey = key;
    if (!this.wallPreview) {
      const geo = new THREE.BoxGeometry(0.96, 1, 0.96);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), MAX_WALL_RUN + 1);
      mesh.renderOrder = 9;
      mesh.frustumCulled = false;
      this.wallPreview = mesh;
      this.g.renderer.scene.add(mesh);
    }
    const mesh = this.wallPreview;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    let cost = 0;
    let n = 0;
    const st = WALL_STYLES[m.style] ?? WALL_STYLES[0];
    const h = WALL_H * 0.42;
    for (const [x, z] of line) {
      let ok: boolean;
      if (m.erase) ok = grid.isWall(x, z);
      else {
        ok = this.g.items.canWall(this.g.viewFloor, x, z).ok;
        if (ok) cost += st.price;
        if (ok && cost > this.g.money) ok = false;
      }
      mtx.makeScale(1, m.erase ? h + 0.1 : h, 1).setPosition(x + 0.5, 0, z + 0.5);
      mesh.setMatrixAt(n, mtx);
      mesh.setColorAt(n, col.setHex(m.erase ? (ok ? 0xff4d5e : 0x777777) : ok ? 0x3ddc84 : 0xff4d5e));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = n > 0;
    this.wallCost = m.erase ? 0 : cost;
    this.g.events.emit('wallLine', undefined);
  }

  /** Build (or knock down) the walls along a line. */
  private applyWall(tiles: [number, number][]): void {
    const m = this.mode;
    if (m.kind !== 'wall' || !tiles.length) return;
    const f = this.g.viewFloor;
    const grid = this.g.gridAt(f);
    const st = WALL_STYLES[m.style] ?? WALL_STYLES[0];
    let built = 0;
    let reason = '';
    if (m.erase) {
      for (const [x, z] of tiles) {
        if (!grid.isWall(x, z)) continue;
        const old = WALL_STYLES[grid.wallAt(x, z)] ?? WALL_STYLES[0];
        grid.setWall(x, z, -1);
        this.g.addMoney(Math.round(old.price / 2), 'sell');
        built++;
      }
    } else {
      for (const [x, z] of tiles) {
        const c = this.g.items.canWall(f, x, z);
        if (!c.ok) {
          // Running into an existing wall is fine; anything else is worth saying.
          if (!grid.isWall(x, z)) reason ||= c.reason ?? '';
          continue;
        }
        if (this.g.money < st.price) {
          reason = `Need ${formatMoney(st.price)} for more wall`;
          break;
        }
        grid.setWall(x, z, m.style);
        this.g.spend(st.price, 'build');
        built++;
      }
    }
    if (built) {
      this.g.onWallsChanged(built, m.erase);
      audio.play(m.erase ? 'break' : 'place', { pitch: 0.9 + Math.random() * 0.2 });
      for (const [x, z] of tiles.slice(0, 6)) this.g.effects.dust(x + 0.5, z + 0.5, 0.6);
    }
    if (reason) {
      if (!built) audio.play('error');
      this.g.notify(reason, 'bad');
    }
    this.wallKey = '';
  }
}
