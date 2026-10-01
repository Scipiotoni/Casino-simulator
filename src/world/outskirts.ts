import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from '../render/materials';
import { asphaltTexture, canvasTexture, drawNeonText, lotTexture, makeCanvas, roundRect, seeded } from '../render/textures';
import { ROAD_HALF, STREET_ROWS, WILDS, avenueMid, blocksFor, cityX, cityZ, setWildsObstacles, streetZ } from './city';

/**
 * Everything around the city, in the global frame: the desert you can walk and drive out
 * into, the mountains that close the valley in (no invisible wall: the land just rises), a
 * ring road with roads out of every street and avenue, and things to find out there: the
 * "Welcome to Jackpot City" sign, billboards, an oasis, a solar farm, a scenic overlook,
 * wind turbines, a radio mast and hot-air balloons drifting over the Strip.
 */

/** Ring road: this far out from the city edge. */
export const RING = 70;
const RING_W = 11;

interface Circle {
  x: number;
  z: number;
  r: number;
}

// ------------------------------------------------------------------ noise

function hash2(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x: number, z: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    s += vnoise(x * f, z * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s / 0.9375;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Outskirts {
  readonly group = new THREE.Group();
  private cols = -1;
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

  /** Ground height (global) of the land around the city: flat where you can go, mountains beyond. */
  height(gx: number, gz: number): number {
    const din = Math.min(gx - this.x0, this.x1 - gx, gz - this.z0, this.z1 - gz);
    if (din > 0) return din > 25 ? -0.6 : -0.06 - (din / 25) * 0.54;
    const dx = Math.max(this.x0 - gx, 0, gx - this.x1);
    const dz = Math.max(this.z0 - gz, 0, gz - this.z1);
    const d = Math.hypot(dx, dz);
    const start = WILDS - 6;
    if (d < start) return -0.06;
    const n = fbm(gx / 260, gz / 260);
    const ridge = 1 - Math.abs(fbm(gx / 90 + 7, gz / 90 - 3) * 2 - 1);
    const t = smooth((d - start) / 300);
    return -0.06 + Math.pow(t, 1.3) * (45 + n * 150 + ridge * 40) + Math.max(0, d - start - 300) * 0.25 + smooth((d - start) / 40) * fbm(gx / 18, gz / 18) * 4;
  }

  /** Is this desert point taken by a rock, cactus, pond or landmark? */
  blocked(gx: number, gz: number): boolean {
    for (const [a, b, c, d] of this.rects) if (gx > a && gx < b && gz > c && gz < d) return true;
    const list = this.cells.get(this.cellKey(gx, gz));
    if (!list) return false;
    for (const c of list) if ((gx - c.x) ** 2 + (gz - c.z) ** 2 < c.r * c.r) return true;
    return false;
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

  /** On the ring road, a connector or the overlook highway (keep scenery off them). */
  private onRoad(gx: number, gz: number, pad = 3): boolean {
    const R = RING;
    const hw = RING_W / 2 + pad;
    const inOuter = gx > this.x0 - R - hw && gx < this.x1 + R + hw && gz > this.z0 - R - hw && gz < this.z1 + R + hw;
    const inInner = gx > this.x0 - R + hw && gx < this.x1 + R - hw && gz > this.z0 - R + hw && gz < this.z1 + R - hw;
    if (inOuter && !inInner) return true;
    for (let r = 0; r < STREET_ROWS; r++) {
      if (Math.abs(gz - streetZ(r)) < ROAD_HALF + pad && (gx < this.x0 || gx > this.x1) && gx > this.x0 - R - hw && gx < this.x1 + R + hw) return true;
    }
    for (let k = 0; k <= blocksFor(this.cols); k++) {
      if (Math.abs(gx - avenueMid(k)) < 5 + pad && (gz < this.z0 || gz > this.z1) && gz > this.z0 - R - hw && gz < this.z1 + R + hw) return true;
    }
    // Overlook highway: east from the ring along the middle of the city.
    const mz = (this.z0 + this.z1) / 2;
    if (Math.abs(gz - mz) < RING_W / 2 + pad && gx > this.x1 && gx < this.x1 + WILDS) return true;
    if (Math.hypot(gx - (this.x1 + WILDS - 32), gz - mz) < 30 + pad) return true;
    return false;
  }

  build(cols: number): void {
    if (cols === this.cols) return;
    this.cols = cols;
    [this.x0, this.x1] = cityX(cols);
    [this.z0, this.z1] = cityZ();
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.cells.clear();
    this.rects = [];
    this.rotors = [];
    this.balloons = [];
    this.signMats = [];
    this.beacon = null;
    this.buildGround();
    this.buildRoads();
    this.buildScatter();
    this.buildLandmarks();
    setWildsObstacles((x, z) => this.blocked(x, z));
  }

  private buildGround(): void {
    const cx = (this.x0 + this.x1) / 2;
    const cz = (this.z0 + this.z1) / 2;
    // The city's own ground (lots, alleys) under the roads.
    const lot = lotTexture().clone();
    const w = this.x1 - this.x0 + 2;
    const d = this.z1 - this.z0 + 2;
    lot.repeat.set(w / 2, d / 2);
    lot.needsUpdate = true;
    const cityGround = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: lot, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    cityGround.rotation.x = -Math.PI / 2;
    cityGround.position.set(cx, -0.03, cz);
    cityGround.receiveShadow = true;
    this.group.add(cityGround);

    // Desert and mountains
    const half = Math.max(this.x1 - this.x0, this.z1 - this.z0) / 2 + WILDS + 1000;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xd9a86c);
    const sand2 = new THREE.Color(0xc58c55);
    const rock = new THREE.Color(0xa35d3a);
    const dark = new THREE.Color(0x6e3b2a);
    const peak = new THREE.Color(0xd8c3ae);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const y = this.height(x, z);
      pos.setY(i, y);
      const n = fbm(x / 40, z / 40);
      c.copy(sand).lerp(sand2, n);
      if (y > 2) c.lerp(rock, smooth((y - 2) / 40));
      if (y > 40) c.lerp(dark, smooth((y - 40) / 90) * (0.4 + 0.6 * fbm(x / 30 + 3, z / 30)));
      if (y > 160) c.lerp(peak, smooth((y - 160) / 80));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tex = sandTexture();
    tex.repeat.set(half / 6, half / 6);
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1 }));
    terrain.position.set(cx, 0, cz);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    this.group.add(terrain);
  }

  private road(x0: number, z0: number, x1: number, z1: number, width: number, lines = true): void {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    if (len < 0.5) return;
    const t = (lines ? roadTexture() : asphaltTexture()).clone();
    t.repeat.set(1, len / 12);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    m.rotation.x = -Math.PI / 2;
    if (alongX) m.rotation.z = Math.PI / 2;
    m.position.set((x0 + x1) / 2, -0.025, (z0 + z1) / 2);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildRoads(): void {
    const R = RING;
    const { x0, x1, z0, z1 } = this;
    const hw = RING_W / 2;
    this.road(x0 - R - hw, z0 - R, x1 + R + hw, z0 - R, RING_W);
    this.road(x0 - R - hw, z1 + R, x1 + R + hw, z1 + R, RING_W);
    this.road(x0 - R, z0 - R + hw, x0 - R, z1 + R - hw, RING_W);
    this.road(x1 + R, z0 - R + hw, x1 + R, z1 + R - hw, RING_W);
    for (let r = 0; r < STREET_ROWS; r++) {
      const z = streetZ(r);
      this.road(x0 - R + hw, z, x0, z, ROAD_HALF * 2);
      this.road(x1, z, x1 + R - hw, z, ROAD_HALF * 2);
    }
    for (let k = 0; k <= blocksFor(this.cols); k++) {
      const x = avenueMid(k);
      this.road(x, z0 - R + hw, x, z0, 9);
      this.road(x, z1, x, z1 + R - hw, 9);
    }
    // Highway out east to the scenic overlook at the foot of the mountains.
    const mz = (z0 + z1) / 2;
    const end = x1 + WILDS - 32;
    this.road(x1 + R + hw, mz, end - 26, mz, RING_W);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(28, 40), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(end, -0.025, mz);
    this.group.add(pad);
  }

  /** Cacti, rocks, Joshua trees and scrub all over the desert and up the slopes. */
  private buildScatter(): void {
    const rnd = seeded(1234 + this.cols);
    const cx = (this.x0 + this.x1) / 2;
    const cz = (this.z0 + this.z1) / 2;
    const reachX = (this.x1 - this.x0) / 2 + WILDS + 420;
    const reachZ = (this.z1 - this.z0) / 2 + WILDS + 420;
    const pick = (minD: number, maxD: number): { x: number; z: number; d: number } | null => {
      for (let tries = 0; tries < 30; tries++) {
        const x = cx + (rnd() * 2 - 1) * reachX;
        const z = cz + (rnd() * 2 - 1) * reachZ;
        const dx = Math.max(this.x0 - x, 0, x - this.x1);
        const dz = Math.max(this.z0 - z, 0, z - this.z1);
        const d = Math.hypot(dx, dz);
        if (d < minD || d > maxD || this.onRoad(x, z)) continue;
        return { x, z, d };
      }
      return null;
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const scatter = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, minD: number, maxD: number, size: () => number, radius: number, tilt = 0) => {
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const p = pick(minD, maxD);
        if (!p) continue;
        const s = size();
        const y = this.height(p.x, p.z);
        e.set((rnd() - 0.5) * tilt, rnd() * Math.PI * 2, (rnd() - 0.5) * tilt);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(p.x, y - 0.05, p.z), q, new THREE.Vector3(s, s, s));
        mats.push(m4.clone());
        if (radius > 0 && p.d < WILDS + 4) this.block(p.x, p.z, radius * s);
      }
      const im = new THREE.InstancedMesh(geo, material, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    };
    scatter(cactusGeometry(), mat(0x3f7f3a, { rough: 0.8 }), 340, 12, WILDS + 260, () => 0.7 + rnd() * 0.8, 0.5);
    scatter(joshuaGeometry(), mat(0x6f6a3a, { rough: 0.9, flat: true }), 160, 20, WILDS + 200, () => 0.8 + rnd() * 0.7, 0.45);
    scatter(new THREE.DodecahedronGeometry(1, 0), mat(0x9c6a48, { rough: 0.95, flat: true }), 380, 18, WILDS + 520, () => 0.5 + rnd() ** 2 * 3.5, 0.9, 0.8);
    scatter(new THREE.DodecahedronGeometry(1, 1), mat(0x7f4c34, { rough: 0.95, flat: true }), 140, WILDS - 20, WILDS + 700, () => 3 + rnd() * 9, 0.8, 0.6);
    scatter(new THREE.IcosahedronGeometry(0.6, 0), mat(0x8a8a4a, { rough: 1, flat: true }), 700, 6, WILDS + 300, () => 0.4 + rnd() * 0.9, 0);
  }

  private buildLandmarks(): void {
    const { x0, x1, z0, z1 } = this;
    const mz = (z0 + z1) / 2;
    const midX = (x0 + x1) / 2;
    // Welcome sign on the west road in from the desert.
    const sign = welcomeSign();
    sign.position.set(x0 - RING - 26, 0, streetZ(0) - 15);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);
    this.block(sign.position.x, sign.position.z - 2.6, 0.5);
    this.block(sign.position.x, sign.position.z + 2.6, 0.5);
    sign.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.emissiveMap) this.signMats.push(m);
    });

    // Billboards along the ring road
    const ads: [string, string, string, string][] = [
      ['JACKPOT TYCOON', 'Build the biggest casino in the city', '#ffd24a', '#3a0d4d'],
      ['VELOCITY MOTORS', 'Supercars · Muscle · Limos', '#2fe6ff', '#0d2236'],
      ['BULLSEYE GUNS', 'Downtown since 1962', '#ff4d4d', '#2a0c0c'],
      ['THE OASIS', 'Cool water · 2 miles north', '#39ff88', '#0c2a1a'],
      ['SUNSET DRIVE', 'Where the night begins', '#ff8a1f', '#2a1206'],
    ];
    const spots: [number, number, number][] = [
      [x0 - RING - 18, mz - 60, Math.PI / 2],
      [midX - 140, z1 + RING + 18, Math.PI],
      [x1 + RING + 18, mz + 70, -Math.PI / 2],
      [midX + 120, z0 - RING - 18, 0],
      [x1 + RING + 18, z1 - 40, -Math.PI / 2],
    ];
    spots.forEach(([x, z, yaw], i) => {
      const b = billboard(...ads[i % ads.length]);
      b.position.set(x, 0, z);
      b.rotation.y = yaw;
      this.group.add(b);
      const dx = Math.cos(yaw) * 4.5;
      const dz = -Math.sin(yaw) * 4.5;
      this.block(x + dx, z + dz, 0.6);
      this.block(x - dx, z - dz, 0.6);
      b.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.emissiveMap) this.signMats.push(m);
      });
    });

    // The oasis, north of town
    const ox = midX - 60;
    const oz = z0 - RING - 120;
    const water = new THREE.Mesh(new THREE.CircleGeometry(22, 48), new THREE.MeshStandardMaterial({ color: 0x2aa6c4, roughness: 0.08, metalness: 0.2, emissive: 0x06303a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(ox, 0.01, oz);
    this.group.add(water);
    const shore = new THREE.Mesh(new THREE.RingGeometry(21.5, 27, 48), new THREE.MeshStandardMaterial({ color: 0x9a8a4a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(ox, -0.02, oz);
    this.group.add(shore);
    this.block(ox, oz, 21.5);
    const prnd = seeded(77);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + prnd() * 0.3;
      const r = 24 + prnd() * 5;
      const px = ox + Math.cos(a) * r;
      const pz = oz + Math.sin(a) * r;
      this.group.add(palmTree(px, pz, 6 + prnd() * 5, prnd));
      this.block(px, pz, 0.45);
    }

    // Solar farm, south-east
    const sx = x1 + RING + 60;
    const sz = z1 + RING + 50;
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
        pm.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0)), new THREE.Vector3(1, 1, 1)));
        lm.push(new THREE.Matrix4().makeTranslation(x, 0.6, z));
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

    // Scenic overlook at the end of the east highway: railing, telescopes, a neon sign.
    const end = x1 + WILDS - 32;
    const look = new THREE.Group();
    look.position.set(end, 0, mz);
    const rail = mat(0xb8b2a8, { rough: 0.5, metal: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (i / 13) * Math.PI;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), rail);
      post.position.set(Math.cos(a) * 27, 0.55, Math.sin(a) * 27);
      look.add(post);
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
      this.block(end + 23, mz + dz, 0.4);
    }
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshStandardMaterial({ map: neonPanel('SCENIC OVERLOOK', '#2fe6ff', '#0b1020'), emissive: 0xffffff, emissiveMap: neonPanel('SCENIC OVERLOOK', '#2fe6ff', '#0b1020'), emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    ov.position.set(-22, 4.5, -18);
    ov.rotation.y = Math.PI / 2;
    this.signMats.push(ov.material as THREE.MeshStandardMaterial);
    for (const dz of [-4, 4]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), rail);
      p.position.set(-22, 2.25, -18 + dz);
      look.add(p);
      this.block(end - 22, mz - 18 + dz, 0.4);
    }
    look.add(ov);
    this.group.add(look);

    // Wind turbines along the southern ridge (out of reach, turning in the wind).
    const trnd = seeded(31);
    for (let i = 0; i < 9; i++) {
      const x = x0 + ((i + 0.5) / 9) * (x1 - x0) + (trnd() - 0.5) * 40;
      const z = z1 + WILDS + 90 + trnd() * 60;
      const y = this.height(x, z);
      const t = windTurbine();
      t.position.set(x, y - 1, z);
      t.rotation.y = Math.PI + (trnd() - 0.5) * 0.4;
      this.rotors.push(t.userData.rotor as THREE.Object3D);
      (t.userData.rotor as THREE.Object3D).rotation.z = trnd() * 6;
      this.group.add(t);
    }

    // Radio mast on the north-east hills with a blinking light
    const rx = x1 + 120;
    const rz = z0 - WILDS - 70;
    const mast = radioMast();
    mast.position.set(rx, this.height(rx, rz) - 1, rz);
    this.beacon = mast.userData.beacon as THREE.Mesh;
    this.group.add(mast);

    // Hot-air balloons drifting over town
    const brnd = seeded(5);
    const cols = [[0xff3fa4, 0xffd24a], [0x2fe6ff, 0xffffff], [0xff8a1f, 0x7a1f5a], [0x39ff88, 0x173a4a], [0xb77bff, 0xffd24a], [0xff4d4d, 0xffffff]];
    for (let i = 0; i < 6; i++) {
      const b = balloon(cols[i][0], cols[i][1]);
      const cx = x0 + brnd() * (x1 - x0);
      const cz = z0 + brnd() * (z1 - z0);
      this.balloons.push({ o: b, cx, cz, r: 80 + brnd() * 220, a: brnd() * Math.PI * 2, w: (0.006 + brnd() * 0.01) * (brnd() < 0.5 ? -1 : 1), y: 70 + brnd() * 60 });
      this.group.add(b);
    }
  }

  /** Spin the turbines, drift the balloons, blink the mast; signs glow brighter after dark. */
  update(dt: number, night: number): void {
    this.t += dt;
    for (const r of this.rotors) r.rotation.z += dt * 1.1;
    for (const b of this.balloons) {
      b.a += b.w * dt;
      b.o.position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(this.t * 0.3 + b.r) * 3, b.cz + Math.sin(b.a) * b.r);
      b.o.rotation.y += dt * 0.05;
    }
    if (this.beacon) (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = (this.t % 1.6) < 0.5 ? 4 : 0.2;
    for (const m of this.signMats) m.emissiveIntensity = 0.06 + night * 1.1;
  }
}

// ------------------------------------------------------------------ models and textures

let sandTex: THREE.CanvasTexture | null = null;
function sandTexture(): THREE.CanvasTexture {
  if (sandTex) return sandTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(21);
  ctx.fillStyle = '#e6e0d8';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    const v = 190 + rnd() * 65;
    ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},0.6)`;
    ctx.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1);
  }
  ctx.strokeStyle = 'rgba(160,140,120,0.25)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const y = rnd() * 128;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) ctx.lineTo(x, y + Math.sin(x / 20 + i) * 4);
    ctx.stroke();
  }
  sandTex = canvasTexture(canvas, true);
  return sandTex;
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
