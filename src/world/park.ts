import * as THREE from 'three';
import { mat, glow } from '../render/materials';
import { canvasTexture, makeCanvas, seeded } from '../render/textures';
import { BLOCK_COLS, PARK_BLOCKS, blockX0, parkRect } from './city';
import { LOT_STRIDE } from './grid';
import { Obstacles, Strips, TreeBatch, instances, place } from './nature';

/** Width of one park section (one city block between two avenues). */
const SEC = BLOCK_COLS * LOT_STRIDE;

/** The lake in the middle section. */
export interface Lake {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

function parkSign(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 128);
  ctx.fillStyle = '#1d6b3e';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f4f1ea';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '900 64px Nunito, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CENTRAL PARK', 256, 68, 470);
  return canvasTexture(canvas);
}

/**
 * Central Park, in the middle of town (global frame): three blocks of lawns, paths and trees
 * between Park Lane and Lakeview Road, crossed by the avenues. The west section has a fountain
 * plaza and a bandstand, the middle one a lake with a wooden footbridge and rowing boats, the
 * east one a football pitch, a playground and picnic tables. Walk (or drive, if you must)
 * anywhere; only the water, the fountain and the tree trunks are solid.
 */
export class CentralPark {
  readonly group = new THREE.Group();
  readonly solid = new Obstacles();
  lake: Lake | null = null;
  private boats: THREE.Object3D[] = [];
  private fountain: THREE.Mesh | null = null;
  private t = 0;
  private built = false;

  blocked(gx: number, gz: number): boolean {
    if (!this.built) return false;
    const r = parkRect();
    if (gx < r.x0 || gx > r.x1 || gz < r.z0 || gz > r.z1) return false;
    const l = this.lake;
    if (l && Math.abs(gx - l.x) > 1.7) {
      const u = (gx - l.x) / l.rx;
      const v = (gz - l.z) / l.rz;
      if (u * u + v * v < 1) return true;
    }
    return this.solid.blocked(gx, gz);
  }

  /** Is this point in the lake's water (for splashes)? */
  inWater(gx: number, gz: number): boolean {
    const l = this.lake;
    if (!l) return false;
    const u = (gx - l.x) / l.rx;
    const v = (gz - l.z) / l.rz;
    return u * u + v * v < 1 && Math.abs(gx - l.x) > 1.7;
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    const pr = parkRect();
    const z0 = pr.z0;
    const z1 = pr.z1;
    const zc = (z0 + z1) / 2;
    const rnd = seeded(4242);
    const grass = new Strips();
    const paths = new Strips();
    const plaza = new Strips();
    const sand = new Strips();
    const trees = new TreeBatch();
    const benches: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const beds: THREE.Matrix4[] = [];
    const tables: THREE.Matrix4[] = [];
    /** Places trees must keep away from: [x, z, radius]. */
    const keepOut: [number, number, number][] = [];
    const segs: [number, number, number, number][] = [];
    const path = (ax: number, az: number, bx: number, bz: number, w = 3.2) => {
      paths.line(ax, az, bx, bz, w, 0.012);
      segs.push([ax, az, bx, bz]);
      // Lamps and benches every so often along it.
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 18);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const yaw = Math.atan2(bx - ax, bz - az);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        if (i % 2) lamps.push(place(x + nx * (w / 2 + 0.6), 0, z + nz * (w / 2 + 0.6)));
        else benches.push(place(x - nx * (w / 2 + 0.7), 0, z - nz * (w / 2 + 0.7), yaw + Math.PI / 2));
      }
    };
    const nearPath = (x: number, z: number, pad: number) => segs.some(([ax, az, bx, bz]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < pad;
    });

    for (let k = PARK_BLOCKS[0]; k <= PARK_BLOCKS[1]; k++) {
      const x0 = blockX0(k);
      const x1 = x0 + SEC;
      const xc = (x0 + x1) / 2;
      grass.rect(x0, z0, x1, z1, 0.006);
      // A loop path round the section, and the path in from each street.
      const ins = 7;
      path(x0 + ins, z0 + ins, x1 - ins, z0 + ins);
      path(x1 - ins, z0 + ins, x1 - ins, z1 - ins);
      path(x1 - ins, z1 - ins, x0 + ins, z1 - ins);
      path(x0 + ins, z1 - ins, x0 + ins, z0 + ins);
      path(xc, z0, xc, z0 + ins);
      path(xc, z1 - ins, xc, z1);
      path(x0, zc, x0 + ins, zc);
      path(x1 - ins, zc, x1, zc);
      const mid = k - PARK_BLOCKS[0];
      if (mid === 0) {
        // West: diagonals meeting at a fountain plaza, flower beds and a bandstand.
        path(x0 + ins, z0 + ins, xc - 10, zc - 10);
        path(x1 - ins, z1 - ins, xc + 10, zc + 10);
        path(x1 - ins, z0 + ins, xc + 10, zc - 10);
        path(x0 + ins, z1 - ins, xc - 10, zc + 10);
        path(xc, z0 + ins, xc, zc - 13);
        path(xc, zc + 13, xc, z1 - ins);
        plaza.disc(xc, zc, 14, 14, 0.014, 40);
        keepOut.push([xc, zc, 17]);
        // Fountain: a stone basin, water and a spout.
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.7, 32), mat(0xe9e1d3, { rough: 0.6 }));
        basin.position.set(xc, 0.35, zc);
        basin.castShadow = true;
        this.group.add(basin);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.08, 32), mat(0x2fb8e0, { emissive: 0x0a5a80, emissiveIntensity: 0.6, rough: 0.05 }));
        water.position.set(xc, 0.66, zc);
        this.group.add(water);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 16), mat(0xe9e1d3, { rough: 0.6 }));
        col.position.set(xc, 1.2, zc);
        this.group.add(col);
        const jet = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55, roughness: 0.1, emissive: 0x4fa0c0, emissiveIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
        jet.rotation.x = Math.PI;
        jet.position.set(xc, 3.3, zc);
        this.group.add(jet);
        this.fountain = jet;
        this.solid.circle(xc, zc, 4.9);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          beds.push(place(xc + Math.cos(a) * 11, 0, zc + Math.sin(a) * 11, -a, 3.2, 1, 1.4));
          benches.push(place(xc + Math.cos(a + 0.4) * 8.3, 0, zc + Math.sin(a + 0.4) * 8.3, Math.PI / 2 - (a + 0.4) - Math.PI / 2));
        }
        // Bandstand: a round stage, posts and a pointed roof.
        const bx = x0 + 32;
        const bz = z1 - 32;
        const stage = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.2, 0.6, 8), mat(0xd8d2c6, { rough: 0.7 }));
        stage.position.set(bx, 0.3, bz);
        this.group.add(stage);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 8), mat(0xf4f1ea, { rough: 0.5 }));
          post.position.set(bx + Math.cos(a) * 5.5, 2.3, bz + Math.sin(a) * 5.5);
          this.group.add(post);
        }
        const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 2.6, 8), mat(0x2f6a8a, { rough: 0.6 }));
        roof.position.set(bx, 5.3, bz);
        roof.castShadow = true;
        this.group.add(roof);
        this.solid.circle(bx, bz, 6.2);
        keepOut.push([bx, bz, 10]);
      } else if (mid === 1) {
        // Middle: the lake, with a footbridge across and a sandy shore.
        const l: Lake = { x: xc, z: zc, rx: 46, rz: 38 };
        this.lake = l;
        sand.disc(l.x, l.z, l.rx + 4, l.rz + 4, 0.009, 48);
        const water = new THREE.Mesh(new THREE.CircleGeometry(1, 56), new THREE.MeshStandardMaterial({ color: 0x1f6f9a, roughness: 0.35, metalness: 0, emissive: 0x062a38 }));
        water.rotation.x = -Math.PI / 2;
        water.scale.set(l.rx, l.rz, 1);
        water.position.set(l.x, 0.03, l.z);
        this.group.add(water);
        keepOut.push([l.x, l.z, l.rx + 5]);
        // The bridge: a deck, rails and posts.
        const len = l.rz * 2 + 6;
        const wood = mat(0x8a5a2e, { rough: 0.8 });
        const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, len), wood);
        deck.position.set(l.x, 0.07, l.z);
        deck.receiveShadow = true;
        this.group.add(deck);
        for (const sx of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), wood);
          rail.position.set(l.x + sx * 1.65, 1.0, l.z);
          this.group.add(rail);
          const posts: THREE.Matrix4[] = [];
          for (let z = -len / 2; z <= len / 2; z += 3) posts.push(place(l.x + sx * 1.65, 0.5, l.z + z));
          instances(this.group, new THREE.BoxGeometry(0.12, 1.0, 0.12), wood, posts, false);
        }
        path(xc, z0 + ins, xc, l.z - l.rz - 3);
        path(xc, l.z + l.rz + 3, xc, z1 - ins);
        // Rowing boats drifting on the water.
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Group();
          const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.45, 3, 10, 1, false, 0, Math.PI), mat([0xc8102e, 0xf4f1ea, 0x1f4fbf][i], { rough: 0.6, side: THREE.DoubleSide }));
          hull.rotation.set(Math.PI / 2, 0, Math.PI);
          hull.position.y = 0.35;
          b.add(hull);
          b.userData.a = i * 2.1;
          b.userData.r = 18 + i * 7;
          this.group.add(b);
          this.boats.push(b);
        }
        // A jetty with picnic tables on the east shore.
        const jx = l.x + l.rx + 1;
        const jetty = new THREE.Mesh(new THREE.BoxGeometry(8, 0.14, 3), wood);
        jetty.position.set(jx - 2, 0.07, l.z + 12);
        this.group.add(jetty);
        for (let i = 0; i < 3; i++) tables.push(place(jx + 6, 0, l.z - 8 + i * 8, Math.PI / 2));
      } else {
        // East: a football pitch, a playground and picnic tables.
        const fx = xc + 14;
        const fz = zc;
        const pitch = new Strips();
        pitch.rect(fx - 32, fz - 21, fx + 32, fz + 21, 0.01);
        const pm = pitch.mesh(mat(0x3f9a3f, { rough: 1 }));
        if (pm) this.group.add(pm);
        const lines = new Strips();
        lines.rect(fx - 30, fz - 19, fx + 30, fz - 18.8, 0.016);
        lines.rect(fx - 30, fz + 18.8, fx + 30, fz + 19, 0.016);
        lines.rect(fx - 30, fz - 19, fx - 29.8, fz + 19, 0.016);
        lines.rect(fx + 29.8, fz - 19, fx + 30, fz + 19, 0.016);
        lines.rect(fx - 0.1, fz - 19, fx + 0.1, fz + 19, 0.016);
        for (const sx of [-1, 1]) lines.rect(Math.min(fx + sx * 30, fx + sx * 22), fz - 8, Math.max(fx + sx * 30, fx + sx * 22), fz - 7.8, 0.016);
        for (const sx of [-1, 1]) lines.rect(Math.min(fx + sx * 30, fx + sx * 22), fz + 7.8, Math.max(fx + sx * 30, fx + sx * 22), fz + 8, 0.016);
        for (const sx of [-1, 1]) lines.rect(fx + sx * 22 - 0.1, fz - 8, fx + sx * 22 + 0.1, fz + 8, 0.016);
        const lm = lines.mesh(mat(0xf4f1ea, { rough: 0.6 }));
        if (lm) this.group.add(lm);
        const white = mat(0xf4f1ea, { rough: 0.5 });
        for (const sx of [-1, 1]) {
          const goal = new THREE.Group();
          for (const dz of [-3.6, 3.6]) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), white);
            p.position.set(0, 1.2, dz);
            goal.add(p);
          }
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7.2, 8), white);
          bar.rotation.x = Math.PI / 2;
          bar.position.y = 2.4;
          goal.add(bar);
          goal.position.set(fx + sx * 30.2, 0, fz);
          this.group.add(goal);
        }
        keepOut.push([fx, fz, 36]);
        // Playground: a slide, swings and a climbing frame on rubber matting.
        const px = x0 + 30;
        const pz = z0 + 32;
        const mat2 = new Strips();
        mat2.rect(px - 12, pz - 10, px + 12, pz + 10, 0.011);
        const mm = mat2.mesh(mat(0xc8553a, { rough: 1 }));
        if (mm) this.group.add(mm);
        const red = mat(0xff4d4d, { rough: 0.5 });
        const blue = mat(0x2f6ad6, { rough: 0.5 });
        const yellow = mat(0xffc53d, { rough: 0.5 });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.4), blue);
        tower.position.set(px - 5, 1.8, pz);
        this.group.add(tower);
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), yellow);
          leg.position.set(px - 5 + ox * 1.1, 1.4, pz + oz * 1.1);
          this.group.add(leg);
        }
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.2, 4), red);
        roof.rotation.y = Math.PI / 4;
        roof.position.set(px - 5, 3.4, pz);
        this.group.add(roof);
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 4.2), yellow);
        slide.position.set(px - 5, 0.95, pz + 3.2);
        slide.rotation.x = 0.45;
        this.group.add(slide);
        this.solid.rect(px - 6.3, px - 3.7, pz - 1.3, pz + 1.3);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.12), red);
        frame.position.set(px + 5, 2.4, pz);
        this.group.add(frame);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), red);
          leg.position.set(px + 5 + sx * 3, 1.2, pz + sz * 0.9);
          leg.rotation.x = sz * 0.35;
          this.group.add(leg);
        }
        for (const sx of [-1.4, 1.4]) {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.25), blue);
          seat.position.set(px + 5 + sx, 0.6, pz);
          this.group.add(seat);
          for (const dx of [-0.25, 0.25]) {
            const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 4), mat(0x3a3a3a));
            rope.position.set(px + 5 + sx + dx, 1.5, pz);
            this.group.add(rope);
          }
        }
        keepOut.push([px, pz, 15]);
        for (let i = 0; i < 6; i++) tables.push(place(x0 + 20 + (i % 3) * 7, 0, z1 - 26 - Math.floor(i / 3) * 7, rnd() * 0.4));
      }
      // Entrance signs at the street ends of the middle path.
      const tex = parkSign();
      for (const [sz, yaw] of [[z0 + 0.6, Math.PI], [z1 - 0.6, 0]] as const) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 }));
        sign.position.set(xc + 4.6, 2.4, sz);
        sign.rotation.y = yaw;
        this.group.add(sign);
        for (const dx of [-2.2, 2.2]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 6), mat(0x2b2b35, { metal: 0.6 }));
          p.position.set(xc + 4.6 + dx, 1.45, sz);
          this.group.add(p);
          this.solid.circle(xc + 4.6 + dx, sz, 0.2);
        }
      }
      // Trees all over, away from the paths and the features.
      for (let i = 0; i < 150; i++) {
        const x = x0 + 3 + rnd() * (SEC - 6);
        const z = z0 + 3 + rnd() * (z1 - z0 - 6);
        if (nearPath(x, z, 3.6)) continue;
        if (keepOut.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r)) continue;
        const kind = rnd();
        const s = 0.85 + rnd() * 0.6;
        trees.add(kind < 0.62 ? 'leafy' : kind < 0.85 ? 'birch' : 'pine', x, z, s, rnd() * 6);
        this.solid.circle(x, z, 0.32 * s);
      }
    }
    const gm = grass.mesh(mat(0x4f9a3f, { rough: 1 }));
    const pm = paths.mesh(mat(0xd8cbb4, { rough: 0.95 }));
    const plm = plaza.mesh(mat(0xcfc6b6, { rough: 0.8 }));
    const sm = sand.mesh(mat(0xe2cf9c, { rough: 1 }));
    for (const m of [gm, sm, pm, plm]) if (m) this.group.add(m);
    trees.build(this.group);
    // Benches, lamps, flower beds and picnic tables, instanced.
    const benchSeat = new THREE.BoxGeometry(1.6, 0.08, 0.45);
    benchSeat.translate(0, 0.45, 0);
    const benchBack = new THREE.BoxGeometry(1.6, 0.4, 0.06);
    benchBack.translate(0, 0.72, -0.22);
    const benchLegs = new THREE.BoxGeometry(1.5, 0.45, 0.4);
    benchLegs.translate(0, 0.22, 0);
    const brown = mat(0x8a5a2e, { rough: 0.8 });
    instances(this.group, benchSeat, brown, benches, false);
    instances(this.group, benchBack, brown, benches, false);
    instances(this.group, benchLegs, mat(0x2b2b35, { metal: 0.6, rough: 0.5 }), benches, false);
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6);
    pole.translate(0, 1.7, 0);
    const head = new THREE.SphereGeometry(0.22, 10, 8);
    head.translate(0, 3.5, 0);
    instances(this.group, pole, mat(0x2b2b35, { metal: 0.6, rough: 0.4 }), lamps, false);
    instances(this.group, head, glow(0xffe2a8, 2.2), lamps, false);
    for (const m of lamps) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      this.solid.circle(p.x, p.z, 0.15);
    }
    const bed = new THREE.BoxGeometry(1, 0.35, 1);
    bed.translate(0, 0.17, 0);
    instances(this.group, bed, mat(0xd94a7a, { rough: 0.9, flat: true }), beds, false);
    const top = new THREE.BoxGeometry(1.8, 0.08, 0.9);
    top.translate(0, 0.75, 0);
    const seats = new THREE.BoxGeometry(1.8, 0.06, 2.2);
    seats.translate(0, 0.45, 0);
    instances(this.group, top, brown, tables, false);
    instances(this.group, seats, brown, tables, false);
  }

  update(dt: number): void {
    this.t += dt;
    const l = this.lake;
    if (l) {
      for (const b of this.boats) {
        const a = (b.userData.a as number) + this.t * 0.03;
        const r = b.userData.r as number;
        b.position.set(l.x + 8 + Math.cos(a) * r, Math.sin(this.t * 1.3 + r) * 0.05, l.z + Math.sin(a) * r * 0.7);
        b.rotation.y = -a;
      }
    }
    if (this.fountain) this.fountain.scale.y = 1 + Math.sin(this.t * 3) * 0.06;
  }
}
