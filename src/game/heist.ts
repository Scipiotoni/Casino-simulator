import * as THREE from 'three';
import type { Game } from './game';
import type { PlacedItem } from '../items/placedItem';
import type { CasinoSnapshot } from './save';
import { Walker } from '../entities/walker';
import { type Appearance, applyUniform, randomStaffAppearance } from '../entities/appearance';
import { buildGun } from '../items/models/guns';
import { gunDef } from './guns';
import { findPath, smoothPath } from '../world/pathfinding';
import { CENTER_X, DOOR_TILES, FACADE_Z, type Grid } from '../world/grid';
import { doorType } from '../world/walls';
import { NPC_HOUSE_LOOK } from '../world/street';
import { audio } from '../core/audio';
import { clamp, dampAngle, formatMoney } from '../core/math';
import { mat } from '../render/materials';
import { vaultTier } from './house';
import {
  type HeistRecord, type Stage, MAX_RECORDS, OFFLINE_SHARE, ONLINE_SHARE, NPC_REFILL_MS, cleanRecords, doorStages, failFine, guardFine, lockoutMs, runQuality, shareTake,
  timelockSeconds, vaultStages, waitText,
} from './heistRules';

/** Another player's house you could rob, as the street knows it. */
export interface HouseTarget {
  pid: string;
  owner: string;
  snap: CasinoSnapshot;
  /** Money in the vault (best known). */
  vault: number;
  tier: number;
  /** Is the owner playing right now (a bigger take, but they can come home and fight)? */
  online: boolean;
  /** Uncle Sal's NPC house: robberies stay private (each player has their own Sal) and it refills. */
  npc?: boolean;
  /** Most of the vault a perfect run takes (default: 10% offline, 50% online). */
  share?: number;
  /** Most a lost minigame can cost here (a knockout up to twice that). Uncle Sal's fines stay small, like his stash. */
  fineCap?: number;
}

/** What losing costs at this house: a fine for a lost minigame, and the guards' cut for a knockout. */
export function heistFines(t: HouseTarget, cash: number): { fail: number; ko: number } {
  const tier = Math.max(1, t.tier);
  const fail = failFine(cash, tier);
  const ko = guardFine(cash, tier);
  if (t.fineCap === undefined) return { fail, ko };
  return { fail: Math.min(fail, t.fineCap), ko: Math.min(ko, t.fineCap * 2) };
}

type GuardRole = 'bodyguard' | 'gate' | 'response' | 'watchman';

/**
 * Uncle Sal's house: a cosy front room, a deadbolt door into the back room with his Steel
 * Safe Room, one night watchman and a camera. Small lot: 14 tiles wide (x 17..30), 16 deep
 * (z 24..39), with the wall across at z = 31.
 */
export function npcHouseSnapshot(floorStyle: number): CasinoSnapshot {
  const it = (id: string, tx: number, tz: number, rot = 0, color = 0xffffff) => ({
    id, tx, tz, rot, level: 1, color, broken: false, stats: { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 },
  });
  return {
    name: NPC_HOUSE_LOOK.name, look: { ...NPC_HOUSE_LOOK }, layout: { width: 0, depth: 1 }, floors: 1,
    paint: [`${floorStyle}:224`],
    // Cream walls across the house, a deadbolt door (lock 1) in the middle.
    walls: ['0:98,2:7,201:1,2:6,0:112'],
    items: [
      // Front room
      it('sofa', 18, 36, 2, 0x8a1030), it('coffeetable', 18, 34), it('tvwall', 18, 32), it('plantbig', 17, 38), it('plantbig', 30, 32),
      it('kitchen', 27, 32), it('diningtable', 26, 35), it('cctv', 29, 38, 2),
      // Back room: the safe room
      it('vault', 22, 25), it('kingbed', 27, 24, 0, 0x1f2748), it('nightstand', 26, 24), it('bookshelf', 18, 24), it('armchair', 18, 27), it('floorlamp', 17, 24),
    ],
    staff: [{ role: 'security', name: 'Vinnie', look: randomStaffAppearance('security') }],
    rating: 3,
  };
}

/** Guards are tough: lots of health, quick and accurate. Don't take them on lightly. */
const GUARD_STATS: Record<GuardRole, { hp: number; dmg: number; cool: number; gun: string; speed: number; title: string; color: number }> = {
  bodyguard: { hp: 420, dmg: 15, cool: 0.62, gun: 'smg', speed: 1.9, title: 'bodyguard', color: 0x17151f },
  gate: { hp: 320, dmg: 13, cool: 0.8, gun: 'deagle', speed: 1.8, title: 'gate guard', color: 0x5a0f24 },
  response: { hp: 520, dmg: 18, cool: 0.55, gun: 'rifle', speed: 2.1, title: 'armed response guard', color: 0x1f2b3a },
  // Uncle Sal's night watchman: a real fight, but not a wall of muscle.
  watchman: { hp: 170, dmg: 8, cool: 1.1, gun: 'pistol', speed: 1.6, title: 'night watchman', color: 0x2b3a5a },
};

/** Seconds a knocked-out guard stays down before getting back up (angry, half health). */
const GUARD_DOWN = 25;

const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** A house guard with a gun, hunting the burglar. */
export class HeistGuard extends Walker {
  hp: number;
  readonly maxHp: number;
  ko = 0;
  /** Seconds they still know exactly where you are (after seeing you). */
  known = 0;
  hunting = false;
  lastX = 0;
  lastZ = 0;
  private cool = 1;
  private repath = 0;
  private searchT = 0;
  private wanderT = 1;
  readonly homeX: number;
  readonly homeZ: number;

  constructor(readonly role: GuardRole, look: Appearance, x: number, z: number, floor: number) {
    super(applyUniform({ ...look, prop: 'none' }, role === 'gate' ? 'doorman' : 'security'), x, z);
    const st = GUARD_STATS[role];
    this.hp = this.maxHp = st.hp;
    this.speed = st.speed;
    this.floor = floor;
    this.homeX = x;
    this.homeZ = z;
    const d = gunDef(st.gun)!;
    this.model.hand.add(buildGun(d).group);
    this.model.aim = d.twoHand ? 2 : 1;
    this.yaw = Math.PI;
  }

  get stats() {
    return GUARD_STATS[this.role];
  }

  /** Heard something or got told on the radio: go and look there. */
  alert(x: number, z: number): void {
    if (this.ko > 0) return;
    // Only plan a new route when the spot really moved (the siren repeats it every frame).
    if (!this.hunting || Math.hypot(x - this.lastX, z - this.lastZ) > 1.5) this.repath = Math.min(this.repath, 0.15);
    this.lastX = x;
    this.lastZ = z;
    this.hunting = true;
    this.searchT = 0;
  }

  update(dt: number, h: Heist): void {
    const m = this.model;
    const g = h.g;
    if (this.ko > 0) {
      this.ko -= dt;
      this.stop();
      m.root.position.set(this.x, 0, this.z);
      m.setPose('ko');
      m.update(dt);
      if (this.ko <= 0) {
        this.hp = Math.round(this.maxHp * 0.5);
        this.alert(g.player.x, g.player.z);
        g.floaters.text(new THREE.Vector3(this.x, 2.3, this.z), 'Back up!', 'bad', 1.2);
      }
      return;
    }
    const p = g.player;
    const grid = g.gridAt(this.floor);
    const here = p.floor === this.floor && h.targetable;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    const toYou = Math.atan2(dx, dz);
    let sees = false;
    if (here && dist < 15) {
      const inView = Math.abs(angleDiff(this.yaw, toYou)) < 1.15 || dist < 2.2 || this.known > 0;
      sees = inView && h.clearSight(this.floor, this.x, this.z, p.x, p.z);
    }
    if (sees) {
      if (this.known <= 0 && !this.hunting) h.spotted(this);
      this.known = 5;
      this.alert(p.x, p.z);
    } else this.known = Math.max(0, this.known - dt);
    // The siren tells every guard where you are.
    if (h.siren > 0 && here) this.alert(p.x, p.z);
    this.cool -= dt;
    if (sees && dist < 12.5) {
      // In sight: stand and shoot.
      this.stop();
      this.run = false;
      this.yaw = dampAngle(this.yaw, toYou, 10, dt);
      if (this.cool <= 0 && Math.abs(angleDiff(this.yaw, toYou)) < 0.4) {
        this.cool = this.stats.cool * (0.85 + Math.random() * 0.35);
        h.guardFire(this, dist);
      }
    } else if (this.hunting) {
      this.run = true;
      this.repath -= dt;
      const gx = Math.floor(this.lastX);
      const gz = Math.floor(this.lastZ);
      if (this.repath <= 0 || !this.goal) {
        this.repath = 0.6;
        if (Math.hypot(this.lastX - this.x, this.lastZ - this.z) > 0.8) this.walkTo(grid, gx, gz);
      }
      const r = this.stepPath(dt, grid);
      if (r !== 'moving') {
        // Got there and nobody's around: look about, then go back to work.
        this.searchT += dt;
        this.yaw += dt * 1.6;
        if (this.searchT > 5 && h.siren <= 0) {
          this.hunting = false;
          this.searchT = 0;
        }
      }
    } else {
      // On patrol: stroll between spots near their post.
      this.run = false;
      this.wanderT -= dt;
      if (this.wanderT <= 0 && !this.goal) {
        this.wanderT = 3 + Math.random() * 4;
        if (this.role === 'gate') this.walkTo(grid, Math.floor(this.homeX), Math.floor(this.homeZ));
        else {
          const tx = Math.floor(this.homeX + (Math.random() - 0.5) * 9);
          const tz = Math.floor(this.homeZ + (Math.random() - 0.5) * 9);
          if (grid.isWalkable(tx, tz) && grid.isOwned(tx, tz)) this.walkTo(grid, tx, tz);
        }
      }
      if (this.goal) this.stepPath(dt, grid);
    }
    this.syncModel(dt);
  }

  /** You shot them. True if they went down. */
  hurt(dmg: number): boolean {
    if (this.ko > 0) return false;
    this.hp -= dmg;
    this.model.flinch = 1;
    if (this.hp > 0) return false;
    this.ko = GUARD_DOWN;
    this.hunting = false;
    this.known = 0;
    return true;
  }
}

/** The guard dog: fast, a nose for burglars, a loud bark and a nasty bite. */
class GuardDog {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Mesh[] = [];
  private tail: THREE.Mesh;
  x: number;
  z: number;
  yaw = 0;
  floor = 0;
  hp = 150;
  ko = 0;
  chasing = false;
  private path: [number, number][] = [];
  private pi = 0;
  private repath = 0;
  private biteT = 0;
  private barkT = 0;
  private wanderT = 2;
  private legT = 0;

  constructor(readonly homeX: number, readonly homeZ: number, floor: number) {
    this.x = homeX;
    this.z = homeZ;
    this.floor = floor;
    const fur = mat(0x6b4422, { rough: 0.9 });
    const dark = mat(0x3a2414, { rough: 0.9 });
    const sph = (r: number, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), m);
      s.position.set(x, y, z);
      s.scale.set(sx, sy, sz);
      s.castShadow = true;
      this.body.add(s);
      return s;
    };
    sph(0.24, fur, 0, 0.5, 0, 0.85, 0.8, 1.55);
    sph(0.17, fur, 0, 0.72, 0.38);
    sph(0.09, fur, 0, 0.67, 0.55, 1, 0.8, 1.2);
    sph(0.035, mat(0x111111), 0, 0.69, 0.66);
    for (const s of [-1, 1]) sph(0.07, dark, s * 0.11, 0.85, 0.32, 0.5, 1.3, 0.8);
    for (const s of [-1, 1]) sph(0.025, mat(0x111111), s * 0.07, 0.77, 0.5);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), mat(0xc8102e));
    collar.position.set(0, 0.62, 0.3);
    collar.rotation.x = Math.PI / 2.4;
    this.body.add(collar);
    for (const [lx, lz] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.38, 6), fur);
      leg.geometry.translate(0, -0.19, 0);
      leg.position.set(lx, 0.4, lz);
      this.body.add(leg);
      this.legs.push(leg);
    }
    this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.3, 6), fur);
    this.tail.geometry.translate(0, 0.15, 0);
    this.tail.position.set(0, 0.58, -0.36);
    this.tail.rotation.x = -0.8;
    this.body.add(this.tail);
    this.root.add(this.body);
  }

  update(dt: number, h: Heist): void {
    const g = h.g;
    if (this.ko > 0) {
      this.ko -= dt;
      this.body.rotation.z = Math.PI / 2;
      this.body.position.y = 0.2;
      this.root.position.set(this.x, 0, this.z);
      if (this.ko <= 0) {
        this.hp = 80;
        this.body.rotation.z = 0;
        this.body.position.y = 0;
      }
      return;
    }
    const p = g.player;
    const grid = g.gridAt(this.floor);
    const here = p.floor === this.floor && h.targetable;
    const dist = Math.hypot(p.x - this.x, p.z - this.z);
    // A nose for burglars: sees you across a room, smells you round a corner.
    if (here && (dist < 3.5 || (dist < 10 && h.clearSight(this.floor, this.x, this.z, p.x, p.z)))) {
      if (!this.chasing) h.say(this.x, this.z, 'WOOF!');
      this.chasing = true;
    } else if (!here || dist > 16) this.chasing = false;
    let speed = 1.1;
    let tx = this.x;
    let tz = this.z;
    if (this.chasing) {
      speed = 5.4;
      this.barkT -= dt;
      if (this.barkT <= 0) {
        this.barkT = 1.6;
        audio.playAt('bark', this.x, this.z, 1);
        h.noise(this.x, this.z, 16);
      }
      this.repath -= dt;
      if (this.repath <= 0) {
        this.repath = 0.45;
        this.plan(grid, p.x, p.z);
      }
      this.biteT -= dt;
      if (dist < 1.05 && this.biteT <= 0) {
        this.biteT = 0.75;
        g.combat.damage(13, 'guard', `${h.target.owner}'s guard dog`, this.x, this.z);
        audio.playAt('bark', this.x, this.z, 0.8);
      }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 3 + Math.random() * 3;
        this.plan(grid, this.homeX + (Math.random() - 0.5) * 4, this.homeZ + (Math.random() - 0.5) * 4);
      }
    }
    const wp = this.path[this.pi];
    let moving = false;
    if (wp && !(this.chasing && dist < 0.9)) {
      tx = wp[0];
      tz = wp[1];
      const dx = tx - this.x;
      const dz = tz - this.z;
      const d = Math.hypot(dx, dz);
      const step = speed * dt;
      if (d <= step) {
        this.x = tx;
        this.z = tz;
        this.pi++;
      } else {
        this.x += (dx / d) * step;
        this.z += (dz / d) * step;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
      }
      moving = true;
    } else if (this.chasing) this.yaw = dampAngle(this.yaw, Math.atan2(p.x - this.x, p.z - this.z), 12, dt);
    this.legT += dt * (moving ? speed * 4 : 0);
    // Diagonal pairs swing together (a trot).
    this.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(this.legT + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0));
    this.tail.rotation.z = Math.sin(performance.now() / (this.chasing ? 60 : 200)) * 0.5;
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
  }

  private plan(grid: ReturnType<Game['gridAt']>, x: number, z: number): void {
    const tiles = findPath(grid, Math.floor(this.x), Math.floor(this.z), Math.floor(x), Math.floor(z));
    this.path = tiles ? smoothPath(grid, tiles, this.x, this.z, 0.25) : [];
    this.pi = 0;
  }

  hurt(dmg: number): boolean {
    if (this.ko > 0) return false;
    this.hp -= dmg;
    this.chasing = true;
    if (this.hp > 0) return false;
    this.ko = 30;
    this.chasing = false;
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/** Something in the house you can shoot. */
export type HeistTarget = HeistGuard | GuardDog;

interface Laser {
  item: PlacedItem;
  phase: number;
  on: boolean;
  zapT: number;
  beams: THREE.Object3D | null;
}

interface Watcher {
  item: PlacedItem;
  kind: 'cam' | 'spot';
  range: number;
  half: number;
  meter: number;
  cool: number;
  cone: THREE.Group;
  fill: THREE.Mesh;
}

/** Where a heist stands: still cracking, waiting on the time lock, open, or cash in hand. */
export type VaultPhase = 'locked' | 'timelock' | 'open' | 'looted';

/**
 * A break-in at another player's house, simulated on the burglar's side: the owner's
 * guards turn hostile and shoot (they're very strong), the dog hunts, cameras and spotlights
 * sweep, laser grids burn, the metal detector beeps, the alarm calls the panic-button
 * response team, locked doors need cracking and the vault takes minigames and a time lock.
 * Get out the front door with the cash and it's yours.
 */
export class Heist {
  readonly group = new THREE.Group();
  guards: HeistGuard[] = [];
  dogs: GuardDog[] = [];
  private lasers: Laser[] = [];
  private watchers: Watcher[] = [];
  private detectors: PlacedItem[] = [];
  private detectCool = 0;
  private hasAlarm = false;
  private panics = 0;
  private responders: number[] = [];
  readonly safes: number;
  /** Seconds the siren keeps wailing (every guard knows where you are meanwhile). */
  siren = 0;
  private sirenT = 0;
  /** The alarm went off at some point (the owner hears of it, the police wait outside). */
  alarmed = false;
  private silentCool = 0;
  private unlocked = new Set<string>();
  vault: PlacedItem | null = null;
  phase: VaultPhase = 'locked';
  timelock = 0;
  private timelockMax = 1;
  private drillT = 0;
  quality = 0;
  /** Cash you're carrying out (only yours once you're through the front door). */
  loot = 0;
  /** In a minigame: you stand still. */
  busy = false;
  over = false;
  /** Knocked out: thrown out when you come round. */
  private downed = false;
  private shots: number;
  readonly online: boolean;
  readonly tier: number;
  readonly started = Date.now();

  constructor(readonly g: Game, readonly target: HouseTarget) {
    this.online = target.online;
    this.tier = Math.max(1, target.tier);
    this.shots = g.gunplay.shots;
    g.renderer.scene.add(this.group);
    // The house's own staff: guards turn into the real thing, everyone else carries on.
    const looks = { security: [] as Appearance[], doorman: [] as Appearance[] };
    for (const w of [...g.workers]) {
      if (w.role !== 'security' && w.role !== 'doorman') continue;
      looks[w.role].push(w.look);
      w.release();
      w.model.root.removeFromParent();
      w.dispose();
      g.workers = g.workers.filter((o) => o !== w);
    }
    this.vault = g.items.items.find((i) => i.def.kind === 'vault') ?? null;
    if (this.vault && this.vault.level !== this.tier) {
      this.vault.level = this.tier;
      this.vault.rebuildModel();
    }
    const g0 = g.gridAt(0);
    const spotNear = (x: number, z: number, r: number): [number, number] => {
      for (let k = 0; k < 30; k++) {
        const tx = Math.floor(x + (Math.random() - 0.5) * r * 2);
        const tz = Math.floor(z + (Math.random() - 0.5) * r * 2);
        if (g0.isWalkable(tx, tz) && g0.isOwned(tx, tz)) return [tx + 0.5, tz + 0.5];
      }
      const n = g0.nearestWalkable(Math.floor(x), Math.floor(z), true);
      return n ? [n[0] + 0.5, n[1] + 0.5] : [x, z];
    };
    // Bodyguards stand watch around the vault; gate guards just inside the front door.
    const vx = this.vault?.cx ?? CENTER_X;
    const vz = this.vault?.cz ?? FACADE_Z - 6;
    looks.security.forEach((look, i) => {
      const [x, z] = spotNear(vx, vz + 1.5, 2 + i);
      this.addGuard(target.npc ? 'watchman' : 'bodyguard', look, x, z, this.vault?.floor ?? 0);
    });
    looks.doorman.forEach((look, i) => {
      const [x, z] = spotNear(CENTER_X + (i ? 1.6 : -1.6), FACADE_Z - 2, 1);
      this.addGuard('gate', look, x, z, 0);
    });
    let safes = 0;
    for (const it of g.items.items) {
      const id = it.def.id;
      if (id === 'laser') {
        this.lasers.push({ item: it, phase: (it.uid * 1.37) % 4.4, on: true, zapT: 0, beams: it.model.root.getObjectByName('laserBeams') ?? null });
      } else if (id === 'cctv' || id === 'spotlight') {
        // What it watches, drawn on the floor: a red cone for a camera, a pool of light for a spotlight.
        const cam = id === 'cctv';
        const range = cam ? 10 : 13;
        const half = cam ? 0.55 : 0.36;
        const sector = new THREE.CircleGeometry(range, 24, -Math.PI / 2 - half, half * 2);
        sector.rotateX(-Math.PI / 2);
        const fill = new THREE.Mesh(sector, new THREE.MeshBasicMaterial({
          color: cam ? 0xff3344 : 0xfff2c8, transparent: true, opacity: cam ? 0.1 : 0.12, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        }));
        fill.position.y = 0.03;
        const w: Watcher = { item: it, kind: cam ? 'cam' : 'spot', range, half, meter: 0, cool: 0, cone: new THREE.Group(), fill };
        w.cone.add(fill);
        w.cone.position.set(it.cx, 0, it.cz);
        this.group.add(w.cone);
        this.watchers.push(w);
      } else if (id === 'metaldetector') this.detectors.push(it);
      else if (id === 'alarm') this.hasAlarm = true;
      else if (id === 'panicbutton') this.panics++;
      else if (id === 'safe') safes++;
      else if (id === 'doghouse') {
        const pup = it.model.root.getObjectByName('guardDog');
        if (pup) pup.visible = false;
        const [x, z] = spotNear(it.cx, it.cz + 1.4, 1);
        const dog = new GuardDog(x, z, it.floor);
        this.dogs.push(dog);
        this.group.add(dog.root);
      }
    }
    this.safes = safes;
    this.setupFloorVisibility();
  }

  private addGuard(role: GuardRole, look: Appearance, x: number, z: number, floor: number): HeistGuard {
    const gd = new HeistGuard(role, look, x, z, floor);
    this.guards.push(gd);
    this.group.add(gd.model.root);
    return gd;
  }

  private setupFloorVisibility(): void {
    const f = this.g.viewFloor;
    for (const gd of this.guards) gd.model.root.visible = gd.floor === f;
    for (const d of this.dogs) d.root.visible = d.floor === f;
    for (const w of this.watchers) w.cone.visible = w.item.floor === f;
  }

  /** The burglar can be seen, shot and bitten (not while knocked out). */
  get targetable(): boolean {
    return !this.over && this.g.combat.ko <= 0;
  }

  get vaultTierName(): string {
    return vaultTier(this.tier)?.name ?? 'Vault';
  }

  /** The most this run could take (a perfect run, given the floor safes). */
  get maxTake(): number {
    return shareTake(this.target.vault, this.share, 1, this.safes);
  }

  /** Most of the vault a perfect run takes. */
  get share(): number {
    return this.target.share ?? (this.online ? ONLINE_SHARE : OFFLINE_SHARE);
  }

  get guardsUp(): number {
    return this.guards.filter((gd) => gd.ko <= 0).length;
  }

  /** The stages that crack the vault. */
  get vaultStages(): Stage[] {
    return vaultStages(this.tier);
  }

  // ------------------------------------------------------------------ senses

  /** Nothing solid (a wall, a shut door, the outside) between two points on a floor. */
  clearSight(floor: number, ax: number, az: number, bx: number, bz: number): boolean {
    const grid = this.g.gridAt(floor);
    const walls = this.g.levels[floor]?.floor.walls;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.25));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const tx = Math.floor(ax + (bx - ax) * t);
      const tz = Math.floor(az + (bz - az) * t);
      if (!grid.inBounds(tx, tz)) return false;
      if (grid.solidAt(grid.idx(tx, tz))) return false;
      if (grid.doorAt(tx, tz) >= 0 && (walls?.doorOpenness(tx, tz) ?? 1) < 0.45) return false;
    }
    return true;
  }

  /** A guard saw you. */
  spotted(gd: HeistGuard): void {
    this.say(gd.x, gd.z, 'HEY! STOP RIGHT THERE!');
    audio.play('whiz', { volume: 0.3, pitch: 0.6 });
    // On the radio: everyone on the floor hears where you are.
    this.noise(gd.x, gd.z, 30, this.g.player.x, this.g.player.z);
  }

  /** A shout over someone's head. */
  say(x: number, z: number, text: string): void {
    this.g.floaters.text(new THREE.Vector3(x, 2.4, z), text, 'bad', 1.4);
  }

  /** A noise at (x, z): guards within `radius` come to look (at `lx, lz` if given). */
  noise(x: number, z: number, radius: number, lx = x, lz = z): void {
    for (const gd of this.guards) {
      if (gd.ko > 0 || gd.floor !== this.g.player.floor) continue;
      if (Math.hypot(gd.x - x, gd.z - z) < radius) gd.alert(lx, lz);
    }
  }

  /**
   * Something caught you. With an alarm panel the siren wails: every guard knows where you
   * are, the panic buttons call armed response and the owner hears about it. Without one,
   * only the guards get the message.
   */
  raise(reason: string): void {
    const g = this.g;
    if (this.over) return;
    const p = g.player;
    if (this.hasAlarm) {
      if (this.siren <= 0) {
        g.notify(`🚨 ${reason}! The alarm is going off: every guard knows where you are.`, 'bad');
        if (!this.alarmed && this.panics) {
          for (let i = 0; i < Math.min(3, this.panics); i++) this.responders.push(7 + i * 5);
          g.notify(`📟 The panic button called armed response: ${Math.min(3, this.panics)} on the way.`, 'bad');
        }
        this.alarmed = true;
        g.events.emit('heist', undefined);
      }
      this.siren = 25;
    } else {
      if (this.silentCool <= 0) g.notify(`👀 ${reason}: the guards are coming.`, 'bad');
      this.silentCool = 6;
      this.noise(p.x, p.z, 60);
    }
  }

  // ------------------------------------------------------------------ doors

  private key(floor: number, x: number, z: number): string {
    return `${floor}:${x}:${z}`;
  }

  /** Does this door open for the burglar (no lock, or already cracked)? */
  doorOpenFor(floor: number, x: number, z: number): boolean {
    const t = this.g.gridAt(floor).doorAt(x, z);
    return t < 0 || doorType(t).lock === 0 || this.unlocked.has(this.key(floor, x, z));
  }

  /** A locked door stops the burglar like a wall. */
  blocksPlayer(floor: number, tx: number, tz: number): boolean {
    return !this.doorOpenFor(floor, tx, tz);
  }

  /** The locked door you're standing at, if any. */
  lockedDoorNear(floor: number, x: number, z: number): { x: number; z: number; type: number } | null {
    for (const d of this.g.gridAt(floor).doors()) {
      if (doorType(d.type).lock === 0 || this.unlocked.has(this.key(floor, d.x, d.z))) continue;
      if (Math.abs(d.x + 0.5 - x) < 1.3 && Math.abs(d.z + 0.5 - z) < 1.3) return d;
    }
    return null;
  }

  doorStagesAt(type: number): Stage[] {
    return doorStages(doorType(type).lock);
  }

  /** You beat the door's lock. */
  doorCracked(floor: number, x: number, z: number): void {
    this.unlocked.add(this.key(floor, x, z));
    // Both halves of a double door share the lock.
    const pair = this.g.gridAt(floor).doorPartner(x, z);
    if (pair) this.unlocked.add(this.key(floor, pair[0], pair[1]));
    audio.play('vaultClunk', { pitch: 1.4 });
    this.g.effects.sparkle(x + 0.5, 1.1, z + 0.5, 12, 0x9fe8ff, 0.6);
    this.g.notify(`🔓 The ${doorType(this.g.gridAt(floor).doorAt(x, z)).name} is open.`, 'good');
  }

  /** Is any guard close enough to open this door (they have the keys)? */
  guardNear(floor: number, cx: number, cz: number): boolean {
    return this.guards.some((gd) => gd.floor === floor && gd.ko <= 0 && Math.abs(gd.x - cx) < 1.4 && Math.abs(gd.z - cz) < 1.4)
      || this.dogs.some((d) => d.floor === floor && d.ko <= 0 && Math.abs(d.x - cx) < 1.2 && Math.abs(d.z - cz) < 1.2);
  }

  // ------------------------------------------------------------------ the vault

  /** All the vault's minigames are beaten: the time lock starts counting down. */
  vaultCracked(scores: number[]): void {
    if (this.over || this.phase !== 'locked') return;
    this.quality = runQuality(scores);
    this.phase = 'timelock';
    this.timelock = this.timelockMax = timelockSeconds(this.tier);
    audio.play('vaultWheel');
    this.g.notify(`🔐 Cracked! The ${this.vaultTierName}'s time lock opens in ${this.timelock} s. Hold them off till then (the drill is loud).`, 'good');
    this.g.events.emit('heist', undefined);
  }

  /** Time lock progress 0..1. */
  get timelockProgress(): number {
    return this.phase === 'timelock' ? 1 - this.timelock / this.timelockMax : this.phase === 'locked' ? 0 : 1;
  }

  /** Take the cash: what your run earned (it's only yours once you're out the door). */
  grab(): void {
    const g = this.g;
    if (this.over || this.phase !== 'open') return;
    this.loot = Math.max(1, shareTake(this.target.vault, this.share, this.quality, this.safes));
    this.phase = 'looted';
    const v = this.vault;
    if (v) g.effects.coinFlight(new THREE.Vector3(v.cx, 1.2, v.cz), () => g.playerPos.clone().setY(1.1), 14, () => audio.play('coin', { volume: 0.4 }));
    audio.play('cash');
    const pct = Math.round(this.quality * 100);
    g.notify(`💰 You grabbed ${formatMoney(this.loot)} (${pct}% of the most you could take). Get out the front door to keep it!`, 'money');
    if (v) this.noise(v.cx, v.cz, 18);
    g.events.emit('heist', undefined);
  }

  // ------------------------------------------------------------------ fighting

  /** A guard shoots at you. */
  guardFire(gd: HeistGuard, dist: number): void {
    const g = this.g;
    const p = g.player;
    const st = gd.stats;
    const chance = clamp(0.84 - dist * 0.03 - p.speed * 0.045, 0.3, 0.9);
    const hit = Math.random() < chance;
    const from = new THREE.Vector3(gd.x + Math.sin(gd.yaw) * 0.6, 1.3, gd.z + Math.cos(gd.yaw) * 0.6);
    const side = Math.random() < 0.5 ? 1 : -1;
    const miss = hit ? 0 : 0.5 + Math.random();
    const to = new THREE.Vector3(p.x + Math.cos(gd.yaw) * miss * side, hit ? 1.1 : 0.4 + Math.random() * 1.6, p.z - Math.sin(gd.yaw) * miss * side);
    g.gunplay.enemyTracer(from, to);
    g.effects.sparkle(from.x, from.y, from.z, 4, 0xffd27a, 0.15);
    gd.model.recoil = 0.6;
    audio.playAt(st.gun === 'deagle' ? 'gunHeavy' : 'smg', gd.x, gd.z, 0.8);
    if (hit) g.combat.damage(st.dmg, 'guard', `${this.target.owner}'s ${st.title}`, gd.x, gd.z);
    else audio.play('whiz', { volume: 0.5 });
    this.noise(gd.x, gd.z, 18, p.x, p.z);
  }

  /** Guards and dogs along a line on your floor (world frame; dx, dz is a unit direction). */
  raycast(ox: number, oz: number, dx: number, dz: number, maxS: number): { s: number; target: HeistTarget; height: number }[] {
    const out: { s: number; target: HeistTarget; height: number }[] = [];
    const f = this.g.player.floor;
    const test = (target: HeistTarget, x: number, z: number, r: number, height: number) => {
      const px = x - ox;
      const pz = z - oz;
      const s = px * dx + pz * dz;
      if (s < 0 || s > maxS) return;
      if (Math.hypot(px - dx * s, pz - dz * s) > r) return;
      out.push({ s, target, height });
    };
    for (const gd of this.guards) if (gd.floor === f && gd.ko <= 0) test(gd, gd.x, gd.z, 0.38, gd.model.height);
    for (const d of this.dogs) if (d.floor === f && d.ko <= 0) test(d, d.x, d.z, 0.42, 0.9);
    return out.sort((a, b) => a.s - b.s);
  }

  /** Everyone you could hit at once (flames, a swing, a blast). */
  around(x: number, z: number, r: number): HeistTarget[] {
    const f = this.g.player.floor;
    return [
      ...this.guards.filter((gd) => gd.floor === f && gd.ko <= 0 && Math.hypot(gd.x - x, gd.z - z) < r),
      ...this.dogs.filter((d) => d.floor === f && d.ko <= 0 && Math.hypot(d.x - x, d.z - z) < r),
    ];
  }

  /** You hit a guard or the dog. True if it went down. */
  damage(t: HeistTarget, dmg: number): boolean {
    const g = this.g;
    const ko = t.hurt(dmg);
    if (t instanceof HeistGuard) {
      // You just told them where you are.
      t.alert(g.player.x, g.player.z);
      t.known = Math.max(t.known, 2);
      if (ko) {
        audio.play('knockout', { volume: 0.7 });
        g.stats.knockouts++;
        this.say(t.x, t.z, '💫');
      }
    } else if (ko) audio.play('knockout', { volume: 0.5, pitch: 1.6 });
    return ko;
  }

  // ------------------------------------------------------------------ ending

  /** Lost a minigame: pay a fine and get thrown out (and locked out for a while). */
  fail(reason: string): void {
    const g = this.g;
    if (this.over) return;
    this.over = true;
    const fine = heistFines(this.target, g.money).fail;
    if (fine > 0) g.spend(fine, 'robbed');
    this.lockout();
    audio.play('busted');
    g.notify(`❌ ${reason} You paid ${formatMoney(fine)} and ${this.target.owner}'s guards threw you out. Try this house again in ${waitText(lockoutMs(this.tier))}.`, 'bad');
    g.endHeist(true);
  }

  /** The guards (or the lasers) knocked you out: they take a cut and throw you out when you come round. */
  knockedOut(): number {
    const g = this.g;
    if (this.over) return 0;
    this.downed = true;
    this.loot = 0;
    const fine = heistFines(this.target, g.money).ko;
    this.lockout();
    g.events.emit('heist', undefined);
    return fine;
  }

  private lockout(): void {
    const net = this.g.net;
    net.heistLock ??= {};
    net.heistLock[this.target.pid] = Date.now() + lockoutMs(this.tier);
  }

  /** Out through the front door: the cash is yours (and everyone hears about it). */
  leave(): void {
    const g = this.g;
    if (this.over) return;
    this.over = true;
    if (this.loot > 0) {
      if (this.target.npc) {
        // Uncle Sal restocks for you alone: nothing to publish.
        g.net.npcRobbed = Date.now();
      } else {
        const rec: HeistRecord = { i: Math.random().toString(36).slice(2, 12), v: this.target.pid, by: g.player.name.slice(0, 20), t: Date.now(), a: this.loot, on: this.online ? 1 : 0 };
        g.net.heists = [rec, ...cleanRecords(g.net.heists ?? [])].slice(0, MAX_RECORDS);
      }
      g.addMoney(this.loot, 'loot');
      g.stats.looted += this.loot;
      g.stats.heists = (g.stats.heists ?? 0) + 1;
      g.stats.heistLoot = (g.stats.heistLoot ?? 0) + this.loot;
      audio.play('jackpot');
      g.effects.confetti(g.player.x, 2, g.player.z, 60, 0.8);
      const back = this.target.npc ? ` His stash is back in ${waitText(NPC_REFILL_MS)}.` : '';
      g.notify(`🦹 Heist complete! You got away with ${formatMoney(this.loot)} from ${this.target.owner}'s vault.${this.alarmed ? ' The alarm called the police: lose them!' : ''}${back}`, 'money');
      if (this.alarmed) g.street.police.crime(3.2);
      g.requestSave();
    } else g.notify(`You slipped out of ${this.target.owner}'s house empty-handed.`, 'info');
    g.endHeist(false);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const g = this.g;
    if (this.over) return;
    const p = g.player;
    // Knocked out: come round on the pavement outside.
    if (this.downed) {
      if (g.combat.ko <= 0) {
        this.over = true;
        g.notify(`${this.target.owner}'s guards dragged you out. Try this house again in ${waitText(lockoutMs(this.tier))}.`, 'bad');
        g.endHeist(true);
      }
      return;
    }
    this.silentCool = Math.max(0, this.silentCool - dt);
    this.detectCool = Math.max(0, this.detectCool - dt);
    // Gunshots carry (a suppressor keeps them quiet).
    if (g.gunplay.shots !== this.shots) {
      if (!g.gunplay.def?.quiet && !g.gunplay.def?.melee) this.noise(p.x, p.z, 22);
      this.shots = g.gunplay.shots;
    }
    if (this.siren > 0) {
      this.siren -= dt;
      this.sirenT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = 1.6;
        audio.play('alarm', { volume: 0.55 });
      }
    }
    // Armed response called by the panic buttons arrives at the front door.
    for (let i = this.responders.length - 1; i >= 0; i--) {
      this.responders[i] -= dt;
      if (this.responders[i] > 0) continue;
      this.responders.splice(i, 1);
      const [dx, dz] = DOOR_TILES[i % 2];
      const gd = this.addGuard('response', randomStaffAppearance('security'), dx + 0.5, dz - 1.2, 0);
      gd.alert(p.x, p.z);
      audio.play('siren', { volume: 0.5 });
      this.say(gd.x, gd.z, 'ARMED RESPONSE!');
    }
    for (const gd of this.guards) gd.update(dt, this);
    for (const d of this.dogs) d.update(dt, this);
    this.updateLasers(dt);
    this.updateWatchers(dt);
    this.updateDetectors();
    // The time lock: a drill whining away, loud enough to bring the guards.
    if (this.phase === 'timelock' && this.vault) {
      const v = this.vault;
      this.timelock -= dt;
      this.drillT -= dt;
      if (this.drillT <= 0) {
        this.drillT = 0.45;
        audio.playAt('drill', v.cx, v.cz, 0.9);
        g.effects.sparkle(v.cx, 1.1, v.cz + 0.9, 6, 0xffd27a, 0.5);
        if (Math.random() < 0.18) this.noise(v.cx, v.cz, 12, p.x, p.z);
      }
      if (this.timelock <= 0) {
        this.phase = 'open';
        v.model.event({ type: 'door', open: true });
        audio.play('vaultHiss');
        audio.play('vaultClunk');
        g.notify('💰 The vault swings open. Grab the cash!', 'good');
        g.events.emit('heist', undefined);
      }
    }
    this.setupFloorVisibility();
  }

  private updateLasers(dt: number): void {
    const g = this.g;
    const p = g.player;
    for (const l of this.lasers) {
      // Beams blink off for a moment every few seconds: time your run.
      const on = (g.time + l.phase) % 4.4 > 1.3;
      if (on !== l.on) {
        l.on = on;
        if (l.beams) l.beams.visible = on;
      }
      l.zapT = Math.max(0, l.zapT - dt);
      if (!on || l.zapT > 0 || l.item.floor !== p.floor || !this.targetable) continue;
      const b = l.item.bounds;
      if (p.x > b.x0 + 0.08 && p.x < b.x1 - 0.08 && p.z > b.z0 + 0.08 && p.z < b.z1 - 0.08) {
        l.zapT = 0.5;
        audio.play('zap');
        g.effects.sparkle(p.x, 1, p.z, 14, 0xff2a2a, 0.5);
        g.combat.damage(30, 'trap', `${this.target.owner}'s laser grid`, l.item.cx, l.item.cz);
        this.raise('You tripped a laser grid');
      }
    }
  }

  private updateWatchers(dt: number): void {
    const g = this.g;
    const p = g.player;
    for (const w of this.watchers) {
      const it = w.item;
      // Same sweep as the model's head.
      const local = w.kind === 'cam' ? Math.sin(g.time * 0.6) * 0.9 : Math.sin(g.time * 0.5) * 0.9;
      const face = it.root.rotation.y + local;
      w.cone.rotation.y = face;
      w.cool = Math.max(0, w.cool - dt);
      let sees = false;
      if (it.floor === p.floor && this.targetable && w.cool <= 0) {
        const dx = p.x - it.cx;
        const dz = p.z - it.cz;
        const d = Math.hypot(dx, dz);
        sees = d < w.range && d > 0.3 && Math.abs(angleDiff(face, Math.atan2(dx, dz))) < w.half && this.clearSight(it.floor, it.cx, it.cz, p.x, p.z);
      }
      w.meter = sees ? w.meter + dt * 1.8 : Math.max(0, w.meter - dt);
      const m = w.fill.material as THREE.MeshBasicMaterial;
      m.opacity = (w.kind === 'cam' ? 0.1 : 0.12) + Math.min(1, w.meter) * 0.25;
      if (w.meter >= 1) {
        w.meter = 0;
        w.cool = 6;
        audio.play('keyError');
        this.raise(w.kind === 'cam' ? 'A security camera spotted you' : 'The searchlight caught you');
      }
    }
  }

  private updateDetectors(): void {
    const g = this.g;
    const p = g.player;
    if (this.detectCool > 0 || !this.targetable) return;
    // Any real weapon on you (bare fists don't beep).
    const real = (id: string | null | undefined) => !!id && !gunDef(id)?.builtin;
    const armed = real(g.guns.equipped) || g.guns.slots.some(real);
    if (!armed) return;
    for (const md of this.detectors) {
      if (md.floor !== p.floor) continue;
      const b = md.bounds;
      if (p.x > b.x0 - 0.2 && p.x < b.x1 + 0.2 && p.z > b.z0 - 0.2 && p.z < b.z1 + 0.2) {
        this.detectCool = 5;
        audio.play('alarm', { volume: 0.4, pitch: 1.6 });
        this.raise('The metal detector found your weapon');
        return;
      }
    }
  }

  dispose(): void {
    for (const gd of this.guards) {
      gd.model.root.removeFromParent();
      gd.dispose();
    }
    for (const d of this.dogs) d.dispose();
    for (const w of this.watchers) {
      w.fill.geometry.dispose();
      (w.fill.material as THREE.Material).dispose();
    }
    this.guards = [];
    this.dogs = [];
    this.group.removeFromParent();
  }
}

/**
 * Can you walk from tile (ax, az) to tile (bx, bz) on this floor without going through a
 * door that's still locked (`open` says which doors let you through)? The end tile itself may
 * be part of a wall or furniture you're brushing against, so it only has to touch the tiles
 * you can reach.
 */
export function heistReachable(grid: Grid, ax: number, az: number, bx: number, bz: number, open: (x: number, z: number) => boolean, limit = 6000): boolean {
  const pass = (x: number, z: number) => grid.isWalkable(x, z) && (grid.doorAt(x, z) < 0 || open(x, z));
  const key = (x: number, z: number) => `${x},${z}`;
  const seen = new Set<string>([key(ax, az)]);
  const queue: [number, number][] = [[ax, az]];
  const endBlockedDoor = grid.doorAt(bx, bz) >= 0 && !open(bx, bz);
  for (let i = 0; i < queue.length && i < limit; i++) {
    const [x, z] = queue[i];
    if (x === bx && z === bz) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx === bx && nz === bz && !endBlockedDoor) return true;
      const k = key(nx, nz);
      if (seen.has(k) || !pass(nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return false;
}
