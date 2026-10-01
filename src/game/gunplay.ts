import * as THREE from 'three';
import type { Game } from './game';
import { type GunDef, gunDef } from './guns';
import { buildGun } from '../items/models/guns';
import { audio, type SfxName } from '../core/audio';
import { softDotTexture } from '../render/textures';
import type { Ped } from '../world/crowd';
import { mat } from '../render/materials';

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

/** The gun on screen in first person: your hand around the grip, sway, recoil and reloads. */
interface ViewModel {
  id: string;
  holder: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Vector3;
  spin?: THREE.Object3D;
  scale: number;
}

/** Something a bullet can stop at. */
type Hit =
  | { kind: 'wall' | 'ground' | 'air'; t: number }
  | { kind: 'target'; t: number; target: import('../world/cityView').Target }
  | { kind: 'car'; t: number; car: import('../world/cityView').Car }
  | { kind: 'ped'; t: number; ped: Ped; head: boolean }
  | { kind: 'player'; t: number; pid: string; name: string; head: boolean };

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
  private held: { id: string; group: THREE.Group; muzzle: THREE.Vector3; spin?: THREE.Object3D } | null = null;
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
  private swayY = 0;
  private vmKick = 0;
  private bobT = 0;
  /** Bloom of the crosshair from firing and moving (0..1). */
  spreadK = 0;

  constructor(private g: Game) {
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.group.add(this.flash);
  }

  get def(): GunDef | null {
    return gunDef(this.g.guns.equipped);
  }

  ammoOf(id: string): number {
    const d = gunDef(id);
    return this.ammo.get(id) ?? d?.mag ?? 0;
  }

  /** Out on the roads and sidewalks with your feet on the ground. */
  get canShoot(): boolean {
    const g = this.g;
    const p = g.player;
    return g.state === 'playing' && !g.inside && p.floor === 0 && !p.seat && !g.photoMode && g.combat.ko <= 0 && g.street.isOutdoors(p.x, p.z);
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
    return this.firstPerson && this.reloading <= 0 && !g.modalOpen && (g.input.rightHeld || this.adsTouch);
  }

  /** Fully zoomed through a scope (the sniper shows a scope instead of the gun). */
  get scoped(): boolean {
    return this.aiming && this.def?.kind === 'sniper' && this.adsK > 0.85;
  }

  /** Knocked out: the trigger finger lets go. */
  drop(): void {
    this.fireHeld = false;
    this.firePressed = false;
    this.adsTouch = false;
  }

  reload(): void {
    const d = this.def;
    if (!d || this.reloading > 0 || this.ammoOf(d.id) >= d.mag) return;
    this.reloading = d.reload;
    audio.play('reload');
    this.g.events.emit('guns', undefined);
  }

  private syncHeld(): void {
    const d = this.def;
    const show = !!d && this.canShoot;
    if (this.held && (!show || this.held.id !== d?.id)) {
      this.held.group.removeFromParent();
      this.held.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.held = null;
    }
    if (show && !this.held && d) {
      const b = buildGun(d);
      this.g.player.model.hand.add(b.group);
      this.held = { id: d.id, group: b.group, muzzle: b.muzzle, spin: b.spin };
    }
    this.g.player.model.aim = show && d ? (d.twoHand ? 2 : 1) : 0;
    const fp = show && this.g.cam.mode === 'first';
    if (this.vm && (!fp || this.vm.id !== d?.id)) {
      this.vm.holder.removeFromParent();
      this.vm.gun.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.vm = null;
    }
    if (fp && !this.vm && d) this.vm = this.buildViewModel(d);
  }

  /** The gun as you see it in your own hands. */
  private buildViewModel(d: GunDef): ViewModel {
    const look = this.g.player.appearance;
    const b = buildGun(d);
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
    return { id: d.id, holder, gun, muzzle: new THREE.Vector3(b.muzzle.x, b.muzzle.y, -b.muzzle.z), spin: b.spin, scale };
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
    // Too close to a wall: pull the gun back and down.
    const fwd = g.cam.lookDir(new THREE.Vector3());
    const near = !g.street.isOutdoors(g.player.x + fwd.x * 0.75, g.player.z + fwd.z * 0.75) ? 1 : 0;
    const k = this.adsK;
    const sightY = -0.03 - vm.muzzle.y * vm.scale;
    const hip = { x: 0.085, y: -0.075, z: -0.24 };
    const ads = { x: -vm.muzzle.x * vm.scale, y: sightY, z: -0.25 };
    const x = hip.x + (ads.x - hip.x) * k + this.swayX * 0.5 + Math.cos(this.bobT) * 0.006 * bob;
    const y = hip.y + (ads.y - hip.y) * k + this.swayY * 0.5 - Math.abs(Math.sin(this.bobT)) * 0.007 * bob - reload * 0.06 - near * 0.05;
    const z = hip.z + (ads.z - hip.z) * k + this.vmKick * 0.035 + near * 0.04;
    vm.gun.position.set(x, y, z);
    vm.gun.rotation.set(this.vmKick * 0.18 + reload * 0.9 + near * 0.5, this.swayX * 2, reload * 0.5 + this.swayX * 1.5);
    vm.holder.visible = !this.scoped;
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
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
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
    // First person on desktop: the trigger only works while the mouse is captured.
    const fpDesk = g.cam.mode === 'first' && !input.isTouch;
    const mouseOk = !input.isTouch && (!fpDesk || input.locked);
    const pressed = !blocked && (input.mousePresses > 0 && mouseOk ? true : this.firePressed);
    const held = !blocked && ((input.mouseHeld && mouseOk && input.pointer.over) || this.fireHeld);
    this.firePressed = false;
    if (!this.drawn) this.adsTouch = false;
    const moving = Math.min(1, g.player.speed / 4);
    this.spreadK = Math.max(moving * 0.6, this.spreadK - dt * 2.2);
    if (g.cam.mode === 'first' && d) {
      g.cam.fovTarget = this.aiming ? d.adsFov : 72;
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
    if (d && (pressed || (d.auto && held))) {
      if (!this.canShoot) {
        if (pressed && this.warnT <= 0) {
          this.warnT = 2;
          g.notify(g.inside ? 'Guns stay holstered indoors: step out onto the street to shoot.' : 'You can only shoot out on the street.', 'bad');
        }
      } else if (this.cool <= 0 && this.reloading <= 0) {
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
    // The street moves with you when you change buildings: drop old marks.
    if (this.lastActive !== g.street.activeId) {
      this.lastActive = g.street.activeId;
      for (const s of this.splats) s.life = Math.min(s.life, 0.01);
    }
  }

  private lastActive = '';

  private fire(d: GunDef): void {
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
    } else muzzle = this.held ? this.held.group.localToWorld(this.held.muzzle.clone()) : new THREE.Vector3(p.x + Math.sin(yaw) * 0.6, 1.3, p.z + Math.cos(yaw) * 0.6);
    // Muzzle flash
    if (d.kind !== 'paint') {
      this.flash.position.copy(muzzle);
      const s = (d.kind === 'laser' ? 0.5 : heavy ? 1.1 : 0.7) * (fp ? 0.45 : 1);
      this.flash.scale.set(s, s, s);
      (this.flash.material as THREE.SpriteMaterial).color.setHex(d.kind === 'laser' ? d.tracer : 0xffd27a);
      this.flashT = 0.05;
    }
    const sfx: SfxName = d.kind === 'laser' ? 'laser' : d.kind === 'paint' ? 'paintball' : d.kind === 'confetti' ? 'confettiGun' : d.kind === 'shotgun' ? 'shotgun'
      : d.kind === 'smg' || d.kind === 'minigun' || d.kind === 'rifle' ? 'smg' : d.kind === 'cannon' || d.kind === 'sniper' || d.kind === 'revolver' ? 'gunHeavy' : 'gunshot';
    audio.play(sfx, { pitch: 0.94 + Math.random() * 0.12 });
    if (fp) {
      // Recoil: the view kicks up (aimed shots kick less), the gun punches back.
      const kick = (heavy ? 0.055 : d.auto ? 0.014 : 0.03) * (this.aiming ? 0.6 : 1);
      g.cam.kick += kick;
      g.cam.kickYaw += (Math.random() - 0.5) * kick * 0.6;
      this.vmKick = Math.min(1, this.vmKick + (heavy ? 1 : 0.5));
      g.cam.shake(heavy ? 0.05 : 0.012);
    } else g.cam.shake(d.kind === 'cannon' ? 0.1 : d.kind === 'shotgun' || d.kind === 'sniper' ? 0.07 : 0.025);
    // Where the bullets start and which way they go.
    const origin = fp ? g.renderer.camera.position.clone() : muzzle.clone();
    const base = fp ? g.cam.lookDir(new THREE.Vector3()) : new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // Accuracy: aimed shots are tight, running and spraying open it up.
    const acc = fp ? (this.aiming ? 0.25 : 0.85) * (1 + this.spreadK * 1.2) : 1;
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
      this.shootRay(d, origin, dir, muzzle, !fp);
    }
    this.spreadK = Math.min(1, this.spreadK + (d.auto ? 0.12 : 0.35));
    this.scareCrowd();
    g.events.emit('guns', undefined);
    if (this.ammoOf(d.id) <= 0) this.reload();
  }

  /**
   * Follow one bullet from `o` along `dir`: the nearest wall, ground, car, target or person
   * it meets. `flat` (top-down and third-person views) ignores heights, so whatever you
   * point at in the picture is what you hit.
   */
  private shootRay(d: GunDef, o: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, flat: boolean): void {
    const g = this.g;
    const st = g.street;
    const city = st.city;
    let best: Hit = { kind: 'air', t: d.range };
    // Walls and the ground: march until the bullet leaves the street or hits the pavement.
    for (let t = 0.3; t < d.range; t += 0.25) {
      const x = o.x + dir.x * t;
      const y = o.y + dir.y * t;
      const z = o.z + dir.z * t;
      if (y <= 0.02) {
        best = { kind: 'ground', t: dir.y < -1e-4 ? Math.max(0, (o.y - 0.02) / -dir.y) : t };
        break;
      }
      if (y < 60 && !st.isOutdoors(x, z)) {
        best = { kind: 'wall', t };
        break;
      }
    }
    const hlen = Math.hypot(dir.x, dir.z);
    const yAt = (t: number) => o.y + dir.y * t;
    const og = st.worldToGlobal(o.x, o.z);
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
      // Cars.
      const car = city.raycastCars(og.x, og.z, hx, hz, best.t * hlen);
      if (car) {
        const t = car.t / hlen;
        const y = yAt(t);
        if (t < best.t && (flat || (y > 0 && y < 1.55))) best = { kind: 'car', t, car: car.car };
      }
      // People on the sidewalks.
      for (const c of st.crowd.raycast(og.x, og.z, hx, hz, best.t * hlen)) {
        const t = c.s / hlen;
        const y = yAt(t);
        const h = c.ped.model.height;
        if (t < best.t && (flat || (y > 0 && y < h + 0.08))) {
          best = { kind: 'ped', t, ped: c.ped, head: !flat && y > h - 0.42 };
          break;
        }
      }
      // Other players out on the street (world frame).
      const wx = dir.x / hlen;
      const wz = dir.z / hlen;
      for (const r of g.combat.remoteTargets()) {
        const px = r.x - o.x;
        const pz = r.z - o.z;
        const s = px * wx + pz * wz;
        if (s < 0) continue;
        const t = s / hlen;
        if (t >= best.t) continue;
        if (Math.hypot(px - wx * s, pz - wz * s) > 0.36) continue;
        const y = yAt(t) - r.y;
        if (!flat && (y < 0 || y > r.height + 0.08)) continue;
        best = { kind: 'player', t, pid: r.pid, name: r.name, head: !flat && y > r.height - 0.42 };
      }
    }
    const t = best.t;
    const hit = new THREE.Vector3(o.x + dir.x * t, flat ? muzzle.y : o.y + dir.y * t, o.z + dir.z * t);
    const fx = g.effects;
    switch (best.kind) {
      case 'car': {
        if (best.car.shaken <= 0 && this.alarmT <= 0) {
          this.alarmT = 1.5;
          audio.playAt('carAlarm', hit.x, hit.z, 0.8);
        }
        city.hitCar(best.car);
        g.stats.carsHit++;
        fx.sparkle(hit.x, Math.max(0.5, hit.y), hit.z, 8, 0xfff2c8, 0.4);
        if (Math.random() < 0.4) audio.playAt('ricochet', hit.x, hit.z, 0.6);
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
        const dmg = d.dmg * (best.head ? 2 : 1);
        if (flat) hit.y = 1.2;
        if (d.kind === 'paint') this.splat(hit.x, hit.y, hit.z, -dir.x, -dir.z, true);
        if (dmg <= 0) break;
        const r = st.crowd.damage(best.ped, dmg, gdx, gdz);
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.landed(best.head, r.ko);
        if (r.ko) g.onStreetKnockout(r.cash, hit);
        break;
      }
      case 'player': {
        const dmg = d.dmg * (best.head ? 2 : 1);
        if (flat) hit.y = 1.2;
        if (dmg <= 0) break;
        fx.sparkle(hit.x, hit.y, hit.z, best.head ? 10 : 5, best.head ? 0xffe08a : 0xffffff, 0.25);
        g.floaters.text(hit.clone().setY(hit.y + 0.4), best.head ? `HEADSHOT ${Math.round(dmg)}` : `${Math.round(dmg)}`, best.head ? 'dmg head' : 'dmg', 0.9, 0.7);
        g.combat.onHitRemote?.(best.pid, Math.round(dmg));
        g.combat.landed(best.head, false);
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
    this.tracer(d, muzzle, hit);
  }

  private tracer(d: GunDef, a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    if (len < 0.2) return;
    const thick = d.kind === 'laser' ? 0.06 : d.kind === 'paint' || d.kind === 'confetti' ? 0.09 : 0.025;
    const geo = new THREE.BoxGeometry(thick, thick, len);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: d.kind === 'paint' ? SPLAT_COLORS[Math.floor(Math.random() * SPLAT_COLORS.length)] : d.tracer,
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    this.group.add(m);
    const life = d.kind === 'laser' ? 0.16 : d.kind === 'paint' || d.kind === 'confetti' ? 0.12 : 0.06;
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
    this.syncHeld();
  }
}
