import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, chrome } from '../../render/materials';
import type { ItemModel, ModelCtx, ModelEvent } from '../types';

export interface BuildOpts {
  color: number;
  level: number;
  params: Record<string, string | number>;
  /** Appearance data for the golden statue. */
  statueLook?: unknown;
}

export function add<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x = 0, y = 0, z = 0): T {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return add(parent, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z);
}

export function rbox(parent: THREE.Object3D, w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return add(parent, new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rr), m), x, y, z);
}

export function cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  return add(parent, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y, z);
}

export function sph(parent: THREE.Object3D, r: number, m: THREE.Material, x = 0, y = 0, z = 0, ws = 16, hs = 12): THREE.Mesh {
  return add(parent, new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m), x, y, z);
}

export function plane(parent: THREE.Object3D, w: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return add(parent, new THREE.Mesh(new THREE.PlaneGeometry(w, h), m), x, y, z);
}

/** Flat plane lying on XZ (facing up). */
export function floorPlane(parent: THREE.Object3D, w: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  return add(parent, new THREE.Mesh(g, m), x, y, z);
}

export function stool(parent: THREE.Object3D, x: number, z: number, cushion: number, height = 0.56): void {
  const chromeM = chrome();
  cyl(parent, 0.17, 0.2, 0.025, chromeM, x, 0.013, z, 16);
  cyl(parent, 0.03, 0.03, height - 0.06, chromeM, x, (height - 0.06) / 2, z, 8);
  cyl(parent, 0.14, 0.14, 0.02, chromeM, x, height * 0.45, z, 14);
  const seat = cyl(parent, 0.19, 0.17, 0.08, mat(cushion, { rough: 0.45 }), x, height - 0.02, z, 18);
  seat.name = 'stool-seat';
}

/** Kept-alive references to parts that animate; everything else is merged at bake time. */
export class Dyn {
  readonly set = new Set<THREE.Object3D>();
  keep<T extends THREE.Object3D>(o: T): T {
    this.set.add(o);
    return o;
  }
}

function normalizeGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  }
  out.morphAttributes = {};
  return out;
}

/**
 * Merge every static mesh under `root` into one mesh per material. Keeps draw calls low
 * even with a hundred machines on the floor.
 */
export function bake(root: THREE.Group, dyn: Dyn): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === (root as unknown)) return;
    let p: THREE.Object3D | null = m;
    while (p && p !== root) {
      if (dyn.set.has(p)) return;
      p = p.parent;
    }
    if (Array.isArray(m.material)) return;
    const g = normalizeGeometry(m.geometry);
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(rel);
    const list = byMat.get(m.material) ?? [];
    list.push(g);
    byMat.set(m.material, list);
    remove.push(m);
  });
  for (const m of remove) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const [material, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = !(material as THREE.MeshStandardMaterial).transparent;
    mesh.receiveShadow = true;
    mesh.userData.baked = true;
    root.add(mesh);
  }
  // Dynamic parts still get shadows/receive flags.
  for (const o of dyn.set) {
    o.traverse((c) => {
      const cm = c as THREE.Mesh;
      if (cm.isMesh) {
        cm.castShadow = false;
        cm.receiveShadow = true;
      }
    });
  }
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
  });
}

/** Convenience base for simple models. */
export function simpleModel(
  root: THREE.Group,
  height: number,
  update?: (dt: number, ctx: ModelCtx) => void,
  event?: (ev: ModelEvent) => void,
  dispose?: () => void,
): ItemModel {
  return {
    root,
    height,
    update: update ?? (() => {}),
    event: event ?? (() => {}),
    dispose: () => {
      dispose?.();
      disposeTree(root);
    },
  };
}

export function shadeHex(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Animated chip stack shown on tables when a seat bets. */
export class ChipStacks {
  private stacks: THREE.Group[] = [];
  private static geo = new THREE.CylinderGeometry(0.055, 0.055, 0.022, 14);
  private static mats = [0xc8102e, 0x1f4fbf, 0x1e7a46, 0x17151f, 0xf2b632, 0x6a2cc2].map((c) => mat(c, { rough: 0.4 }));

  constructor(parent: THREE.Object3D, positions: [number, number, number][], dyn: Dyn) {
    for (const [x, y, z] of positions) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.visible = false;
      parent.add(g);
      dyn.keep(g);
      this.stacks.push(g);
    }
  }

  set(seat: number, amount: number): void {
    const g = this.stacks[seat];
    if (!g) return;
    while (g.children.length) g.remove(g.children[0]);
    if (amount <= 0) {
      g.visible = false;
      return;
    }
    const n = Math.max(1, Math.min(8, Math.round(Math.log2(amount + 1))));
    const colIdx = amount >= 200 ? 3 : amount >= 100 ? 4 : amount >= 50 ? 5 : amount >= 20 ? 2 : amount >= 10 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(ChipStacks.geo, ChipStacks.mats[(colIdx + (i % 3 === 2 ? 1 : 0)) % ChipStacks.mats.length]);
      c.userData.sharedGeo = true;
      c.position.set(i > 4 ? 0.07 : 0, 0.011 + (i > 4 ? i - 5 : i) * 0.023, 0);
      g.add(c);
    }
    g.visible = true;
  }

  clearAll(): void {
    for (let i = 0; i < this.stacks.length; i++) this.set(i, 0);
  }
}
