import * as THREE from 'three';
import type { Game } from './game';
import { type GunDef, type TunedGun, falloff, gunDef, gunModsOf, headMul, recoilStep, reloadPress, spreadMul, tunedGun } from './guns';
import { type Optic, buildGun } from '../items/models/guns';
import { type ReticleOpts, drawReticle, reticleKey } from '../ui/reticle';
import { audio, type SfxName } from '../core/audio';
import { softDotTexture } from '../render/textures';
import type { Ped } from '../world/crowd';
import { HEAT, type Officer } from '../world/police';
import { shotDamage } from './driving';
import { mat } from '../render/materials';
import { type Attack } from './melee';
import { groundAt } from '../world/terrain';
import { carSeats } from '../world/cityView';
/** Chance a passer-by you punch (and don't knock out) fights back. */
const BRAWL_CHANCE = 0.4;

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Splat {
  mesh: THREE.Mesh;
  life: number;
}

const SPLAT_COLORS = [0xff4d9a, 0x39ff88, 0x2fe6ff, 0xffc53d, 0xb77bff, 0xff8a1f];

/** A grenade or rocket in flight (world frame). */
interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  d: GunDef;
  mesh: THREE.Object3D;
  life: number;
  mul: number;
}

/** Things a bullet already went through (railgun). */
type Pierced = Set<unknown>;

/** The gun on screen in first person: your hand around the grip, sway, recoil and reloads. */
interface ViewModel {
  id: string;
  /** Mods it was built with. */
  key?: string;
  holder: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Vector3;
  spin?: THREE.Object3D;
  scale: number;
  /** What you look through when aiming, and where it sits (gun frame, before turning). */
  optic: Optic;
  sight?: THREE.Vector3;
  /** A scope's rear lens, showing the magnified picture. */
  lens?: THREE.Mesh;
  /** Bits of the gun in the line of sight through the optic (hidden while aiming through it). */
  blockers: THREE.Object3D[];
}

/** Something a bullet can stop at. */
type Hit =
  | { kind: 'wall' | 'ground' | 'air'; t: number }
  | { kind: 'target'; t: number; target: import('../world/cityView').Target }
  | { kind: 'car'; t: number; tg: import('./driving').CarTarget }
  | { kind: 'occupant'; t: number; car: import('../world/cityView').Car; occ: import('../world/cityView').Occupant; head: boolean }
  | { kind: 'crew'; t: number; machine: import('../world/militaryBase').Machine; crew: import('../world/militaryBase').Crew; head: boolean }
  | { kind: 'soldier'; t: number; soldier: import('../world/militaryBase').Soldier; head: boolean }
  | { kind: 'machine'; t: number; machine: import('../world/militaryBase').Machine }
  | { kind: 'ped'; t: number; ped: Ped; head: boolean }
  | { kind: 'cop'; t: number; cop: Officer; head: boolean }
  | { kind: 'player'; t: number; pid: string; name: string; head: boolean }
  | { kind: 'guard'; t: number; target: import('./heist').HeistTarget; head: boolean };

/**
 * Shooting out on the street: the gun in your hand, aiming (mouse on desktop, facing plus a
 * little auto-aim on touch, or true first person with a crosshair and sights), tracers,
 * muzzle flashes, impacts on walls, cars, cans, bottles, balloons and people. Guns stay
 * holstered (and silent) inside any building.
 */
export class GunPlay {
  private ammo = new Map<string, number>();
  private cool = 0;
  reloading = 0;
  private held: { id: string; key: string; group: THREE.Group; muzzle: THREE.Vector3; spin?: THREE.Object3D } | null = null;
  private tracers: Tracer[] = [];
  private splats: Splat[] = [];
  private flash: THREE.Sprite;
  private flashT = 0;
  readonly group = new THREE.Group();
  /** Touch fire button is held. */
  fireHeld = false;
  /** Touch fire button was tapped this frame. */
  firePressed = false;
  /** Total shots (other players see your muzzle flash when it changes). */
  shots = 0;
  /** Heavy melee blows swung (others see the big swing). */
  heavies = 0;
  private spinV = 0;
  private aimYaw: number | null = null;
  private aimHold = 0;
  private warnT = 0;
  private alarmT = 0;
  private vm: ViewModel | null = null;
  /** Aim down sights toggled by the touch AIM button. */
  adsTouch = false;
  /** 0 = hip, 1 = fully aimed down the sights. */
  private adsK = 0;
  private swayX = 0;
  /** Seconds left of a melee swing on screen. */
  private swingT = 0;
  private aimX = 0;
  private aimY = 0;
  /** How far the gun in your hands is pulled back from a wall in front of you (0–1). */
  private nearK = 0;
  private swayY = 0;
  private vmKick = 0;
  private bobT = 0;
  /** Bloom of the crosshair from firing and moving (0..1). */
  spreadK = 0;
  /** Shots fired in quick succession: accuracy blooms and recoil climbs with it. */
  spray = 0;
  private sinceShot = 9;
  /** Rounds left in the current burst (burst rifle), and the gap to the next. */
  private burstLeft = 0;
  private burstT = 0;
  /** Railgun charge held so far (seconds). */
  chargeT = 0;
  /** The current reload's full length, and whether you've tried the active reload yet. */
  reloadDur = 0;
  reloadTried = false;
  /** A perfectly timed reload: this magazine hits 15% harder. */
  perfectMag = false;
  /** How the last active reload went (for the HUD), and when (performance.now ms). */
  reloadResult: { kind: 'perfect' | 'fumble'; at: number } | null = null;
  /** Damage multiplier of the shot being fired (railgun charge). */
  private shotMul = 1;
  private projectiles: Projectile[] = [];
  /** Explosions you set off recently (global frame), so other players see them too. */
  booms: { i: string; x: number; z: number; r: number; t: number }[] = [];

  constructor(private g: Game) {
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.group.add(this.flash);
  }

  private tuned: { key: string; def: TunedGun } | null = null;

  /** The weapon in your hand, with its attachments' effects. */
  get def(): TunedGun | null {
    const id = this.g.guns.equipped;
    const base = gunDef(id);
    if (!base || !id) return null;
    const mods = gunModsOf(this.g.guns, id);
    const key = `${id}|${mods.skin}|${mods.sight}|${mods.muzzle}|${mods.mag}|${mods.laser}|${mods.charm}`;
    if (this.tuned?.key !== key) this.tuned = { key, def: tunedGun(base, mods) };
    return this.tuned.def;
  }

  /** Rounds left in a weapon's magazine (never more than its magazine holds). */
  ammoOf(id: string): number {
    const base = gunDef(id);
    if (!base) return 0;
    const mag = tunedGun(base, this.g.guns.mods?.[id]).mag;
    return Math.min(mag, this.ammo.get(id) ?? mag);
  }

  /** The look of a weapon changed: rebuild the models in your hands. */
  refreshModels(): void {
    this.tuned = null;
    if (this.held) {
      this.held.group.removeFromParent();
      this.held = null;
    }
    if (this.vm) {
      this.vm.holder.removeFromParent();
      this.vm = null;
    }
  }

  /**
   * Out on the roads and sidewalks with your feet on the ground, or inside a house where a
   * heist is going down (robbing it, or defending your own).
   */
  get canShoot(): boolean {
    const g = this.g;
    const p = g.player;
    // Seated you can't shoot, except riding along in someone's car: a drive-by.
    if (g.state !== 'playing' || (p.seat && !g.riding) || g.photoMode || g.combat.ko > 0) return false;
    if (g.indoorFight) return true;
    return !g.inside && !g.underground && p.floor === 0 && g.street.isOutdoors(p.x, p.z);
  }

  /** Indoors (a heist fight): walls, shut doors, the ceiling and the outside stop a bullet. */
  private indoorBlocked(x: number, y: number, z: number): boolean {
    const g = this.g;
    if (y > 2.95) return true;
    const f = g.player.floor;
    const grid = g.gridAt(f);
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!grid.isOwned(tx, tz)) return true;
    if (grid.solidAt(grid.idx(tx, tz))) return true;
    return grid.doorAt(tx, tz) >= 0 && (g.levels[f]?.floor.walls.doorOpenness(tx, tz) ?? 1) < 0.45;
  }

  /** Where you're aiming the gun right now (world yaw), or null when you're not. */
  get facing(): number | null {
    return this.drawn && this.aimHold > 0 && this.aimYaw !== null ? this.aimYaw : null;
  }

  /** The gun is drawn and visible in your hand. */
  get drawn(): boolean {
    return !!this.def && this.canShoot;
  }

  /** First person with the gun out. */
  get firstPerson(): boolean {
    return this.g.cam.mode === 'first' && this.drawn;
  }

  /** Aiming down the sights (first person, right mouse or the AIM button). */
  get aiming(): boolean {
    const g = this.g;
    return this.firstPerson && !this.def?.melee && this.reloading <= 0 && !g.modalOpen && (g.input.rightHeld || this.adsTouch);
  }

  /** Fully zoomed in, looking through a scope (it fills the screen instead of the gun). */
  get scoped(): boolean {
    return this.aiming && (this.vm?.optic === 'scope' || this.def?.kind === 'sniper') && this.adsK > 0.9;
  }

  /** Knocked out: the trigger finger lets go. */
  drop(): void {
    this.fireHeld = false;
    this.firePressed = false;
    this.adsTouch = false;
  }

  /** Reload; pressed again during a reload it's the active reload (time it for a perfect one). */
  reload(): void {
    const d = this.def;
    if (!d || d.melee) return;
    if (this.reloading > 0) {
      this.activeReload(d);
      return;
    }
    if (this.ammoOf(d.id) >= d.mag) return;
    this.reloading = this.reloadDur = d.reload;
    this.reloadTried = false;
    this.perfectMag = false;
    this.burstLeft = 0;
    this.chargeT = 0;
    audio.play('reload');
    this.g.events.emit('guns', undefined);
  }

  /** A different weapon in hand: the old one's reload, burst, charge and spray are dropped. */
  switched(): void {
    this.reloading = 0;
    this.reloadDur = 0;
    this.burstLeft = 0;
    this.chargeT = 0;
    this.spray = 0;
    this.perfectMag = false;
  }

  /** Where the reload is (0..1), or -1 when not reloading. */
  get reloadProgress(): number {
    return this.reloading > 0 && this.reloadDur > 0 ? 1 - this.reloading / this.reloadDur : -1;
  }

  /** Hit the sweet spot and the magazine snaps in now (and hits harder); miss and you fumble it. */
  private activeReload(d: TunedGun): void {
    if (this.reloadTried || this.reloadDur <= 0) return;
    this.reloadTried = true;
    const p = this.g.player;
    const at = new THREE.Vector3(p.x, p.model.height + 0.7, p.z);
    if (reloadPress(this.reloadProgress) === 'perfect') {
      this.reloading = 0;
      this.ammo.set(d.id, d.mag);
      this.perfectMag = true;
      audio.play('reload', { pitch: 1.5 });
      audio.play('coin', { volume: 0.6 });
      this.g.floaters.text(at, '⚡ PERFECT RELOAD', 'good', 1.1, 0.9);
      this.reloadResult = { kind: 'perfect', at: performance.now() };
    } else {
      const extra = d.reload * 0.45;
      this.reloading += extra;
      this.reloadDur += extra;
      audio.play('empty');
      this.g.floaters.text(at, 'Fumbled!', 'bad', 1, 0.8);
      this.reloadResult = { kind: 'fumble', at: performance.now() };
    }
    this.g.events.emit('guns', undefined);
  }

  /** Damage of one hit after headshot, distance, charge and a perfect reload. */
  private dmgOf(d: GunDef, head: boolean, dist: number): number {
    const base = hitDamage(d, head);
    if (base >= 999) return base;
    return Math.round(base * falloff(d, dist) * this.shotMul * (this.perfectMag ? 1.15 : 1));
  }

  private syncHeld(): void {
    const d = this.def;
    const show = !!d && this.canShoot;
    if (this.held && (!show || this.held.id !== d?.id || this.held.key !== this.tuned?.key)) {
      this.held.group.removeFromParent();
      this.held.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.held = null;
    }
    if (show && !this.held && d) {
      const b = buildGun(d, d.mods, true);
      this.g.player.model.hand.add(b.group);
      this.held = { id: d.id, key: this.tuned?.key ?? '', group: b.group, muzzle: b.muzzle, spin: b.spin };
    }
    this.g.player.model.aim = show && d ? (d.twoHand ? 2 : 1) : 0;
    const fp = show && this.g.cam.mode === 'first';
    if (this.vm && (!fp || this.vm.id !== d?.id || this.vm.key !== this.tuned?.key)) {
      this.vm.holder.removeFromParent();
      this.vm.gun.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.vm = null;
    }
    if (fp && !this.vm && d) {
      this.vm = this.buildViewModel(d);
      this.vm.key = this.tuned?.key;
    }
  }

  /** The gun as you see it in your own hands. */
  private buildViewModel(d: TunedGun): ViewModel {
    const look = this.g.player.appearance;
    const b = buildGun(d, d.mods, true);
    const holder = new THREE.Group();
    const gun = new THREE.Group();
    gun.add(b.group);
    // Guns are built along +z; the camera looks down -z.
    b.group.rotation.y = Math.PI;
    const skin = mat(look.skin, { rough: 0.6 });
    const sleeve = mat(look.topColor, { rough: 0.8 });
    const box = (m: THREE.Material, w: number, h: number, l: number, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      gun.add(mesh);
      return mesh;
    };
    // Right hand on the grip, forearm running back toward you.
    box(skin, 0.045, 0.06, 0.07, 0.004, -0.05, 0.0);
    box(sleeve, 0.06, 0.06, 0.26, 0.03, -0.1, 0.16, 0.35);
    if (d.twoHand) {
      // Left hand under the barrel.
      const fz = -Math.min(0.32, (d.kind === 'shotgun' || d.kind === 'rifle' || d.kind === 'sniper' ? 0.3 : 0.18));
      box(skin, 0.05, 0.045, 0.08, -0.008, -0.035, fz);
      box(sleeve, 0.06, 0.06, 0.3, -0.1, -0.09, fz + 0.2, 0.3).rotation.y = -0.5;
    }
    holder.add(gun);
    const long = b.muzzle.z;
    // Half size, close up: reads like a real gun held at arm's length.
    const scale = long > 0.6 ? 0.42 : 0.5;
    gun.scale.setScalar(scale);
    this.g.renderer.overlay.add(holder);
    // A scope's glass is clear: you see the world through it, with your crosshair etched in.
    if (b.lens && b.optic === 'scope') {
      const r = (b.lens.geometry as THREE.CircleGeometry).parameters.radius;
      const ret = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ map: reticleTexture(this.g.reticle), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ret.position.copy(b.lens.position);
      ret.position.z -= 0.001;
      ret.renderOrder = 3;
      b.group.add(ret);
    }
    return { id: d.id, holder, gun, muzzle: new THREE.Vector3(b.muzzle.x, b.muzzle.y, -b.muzzle.z), spin: b.spin, scale, optic: b.optic, sight: b.sight, lens: b.lens, blockers: b.blockers ?? [] };
  }

  /** The optic you're looking through right now (aimed in far enough), or null. */
  get opticSight(): Optic | null {
    const vm = this.vm;
    return vm && this.aiming && this.adsK > 0.75 && vm.optic !== 'iron' ? vm.optic : null;
  }

  /** Sway, bob, recoil and aiming for the gun on screen. */
  private updateViewModel(dt: number): void {
    const vm = this.vm;
    if (!vm) return;
    const g = this.g;
    const cam = g.renderer.camera;
    cam.updateMatrixWorld();
    vm.holder.position.copy(cam.position);
    vm.holder.quaternion.copy(cam.quaternion);
    this.adsK += ((this.aiming ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    const input = g.input;
    // Lag a touch behind the mouse so the gun feels heavy.
    this.swayX += (-input.lookDX * 0.0004 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (input.lookDY * 0.0004 - this.swayY) * Math.min(1, dt * 10);
    const speed = g.player.speed;
    this.bobT += dt * speed * 2.1;
    const bob = Math.min(1, speed / 4) * (1 - this.adsK * 0.85);
    this.vmKick = Math.max(0, this.vmKick - dt * 9);
    const reload = this.reloading > 0 && this.def ? Math.sin(Math.min(1, 1 - this.reloading / this.def.reload) * Math.PI) : 0;
    // Too close to a wall: pull the gun back and tip it up out of the way (eased, so it
    // doesn't snap). Indoors (a heist) that's the walls and shut doors, not the street's edge.
    const fwd = g.cam.lookDir(new THREE.Vector3());
    const ax = g.player.x + fwd.x * 0.75;
    const az = g.player.z + fwd.z * 0.75;
    const wall = g.indoorFight ? this.indoorBlocked(ax, 1.4, az) : !g.street.isOutdoors(ax, az);
    this.nearK += ((wall ? 1 : 0) - this.nearK) * Math.min(1, dt * 10);
    const near = this.nearK;
    const k = this.adsK;
    const sightY = -0.03 - vm.muzzle.y * vm.scale;
    const hip = { x: 0.072, y: -0.075, z: -0.24 };
    // Aimed: line the optic up with your eye (a scope close, a red dot at arm's length).
    const sp = vm.sight;
    const eye = vm.optic === 'scope' ? 0.07 : 0.2;
    const ads = sp
      ? { x: sp.x * vm.scale, y: -sp.y * vm.scale, z: -eye + sp.z * vm.scale }
      : { x: -vm.muzzle.x * vm.scale, y: sightY, z: -0.25 };
    const x = hip.x + (ads.x - hip.x) * k + this.swayX * 0.5 + Math.cos(this.bobT) * 0.006 * bob;
    const y = hip.y + (ads.y - hip.y) * k + this.swayY * 0.5 - Math.abs(Math.sin(this.bobT)) * 0.007 * bob - reload * 0.06 - near * 0.05;
    const z = hip.z + (ads.z - hip.z) * k + this.vmKick * 0.035 + near * 0.04;
    vm.gun.position.set(x, y, z);
    // With the cursor free the gun turns to point at it.
    const ndc = g.cam.aimNdc;
    this.aimX += ((ndc ? ndc.x : 0) - this.aimX) * Math.min(1, dt * 12);
    this.aimY += ((ndc ? ndc.y : 0) - this.aimY) * Math.min(1, dt * 12);
    vm.gun.rotation.set(this.vmKick * 0.18 + reload * 0.9 + near * 0.5 + this.aimY * 0.45 * (1 - k), this.swayX * 2 - this.aimX * 0.55 * (1 - k), reload * 0.5 + this.swayX * 1.5);
    if (this.def?.melee) {
      // Held up and ready; a swing chops down and across.
      this.swingT = Math.max(0, this.swingT - dt);
      const sw = this.swingT > 0 ? 1 - this.swingT / 0.35 : 0;
      const arc = Math.sin(sw * Math.PI);
      vm.gun.rotation.x = 0.9 - sw * 2.2 + this.swayY;
      vm.gun.rotation.y = 0.35 - arc * 0.9;
      vm.gun.rotation.z = -0.3 + arc * 0.5;
      vm.gun.position.x += 0.04 - arc * 0.08;
      vm.gun.position.y += -0.02 + arc * 0.04;
    }
    vm.holder.visible = !this.scoped;
    // Looking through an optic: nothing of the gun may sit in front of your target.
    const clear = this.opticSight !== null;
    for (const o of vm.blockers) o.visible = !clear;
    if (vm.spin) vm.spin.rotation.z += this.spinV * dt;
  }

  /** Where the mouse points on the ground, as a direction from the player (desktop, top camera). */
  private pointerAim(): number | null {
    const g = this.g;
    const input = g.input;
    if (input.isTouch || !input.pointer.over || g.cam.mode === 'third') return null;
    const { w, h } = g.renderer.size;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((input.pointer.x / w) * 2 - 1, -(input.pointer.y / h) * 2 + 1), g.renderer.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(g.player.y + 1.1));
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const dx = hit.x - g.player.x;
    const dz = hit.z - g.player.z;
    if (Math.hypot(dx, dz) < 0.3) return null;
    return Math.atan2(dx, dz);
  }

  /** Touch: snap to the nearest target or car roughly in front of you. */
  private autoAim(yaw: number, range: number): number {
    const g = this.g;
    const st = g.street;
    const pg = st.worldToGlobal(g.player.x, g.player.z);
    const flip = st.placeOf(st.activeId).side === 1;
    let best = yaw;
    let bestScore = Infinity;
    const consider = (gx: number, gz: number) => {
      const dxg = gx - pg.x;
      const dzg = gz - pg.z;
      const d = Math.hypot(dxg, dzg);
      if (d > range || d < 0.5) return;
      const a = Math.atan2(flip ? -dxg : dxg, flip ? -dzg : dzg);
      let diff = Math.abs(((a - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > 0.6) return;
      diff += d * 0.01;
      if (diff < bestScore) {
        bestScore = diff;
        best = a;
      }
    };
    for (const t of st.city.targets) if (t.alive) consider(t.home.x, t.home.z);
    return best;
  }

  update(dt: number): void {
    const g = this.g;
    this.syncHeld();
    const d = this.def;
    this.cool = Math.max(0, this.cool - dt);
    this.warnT = Math.max(0, this.warnT - dt);
    this.alarmT = Math.max(0, this.alarmT - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0 && d) {
        this.reloading = 0;
        this.ammo.set(d.id, d.mag);
        g.events.emit('guns', undefined);
      }
    }
    const input = g.input;
    const blocked = g.modalOpen || g.build.active || g.state !== 'playing';
    // (In first person the click that captures the mouse never reaches here.)
    const mouseOk = !input.isTouch;
    const pressed = !blocked && (input.mousePresses > 0 && mouseOk ? true : this.firePressed);
    const held = !blocked && ((input.mouseHeld && mouseOk && input.pointer.over) || this.fireHeld);
    this.firePressed = false;
    if (!this.drawn) this.adsTouch = false;
    const moving = Math.min(1, g.player.speed / 4);
    // Let the trigger rest and the gun settles: bloom and recoil reset.
    this.sinceShot += dt;
    if (this.sinceShot > Math.max(0.22, 1.5 / (d?.rate ?? 4))) this.spray = Math.max(0, this.spray - dt * 9);
    this.spreadK = Math.min(1, Math.max(moving * 0.6, this.spray / 8, this.spreadK - dt * 2.2));
    if (g.cam.mode === 'first' && d) {
      // Scopes zoom with the mouse wheel (or + / -) while you look through them.
      const scope = this.vm?.optic === 'scope' || d.kind === 'sniper';
      if (this.aiming && scope && !blocked) {
        const w = g.input.wheel + (g.input.hit('Equal') || g.input.hit('NumpadAdd') ? -120 : 0) + (g.input.hit('Minus') || g.input.hit('NumpadSubtract') ? 120 : 0);
        if (w) this.scopeZoom = Math.max(0.35, Math.min(2.2, this.scopeZoom * Math.exp(w * 0.0012)));
      }
      g.cam.fovTarget = this.aiming ? (scope ? Math.max(3, Math.min(60, d.adsFov * this.scopeZoom)) : d.adsFov) : 72;
    } else if (g.cam.mode === 'first') g.cam.fovTarget = 72;
    if (d && !blocked && input.hit('KeyR')) this.reload();
    this.updateViewModel(dt);
    if (this.held && g.cam.mode !== 'first') {
      // Face the mouse while the gun is out (top camera).
      const pa = this.pointerAim();
      if (pa !== null && (held || pressed || this.aimHold > 0)) this.aimYaw = pa;
      if (held || pressed) this.aimHold = 0.6;
      this.aimHold = Math.max(0, this.aimHold - dt);
      if (this.aimHold > 0 && this.aimYaw !== null) g.player.yaw = this.aimYaw;
    }
    if (this.held?.spin || this.vm?.spin) {
      this.spinV = Math.max(0, Math.min(30, this.spinV + (held ? 60 : -25) * dt));
      if (this.held?.spin) this.held.spin.rotation.z += this.spinV * dt;
    }
    // A click during the cooldown isn't lost: it fires as soon as the gun is ready.
    if (pressed) this.queued = 0.25;
    else this.queued = Math.max(0, this.queued - dt);
    const rolling = g.combat.rolling;
    const ready = this.cool <= 0 && this.reloading <= 0 && !rolling;
    const want = pressed || (this.queued > 0 && ready);
    this.burstT = Math.max(0, this.burstT - dt);
    const brawl = g.combat.brawl;
    if (d?.melee && this.canShoot) {
      // Fists and melee weapons: tap to jab, hold to wind up a heavy, right mouse (AIM) to block.
      this.queued = 0;
      const block = !blocked && (input.rightHeld || this.adsTouch);
      // A click that came and went within one frame still counts as a tap (it lands next frame).
      const atk = brawl.update(dt, { held: (held || pressed) && !rolling, block, rate: d.rate, base: d.dmg, now: performance.now() });
      if (brawl.charge > 0 && Math.random() < dt * 20) {
        const p = g.player;
        const hx = p.x + Math.sin(p.yaw) * 0.45;
        const hz = p.z + Math.cos(p.yaw) * 0.45;
        g.effects.sparkle(hx, 1.25, hz, 1, brawl.charge >= 1 ? 0xff5a3a : 0xffc53d, 0.15 + brawl.charge * 0.2);
      }
      if (atk && !rolling) this.swing(d, atk);
    } else {
      brawl.update(dt, { held: false, block: false, rate: 1, base: 0, now: performance.now() });
    }
    if (d?.melee) {
      // (handled above)
    } else if (d?.charge) {
      // Railgun: hold to charge, let go to fire. The longer the charge, the harder it hits.
      this.queued = 0;
      if (held && this.canShoot && ready) {
        if (this.ammoOf(d.id) <= 0) {
          if (pressed) {
            audio.play('empty');
            this.reload();
          }
        } else {
          if (this.chargeT === 0) audio.play('charge');
          this.chargeT = Math.min(d.charge, this.chargeT + dt);
        }
      } else if (this.chargeT > 0) {
        const k = this.chargeT / d.charge;
        this.chargeT = 0;
        if (k > 0.12 && this.canShoot && !rolling) {
          this.shotMul = 0.25 + 0.75 * k;
          this.fire(d);
          this.shotMul = 1;
        }
      }
    } else if (d?.burst && !d.melee) {
      // Burst rifle: every pull fires a short burst.
      if (want && ready && this.burstLeft <= 0) {
        this.queued = 0;
        if (this.canShoot) this.burstLeft = d.burst;
      }
      if (this.burstLeft > 0 && this.burstT <= 0 && this.reloading <= 0 && this.canShoot && !rolling) {
        this.fire(d);
        this.burstLeft = this.ammoOf(d.id) > 0 && this.reloading <= 0 ? this.burstLeft - 1 : 0;
        this.burstT = d.burstGap ?? 0.07;
        this.cool = this.burstLeft > 0 ? 0 : 1 / d.rate;
      }
    } else if (d && (want || (d.auto && held))) {
      if (ready) this.queued = 0;
      if (rolling) {
        // Mid-roll: hold your fire.
      } else if (!this.canShoot) {
        this.queued = 0;
        if (pressed && this.warnT <= 0) {
          this.warnT = 2;
          g.notify(g.inside ? 'Guns stay holstered indoors: step out onto the street to shoot.' : 'You can only shoot out on the street.', 'bad');
        }
      } else if (ready) {
        if (d.kind === 'minigun' && this.spinV < 12) {
          // Barrels spin up first.
        } else this.fire(d);
      }
    }
    // Effects
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) {
        t.mesh.removeFromParent();
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      if (s.life < 3) (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / 3) * 0.9;
      if (s.life <= 0) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.splats.splice(i, 1);
      }
    }
    this.updateProjectiles(dt);
    // The street moves with you when you change buildings: drop old marks.
    if (this.lastActive !== g.street.activeId) {
      this.lastActive = g.street.activeId;
      for (const s of this.splats) s.life = Math.min(s.life, 0.01);
      for (const pr of this.projectiles) pr.mesh.removeFromParent();
      this.projectiles = [];
    }
    const now = Date.now();
    this.booms = this.booms.filter((b) => now - b.t < 4000);
  }

  private lastActive = '';
  /** Scope zoom: multiplies the scope's field of view (wheel up = closer). */
  scopeZoom = 1;

  /** How many times closer than the naked eye the scope shows right now. */
  get magnification(): number {
    return 72 / this.g.cam.fovTarget;
  }

  /** A trigger pull waiting for the cooldown to end (seconds left). */
  private queued = 0;

  private fire(d: TunedGun): void {
    const g = this.g;
    const left = this.ammoOf(d.id);
    if (left <= 0) {
      audio.play('empty');
      this.reload();
      return;
    }
    this.ammo.set(d.id, left - 1);
    this.cool = 1 / d.rate;
    this.shots++;
    g.stats.shotsFired++;
    const p = g.player;
    const fp = g.cam.mode === 'first';
    let yaw = this.aimYaw !== null && this.aimHold > 0 ? this.aimYaw : p.yaw;
    if (fp) yaw = g.cam.lookYaw;
    else if (g.input.isTouch || g.cam.mode === 'third') yaw = this.autoAim(p.yaw, d.range);
    p.yaw = yaw;
    p.model.root.rotation.y = yaw;
    const heavy = d.kind === 'cannon' || d.kind === 'shotgun' || d.kind === 'sniper';
    p.model.recoil = heavy ? 1 : 0.45;
    p.model.update(0);
    p.model.root.updateMatrixWorld(true);
    let muzzle: THREE.Vector3;
    if (fp && this.vm) {
      this.vm.holder.updateMatrixWorld(true);
      muzzle = this.vm.gun.localToWorld(this.vm.muzzle.clone());
    } else muzzle = this.held ? this.held.group.localToWorld(this.held.muzzle.clone()) : new THREE.Vector3(p.x + Math.sin(yaw) * 0.6, p.y + 1.3, p.z + Math.cos(yaw) * 0.6);
    // Muzzle flash
    if (d.kind !== 'paint' && d.kind !== 'flamer') {
      this.flash.position.copy(muzzle);
      const s = (d.kind === 'laser' ? 0.5 : heavy ? 1.1 : 0.7) * (fp ? 0.45 : 1);
      this.flash.scale.set(s, s, s);
      (this.flash.material as THREE.SpriteMaterial).color.setHex(d.kind === 'laser' ? d.tracer : 0xffd27a);
      this.flashT = 0.05;
    }
    const sfx: SfxName = d.kind === 'laser' ? 'laser' : d.kind === 'paint' ? 'paintball' : d.kind === 'confetti' ? 'confettiGun' : d.kind === 'shotgun' ? 'shotgun'
      : d.kind === 'flamer' ? 'flame' : d.kind === 'railgun' ? 'rail' : d.kind === 'rocket' ? 'cannon' : d.kind === 'launcher' ? 'launch'
        : d.kind === 'smg' || d.kind === 'minigun' || d.kind === 'rifle' ? 'smg' : d.kind === 'cannon' || d.kind === 'sniper' || d.kind === 'revolver' || d.id === 'deagle' ? 'gunHeavy' : 'gunshot';
    audio.play(sfx, d.quiet ? { pitch: 1.5 + Math.random() * 0.1, volume: 0.3 } : { pitch: 0.94 + Math.random() * 0.12 });
    // Where the bullets start and which way they go.
    const origin = fp ? g.renderer.camera.position.clone() : muzzle.clone();
    let base = fp ? g.cam.lookDir(new THREE.Vector3()) : new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const ndc = g.cam.aimNdc;
    if (fp && ndc) {
      // Mouse free: shoot where the cursor is.
      const ray = new THREE.Raycaster();
      g.renderer.camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), g.renderer.camera);
      base = ray.ray.direction.clone().normalize();
    }
    // Accuracy is skill: the first aimed shot from a standstill is pinpoint, every shot in a
    // spray blooms it open, and moving makes it worse. Through a sight it stays tighter.
    const sighted = fp && this.opticSight !== null && d.pellets === 1;
    const aimed = fp && this.aiming;
    let acc = spreadMul(d, this.spray, g.player.speed, aimed) * (aimed ? d.adsAcc : d.hipAcc);
    if (sighted) acc *= 0.35;
    if (fp) {
      // Recoil climbs with every shot in a spray and drifts in each gun's own pattern. Part of
      // it stays: pull the mouse down against it to keep on target.
      const [up, side] = recoilStep(d, this.spray);
      const k = (aimed ? 0.65 : 1) * d.kickMul;
      g.cam.kick += up * k * 0.6;
      g.cam.kickYaw += side * k * 0.5;
      g.cam.pitch += up * k * 0.4;
      g.cam.lookYaw += side * k * 0.5;
      this.vmKick = Math.min(1, this.vmKick + (heavy ? 1 : 0.5));
      g.cam.shake(heavy ? 0.05 : 0.012);
    } else g.cam.shake(d.kind === 'cannon' || d.kind === 'rocket' ? 0.1 : d.kind === 'shotgun' || d.kind === 'sniper' ? 0.07 : 0.025);
    this.spray += 1;
    this.sinceShot = 0;
    if (d.flame) {
      this.flameTick(d, muzzle, yaw, fp ? base : null);
      this.afterShot(d);
      return;
    }
    if (d.projectile) {
      this.launch(d, muzzle, base, fp);
      this.afterShot(d);
      return;
    }
    for (let i = 0; i < d.pellets; i++) {
      const dir = base.clone();
      const sp = d.pellets > 1 ? d.spread * Math.max(0.7, acc) : d.spread * acc;
      const ay = (Math.random() - 0.5) * 2 * sp;
      const ap = fp ? (Math.random() - 0.5) * 2 * sp : 0;
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), ay);
      if (ap) {
        const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
        dir.applyAxisAngle(side, ap);
      }
      dir.normalize();
      if (d.pierce) {
        // Railgun: one beam through up to `pierce` people.
        const done: Pierced = new Set();
        let end: THREE.Vector3 | null = null;
        for (let k = 0; k < d.pierce; k++) {
          const r = this.shootRay(d, origin, dir, muzzle, !fp, done, false);
          end = r.at;
          if (!r.person) break;
        }
        if (end) this.tracer(d, muzzle, end);
      } else this.shootRay(d, origin, dir, muzzle, !fp);
    }
    this.afterShot(d);
  }

  private afterShot(d: TunedGun): void {
    this.spreadK = Math.min(1, this.spreadK + (d.auto ? 0.12 : 0.35));
    // A suppressed shot doesn't send everyone running.
    if (!d.quiet) this.scareCrowd();
    this.g.events.emit('guns', undefined);
    if (this.ammoOf(d.id) <= 0) this.reload();
  }

  /**
   * Follow one bullet from `o` along `dir`: the nearest wall, ground, car, target or person
   * it meets. `flat` (top-down and third-person views) ignores heights, so whatever you
   * point at in the picture is what you hit.
   */
  private shootRay(d: GunDef, o: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, flat: boolean, done?: Pierced, drawTracer = true): { at: THREE.Vector3; person: boolean } {
    const g = this.g;
    const st = g.street;
    const city = st.city;
    let best: Hit = { kind: 'air', t: d.range };
    const indoor = g.indoorFight;
    // Walls and the ground: march until the bullet leaves the street or hits the pavement (or
    // a hillside). Aiming flat (top-down, over the shoulder) the shot follows the ground.
    for (let t = 0.3; t < d.range; t += 0.25) {
      const x = o.x + dir.x * t;
      const y = o.y + dir.y * t;
      const z = o.z + dir.z * t;
      const floor = indoor ? 0 : flat ? -Infinity : st.groundY(x, z) + g.streetDrop;
      if (y <= (flat ? 0.02 : floor + 0.02)) {
        best = { kind: 'ground', t: indoor && dir.y < -1e-4 ? Math.max(0, (o.y - 0.02) / -dir.y) : t };
        break;
      }
      // Buildings stand up to 60 m; out on the land, a slope too steep to climb stops a shot that skims it.
      if (indoor ? this.indoorBlocked(x, y, z) : y < 60 + Math.max(0, floor) && !st.isOutdoors(x, z) && (floor < 0.5 || y < floor + 3)) {
        best = { kind: 'wall', t };
        break;
      }
    }
    const hlen = Math.hypot(dir.x, dir.z);
    const og = st.worldToGlobal(o.x, o.z);
    const flipped = st.placeOf(st.activeId).side === 1;
    // Height of the bullet above the ground it's over (people stand on hills too).
    const yAt = (t: number) => {
      const y = o.y + dir.y * t;
      if (indoor || hlen < 0.02) return y;
      const sx = (flipped ? -dir.x : dir.x) * t;
      const sz = (flipped ? -dir.z : dir.z) * t;
      return y - groundAt(og.x + sx, og.z + sz) - g.streetDrop;
    };
    const flip = st.placeOf(st.activeId).side === 1;
    const gdx = flip ? -dir.x : dir.x;
    const gdz = flip ? -dir.z : dir.z;
    if (hlen > 0.02) {
      const hx = gdx / hlen;
      const hz = gdz / hlen;
      const sMax = best.t * hlen;
      // Tin cans, bottles and balloons.
      for (const tg of city.targets) {
        if (!tg.alive) continue;
        const px = tg.home.x - og.x;
        const pz = tg.home.z - og.z;
        const s = px * hx + pz * hz;
        if (s < 0 || s > sMax) continue;
        const r = tg.kind === 'balloon' ? 0.42 : 0.2;
        const dxy = Math.hypot(px - hx * s, pz - hz * s);
        const t = s / hlen;
        const dy = flat ? 0 : Math.abs(yAt(t) - tg.home.y);
        if (Math.hypot(dxy, dy) < r + (flat ? 0 : 0.05) && t < best.t) best = { kind: 'target', t, target: tg };
      }
      // Cars (a railgun beam goes straight through them).
      const car = done ? null : g.drive.raycast(og.x, og.z, hx, hz, best.t * hlen);
      if (car) {
        const t = car.t / hlen;
        const y = yAt(t);
        const top = car.v?.def?.kind === 'tank' || car.v?.def?.kind === 'apc' ? 2.6 : 1.55;
        if (t < best.t && (flat || (y > 0 && y < top))) {
          best = { kind: 'car', t, tg: car };
          // In through the glass: whoever sits in the line of fire takes the bullet.
          const tc = car.traffic;
          if (tc?.people.length && (flat || y > carSeats(tc.kind).belt - 0.05)) {
            const p = city.shootPeople(tc, og.x, og.z, hx, hz, car.t, car.t + tc.length + 1, flat ? null : (s) => yAt(s / hlen));
            if (p) best = { kind: 'occupant', t: p.s / hlen, car: tc, occ: p.occ, head: p.head };
          }
        }
      }
      // Soldiers at the military base (tower guards stand up high).
      for (const c of g.base.raycast(og.x, og.z, hx, hz, best.t * hlen)) {
        if (done?.has(c.soldier)) continue;
        const t = c.s / hlen;
        const y = o.y + dir.y * t - g.streetDrop - c.soldier.y;
        const h = c.soldier.model.height;
        if (t < best.t && (flat || (y > 0 && y < h + 0.08))) {
          best = { kind: 'soldier', t, soldier: c.soldier, head: !flat && y > h - 0.42 };
          break;
        }
      }
      // The base's machine-gun nests, its tank, the helicopter and the fuel tanks.
      for (const c of g.base.raycastMachines(og.x, og.z, hx, hz, best.t * hlen)) {
        // The helicopter's cockpit: a bullet through the canopy finds the crew.
        const cr = c.machine.kind === 'heli' ? g.base.crewHit(c.machine, o, dir, flat, best.t) : null;
        if (cr && cr.t < best.t) {
          best = { kind: 'crew', t: cr.t, machine: c.machine, crew: cr.crew, head: cr.head };
          break;
        }
        const t = c.s / hlen;
        const y = o.y + dir.y * t - g.streetDrop;
        if (t < best.t && (flat || (y > c.y0 && y < c.y1))) {
          best = { kind: 'machine', t, machine: c.machine };
          break;
        }
      }
      // People on the sidewalks.
      for (const c of st.crowd.raycast(og.x, og.z, hx, hz, best.t * hlen)) {
        if (done?.has(c.ped)) continue;
        const t = c.s / hlen;
        const y = yAt(t);
        const h = c.ped.model.height;
        if (t < best.t && (flat || (y > 0 && y < h + 0.08))) {
          best = { kind: 'ped', t, ped: c.ped, head: !flat && y > h - 0.42 };
          break;
        }
      }
      // The police.
      for (const c of st.police.raycast(og.x, og.z, hx, hz, best.t * hlen)) {
        if (done?.has(c.cop)) continue;
        const t = c.s / hlen;
        const y = yAt(t);
        const h = c.cop.model.height;
        if (t < best.t && (flat || (y > 0 && y < h + 0.15))) {
          best = { kind: 'cop', t, cop: c.cop, head: !flat && y > h - 0.42 };
          break;
        }
      }
      // Other players out on the street (world frame).
      const wx = dir.x / hlen;
      const wz = dir.z / hlen;
      for (const r of g.combat.remoteTargets()) {
        if (done?.has(r.pid)) continue;
        const px = r.x - o.x;
        const pz = r.z - o.z;
        const s = px * wx + pz * wz;
        if (s < 0) continue;
        const t = s / hlen;
        if (t >= best.t) continue;
        if (Math.hypot(px - wx * s, pz - wz * s) > 0.36) continue;
        const y = o.y + dir.y * t - r.y;
        if (!flat && (y < 0 || y > r.height + 0.08)) continue;
        best = { kind: 'player', t, pid: r.pid, name: r.name, head: !flat && y > r.height - 0.42 };
      }
      // A house's guards and its dog, mid-heist.
      if (g.heist) {
        for (const c of g.heist.raycast(o.x, o.z, wx, wz, best.t * hlen)) {
          if (done?.has(c.target)) continue;
          const t = c.s / hlen;
          if (t >= best.t) break;
          const y = yAt(t);
          if (!flat && (y < 0 || y > c.height + 0.08)) continue;
          best = { kind: 'guard', t, target: c.target, head: !flat && y > c.height - 0.42 };
          break;
        }
      }
    }
    const t = best.t;
    const hit = new THREE.Vector3(o.x + dir.x * t, flat ? muzzle.y : o.y + dir.y * t, o.z + dir.z * t);
    const fx = g.effects;
    const person = best.kind === 'ped' || best.kind === 'cop' || best.kind === 'soldier' || best.kind === 'player' || best.kind === 'guard' || best.kind === 'occupant' || best.kind === 'crew';
    if (done) {
      if (best.kind === 'ped') done.add(best.ped);
      else if (best.kind === 'cop') done.add(best.cop);
      else if (best.kind === 'soldier') done.add(best.soldier);
      else if (best.kind === 'player') done.add(best.pid);
      else if (best.kind === 'guard') done.add(best.target);
    }
    switch (best.kind) {
      case 'car': {
        const tr = best.tg.traffic;
        if (tr) {
          if (tr.shaken <= 0 && this.alarmT <= 0) {
            this.alarmT = 1.5;
            audio.playAt('carAlarm', hit.x, hit.z, 0.8);
          }
          city.hitCar(tr);
        }
        if (d.dmg > 0) g.drive.shoot(best.tg, d.dmg);
        audio.playAt('metalHit', hit.x, hit.z, 0.7);
        g.stats.carsHit++;
        st.police.crime(HEAT.car, false);
        fx.sparkle(hit.x, Math.max(0.5, hit.y), hit.z, 8, 0xfff2c8, 0.4);
        if (Math.random() < 0.4) audio.playAt('ricochet', hit.x, hit.z, 0.6);
        break;
      }
      case 'occupant': {
        // Through the window: the glass goes, and so does whoever's behind it.
        audio.playAt('glass', hit.x, hit.z, 0.8);
        fx.sparkle(hit.x, hit.y, hit.z, 14, 0xbff6ff, 0.45);
        if (flat) hit.y = 1.2;
        if (best.car.shaken <= 0 && !best.car.dead && this.alarmT <= 0) {
          this.alarmT = 1.5;
          audio.playAt('carAlarm', hit.x, hit.z, 0.8);
        }
        city.hitCar(best.car);
        const dmg = this.dmgOf(d, best.head, t);
        if (dmg <= 0) break;
        const ko = city.hurtPerson(best.car, best.occ, dmg);
        st.police.crime(ko ? HEAT.knockout : HEAT.hitPerson);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, ko);
        if (ko) {
          g.stats.knockouts++;
          if (best.occ.seat === 0) g.notify('🚗 You shot the driver: the car rolls to a stop.', 'bad');
        }
        break;
      }
      case 'crew': {
        // The helicopter's canopy: hit the pilot and it goes down.
        audio.playAt('glass', hit.x, hit.z, 0.8);
        fx.sparkle(hit.x, hit.y, hit.z, 14, 0xbff6ff, 0.45);
        const dmg = this.dmgOf(d, best.head, t);
        if (dmg <= 0) break;
        const ko = g.base.hitCrew(best.machine, best.crew, dmg);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, ko);
        if (ko) g.stats.knockouts++;
        break;
      }
      case 'target': {
        const k = best.target.kind;
        const y = best.target.home.y;
        city.hitTarget(best.target, gdx, gdz);
        g.stats.targetsHit++;
        hit.y = y;
        if (k === 'can') {
          audio.playAt('ping', hit.x, hit.z, 0.9);
          fx.sparkle(hit.x, y, hit.z, 8, 0xfff2c8, 0.3);
        } else if (k === 'bottle') {
          audio.playAt('glass', hit.x, hit.z, 0.9);
          fx.sparkle(hit.x, y, hit.z, 18, 0xbff6ff, 0.5);
        } else {
          audio.playAt('balloon', hit.x, hit.z, 1);
          fx.confetti(hit.x, y, hit.z, 30, 0.6);
        }
        g.onTargetHit();
        break;
      }
      case 'ped': {
        const dmg = this.dmgOf(d, best.head, t);
        if (flat) hit.y = 1.2;
        if (d.kind === 'paint') this.splat(hit.x, hit.y, hit.z, -dir.x, -dir.z, true);
        if (dmg <= 0) break;
        const r = st.crowd.damage(best.ped, dmg, gdx, gdz);
        st.police.crime(r.ko ? HEAT.knockout : HEAT.hitPerson);
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, r.ko);
        if (r.ko) g.onStreetKnockout(r.cash, hit);
        break;
      }
      case 'player': {
        const dmg = this.dmgOf(d, best.head, t);
        if (flat) hit.y = 1.2;
        if (dmg <= 0) break;
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.onHitRemote?.(best.pid, Math.round(dmg));
        st.police.crime(HEAT.hitPerson);
        g.combat.landed(best.head, false);
        break;
      }
      case 'soldier': {
        const dmg = this.dmgOf(d, best.head, t);
        if (flat) hit.y = best.soldier.y + 1.2;
        if (dmg <= 0) break;
        const ko = g.base.damage(best.soldier, dmg);
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, ko);
        if (ko) g.stats.knockouts++;
        break;
      }
      case 'machine': {
        const m = best.machine;
        if (flat) hit.y = m.y;
        if (d.dmg <= 0) break;
        const dmg = Math.max(1, Math.round(d.dmg * m.armor));
        const gone = g.base.damageMachine(m, d.dmg);
        audio.playAt('metalHit', hit.x, hit.z, 0.7);
        fx.sparkle(hit.x, hit.y, hit.z, 8, 0xfff2c8, 0.4);
        g.floaters.text(hit.clone().setY(hit.y + 0.6), `${dmg}`, 'dmg', 0.8, 0.6);
        if (Math.random() < 0.3) audio.playAt('ricochet', hit.x, hit.z, 0.5);
        g.combat.landed(false, gone);
        break;
      }
      case 'guard': {
        const dmg = this.dmgOf(d, best.head, t);
        if (flat) hit.y = 1.2;
        if (d.kind === 'paint') this.splat(hit.x, hit.y, hit.z, -dir.x, -dir.z, true);
        if (dmg <= 0 || !g.heist) break;
        const ko = g.heist.damage(best.target, dmg);
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, ko);
        break;
      }
      case 'cop': {
        const dmg = this.dmgOf(d, best.head, t);
        if (flat) hit.y = 1.2;
        if (d.kind === 'paint') this.splat(hit.x, hit.y, hit.z, -dir.x, -dir.z, true);
        if (dmg <= 0) break;
        const ko = st.police.damage(best.cop, dmg);
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, ko);
        if (ko) {
          g.stats.knockouts++;
          audio.play('knockout', { volume: 0.7 });
        }
        break;
      }
      case 'wall': {
        fx.sparkle(hit.x, hit.y, hit.z, d.kind === 'shotgun' ? 3 : 6, d.kind === 'laser' ? d.tracer : 0xffe2a8, 0.25);
        if (d.kind !== 'paint' && d.kind !== 'confetti') fx.smoke(hit.x, hit.y, hit.z, 1);
        if (d.kind === 'paint') this.splat(hit.x, flat ? 1 + Math.random() * 0.8 : hit.y, hit.z, -dir.x, -dir.z, true);
        if (Math.random() < 0.15) audio.playAt('ricochet', hit.x, hit.z, 0.5);
        break;
      }
      case 'ground': {
        fx.sparkle(hit.x, 0.05, hit.z, 3, 0xffe2a8, 0.2);
        if (d.kind !== 'paint' && d.kind !== 'confetti') fx.smoke(hit.x, 0.05, hit.z, 1);
        if (d.kind === 'paint') this.splat(hit.x, 0.02, hit.z, 0, 0, false);
        break;
      }
      case 'air':
        if (d.kind === 'paint' && flat) this.splat(o.x + dir.x * d.range * 0.7, 0.02, o.z + dir.z * d.range * 0.7, 0, 0, false);
        break;
    }
    if (d.kind === 'confetti') fx.confetti(hit.x, Math.max(1, hit.y), hit.z, 70, 0.9);
    if (drawTracer) this.tracer(d, muzzle, hit);
    return { at: hit, person };
  }

  // ------------------------------------------------------------------ flames, grenades, rockets

  /** One tick of the flamethrower: everyone in the cone in front of you burns. */
  private flameTick(d: TunedGun, muzzle: THREE.Vector3, yaw: number, look: THREE.Vector3 | null): void {
    const g = this.g;
    const st = g.street;
    const p = g.player;
    const og = st.worldToGlobal(p.x, p.z);
    const flip = st.placeOf(st.activeId).side === 1;
    const gdx = (flip ? -1 : 1) * Math.sin(yaw);
    const gdz = (flip ? -1 : 1) * Math.cos(yaw);
    const reach = d.range;
    const cone = Math.cos(0.32);
    const inCone = (dx: number, dz: number) => {
      const dist = Math.hypot(dx, dz);
      return dist < reach && (dist < 0.6 || (dx * gdx + dz * gdz) / dist > cone);
    };
    const show = this.shots % 4 === 0;
    const fx = g.effects;
    const dir = look ? look.clone() : new THREE.Vector3(Math.sin(yaw), -0.04, Math.cos(yaw));
    // In first person the flames start a little ahead of the nozzle (not in your face).
    const o = look ? muzzle.clone().addScaledVector(dir.clone().normalize(), 0.9) : muzzle;
    fx.jet(o.x, o.y, o.z, dir.x, dir.y, dir.z, reach);
    const at = (gx: number, gz: number) => {
      const w = st.globalToWorld(gx, gz);
      return new THREE.Vector3(w.x, 1.2, w.z);
    };
    const dmg = Math.round(d.dmg * (this.perfectMag ? 1.15 : 1));
    for (const ped of st.crowd.around(og.x, og.z, reach)) {
      if (!inCone(ped.x - og.x, ped.z - og.z)) continue;
      const r = st.crowd.damage(ped, dmg, gdx, gdz);
      st.police.crime(r.ko ? HEAT.knockout : HEAT.hitPerson);
      if (show) g.floaters.text(at(ped.x, ped.z).setY(1.7), `🔥${dmg * 4}`, 'dmg', 0.8, 0.6);
      g.combat.landed(false, r.ko);
      if (r.ko) g.onStreetKnockout(r.cash, at(ped.x, ped.z));
    }
    for (const o of st.police.officers) {
      if (o.ko > 0 || o.leaving > 0 || !inCone(o.x - og.x, o.z - og.z)) continue;
      const ko = st.police.damage(o, dmg);
      g.combat.landed(false, ko);
      if (ko) g.stats.knockouts++;
    }
    for (const so of g.base.soldiers) {
      if (so.ko > 0 || so.y > 1 || !inCone(so.x - og.x, so.z - og.z)) continue;
      const ko = g.base.damage(so, dmg);
      g.combat.landed(false, ko);
      if (ko) g.stats.knockouts++;
    }
    for (const r of g.combat.remoteTargets()) {
      const rg = st.worldToGlobal(r.x, r.z);
      if (!inCone(rg.x - og.x, rg.z - og.z)) continue;
      g.combat.onHitRemote?.(r.pid, dmg);
      st.police.crime(HEAT.hitPerson);
      if (show) g.floaters.text(new THREE.Vector3(r.x, 1.7, r.z), `🔥${dmg * 4}`, 'dmg', 0.8, 0.6);
      g.combat.landed(false, false);
    }
    for (const c of st.city.traffic) {
      if (!c.root.visible || !inCone(c.x - og.x, c.z - og.z)) continue;
      g.drive.hurtTraffic(c, dmg * 1.2, true);
    }
    for (const v of g.drive.vehicles) {
      if (v === g.drive.driving || !inCone(v.x - og.x, v.z - og.z)) continue;
      g.drive.damage(v, dmg * 1.2 * v.armor, true);
    }
    for (const tg of st.city.targets) {
      if (!tg.alive || !inCone(tg.home.x - og.x, tg.home.z - og.z)) continue;
      st.city.hitTarget(tg, gdx, gdz);
      g.onTargetHit();
    }
    // Guards and the dog (world frame).
    if (g.heist) {
      const wx = Math.sin(yaw);
      const wz = Math.cos(yaw);
      for (const t of g.heist.around(p.x, p.z, reach)) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.6 && (dx * wx + dz * wz) / dist <= cone) continue;
        if (!g.heist.clearSight(p.floor, p.x, p.z, t.x, t.z)) continue;
        const ko = g.heist.damage(t, dmg);
        if (show) g.floaters.text(new THREE.Vector3(t.x, 1.7, t.z), `🔥${dmg * 4}`, 'dmg', 0.8, 0.6);
        g.combat.landed(false, ko);
      }
    }
  }

  /** Fire a grenade or rocket from the muzzle. */
  private launch(d: TunedGun, muzzle: THREE.Vector3, base: THREE.Vector3, fp: boolean): void {
    const pr = d.projectile!;
    const vel = base.clone().normalize().multiplyScalar(pr.speed);
    if (!fp) {
      // Top-down and third person: grenades lob in an arc, rockets fly level.
      vel.y = pr.gravity > 0 ? 5.5 : 0;
    } else if (pr.gravity > 0) vel.y += 1.5;
    let mesh: THREE.Object3D;
    if (d.kind === 'rocket') {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), mat(0x6b7a3a, { rough: 0.5 }));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10), mat(0x3a3c36, { rough: 0.5 }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.28;
      const glowM = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb040, toneMapped: false }));
      glowM.position.z = -0.24;
      grp.add(body, tip, glowM);
      mesh = grp;
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat(0x4a4f3a, { rough: 0.6 }));
    }
    mesh.position.copy(muzzle);
    this.group.add(mesh);
    this.projectiles.push({ pos: muzzle.clone(), vel, d, mesh, life: 0, mul: this.perfectMag ? 1.15 : 1 });
  }

  private updateProjectiles(dt: number): void {
    const g = this.g;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const pr = p.d.projectile!;
      p.life += dt;
      const steps = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.4));
      let boom: THREE.Vector3 | null = null;
      for (let k = 0; k < steps && !boom; k++) {
        const prev = p.pos.clone();
        p.vel.y -= (pr.gravity * dt) / steps;
        p.pos.addScaledVector(p.vel, dt / steps);
        if (this.projectileHits(prev, p.pos)) {
          const floor = g.indoorFight ? 0 : g.street.groundY(p.pos.x, p.pos.z) + g.streetDrop;
          boom = p.pos.y <= floor + 0.1 ? p.pos.clone().setY(floor + 0.15) : prev;
        }
      }
      if (!boom && p.life > 5) boom = p.pos.clone();
      p.mesh.position.copy(p.pos);
      p.mesh.lookAt(p.pos.clone().add(p.vel));
      // Trails: rockets burn and smoke, grenades leave a wisp.
      if (p.d.kind === 'rocket') {
        g.effects.fire(p.pos.x, p.pos.y, p.pos.z, 0.4);
        if (Math.random() < 0.6) g.effects.soot(p.pos.x, p.pos.y, p.pos.z, 0);
      } else if (Math.random() < 0.35) g.effects.soot(p.pos.x, p.pos.y, p.pos.z, 0);
      if (boom) {
        p.mesh.removeFromParent();
        this.projectiles.splice(i, 1);
        this.explodeAt(boom, p.d, p.mul);
      }
    }
  }

  /** Did a projectile flying from a to b (world) hit the ground, a wall, a car or someone? */
  private projectileHits(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const g = this.g;
    const st = g.street;
    const floor = g.indoorFight ? 0 : st.groundY(b.x, b.z) + g.streetDrop;
    if (b.y <= floor + 0.1) return true;
    if (g.indoorFight ? this.indoorBlocked(b.x, b.y, b.z) : b.y < 60 + Math.max(0, floor) && !st.isOutdoors(b.x, b.z) && (floor < 0.5 || b.y < floor + 3)) return true;
    if (b.y > floor + 2.4) return false;
    if (g.heist && b.y < 2 && g.heist.around(b.x, b.z, 0.55).length) return true;
    const ga = st.worldToGlobal(a.x, a.z);
    const gb = st.worldToGlobal(b.x, b.z);
    const len = Math.hypot(gb.x - ga.x, gb.z - ga.z);
    if (len < 1e-4) return false;
    const hx = (gb.x - ga.x) / len;
    const hz = (gb.z - ga.z) / len;
    const reach = len + 0.3;
    if (st.crowd.raycast(ga.x - hx * 0.3, ga.z - hz * 0.3, hx, hz, reach).length) return true;
    if (st.police.raycast(ga.x - hx * 0.3, ga.z - hz * 0.3, hx, hz, reach).length) return true;
    if (g.base.raycast(ga.x - hx * 0.3, ga.z - hz * 0.3, hx, hz, reach).some((c) => b.y > c.soldier.y && b.y < c.soldier.y + 2)) return true;
    if (b.y < 1.8 && g.drive.raycast(ga.x, ga.z, hx, hz, len)) return true;
    for (const r of g.combat.remoteTargets()) if (Math.hypot(r.x - b.x, r.z - b.z) < 0.55 && b.y < r.y + 2) return true;
    return false;
  }

  /** A grenade or rocket goes off (world frame): blast damage all round, you included. */
  private explodeAt(w: THREE.Vector3, d: GunDef, mul: number): void {
    const g = this.g;
    const st = g.street;
    const ex = d.explosive!;
    g.effects.explosion(w.x, Math.max(0.3, w.y), w.z, ex.radius / 5);
    audio.playAt('explosion', w.x, w.z, 1.4);
    const pd = Math.hypot(g.player.x - w.x, g.player.z - w.z);
    g.cam.shake(Math.max(0.04, 0.45 - pd / 40));
    const gp = st.worldToGlobal(w.x, w.z);
    const power = ex.power * mul;
    g.drive.blast(gp.x, gp.z, ex.radius, power, true);
    for (const r of g.combat.remoteTargets()) {
      const dist = Math.hypot(r.x - w.x, r.z - w.z);
      if (dist >= ex.radius) continue;
      const dmg = Math.round(power * (1 - dist / ex.radius));
      if (dmg <= 0) continue;
      g.combat.onHitRemote?.(r.pid, dmg);
      g.floaters.text(new THREE.Vector3(r.x, 1.8, r.z), `💥${dmg}`, 'dmg head', 1, 0.8);
      g.combat.landed(false, false);
    }
    if (g.heist) {
      for (const t of g.heist.around(w.x, w.z, ex.radius)) {
        const dmg = Math.round(power * (1 - Math.hypot(t.x - w.x, t.z - w.z) / ex.radius) * 1.5);
        if (dmg <= 0) continue;
        g.floaters.text(new THREE.Vector3(t.x, 1.8, t.z), `💥${dmg}`, 'dmg head', 1, 0.8);
        g.combat.landed(false, g.heist.damage(t, dmg));
      }
    }
    st.police.crime(HEAT.hitPerson, false);
    this.booms.push({ i: Math.random().toString(36).slice(2, 9), x: Math.round(gp.x * 10) / 10, z: Math.round(gp.z * 10) / 10, r: ex.radius, t: Date.now() });
    if (this.booms.length > 6) this.booms.shift();
  }

  /**
   * Swing a melee weapon: everyone (and everything) in a cone in front of you within reach
   * gets hit. Same street-only rules, damage, knockouts and police heat as guns.
   */
  private swing(d: GunDef, atk: Attack): void {
    const g = this.g;
    const st = g.street;
    const p = g.player;
    const dmg = atk.dmg;
    // A heavy blow or a combo finisher sends people flying (and lunges you in).
    const big = atk.heavy || atk.step === 2 || atk.riposte;
    this.shots++;
    if (atk.heavy) this.heavies++;
    g.stats.shotsFired++;
    const fp = g.cam.mode === 'first';
    let yaw = this.aimYaw !== null && this.aimHold > 0 ? this.aimYaw : p.yaw;
    if (fp) yaw = g.cam.lookYaw;
    p.yaw = yaw;
    p.model.root.rotation.y = yaw;
    p.model.swing = 1;
    this.swingT = 0.35;
    audio.play('whoosh', { pitch: (atk.heavy ? 0.85 : 1.3) + Math.random() * 0.3, volume: atk.heavy ? 0.9 : 0.6 });
    g.lunge(yaw, atk.heavy ? 0.9 : big ? 0.55 : 0.3);
    const og = st.worldToGlobal(p.x, p.z);
    const flip = st.placeOf(st.activeId).side === 1;
    const gdx = (flip ? -1 : 1) * Math.sin(yaw);
    const gdz = (flip ? -1 : 1) * Math.cos(yaw);
    const reach = d.range + 0.35;
    const cone = Math.cos(d.spread);
    const inCone = (dx: number, dz: number) => {
      const dist = Math.hypot(dx, dz);
      return dist < reach && (dist < 0.4 || (dx * gdx + dz * gdz) / dist > cone);
    };
    const fx = g.effects;
    const hitAt = (gx: number, gz: number, y: number) => {
      const w = st.globalToWorld(gx, gz);
      return new THREE.Vector3(w.x, y, w.z);
    };
    let landed = 0;
    const label = `${dmg}${atk.riposte ? ' COUNTER!' : atk.heavy ? '!' : ''}`;
    const thump = () => {
      if (!landed) audio.play('thud', { pitch: (atk.heavy ? 0.65 : 0.9) + Math.random() * 0.2, volume: big ? 1 : 0.8 });
      landed++;
    };
    for (const ped of st.crowd.around(og.x, og.z, reach)) {
      if (!inCone(ped.x - og.x, ped.z - og.z)) continue;
      const at = hitAt(ped.x, ped.z, 1.2);
      const r = st.crowd.damage(ped, dmg, big ? gdx * 3 : gdx, big ? gdz * 3 : gdz);
      // Hitting someone who's already fighting you is self-defence.
      if (!ped.fight) st.police.crime(r.ko ? HEAT.knockout : HEAT.hitPerson);
      else if (atk.riposte || big) st.crowd.stagger(ped, big ? 0.9 : 0.4);
      if (!r.ko && !ped.fight && Math.random() < BRAWL_CHANCE) st.crowd.provoke(ped);
      fx.sparkle(at.x, at.y, at.z, 6, 0xffffff, 0.3);
      g.floaters.text(at.clone().setY(1.7), label, 'dmg', 0.9, 0.7);
      g.combat.landed(false, r.ko);
      if (r.ko) g.onStreetKnockout(r.cash, at);
      thump();
    }
    for (const o of st.police.officers) {
      if (o.ko > 0 || o.leaving > 0 || !inCone(o.x - og.x, o.z - og.z)) continue;
      const at = hitAt(o.x, o.z, 1.2);
      const ko = st.police.damage(o, dmg);
      fx.sparkle(at.x, at.y, at.z, 6, 0xffffff, 0.3);
      g.floaters.text(at.clone().setY(1.7), label, 'dmg', 0.9, 0.7);
      g.combat.landed(false, ko);
      if (ko) g.stats.knockouts++;
      thump();
    }
    for (const r of g.combat.remoteTargets()) {
      const rg = st.worldToGlobal(r.x, r.z);
      if (!inCone(rg.x - og.x, rg.z - og.z)) continue;
      g.combat.onMeleeRemote?.(r.pid, dmg, atk.heavy);
      st.police.crime(HEAT.hitPerson);
      fx.sparkle(r.x, 1.2, r.z, 6, 0xffffff, 0.3);
      g.floaters.text(new THREE.Vector3(r.x, 1.7, r.z), label, 'dmg', 0.9, 0.7);
      g.combat.landed(false, false);
      thump();
    }
    for (const tg of st.city.targets) {
      if (!tg.alive || !inCone(tg.home.x - og.x, tg.home.z - og.z)) continue;
      st.city.hitTarget(tg, gdx, gdz);
      g.stats.targetsHit++;
      g.onTargetHit();
      audio.play(tg.kind === 'bottle' ? 'glass' : tg.kind === 'balloon' ? 'balloon' : 'ping');
      landed++;
    }
    for (const so of g.base.soldiers) {
      if (so.ko > 0 || so.y > 1 || !inCone(so.x - og.x, so.z - og.z)) continue;
      const at = hitAt(so.x, so.z, 1.2);
      const ko = g.base.damage(so, dmg);
      fx.sparkle(at.x, at.y, at.z, 6, 0xffffff, 0.3);
      g.floaters.text(at.clone().setY(1.7), label, 'dmg', 0.9, 0.7);
      g.combat.landed(false, ko);
      if (ko) g.stats.knockouts++;
      thump();
    }
    for (const c of st.city.traffic) {
      if (!c.root.visible || !inCone(c.x - og.x, c.z - og.z)) continue;
      st.city.hitCar(c);
      g.drive.hurtTraffic(c, shotDamage(dmg), true);
      g.stats.carsHit++;
      st.police.crime(HEAT.car, false);
      audio.play('carAlarm');
      landed++;
      break;
    }
    if (g.heist) {
      const wx = Math.sin(yaw);
      const wz = Math.cos(yaw);
      for (const t of g.heist.around(p.x, p.z, reach)) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.4 && (dx * wx + dz * wz) / dist <= cone) continue;
        const ko = g.heist.damage(t, dmg);
        fx.sparkle(t.x, 1.2, t.z, 6, 0xffffff, 0.3);
        g.floaters.text(new THREE.Vector3(t.x, 1.7, t.z), label, 'dmg', 0.9, 0.7);
        g.combat.landed(false, ko);
        thump();
      }
    }
    if (landed) g.cam.shake(big ? 0.1 : 0.05);
    g.events.emit('guns', undefined);
  }

  /** A police (or another player's) bullet (world frame). */
  enemyTracer(a: THREE.Vector3, b: THREE.Vector3, color = 0xffb45a): void {
    const len = a.distanceTo(b);
    if (len < 0.2) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, len), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    this.group.add(m);
    this.tracers.push({ mesh: m, life: 0.07, max: 0.07 });
  }

  private tracer(d: GunDef, a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    if (len < 0.2) return;
    const thick = d.kind === 'railgun' ? 0.1 : d.kind === 'laser' ? 0.06 : d.kind === 'paint' || d.kind === 'confetti' ? 0.09 : 0.025;
    const geo = new THREE.BoxGeometry(thick, thick, len);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: d.kind === 'paint' ? SPLAT_COLORS[Math.floor(Math.random() * SPLAT_COLORS.length)] : d.tracer,
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    this.group.add(m);
    const life = d.kind === 'railgun' ? 0.35 : d.kind === 'laser' ? 0.16 : d.kind === 'paint' || d.kind === 'confetti' ? 0.12 : 0.06;
    this.tracers.push({ mesh: m, life, max: life });
  }

  private splat(x: number, y: number, z: number, nx: number, nz: number, wall: boolean): void {
    const size = 0.5 + Math.random() * 0.4;
    const geo = new THREE.CircleGeometry(size, 10);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 1; i < pos.count; i++) {
      const k = 0.65 + Math.random() * 0.55;
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: SPLAT_COLORS[Math.floor(Math.random() * SPLAT_COLORS.length)], transparent: true, opacity: 0.9, depthWrite: false }));
    if (wall) {
      m.position.set(x + nx * 0.05, y, z + nz * 0.05);
      m.rotation.y = Math.atan2(nx, nz);
    } else {
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
    }
    this.group.add(m);
    this.splats.push({ mesh: m, life: 25 });
    if (this.splats.length > 60) this.splats[0].life = 0;
  }

  /** Gunfire on the street sends the people out there running. */
  private scareCrowd(): void {
    const g = this.g;
    const p = g.player;
    const pg = g.street.worldToGlobal(p.x, p.z);
    g.street.crowd.scare(pg.x, pg.z, 22);
    for (const c of g.customers) {
      if (c.inside || c.exited || c.gone || c.state === 'leave') continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) > 16) continue;
      c.run = true;
      c.mood = Math.max(0, c.mood - 25);
      c.leave(Math.random() < 0.5 ? 'Gunshots! I’m out of here!' : 'Somebody’s shooting out there!');
    }
  }

  /** Forget the model (new game / reload). */
  reset(): void {
    this.ammo.clear();
    this.reloading = 0;
    this.spray = 0;
    this.chargeT = 0;
    this.burstLeft = 0;
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles = [];
    this.syncHeld();
  }
}

const reticleTex = new Map<string, THREE.CanvasTexture>();
/** Your crosshair etched into a scope's glass (clear everywhere else). */
function reticleTexture(o: ReticleOpts): THREE.CanvasTexture {
  const key = reticleKey(o);
  const hit = reticleTex.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.beginPath();
  x.arc(128, 128, 126, 0, Math.PI * 2);
  x.clip();
  drawReticle(x, 256, { ...o, thick: Math.max(1, o.thick) }, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  reticleTex.set(key, t);
  return t;
}

/** Damage of one bullet: headshots do more (×2 for most guns), and a sniper round to the head always knocks out. */
export function hitDamage(d: GunDef, head: boolean): number {
  if (head && d.id === 'sniper') return 999;
  return d.dmg * (head ? headMul(d) : 1);
}

/** Another player's shot as you see it: a tracer from their gun (world frame). */
export function remoteShotEnd(x: number, z: number, yaw: number, range: number, outdoors: (x: number, z: number) => boolean): THREE.Vector3 {
  let t = 1;
  for (; t < range; t += 0.5) if (!outdoors(x + Math.sin(yaw) * t, z + Math.cos(yaw) * t)) break;
  return new THREE.Vector3(x + Math.sin(yaw) * t, 1.25, z + Math.cos(yaw) * t);
}
