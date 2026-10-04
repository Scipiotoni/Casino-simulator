import * as THREE from 'three';
import { mat, glow } from '../render/materials';
import { asphaltTexture, canvasTexture, makeCanvas } from '../render/textures';
import { CharacterModel } from '../entities/characterModel';
import { defaultAppearance, SKIN_TONES, type Appearance } from '../entities/appearance';
import { buildGun } from '../items/models/guns';
import { gunDef } from '../game/guns';
import { Dyn, bake } from '../items/models/common';
import { buildCar, carDef } from './vehicles';
import { cityX, cityZ } from './city';
import { RING } from './outskirts';
import { instancedChunks, place } from './nature';
import { audio } from '../core/audio';

/** Half size of the base (metres) and the gate's half width. */
export const BASE_HW = 150;
export const BASE_HD = 105;
const GATE = 8;

/** The armory's payroll comes back this long after you raid it. */
export const ARMORY_COOLDOWN_MS = 30 * 60 * 1000;

/** Cash in the armory's payroll safe: grows with your casino level. */
export function armoryPayroll(level: number): number {
  const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return Math.min(250_000, Math.round((40_000 + 12_000 * (l - 1)) / 1000) * 1000);
}

/** How long until the armory is full again after a raid at `at` (0 = ready). */
export function armoryRefillLeft(at: number | undefined, now = Date.now()): number {
  if (!at || !Number.isFinite(at)) return 0;
  return Math.max(0, Math.min(ARMORY_COOLDOWN_MS, at + ARMORY_COOLDOWN_MS - now));
}

/**
 * Where the base sits (global frame): out in the western desert, past the ring road, with a
 * road from the ring to its gate. Kept clear of rocks and cacti by the outskirts.
 */
export function baseSite(cols: number): { cx: number; cz: number; roadX0: number; roadX1: number } {
  const [x0] = cityX(cols);
  const [z0, z1] = cityZ();
  const cx = x0 - RING - 70 - BASE_HW;
  const cz = (z0 + z1) / 2;
  return { cx, cz, roadX0: cx + BASE_HW, roadX1: x0 - RING - 5 };
}

/** Is this point inside the base, or on its access road (keep the scenery off it)? */
export function inBaseArea(gx: number, gz: number, cols: number, pad = 6): boolean {
  const s = baseSite(cols);
  if (Math.abs(gx - s.cx) < BASE_HW + pad && Math.abs(gz - s.cz) < BASE_HD + pad) return true;
  return gx > s.roadX0 - pad && gx < s.roadX1 + pad && Math.abs(gz - s.cz) < 6 + pad;
}

export type SoldierKind = 'rifle' | 'sniper' | 'elite';

/** A soldier guarding the base (global frame; tower snipers stand up high). */
export interface Soldier {
  model: CharacterModel;
  kind: SoldierKind;
  x: number;
  z: number;
  y: number;
  hp: number;
  maxHp: number;
  ko: number;
  cool: number;
  /** Patrol: walks between these two points while it's quiet. */
  a: { x: number; z: number };
  b: { x: number; z: number };
  toB: boolean;
  tower: boolean;
  side: number;
  sideT: number;
  /** A sniper lining up a shot: seconds left (the red laser shows where). */
  aimT: number;
}

export type MachineKind = 'mg' | 'tank' | 'heli' | 'fuel';

/** Something armoured: a machine-gun nest, the patrol tank, the attack helicopter, a fuel tank. */
export interface Machine {
  kind: MachineKind;
  name: string;
  x: number;
  z: number;
  /** Height of its middle (the helicopter flies). */
  y: number;
  /** Hit radius and height. */
  r: number;
  h: number;
  hp: number;
  maxHp: number;
  /** Share of bullet damage that gets through. */
  armor: number;
  /** Seconds since it was destroyed (-1 while it works). */
  dead: number;
  root: THREE.Object3D;
  /** The part that aims (gun, turret). */
  gun: THREE.Object3D | null;
  yaw: number;
  aim: number;
  cool: number;
  burst: number;
  /** Lining up a shot (tank): seconds left, and where it'll land. */
  tele: number;
  tx: number;
  tz: number;
  home: { x: number; z: number; yaw: number };
  /** Patrol route (tank) and the next waypoint. */
  route?: { x: number; z: number }[];
  wp?: number;
  /** Helicopter: flying (0 parked .. 1 up), its orbit angle. */
  lift?: number;
  orbit?: number;
  rotor?: THREE.Object3D;
}

/** A mine under the sand. */
interface Mine {
  x: number;
  z: number;
  armed: boolean;
  rearm: number;
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
  player(): { x: number; z: number; exposed: boolean; height: number; car: { x: number; z: number; uid: number; armor: number } | null; speed?: number };
  /** Can soldiers see from a to b (buildings block the view)? */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean;
  /** Can a soldier stand here? */
  walkable(x: number, z: number): boolean;
  toWorld(x: number, z: number): { x: number; z: number };
  /** A soldier shot at you (hit or miss), or at your car. */
  shot(hit: boolean, dmg: number, fromX: number, fromZ: number, fromY: number): void;
  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  /** An explosion the base set off (a shell, a rocket, a mine, a fuel tank): hurts whatever is near. */
  blast(x: number, z: number, radius: number, power: number, size: number): void;
  /** Park a vehicle from the catalog at a spot; returns its uid. */
  spawnVehicle(id: string, x: number, z: number, yaw: number): number | null;
  /** Is the vehicle with this uid still parked here (not taken or wrecked)? */
  vehicleParked(uid: number): boolean;
  /** The alarm went off: the police are told (wanted level). */
  alarm(first: boolean): void;
  notify(text: string, kind: 'good' | 'bad' | 'info'): void;
}

function soldierLook(elite: boolean): Appearance {
  const a = defaultAppearance();
  a.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
  a.top = 'jacket';
  a.topColor = elite ? 0x23262a : 0x4b5320;
  a.accentColor = elite ? 0x15171a : 0x3a3f22;
  a.bottom = 'pants';
  a.bottomColor = elite ? 0x23262a : 0x5a5a3a;
  a.shoeColor = 0x2a2016;
  a.hat = 'hardhat';
  a.hatColor = elite ? 0x15171a : 0x4b5320;
  a.neck = 'none';
  a.eyewear = elite || Math.random() < 0.4 ? 'aviators' : 'none';
  a.facialHair = 'none';
  a.hair = 'buzz';
  a.prop = 'none';
  a.blush = false;
  return a;
}

const SOLDIER_HP: Record<SoldierKind, number> = { rifle: 150, sniper: 110, elite: 260 };
/** Tower snipers stand on this. */
const TOWER_Y = 6.15;

/**
 * Fort Mojave: a big military base in the western desert, GTA style. A double fence with a
 * guarded gate; watchtowers with snipers and searchlights; machine-gun nests; a runway with a
 * cargo plane; hangars, barracks, a mess hall, HQ, a control tower and a radar; a fuel depot
 * that goes up in a fireball; a minefield along the back fences; a tank that patrols the base
 * and an attack helicopter that takes off when the alarm sounds. Parked on the apron are the
 * vehicles nobody will sell you, and in the armory bunker there's the army payroll.
 *
 * Walk in and you're warned; stay, shoot, take a vehicle or crack the armory and the alarm
 * goes off: everyone opens fire and the police come.
 */
export class MilitaryBase {
  readonly group = new THREE.Group();
  readonly soldiers: Soldier[] = [];
  readonly machines: Machine[] = [];
  private mines: Mine[] = [];
  private mineMesh: THREE.InstancedMesh | null = null;
  private cols = -1;
  private cx = 0;
  private cz = 0;
  /** Solid things (global rects: x0, x1, z0, z1) and round ones. */
  private rects: [number, number, number, number][] = [];
  private circles: { x: number; z: number; r: number }[] = [];
  private slots: Slot[] = [];
  private radar: THREE.Object3D | null = null;
  private lights: THREE.Mesh[] = [];
  private beams: { o: THREE.Object3D; phase: number }[] = [];
  private lasers: THREE.Mesh[] = [];
  /** Seconds left of the alarm (0 = quiet). */
  alarmT = 0;
  /** Seconds you've been inside without permission (a warning first). */
  private trespass = 0;
  private warned = false;
  private sirenT = 0;
  private t = 0;
  private flash: THREE.Sprite | null = null;
  private flashT = 0;
  /** The base's own blast going off (it doesn't set off its own alarm or hurt its soldiers). */
  private own = false;
  /** The patrol tank is moving (it doesn't block itself). */
  private moving: Machine | null = null;
  /** Where the armory door is (global). */
  armoryDoor = { x: 0, z: 0 };

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

  /** Fence, walls, buildings and the patrol tank (global): nobody walks or drives through these. */
  blocked(gx: number, gz: number): boolean {
    if (Math.abs(gx - this.cx) > BASE_HW + 4 || Math.abs(gz - this.cz) > BASE_HD + 4) return false;
    for (const [a, b, c, d] of this.rects) if (gx > a && gx < b && gz > c && gz < d) return true;
    for (const c of this.circles) if ((gx - c.x) ** 2 + (gz - c.z) ** 2 < c.r * c.r) return true;
    for (const m of this.machines) {
      if (m === this.moving || m.kind === 'heli' || (m.kind === 'fuel' && m.dead >= 0)) continue;
      if ((gx - m.x) ** 2 + (gz - m.z) ** 2 < m.r * m.r) return true;
    }
    return false;
  }

  private rect(lx0: number, lx1: number, lz0: number, lz1: number): void {
    this.rects.push([this.cx + Math.min(lx0, lx1), this.cx + Math.max(lx0, lx1), this.cz + Math.min(lz0, lz1), this.cz + Math.max(lz0, lz1)]);
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
    this.machines.length = 0;
    this.rects = [];
    this.circles = [];
    this.lights = [];
    this.beams = [];
    this.lasers = [];
    this.mines = [];
    const statics = new THREE.Group();
    this.group.add(statics);
    this.buildGround(statics, s.roadX0, s.roadX1);
    this.buildFence(statics);
    this.buildBuildings(statics);
    this.buildMinefield(statics);
    bake(statics, new Dyn());
    this.buildMachines();
    this.buildSoldiers();
    this.slots = [
      { id: 'tank', lx: -115, lz: -20, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'apc', lx: -95, lz: -20, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'apc', lx: -78, lz: -20, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'jeep', lx: -60, lz: -22, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'jeep', lx: -50, lz: -22, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'jeep', lx: -40, lz: -22, yaw: Math.PI / 2, uid: null, respawn: 0 },
      { id: 'stealth', lx: -45, lz: -50, yaw: 0, uid: null, respawn: 0 },
    ];
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd28a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.scale.setScalar(0.7);
    f.visible = false;
    this.flash = f;
    this.group.add(f);
    // Red laser sights (snipers and the tank show where they're about to shoot).
    const lm = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 12; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1), lm);
      l.geometry.translate(0, 0, 0.5);
      l.visible = false;
      this.group.add(l);
      this.lasers.push(l);
    }
  }

  private buildGround(s: THREE.Group, roadX0: number, roadX1: number): void {
    const { cx, cz } = this;
    const tex = asphaltTexture().clone();
    tex.repeat.set(BASE_HW / 4, BASE_HD / 4);
    tex.needsUpdate = true;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(BASE_HW * 2, BASE_HD * 2), new THREE.MeshStandardMaterial({ map: tex, color: 0xb8b0a0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, -0.025, cz);
    pad.receiveShadow = true;
    s.add(pad);
    // The runway along the north side, the main road in from the gate and the patrol loop.
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5 });
    const strip = (lx0: number, lz0: number, lx1: number, lz1: number, m: THREE.Material, y = -0.02) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(lx1 - lx0), Math.abs(lz1 - lz0)), m);
      p.rotation.x = -Math.PI / 2;
      p.position.set(cx + (lx0 + lx1) / 2, y, cz + (lz0 + lz1) / 2);
      p.receiveShadow = true;
      s.add(p);
    };
    strip(-142, -92, 110, -70, dark);
    strip(-130, -6, BASE_HW, 6, dark);
    for (const [a, b, c, d] of [[-24, 8, 132, 16], [-24, 74, 132, 82], [-24, 8, -16, 82], [124, 8, 132, 82]] as const) strip(a, b, c, d, dark);
    const paint = mat(0xf4f1ea, { rough: 0.7 });
    const yellow = mat(0xffd23f, { rough: 0.8 });
    for (let x = -130; x < 100; x += 12) strip(x, -81.3, x + 6, -80.7, paint, -0.015);
    for (let i = 0; i < 8; i++) strip(-138, -90 + i * 2.5, -128, -89 + i * 2.5, paint, -0.015);
    strip(-132, -36, -10, -35.6, yellow, -0.015);
    for (const lx of [-122, -102, -86, -68, -55, -45, -35]) strip(lx - 0.1, -28, lx + 0.1, -12, yellow, -0.015);
    // Access road from the ring road to the gate.
    const len = roadX1 - roadX0;
    const rt = asphaltTexture().clone();
    rt.repeat.set(len / 6, 2);
    rt.needsUpdate = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(len, 12), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set((roadX0 + roadX1) / 2, -0.024, cz);
    road.receiveShadow = true;
    s.add(road);
    // Signs along the road in.
    const sign = (title: string, sub: string, x: number, z: number) => {
      const g = new THREE.Group();
      const { canvas, ctx } = makeCanvas(512, 192);
      ctx.fillStyle = '#2f3520';
      ctx.fillRect(0, 0, 512, 192);
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, 496, 176);
      ctx.fillStyle = '#e8e0c8';
      ctx.textAlign = 'center';
      ctx.font = '900 52px Arial, sans-serif';
      ctx.fillText(title, 256, 80, 470);
      ctx.fillStyle = '#ff5a3a';
      ctx.font = '800 28px Arial, sans-serif';
      ctx.fillText(sub, 256, 138, 470);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.25), new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), side: THREE.DoubleSide }));
      board.position.y = 2.6;
      g.add(board);
      for (const dx of [-2.6, 2.6]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), mat(0x5a5d66, { metal: 0.5 }));
        p.position.set(dx, 1.3, 0);
        g.add(p);
      }
      g.position.set(x, 0, z);
      g.rotation.y = Math.PI / 2;
      s.add(g);
      this.circles.push({ x, z: z - 2.6, r: 0.4 }, { x, z: z + 2.6, r: 0.4 });
    };
    sign('FORT MOJAVE', 'RESTRICTED · NO ENTRY', roadX0 + 16, cz - 10);
    sign('WARNING', 'USE OF DEADLY FORCE AUTHORIZED', roadX0 + 60, cz + 10);
  }

  private buildFence(s: THREE.Group): void {
    const { cx, cz } = this;
    // Chain link: a see-through diamond mesh texture, with razor wire on top.
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
    const H = 3.6;
    const fenceMat = (len: number) => {
      const t = tex.clone();
      t.repeat.set(len / 0.6, H / 0.6);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    };
    const postMat = mat(0x8a8f96, { metal: 0.6, rough: 0.4 });
    const wire = mat(0x2a2c30, { metal: 0.5, rough: 0.5 });
    const posts: THREE.Matrix4[] = [];
    const coils: THREE.Matrix4[] = [];
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H), fenceMat(len));
      panel.position.set(cx + (x0 + x1) / 2, H / 2, cz + (z0 + z1) / 2);
      panel.rotation.y = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : Math.PI / 2;
      this.group.add(panel);
      const top = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.08, 0.1, Math.abs(z1 - z0) + 0.08), wire);
      top.position.set(cx + (x0 + x1) / 2, H + 0.25, cz + (z0 + z1) / 2);
      s.add(top);
      const n = Math.ceil(len / 3);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        posts.push(place(cx + x0 + (x1 - x0) * u, (H + 0.4) / 2, cz + z0 + (z1 - z0) * u));
        coils.push(place(cx + x0 + (x1 - x0) * u, H + 0.55, cz + z0 + (z1 - z0) * u, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? Math.PI / 2 : 0));
      }
      const t = 0.3;
      this.rect(Math.min(x0, x1) - t, Math.max(x0, x1) + t, Math.min(z0, z1) - t, Math.max(z0, z1) + t);
    };
    run(-BASE_HW, -BASE_HD, BASE_HW, -BASE_HD);
    run(-BASE_HW, BASE_HD, BASE_HW, BASE_HD);
    run(-BASE_HW, -BASE_HD, -BASE_HW, BASE_HD);
    run(BASE_HW, -BASE_HD, BASE_HW, -GATE);
    run(BASE_HW, GATE, BASE_HW, BASE_HD);
    const pg = instancedChunks(new THREE.CylinderGeometry(0.07, 0.07, H + 0.4, 6), postMat, posts, true);
    if (pg) this.group.add(pg);
    const coil = new THREE.TorusGeometry(0.32, 0.03, 4, 10);
    const cg = instancedChunks(coil, mat(0xb8bcc2, { metal: 0.8, rough: 0.3 }), coils);
    if (cg) this.group.add(cg);
    // Gate: a striped boom (raised), a guard booth, concrete barriers in a chicane.
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
    this.box(s, mat(0x6b6f58, { rough: 0.8 }), 3, 2.8, 3, BASE_HW - 4, 1.4, GATE + 4, true);
    this.box(s, glow(0xfff2c8, 1.2), 2.2, 0.6, 0.05, BASE_HW - 4, 1.9, GATE + 2.47, false);
    const concrete = mat(0xb9b4aa, { rough: 0.9 });
    for (const [lx, lz] of [[BASE_HW - 18, -3], [BASE_HW - 28, 3], [BASE_HW - 38, -3]] as const) this.box(s, concrete, 1.2, 1.1, 5, lx, 0.55, lz, true);
  }

  /** A box in base-local coordinates (optionally solid). */
  private box(s: THREE.Group, m: THREE.Material, w: number, h: number, d: number, lx: number, y: number, lz: number, solid: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(this.cx + lx, y, this.cz + lz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    s.add(mesh);
    if (solid) this.rect(lx - w / 2, lx + w / 2, lz - d / 2, lz + d / 2);
    return mesh;
  }

  private buildBuildings(s: THREE.Group): void {
    const { cx, cz } = this;
    const olive = mat(0x5f6648, { rough: 0.85 });
    const tan = mat(0xb5a27a, { rough: 0.9 });
    const steel = mat(0x8c9099, { metal: 0.55, rough: 0.45 });
    const dark = mat(0x23252a, { rough: 0.7 });
    const windowLit = glow(0xffe8b0, 0.6);
    // Three hangars facing the apron: curved roofs, open fronts.
    const roofMat = mat(0x7d8270, { metal: 0.4, rough: 0.6, side: THREE.DoubleSide });
    const backMat = mat(0x6f7462, { rough: 0.8, side: THREE.DoubleSide });
    for (const [n, hx] of [[1, -115], [2, -80], [3, -45]] as const) {
      const W = 28;
      const D = 20;
      const lz = -50;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, D, 24, 1, true, -Math.PI / 2, Math.PI), roofMat);
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.75);
      roof.position.set(cx + hx, 3, cz + lz);
      roof.castShadow = true;
      s.add(roof);
      const backWall = new THREE.Mesh(new THREE.CircleGeometry(W / 2, 24, 0, Math.PI), backMat);
      backWall.scale.set(1, 0.75, 1);
      backWall.position.set(cx + hx, 3, cz + lz - D / 2);
      s.add(backWall);
      this.box(s, olive, W, 3, 0.4, hx, 1.5, lz - D / 2, true);
      for (const sx of [-1, 1]) this.box(s, olive, 0.4, 3, D, hx + sx * W / 2, 1.5, lz, true);
      this.box(s, glow(0xfff2c8, 1.6), 3, 0.3, 0.3, hx, 11.2, lz + D / 2, false);
      const num = makeCanvas(128, 128);
      num.ctx.fillStyle = '#f4f1ea';
      num.ctx.font = '900 110px Arial, sans-serif';
      num.ctx.textAlign = 'center';
      num.ctx.textBaseline = 'middle';
      num.ctx.fillText(String(n), 64, 70);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ map: canvasTexture(num.canvas), transparent: true }));
      plate.position.set(cx + hx, 8.6, cz + lz + D / 2 + 0.05);
      this.group.add(plate);
    }
    // The cargo plane parked on the runway.
    const plane = new THREE.Group();
    const grey = mat(0x7a8070, { rough: 0.6, metal: 0.3 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 26, 16), grey);
    fus.rotation.z = Math.PI / 2;
    fus.position.y = 3;
    plane.add(fus);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(2.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), grey);
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(13, 3, 0);
    plane.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 34), grey);
    wing.position.set(1, 5, 0);
    plane.add(wing);
    for (const wz of [-11, -5.5, 5.5, 11]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 3.4, 12), dark);
      eng.rotation.z = Math.PI / 2;
      eng.position.set(2.4, 4.4, wz);
      plane.add(eng);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(4.5, 7, 0.35), grey);
    fin.position.set(-11, 7.4, 0);
    plane.add(fin);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 12), grey);
    tail.position.set(-11.5, 5.4, 0);
    plane.add(tail);
    plane.position.set(cx - 30, 0, cz - 81);
    plane.traverse((o) => (o.castShadow = true));
    s.add(plane);
    this.rect(-43, -15, -83.6, -78.4);
    // HQ: two storeys, rows of windows, a flagpole out front.
    this.box(s, tan, 32, 8, 16, 25, 4, -45, true);
    this.box(s, dark, 32.6, 0.4, 16.6, 25, 8.2, -45, false);
    for (let f = 0; f < 2; f++) for (let i = 0; i < 9; i++) this.box(s, windowLit, 1.6, 1.2, 0.05, 12 + i * 3.2, 1.8 + f * 3.6, -36.97, false);
    this.box(s, dark, 2.4, 2.8, 0.05, 25, 1.4, -36.96, false);
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 12, 8), steel);
    flagPole.position.set(cx + 25, 6, cz - 31);
    s.add(flagPole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), mat(0x2a4a8a, { side: THREE.DoubleSide, rough: 0.8 }));
    flag.position.set(cx + 26.6, 11, cz - 31);
    this.group.add(flag);
    this.circles.push({ x: cx + 25, z: cz - 31, r: 0.3 });
    // Control tower with a glass cab, and the radar on its mast.
    this.box(s, tan, 7, 15, 7, 70, 7.5, -52, true);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x2a5a6a, metalness: 0.7, roughness: 0.1, emissive: 0x08202a }));
    cab.position.set(cx + 70, 16.6, cz - 52);
    s.add(cab);
    const capRoof = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.4, 8), dark);
    capRoof.position.set(cx + 70, 18.4, cz - 52);
    s.add(capRoof);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glow(0xff2a2a, 3));
    beacon.position.set(cx + 70, 18.9, cz - 52);
    this.group.add(beacon);
    this.lights.push(beacon);
    this.box(s, tan, 7, 4, 7, 115, 2, -60, true);
    const radar = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 3), mat(0xe9e6dc, { rough: 0.5, side: THREE.DoubleSide }));
    dish.rotation.x = -Math.PI / 2 + 0.5;
    dish.position.y = 3.2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3.2, 8), steel);
    mast.position.y = 1.6;
    radar.add(mast, dish);
    radar.position.set(cx + 115, 4, cz - 60);
    this.group.add(radar);
    this.radar = radar;
    // Barracks and the mess hall.
    for (const lz of [28, 50]) {
      this.box(s, tan, 30, 4.5, 10, 85, 2.25, lz, true);
      this.box(s, dark, 30.4, 0.3, 10.4, 85, 4.6, lz, false);
      for (let i = 0; i < 9; i++) this.box(s, windowLit, 1.4, 1, 0.05, 72 + i * 3.2, 2.6, lz - 5.03, false);
      this.box(s, dark, 1.6, 2.4, 0.05, 85, 1.2, lz - 5.02, false);
    }
    this.box(s, olive, 20, 5, 14, 35, 2.5, 45, true);
    this.box(s, dark, 20.4, 0.3, 14.4, 35, 5.1, 45, false);
    for (let i = 0; i < 5; i++) this.box(s, windowLit, 2, 1.2, 0.05, 27 + i * 4, 2.8, 37.97, false);
    // Helipad.
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
    const hp = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshStandardMaterial({ map: canvasTexture(padTex.canvas), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    hp.rotation.x = -Math.PI / 2;
    hp.position.set(cx - 5, -0.01, cz + 45);
    this.group.add(hp);
    // The armory: a concrete bunker under an earth berm, blast door facing east.
    this.box(s, mat(0x9a958a, { rough: 0.9 }), 18, 4, 12, -60, 2, 62, true);
    const berm = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 18, 20, 1, false, -Math.PI / 2, Math.PI), mat(0x8a7a52, { rough: 1, flat: true }));
    berm.rotation.z = Math.PI / 2;
    berm.scale.set(1, 1, 0.55);
    berm.position.set(cx - 60, 2.6, cz + 62);
    berm.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    s.add(berm);
    this.box(s, mat(0x3a3c40, { metal: 0.6, rough: 0.4 }), 0.3, 3.2, 4.4, -50.9, 1.6, 62, false);
    this.box(s, mat(0xffd23f, { rough: 0.6 }), 0.32, 0.4, 4.6, -50.88, 3.4, 62, false);
    const ar = makeCanvas(256, 64);
    ar.ctx.fillStyle = '#2f3520';
    ar.ctx.fillRect(0, 0, 256, 64);
    ar.ctx.fillStyle = '#ffd23f';
    ar.ctx.font = '900 38px Arial, sans-serif';
    ar.ctx.textAlign = 'center';
    ar.ctx.textBaseline = 'middle';
    ar.ctx.fillText('ARMORY', 128, 34);
    const arPlate = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: canvasTexture(ar.canvas) }));
    arPlate.position.set(cx - 50.7, 4.1, cz + 62);
    arPlate.rotation.y = Math.PI / 2;
    this.group.add(arPlate);
    this.armoryDoor = { x: cx - 48.6, z: cz + 62 };
    // Watchtowers with searchlights.
    for (const [lx, lz] of this.towerSpots()) {
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(s, dark, 0.22, 6, 0.22, lx + ox * 1.4, 3, lz + oz * 1.4, false);
      this.box(s, olive, 3.6, 0.3, 3.6, lx, 6, lz, false);
      this.box(s, olive, 3.6, 1.0, 0.1, lx, 6.6, lz - 1.75, false);
      this.box(s, olive, 3.6, 1.0, 0.1, lx, 6.6, lz + 1.75, false);
      this.box(s, olive, 0.1, 1.0, 3.6, lx - 1.75, 6.6, lz, false);
      this.box(s, olive, 0.1, 1.0, 3.6, lx + 1.75, 6.6, lz, false);
      this.box(s, dark, 4, 0.2, 4, lx, 8.5, lz, false);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(s, dark, 0.12, 2.1, 0.12, lx + ox * 1.7, 7.4, lz + oz * 1.7, false);
      this.circles.push({ x: cx + lx, z: cz + lz, r: 2 });
      const beam = new THREE.Group();
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.55, 10), glow(0xfff6dc, 2.5));
      head.rotation.x = Math.PI / 2;
      beam.add(head);
      this.lights.push(head);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.rotation.x = -Math.PI / 2;
      cone.position.z = 13;
      beam.add(cone);
      beam.position.set(cx + lx, 7.9, cz + lz);
      beam.rotation.x = 0.32;
      this.group.add(beam);
      this.beams.push({ o: beam, phase: Math.random() * 6 });
    }
    // Fuel depot: four big tanks behind a low wall (they're machines: they blow up).
    this.box(s, mat(0xb9b4aa, { rough: 0.9 }), 0.4, 1.2, 34, -131, 0.6, 49, true);
    // Crates and drums dotted about.
    const crate = mat(0x7a6a3a, { rough: 0.9 });
    for (const [lx, lz] of [[-128, -30], [-126.7, -30], [-127.4, -28.7], [55, -20], [56.3, -20], [10, 60], [11.3, 60], [10.6, 61.3]] as const) this.box(s, crate, 1.2, 1.2, 1.2, lx, 0.6, lz, true);
    const drum = mat(0x3d5a2a, { rough: 0.6, metal: 0.3 });
    for (let i = 0; i < 9; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 12), drum);
      d.position.set(cx - 100 + (i % 3) * 0.8, 0.48, cz + 74 + Math.floor(i / 3) * 0.8);
      d.castShadow = true;
      s.add(d);
    }
    this.rect(-100.5, -98, 73.5, 76.3);
  }

  /** Where the eight watchtowers stand (local). */
  private towerSpots(): [number, number][] {
    const x = BASE_HW - 6;
    const z = BASE_HD - 6;
    return [[-x, -z], [x, -z], [-x, z], [x, z], [0, -z], [0, z], [-x, 0], [BASE_HW - 12, -40]];
  }

  /** Mines along the back fences, with skull signs warning you off. */
  private buildMinefield(s: THREE.Group): void {
    const { cx, cz } = this;
    const add = (lx: number, lz: number) => this.mines.push({ x: cx + lx + (Math.random() - 0.5) * 3, z: cz + lz + (Math.random() - 0.5) * 3, armed: true, rearm: 0 });
    for (let lx = -136; lx <= 128; lx += 7) for (const lz of [90, 97]) add(lx, lz);
    for (let lz = -64; lz <= 80; lz += 7) for (const lx of [-144, -137]) if (Math.abs(lz) > 6) add(lx, lz);
    const mats = this.mines.map((m) => place(m.x, 0.03, m.z, 0, 0.32, 0.12, 0.32));
    const mm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat(0x4a4436, { rough: 0.9, metal: 0.3 }), mats.length);
    mats.forEach((m, i) => mm.setMatrixAt(i, m));
    mm.computeBoundingSphere();
    this.mineMesh = mm;
    this.group.add(mm);
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(64, 4);
    ctx.lineTo(124, 120);
    ctx.lineTo(4, 120);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#14121a';
    ctx.font = '900 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('☠', 64, 92);
    ctx.font = '900 18px Arial, sans-serif';
    ctx.fillText('MINES', 64, 114);
    const sm = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const signGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6);
    const pm = mat(0x5a5d66, { metal: 0.5 });
    const sign = (lx: number, lz: number, yaw: number) => {
      const p = new THREE.Mesh(postGeo, pm);
      p.position.set(cx + lx, 0.65, cz + lz);
      s.add(p);
      const b = new THREE.Mesh(signGeo, sm);
      b.position.set(cx + lx, 1.5, cz + lz);
      b.rotation.y = yaw;
      this.group.add(b);
    };
    for (let lx = -130; lx <= 125; lx += 26) sign(lx, 85.5, 0);
    for (let lz = -60; lz <= 78; lz += 26) sign(-131.5, lz, Math.PI / 2);
  }

  private buildMachines(): void {
    const { cx, cz } = this;
    const sand = mat(0xb59a6a, { rough: 1 });
    const gunMat = mat(0x2a2c30, { metal: 0.6, rough: 0.4 });
    // Machine-gun nests: a ring of sandbags round a heavy gun that swings to follow you.
    const nests: [number, number][] = [[136, -18], [136, 18], [-25, -12], [25, -28], [-40, 72], [-80, -32]];
    for (const [lx, lz] of nests) {
      const root = new THREE.Group();
      root.position.set(cx + lx, 0, cz + lz);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        for (let row = 0; row < 2; row++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.5), sand);
          b.position.set(Math.cos(a) * 1.8, 0.21 + row * 0.4, Math.sin(a) * 1.8);
          b.rotation.y = -a + Math.PI / 2;
          root.add(b);
        }
      }
      const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.3, 1.1, 6), gunMat);
      tripod.position.y = 0.55;
      root.add(tripod);
      const gun = new THREE.Group();
      gun.position.y = 1.15;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.1), gunMat);
      gun.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 8), gunMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 1.1;
      gun.add(barrel);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.06), mat(0x4b5320, { rough: 0.7 }));
      shield.position.set(0, 0.1, 0.5);
      gun.add(shield);
      root.add(gun);
      this.group.add(root);
      this.machines.push(this.machine('mg', 'machine-gun nest', root, gun, cx + lx, cz + lz, 1.0, 2.1, 1.6, 260, 0.6, lx > 100 ? -Math.PI / 2 : 0));
    }
    // The fuel tanks.
    const tankMat = mat(0xe9e6dc, { rough: 0.5, metal: 0.4 });
    for (const [lx, lz] of [[-120, 40], [-104, 40], [-120, 58], [-104, 58]] as const) {
      const root = new THREE.Group();
      root.position.set(cx + lx, 0, cz + lz);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 24), tankMat);
      body.position.y = 3.5;
      body.castShadow = true;
      root.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5, 0.8, 24), tankMat);
      top.position.y = 7.4;
      root.add(top);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(5.03, 5.03, 0.7, 24), mat(0xc8102e, { rough: 0.5 }));
      stripe.position.y = 5;
      root.add(stripe);
      this.group.add(root);
      this.machines.push(this.machine('fuel', 'fuel tank', root, null, cx + lx, cz + lz, 3.5, 7, 5.2, 180, 0.5, 0));
    }
    this.spawnTank();
    this.spawnHeli();
  }

  private machine(kind: MachineKind, name: string, root: THREE.Object3D, gun: THREE.Object3D | null, x: number, z: number, y: number, h: number, r: number, hp: number, armor: number, yaw: number): Machine {
    if (gun) gun.rotation.y = yaw;
    return { kind, name, x, z, y, r, h, hp, maxHp: hp, armor, dead: -1, root, gun, yaw, aim: yaw, cool: 1 + Math.random(), burst: 0, tele: 0, tx: x, tz: z, home: { x, z, yaw } };
  }

  /** The patrol tank: drives a loop round the base, turns its gun on you when the alarm sounds. */
  private spawnTank(): void {
    const def = carDef('tank');
    if (!def) return;
    const m = buildCar(def, 0x3f4628);
    const { cx, cz } = this;
    const route = [[128, 12], [-20, 12], [-20, 78], [128, 78]].map(([lx, lz]) => ({ x: cx + lx, z: cz + lz }));
    m.root.position.set(route[0].x, 0, route[0].z);
    this.group.add(m.root);
    const t = this.machine('tank', 'patrol tank', m.root, m.turret ?? null, route[0].x, route[0].z, 1.4, 2.8, 3.4, 1600, 0.1, -Math.PI / 2);
    t.route = route;
    t.wp = 1;
    t.root.rotation.y = -Math.PI / 2;
    if (m.muzzle) t.root.userData.muzzle = m.muzzle;
    this.machines.push(t);
  }

  /** The attack helicopter on its pad: it lifts off when the alarm sounds and hunts you. */
  private spawnHeli(): void {
    const dark = mat(0x23252a, { rough: 0.7 });
    const green = mat(0x3f4628, { rough: 0.7 });
    const heli = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), green);
    body.scale.set(0.9, 0.85, 1.9);
    body.position.y = 1.6;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), new THREE.MeshStandardMaterial({ color: 0x1b2a33, metalness: 0.7, roughness: 0.1 }));
    glass.scale.set(0.9, 0.8, 1.1);
    glass.position.set(0, 1.95, 1.9);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.38, 6, 8), green);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 1.9, -4.2);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.9), green);
    fin.position.set(0, 2.5, -7);
    heli.add(body, glass, tail, fin);
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.6), dark);
      skid.position.set(sx * 1.15, 0.1, 0);
      heli.add(skid);
      // Stub wings with rocket pods.
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.7), green);
      wing.position.set(sx * 1.6, 1.5, 0.3);
      heli.add(wing);
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 8), dark);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(sx * 2.2, 1.35, 0.3);
      heli.add(pod);
    }
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), dark);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0, 0.8, 2.6);
    heli.add(gun);
    const rotor = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 6), dark);
      blade.position.z = 3;
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI) / 2;
      arm.add(blade);
      rotor.add(arm);
    }
    rotor.position.y = 3.1;
    heli.add(rotor);
    const x = this.cx - 5;
    const z = this.cz + 45;
    heli.position.set(x, 0, z);
    heli.rotation.y = -0.6;
    this.group.add(heli);
    const m = this.machine('heli', 'attack helicopter', heli, null, x, z, 1.6, 3.2, 2.6, 650, 0.35, -0.6);
    m.lift = 0;
    m.orbit = Math.random() * 6;
    m.rotor = rotor;
    this.machines.push(m);
  }

  private addSoldier(kind: SoldierKind, lx: number, lz: number, tower: boolean, ax = lx, az = lz, bx = lx, bz = lz): void {
    const model = new CharacterModel(soldierLook(kind === 'elite'), { castShadow: false });
    const gun = buildGun(gunDef(kind === 'sniper' ? 'sniper' : 'rifle') ?? gunDef('rifle')!);
    model.hand.add(gun.group);
    model.aim = 2;
    const x = this.cx + lx;
    const z = this.cz + lz;
    const y = tower ? TOWER_Y : 0;
    model.root.position.set(x, y, z);
    this.group.add(model.root);
    this.soldiers.push({
      model, kind, x, z, y, hp: SOLDIER_HP[kind], maxHp: SOLDIER_HP[kind], ko: 0, cool: 1 + Math.random(), tower, toB: true, side: 1, sideT: 0, aimT: 0,
      a: { x: this.cx + ax, z: this.cz + az }, b: { x: this.cx + bx, z: this.cz + bz },
    });
  }

  private buildSoldiers(): void {
    // The gate.
    this.addSoldier('rifle', 141, -12, false);
    this.addSoldier('rifle', 141, 12, false);
    this.addSoldier('rifle', 128, -6, false, 128, -6, 128, 6);
    // Patrols all over the base.
    const patrols: [number, number, number, number][] = [
      [100, -20, 40, -20], [-20, -5, -120, -5], [-125, -32, -125, 25], [60, 15, 60, 70], [110, 15, 110, 70],
      [0, 20, 0, 82], [-80, 30, -128, 30], [-60, 42, -20, 42], [30, -62, 100, -62], [-100, -66, 20, -66],
    ];
    for (const [ax, az, bx, bz] of patrols) this.addSoldier('rifle', ax, az, false, ax, az, bx, bz);
    // HQ and hangar guards.
    for (const [lx, lz] of [[15, -33], [35, -33], [-80, -38], [-45, -38]] as const) this.addSoldier('rifle', lx, lz, false);
    // Elite guards round the armory.
    for (const [lx, lz] of [[-46, 57], [-46, 67], [-70, 52], [-70, 72]] as const) this.addSoldier('elite', lx, lz, false);
    // A sniper on every tower.
    for (const [lx, lz] of this.towerSpots()) this.addSoldier('sniper', lx, lz, true);
  }

  /** Set off the alarm (or keep it ringing). */
  raise(reason?: string): void {
    const first = this.alarmT <= 0;
    this.alarmT = 120;
    this.trespass = 99;
    if (first) {
      audio.play('alarm');
      this.host.notify(reason ?? 'The base alarm is going off! Snipers, machine guns, the tank and the helicopter are coming for you.', 'bad');
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
    this.raise(`You took the ${name} from Fort Mojave! The whole base is shooting and the police are coming.`);
  }

  /** Close enough to the armory door to crack it? (global) */
  atArmory(gx: number, gz: number): boolean {
    return Math.hypot(gx - this.armoryDoor.x, gz - this.armoryDoor.z) < 2.6;
  }

  /** You broke into the armory: everyone knows. */
  armoryRaided(): void {
    this.raise('🚨 ARMORY BREACHED! Every soldier on the base is after you. Get out alive!');
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

  /** Machines (nests, the tank, the helicopter, fuel tanks) along a ray (global), nearest first. */
  raycastMachines(ox: number, oz: number, dx: number, dz: number, maxS: number): { machine: Machine; s: number; y0: number; y1: number }[] {
    const out: { machine: Machine; s: number; y0: number; y1: number }[] = [];
    for (const m of this.machines) {
      if (m.dead >= 0) continue;
      const px = m.x - ox;
      const pz = m.z - oz;
      const s = px * dx + pz * dz;
      if (s < 0.2 || s > maxS) continue;
      const d = Math.hypot(px - dx * s, pz - dz * s);
      if (d < m.r) out.push({ machine: m, s: Math.max(0.2, s - Math.sqrt(m.r * m.r - d * d)), y0: m.y - m.h / 2, y1: m.y + m.h / 2 });
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
    this.knock(so);
    return true;
  }

  private knock(so: Soldier): void {
    so.ko = 30;
    so.aimT = 0;
    so.model.aim = 0;
    so.model.setPose('ko');
    if (so.tower) {
      // Falls from the tower.
      so.y = 0;
      so.model.root.position.y = 0;
    }
  }

  /** You hit a machine with a bullet (`explosive`: a blast, armour doesn't help). Returns true if it was destroyed. */
  damageMachine(m: Machine, dmg: number, explosive = false): boolean {
    if (m.dead >= 0 || dmg <= 0) return false;
    m.hp -= dmg * (explosive ? 1 : m.armor);
    if (!this.own) this.raise();
    if (m.hp > 0) return false;
    this.destroy(m);
    return true;
  }

  private destroy(m: Machine): void {
    m.dead = 0;
    m.hp = 0;
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.95, metalness: 0.2 });
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = burnt;
    });
    const big = m.kind === 'fuel' ? 2.6 : m.kind === 'tank' ? 1.8 : m.kind === 'heli' ? 1.6 : 0.9;
    if (m.kind === 'heli') {
      // It comes down where it was.
      m.root.position.y = 0.2;
      m.root.rotation.z = 0.5;
      m.y = 1.6;
    }
    if (m.kind === 'fuel') m.root.scale.set(1, 0.35, 1);
    const wasOwn = this.own;
    this.own = true;
    this.host.blast(m.x, m.z, m.kind === 'fuel' ? 16 : 8, m.kind === 'fuel' ? 240 : 120, big);
    this.own = wasOwn;
    this.host.notify(`💥 You destroyed the ${m.name}!`, 'good');
  }

  /** An explosion (global frame): soldiers and machines nearby take it; inside the fence it sets off the alarm. */
  blast(x: number, z: number, radius: number, power: number, byPlayer: boolean): void {
    let hitAny = false;
    for (const so of this.soldiers) {
      if (this.own) break;
      const d = Math.hypot(so.x - x, so.z - z);
      if (d < radius && so.ko <= 0) {
        hitAny = true;
        so.hp -= power * 2 * (1 - d / radius);
        if (so.hp <= 0) this.knock(so);
      }
    }
    for (const m of this.machines) {
      // The base's own shells and mines spare its guns (but fuel tanks go up in a chain).
      if (m.dead >= 0 || (this.own && m.kind !== 'fuel')) continue;
      const d = Math.hypot(m.x - x, m.z - z) - m.r * 0.5;
      // The helicopter is only caught by a blast right under it when it's low.
      if (m.kind === 'heli' && (m.lift ?? 0) > 0.5 && d > 4) continue;
      if (d < radius) {
        hitAny = true;
        this.damageMachine(m, power * 1.5 * (1 - Math.max(0, d) / radius), true);
      }
    }
    if (byPlayer && !this.own && (hitAny || this.inside(x, z))) this.raise();
  }

  /** Soldiers and machines for the minimap. */
  get dots(): { x: number; z: number }[] {
    const out = this.soldiers.filter((s) => s.ko <= 0).map((s) => ({ x: s.x, z: s.z }));
    for (const m of this.machines) if (m.dead < 0 && m.kind !== 'fuel') out.push({ x: m.x, z: m.z });
    return out;
  }

  update(dt: number, cols: number, near: boolean): void {
    this.build(cols);
    this.t += dt;
    const h = this.host;
    const p = h.player();
    const dist = Math.hypot(p.x - this.cx, p.z - this.cz);
    this.group.visible = dist < 480;
    if (dist > 200) for (const so of this.soldiers) so.model.root.visible = false;
    if (!this.group.visible && this.alarmT <= 0) return;
    if (this.radar) this.radar.rotation.y += dt * 0.8;
    const blink = this.alarmT > 0 ? Math.floor(this.t * 4) % 2 === 0 : (this.t % 2) < 0.4;
    for (const l of this.lights) l.visible = this.alarmT > 0 ? blink : true;
    for (const b of this.beams) {
      // Searchlights sweep; during the alarm they swing faster.
      b.o.rotation.y = b.phase + Math.sin(this.t * (this.alarmT > 0 ? 0.9 : 0.35) + b.phase) * 1.6;
    }
    this.flashT -= dt;
    if (this.flash) this.flash.visible = this.flashT > 0;
    for (const l of this.lasers) l.visible = false;
    // Vehicles: park new ones where they're missing, once you're well away.
    for (const s of this.slots) {
      if (s.uid !== null && !h.vehicleParked(s.uid)) {
        s.uid = null;
        s.respawn = 240;
      }
      if (s.uid === null) {
        s.respawn -= dt;
        if (s.respawn <= 0 && dist > 220) s.uid = h.spawnVehicle(s.id, this.cx + s.lx, this.cz + s.lz, s.yaw);
      }
    }
    this.updateMines(dt, p);
    if (!near && dist > 330) {
      // Out of range: the base settles down, knocked-out soldiers and wrecks are replaced.
      this.alarmT = Math.max(0, this.alarmT - dt * 3);
      this.trespass = 0;
      this.warned = false;
      if (this.alarmT <= 0) this.restock();
      this.updateMachines(dt, p, dist);
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
      if (this.trespass > 6) this.raise();
    } else if (!inside && this.alarmT <= 0) {
      this.trespass = Math.max(0, this.trespass - dt);
      if (this.trespass <= 0) this.warned = false;
    }
    if (this.alarmT > 0) {
      // The alarm keeps ringing while you're around.
      if (dist > 300) this.alarmT = Math.max(0, this.alarmT - dt);
      this.sirenT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = 2.2;
        const w = h.toWorld(this.cx + 70, this.cz - 52);
        audio.playAt('alarm', w.x, w.z, 0.9);
      }
    }
    this.updateSoldiers(dt, p);
    this.updateMachines(dt, p, dist);
  }

  /** Everything knocked out or blown up comes back (the base is quiet and you're far away). */
  private restock(): void {
    for (const so of this.soldiers) {
      if (so.ko > 0) {
        so.ko = 0;
        so.hp = so.maxHp;
        so.model.setPose('idle');
        so.model.aim = 2;
        so.y = so.tower ? TOWER_Y : 0;
      }
    }
    for (const m of [...this.machines]) {
      if (m.dead < 0 || m.dead < 120) continue;
      m.root.removeFromParent();
      this.machines.splice(this.machines.indexOf(m), 1);
      if (m.kind === 'tank') this.spawnTank();
      else if (m.kind === 'heli') this.spawnHeli();
      else {
        // Nests and fuel tanks: rebuilt fresh.
        const cols = this.cols;
        this.cols = -1;
        this.build(cols);
        return;
      }
    }
  }

  private updateMines(dt: number, p: ReturnType<BaseHost['player']>): void {
    const mm = this.mineMesh;
    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i];
      if (!m.armed) {
        m.rearm -= dt;
        if (m.rearm <= 0 && Math.hypot(p.x - m.x, p.z - m.z) > 30) {
          m.armed = true;
          mm?.setMatrixAt(i, place(m.x, 0.03, m.z, 0, 0.32, 0.12, 0.32));
          if (mm) mm.instanceMatrix.needsUpdate = true;
        }
        continue;
      }
      const r = p.car ? 2.2 : 1.1;
      if (Math.abs(p.x - m.x) > r || Math.abs(p.z - m.z) > r || Math.hypot(p.x - m.x, p.z - m.z) > r) continue;
      m.armed = false;
      m.rearm = 120;
      mm?.setMatrixAt(i, place(m.x, -5, m.z, 0, 0, 0, 0));
      if (mm) mm.instanceMatrix.needsUpdate = true;
      const wasOwn = this.own;
      this.own = true;
      this.host.blast(m.x, m.z, 5.5, 150, 1.1);
      this.own = wasOwn;
      this.raise('💥 You stepped on a mine! The base knows you\'re here.');
    }
  }

  private updateSoldiers(dt: number, p: ReturnType<BaseHost['player']>): void {
    const h = this.host;
    let laser = 0;
    for (const so of this.soldiers) {
      const m = so.model;
      const far = Math.hypot(p.x - so.x, p.z - so.z) > 170;
      m.root.visible = !far;
      if (so.ko > 0) {
        so.ko -= dt;
        if (!far) {
          m.setPose('ko');
          m.root.position.set(so.x, 0, so.z);
          m.update(dt);
        }
        if (so.ko <= 0) {
          // Back up (reinforcements) while the alarm rings.
          so.ko = 0;
          so.hp = so.maxHp;
          so.y = so.tower ? TOWER_Y : 0;
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
        const range = so.kind === 'sniper' ? 130 : 75;
        const sees = dist < range && (so.tower || h.lineOfSight(so.x, so.z, p.x, p.z));
        // Riflemen close in (but not far outside the fence), then hold and fire.
        if (!so.tower && (!sees || dist > (so.kind === 'elite' ? 16 : 26)) && dist > 0.1) {
          const sp = so.kind === 'elite' ? 4.8 : 4.2;
          const nx = so.x + (dx / dist) * sp * dt;
          const nz = so.z + (dz / dist) * sp * dt;
          const leash = Math.abs(nx - this.cx) < BASE_HW + 60 && Math.abs(nz - this.cz) < BASE_HD + 60;
          if (leash) moving = this.step(so, dx / dist, dz / dist, sp * dt);
        }
        m.root.rotation.y = Math.atan2(dx, dz);
        if (so.kind === 'sniper') {
          // Snipers line up (a red laser on you), then fire one heavy round.
          if (sees && dist < 110 && so.aimT <= 0 && so.cool <= 0 && laser < 3) so.aimT = 1.4;
          if (so.aimT > 0) {
            so.aimT -= dt;
            if (laser < this.lasers.length && !far) this.showLaser(this.lasers[laser++], so.x, so.y + 1.5, so.z, p.x, 1.1, p.z);
            if (so.aimT <= 0) {
              if (sees) this.fire(so, p, dist, 0.72, 22, 'gunHeavy');
              so.cool = 5 + Math.random() * 2;
            }
          } else so.cool -= dt;
        } else {
          so.cool -= dt;
          if (sees && so.cool <= 0) {
            const elite = so.kind === 'elite';
            this.fire(so, p, dist, Math.max(0.12, Math.min(0.5, (elite ? 0.6 : 0.52) - dist * 0.008)), elite ? 7 : 4, 'smg');
            so.cool = (elite ? 0.5 : 0.65) + Math.random() * 0.7;
          }
        }
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
      if (far) continue;
      m.root.position.set(so.x, so.y, so.z);
      m.setPose(moving ? (this.alarmT > 0 ? 'run' : 'walk') : 'idle');
      m.moveSpeed = this.alarmT > 0 ? 2.4 : 1.2;
      m.aim = this.alarmT > 0 || so.aimT > 0 ? 2 : 0;
      m.update(dt);
    }
  }

  private showLaser(l: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    l.position.set(ax, ay, az);
    l.scale.set(1, 1, len);
    l.lookAt(bx, by, bz);
    l.visible = true;
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

  /** A moving target is harder to hit (run, or drive fast). */
  private dodge(p: ReturnType<BaseHost['player']>, chance: number): number {
    return chance / (1 + Math.max(0, p.speed ?? 0) / 6);
  }

  private fire(so: Soldier, p: ReturnType<BaseHost['player']>, dist: number, chance: number, dmg: number, sound: 'smg' | 'gunHeavy'): void {
    so.model.recoil = 0.5;
    const hit = Math.random() < this.dodge(p, chance);
    const ay = so.y + 1.3;
    const fx = so.x + Math.sin(so.model.root.rotation.y) * 0.7;
    const fz = so.z + Math.cos(so.model.root.rotation.y) * 0.7;
    this.shootFrom(fx, ay, fz, p, dist, hit, dmg, sound);
  }

  /** A bullet from (fx, fy, fz) at you: a tracer, the sound and the hit (or a near miss). */
  private shootFrom(fx: number, fy: number, fz: number, p: ReturnType<BaseHost['player']>, dist: number, hit: boolean, dmg: number, sound: 'smg' | 'gunHeavy'): void {
    const miss = hit ? 0 : 0.6 + Math.random() * 1.4;
    const side = Math.random() < 0.5 ? 1 : -1;
    const dx = p.x - fx;
    const dz = p.z - fz;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const tx = p.x + (-dz / d) * miss * side;
    const tz = p.z + (dx / d) * miss * side;
    if (this.flash) {
      this.flash.position.set(fx, fy, fz);
      this.flashT = 0.05;
    }
    this.host.tracer(fx, fy, fz, tx, hit ? p.height * 0.7 : 0.4 + Math.random() * 1.4, tz);
    const w = this.host.toWorld(fx, fz);
    audio.playAt(sound, w.x, w.z, 0.8);
    this.host.shot(hit, hit ? dmg : 0, fx, fz, fy);
    void dist;
  }

  private updateMachines(dt: number, p: ReturnType<BaseHost['player']>, baseDist: number): void {
    let laser = this.lasers.findIndex((l) => !l.visible);
    if (laser < 0) laser = this.lasers.length;
    for (const m of this.machines) {
      if (m.dead >= 0) {
        m.dead += dt;
        continue;
      }
      const dx = p.x - m.x;
      const dz = p.z - m.z;
      const dist = Math.hypot(dx, dz);
      const hunting = this.alarmT > 0 && p.exposed;
      if (m.kind === 'mg' && m.gun) {
        const want = hunting && dist < 80 ? Math.atan2(dx, dz) : m.home.yaw + Math.sin(this.t * 0.4 + m.x) * 0.6;
        m.aim = turnTo(m.aim, want, dt * (hunting ? 2.4 : 0.6));
        m.gun.rotation.y = m.aim;
        if (!hunting || dist > 75) continue;
        const facing = Math.abs(angleDiff(m.aim, Math.atan2(dx, dz))) < 0.25;
        m.cool -= dt;
        if (facing && m.cool <= 0 && this.host.lineOfSight(m.x, m.z, p.x, p.z)) {
          // Bursts of five.
          m.burst = m.burst > 0 ? m.burst - 1 : 5;
          m.cool = m.burst > 0 ? 0.09 : 1.5;
          const gx = m.x + Math.sin(m.aim) * 1.6;
          const gz = m.z + Math.cos(m.aim) * 1.6;
          this.shootFrom(gx, 1.2, gz, p, dist, Math.random() < this.dodge(p, Math.max(0.1, 0.36 - dist * 0.004)), 3, 'smg');
        }
      } else if (m.kind === 'tank') {
        this.updateTank(m, p, dt, dist, hunting, laser < this.lasers.length ? this.lasers[laser++] : null);
      } else if (m.kind === 'heli') {
        this.updateHeli(m, p, dt, dist, hunting, baseDist);
      }
    }
  }

  private updateTank(m: Machine, p: ReturnType<BaseHost['player']>, dt: number, dist: number, hunting: boolean, laser: THREE.Mesh | null): void {
    const route = m.route ?? [];
    let goal: { x: number; z: number } | null = null;
    let speed = 3.2;
    const inLeash = Math.abs(p.x - this.cx) < BASE_HW + 120 && Math.abs(p.z - this.cz) < BASE_HD + 120;
    if (hunting && inLeash) {
      // Roll towards you, stop at gun range.
      if (dist > 34) goal = { x: p.x, z: p.z };
      speed = 5;
    } else if (route.length) {
      const wp = route[m.wp ?? 0];
      if (Math.hypot(wp.x - m.x, wp.z - m.z) < 3) m.wp = ((m.wp ?? 0) + 1) % route.length;
      goal = route[m.wp ?? 0];
    }
    if (goal) {
      const want = Math.atan2(goal.x - m.x, goal.z - m.z);
      m.yaw = turnTo(m.yaw, want, dt * 0.9);
      if (Math.abs(angleDiff(m.yaw, want)) < 0.6) {
        const nx = m.x + Math.sin(m.yaw) * speed * dt;
        const nz = m.z + Math.cos(m.yaw) * speed * dt;
        this.moving = m;
        const ok = this.host.walkable(nx + Math.sin(m.yaw) * 3.6, nz + Math.cos(m.yaw) * 3.6) && this.host.walkable(nx, nz);
        this.moving = null;
        const pd = Math.hypot(p.x - nx, p.z - nz);
        if (ok && pd > 4.5) {
          m.x = nx;
          m.z = nz;
        } else if (!hunting && route.length) m.wp = ((m.wp ?? 0) + 1) % route.length;
      }
    }
    m.root.position.set(m.x, 0, m.z);
    m.root.rotation.y = m.yaw;
    // The turret: on you when hunting, otherwise straight ahead.
    const local = hunting && dist < 140 ? angleDiff(Math.atan2(p.x - m.x, p.z - m.z), m.yaw) : 0;
    m.aim = turnTo(m.aim, local, dt * 1.1);
    if (m.gun) m.gun.rotation.y = m.aim;
    if (!hunting || dist > 130) {
      m.tele = 0;
      return;
    }
    const worldAim = m.yaw + m.aim;
    const onTarget = Math.abs(angleDiff(worldAim, Math.atan2(p.x - m.x, p.z - m.z))) < 0.08;
    m.cool -= dt;
    if (m.tele <= 0 && m.cool <= 0 && onTarget && this.host.lineOfSight(m.x, m.z, p.x, p.z)) {
      // Lines up (laser), then fires where you WERE: keep moving!
      m.tele = 1.3;
      m.tx = p.x;
      m.tz = p.z;
    }
    if (m.tele > 0) {
      m.tele -= dt;
      const mx = m.x + Math.sin(worldAim) * 5.5;
      const mz = m.z + Math.cos(worldAim) * 5.5;
      if (laser) this.showLaser(laser, mx, 1.8, mz, m.tx, 0.6, m.tz);
      if (m.tele <= 0) {
        m.cool = 3.6 + Math.random();
        const w = this.host.toWorld(mx, mz);
        audio.playAt('cannon', w.x, w.z, 1);
        if (this.flash) {
          this.flash.position.set(mx, 1.8, mz);
          this.flashT = 0.08;
        }
        this.host.tracer(mx, 1.8, mz, m.tx, 0.5, m.tz);
        const wasOwn = this.own;
        this.own = true;
        this.host.blast(m.tx, m.tz, 7, 160, 1.3);
        this.own = wasOwn;
      }
    }
  }

  private updateHeli(m: Machine, p: ReturnType<BaseHost['player']>, dt: number, dist: number, hunting: boolean, baseDist: number): void {
    const lift = m.lift ?? 0;
    const chase = hunting && baseDist < 420;
    if (m.rotor) m.rotor.rotation.y += dt * (chase || lift > 0.02 ? 22 : 0.6);
    if (chase) {
      m.lift = Math.min(1, lift + dt * 0.12);
      m.orbit = (m.orbit ?? 0) + dt * 0.35;
      const r = 30;
      const gx = p.x + Math.cos(m.orbit) * r;
      const gz = p.z + Math.sin(m.orbit) * r;
      const k = Math.min(1, dt * 0.6 * (m.lift ?? 0));
      m.x += (gx - m.x) * k;
      m.z += (gz - m.z) * k;
    } else if (lift > 0) {
      // Back to the pad, then down.
      const dx = m.home.x - m.x;
      const dz = m.home.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > 1) {
        const s = Math.min(d, 14 * dt);
        m.x += (dx / d) * s;
        m.z += (dz / d) * s;
      } else m.lift = Math.max(0, lift - dt * 0.15);
    }
    const alt = (m.lift ?? 0) * 24;
    m.y = alt + 1.6;
    m.root.position.set(m.x, alt, m.z);
    const face = chase ? Math.atan2(p.x - m.x, p.z - m.z) : m.home.yaw;
    m.yaw = turnTo(m.yaw, face, dt * 1.6);
    m.root.rotation.y = m.yaw;
    m.root.rotation.x = chase ? 0.12 : 0;
    if (!chase || (m.lift ?? 0) < 0.6) return;
    m.cool -= dt;
    if (m.cool > 0 || !p.exposed) return;
    if (Math.random() < 0.18 && dist < 70) {
      // A rocket: a short whistle, then a blast near you.
      m.cool = 2.6;
      const w = this.host.toWorld(m.x, m.z);
      audio.playAt('launch', w.x, w.z, 1);
      const tx = p.x + (Math.random() - 0.5) * 6;
      const tz = p.z + (Math.random() - 0.5) * 6;
      this.host.tracer(m.x, alt + 1, m.z, tx, 0.3, tz);
      const wasOwn = this.own;
      this.own = true;
      this.host.blast(tx, tz, 5, 70, 1);
      this.own = wasOwn;
      return;
    }
    // Chain gun bursts.
    m.burst = m.burst > 0 ? m.burst - 1 : 8;
    m.cool = m.burst > 0 ? 0.08 : 1.4;
    this.shootFrom(m.x, alt + 0.8, m.z, p, dist, Math.random() < this.dodge(p, Math.max(0.1, 0.34 - dist * 0.003)), 3, 'smg');
  }

  /** Free the soldiers' models. */
  dispose(): void {
    for (const so of this.soldiers) so.model.dispose();
    this.soldiers.length = 0;
  }
}

function angleDiff(a: number, b: number): number {
  return ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/** Turn angle `a` towards `b` by at most `step` radians. */
function turnTo(a: number, b: number, step: number): number {
  const d = angleDiff(b, a);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}
