import * as THREE from 'three';
import { mat, gold } from '../render/materials';
import { lotTexture, wallTexture } from '../render/textures';
import { CENTER_X, ROAD_MID, type Grid } from './grid';

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

/** Size of the ground plane around the active lot (it covers the whole city). */
const STREET_LEN = 2400;
/** How far the street drops per floor you go up (matches the exterior storeys). */
export const STORY_DROP = 3;

export class Building {
  readonly group = new THREE.Group();
  /** Interior walls: shown while the player is inside, replaced by the exterior shell outside. */
  readonly interior = new THREE.Group();
  /** Ground, road, sidewalks and lamps (lowered when you're upstairs). */
  readonly street = new THREE.Group();
  /** The building's outer walls below an upper floor, dropping away to the street. */
  private drop = new THREE.Group();
  /** Wall piece that closes the doorway on upper floors (it becomes a window). */
  private upperFill: THREE.Object3D[] = [];
  private doorParts: THREE.Object3D[] = [];
  private storey = 0;
  private dynamic = new THREE.Group();
  private sides: WallSide[] = [];
  private wallMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.95 });
  /** An open-air Pool Garden: low hedges instead of walls, no door frame. */
  private garden = false;

  setGarden(on: boolean): void {
    if (on === this.garden) return;
    this.garden = on;
    this.applyGarden();
  }

  private applyGarden(): void {
    for (const s of this.sides) {
      for (const w of s.walls) w.material = this.garden ? this.hedgeMat : this.wallMat;
      for (const t of s.trims) t.visible = !this.garden;
      for (const e of s.extras) e.visible = !this.garden && (this.doorParts.includes(e) ? this.storey === 0 : this.storey > 0);
    }
  }
  look: CasinoLook;

  constructor(private grid: Grid, look: CasinoLook) {
    this.look = { ...look };
    this.group.name = 'building';
    this.interior.add(this.dynamic);
    this.group.add(this.interior, this.street, this.drop);
    this.wallMat = new THREE.MeshStandardMaterial({ color: look.wallColor, map: wallTexture(), roughness: 0.8 });
    this.trimMat = new THREE.MeshStandardMaterial({ color: look.trimColor, emissive: look.trimColor, emissiveIntensity: 1.7 });
    this.buildStreet();
    this.rebuild();
  }

  /** Bare ground under the whole city (the roads themselves are drawn by the city view). */
  private buildStreet(): void {
    const lot = lotTexture().clone();
    lot.repeat.set(STREET_LEN / 2, STREET_LEN / 2);
    lot.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(STREET_LEN, STREET_LEN), mat(0xffffff, { map: lot, rough: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CENTER_X, -0.03, ROAD_MID);
    ground.receiveShadow = true;
    this.street.add(ground);
  }

  setLook(look: Partial<CasinoLook>): void {
    this.look = { ...this.look, ...look };
    this.wallMat.color.setHex(this.look.wallColor);
    this.trimMat.color.setHex(this.look.trimColor);
    this.trimMat.emissive.setHex(this.look.trimColor);
  }

  /** Rebuild interior walls and the door frame for the current lot size. */
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
    const doorL = CENTER_X - 1;
    const doorR = CENTER_X + 1;

    this.sides.push(this.makeSide('north', [0, -1], [[x0 - WALL_T / 2, z0, x1 + WALL_T / 2, z0]]));
    this.sides.push(this.makeSide('west', [-1, 0], [[x0, z0, x0, z1]]));
    this.sides.push(this.makeSide('east', [1, 0], [[x1, z0, x1, z1]]));
    const south = this.makeSide('south', [0, 1], [
      [x0 - WALL_T / 2, z1, doorL, z1],
      [doorR, z1, x1 + WALL_T / 2, z1],
    ]);
    this.sides.push(south);

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
    this.doorParts = [...south.extras];

    // Upstairs the doorway is a picture window over the street.
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(doorR - doorL, WALL_H * 0.62, 0.06), glassMat);
    glass.position.set(CENTER_X, WALL_H * 0.5, z1);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(doorR - doorL + 0.2, WALL_H * 0.19, WALL_T), this.wallMat);
    sill.position.set(CENTER_X, WALL_H * 0.095, z1);
    const head = sill.clone();
    head.position.y = WALL_H * (1 - 0.095);
    for (const m of [glass, sill, head]) {
      m.userData.baseY = m.position.y;
      this.dynamic.add(m);
      south.extras.push(m);
    }
    this.upperFill = [glass, sill, head];

    // Outer walls running down to the street, seen past the folded walls upstairs.
    for (const c of [...this.drop.children]) {
      this.drop.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const dropMat = new THREE.MeshStandardMaterial({ color: 0x1a1424, roughness: 0.9 });
    const bandMat = this.trimMat;
    const w = x1 - x0;
    const d = z1 - z0;
    for (const [cx, cz, sx, sz] of [[(x0 + x1) / 2, z1, w + 0.4, 0.4], [(x0 + x1) / 2, z0, w + 0.4, 0.4], [x0, (z0 + z1) / 2, 0.4, d], [x1, (z0 + z1) / 2, 0.4, d]] as const) {
      const g = new THREE.BoxGeometry(sx, 1, sz);
      g.translate(0, -0.5, 0);
      const m = new THREE.Mesh(g, dropMat);
      m.position.set(cx, -0.02, cz);
      this.drop.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.05, 0.12, sz + 0.05), bandMat);
      band.position.set(cx, -0.08, cz);
      band.userData.band = true;
      this.drop.add(band);
    }
    this.setStorey(this.storey);
    this.applyGarden();
  }

  /** You're on floor `f`: drop the street away below and turn the door into a window. */
  setStorey(f: number): void {
    this.storey = f;
    const depth = f * STORY_DROP;
    this.street.position.y = -depth;
    this.drop.visible = f > 0;
    for (const c of this.drop.children) if (!c.userData.band) c.scale.y = Math.max(0.01, depth);
    for (const p of this.doorParts) p.visible = f === 0;
    for (const p of this.upperFill) p.visible = f > 0;
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
  update(dt: number, camYaw: number, camPitchLow = false, full = false): void {
    const cx = Math.sin(camYaw);
    const cz = Math.cos(camYaw);
    for (const s of this.sides) {
      const facing = s.normal[0] * cx + s.normal[1] * cz;
      // Through your own eyes every wall stands full height.
      const target = !full && facing > (camPitchLow ? 0.1 : 0.35) ? 1 : 0;
      s.cut += (target - s.cut) * (1 - Math.exp(-dt * 8));
      const top = this.garden ? 0.9 : WALL_H;
      const h = top - (top - CUT_H) * s.cut;
      const sy = h / WALL_H;
      for (const w of s.walls) w.scale.y = sy;
      for (const t of s.trims) t.position.y = h + 0.035;
      for (const e of s.extras) {
        e.scale.y = sy;
        e.position.y = (e.userData.baseY as number) * sy;
      }
    }
  }
}
