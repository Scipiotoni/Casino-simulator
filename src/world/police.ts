import * as THREE from 'three';
import { CharacterModel } from '../entities/characterModel';
import { defaultAppearance, SKIN_TONES, type Appearance } from '../entities/appearance';
import { Car } from './cityView';
import { AVE_W, ROAD_HALF, STREET_ROWS, avenueX, blocksFor, cityX, openGround, streetZ } from './city';
import { buildGun } from '../items/models/guns';
import { gunDef } from '../game/guns';
import { audio } from '../core/audio';
import { softDotTexture } from '../render/textures';

/** How many officers come for you at each wanted level (0–5 stars). */
const OFFICERS = [0, 2, 3, 5, 6, 8];
/** Heat added by each crime (stars = whole heat). */
export const HEAT = { hitPerson: 0.5, knockout: 1, hitCop: 0.6, koCop: 1.5, car: 0.15 };
const MAX_HEAT = 5.99;

export interface Officer {
  model: CharacterModel;
  x: number;
  z: number;
  hp: number;
  /** Seconds lying knocked out (then gone). */
  ko: number;
  swat: boolean;
  cool: number;
  /** Stuck-avoidance: sidestep this way for a while. */
  side: number;
  sideT: number;
  /** Walking off (the chase is over). */
  leaving: number;
  fade: number;
}

interface Cruiser {
  car: Car;
  bar: THREE.Group;
  red: THREE.Mesh;
  blue: THREE.Mesh;
  x: number;
  z: number;
  axis: 'x' | 'z';
  dir: 1 | -1;
  /** Where it pulls up (along its axis). */
  stopAt: number;
  speed: number;
  parked: boolean;
  /** Driving away (the chase is over). */
  leaving: boolean;
  sirenT: number;
  t: number;
}

/** Things the police need to know about you each frame (global frame). */
export interface PoliceView {
  /** You, on the city grid. */
  px: number;
  pz: number;
  /** Out on the street where they can see and shoot you. */
  exposed: boolean;
  speed: number;
  /** How tall you are (they aim for the chest). */
  height: number;
  /** Turn a global point into the world frame (for sounds and effects). */
  toWorld: (gx: number, gz: number) => { x: number; z: number };
  /** An officer shot at you; `hit` says if it landed. */
  onShot: (hit: boolean, dmg: number, fromGx: number, fromGz: number) => void;
  /** A shot from an officer, for tracers and flashes (global frame). */
  onTracer: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void;
}

function copLook(swat: boolean): Appearance {
  const a = defaultAppearance();
  a.skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
  a.top = swat ? 'jacket' : 'suit';
  a.topColor = swat ? 0x1a1b20 : 0x1d2a5a;
  a.accentColor = swat ? 0x2a2c33 : 0xbfc8e8;
  a.bottom = 'pants';
  a.bottomColor = swat ? 0x15161a : 0x16203f;
  a.shoeColor = 0x0d0d10;
  a.hat = swat ? 'hardhat' : 'cap';
  a.hatColor = swat ? 0x1a1b20 : 0x1d2a5a;
  a.neck = swat ? 'none' : 'tie';
  a.neckColor = 0x0d0d10;
  a.eyewear = swat || Math.random() < 0.4 ? 'aviators' : 'none';
  a.facialHair = Math.random() < 0.3 ? 'mustache' : 'none';
  a.hair = Math.random() < 0.5 ? 'buzz' : 'short';
  a.prop = 'none';
  a.blush = false;
  return a;
}

/**
 * The city police. Shoot people out on the street and you get a wanted level (1–5 stars):
 * officers run at you from down the sidewalk, cruisers race in with sirens and lights
 * and drop off more, and from four stars SWAT turns up with rifles. They shoot when they
 * can see you. Stay out of sight (duck into a building) and the stars fade; get knocked
 * out by them and you're busted and fined. All in the city's global frame.
 */
export class Police {
  readonly group = new THREE.Group();
  heat = 0;
  officers: Officer[] = [];
  private cruisers: Cruiser[] = [];
  /** Seconds since any officer last saw you. */
  sinceSeen = 99;
  /** Seconds since your last crime. */
  sinceCrime = 99;
  private spawnT = 0;
  private flash: THREE.Sprite | null = null;
  private flashT = 0;
  cols = 12;

  /** Muzzle flash (made on the first shot: textures need a browser). */
  private flashSprite(): THREE.Sprite {
    if (!this.flash) {
      this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      this.flash.scale.setScalar(0.7);
      this.group.add(this.flash);
    }
    return this.flash;
  }

  get stars(): number {
    return Math.min(5, Math.floor(this.heat));
  }

  /** Police can see you right now (their lights flash on your HUD). */
  get spotted(): boolean {
    return this.stars > 0 && this.sinceSeen < 1.5;
  }

  /** A crime: the heat goes up (and never less than one star for hurting someone). */
  crime(amount: number, serious = true): void {
    const before = this.stars;
    this.heat = Math.min(MAX_HEAT, this.heat + amount);
    if (serious && this.heat < 1) this.heat = 1;
    this.sinceCrime = 0;
    this.sinceSeen = 0;
    if (this.stars > before) this.spawnT = Math.min(this.spawnT, 0.5);
  }

  /** Busted (or a new game): everyone goes home. */
  clear(): void {
    this.heat = 0;
    for (const o of this.officers) if (o.ko <= 0) o.leaving = Math.max(o.leaving, 0.01);
    for (const c of this.cruisers) c.leaving = true;
  }

  /** Remove everybody at once. */
  reset(): void {
    this.heat = 0;
    for (const o of this.officers) o.model.dispose();
    for (const c of this.cruisers) c.car.root.removeFromParent();
    this.officers = [];
    this.cruisers = [];
  }

  private out(x: number, z: number): boolean {
    return openGround(x, z, this.cols);
  }

  /** Nothing but street between two points (buildings block the view and bullets). */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.out(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A sidewalk spot about `dist` away from you, preferably out of sight. */
  private spawnSpot(px: number, pz: number, dist: number): { x: number; z: number } | null {
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = dist * (0.85 + Math.random() * 0.3);
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      if (!this.out(x, z)) continue;
      if (k < 16 && this.lineOfSight(px, pz, x, z) && r < 30) continue;
      return { x, z };
    }
    return null;
  }

  private addOfficer(x: number, z: number, swat: boolean): void {
    const model = new CharacterModel(copLook(swat), { castShadow: false });
    const gun = buildGun(gunDef(swat ? 'rifle' : 'pistol')!);
    model.hand.add(gun.group);
    model.aim = swat ? 2 : 1;
    model.root.position.set(x, 0, z);
    this.group.add(model.root);
    this.officers.push({ model, x, z, hp: swat ? 150 : 90, ko: 0, swat, cool: 1 + Math.random(), side: 1, sideT: 0, leaving: 0, fade: 0 });
  }

  /** A cruiser races in along the nearest road and pulls up near you. */
  private addCruiser(px: number, pz: number): boolean {
    // Nearest road: a street (east–west) or an avenue (north–south).
    let best: { axis: 'x' | 'z'; line: number; d: number } | null = null;
    for (let r = 0; r < STREET_ROWS; r++) {
      const d = Math.abs(streetZ(r) - pz);
      if (!best || d < best.d) best = { axis: 'x', line: streetZ(r), d };
    }
    for (let k = 0; k <= blocksFor(this.cols); k++) {
      const [a, b] = avenueX(k);
      const mid = (a + b) / 2;
      const d = Math.abs(mid - px);
      if (!best || d < best.d) best = { axis: 'z', line: mid, d };
    }
    if (!best || best.d > 40) return false;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const lane = (best.axis === 'x' ? ROAD_HALF : AVE_W / 2 - 1.5) * 0.45 * (dir > 0 ? 1 : -1);
    const along = best.axis === 'x' ? px : pz;
    let start = along - dir * 70;
    if (best.axis === 'x') {
      const [x0, x1] = cityX(this.cols);
      start = Math.max(x0 + 2, Math.min(x1 - 2, start));
    }
    const car = new Car(0, 0xf4f4f6);
    // Navy doors and a light bar on the roof.
    const navy = new THREE.MeshStandardMaterial({ color: 0x1d2a5a, roughness: 0.35, metalness: 0.4 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.42, 2.0), navy);
    door.position.set(0, 0.62, 0.1);
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.28), new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.28), new THREE.MeshBasicMaterial({ color: 0x2a6bff, toneMapped: false }));
    red.position.x = -0.32;
    blue.position.x = 0.32;
    bar.add(red, blue);
    bar.position.set(0, 1.72, -0.2);
    car.root.add(door, bar);
    const x = best.axis === 'x' ? start : best.line + lane;
    const z = best.axis === 'x' ? best.line + lane : start;
    car.root.position.set(x, 0, z);
    car.root.rotation.y = best.axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    this.group.add(car.root);
    this.cruisers.push({ car, bar, red, blue, x, z, axis: best.axis, dir, stopAt: along - dir * (7 + Math.random() * 5), speed: 18, parked: false, leaving: false, sirenT: 0, t: 0 });
    return true;
  }

  /** Officers standing in a bullet's way (global frame, unit direction), nearest first. */
  raycast(ox: number, oz: number, dx: number, dz: number, maxS: number): { cop: Officer; s: number }[] {
    const out: { cop: Officer; s: number }[] = [];
    for (const o of this.officers) {
      if (o.ko > 0 || o.fade > 0) continue;
      const px = o.x - ox;
      const pz = o.z - oz;
      const s = px * dx + pz * dz;
      if (s < 0.2 || s > maxS) continue;
      if (Math.hypot(px - dx * s, pz - dz * s) < 0.36) out.push({ cop: o, s });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /** You shot an officer. Returns true if they went down. */
  damage(o: Officer, dmg: number): boolean {
    if (o.ko > 0) return false;
    o.hp -= dmg;
    o.model.flinch = 1;
    if (o.hp > 0) {
      this.crime(HEAT.hitCop);
      return false;
    }
    o.ko = 10;
    o.model.aim = 0;
    o.model.setPose('ko');
    this.crime(HEAT.koCop);
    return true;
  }

  update(dt: number, v: PoliceView, visible: boolean): void {
    this.group.visible = visible;
    this.sinceCrime += dt;
    this.sinceSeen += dt;
    this.flashT -= dt;
    if (this.flash) this.flash.visible = this.flashT > 0;
    const stars = this.stars;
    // Out of sight long enough and the heat cools off (faster while you hide indoors).
    if (this.heat > 0 && this.sinceSeen > 10 && this.sinceCrime > 10) {
      this.heat = Math.max(0, this.heat - dt * (v.exposed ? 0.12 : 0.3));
      if (this.heat === 0) this.clear();
    }
    // Reinforcements
    const active = this.officers.filter((o) => o.ko <= 0 && !o.leaving).length;
    this.spawnT -= dt;
    if (stars > 0 && v.exposed && this.spawnT <= 0 && active < OFFICERS[stars]) {
      this.spawnT = stars >= 2 ? 4 : 6;
      const parked = this.cruisers.filter((c) => !c.leaving).length;
      if (stars >= 2 && parked < Math.ceil(stars / 2) && this.addCruiser(v.px, v.pz)) {
        // Officers jump out when it pulls up.
      } else {
        const at = this.spawnSpot(v.px, v.pz, 34);
        if (at) this.addOfficer(at.x, at.z, stars >= 4 && Math.random() < 0.6);
      }
    }
    this.updateCruisers(dt, v, stars);
    this.updateOfficers(dt, v);
  }

  private updateCruisers(dt: number, v: PoliceView, stars: number): void {
    for (let i = this.cruisers.length - 1; i >= 0; i--) {
      const c = this.cruisers[i];
      c.t += dt;
      // Lights flash red / blue.
      const ph = Math.floor(c.t * 6) % 2 === 0;
      c.red.visible = ph || c.leaving;
      c.blue.visible = !ph || c.leaving;
      const pos = c.axis === 'x' ? c.x : c.z;
      if (c.leaving) {
        c.speed = Math.min(14, c.speed + dt * 6);
      } else if (!c.parked) {
        const left = (c.stopAt - pos) * c.dir;
        c.speed = left < 12 ? Math.max(0, left * 1.4) : 18;
        if (left <= 0.3) {
          c.parked = true;
          c.speed = 0;
          // Two officers get out (one SWAT from four stars).
          for (let k = 0; k < 2; k++) {
            const off = (k ? 1.6 : -1.6);
            const ox = c.axis === 'x' ? c.x + (k ? 1 : -1) : c.x + off;
            const oz = c.axis === 'x' ? c.z + off : c.z + (k ? 1 : -1);
            this.addOfficer(ox, oz, stars >= 4 && k === 0);
          }
          audio.playAt('doorbell', v.toWorld(c.x, c.z).x, v.toWorld(c.x, c.z).z, 0.2);
        }
      }
      const step = c.speed * dt * c.dir;
      if (c.axis === 'x') c.x += step;
      else c.z += step;
      c.car.root.position.set(c.x, 0, c.z);
      c.sirenT -= dt;
      if (c.sirenT <= 0 && !c.leaving && (!c.parked || c.t < 12)) {
        c.sirenT = 1.1;
        const w = v.toWorld(c.x, c.z);
        audio.playAt('siren', w.x, w.z, 0.9);
      }
      const far = Math.hypot(c.x - v.px, c.z - v.pz) > 120;
      if ((c.leaving && far) || (c.leaving && c.t > 40)) {
        c.car.root.removeFromParent();
        this.cruisers.splice(i, 1);
      } else if (c.parked && c.leaving) {
        c.parked = false;
      }
    }
  }

  private updateOfficers(dt: number, v: PoliceView): void {
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      const m = o.model;
      if (o.ko > 0) {
        o.ko -= dt;
        if (o.ko < 1.2) m.root.scale.setScalar(Math.max(0.01, o.ko / 1.2));
        m.setPose('ko');
        m.update(dt);
        if (o.ko <= 0) {
          m.dispose();
          this.officers.splice(i, 1);
        }
        continue;
      }
      const dx = v.px - o.x;
      const dz = v.pz - o.z;
      const dist = Math.hypot(dx, dz);
      if (this.heat <= 0 && !o.leaving) o.leaving = 0.01;
      if (o.leaving > 0) {
        // Walk away and fade out.
        o.leaving += dt;
        const k = Math.min(1, o.leaving / 6);
        m.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, k - 0.6) / 0.4));
        if (dist > 0.1) this.walk(o, -dx / dist, -dz / dist, 1.6 * dt);
        m.setPose('walk');
        m.moveSpeed = 1.2;
        m.update(dt);
        if (o.leaving >= 6 || dist > 110) {
          m.dispose();
          this.officers.splice(i, 1);
        }
        continue;
      }
      const sees = v.exposed && dist < 45 && this.lineOfSight(o.x, o.z, v.px, v.pz);
      if (sees) this.sinceSeen = 0;
      // Close in until they have a clear shot, then hold position and fire.
      const want = sees ? (o.swat ? 9 : 7) : 1.5;
      let moving = false;
      if (dist > want && dist > 0.1) {
        const sp = (sees ? 3.4 : 4.6) * dt;
        moving = this.walk(o, dx / dist, dz / dist, sp);
      }
      m.root.rotation.y = Math.atan2(dx, dz);
      m.root.position.set(o.x, 0, o.z);
      m.setPose(moving ? 'run' : 'idle');
      m.moveSpeed = 2.4;
      m.aim = o.swat ? 2 : 1;
      o.cool -= dt;
      if (sees && dist < 32 && o.cool <= 0) this.fire(o, v, dist);
      m.update(dt);
    }
  }

  /** Step toward (dx, dz), sliding along buildings and sidestepping when stuck. */
  private walk(o: Officer, dx: number, dz: number, step: number): boolean {
    const tryMove = (ax: number, az: number) => {
      const nx = o.x + ax * step;
      const nz = o.z + az * step;
      if (!this.out(nx, nz)) return false;
      o.x = nx;
      o.z = nz;
      return true;
    };
    if (o.sideT > 0) {
      o.sideT -= step;
      if (tryMove(-dz * o.side, dx * o.side)) return true;
    }
    if (tryMove(dx, dz)) return true;
    if (Math.abs(dx) > 0.1 && tryMove(Math.sign(dx), 0)) return true;
    if (Math.abs(dz) > 0.1 && tryMove(0, Math.sign(dz))) return true;
    o.side = Math.random() < 0.5 ? 1 : -1;
    o.sideT = 3;
    return tryMove(-dz * o.side, dx * o.side);
  }

  private fire(o: Officer, v: PoliceView, dist: number): void {
    o.cool = o.swat ? 0.35 + Math.random() * 0.3 : 0.9 + Math.random() * 0.7;
    o.model.recoil = o.swat ? 0.5 : 0.7;
    // Harder to hit you far away or on the run.
    const chance = Math.max(0.12, Math.min(0.7, 0.72 - dist * 0.018 - v.speed * 0.05));
    const hit = Math.random() < chance;
    const dmg = o.swat ? 9 : 7;
    const ay = 1.25;
    const fx = o.x + Math.sin(o.model.root.rotation.y) * 0.7;
    const fz = o.z + Math.cos(o.model.root.rotation.y) * 0.7;
    const miss = hit ? 0 : 0.6 + Math.random() * 1.2;
    const side = Math.random() < 0.5 ? 1 : -1;
    const tx = v.px + (dist > 0 ? (-(v.pz - o.z) / dist) * miss * side : 0);
    const tz = v.pz + (dist > 0 ? ((v.px - o.x) / dist) * miss * side : 0);
    this.flashSprite().position.set(fx, ay, fz);
    this.flashT = 0.05;
    v.onTracer(fx, ay, fz, tx, hit ? v.height * 0.7 : 0.4 + Math.random() * 1.4, tz);
    const w = v.toWorld(o.x, o.z);
    audio.playAt(o.swat ? 'smg' : 'gunshot', w.x, w.z, 0.8);
    v.onShot(hit, hit ? dmg : 0, o.x, o.z);
  }

  /** Officers for the minimap (global frame). */
  get dots(): { x: number; z: number; car: boolean }[] {
    return [
      ...this.officers.filter((o) => o.ko <= 0 && !o.leaving).map((o) => ({ x: o.x, z: o.z, car: false })),
      ...this.cruisers.map((c) => ({ x: c.x, z: c.z, car: true })),
    ];
  }
}
