import * as THREE from 'three';
import { mat } from '../render/materials';

export interface Trash {
  id: number;
  x: number;
  z: number;
  floor: number;
  mesh: THREE.Object3D;
  claimedBy: number | null;
}

const cupGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.12, 10);
const canGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10);
const paperGeo = new THREE.IcosahedronGeometry(0.06, 0);
const cupMats = [mat(0xf4f1ea, { rough: 0.6 }), mat(0xc8102e, { rough: 0.5 })];
const canMats = [mat(0xc8102e, { metal: 0.6, rough: 0.3 }), mat(0x2fb8c9, { metal: 0.6, rough: 0.3 }), mat(0x3ddc84, { metal: 0.6, rough: 0.3 })];
const paperMat = mat(0xe8e2d0, { rough: 0.9, flat: true });

/** Litter dropped by guests. Dirty floors hurt mood and your star rating. */
export class TrashManager {
  readonly group = new THREE.Group();
  list: Trash[] = [];
  private nextId = 1;
  readonly max = 70;

  private viewFloor = 0;

  add(x: number, z: number, floor = 0): Trash | null {
    if (this.list.length >= this.max) return null;
    const kind = Math.floor(Math.random() * 3);
    let mesh: THREE.Mesh;
    if (kind === 0) {
      mesh = new THREE.Mesh(cupGeo, cupMats[Math.floor(Math.random() * cupMats.length)]);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.05;
    } else if (kind === 1) {
      mesh = new THREE.Mesh(canGeo, canMats[Math.floor(Math.random() * canMats.length)]);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.035;
    } else {
      mesh = new THREE.Mesh(paperGeo, paperMat);
      mesh.position.y = 0.04;
      mesh.scale.set(1, 0.6, 1.2);
    }
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.set(x, 0, z);
    holder.rotation.y = Math.random() * Math.PI * 2;
    holder.visible = floor === this.viewFloor;
    this.group.add(holder);
    const t: Trash = { id: this.nextId++, x, z, floor, mesh: holder, claimedBy: null };
    this.list.push(t);
    return t;
  }

  remove(t: Trash): void {
    t.mesh.removeFromParent();
    this.list = this.list.filter((o) => o !== t);
  }

  near(x: number, z: number, r: number, floor = 0): Trash[] {
    const r2 = r * r;
    return this.list.filter((t) => t.floor === floor && (t.x - x) ** 2 + (t.z - z) ** 2 <= r2);
  }

  countNear(x: number, z: number, r: number, floor = 0): number {
    const r2 = r * r;
    let n = 0;
    for (const t of this.list) if (t.floor === floor && (t.x - x) ** 2 + (t.z - z) ** 2 <= r2) n++;
    return n;
  }

  /** Only litter on the floor being looked at is drawn. */
  setViewFloor(floor: number): void {
    if (floor === this.viewFloor) return;
    this.viewFloor = floor;
    for (const t of this.list) t.mesh.visible = t.floor === floor;
  }

  clear(): void {
    for (const t of this.list) t.mesh.removeFromParent();
    this.list = [];
  }

  serialize(): [number, number, number][] {
    return this.list.map((t) => [Math.round(t.x * 100) / 100, Math.round(t.z * 100) / 100, t.floor]);
  }
}
