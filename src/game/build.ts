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

export type Mode =
  | { kind: 'play' }
  | { kind: 'place'; def: ItemDef; rot: number; color: number; moving: PlacedItem | null }
  | { kind: 'paint'; style: number };

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
    this.valid = check.ok && !!affordable;
    this.reason = !check.ok ? check.reason ?? 'Can’t place here' : !affordable ? `Need ${formatMoney(m.def.price)}` : '';
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
}
