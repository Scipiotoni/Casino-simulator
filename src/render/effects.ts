import * as THREE from 'three';
import { coinTexture } from './textures';

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  grow: number;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private floorY: number;

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, floorY = 0.01) {
    this.floorY = floorY;
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    for (let i = 0; i < capacity; i++) {
      this.parts.push({
        alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
        life: 0, max: 1, size: 1, color: new THREE.Color(1, 1, 1), gravity: 0, drag: 0, grow: 0,
      });
      this.m4.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = capacity;
  }

  spawn(init: (p: Particle) => void): void {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % this.capacity;
    p.alive = true;
    p.life = 0;
    p.gravity = 0;
    p.drag = 0;
    p.grow = 0;
    p.rot.set(0, 0, 0);
    p.spin.set(0, 0, 0);
    init(p);
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (!p.alive) continue;
      any = true;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        continue;
      }
      p.v.y -= p.gravity * dt;
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < this.floorY && p.gravity > 0) {
        p.p.y = this.floorY;
        p.v.set(p.v.x * 0.3, 0, p.v.z * 0.3);
        p.spin.multiplyScalar(0.3);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const u = p.life / p.max;
      const fade = u > 0.75 ? 1 - (u - 0.75) / 0.25 : Math.min(1, u * 8);
      const sc = p.size * fade * (1 + p.grow * u);
      this.q.setFromEuler(p.rot);
      this.s.set(sc, sc, sc);
      this.m4.compose(p.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, p.color);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

interface FlyingCoin {
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  delay: number;
  dur: number;
  arc: number;
  done?: () => void;
  side: THREE.Vector3;
}

const CONFETTI_COLS = [0xff3fa4, 0x2fe6ff, 0xffd23f, 0x3ddc84, 0xb77bff, 0xff8a1f, 0xffffff];

/** All particle effects share a handful of instanced meshes (one draw call each). */
export class Effects {
  readonly group = new THREE.Group();
  private confettiPool: Pool;
  private sparklePool: Pool;
  private smokePool: Pool;
  private coinMesh: THREE.InstancedMesh;
  private coins: FlyingCoin[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private tmp = new THREE.Vector3();
  private time = 0;
  reducedMotion = false;

  constructor() {
    const confGeo = new THREE.PlaneGeometry(0.09, 0.05);
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.confettiPool = new Pool(confGeo, confMat, 600);
    const sparkGeo = new THREE.OctahedronGeometry(0.06, 0);
    const sparkMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.sparklePool = new Pool(sparkGeo, sparkMat, 300, -10);
    const smokeGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
    this.smokePool = new Pool(smokeGeo, smokeMat, 160, -10);
    const coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.022, 16);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.6, roughness: 0.3, emissive: 0x6b4a00, emissiveIntensity: 0.6 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 160);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.group.add(this.confettiPool.mesh, this.sparklePool.mesh, this.smokePool.mesh, this.coinMesh);
    this.sparklePool.mesh.renderOrder = 5;
  }

  confetti(x: number, y: number, z: number, count = 80, power = 1): void {
    const n = this.reducedMotion ? Math.floor(count / 4) : count;
    for (let i = 0; i < n; i++) {
      this.confettiPool.spawn((p) => {
        p.p.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
        const a = Math.random() * Math.PI * 2;
        const sp = (1 + Math.random() * 2.2) * power;
        p.v.set(Math.cos(a) * sp, (3 + Math.random() * 3.5) * power, Math.sin(a) * sp);
        p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
        p.max = 2.2 + Math.random() * 1.6;
        p.size = 0.8 + Math.random() * 0.8;
        p.gravity = 6;
        p.drag = 1.6;
        p.color.setHex(CONFETTI_COLS[Math.floor(Math.random() * CONFETTI_COLS.length)]);
      });
    }
  }

  sparkle(x: number, y: number, z: number, count = 12, color = 0xffe08a, spread = 0.6): void {
    for (let i = 0; i < count; i++) {
      this.sparklePool.spawn((p) => {
        p.p.set(x + (Math.random() - 0.5) * spread, y + Math.random() * spread * 0.6, z + (Math.random() - 0.5) * spread);
        p.v.set((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6);
        p.max = 0.6 + Math.random() * 0.6;
        p.size = 0.5 + Math.random() * 0.9;
        p.drag = 1;
        p.spin.set(0, 4 + Math.random() * 4, 0);
        p.color.setHex(color).multiplyScalar(2.2);
      });
    }
  }

  smoke(x: number, y: number, z: number, count = 2): void {
    for (let i = 0; i < count; i++) {
      this.smokePool.spawn((p) => {
        p.p.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
        p.v.set((Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
        p.max = 1.6 + Math.random();
        p.size = 0.6 + Math.random() * 0.5;
        p.grow = 1.8;
        p.color.setHex(0x4a4552);
      });
    }
  }

  dust(x: number, z: number, radius = 0.8): void {
    for (let i = 0; i < 10; i++) {
      this.smokePool.spawn((p) => {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
        p.p.set(x + Math.cos(a) * radius * 0.5, 0.1, z + Math.sin(a) * radius * 0.5);
        p.v.set(Math.cos(a) * 1.8, 0.5, Math.sin(a) * 1.8);
        p.drag = 3.5;
        p.max = 0.55;
        p.size = 0.55;
        p.grow = 1.4;
        p.color.setHex(0xfff4e6);
      });
    }
  }

  /** Coins that fly in an arc toward a (possibly moving) target, e.g. the player. */
  coinFlight(from: THREE.Vector3, to: () => THREE.Vector3, count: number, onEach?: () => void): void {
    const n = Math.min(count, this.reducedMotion ? 3 : 14);
    for (let i = 0; i < n; i++) {
      if (this.coins.length >= 150) break;
      const side = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6);
      this.coins.push({
        from: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)),
        to, t: 0, delay: i * 0.045, dur: 0.55 + Math.random() * 0.15, arc: 1 + Math.random() * 0.8, done: onEach, side,
      });
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.confettiPool.update(dt);
    this.sparklePool.update(dt);
    this.smokePool.update(dt);
    let k = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.t += dt / c.dur;
      if (c.t >= 1) {
        c.done?.();
        this.coins.splice(i, 1);
      }
    }
    for (const c of this.coins) {
      if (c.delay > 0) continue;
      const u = Math.min(1, c.t);
      const target = c.to();
      const e = u * u * (3 - 2 * u);
      this.tmp.lerpVectors(c.from, target, e);
      this.tmp.addScaledVector(c.side, Math.sin(u * Math.PI) * 0.5);
      this.tmp.y += Math.sin(u * Math.PI) * c.arc;
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * 14 + k);
      const s = 1 - u * 0.4;
      this.m4.compose(this.tmp, this.q, new THREE.Vector3(s, s, s));
      this.coinMesh.setMatrixAt(k++, this.m4);
      if (k >= 160) break;
    }
    this.coinMesh.count = k;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }
}
