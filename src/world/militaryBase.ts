import * as THREE from 'three';
import { mat, glow } from '../render/materials';
import { asphaltTexture, canvasTexture, makeCanvas } from '../render/textures';
import { CharacterModel } from '../entities/characterModel';
import { defaultAppearance, SKIN_TONES, type Appearance } from '../entities/appearance';
import { buildGun } from '../items/models/guns';
import { gunDef } from '../game/guns';
import { cityX, cityZ } from './city';
import { RING } from './outskirts';
import { audio } from '../core/audio';

/** Half size of the base (metres) and the gate's half width. */
export const BASE_HW = 55;
export const BASE_HD = 45;
const GATE = 6;

/**
 * Where the base sits (global frame): out in the western desert, past the ring road, with a
 * road from the ring to its gate. Kept clear of rocks and cacti by the outskirts.
 */
export function baseSite(cols: number): { cx: number; cz: number; roadX0: number; roadX1: number } {
  const [x0] = cityX(cols);
  const [z0, z1] = cityZ();
  const cx = x0 - RING - 120;
  const cz = (z0 + z1) / 2;
  return { cx, cz, roadX0: cx + BASE_HW, roadX1: x0 - RING - 5 };
}

/** Is this point inside the base, or on its access road (keep the scenery off it)? */
export function inBaseArea(gx: number, gz: number, cols: number, pad = 6): boolean {
  const s = baseSite(cols);
  if (Math.abs(gx - s.cx) < BASE_HW + pad && Math.abs(gz - s.cz) < BASE_HD + pad) return true;
  return gx > s.roadX0 - pad && gx < s.roadX1 + pad && Math.abs(gz - s.cz) < 6 + pad;
}

/** A soldier guarding the base (global frame; tower guards stand up high). */
export interface Soldier {
  model: CharacterModel;
  x: number;
  z: number;
  y: number;
  hp: number;
  ko: number;
  cool: number;
  /** Patrol: walks between these two points while it's quiet. */
  a: { x: number; z: number };
  b: { x: number; z: number };
  toB: boolean;
  tower: boolean;
  side: number;
  sideT: number;
}

/** A parking spot for a vehicle you can steal (local to the base centre). */
interface Slot {
  id: string;
  lx: number;
  lz: number;
  yaw: number;
  /** The vehicle sitting there now (a Driving vehicle uid), and seconds until a new one. */
  uid: number | null;
  respawn: number;
}

/** What the base needs from the game (kept small so the base stays testable). */
export interface BaseHost {
  /** You (global frame), whether you're out where soldiers can shoot, and your car if driving. */
  player(): { x: number; z: number; exposed: boolean; height: number; car: { x: number; z: number; uid: number; armor: number } | null };
  /** Can soldiers see from a to b (buildings block the view)? */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean;
  /** Can a soldier stand here? */
  walkable(x: number, z: number): boolean;
  toWorld(x: number, z: number): { x: number; z: number };
  /** A soldier shot at you (hit or miss), or at your car. */
  shot(hit: boolean, dmg: number, fromX: number, fromZ: number, fromY: number): void;
  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  /** Park a vehicle from the catalog at a spot; returns its uid. */
  spawnVehicle(id: string, x: number, z: number, yaw: number): number | null;
  /** Is the vehicle with this uid still parked here (not taken or wrecked)? */
  vehicleParked(uid: number): boolean;
  /** The alarm went off: the police are told (wanted level). */
  alarm(first: boolean): void;
  notify(text: string, kind: 'good' | 'bad' | 'info'): void;
}

function soldierLook(): Appearance {
  const a = defaultAppearance();
  a.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
  a.top = 'jacket';
  a.topColor = 0x4b5320;
  a.accentColor = 0x3a3f22;
  a.bottom = 'pants';
  a.bottomColor = 0x5a5a3a;
  a.shoeColor = 0x2a2016;
  a.hat = 'hardhat';
  a.hatColor = 0x4b5320;
  a.neck = 'none';
  a.eyewear = Math.random() < 0.4 ? 'aviators' : 'none';
  a.facialHair = 'none';
  a.hair = 'buzz';
  a.prop = 'none';
  a.blush = false;
  return a;
}

/**
 * Fort Mojave: a military base in the western desert, GTA style. A fence with a guarded
 * gate, watchtowers, hangars, barracks, a control tower and a helipad, and parked on the
 * apron the vehicles nobody will sell you: a tank, an APC, army jeeps and a prototype stealth
 * racer in the back hangar. Walk in and you're warned; stay, shoot or take a vehicle and the
 * alarm goes off: the soldiers open fire and the police come. Drive what you took into your
 * garage to keep it. Taken vehicles are replaced after a while.
 */
export class MilitaryBase {
  readonly group = new THREE.Group();
  readonly soldiers: Soldier[] = [];
  private cols = -1;
  private cx = 0;
  private cz = 0;
  /** Solid things (global rects: x0, x1, z0, z1) and round ones. */
  private rects: [number, number, number, number][] = [];
  private circles: { x: number; z: number; r: number }[] = [];
  private slots: Slot[] = [];
  private radar: THREE.Object3D | null = null;
  private rotor: THREE.Object3D | null = null;
  private lights: THREE.Mesh[] = [];
  /** Seconds left of the alarm (0 = quiet). */
  alarmT = 0;
  /** Seconds you've been inside without permission (a warning first). */
  private trespass = 0;
  private warned = false;
  private sirenT = 0;
  private t = 0;
  private flash: THREE.Sprite | null = null;
  private flashT = 0;

  constructor(private host: BaseHost) {}

  get alarm(): boolean {
    return this.alarmT > 0;
  }

  get center(): { x: number; z: number } {
    return { x: this.cx, z: this.cz };
  }

  /** Inside the fence? (global) */
  inside(gx: number, gz: number): boolean {
    return Math.abs(gx - this.cx) < BASE_HW && Math.abs(gz - this.cz) < BASE_HD;
  }

  /** Fence, walls and buildings (global): nobody walks or drives through these. */
  blocked(gx: number, gz: number): boolean {
    if (Math.abs(gx - this.cx) > BASE_HW + 2 || Math.abs(gz - this.cz) > BASE_HD + 2) return false;
    for (const [a, b, c, d] of this.rects) if (gx > a && gx < b && gz > c && gz < d) return true;
    for (const c of this.circles) if ((gx - c.x) ** 2 + (gz - c.z) ** 2 < c.r * c.r) return true;
    return false;
  }

  private rect(lx0: number, lx1: number, lz0: number, lz1: number): void {
    this.rects.push([this.cx + lx0, this.cx + lx1, this.cz + lz0, this.cz + lz1]);
  }

  /** (Re)build for a city this many lots wide. */
  build(cols: number): void {
    if (cols === this.cols) return;
    this.cols = cols;
    const s = baseSite(cols);
    this.cx = s.cx;
    this.cz = s.cz;
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const so of this.soldiers) so.model.dispose();
    this.soldiers.length = 0;
    this.rects = [];
    this.circles = [];
    this.lights = [];
    this.buildGround(s.roadX0, s.roadX1);
    this.buildFence();
    this.buildBuildings();
    this.buildSoldiers();
    this.slots = [
      { id: 'tank', lx: -25, lz: -2, yaw: 0, uid: null, respawn: 0 },
      { id: 'apc', lx: -2, lz: -12, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'jeep', lx: 10, lz: 6, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'jeep', lx: 10, lz: 12, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'stealth', lx: -25, lz: 25, yaw: Math.PI, uid: null, respawn: 0 },
    ];
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd28a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.scale.setScalar(0.6);
    f.visible = false;
    this.flash = f;
    this.group.add(f);
  }

  private buildGround(roadX0: number, roadX1: number): void {
    const { cx, cz } = this;
    const tex = asphaltTexture().clone();
    tex.repeat.set(BASE_HW / 4, BASE_HD / 4);
    tex.needsUpdate = true;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(BASE_HW * 2, BASE_HD * 2), new THREE.MeshStandardMaterial({ map: tex, color: 0xb8b0a0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, -0.025, cz);
    pad.receiveShadow = true;
    this.group.add(pad);
    // Access road from the ring road to the gate.
    const len = roadX1 - roadX0;
    const rt = asphaltTexture().clone();
    rt.repeat.set(len / 6, 2);
    rt.needsUpdate = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(len, 10), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set((roadX0 + roadX1) / 2, -0.024, cz);
    road.receiveShadow = true;
    this.group.add(road);
    // Painted parking bays and a big yellow line on the apron.
    const paint = mat(0xffd23f, { rough: 0.8 });
    for (const [lx, lz, w, d] of [[-25, -2, 0.2, 9], [-10, 0, 40, 0.2], [10, 9, 8, 0.2], [-2, -12, 0.2, 8]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx + lx, -0.015, cz + lz);
      this.group.add(m);
    }
    // Sign at the side of the road.
    const sign = new THREE.Group();
    const { canvas, ctx } = makeCanvas(512, 192);
    ctx.fillStyle = '#2f3520';
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 176);
    ctx.fillStyle = '#e8e0c8';
    ctx.textAlign = 'center';
    ctx.font = '900 54px Arial, sans-serif';
    ctx.fillText('FORT MOJAVE', 256, 80);
    ctx.fillStyle = '#ff5a3a';
    ctx.font = '800 30px Arial, sans-serif';
    ctx.fillText('RESTRICTED · NO ENTRY', 256, 138);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), side: THREE.DoubleSide }));
    board.position.y = 2.4;
    sign.add(board);
    for (const dx of [-2.2, 2.2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), mat(0x5a5d66, { metal: 0.5 }));
      p.position.set(dx, 1.2, 0);
      sign.add(p);
    }
    sign.position.set(roadX0 + 14, 0, cz - 8.5);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);
    this.circles.push({ x: roadX0 + 14, z: cz - 8.5 - 2.2, r: 0.4 }, { x: roadX0 + 14, z: cz - 8.5 + 2.2, r: 0.4 });
  }

  private buildFence(): void {
    const { cx, cz } = this;
    // Chain link: a see-through diamond mesh texture.
    const { canvas, ctx } = makeCanvas(64, 64);
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(200,205,210,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(64, 64);
    ctx.moveTo(64, 0);
    ctx.lineTo(0, 64);
    ctx.stroke();
    const tex = canvasTexture(canvas, true);
    const H = 3.2;
    const fenceMat = (len: number) => {
      const t = tex.clone();
      t.repeat.set(len / 0.6, H / 0.6);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    };
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, H + 0.4, 6);
    const postMat = mat(0x8a8f96, { metal: 0.6, rough: 0.4 });
    const wire = mat(0x2a2c30, { metal: 0.5, rough: 0.5 });
    const posts: THREE.Matrix4[] = [];
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H), fenceMat(len));
      panel.position.set(cx + (x0 + x1) / 2, H / 2, cz + (z0 + z1) / 2);
      panel.rotation.y = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : Math.PI / 2;
      this.group.add(panel);
      const top = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.08, 0.1, Math.abs(z1 - z0) + 0.08), wire);
      top.position.set(cx + (x0 + x1) / 2, H + 0.25, cz + (z0 + z1) / 2);
      this.group.add(top);
      for (let i = 0; i <= Math.ceil(len / 3); i++) {
        const u = i / Math.ceil(len / 3);
        posts.push(new THREE.Matrix4().makeTranslation(cx + x0 + (x1 - x0) * u, (H + 0.4) / 2, cz + z0 + (z1 - z0) * u));
      }
      const t = 0.3;
      this.rect(Math.min(x0, x1) - t, Math.max(x0, x1) + t, Math.min(z0, z1) - t, Math.max(z0, z1) + t);
    };
    run(-BASE_HW, -BASE_HD, BASE_HW, -BASE_HD);
    run(-BASE_HW, BASE_HD, BASE_HW, BASE_HD);
    run(-BASE_HW, -BASE_HD, -BASE_HW, BASE_HD);
    run(BASE_HW, -BASE_HD, BASE_HW, -GATE);
    run(BASE_HW, GATE, BASE_HW, BASE_HD);
    const pi = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach((m, i) => pi.setMatrixAt(i, m));
    pi.castShadow = true;
    this.group.add(pi);
    // Gate: a striped boom (raised) and a guard booth.
    const boom = new THREE.Group();
    const stripes = makeCanvas(256, 16);
    for (let i = 0; i < 8; i++) {
      stripes.ctx.fillStyle = i % 2 ? '#f4f1ea' : '#c8102e';
      stripes.ctx.fillRect(i * 32, 0, 32, 16);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, GATE * 2 - 0.6), new THREE.MeshStandardMaterial({ map: canvasTexture(stripes.canvas) }));
    arm.position.set(0, 0, GATE - 0.3);
    boom.add(arm);
    boom.position.set(cx + BASE_HW + 0.6, 1.1, cz - GATE);
    boom.rotation.x = -1.2;
    this.group.add(boom);
    this.box(mat(0x6b6f58, { rough: 0.8 }), 2.6, 2.6, 2.6, BASE_HW - 3, 1.3, GATE + 3.2, true);
    this.box(glow(0xfff2c8, 1.2), 2.0, 0.6, 0.05, BASE_HW - 3, 1.8, GATE + 1.88, false);
    // Sandbag nests either side of the gate.
    const bag = mat(0xb59a6a, { rough: 1 });
    for (const sz of [-1, 1]) this.box(bag, 3.2, 1.0, 1.0, BASE_HW - 6, 0.5, sz * (GATE + 8), true);
  }

  /** A box in base-local coordinates (optionally solid). */
  private box(m: THREE.Material, w: number, h: number, d: number, lx: number, y: number, lz: number, solid: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(this.cx + lx, y, this.cz + lz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (solid) this.rect(lx - w / 2, lx + w / 2, lz - d / 2, lz + d / 2);
    return mesh;
  }

  private buildBuildings(): void {
    const { cx, cz } = this;
    const olive = mat(0x5f6648, { rough: 0.85 });
    const tan = mat(0xb5a27a, { rough: 0.9 });
    const steel = mat(0x8c9099, { metal: 0.55, rough: 0.45 });
    const dark = mat(0x23252a, { rough: 0.7 });
    // Two hangars facing each other across the apron: open fronts, curved roofs.
    const hangar = (lz: number, face: 1 | -1) => {
      const W = 22;
      const D = 16;
      const back = lz - face * D / 2;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, D, 24, 1, true, -Math.PI / 2, Math.PI), steel);
      roof.material = mat(0x7d8270, { metal: 0.4, rough: 0.6, side: THREE.DoubleSide });
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.75);
      roof.position.set(cx - 25, 2.5, cz + lz);
      roof.castShadow = true;
      this.group.add(roof);
      // Back wall (a half disc on a base) and low side walls.
      const backWall = new THREE.Mesh(new THREE.CircleGeometry(W / 2, 24, 0, Math.PI), mat(0x6f7462, { rough: 0.8, side: THREE.DoubleSide }));
      backWall.scale.set(1, 0.75, 1);
      backWall.position.set(cx - 25, 2.5, cz + back);
      this.group.add(backWall);
      this.box(olive, W, 2.5, 0.4, -25, 1.25, back, true);
      for (const sx of [-1, 1]) this.box(olive, 0.4, 2.5, D, -25 + sx * W / 2, 1.25, lz, true);
      // Big number and lamps over the door
      this.box(glow(0xfff2c8, 1.6), 3, 0.3, 0.3, -25, 9.2, lz + face * D / 2, false);
    };
    hangar(-23, 1);
    hangar(25, -1);
    // Barracks: a long low building with windows, and a radar dish on the roof.
    this.box(tan, 26, 4, 8, 22, 2, -32, true);
    this.box(dark, 26.4, 0.3, 8.4, 22, 4.15, -32, false);
    for (let i = 0; i < 8; i++) this.box(glow(0xffe8b0, 0.6), 1.4, 1, 0.05, 11 + i * 3.1, 2.4, -27.97, false);
    this.box(dark, 1.6, 2.4, 0.05, 22, 1.2, -27.97, false);
    const radar = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3), mat(0xe9e6dc, { rough: 0.5, side: THREE.DoubleSide }));
    dish.rotation.x = -Math.PI / 2 + 0.5;
    dish.position.y = 1.4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.4, 8), steel);
    mast.position.y = 0.7;
    radar.add(mast, dish);
    radar.position.set(cx + 30, 4.3, cz - 32);
    this.group.add(radar);
    this.radar = radar;
    // Control tower with a glass cab.
    this.box(tan, 6, 12, 6, 30, 6, 28, true);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.6, 3, 8), new THREE.MeshStandardMaterial({ color: 0x2a5a6a, metalness: 0.7, roughness: 0.1, emissive: 0x08202a }));
    cab.position.set(cx + 30, 13.5, cz + 28);
    this.group.add(cab);
    const capRoof = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.4, 8), dark);
    capRoof.position.set(cx + 30, 15.2, cz + 28);
    this.group.add(capRoof);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), glow(0xff2a2a, 3));
    beacon.position.set(cx + 30, 15.7, cz + 28);
    this.group.add(beacon);
    this.lights.push(beacon);
    // Helipad with a parked helicopter, its rotor turning slowly.
    const padTex = makeCanvas(256, 256);
    padTex.ctx.fillStyle = '#3a3c40';
    padTex.ctx.beginPath();
    padTex.ctx.arc(128, 128, 126, 0, Math.PI * 2);
    padTex.ctx.fill();
    padTex.ctx.strokeStyle = '#f4f1ea';
    padTex.ctx.lineWidth = 10;
    padTex.ctx.beginPath();
    padTex.ctx.arc(128, 128, 100, 0, Math.PI * 2);
    padTex.ctx.stroke();
    padTex.ctx.fillStyle = '#f4f1ea';
    padTex.ctx.font = '900 130px Arial, sans-serif';
    padTex.ctx.textAlign = 'center';
    padTex.ctx.textBaseline = 'middle';
    padTex.ctx.fillText('H', 128, 136);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshStandardMaterial({ map: canvasTexture(padTex.canvas), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx + 8, -0.01, cz + 30);
    this.group.add(pad);
    const heli = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), mat(0x4b5320, { rough: 0.7 }));
    body.scale.set(1, 0.85, 1.6);
    body.position.y = 1.5;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), new THREE.MeshStandardMaterial({ color: 0x1b2a33, metalness: 0.7, roughness: 0.1 }));
    glass.scale.set(1, 0.8, 1);
    glass.position.set(0, 1.75, 1.5);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 5, 8), mat(0x4b5320, { rough: 0.7 }));
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 1.8, -3.6);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), mat(0x4b5320, { rough: 0.7 }));
    fin.position.set(0, 2.3, -6);
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.4), dark);
      skid.position.set(sx * 1.1, 0.1, 0);
      heli.add(skid);
    }
    const rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 5.5), dark);
      blade.position.z = 2.75;
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI) / 2;
      arm.add(blade);
      rotor.add(arm);
    }
    rotor.position.y = 2.9;
    heli.add(body, glass, tail, fin, rotor);
    heli.position.set(cx + 8, 0, cz + 30);
    heli.rotation.y = -0.6;
    this.group.add(heli);
    this.rotor = rotor;
    this.circles.push({ x: cx + 8, z: cz + 30, r: 2.4 });
    // Watchtowers in the corners.
    for (const [lx, lz] of [[-BASE_HW + 4, -BASE_HD + 4], [-BASE_HW + 4, BASE_HD - 4], [BASE_HW - 4, -BASE_HD + 4], [BASE_HW - 4, BASE_HD - 4]] as const) {
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(dark, 0.2, 6, 0.2, lx + ox * 1.3, 3, lz + oz * 1.3, false);
      this.box(olive, 3.4, 0.3, 3.4, lx, 6, lz, false);
      this.box(olive, 3.4, 1.0, 0.1, lx, 6.6, lz - 1.65, false);
      this.box(olive, 3.4, 1.0, 0.1, lx, 6.6, lz + 1.65, false);
      this.box(dark, 3.8, 0.2, 3.8, lx, 8.4, lz, false);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(dark, 0.12, 2.1, 0.12, lx + ox * 1.6, 7.3, lz + oz * 1.6, false);
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.5, 10), glow(0xfff6dc, 2.5));
      spot.rotation.x = Math.PI / 2;
      spot.position.set(cx + lx, 7.6, cz + lz);
      this.group.add(spot);
      this.lights.push(spot);
      this.circles.push({ x: cx + lx, z: cz + lz, r: 1.8 });
    }
    // Fuel drums and crates.
    const drum = mat(0x3d5a2a, { rough: 0.6, metal: 0.3 });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 12), drum);
      d.position.set(cx + 42 + (i % 3) * 0.8, 0.48, cz - 14 + Math.floor(i / 3) * 0.8);
      d.castShadow = true;
      this.group.add(d);
    }
    this.rect(41.5, 44.2, -14.5, -12.6);
    const crate = mat(0x7a6a3a, { rough: 0.9 });
    for (const [lx, lz] of [[40, 18], [41.3, 18], [40.6, 19.3]] as const) this.box(crate, 1.2, 1.2, 1.2, lx, 0.6, lz, true);
  }

  private addSoldier(lx: number, lz: number, tower: boolean, ax = lx, az = lz, bx = lx, bz = lz): void {
    const model = new CharacterModel(soldierLook(), { castShadow: false });
    const gun = buildGun(gunDef('rifle')!);
    model.hand.add(gun.group);
    model.aim = 2;
    const x = this.cx + lx;
    const z = this.cz + lz;
    const y = tower ? 6.15 : 0;
    model.root.position.set(x, y, z);
    this.group.add(model.root);
    this.soldiers.push({
      model, x, z, y, hp: 120, ko: 0, cool: 1 + Math.random(), tower, toB: true, side: 1, sideT: 0,
      a: { x: this.cx + ax, z: this.cz + az }, b: { x: this.cx + bx, z: this.cz + bz },
    });
  }

  private buildSoldiers(): void {
    // Gate guards, a patrol along the apron, one by the hangars and the towers.
    this.addSoldier(BASE_HW - 4, -GATE - 2, false);
    this.addSoldier(BASE_HW - 4, GATE + 6, false);
    this.addSoldier(0, 18, false, -10, 18, 30, 18);
    this.addSoldier(-10, -8, false, -10, -8, -10, 10);
    this.addSoldier(20, -24, false, 5, -24, 38, -24);
    for (const [lx, lz] of [[-BASE_HW + 4, -BASE_HD + 4], [-BASE_HW + 4, BASE_HD - 4], [BASE_HW - 4, -BASE_HD + 4], [BASE_HW - 4, BASE_HD - 4]] as const) this.addSoldier(lx, lz, true);
  }

  /** Set off the alarm (or keep it ringing). */
  raise(reason?: string): void {
    const first = this.alarmT <= 0;
    this.alarmT = 90;
    this.trespass = 99;
    if (first) {
      audio.play('alarm');
      this.host.notify(reason ?? 'The base alarm is going off! Soldiers are opening fire.', 'bad');
    }
    this.host.alarm(first);
  }

  /** All the cars were cleared off the map (new game, loaded save): park fresh ones. */
  resetVehicles(): void {
    for (const s of this.slots) {
      s.uid = null;
      s.respawn = 0;
    }
  }

  /** A vehicle was taken from the apron. */
  vehicleTaken(name: string): void {
    this.raise(`You took the ${name} from Fort Mojave! The army is shooting and the police are coming. Get it into your garage to keep it.`);
  }

  /** Soldiers along a ray (global frame, unit direction), nearest first, with their feet height. */
  raycast(ox: number, oz: number, dx: number, dz: number, maxS: number): { soldier: Soldier; s: number }[] {
    const out: { soldier: Soldier; s: number }[] = [];
    for (const so of this.soldiers) {
      if (so.ko > 0) continue;
      const px = so.x - ox;
      const pz = so.z - oz;
      const s = px * dx + pz * dz;
      if (s < 0.2 || s > maxS) continue;
      if (Math.hypot(px - dx * s, pz - dz * s) < 0.4) out.push({ soldier: so, s });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /** You hit a soldier. Returns true if they went down. */
  damage(so: Soldier, dmg: number): boolean {
    if (so.ko > 0 || dmg <= 0) return false;
    so.hp -= dmg;
    so.model.flinch = 1;
    this.raise();
    if (so.hp > 0) return false;
    so.ko = 25;
    so.model.aim = 0;
    so.model.setPose('ko');
    if (so.tower) {
      // Falls from the tower.
      so.y = 0;
      so.model.root.position.y = 0;
    }
    return true;
  }

  /** An explosion (global frame): soldiers nearby go down; inside the fence it sets off the alarm. */
  blast(x: number, z: number, radius: number, power: number, byPlayer: boolean): void {
    let hitAny = false;
    for (const so of this.soldiers) {
      const d = Math.hypot(so.x - x, so.z - z);
      if (d < radius && so.ko <= 0) {
        hitAny = true;
        so.hp -= power * 2 * (1 - d / radius);
        if (so.hp <= 0) {
          so.ko = 25;
          so.model.aim = 0;
          so.model.setPose('ko');
          so.y = 0;
        }
      }
    }
    if (byPlayer && (hitAny || this.inside(x, z))) this.raise();
  }

  /** Soldiers for the minimap. */
  get dots(): { x: number; z: number }[] {
    return this.soldiers.filter((s) => s.ko <= 0).map((s) => ({ x: s.x, z: s.z }));
  }

  update(dt: number, cols: number, near: boolean): void {
    this.build(cols);
    this.t += dt;
    const h = this.host;
    const p = h.player();
    const dist = Math.hypot(p.x - this.cx, p.z - this.cz);
    this.group.visible = dist < 420;
    if (this.radar) this.radar.rotation.y += dt * 0.8;
    if (this.rotor) this.rotor.rotation.y += dt * 0.6;
    const blink = this.alarmT > 0 ? Math.floor(this.t * 4) % 2 === 0 : (this.t % 2) < 0.4;
    for (const l of this.lights) l.visible = this.alarmT > 0 ? blink : true;
    this.flashT -= dt;
    if (this.flash) this.flash.visible = this.flashT > 0;
    // Vehicles: park new ones where they're missing, once you're well away.
    for (const s of this.slots) {
      if (s.uid !== null && !h.vehicleParked(s.uid)) {
        s.uid = null;
        s.respawn = 240;
      }
      if (s.uid === null) {
        s.respawn -= dt;
        if (s.respawn <= 0 && dist > 150) s.uid = h.spawnVehicle(s.id, this.cx + s.lx, this.cz + s.lz, s.yaw);
      }
    }
    if (!near && dist > 200) {
      // Out of range: the base settles down, knocked-out soldiers are replaced.
      this.alarmT = Math.max(0, this.alarmT - dt * 3);
      this.trespass = 0;
      this.warned = false;
      if (this.alarmT <= 0) {
        for (const so of this.soldiers) {
          if (so.ko > 0) {
            so.ko = 0;
            so.hp = 120;
            so.model.setPose('idle');
            so.model.aim = 2;
            so.y = so.tower ? 6.15 : 0;
          }
        }
      }
      return;
    }
    // Trespassing: a warning, then the alarm.
    const inside = this.inside(p.x, p.z);
    if (inside && this.alarmT <= 0) {
      this.trespass += dt;
      if (!this.warned) {
        this.warned = true;
        audio.play('alarm');
        h.notify('⚠ Fort Mojave is a restricted military area. Leave now or you will be shot!', 'bad');
      }
      if (this.trespass > 8) this.raise();
    } else if (!inside && this.alarmT <= 0) {
      this.trespass = Math.max(0, this.trespass - dt);
      if (this.trespass <= 0) this.warned = false;
    }
    if (this.alarmT > 0) {
      // The alarm keeps ringing while you're around.
      if (dist > 160) this.alarmT = Math.max(0, this.alarmT - dt);
      this.sirenT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = 2.2;
        const w = h.toWorld(this.cx + 30, this.cz + 28);
        audio.playAt('alarm', w.x, w.z, 0.9);
      }
    }
    this.updateSoldiers(dt, p);
  }

  private updateSoldiers(dt: number, p: ReturnType<BaseHost['player']>): void {
    const h = this.host;
    for (const so of this.soldiers) {
      const m = so.model;
      if (so.ko > 0) {
        so.ko -= dt;
        m.setPose('ko');
        m.root.position.set(so.x, 0, so.z);
        m.update(dt);
        if (so.ko <= 0) {
          // Back up (reinforcements) while the alarm rings.
          so.ko = 0;
          so.hp = 120;
          so.y = so.tower ? 6.15 : 0;
          m.setPose('idle');
          m.aim = 2;
        }
        continue;
      }
      const dx = p.x - so.x;
      const dz = p.z - so.z;
      const dist = Math.hypot(dx, dz);
      let moving = false;
      if (this.alarmT > 0 && p.exposed) {
        const sees = dist < 70 && (so.tower || h.lineOfSight(so.x, so.z, p.x, p.z));
        // Close in (but not far outside the fence), then hold and fire.
        if (!so.tower && (!sees || dist > 24) && dist > 0.1) {
          const nx = so.x + (dx / dist) * 4 * dt;
          const nz = so.z + (dz / dist) * 4 * dt;
          const leash = Math.abs(nx - this.cx) < BASE_HW + 40 && Math.abs(nz - this.cz) < BASE_HD + 40;
          if (leash) moving = this.step(so, dx / dist, dz / dist, 4 * dt);
        }
        m.root.rotation.y = Math.atan2(dx, dz);
        so.cool -= dt;
        if (sees && so.cool <= 0) this.fire(so, p, dist);
      } else if (!so.tower) {
        // Patrol.
        const tgt = so.toB ? so.b : so.a;
        const tx = tgt.x - so.x;
        const tz = tgt.z - so.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.5) so.toB = !so.toB;
        else {
          moving = this.step(so, tx / d, tz / d, 1.3 * dt);
          m.root.rotation.y = Math.atan2(tx, tz);
        }
      } else if (dist < 60) m.root.rotation.y = Math.atan2(dx, dz);
      m.root.position.set(so.x, so.y, so.z);
      m.setPose(moving ? (this.alarmT > 0 ? 'run' : 'walk') : 'idle');
      m.moveSpeed = this.alarmT > 0 ? 2.4 : 1.2;
      m.aim = this.alarmT > 0 ? 2 : 0;
      m.update(dt);
    }
  }

  private step(so: Soldier, dx: number, dz: number, step: number): boolean {
    const h = this.host;
    const tryMove = (ax: number, az: number) => {
      const nx = so.x + ax * step;
      const nz = so.z + az * step;
      if (!h.walkable(nx, nz)) return false;
      so.x = nx;
      so.z = nz;
      return true;
    };
    if (so.sideT > 0) {
      so.sideT -= step;
      if (tryMove(-dz * so.side, dx * so.side)) return true;
    }
    if (tryMove(dx, dz)) return true;
    so.side = Math.random() < 0.5 ? 1 : -1;
    so.sideT = 3;
    return tryMove(-dz * so.side, dx * so.side);
  }

  private fire(so: Soldier, p: ReturnType<BaseHost['player']>, dist: number): void {
    so.cool = 0.7 + Math.random() * 0.7;
    so.model.recoil = 0.5;
    const chance = Math.max(0.1, Math.min(0.5, 0.55 - dist * 0.012));
    const hit = Math.random() < chance;
    const ay = so.y + 1.3;
    const fx = so.x + Math.sin(so.model.root.rotation.y) * 0.7;
    const fz = so.z + Math.cos(so.model.root.rotation.y) * 0.7;
    const miss = hit ? 0 : 0.6 + Math.random() * 1.4;
    const side = Math.random() < 0.5 ? 1 : -1;
    const tx = p.x + (dist > 0 ? (-(p.z - so.z) / dist) * miss * side : 0);
    const tz = p.z + (dist > 0 ? ((p.x - so.x) / dist) * miss * side : 0);
    if (this.flash) {
      this.flash.position.set(fx, ay, fz);
      this.flashT = 0.05;
    }
    this.host.tracer(fx, ay, fz, tx, hit ? p.height * 0.7 : 0.4 + Math.random() * 1.4, tz);
    const w = this.host.toWorld(so.x, so.z);
    audio.playAt('smg', w.x, w.z, 0.8);
    this.host.shot(hit, hit ? 5 : 0, so.x, so.z, ay);
  }

  /** Free the soldiers' models. */
  dispose(): void {
    for (const so of this.soldiers) so.model.dispose();
    this.soldiers.length = 0;
  }
}
