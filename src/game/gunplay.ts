import * as THREE from 'three';
import type { Game } from './game';
import { type GunDef, gunDef } from './guns';
import { buildGun } from '../items/models/guns';
import { audio, type SfxName } from '../core/audio';
import { softDotTexture } from '../render/textures';

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

/**
 * Shooting out on the street: the gun in your hand, aiming (mouse on desktop, facing plus a
 * little auto-aim on touch), tracers, muzzle flashes, impacts on walls, cars, cans, bottles
 * and balloons. Guns stay holstered (and silent) inside any building.
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
    return g.state === 'playing' && !g.inside && p.floor === 0 && !p.seat && !g.photoMode && g.street.isOutdoors(p.x, p.z);
  }

  /** The gun is drawn and visible in your hand. */
  get drawn(): boolean {
    return !!this.def && this.canShoot;
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
    const pressed = !blocked && (input.mousePresses > 0 && !input.isTouch ? true : this.firePressed);
    const held = !blocked && ((input.mouseHeld && !input.isTouch && input.pointer.over) || this.fireHeld);
    this.firePressed = false;
    if (d && !blocked && input.hit('KeyR')) this.reload();
    if (this.held) {
      // Face the mouse while the gun is out (top camera).
      const pa = this.pointerAim();
      if (pa !== null && (held || pressed || this.aimHold > 0)) this.aimYaw = pa;
      if (held || pressed) this.aimHold = 0.6;
      this.aimHold = Math.max(0, this.aimHold - dt);
      if (this.aimHold > 0 && this.aimYaw !== null) g.player.yaw = this.aimYaw;
      if (this.held.spin) {
        this.spinV = Math.max(0, Math.min(30, this.spinV + (held ? 60 : -25) * dt));
        this.held.spin.rotation.z += this.spinV * dt;
      }
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
    let yaw = this.aimYaw !== null && this.aimHold > 0 ? this.aimYaw : p.yaw;
    if (g.input.isTouch || g.cam.mode === 'third') yaw = this.autoAim(p.yaw, d.range);
    p.yaw = yaw;
    p.model.root.rotation.y = yaw;
    p.model.recoil = d.kind === 'cannon' || d.kind === 'shotgun' || d.kind === 'sniper' ? 1 : 0.45;
    p.model.update(0);
    p.model.root.updateMatrixWorld(true);
    const muzzle = this.held ? this.held.group.localToWorld(this.held.muzzle.clone()) : new THREE.Vector3(p.x + Math.sin(yaw) * 0.6, 1.3, p.z + Math.cos(yaw) * 0.6);
    // Muzzle flash
    if (d.kind !== 'paint') {
      this.flash.position.copy(muzzle);
      const s = d.kind === 'laser' ? 0.5 : d.kind === 'cannon' || d.kind === 'shotgun' ? 1.1 : 0.7;
      this.flash.scale.set(s, s, s);
      (this.flash.material as THREE.SpriteMaterial).color.setHex(d.kind === 'laser' ? d.tracer : 0xffd27a);
      this.flashT = 0.05;
    }
    const sfx: SfxName = d.kind === 'laser' ? 'laser' : d.kind === 'paint' ? 'paintball' : d.kind === 'confetti' ? 'confettiGun' : d.kind === 'shotgun' ? 'shotgun'
      : d.kind === 'smg' || d.kind === 'minigun' || d.kind === 'rifle' ? 'smg' : d.kind === 'cannon' || d.kind === 'sniper' || d.kind === 'revolver' ? 'gunHeavy' : 'gunshot';
    audio.play(sfx, { pitch: 0.94 + Math.random() * 0.12 });
    g.cam.shake(d.kind === 'cannon' ? 0.1 : d.kind === 'shotgun' || d.kind === 'sniper' ? 0.07 : 0.025);
    for (let i = 0; i < d.pellets; i++) {
      const a = yaw + (Math.random() - 0.5) * 2 * d.spread;
      this.shootRay(d, muzzle, Math.sin(a), Math.cos(a));
    }
    this.scareCrowd();
    g.events.emit('guns', undefined);
    if (this.ammoOf(d.id) <= 0) this.reload();
  }

  /** Follow one bullet: the first wall, car or target it meets. */
  private shootRay(d: GunDef, from: THREE.Vector3, dx: number, dz: number): void {
    const g = this.g;
    const st = g.street;
    const city = st.city;
    // Walls: march until the bullet leaves the street network.
    let wallT = d.range;
    for (let t = 0.6; t < d.range; t += 0.3) {
      if (!st.isOutdoors(from.x + dx * t, from.z + dz * t)) {
        wallT = t;
        break;
      }
    }
    const og = st.worldToGlobal(from.x, from.z);
    const flip = st.placeOf(st.activeId).side === 1;
    const gdx = flip ? -dx : dx;
    const gdz = flip ? -dz : dz;
    const tg = city.raycastTargets(og.x, og.z, gdx, gdz, wallT);
    const car = city.raycastCars(og.x, og.z, gdx, gdz, tg ? tg.t : wallT);
    const t = car ? car.t : tg ? tg.t : wallT;
    const hit = new THREE.Vector3(from.x + dx * t, from.y, from.z + dz * t);
    const fx = g.effects;
    if (car) {
      if (car.car.shaken <= 0 && this.alarmT <= 0) {
        this.alarmT = 1.5;
        audio.playAt('carAlarm', hit.x, hit.z, 0.8);
      }
      city.hitCar(car.car);
      g.stats.carsHit++;
      fx.sparkle(hit.x, 1, hit.z, 8, 0xfff2c8, 0.4);
      if (Math.random() < 0.4) audio.playAt('ricochet', hit.x, hit.z, 0.6);
    } else if (tg) {
      const k = tg.target.kind;
      const y = tg.target.home.y;
      city.hitTarget(tg.target, gdx, gdz);
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
    } else if (wallT < d.range) {
      fx.sparkle(hit.x, 1.1, hit.z, d.kind === 'shotgun' ? 3 : 6, d.kind === 'laser' ? d.tracer : 0xffe2a8, 0.25);
      if (d.kind !== 'paint' && d.kind !== 'confetti') fx.smoke(hit.x, 1.1, hit.z, 1);
      if (d.kind === 'paint') this.splat(hit.x, 1 + Math.random() * 0.8, hit.z, -dx, -dz, true);
      if (Math.random() < 0.15) audio.playAt('ricochet', hit.x, hit.z, 0.5);
    } else if (d.kind === 'paint') {
      this.splat(from.x + dx * d.range * 0.7, 0.02, from.z + dz * d.range * 0.7, 0, 0, false);
    }
    if (d.kind === 'confetti') fx.confetti(hit.x, Math.max(1, hit.y), hit.z, 70, 0.9);
    this.tracer(d, from, hit);
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
