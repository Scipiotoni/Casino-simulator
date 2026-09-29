import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat, glow, gold } from '../render/materials';
import {
  asphaltTexture, canvasTexture, drawNeonText, lotTexture, makeCanvas, roundRect, sidewalkTexture, wallTexture,
} from '../render/textures';
import { CENTER_X, FACADE_Z, SIDEWALK_Z1, type Grid } from './grid';

export const WALL_H = 2.5;
const WALL_T = 0.2;
const CUT_H = 0.28;

export interface CasinoLook {
  name: string;
  signFont: string;
  signColor: number;
  wallColor: number;
  trimColor: number;
}

export const SIGN_FONTS: { id: string; label: string; css: string; weight: string }[] = [
  { id: 'bungee', label: 'Marquee', css: 'Bungee, "Arial Black", sans-serif', weight: '400' },
  { id: 'pacifico', label: 'Script', css: 'Pacifico, "Brush Script MT", cursive', weight: '400' },
  { id: 'monoton', label: 'Retro Neon', css: 'Monoton, "Arial Black", sans-serif', weight: '400' },
  { id: 'nunito', label: 'Modern', css: 'Nunito, Arial, sans-serif', weight: '900' },
];

export const NEON_COLORS = [0xff3fa4, 0x2fe6ff, 0xffc53d, 0x39ff88, 0xb77bff, 0xff4d4d, 0xfff4d6, 0xff8a1f];
export const WALL_COLORS = [0x3a1d4d, 0x5a1426, 0x173a4a, 0x1d4a33, 0x2b2b35, 0x6b4a2a, 0xe9e1d3, 0x14142a, 0x7a1f5a];

type Side = 'north' | 'south' | 'east' | 'west';

interface WallSide {
  side: Side;
  normal: [number, number];
  walls: THREE.Mesh[];
  trims: THREE.Mesh[];
  extras: THREE.Object3D[];
  cut: number; // 0 = full height, 1 = cut away
}

export class Building {
  readonly group = new THREE.Group();
  private dynamic = new THREE.Group();
  private sides: WallSide[] = [];
  private signCanvas = makeCanvas(1024, 320);
  private signTexture: THREE.CanvasTexture;
  private signBulbs: THREE.Mesh[] = [];
  private bulbOn: THREE.MeshStandardMaterial;
  private bulbOff: THREE.MeshStandardMaterial;
  private time = 0;
  private wallMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  look: CasinoLook;

  constructor(private grid: Grid, look: CasinoLook) {
    this.look = { ...look };
    this.group.name = 'building';
    this.group.add(this.dynamic);
    this.signTexture = canvasTexture(this.signCanvas.canvas);
    this.bulbOn = glow(0xfff1b8, 3.2);
    this.bulbOff = mat(0x6b5a3a, { rough: 0.4 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: look.wallColor, map: wallTexture(), roughness: 0.8 });
    this.trimMat = new THREE.MeshStandardMaterial({ color: look.trimColor, emissive: look.trimColor, emissiveIntensity: 2.2 });
    this.buildStatic();
    this.rebuild();
  }

  /** Street, sidewalk and surroundings that never change. */
  private buildStatic(): void {
    const lot = lotTexture().clone();
    lot.repeat.set(90, 80);
    lot.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 80), mat(0xffffff, { map: lot, rough: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CENTER_X, -0.02, 22);
    ground.receiveShadow = true;
    this.group.add(ground);

    const sw = sidewalkTexture().clone();
    const swLen = 90;
    const swDepth = SIDEWALK_Z1 + 1 - FACADE_Z;
    sw.repeat.set(swLen, swDepth);
    sw.needsUpdate = true;
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(swLen, swDepth), mat(0xffffff, { map: sw, rough: 0.9 }));
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(CENTER_X, 0.001, FACADE_Z + swDepth / 2);
    sidewalk.receiveShadow = true;
    this.group.add(sidewalk);

    const curb = new THREE.Mesh(new THREE.BoxGeometry(swLen, 0.12, 0.25), mat(0xb9b4c2, { rough: 0.8 }));
    curb.position.set(CENTER_X, 0.06, SIDEWALK_Z1 + 1.12);
    this.group.add(curb);

    const asph = asphaltTexture().clone();
    asph.repeat.set(swLen / 2, 4);
    asph.needsUpdate = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(swLen, 8), mat(0xffffff, { map: asph, rough: 0.95 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(CENTER_X, -0.01, SIDEWALK_Z1 + 1.25 + 4);
    road.receiveShadow = true;
    this.group.add(road);

    const dashMat = mat(0xffd23f, { emissive: 0x6b5200, emissiveIntensity: 0.4 });
    const dashGeo = new THREE.PlaneGeometry(1.4, 0.14);
    dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 30);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 30; i++) {
      m4.makeTranslation(CENTER_X - 45 + i * 3 + 1, 0.0, SIDEWALK_Z1 + 5.25);
      dashes.setMatrixAt(i, m4);
    }
    this.group.add(dashes);

    // Street lamps along the curb.
    const poleMat = mat(0x2a2633, { metal: 0.6, rough: 0.4 });
    for (let x = CENTER_X - 30; x <= CENTER_X + 30; x += 7.5) {
      if (Math.abs(x - CENTER_X) < 5) continue;
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), poleMat);
      pole.position.y = 1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), poleMat);
      arm.position.set(0, 3.15, -0.3);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glow(0xffe2a8, 2.6));
      head.position.set(0, 3.05, -0.62);
      lamp.add(pole, arm, head);
      lamp.position.set(x, 0, SIDEWALK_Z1 + 0.85);
      pole.castShadow = true;
      this.group.add(lamp);
    }

    this.buildRoadSign();
  }

  private buildRoadSign(): void {
    const sign = new THREE.Group();
    const w = 5.2;
    const h = 1.62;
    const poleMat = mat(0x2d2438, { metal: 0.7, rough: 0.35 });
    for (const sx of [-w * 0.32, w * 0.32]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 10), poleMat);
      pole.position.set(sx, 1.2, 0);
      pole.castShadow = true;
      sign.add(pole);
    }
    const board = new THREE.Group();
    board.position.set(0, 2.25 + h / 2, 0);
    board.rotation.x = -0.42;
    const back = new THREE.Mesh(new RoundedBoxGeometry(w + 0.3, h + 0.3, 0.18, 3, 0.08), gold());
    back.castShadow = true;
    board.add(back);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: this.signTexture, emissive: 0xffffff, emissiveMap: this.signTexture, emissiveIntensity: 1.25, roughness: 0.5 }),
    );
    face.position.z = 0.095;
    board.add(face);
    // Chasing marquee bulbs around the frame
    const bulbGeo = new THREE.SphereGeometry(0.055, 8, 6);
    const perim: [number, number][] = [];
    const bw = w + 0.14;
    const bh = h + 0.14;
    const nx = 22;
    const ny = 7;
    for (let i = 0; i < nx; i++) perim.push([-bw / 2 + (i / nx) * bw, bh / 2]);
    for (let i = 0; i < ny; i++) perim.push([bw / 2, bh / 2 - (i / ny) * bh]);
    for (let i = 0; i < nx; i++) perim.push([bw / 2 - (i / nx) * bw, -bh / 2]);
    for (let i = 0; i < ny; i++) perim.push([-bw / 2, -bh / 2 + (i / ny) * bh]);
    for (const [x, y] of perim) {
      const b = new THREE.Mesh(bulbGeo, this.bulbOn);
      b.position.set(x, y, 0.12);
      board.add(b);
      this.signBulbs.push(b);
    }
    sign.add(board);
    sign.position.set(CENTER_X + 5.2, 0, SIDEWALK_Z1 + 0.7);
    this.group.add(sign);
    this.redrawSign();
  }

  redrawSign(): void {
    const { canvas, ctx } = this.signCanvas;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1c0b30');
    bg.addColorStop(1, '#0b0414');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255, 210, 110, 0.55)';
    ctx.lineWidth = 6;
    roundRect(ctx, 14, 14, W - 28, H - 28, 26);
    ctx.stroke();
    const color = `#${this.look.signColor.toString(16).padStart(6, '0')}`;
    ctx.font = '400 34px Bungee, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9b0';
    ctx.fillText('★  WELCOME TO  ★', W / 2, 62);
    const font = SIGN_FONTS.find((f) => f.id === this.look.signFont) ?? SIGN_FONTS[0];
    const isScript = font.id === 'pacifico';
    drawNeonText(ctx, this.look.name || 'My Casino', W / 2, H * 0.6, W - 90, isScript ? 120 : 110, font.css, color, font.weight);
    ctx.font = '400 26px Bungee, "Arial Black", sans-serif';
    ctx.fillStyle = 'rgba(255, 233, 176, 0.9)';
    ctx.fillText('OPEN 24/7', W / 2, H - 34);
    this.signTexture.needsUpdate = true;
  }

  setLook(look: Partial<CasinoLook>): void {
    this.look = { ...this.look, ...look };
    this.wallMat.color.setHex(this.look.wallColor);
    this.trimMat.color.setHex(this.look.trimColor);
    this.trimMat.emissive.setHex(this.look.trimColor);
    this.redrawSign();
  }

  /** Rebuild walls and entrance for the current expansion. */
  rebuild(): void {
    for (const c of [...this.dynamic.children]) {
      this.dynamic.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.sides = [];
    const r = this.grid.rect;
    const x0 = r.x0;
    const x1 = r.x1 + 1;
    const z0 = r.z0;
    const z1 = r.z1 + 1;
    const doorL = 23;
    const doorR = 25;

    this.sides.push(this.makeSide('north', [0, -1], [[x0 - WALL_T / 2, z0, x1 + WALL_T / 2, z0]]));
    this.sides.push(this.makeSide('west', [-1, 0], [[x0, z0, x0, z1]]));
    this.sides.push(this.makeSide('east', [1, 0], [[x1, z0, x1, z1]]));
    const south = this.makeSide('south', [0, 1], [
      [x0 - WALL_T / 2, z1, doorL, z1],
      [doorR, z1, x1 + WALL_T / 2, z1],
    ]);
    this.sides.push(south);

    // Door frame
    const frameMat = gold();
    const pillarGeo = new THREE.BoxGeometry(0.3, WALL_H + 0.1, 0.34);
    for (const px of [doorL, doorR]) {
      const p = new THREE.Mesh(pillarGeo, frameMat);
      p.position.set(px, (WALL_H + 0.1) / 2, z1);
      p.castShadow = true;
      p.userData.baseY = p.position.y;
      this.dynamic.add(p);
      south.extras.push(p);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorR - doorL + 0.3, 0.3, 0.36), frameMat);
    lintel.position.set((doorL + doorR) / 2, WALL_H - 0.05, z1);
    lintel.userData.baseY = lintel.position.y;
    this.dynamic.add(lintel);
    south.extras.push(lintel);

    // Red carpet from the curb to the door, with gold rope posts
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2, SIDEWALK_Z1 + 1 - FACADE_Z + 0.2), mat(0xa0101f, { rough: 1 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(CENTER_X, 0.006, FACADE_Z + (SIDEWALK_Z1 + 1 - FACADE_Z) / 2);
    carpet.receiveShadow = true;
    this.dynamic.add(carpet);
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(2.16, SIDEWALK_Z1 + 1 - FACADE_Z + 0.2), mat(0xe8b23a, { rough: 0.6, metal: 0.4 }));
    trim.rotation.x = -Math.PI / 2;
    trim.position.set(CENTER_X, 0.004, carpet.position.z);
    this.dynamic.add(trim);

    // Facade planters on the row in front of the building (not walkable except the door)
    const planterMat = mat(0x2c2433, { rough: 0.7 });
    const bushMat = mat(0x2f7a3a, { rough: 0.9 });
    const bushGeo = new THREE.IcosahedronGeometry(0.34, 1);
    for (let x = x0; x < x1; x++) {
      if (x === 23 || x === 24) continue;
      const planter = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.4, 0.8), planterMat);
      planter.position.set(x + 0.5, 0.2, FACADE_Z + 0.5);
      planter.castShadow = true;
      planter.receiveShadow = true;
      this.dynamic.add(planter);
      const bush = new THREE.Mesh(bushGeo, bushMat);
      bush.position.set(x + 0.5, 0.62, FACADE_Z + 0.5);
      bush.scale.set(1.2, 0.9, 1);
      bush.rotation.y = x * 1.7;
      bush.castShadow = true;
      this.dynamic.add(bush);
    }
    // Rope posts along the carpet
    const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.9, 10);
    const ropeMat = mat(0x9b0f2a, { rough: 0.6 });
    for (const side of [-1, 1]) {
      const px = CENTER_X + side * 1.15;
      const posts: THREE.Vector3[] = [];
      for (let z = FACADE_Z + 1.3; z <= SIDEWALK_Z1 + 0.6; z += 1.7) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(px, 0.45, z);
        this.dynamic.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), frameMat);
        cap.position.set(px, 0.92, z);
        this.dynamic.add(cap);
        posts.push(new THREE.Vector3(px, 0.78, z));
      }
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i];
        const b = posts[i + 1];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 0.18;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.03, 6), ropeMat);
        this.dynamic.add(rope);
      }
    }
  }

  private makeSide(side: Side, normal: [number, number], segs: [number, number, number, number][]): WallSide {
    const ws: WallSide = { side, normal, walls: [], trims: [], extras: [], cut: 0 };
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const geo = new THREE.BoxGeometry(alongX ? len : WALL_T, WALL_H, alongX ? WALL_T : len);
      geo.translate(0, WALL_H / 2, 0);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 2));
      const wall = new THREE.Mesh(geo, this.wallMat);
      wall.position.set((ax + bx) / 2, 0, (az + bz) / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.dynamic.add(wall);
      ws.walls.push(wall);
      const trimGeo = new THREE.BoxGeometry(alongX ? len : 0.07, 0.05, alongX ? 0.07 : len);
      const trim = new THREE.Mesh(trimGeo, this.trimMat);
      trim.position.set(wall.position.x, WALL_H + 0.035, wall.position.z);
      this.dynamic.add(trim);
      ws.trims.push(trim);
      // Baseboard
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? len : WALL_T + 0.06, 0.16, alongX ? WALL_T + 0.06 : len),
        mat(0x1a1020, { rough: 0.5 }),
      );
      base.position.set(wall.position.x, 0.08, wall.position.z);
      this.dynamic.add(base);
    }
    return ws;
  }

  /** Walls between the camera and the floor fold down so the player is never hidden. */
  update(dt: number, camYaw: number): void {
    this.time += dt;
    const cx = Math.sin(camYaw);
    const cz = Math.cos(camYaw);
    for (const s of this.sides) {
      const facing = s.normal[0] * cx + s.normal[1] * cz;
      const target = facing > 0.35 ? 1 : 0;
      s.cut += (target - s.cut) * (1 - Math.exp(-dt * 8));
      const h = WALL_H - (WALL_H - CUT_H) * s.cut;
      const sy = h / WALL_H;
      for (const w of s.walls) w.scale.y = sy;
      for (const t of s.trims) t.position.y = h + 0.035;
      for (const e of s.extras) {
        e.scale.y = sy;
        e.position.y = (e.userData.baseY as number) * sy;
      }
    }
    // Chasing sign bulbs
    const n = this.signBulbs.length;
    const phase = Math.floor(this.time * 9);
    for (let i = 0; i < n; i++) {
      this.signBulbs[i].material = (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn;
    }
  }
}
