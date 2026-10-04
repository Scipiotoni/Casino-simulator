import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from '../render/materials';

/**
 * Bits shared by the parks, the lake and the forest: a spatial hash of things you can't walk
 * through, and batches of instanced trees (one draw call per part, however many trees).
 */

/** Solid circles and rectangles (global frame), looked up through a coarse grid. */
export class Obstacles {
  private cells = new Map<number, { x: number; z: number; r: number }[]>();
  private rects: [number, number, number, number][] = [];
  private static readonly CELL = 16;

  clear(): void {
    this.cells.clear();
    this.rects = [];
  }

  circle(x: number, z: number, r: number): void {
    const C = Obstacles.CELL;
    const c = { x, z, r };
    for (let ix = Math.floor((x - r) / C); ix <= Math.floor((x + r) / C); ix++) {
      for (let iz = Math.floor((z - r) / C); iz <= Math.floor((z + r) / C); iz++) {
        const k = (ix + 8192) * 16384 + iz + 8192;
        const l = this.cells.get(k) ?? [];
        l.push(c);
        this.cells.set(k, l);
      }
    }
  }

  rect(x0: number, x1: number, z0: number, z1: number): void {
    this.rects.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]);
  }

  blocked(x: number, z: number): boolean {
    for (const [a, b, c, d] of this.rects) if (x > a && x < b && z > c && z < d) return true;
    const C = Obstacles.CELL;
    const list = this.cells.get((Math.floor(x / C) + 8192) * 16384 + Math.floor(z / C) + 8192);
    if (!list) return false;
    for (const c of list) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true;
    return false;
  }
}

export type TreeKind = 'leafy' | 'pine' | 'palm' | 'birch';

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  shadow: boolean;
}

let parts: Record<TreeKind, Part[]> | null = null;

function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  for (const g of list) g.dispose();
  return out;
}

/** Shared geometry and materials for every kind of tree (unit size: ~5 m tall). */
function treeParts(): Record<TreeKind, Part[]> {
  if (parts) return parts;
  const bark = mat(0x6b4422, { rough: 0.9 });
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 2.4, 7);
  trunk.translate(0, 1.2, 0);
  const crownA = new THREE.IcosahedronGeometry(1.5, 1);
  crownA.translate(0, 3.2, 0);
  const crownB = new THREE.IcosahedronGeometry(1.05, 1);
  crownB.translate(0.6, 4.0, -0.3);
  const crownC = new THREE.IcosahedronGeometry(0.95, 1);
  crownC.translate(-0.55, 3.7, 0.45);
  const pineTrunk = new THREE.CylinderGeometry(0.12, 0.22, 2.0, 6);
  pineTrunk.translate(0, 1.0, 0);
  const pine = merged([0, 1, 2].map((i) => {
    const c = new THREE.ConeGeometry(1.9 - i * 0.5, 2.4, 8);
    c.translate(0, 2.2 + i * 1.35, 0);
    return c;
  }));
  const palmTrunk = new THREE.CylinderGeometry(0.15, 0.24, 6, 7, 4);
  palmTrunk.translate(0, 3, 0);
  const fronds = merged(Array.from({ length: 8 }, (_, i) => {
    const l = new THREE.SphereGeometry(0.4, 6, 4);
    l.scale(0.5, 0.14, 4.0);
    l.rotateX(0.5);
    l.translate(0, 0, 1.4);
    l.rotateY((i / 8) * Math.PI * 2);
    l.translate(0, 6, 0);
    return l;
  }));
  const birchTrunk = new THREE.CylinderGeometry(0.09, 0.14, 3.6, 6);
  birchTrunk.translate(0, 1.8, 0);
  const birchCrown = new THREE.IcosahedronGeometry(1.1, 1);
  birchCrown.scale(0.9, 1.5, 0.9);
  birchCrown.translate(0, 4.2, 0);
  parts = {
    leafy: [
      { geo: trunk, mat: bark, shadow: true },
      { geo: merged([crownA, crownB]), mat: mat(0x2f8f45, { rough: 0.8, flat: true }), shadow: true },
      { geo: crownC, mat: mat(0x3aa655, { rough: 0.8, flat: true }), shadow: true },
    ],
    pine: [
      { geo: pineTrunk, mat: mat(0x5a3a22, { rough: 0.9 }), shadow: true },
      { geo: pine, mat: mat(0x1f5a35, { rough: 0.85, flat: true }), shadow: true },
    ],
    palm: [
      { geo: palmTrunk, mat: mat(0x7a5232, { rough: 0.95 }), shadow: true },
      { geo: fronds, mat: mat(0x2f9a4a, { rough: 0.7, side: THREE.DoubleSide }), shadow: true },
    ],
    birch: [
      { geo: birchTrunk, mat: mat(0xe9e4da, { rough: 0.7 }), shadow: true },
      { geo: birchCrown, mat: mat(0x8cc152, { rough: 0.8, flat: true }), shadow: true },
    ],
  };
  return parts;
}

/** Collects trees, then turns them into a few instanced meshes. */
export class TreeBatch {
  private list: Record<TreeKind, THREE.Matrix4[]> = { leafy: [], pine: [], palm: [], birch: [] };

  add(kind: TreeKind, x: number, z: number, scale = 1, yaw = 0, y = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.scale(new THREE.Vector3(scale, scale * (0.9 + ((x * 7.13 + z * 3.7) % 1 + 1) % 1 * 0.25), scale));
    m.setPosition(x, y, z);
    this.list[kind].push(m);
  }

  get count(): number {
    return this.list.leafy.length + this.list.pine.length + this.list.palm.length + this.list.birch.length;
  }

  build(parent: THREE.Object3D, shadows = true, far = 420): void {
    const p = treeParts();
    for (const kind of Object.keys(this.list) as TreeKind[]) {
      const mats = this.list[kind];
      if (!mats.length) continue;
      for (const part of p[kind]) {
        const g = instancedChunks(part.geo, part.mat, mats, shadows && part.shadow, 120, far);
        if (g) parent.add(g);
      }
    }
  }
}

/** Generic instancing helper: one mesh for many copies of a shape. */
export function instances(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], shadow = true): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, m, mats.length);
  mats.forEach((x, i) => im.setMatrixAt(i, x));
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  parent.add(im);
  return im;
}

/** Every chunk made by `instancedChunks`, so the far ones can be skipped (global frame). */
const chunks: { mesh: THREE.InstancedMesh; x: number; z: number; r: number; far: number }[] = [];
let cullTick = 0;

/** Is this object still part of a scene? */
function attached(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p.parent) p = p.parent;
  return (p as THREE.Scene).isScene === true;
}

/**
 * Hide the chunks too far from (fx, fz) to matter (a lamp post a kilometre away is a
 * pixel, but still a draw call). Call once a frame with the camera's focus (global frame).
 */
export function cullChunks(fx: number, fz: number): void {
  if (++cullTick % 120 === 0) {
    // Chunks of a rebuilt city are gone from the scene: forget them.
    for (let i = chunks.length - 1; i >= 0; i--) if (!attached(chunks[i].mesh)) chunks.splice(i, 1);
  }
  for (const c of chunks) c.mesh.visible = Math.hypot(c.x - fx, c.z - fz) - c.r < c.far;
}

/**
 * Many copies of one shape split into chunks of the map, so whatever is off screen (or out of
 * the shadow camera), or further away than `far`, is skipped. Returns a group of instanced meshes.
 */
export function instancedChunks(geo: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], cast = false, chunk = 200, far = 320): THREE.Group | null {
  if (!mats.length) return null;
  const cells = new Map<string, THREE.Matrix4[]>();
  const p = new THREE.Vector3();
  for (const x of mats) {
    p.setFromMatrixPosition(x);
    const k = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
    const l = cells.get(k) ?? [];
    l.push(x);
    cells.set(k, l);
  }
  const g = new THREE.Group();
  for (const list of cells.values()) {
    const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((x, i) => im.setMatrixAt(i, x));
    im.computeBoundingSphere();
    im.castShadow = cast;
    im.receiveShadow = true;
    im.userData.sharedGeo = true;
    g.add(im);
    const bs = im.boundingSphere;
    if (bs && far < Infinity) chunks.push({ mesh: im, x: bs.center.x, z: bs.center.z, r: bs.radius, far });
  }
  return g;
}

/** A transform: position, yaw and (uniform or per-axis) scale. */
export function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.scale(new THREE.Vector3(sx, sy, sz));
  m.setPosition(x, y, z);
  return m;
}

/** Flat ground strips (paths, beaches) merged into one mesh: quads between two points with a width. */
export class Strips {
  private pos: number[] = [];
  private uv: number[] = [];

  /** A strip from a to b, `w` wide, at height y. */
  line(ax: number, az: number, bx: number, bz: number, w: number, y: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    const nx = (-(bz - az) / len) * (w / 2);
    const nz = ((bx - ax) / len) * (w / 2);
    const p = [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz];
    this.quad(p, y, len / 4, w / 4);
  }

  /** An axis-aligned rectangle. */
  rect(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.quad([x0, z0, x1, z0, x1, z1, x0, z1], y, (x1 - x0) / 4, (z1 - z0) / 4);
  }

  /** A flat disc (or ellipse) made of a fan of triangles. */
  disc(cx: number, cz: number, rx: number, rz: number, y: number, seg = 32): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const pts = [cx, cz, cx + Math.cos(a1) * rx, cz + Math.sin(a1) * rz, cx + Math.cos(a0) * rx, cz + Math.sin(a0) * rz];
      for (let k = 0; k < 3; k++) {
        this.pos.push(pts[k * 2], y, pts[k * 2 + 1]);
        this.uv.push(pts[k * 2] / 4, pts[k * 2 + 1] / 4);
      }
    }
  }

  private quad(p: number[], y: number, ul: number, vl: number): void {
    const uvs = [0, 0, ul, 0, ul, vl, 0, vl];
    // Face up whichever way round the corners came.
    const ny = (p[7] - p[1]) * (p[4] - p[0]) - (p[6] - p[0]) * (p[5] - p[1]);
    for (const i of ny >= 0 ? [0, 3, 2, 0, 2, 1] : [0, 2, 3, 0, 1, 2]) {
      this.pos.push(p[i * 2], y, p[i * 2 + 1]);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
    }
  }

  mesh(m: THREE.Material): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  }
}
