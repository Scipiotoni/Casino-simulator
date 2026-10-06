import * as THREE from 'three';
import { mat, glow, chrome } from '../render/materials';
import { canvasTexture, makeCanvas } from '../render/textures';
import { buildGun } from '../items/models/guns';
import { gunDef } from '../game/guns';
import { audio } from '../core/audio';

/**
 * Fort Mojave's secret: under the minefield behind the armory, a rusty manhole drops into a
 * shaft and a black-site weapons lab. A corridor of laser tripwires (two blink, one sweeps)
 * leads to the lab, where the army keeps the guns nobody is allowed to sell: seven glass
 * cases and a pedestal. Trip a laser or smash a case and the lab locks down: turrets drop
 * out of the walls and open fire until you're back up the ladder.
 *
 * It's underground, so it lives at its own height (BUNKER_Y) inside a box of rock that hides
 * the sky; nothing on the surface can see or shoot you down here, and guns don't work here
 * (it's indoors). Coordinates are global, like the base.
 */

/** The bunker's floor (metres; the desert is at 0). */
export const BUNKER_Y = -36;
/** How long a lockdown lasts (it starts again if you trip something else). */
export const LOCKDOWN_S = 25;
/** The guns in the cases, in order (the last one sits on the pedestal). */
export const BUNKER_GUNS = ['gauss', 'plasma', 'thunder', 'dragon', 'swarm', 'nuke', 'goldgun'];

/** Rooms (local, x east from the shaft, z south): the shaft, the laser corridor and the lab. */
const ROOMS: [number, number, number, number][] = [
  [-3, 3, -3, 3],
  [3, 27, -1.5, 1.5],
  [27, 51, -9, 9],
];
/** Cut-away walls (like the casino's) so the camera always sees you. */
const WALL_H = 2.6;
/** Where the cases stand (local x, z) and which way they face. */
const CASES: { x: number; z: number; face: number }[] = [
  { x: 31, z: -7.9, face: 0 }, { x: 39, z: -7.9, face: 0 }, { x: 47, z: -7.9, face: 0 },
  { x: 31, z: 7.9, face: Math.PI }, { x: 39, z: 7.9, face: Math.PI }, { x: 47, z: 7.9, face: Math.PI },
  { x: 41.5, z: 0, face: -Math.PI / 2 },
];
/** The laser gates across the corridor: x, and how they behave. */
const GATES: { x: number; kind: 'blink' | 'sweep'; period: number; on: number; phase: number; span?: number }[] = [
  { x: 9, kind: 'blink', period: 2.6, on: 1.5, phase: 0 },
  { x: 15, kind: 'sweep', period: 5, on: 1, phase: 0.3, span: 3.2 },
  { x: 22, kind: 'blink', period: 1.8, on: 1.05, phase: 0.9 },
];

export interface BunkerHost {
  /** A turret fired at you (hit or miss). */
  shot(hit: boolean, dmg: number, fx: number, fz: number, fy: number): void;
  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  notify(text: string, kind: 'good' | 'bad' | 'info'): void;
  toWorld(x: number, z: number): { x: number; z: number };
  /** Do you already own this gun? */
  owned(id: string): boolean;
}

export interface BunkerPlayer {
  x: number;
  z: number;
  under: boolean;
  ko: boolean;
  height: number;
  speed: number;
}

interface Case {
  id: string;
  x: number;
  z: number;
  taken: boolean;
  glass: THREE.Object3D;
  gun: THREE.Object3D;
  plate: THREE.Mesh;
}

interface Turret {
  x: number;
  z: number;
  y: number;
  head: THREE.Object3D;
  /** Watched area (local rect). */
  zone: [number, number, number, number];
  cool: number;
}

export class Bunker {
  readonly group = new THREE.Group();
  /** On the surface: the manhole (in the base's group so it's always there). */
  readonly hatchGroup = new THREE.Group();
  private ox = 0;
  private oz = 0;
  private cases: Case[] = [];
  private turrets: Turret[] = [];
  private beams: { gate: number; beams: THREE.Mesh[]; emitters: THREE.Mesh[] }[] = [];
  private reds: THREE.Mesh[] = [];
  private whites: THREE.Mesh[] = [];
  private t = 0;
  private sirenT = 0;
  /** Seconds of lockdown left (0 = quiet). */
  lockdown = 0;

  constructor(private host: BunkerHost) {}

  /** The manhole on the surface (global). */
  get hatch(): { x: number; z: number } {
    return { x: this.ox, z: this.oz };
  }

  /** The foot of the ladder, where you arrive (global). */
  get ladder(): { x: number; z: number } {
    return { x: this.ox + 0.5, z: this.oz - 1.0 };
  }

  private local(gx: number, gz: number): { x: number; z: number } {
    return { x: gx - this.ox, z: gz - this.oz };
  }

  /** Can you stand here (global)? Inside a room, clear of the cases. */
  walkable(gx: number, gz: number): boolean {
    const { x, z } = this.local(gx, gz);
    const m = 0.3;
    const inRoom = ROOMS.some(([x0, x1, z0, z1]) => x > x0 + m && x < x1 - m && z > z0 + m && z < z1 - m)
      // The doorways between rooms.
      || (x > 2 && x < 4 && Math.abs(z) < 1.2) || (x > 26 && x < 28 && Math.abs(z) < 1.2);
    if (!inRoom) return false;
    for (const c of CASES) {
      const w = c.face === 0 || c.face === Math.PI ? [1.0, 0.7] : [0.8, 1.2];
      if (Math.abs(x - c.x) < w[0] && Math.abs(z - c.z) < w[1]) return false;
    }
    return true;
  }

  /** Standing on the manhole? (global, on the surface) */
  atHatch(gx: number, gz: number): boolean {
    return Math.hypot(gx - this.ox, gz - this.oz) < 1.7;
  }

  /** At the foot of the ladder? (global, underground) */
  atLadder(gx: number, gz: number): boolean {
    return Math.hypot(gx - this.ladder.x, gz - this.ladder.z) < 1.6;
  }

  /** The case you're standing at (global), if any. */
  caseAt(gx: number, gz: number): { id: string; taken: boolean } | null {
    const { x, z } = this.local(gx, gz);
    let best: Case | null = null;
    let bd = 2.7;
    for (const c of this.cases) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best ? { id: best.id, taken: best.taken } : null;
  }

  /** Smash the case and take what's in it: the lab locks down. */
  take(id: string): boolean {
    const c = this.cases.find((x) => x.id === id);
    if (!c || c.taken) return false;
    c.taken = true;
    c.glass.visible = false;
    c.gun.visible = false;
    (c.plate.material as THREE.MeshBasicMaterial).color.set(0x3a3346);
    audio.play('glass');
    this.lock('🚨 Case alarm! The lab is in LOCKDOWN: the turrets are live. Get back up the ladder!');
    return true;
  }

  /** The lab goes into lockdown (or stays in it). */
  lock(message?: string): void {
    const first = this.lockdown <= 0;
    this.lockdown = LOCKDOWN_S;
    if (first) {
      audio.play('alarm');
      if (message) this.host.notify(message, 'bad');
    }
  }

  build(cx: number, cz: number): void {
    // Under the minefield behind the armory, on whole metres so the tiles line up.
    this.ox = Math.round(cx - 104);
    this.oz = Math.round(cz + 78);
    for (const c of [...this.group.children]) c.removeFromParent();
    for (const c of [...this.hatchGroup.children]) c.removeFromParent();
    this.cases = [];
    this.turrets = [];
    this.beams = [];
    this.reds = [];
    this.whites = [];
    this.lockdown = 0;
    this.buildHatch();
    this.buildRock();
    this.buildRooms();
    this.buildLasers();
    this.buildCases();
    this.buildTurrets();
    this.group.visible = false;
  }

  /** A rusty manhole cover in the sand beside the drums, half covered in dust. */
  private buildHatch(): void {
    const g = this.hatchGroup;
    const rust = mat(0x6b4a2a, { rough: 0.9, metal: 0.4 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.06, 24), mat(0x3a3c40, { rough: 0.8, metal: 0.5 }));
    ring.position.set(this.ox, 0.02, this.oz);
    g.add(ring);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.07, 24), rust);
    lid.position.set(this.ox, 0.05, this.oz);
    g.add(lid);
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.06), mat(0x4a3420, { rough: 0.9 }));
      bar.position.set(this.ox, 0.09, this.oz + i * 0.22);
      g.add(bar);
    }
    // A faint glint, if you know where to look.
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshBasicMaterial({ color: 0x9cff6a, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    glint.rotation.x = -Math.PI / 2;
    glint.position.set(this.ox, 0.1, this.oz);
    g.add(glint);
  }

  /** A box of dark rock all round the bunker: from inside it, there's no sky. */
  private buildRock(): void {
    const c = makeCanvas(256, 256);
    c.ctx.fillStyle = '#2a2018';
    c.ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 20 + Math.floor(Math.random() * 40);
      c.ctx.fillStyle = `rgb(${v + 12},${v + 6},${v})`;
      c.ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 8, 2 + Math.random() * 6);
    }
    const tex = canvasTexture(c.canvas, true);
    tex.repeat.set(8, 4);
    const rock = new THREE.Mesh(new THREE.BoxGeometry(120, 34, 70), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: 0x8a7a6a }));
    rock.position.set(this.ox + 24, BUNKER_Y + 13, this.oz);
    this.group.add(rock);
    // The cave floor round the rooms.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 70), new THREE.MeshBasicMaterial({ map: tex, color: 0x4a3e32 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.ox + 24, BUNKER_Y - 0.05, this.oz);
    this.group.add(floor);
  }

  private buildRooms(): void {
    const { ox, oz } = this;
    const Y = BUNKER_Y;
    const conc = mat(0x6e7176, { rough: 0.85 });
    const dark = mat(0x2a2c30, { rough: 0.7 });
    const floorMat = mat(0x3c3f45, { rough: 0.55, metal: 0.25 });
    const add = (m: THREE.Mesh) => {
      m.receiveShadow = false;
      m.castShadow = false;
      this.group.add(m);
      return m;
    };
    const box = (mt: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt));
      m.position.set(ox + x, Y + y, oz + z);
      return m;
    };
    // Floors.
    for (const [x0, x1, z0, z1] of ROOMS) {
      const f = add(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), floorMat));
      f.rotation.x = -Math.PI / 2;
      f.position.set(ox + (x0 + x1) / 2, Y + 0.01, oz + (z0 + z1) / 2);
    }
    // Hazard line at the lab door.
    box(mat(0xffd23f, { rough: 0.7 }), 0.25, 0.02, 3, 26.5, 0.02, 0);
    // Walls: each room's outline, with gaps for the doorways.
    const T = 0.5;
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = box(conc, Math.abs(x1 - x0) > 0.01 ? len + T : T, WALL_H, Math.abs(z1 - z0) > 0.01 ? len + T : T, (x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2);
      // A dark top so they read from above.
      box(dark, Math.abs(x1 - x0) > 0.01 ? len + T : T, 0.06, Math.abs(z1 - z0) > 0.01 ? len + T : T, (x0 + x1) / 2, WALL_H + 0.03, (z0 + z1) / 2);
      return m;
    };
    // Shaft.
    wall(-3, -3, 3, -3);
    wall(-3, 3, 3, 3);
    wall(-3, -3, -3, 3);
    wall(3, -3, 3, -1.5);
    wall(3, 1.5, 3, 3);
    // Corridor.
    wall(3, -1.5, 27, -1.5);
    wall(3, 1.5, 27, 1.5);
    // Lab.
    wall(27, -9, 51, -9);
    wall(27, 9, 51, 9);
    wall(51, -9, 51, 9);
    wall(27, -9, 27, -1.5);
    wall(27, 1.5, 27, 9);
    // The ladder up the shaft wall, all the way to the top of the rock.
    const steel = chrome();
    for (const sx of [-0.3, 0.3]) box(steel, 0.06, 30, 0.06, 0.5 + sx, 15, -2.65);
    for (let i = 0; i < 60; i++) box(steel, 0.6, 0.04, 0.04, 0.5, 0.3 + i * 0.5, -2.65);
    // Light strips along the wall tops and glowing floor panels.
    const white = glow(0xdff4ff, 0.9);
    for (const [x, z, w, d] of [[15, -1.35, 24, 0.12], [15, 1.35, 24, 0.12], [39, -8.85, 24, 0.12], [39, 8.85, 24, 0.12], [50.85, 0, 0.12, 18], [0, -2.85, 6, 0.12]] as const) {
      this.whites.push(box(white, w, 0.1, d, x, WALL_H + 0.08, z));
    }
    for (let i = 0; i < 4; i++) box(glow(0x2fe6ff, 0.35), 4, 0.02, 0.5, 31 + i * 5.3, 0.03, 0);
    // Red lockdown beacons.
    for (const [x, z] of [[2.8, 0], [26.8, -1.2], [26.8, 1.2], [50.8, -5], [50.8, 5], [39, -8.8], [39, 8.8]] as const) {
      const r = box(glow(0xff2a2a, 3), 0.3, 0.3, 0.3, x, WALL_H + 0.2, z);
      r.visible = false;
      this.reds.push(r);
    }
    // Stencilled signs.
    const sign = (title: string, sub: string, x: number, z: number, ry: number) => {
      const c = makeCanvas(512, 160);
      c.ctx.fillStyle = '#14121a';
      c.ctx.fillRect(0, 0, 512, 160);
      c.ctx.fillStyle = '#ffd23f';
      c.ctx.font = '900 54px Arial, sans-serif';
      c.ctx.textAlign = 'center';
      c.ctx.fillText(title, 256, 72);
      c.ctx.fillStyle = '#ff5a3a';
      c.ctx.font = '800 26px Arial, sans-serif';
      c.ctx.fillText(sub, 256, 122);
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshBasicMaterial({ map: canvasTexture(c.canvas) })));
      m.position.set(ox + x, Y + 1.7, oz + z);
      m.rotation.y = ry;
    };
    sign('SITE 51-B', 'NO PERSONNEL BEYOND THIS POINT', 2.7, 0, -Math.PI / 2);
    sign('EXPERIMENTAL', 'WEAPONS ARCHIVE · LEVEL 7', 50.7, 0, -Math.PI / 2);
  }

  private buildLasers(): void {
    const m = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    GATES.forEach((gate, gi) => {
      const beams: THREE.Mesh[] = [];
      const emitters: THREE.Mesh[] = [];
      for (const y of [0.35, 0.95, 1.55, 2.15]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 3), m);
        beam.position.set(this.ox + gate.x, BUNKER_Y + y, this.oz);
        this.group.add(beam);
        beams.push(beam);
      }
      // Emitters on the walls (they ride along with a sweeping gate).
      for (const sz of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.15), mat(0x17151f, { rough: 0.4, metal: 0.5 }));
        e.position.set(this.ox + gate.x, BUNKER_Y + 1.2, this.oz + sz * 1.42);
        this.group.add(e);
        emitters.push(e);
      }
      this.beams.push({ gate: gi, beams, emitters });
    });
  }

  /** Where a gate is right now (local x) and whether its beams are on. */
  private gateState(i: number): { x: number; on: boolean } {
    const g = GATES[i];
    const ph = ((this.t + g.phase * g.period) % g.period) / g.period;
    if (g.kind === 'sweep') return { x: g.x + Math.sin(ph * Math.PI * 2) * (g.span ?? 3), on: true };
    return { x: g.x, on: ph * g.period < g.on };
  }

  private buildCases(): void {
    const glass = new THREE.MeshStandardMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const base = mat(0x17151f, { rough: 0.35, metal: 0.6 });
    CASES.forEach((c, i) => {
      const id = BUNKER_GUNS[i];
      const def = gunDef(id);
      if (!def) return;
      const root = new THREE.Group();
      root.position.set(this.ox + c.x, BUNKER_Y, this.oz + c.z);
      root.rotation.y = c.face;
      this.group.add(root);
      const pedestal = i === CASES.length - 1;
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(pedestal ? 1.4 : 1.8, 1.0, pedestal ? 1.4 : 1.0), base);
      plinth.position.y = 0.5;
      root.add(plinth);
      const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(pedestal ? 1.42 : 1.82, 0.05, pedestal ? 1.42 : 1.02), glow(def.tracer, 1.1));
      glowStrip.position.y = 1.0;
      root.add(glowStrip);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(pedestal ? 1.3 : 1.7, 1.1, pedestal ? 1.3 : 0.9), glass);
      gl.position.y = 1.58;
      root.add(gl);
      const gun = buildGun(def).group;
      gun.scale.setScalar(pedestal ? 3.2 : 2.6);
      gun.position.y = 1.5;
      gun.rotation.y = Math.PI / 2;
      root.add(gun);
      // Name plate on the front of the plinth.
      const pc = makeCanvas(256, 64);
      pc.ctx.fillStyle = '#0b0a10';
      pc.ctx.fillRect(0, 0, 256, 64);
      pc.ctx.fillStyle = '#ffffff';
      pc.ctx.font = '800 26px Arial, sans-serif';
      pc.ctx.textAlign = 'center';
      pc.ctx.textBaseline = 'middle';
      pc.ctx.fillText(def.name.toUpperCase(), 128, 34, 240);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: canvasTexture(pc.canvas), color: 0xffffff }));
      plate.position.set(0, 0.6, (pedestal ? 0.71 : 0.51));
      root.add(plate);
      const taken = this.host.owned(id);
      gl.visible = !taken;
      gun.visible = !taken;
      if (taken) (plate.material as THREE.MeshBasicMaterial).color.set(0x3a3346);
      this.cases.push({ id, x: c.x, z: c.z, taken, glass: gl, gun, plate });
    });
  }

  private buildTurrets(): void {
    const dark = mat(0x23252a, { rough: 0.4, metal: 0.6 });
    const add = (x: number, z: number, zone: [number, number, number, number]) => {
      const head = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), dark);
      head.add(dome);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 8), chrome());
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.4;
      head.add(barrel);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(0xff2a2a, 3));
      eye.position.set(0, 0.12, 0.26);
      head.add(eye);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), dark);
      arm.position.y = 0.4;
      head.add(arm);
      head.position.set(this.ox + x, BUNKER_Y + WALL_H + 0.5, this.oz + z);
      this.group.add(head);
      this.turrets.push({ x: this.ox + x, z: this.oz + z, y: BUNKER_Y + WALL_H + 0.5, head, zone, cool: 1 + Math.random() });
    };
    const lab: [number, number, number, number] = [26, 51, -9, 9];
    add(28, -8.4, lab);
    add(28, 8.4, lab);
    add(50.3, -8.4, lab);
    add(50.3, 8.4, lab);
    // One at the far end of the corridor, looking back down it.
    add(26.4, 0, [3, 27, -1.5, 1.5]);
  }

  /** What the HUD should say, if anything. */
  status(under: boolean): { text: string; kind: 'alert' | 'info' } | null {
    if (!under) return null;
    if (this.lockdown > 0) return { text: `🚨 LOCKDOWN ${Math.ceil(this.lockdown)}s · get back up the ladder!`, kind: 'alert' };
    const left = this.cases.filter((c) => !c.taken).length;
    return { text: left ? `🔦 Site 51-B · ${left} prototype weapon${left === 1 ? '' : 's'} in the lab · don’t touch the lasers` : '🔦 Site 51-B · the lab is empty', kind: 'info' };
  }

  update(dt: number, p: BunkerPlayer): void {
    this.t += dt;
    this.group.visible = p.under;
    // Lasers: blink and sweep (always, so they're right when you climb down).
    for (const b of this.beams) {
      const st = this.gateState(b.gate);
      for (const m of b.beams) {
        m.visible = st.on;
        m.position.x = this.ox + st.x;
      }
      for (const m of b.emitters) m.position.x = this.ox + st.x;
    }
    if (this.lockdown > 0) {
      this.lockdown = Math.max(0, this.lockdown - dt);
      if (!p.under) this.lockdown = Math.max(0, this.lockdown - dt * 3);
    }
    const blink = Math.floor(this.t * 4) % 2 === 0;
    for (const r of this.reds) r.visible = this.lockdown > 0 && blink;
    for (const w of this.whites) w.visible = this.lockdown <= 0 || !blink;
    if (!p.under || p.ko) {
      for (const tu of this.turrets) tu.head.position.y = tu.y - 0.75;
      return;
    }
    const lp = this.local(p.x, p.z);
    // Tripwires: walk into a live beam and the lab locks down.
    if (this.lockdown <= 0) {
      for (let i = 0; i < GATES.length; i++) {
        const st = this.gateState(i);
        if (st.on && Math.abs(lp.x - st.x) < 0.32 && Math.abs(lp.z) < 1.5) {
          this.lock('🚨 You broke a laser beam! The lab is in LOCKDOWN: the turrets are live.');
          break;
        }
      }
    }
    if (this.lockdown > 0) {
      this.sirenT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = 2.4;
        audio.play('alarm', { volume: 0.5 });
      }
    }
    // Turrets pop up out of the wall tops during a lockdown and track you.
    for (const tu of this.turrets) {
      const down = this.lockdown > 0;
      tu.head.position.y = THREE.MathUtils.lerp(tu.head.position.y, tu.y - (down ? 0 : 0.75), Math.min(1, dt * 4));
      if (!down) continue;
      const [x0, x1, z0, z1] = tu.zone;
      if (lp.x < x0 || lp.x > x1 || lp.z < z0 || lp.z > z1) continue;
      const dx = p.x - tu.x;
      const dz = p.z - tu.z;
      tu.head.rotation.y = Math.atan2(dx, dz);
      tu.cool -= dt;
      if (tu.cool > 0) continue;
      tu.cool = 0.34 + Math.random() * 0.12;
      const hit = Math.random() < 0.5 / (1 + p.speed / 7);
      const miss = hit ? 0 : 0.5 + Math.random();
      const d = Math.max(0.01, Math.hypot(dx, dz));
      const side = Math.random() < 0.5 ? 1 : -1;
      const tx = p.x + (-dz / d) * miss * side;
      const tz = p.z + (dx / d) * miss * side;
      this.host.tracer(tu.x, tu.y - 0.1, tu.z, tx, BUNKER_Y + (hit ? p.height * 0.7 : 0.3 + Math.random()), tz);
      const w = this.host.toWorld(tu.x, tu.z);
      audio.playAt('smg', w.x, w.z, 0.7);
      this.host.shot(hit, hit ? 6 : 0, tu.x, tu.z, tu.y);
    }
  }
}
