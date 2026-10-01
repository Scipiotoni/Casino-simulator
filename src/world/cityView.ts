import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, glow } from '../render/materials';
import { asphaltTexture, canvasTexture, makeCanvas, sidewalkTexture } from '../render/textures';
import { disposeTree } from '../items/models/common';
import { CENTER_X, FACADE_Z, ROAD_MID } from './grid';
import {
  AVE_WALK, ROAD_HALF, STREET_NAMES, STREET_ROWS, avenueMid, avenueName, avenueX, blocksFor, cityX, cityZ, colX, hash01, streetZ,
} from './city';

/** Global x of the gun shop's door (column 1, north side of the Casino Strip). */
function colGallery(): number {
  return colX(1) + CENTER_X;
}

/** Lane offset from the centre line (drive on the right). */
const LANE = 2.2;
/** Half the width of a road (the box an intersection occupies). */
const BOX = ROAD_HALF;
/** Where a car's centre waits before an intersection. */
const STOP_AT = BOX + 2.8;
const LIGHT_CYCLE = 22;

type Axis = 'x' | 'z';

interface Turn {
  p0: THREE.Vector2;
  p1: THREE.Vector2;
  p2: THREE.Vector2;
  t: number;
  len: number;
  next: { axis: Axis; line: number; dir: 1 | -1; pos: number };
}

/** One car driving around the city (global frame). */
export class Car {
  readonly root = new THREE.Group();
  axis: Axis = 'x';
  line = 0;
  dir: 1 | -1 = 1;
  pos = 0;
  speed = 0;
  max = 9;
  turn: Turn | null = null;
  /** The intersection index (along this lane) the car already decided about. */
  decided = -999;
  /** Seconds the car stays stopped after being shot at (hazard lights on). */
  shaken = 0;
  honkT = 0;
  x = 0;
  z = 0;
  yaw = 0;
  readonly lights: THREE.Mesh;
  readonly hazard: THREE.Mesh;

  constructor(readonly kind: number, readonly color: number) {
    const proto = carProto(kind);
    const paint = mat(color, { rough: 0.25, metal: 0.55 });
    const body = new THREE.Mesh(proto.paint, paint);
    body.castShadow = true;
    this.root.add(body, new THREE.Mesh(proto.dark, mat(0x15141a, { rough: 0.3, metal: 0.4 })), new THREE.Mesh(proto.trim, mat(0xd8d8e0, { rough: 0.25, metal: 0.8 })));
    this.lights = new THREE.Mesh(proto.lights, glow(0xfff2c8, 2.2));
    this.hazard = new THREE.Mesh(proto.rear, glow(0xff8a1f, 2.4));
    this.hazard.visible = false;
    this.root.add(this.lights, new THREE.Mesh(proto.rear, glow(0xff2a2a, 1.4)), this.hazard);
    this.max = [9, 8, 7, 12, 6][kind] ?? 9;
    this.length = kind === 4 ? 8.5 : 4.2;
  }

  readonly length: number;
}

/** Shared geometry per car type, split by material: paint, dark glass/tyres, chrome, lamps. */
const protoCache = new Map<number, { paint: THREE.BufferGeometry; dark: THREE.BufferGeometry; trim: THREE.BufferGeometry; lights: THREE.BufferGeometry; rear: THREE.BufferGeometry }>();
function carProto(kind: number) {
  const hit = protoCache.get(kind);
  if (hit) return hit;
  const paint: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const lights: THREE.BufferGeometry[] = [];
  const rear: THREE.BufferGeometry[] = [];
  const bx = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    list.push(g);
  };
  // Cars face +z (front at +z).
  // 0 sedan, 1 taxi (sedan + roof sign), 2 van, 3 sports car, 4 bus
  const L = kind === 4 ? 8.5 : kind === 2 ? 4.4 : kind === 3 ? 4.1 : 4.2;
  const W = kind === 4 ? 2.4 : 1.8;
  const bodyH = kind === 4 ? 2.4 : kind === 2 ? 1.7 : kind === 3 ? 0.55 : 0.7;
  const base = 0.35;
  bx(paint, W, bodyH, L, 0, base + bodyH / 2, 0);
  if (kind === 0 || kind === 1) {
    bx(paint, W * 0.86, 0.55, L * 0.5, 0, base + bodyH + 0.27, -0.2);
    bx(dark, W * 0.88, 0.42, L * 0.46, 0, base + bodyH + 0.26, -0.2);
  } else if (kind === 3) {
    bx(paint, W * 0.8, 0.42, L * 0.38, 0, base + bodyH + 0.2, -0.35);
    bx(dark, W * 0.82, 0.32, L * 0.36, 0, base + bodyH + 0.2, -0.35);
    bx(paint, W, 0.08, 0.5, 0, base + bodyH + 0.35, -L / 2 + 0.3);
  } else if (kind === 2) {
    bx(dark, W + 0.02, 0.6, 0.9, 0, base + bodyH - 0.4, L / 2 - 0.5);
    bx(dark, W + 0.02, 0.5, L * 0.5, 0, base + bodyH - 0.4, -0.3);
  } else {
    for (let i = 0; i < 6; i++) bx(dark, W + 0.02, 0.8, 1.0, 0, base + 1.6, -L / 2 + 1 + i * 1.25);
    bx(dark, W * 0.9, 1.2, 0.05, 0, base + 1.5, L / 2 + 0.01);
  }
  if (kind === 1) {
    bx(lights, 0.7, 0.22, 0.3, 0, base + bodyH + 0.66, -0.2);
  }
  // Wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
    g.rotateZ(Math.PI / 2);
    g.translate(sx * (W / 2 - 0.08), 0.36, sz * (L / 2 - (kind === 4 ? 1.4 : 0.85)));
    dark.push(g);
    const hub = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10);
    hub.rotateZ(Math.PI / 2);
    hub.translate(sx * (W / 2 - 0.07), 0.36, sz * (L / 2 - (kind === 4 ? 1.4 : 0.85)));
    trim.push(hub);
  }
  // Bumpers, lamps
  bx(trim, W + 0.04, 0.16, 0.12, 0, base + 0.1, L / 2 + 0.04);
  bx(trim, W + 0.04, 0.16, 0.12, 0, base + 0.1, -L / 2 - 0.04);
  for (const sx of [-1, 1]) {
    bx(lights, 0.34, 0.16, 0.06, sx * (W / 2 - 0.3), base + bodyH * 0.6, L / 2 + 0.02);
    bx(rear, 0.34, 0.14, 0.06, sx * (W / 2 - 0.3), base + bodyH * 0.6, -L / 2 - 0.02);
  }
  const m = (list: THREE.BufferGeometry[]) => {
    const out = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    for (const g of list) g.dispose();
    return out;
  };
  const p = { paint: m(paint), dark: m(dark), trim: m(trim), lights: m(lights), rear: m(rear) };
  protoCache.set(kind, p);
  return p;
}

const CAR_COLORS = [0xc8102e, 0x1f4fbf, 0xe9e1d3, 0x17151f, 0x2b2b35, 0x1e7a46, 0x9aa0ab, 0x6a2cc2, 0xff8a1f, 0x7ff3ff];

export type TargetKind = 'can' | 'bottle' | 'balloon';

/** Something to shoot at on the sidewalk: knocked flying, smashed or popped, then put back. */
export interface Target {
  kind: TargetKind;
  home: THREE.Vector3;
  mesh: THREE.Object3D;
  alive: boolean;
  /** Seconds until it's back (after a hit). */
  back: number;
  flying: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

const BALLOON_COLORS = [0xff4d4d, 0xffc53d, 0x2fe6ff, 0x39ff88, 0xff6fb5, 0xb77bff];

/** Quad builder in world units (uv = world / uvScale) so tiling textures line up everywhere. */
class Quads {
  pos: number[] = [];
  uv: number[] = [];
  constructor(private uvScale = 1) {}
  add(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const s = this.uvScale;
    const a = [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
    this.pos.push(...a);
    for (let i = 0; i < 6; i++) this.uv.push(a[i * 3] / s, -a[i * 3 + 2] / s);
  }
  mesh(m: THREE.Material): THREE.Mesh {
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

function instanced(geo: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[]): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, m, mats.length);
  mats.forEach((x, i) => im.setMatrixAt(i, x));
  im.frustumCulled = false;
  return im;
}

const signCache = new Map<string, THREE.CanvasTexture>();
function signTexture(text: string): THREE.CanvasTexture {
  const hit = signCache.get(text);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.fillStyle = '#1d6b3e';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#f4f1ea';
  ctx.lineWidth = 4;
  ctx.strokeRect(5, 5, 246, 54);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '800 30px Nunito, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), 128, 34, 236);
  const t = canvasTexture(canvas);
  signCache.set(text, t);
  return t;
}

/**
 * The city's roads drawn in the global frame: streets and avenues with sidewalks, curbs,
 * lane markings, crosswalks, street lamps, trees, traffic lights, name signs and cars.
 */
export class CityView {
  readonly group = new THREE.Group();
  private statics = new THREE.Group();
  private cars: Car[] = [];
  /** Parked or driven player cars the traffic must stop for (global). */
  obstacles: { x: number; z: number }[] = [];
  private carGroup = new THREE.Group();
  private litLamps: THREE.InstancedMesh | null = null;
  private heads: { x: number; z: number; yaw: number; axis: Axis }[] = [];
  private lightT = 0;
  private lastPhase = -1;
  private cols = 0;
  /** Where the player stands (global), so cars stop for them. */
  player = { x: -9999, z: -9999 };
  readonly targets: Target[] = [];
  private targetGroup = new THREE.Group();
  /** A car got shot: the game plays the alarm. */
  onCarHit: ((c: Car) => void) | null = null;
  onHonk: ((c: Car) => void) | null = null;

  constructor() {
    this.group.add(this.statics, this.carGroup, this.targetGroup);
  }

  /** Tin cans and bottles on crates along the sidewalks, and a shooting gallery outside the gun shop. */
  private buildTargets(cols: number, crates: THREE.Matrix4[]): void {
    for (const t of this.targets) t.mesh.removeFromParent();
    this.targets.length = 0;
    const can = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12);
    const bottle = new THREE.CylinderGeometry(0.035, 0.07, 0.32, 10);
    const balloon = new THREE.SphereGeometry(0.28, 14, 10);
    balloon.scale(1, 1.2, 1);
    const add = (kind: TargetKind, x: number, y: number, z: number, color: number) => {
      const geo = kind === 'can' ? can : kind === 'bottle' ? bottle : balloon;
      const m = new THREE.Mesh(geo, kind === 'bottle'
        ? mat(color, { rough: 0.1, metal: 0.1, transparent: true, opacity: 0.8 })
        : kind === 'balloon' ? mat(color, { rough: 0.25, emissive: color, emissiveIntensity: 0.25 }) : mat(color, { rough: 0.3, metal: 0.8 }));
      m.userData.sharedGeo = true;
      m.position.set(x, y, z);
      this.targetGroup.add(m);
      this.targets.push({ kind, home: new THREE.Vector3(x, y, z), mesh: m, alive: true, back: 0, flying: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    };
    const crate = (x: number, z: number, seed: number) => {
      const m = new THREE.Matrix4().makeRotationY(hash01(seed) * 0.4 - 0.2);
      m.setPosition(x, 0.3, z);
      crates.push(m);
      for (let i = 0; i < 3; i++) {
        const bx = x - 0.32 + i * 0.32;
        if (hash01(seed + i) < 0.65) add('can', bx, 0.7, z, [0xc8102e, 0x9aa0ab, 0x1f4fbf, 0x1e7a46][Math.floor(hash01(seed * 3 + i) * 4)]);
        else add('bottle', bx, 0.76, z, [0x2f8f45, 0x8a5a2e, 0x7ff3ff][Math.floor(hash01(seed * 5 + i) * 3)]);
      }
    };
    // A crate of cans every block, on both sidewalks of every street.
    for (let r = 0; r < STREET_ROWS; r++) {
      const zc = streetZ(r);
      for (let k = 0; k < blocksFor(cols); k++) {
        const [, a1] = avenueX(k);
        crate(a1 + 9, zc - BOX - 2.3, r * 97 + k * 7);
        crate(a1 + 28, zc + BOX + 2.3, r * 97 + k * 7 + 3);
      }
    }
    // Shooting gallery right outside Bullseye Guns (lot column 1, north side of the Strip).
    const gx = colGallery();
    for (let i = 0; i < 3; i++) crate(gx - 6 + i * 1.3, FACADE_Z + 2.6, 900 + i * 11);
    for (let i = 0; i < 3; i++) crate(gx + 4 + i * 1.3, FACADE_Z + 2.6, 950 + i * 11);
    for (let i = 0; i < 5; i++) add('balloon', gx - 2 + i * 1, 2.2 + (i % 2) * 0.35, FACADE_Z + 3.2, BALLOON_COLORS[i % BALLOON_COLORS.length]);
  }

  /** First target a bullet hits along a ray (global frame), within `range`. */
  raycastTargets(ox: number, oz: number, dx: number, dz: number, range: number): { target: Target; t: number } | null {
    let best: { target: Target; t: number } | null = null;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      const px = tg.home.x - ox;
      const pz = tg.home.z - oz;
      const t = px * dx + pz * dz;
      if (t < 0 || t > range) continue;
      const d = Math.hypot(px - dx * t, pz - dz * t);
      const r = tg.kind === 'balloon' ? 0.42 : 0.2;
      if (d < r && (!best || t < best.t)) best = { target: tg, t };
    }
    return best;
  }

  /** Knock a target over (cans fly, bottles smash, balloons pop); it comes back later. */
  hitTarget(tg: Target, dx: number, dz: number): void {
    tg.alive = false;
    tg.back = 25 + Math.random() * 10;
    if (tg.kind === 'can') {
      tg.flying = 1.4;
      tg.vel.set(dx * 5 + (Math.random() - 0.5), 3.5 + Math.random() * 2, dz * 5 + (Math.random() - 0.5));
      tg.spin.set(Math.random() * 14 - 7, Math.random() * 6, Math.random() * 14 - 7);
    } else tg.mesh.visible = false;
  }

  private updateTargets(dt: number): void {
    for (const tg of this.targets) {
      if (tg.flying > 0) {
        tg.flying -= dt;
        tg.vel.y -= 14 * dt;
        tg.mesh.position.addScaledVector(tg.vel, dt);
        if (tg.mesh.position.y < 0.07) {
          tg.mesh.position.y = 0.07;
          tg.vel.multiplyScalar(0.4);
          tg.vel.y = Math.abs(tg.vel.y) * 0.5;
        }
        tg.mesh.rotation.x += tg.spin.x * dt;
        tg.mesh.rotation.z += tg.spin.z * dt;
        if (tg.flying <= 0) tg.mesh.visible = false;
      }
      if (!tg.alive) {
        tg.back -= dt;
        if (tg.back <= 0) {
          tg.alive = true;
          tg.mesh.visible = true;
          tg.mesh.position.copy(tg.home);
          tg.mesh.rotation.set(0, 0, 0);
        }
      } else if (tg.kind === 'balloon') {
        tg.mesh.position.y = tg.home.y + Math.sin(this.lightT * 1.7 + tg.home.x) * 0.08;
      }
    }
  }

  build(cols: number): void {
    this.cols = cols;
    this.statics.removeFromParent();
    disposeTree(this.statics);
    this.statics = new THREE.Group();
    this.group.add(this.statics);
    const s = this.statics;
    const [x0, x1] = cityX(cols);
    const [z0, z1] = cityZ();
    const nb = blocksFor(cols);
    const asphalt = new Quads(2);
    const walk = new Quads(1);
    const white = new Quads(4);
    const yellow = new Quads(4);
    const curbs: THREE.Matrix4[] = [];
    const curbGeo = new THREE.BoxGeometry(1, 0.14, 0.22);
    const curbAlong = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) return;
      const m = new THREE.Matrix4().makeRotationY(Math.abs(bx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2);
      m.scale(new THREE.Vector3(len, 1, 1));
      m.setPosition((ax + bx) / 2, 0.07, (az + bz) / 2);
      curbs.push(m);
    };
    const roadZ = (r: number): [number, number] => [streetZ(r) - BOX, streetZ(r) + BOX];
    const aves = Array.from({ length: nb + 1 }, (_, k) => avenueX(k));
    // Streets: road and both sidewalks across the whole city.
    for (let r = 0; r < STREET_ROWS; r++) {
      const [ra, rb] = roadZ(r);
      asphalt.add(x0, ra, x1, rb, -0.01);
      const nA = FACADE_Z + (streetZ(r) - ROAD_MID);
      walk.add(x0, nA, x1, ra, 0.002);
      walk.add(x0, rb, x1, 2 * streetZ(r) - nA, 0.002);
      // Curbs, broken where the avenues cross.
      let cx = x0;
      for (const [a, b] of aves) {
        const ra0 = a + AVE_WALK;
        const rb0 = b - AVE_WALK;
        if (ra0 > cx) {
          curbAlong(cx, ra, ra0, ra);
          curbAlong(cx, rb, ra0, rb);
        }
        cx = rb0;
      }
      if (x1 > cx) {
        curbAlong(cx, ra, x1, ra);
        curbAlong(cx, rb, x1, rb);
      }
      // Centre dashes and edge lines, skipping intersections.
      for (let x = x0 + 1; x < x1 - 1; x += 3) {
        if (aves.some(([a, b]) => x > a + AVE_WALK - 1 && x < b - AVE_WALK + 1)) continue;
        yellow.add(x, streetZ(r) - 0.08, x + 1.6, streetZ(r) + 0.08, 0.004);
      }
    }
    // Avenues: road and sidewalks in the gaps between the streets.
    const gaps: [number, number][] = [];
    let za = z0;
    for (let r = 0; r < STREET_ROWS; r++) {
      const [ra, rb] = roadZ(r);
      gaps.push([za, ra]);
      za = rb;
    }
    gaps.push([za, z1]);
    for (const [a, b] of aves) {
      const ra0 = a + AVE_WALK;
      const rb0 = b - AVE_WALK;
      for (const [ga, gb] of gaps) {
        asphalt.add(ra0, ga, rb0, gb, -0.011);
        walk.add(a, ga, ra0, gb, 0.001);
        walk.add(rb0, ga, b, gb, 0.001);
        curbAlong(ra0, ga, ra0, gb);
        curbAlong(rb0, ga, rb0, gb);
        for (let z = ga + 1; z < gb - 2; z += 3) yellow.add((a + b) / 2 - 0.08, z, (a + b) / 2 + 0.08, z + 1.6, 0.004);
      }
    }
    // Crosswalks and stop lines at every intersection.
    for (let r = 0; r < STREET_ROWS; r++) {
      const zc = streetZ(r);
      for (const [a, b] of aves) {
        const xc = (a + b) / 2;
        const rw = (b - a) / 2 - AVE_WALK;
        for (const sx of [-1, 1]) {
          // Zebra across the street, just outside the avenue box
          const xs = xc + sx * (rw + 1.3);
          for (let z = zc - BOX + 0.4; z < zc + BOX - 0.4; z += 1.0) white.add(xs - 0.9, z, xs + 0.9, z + 0.55, 0.005);
          // Stop line
          const xl = xc + sx * (rw + 2.6);
          white.add(xl - 0.15, sx > 0 ? zc - BOX + 0.2 : zc, xl + 0.15, sx > 0 ? zc : zc + BOX - 0.2, 0.005);
        }
        for (const sz of [-1, 1]) {
          const zs = zc + sz * (BOX + 1.3);
          for (let x = xc - rw + 0.4; x < xc + rw - 0.4; x += 1.0) white.add(x, zs - 0.9, x + 0.55, zs + 0.9, 0.005);
          const zl = zc + sz * (BOX + 2.6);
          white.add(sz > 0 ? xc : xc - rw + 0.2, zl - 0.15, sz > 0 ? xc + rw - 0.2 : xc, zl + 0.15, 0.005);
        }
      }
    }
    const asph = asphaltTexture();
    const swTex = sidewalkTexture();
    s.add(
      asphalt.mesh(mat(0xffffff, { map: asph, rough: 0.95 })),
      walk.mesh(mat(0xffffff, { map: swTex, rough: 0.9 })),
      white.mesh(mat(0xf4f1ea, { rough: 0.6, emissive: 0x302c28, emissiveIntensity: 0.4 })),
      yellow.mesh(mat(0xffd23f, { emissive: 0x6b5200, emissiveIntensity: 0.4 })),
    );
    const cm = instanced(curbGeo, mat(0xb9b4c2, { rough: 0.8 }), curbs);
    if (cm) s.add(cm);

    // Street furniture: lamps, trees, hydrants, benches, bins along every sidewalk.
    const lamps: THREE.Matrix4[] = [];
    const trees: THREE.Matrix4[] = [];
    const benches: THREE.Matrix4[] = [];
    const hydrants: THREE.Matrix4[] = [];
    const bins: THREE.Matrix4[] = [];
    const place = (list: THREE.Matrix4[], x: number, z: number, yaw: number, sc = 1) => {
      const m = new THREE.Matrix4().makeRotationY(yaw);
      if (sc !== 1) m.scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(x, 0, z);
      list.push(m);
    };
    const inAve = (x: number, pad = 0) => aves.some(([a, b]) => x > a - pad && x < b + pad);
    const inStreet = (z: number, pad = 0) => {
      for (let r = 0; r < STREET_ROWS; r++) {
        const zc = streetZ(r);
        if (z > zc - BOX - 4.5 - pad && z < zc + BOX + 4.5 + pad) return true;
      }
      return false;
    };
    for (let r = 0; r < STREET_ROWS; r++) {
      const zc = streetZ(r);
      let i = 0;
      for (let x = x0 + 6; x < x1 - 6; x += 7, i++) {
        if (inAve(x, 2)) continue;
        for (const side of [-1, 1]) {
          const z = zc + side * (BOX + 0.85);
          const yaw = side < 0 ? 0 : Math.PI;
          const k = hash01(r * 1000 + i * 2 + (side > 0 ? 1 : 0));
          if (i % 2 === 0) place(lamps, x, z, yaw);
          else if (k < 0.55) place(trees, x, z, k * 6, 0.85 + k * 0.4);
          else if (k < 0.7) place(benches, x, zc + side * (BOX + 2.4), side < 0 ? Math.PI : 0);
          else if (k < 0.82) place(bins, x, z, 0);
          else place(hydrants, x, z, 0);
        }
      }
    }
    for (const [a, b] of aves) {
      let i = 0;
      for (let z = z0 + 6; z < z1 - 6; z += 7, i++) {
        if (inStreet(z, 2)) continue;
        for (const side of [-1, 1]) {
          const x = side < 0 ? a + AVE_WALK - 0.85 : b - AVE_WALK + 0.85;
          const k = hash01(Math.round(a) * 31 + i * 2 + (side > 0 ? 1 : 0));
          if (i % 2 === 0) place(lamps, x, z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
          else if (k < 0.6) place(trees, x, z, k * 6, 0.85 + k * 0.4);
          else if (k < 0.75) place(hydrants, x, z, 0);
          else place(bins, x, z, 0);
        }
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8);
    poleGeo.translate(0, 2.1, 0);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.1);
    armGeo.translate(0, 4.1, 0.5);
    const headGeo = new THREE.SphereGeometry(0.22, 12, 8);
    headGeo.scale(1, 0.6, 1.3);
    headGeo.translate(0, 4.0, 1.0);
    const poleMat = mat(0x5b5668, { metal: 0.6, rough: 0.4 });
    for (const [geo, m] of [[poleGeo, poleMat], [armGeo, poleMat], [headGeo, glow(0xffe2a8, 2.6)]] as const) {
      const im = instanced(geo, m, lamps);
      if (im) s.add(im);
    }
    const trunk = new THREE.CylinderGeometry(0.1, 0.16, 2.2, 8);
    trunk.translate(0, 1.1, 0);
    const crown = new THREE.IcosahedronGeometry(1.1, 1);
    crown.translate(0, 2.7, 0);
    const crown2 = new THREE.IcosahedronGeometry(0.75, 1);
    crown2.translate(0.35, 3.4, -0.2);
    const pit = new THREE.BoxGeometry(1.2, 0.08, 1.2);
    pit.translate(0, 0.04, 0);
    for (const [geo, m] of [[trunk, mat(0x6b4422, { rough: 0.9 })], [crown, mat(0x2f8f45, { rough: 0.8, flat: true })], [crown2, mat(0x3aa655, { rough: 0.8, flat: true })], [pit, mat(0x3a2a1c, { rough: 1 })]] as const) {
      const im = instanced(geo, m, trees);
      if (im) {
        im.castShadow = geo !== pit;
        s.add(im);
      }
    }
    const benchSeat = new THREE.BoxGeometry(1.6, 0.08, 0.45);
    benchSeat.translate(0, 0.45, 0);
    const benchBack = new THREE.BoxGeometry(1.6, 0.4, 0.06);
    benchBack.translate(0, 0.72, -0.22);
    const benchLegs = new THREE.BoxGeometry(1.5, 0.45, 0.4);
    benchLegs.translate(0, 0.22, 0);
    for (const [geo, m] of [[benchSeat, mat(0x8a5a2e, { rough: 0.8 })], [benchBack, mat(0x8a5a2e, { rough: 0.8 })], [benchLegs, mat(0x2b2b35, { metal: 0.6, rough: 0.5 })]] as const) {
      const im = instanced(geo, m, benches);
      if (im) s.add(im);
    }
    const hyd = new THREE.CylinderGeometry(0.14, 0.17, 0.6, 10);
    hyd.translate(0, 0.3, 0);
    const hydTop = new THREE.SphereGeometry(0.15, 10, 6);
    hydTop.translate(0, 0.62, 0);
    for (const [geo, m] of [[hyd, mat(0xd62a2a, { rough: 0.5 })], [hydTop, mat(0xd62a2a, { rough: 0.5 })]] as const) {
      const im = instanced(geo, m, hydrants);
      if (im) s.add(im);
    }
    const bin = new THREE.CylinderGeometry(0.24, 0.2, 0.8, 12);
    bin.translate(0, 0.4, 0);
    const im = instanced(bin, mat(0x2e5a3e, { rough: 0.6, metal: 0.3 }), bins);
    if (im) s.add(im);

    // Traffic lights: one signal head per approach at every intersection.
    this.heads = [];
    const sigPole: THREE.Matrix4[] = [];
    for (let r = 0; r < STREET_ROWS; r++) {
      const zc = streetZ(r);
      for (const [a, b] of aves) {
        const xc = (a + b) / 2;
        const hw = (b - a) / 2 - AVE_WALK + 0.6;
        // Corner poles; each faces traffic coming towards it on one axis.
        // Far-side signals, each facing the traffic coming towards it.
        const corners: { x: number; z: number; yaw: number; axis: Axis }[] = [
          { x: xc + hw, z: zc + BOX + 0.6, yaw: Math.PI / 2, axis: 'x' }, // eastbound
          { x: xc - hw, z: zc - BOX - 0.6, yaw: -Math.PI / 2, axis: 'x' }, // westbound
          { x: xc - hw, z: zc + BOX + 0.6, yaw: 0, axis: 'z' }, // southbound
          { x: xc + hw, z: zc - BOX - 0.6, yaw: Math.PI, axis: 'z' }, // northbound
        ];
        for (const c of corners) {
          const m = new THREE.Matrix4().makeRotationY(c.yaw);
          m.setPosition(c.x, 0, c.z);
          sigPole.push(m);
          this.heads.push(c);
        }
      }
    }
    const spole = new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8);
    spole.translate(0, 1.7, 0);
    const sbox = new THREE.BoxGeometry(0.42, 1.2, 0.3);
    sbox.translate(0, 3.0, 0);
    const lensGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12);
    lensGeo.rotateX(Math.PI / 2);
    const lensMats: THREE.Matrix4[] = [];
    for (const m of sigPole) {
      for (const y of [3.38, 3.0, 2.62]) {
        const l = new THREE.Matrix4().makeTranslation(0, y, -0.17);
        lensMats.push(m.clone().multiply(l));
      }
    }
    for (const [geo, m, list] of [[spole, mat(0x2b2b35, { metal: 0.5, rough: 0.5 }), sigPole], [sbox, mat(0x1a1a20, { rough: 0.6 }), sigPole], [lensGeo, mat(0x2a2a30, { rough: 0.3 }), lensMats]] as const) {
      const x = instanced(geo, m, list);
      if (x) s.add(x);
    }
    const litGeo = new THREE.SphereGeometry(0.13, 10, 8);
    litGeo.scale(1, 1, 0.4);
    this.litLamps = new THREE.InstancedMesh(litGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.heads.length);
    this.litLamps.frustumCulled = false;
    for (let i = 0; i < this.heads.length; i++) this.litLamps.setColorAt(i, new THREE.Color(0xff2a2a));
    s.add(this.litLamps);
    this.lastPhase = -1;

    // Street-name signs on one corner of every intersection.
    for (let r = 0; r < STREET_ROWS; r++) {
      const zc = streetZ(r);
      aves.forEach(([a, b], k) => {
        const x = b - AVE_WALK + 2.2;
        const z = zc - BOX - 2.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 6), poleMat);
        pole.position.set(x, 1.65, z);
        s.add(pole);
        const st = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshStandardMaterial({ map: signTexture(STREET_NAMES[r] ?? 'Street'), side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: signTexture(STREET_NAMES[r] ?? 'Street') }));
        st.position.set(x + 0.9, 3.1, z);
        s.add(st);
        const av = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshStandardMaterial({ map: signTexture(avenueName(k)), side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: signTexture(avenueName(k)) }));
        av.rotation.y = Math.PI / 2;
        av.position.set(x, 2.6, z - 0.9);
        s.add(av);
      });
    }
    const crates: THREE.Matrix4[] = [];
    this.buildTargets(cols, crates);
    const crateGeo = new THREE.BoxGeometry(1.1, 0.6, 0.6);
    const cr = instanced(crateGeo, mat(0x9a6a3c, { rough: 0.85 }), crates);
    if (cr) s.add(cr);
    this.spawnCars();
  }

  private spawnCars(): void {
    for (const c of this.cars) c.root.removeFromParent();
    this.cars = [];
    const n = 14 + STREET_ROWS * 4 + blocksFor(this.cols) * 2;
    for (let i = 0; i < n; i++) {
      const kind = i % 9 === 0 ? 4 : i % 5 === 0 ? 1 : i % 7 === 0 ? 3 : i % 4 === 0 ? 2 : 0;
      const car = new Car(kind, kind === 1 ? 0xffc21a : kind === 4 ? 0x2fb8c9 : CAR_COLORS[i % CAR_COLORS.length]);
      this.respawn(car, true);
      this.cars.push(car);
      this.carGroup.add(car.root);
    }
  }

  /** Put a car on a random lane (at its starting end, or anywhere along it at first). */
  private respawn(c: Car, anywhere: boolean): void {
    const nb = blocksFor(this.cols);
    const [x0, x1] = cityX(this.cols);
    const [z0, z1] = cityZ();
    c.turn = null;
    c.decided = -999;
    c.speed = c.max * 0.6;
    c.dir = Math.random() < 0.5 ? 1 : -1;
    if (Math.random() < 0.6) {
      c.axis = 'x';
      c.line = Math.floor(Math.random() * STREET_ROWS);
      c.pos = anywhere ? x0 + 6 + Math.random() * (x1 - x0 - 12) : c.dir > 0 ? x0 + 2 : x1 - 2;
    } else {
      c.axis = 'z';
      c.line = Math.floor(Math.random() * (nb + 1));
      c.pos = anywhere ? z0 + 6 + Math.random() * (z1 - z0 - 12) : c.dir > 0 ? z0 + 2 : z1 - 2;
    }
    // Don't spawn inside an intersection.
    const stops = this.stopsFor(c.axis);
    for (const s of stops) if (Math.abs(c.pos - s) < BOX + 2) c.pos = s - c.dir * (BOX + 6);
    this.place(c);
  }

  /** Intersection centres along a street (x) or an avenue (z). */
  private stopsFor(axis: Axis): number[] {
    if (axis === 'x') return Array.from({ length: blocksFor(this.cols) + 1 }, (_, k) => avenueMid(k));
    return Array.from({ length: STREET_ROWS }, (_, r) => streetZ(r));
  }

  private laneXY(axis: Axis, line: number, dir: 1 | -1, pos: number): THREE.Vector2 {
    return axis === 'x' ? new THREE.Vector2(pos, streetZ(line) + dir * LANE) : new THREE.Vector2(avenueMid(line) - dir * LANE, pos);
  }

  private place(c: Car): void {
    if (!c.turn) {
      const p = this.laneXY(c.axis, c.line, c.dir, c.pos);
      c.x = p.x;
      c.z = p.y;
      c.yaw = c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : c.dir > 0 ? 0 : Math.PI;
    }
    c.root.position.set(c.x, 0, c.z);
    c.root.rotation.y = c.yaw;
  }

  /** Which axis has green right now ('x' streets, 'z' avenues), and whether it's amber. */
  private phase(): { green: Axis; amber: boolean } {
    const t = this.lightT % LIGHT_CYCLE;
    const half = LIGHT_CYCLE / 2;
    return t < half ? { green: 'x', amber: t > half - 2.5 } : { green: 'z', amber: t > LIGHT_CYCLE - 2.5 };
  }

  update(dt: number, sim: number, fx: number, fz: number): void {
    this.lightT += sim;
    const ph = this.phase();
    const key = (ph.green === 'x' ? 0 : 2) + (ph.amber ? 1 : 0);
    if (key !== this.lastPhase && this.litLamps) {
      this.lastPhase = key;
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      this.heads.forEach((hd, i) => {
        const go = hd.axis === ph.green;
        const y = go ? (ph.amber ? 3.0 : 2.62) : 3.38;
        col.setHex(go ? (ph.amber ? 0xffb21a : 0x39ff88) : 0xff2a2a);
        m.makeRotationY(hd.yaw);
        m.multiply(new THREE.Matrix4().makeTranslation(0, y, -0.2));
        m.setPosition(new THREE.Vector3(0, y, -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), hd.yaw).add(new THREE.Vector3(hd.x, 0, hd.z)));
        this.litLamps!.setMatrixAt(i, m);
        this.litLamps!.setColorAt(i, col);
      });
      this.litLamps.instanceMatrix.needsUpdate = true;
      if (this.litLamps.instanceColor) this.litLamps.instanceColor.needsUpdate = true;
    }
    if (sim > 0) for (const c of this.cars) this.drive(c, sim, ph);
    this.updateTargets(dt);
    for (const c of this.cars) {
      c.root.visible = Math.abs(c.x - fx) < 150 && Math.abs(c.z - fz) < 150;
      if (c.shaken > 0) c.hazard.visible = Math.floor(c.shaken * 3) % 2 === 0;
      else if (c.hazard.visible) c.hazard.visible = false;
    }
  }

  private drive(c: Car, dt: number, ph: { green: Axis; amber: boolean }): void {
    c.shaken = Math.max(0, c.shaken - dt);
    c.honkT = Math.max(0, c.honkT - dt);
    if (c.turn) {
      const tr = c.turn;
      tr.t += (c.speed * dt) / tr.len;
      c.speed += (c.max * 0.55 - c.speed) * Math.min(1, dt * 2);
      if (tr.t >= 1) {
        c.axis = tr.next.axis;
        c.line = tr.next.line;
        c.dir = tr.next.dir;
        c.pos = tr.next.pos;
        c.turn = null;
        c.decided = this.stopsFor(c.axis).findIndex((s) => Math.abs(s - c.pos) < BOX + 3);
        this.place(c);
        return;
      }
      const t = tr.t;
      const a = tr.p0.clone().multiplyScalar((1 - t) * (1 - t)).add(tr.p1.clone().multiplyScalar(2 * (1 - t) * t)).add(tr.p2.clone().multiplyScalar(t * t));
      const d = tr.p1.clone().sub(tr.p0).multiplyScalar(2 * (1 - t)).add(tr.p2.clone().sub(tr.p1).multiplyScalar(2 * t));
      c.x = a.x;
      c.z = a.y;
      c.yaw = Math.atan2(d.x, d.y);
      this.place(c);
      return;
    }
    let target = c.shaken > 0 ? 0 : c.max;
    const stops = this.stopsFor(c.axis);
    // Next intersection ahead
    let idx = -1;
    let best = Infinity;
    stops.forEach((s, i) => {
      const ahead = (s - c.pos) * c.dir;
      if (ahead > -BOX && ahead < best) {
        best = ahead;
        idx = i;
      }
    });
    if (idx >= 0 && idx !== c.decided) {
      const toStop = best - STOP_AT;
      const red = ph.green !== c.axis || (ph.amber && toStop > 3);
      if (red && toStop > -0.5 && toStop < 30) target = Math.min(target, Math.max(0, toStop * 0.9));
      if (best <= BOX + 0.3 && !(red && toStop > -1.5)) this.decide(c, idx, stops[idx]);
      else if (best <= BOX + 0.3 && red) target = 0;
    }
    // Keep a gap to the car ahead in the same lane
    for (const o of this.cars) {
      if (o === c || o.turn) continue;
      if (o.axis === c.axis && o.line === c.line && o.dir === c.dir) {
        const gap = (o.pos - c.pos) * c.dir;
        if (gap > 0 && gap < 12) target = Math.min(target, Math.max(0, (gap - 5.5) * 1.6));
      }
    }
    // Stop for the player standing in the lane
    const p = this.player;
    const lx = c.axis === 'x' ? (p.x - c.pos) * c.dir : (p.z - c.pos) * c.dir;
    const lat = c.axis === 'x' ? Math.abs(p.z - c.z) : Math.abs(p.x - c.x);
    if (lx > 0 && lx < 7.5 && lat < 1.8) {
      target = Math.min(target, Math.max(0, (lx - 3) * 1.5));
      if (c.honkT <= 0 && lx < 5) {
        c.honkT = 4;
        this.onHonk?.(c);
      }
    }
    for (const ob of this.obstacles) {
      const ox = c.axis === 'x' ? (ob.x - c.pos) * c.dir : (ob.z - c.pos) * c.dir;
      const ol = c.axis === 'x' ? Math.abs(ob.z - c.z) : Math.abs(ob.x - c.x);
      if (ox > 0 && ox < 9 && ol < 2) target = Math.min(target, Math.max(0, (ox - 4.5) * 1.5));
    }
    c.speed += (target - c.speed) * Math.min(1, dt * (target < c.speed ? 4 : 1.5));
    if (c.speed < 0.05 && target === 0) c.speed = 0;
    c.pos += c.dir * c.speed * dt;
    const [lo, hi] = c.axis === 'x' ? cityX(this.cols) : cityZ();
    if (c.pos < lo - 1 || c.pos > hi + 1) {
      this.respawn(c, false);
      return;
    }
    this.place(c);
  }

  /** At an intersection: carry straight on or turn into the crossing road. */
  private decide(c: Car, idx: number, centre: number): void {
    c.decided = idx;
    const roll = Math.random();
    if (roll < 0.55) return;
    const nb = blocksFor(this.cols);
    const right = roll < 0.78;
    // New axis and direction (right turn: rotate heading -90° in screen space).
    let next: { axis: Axis; line: number; dir: 1 | -1 };
    if (c.axis === 'x') {
      const k = idx;
      // Heading east (+x): right turn heads south (+z); heading west: right heads north.
      const dir = (right ? c.dir : -c.dir) as 1 | -1;
      next = { axis: 'z', line: k, dir };
      const zc = streetZ(c.line);
      const [z0, z1] = cityZ();
      if ((dir > 0 && zc + 20 > z1) || (dir < 0 && zc - 20 < z0)) return;
    } else {
      const r = idx;
      // Heading south (+z): right turn heads west (-x); north: right heads east.
      const dir = (right ? -c.dir : c.dir) as 1 | -1;
      next = { axis: 'x', line: r, dir };
      const xa = avenueMid(c.line);
      if ((dir < 0 && c.line === 0) || (dir > 0 && c.line === nb)) return;
      void xa;
    }
    const entry = this.laneXY(c.axis, c.line, c.dir, centre - c.dir * BOX);
    const exitCentre = next.axis === 'x' ? avenueMid(c.line) : streetZ(c.line);
    const exitPos = exitCentre + next.dir * BOX;
    const exit = this.laneXY(next.axis, next.line, next.dir, exitPos);
    // Corner: where the two lane lines cross.
    const corner = c.axis === 'x' ? new THREE.Vector2(exit.x, entry.y) : new THREE.Vector2(entry.x, exit.y);
    const len = entry.distanceTo(corner) + corner.distanceTo(exit);
    c.turn = { p0: entry, p1: corner, p2: exit, t: 0, len: len * 0.8, next: { ...next, pos: exitPos } };
  }

  /** First car a bullet hits along a ray (global frame), within `range`. */
  raycastCars(ox: number, oz: number, dx: number, dz: number, range: number): { car: Car; t: number } | null {
    let best: { car: Car; t: number } | null = null;
    for (const c of this.cars) {
      if (!c.root.visible) continue;
      // Car as a circle-ish box: test against its oriented rectangle.
      const cx = ox - c.x;
      const cz = oz - c.z;
      const s = Math.sin(-c.yaw);
      const co = Math.cos(-c.yaw);
      const lx = cx * co + cz * s;
      const lz = -cx * s + cz * co;
      const ldx = dx * co + dz * s;
      const ldz = -dx * s + dz * co;
      const hw = 1.0;
      const hl = c.length / 2;
      let t0 = 0;
      let t1 = range;
      for (const [o, d, h] of [[lx, ldx, hw], [lz, ldz, hl]] as const) {
        if (Math.abs(d) < 1e-6) {
          if (Math.abs(o) > h) {
            t0 = Infinity;
            break;
          }
          continue;
        }
        let a = (-h - o) / d;
        let b = (h - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 <= t1 && t0 < range && (!best || t0 < best.t)) best = { car: c, t: t0 };
    }
    return best;
  }

  /** A bullet hit this car: it stops with its hazard lights on. */
  /** The traffic cars on the road right now. */
  get traffic(): readonly Car[] {
    return this.cars;
  }

  /** Take a car out of the traffic (stolen!): it stays where it is, the city stops driving it. */
  releaseCar(c: Car): void {
    const i = this.cars.indexOf(c);
    if (i >= 0) this.cars.splice(i, 1);
    c.hazard.visible = false;
  }

  hitCar(c: Car): void {
    c.shaken = 4;
    c.speed = 0;
    this.onCarHit?.(c);
  }
}
