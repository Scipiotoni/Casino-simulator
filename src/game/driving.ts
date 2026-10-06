import * as THREE from 'three';
import type { Game } from './game';
import { type CarDef, type CarMods, DEALER_CARS, STOLEN_SPECS, buildCar, carDef, carHp, carWidth, defaultMods, engineOf, repairCost, sanitizeMods, tunedSpecs } from '../world/vehicles';
import { Car, rayBox } from '../world/cityView';
import { GARAGE_W, GarageModel } from '../world/garage';
import { CENTER_X, FACADE_Z, SIDEWALK_Z0, WIDTHS } from '../world/grid';
import { type ParkedCar, garageTier } from './house';
import { AVE_W, ROAD_HALF, STREET_ROWS, avenueX, blocksFor, openGround, streetZ } from '../world/city';
import { HEAT } from '../world/police';
import { audio } from '../core/audio';
import { clamp, damp, formatMoney } from '../core/math';
import { GEARS, autoGear, drive, gearTop, rpmOf } from './gearbox';

/** A car on the street you can get into (yours, or one you took). Global frame. */
export interface Vehicle {
  uid: number;
  /** Bought at Velocity Motors (null = taken out of traffic). */
  def: CarDef | null;
  name: string;
  color: number;
  root: THREE.Object3D;
  wheels: THREE.Object3D[];
  front: THREE.Object3D[];
  open: boolean;
  seat: THREE.Vector3;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  steer: number;
  length: number;
  width: number;
  owned: boolean;
  /** Was stolen from traffic (the police care). */
  stolen: boolean;
  /** Your customization and tuning (null for stolen cars). */
  mods: CarMods | null;
  flames: THREE.Object3D[];
  brakeLights: THREE.Mesh[];
  /** A traffic car you took (its body and paint), so it can be kept in your garage. */
  kept?: { kind: number; color: number };
  /** Durability left (0 = blown up), out of `maxHp`. */
  hp: number;
  maxHp: number;
  /** Share of bullet damage that gets through. */
  armor: number;
  /** Seconds since it blew up (-1 while it's in one piece). */
  wreck: number;
  /** Seconds it keeps burning (a wreck, or a car about to go up). */
  burnT: number;
  /** A tank's turret and muzzle, and its reload. */
  turret?: THREE.Object3D;
  muzzle?: THREE.Object3D;
  cannonT?: number;
  /** Roof lights that flash with the siren. */
  beacons?: THREE.Mesh[];
  /** Parked at the military base (taking it sets off the alarm). */
  base?: boolean;
}

/** What a bullet or blast can hit: a traffic car, a police cruiser or a car on the street. */
export interface CarTarget {
  t: number;
  traffic?: Car;
  cruiser?: Car;
  v?: Vehicle;
}

/** Damage to a car from a crash at `speed` (m/s); heavy armour soaks most of it. */
export function crashDamage(speed: number, armor = 1): number {
  if (speed < 4) return 0;
  return (speed - 4) * 1.8 * (armor < 0.5 ? 0.35 : 1);
}

/** How much of a gun's damage gets through to a car's bodywork. */
export function shotDamage(gunDmg: number, armor = 1): number {
  return gunDmg * 0.4 * armor;
}

/** Cars you own (saved). */
export interface GarageState {
  owned: string[];
  colors: Record<string, number>;
  /** Customization and tuning per car you own. */
  mods: Record<string, CarMods>;
  /** Condition of damaged cars you own (0 = wrecked .. 1; missing = like new). */
  hp?: Record<string, number>;
}

export function emptyGarage(): GarageState {
  return { owned: [], colors: {}, mods: {}, hp: {} };
}

/** How much of a car you own is left (1 = like new, 0 = wrecked). */
export function conditionOf(gs: GarageState, id: string): number {
  const v = gs.hp?.[id];
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1;
}

/** A car's mods (made from its defaults the first time). */
export function modsOf(gs: GarageState, id: string): CarMods {
  const def = carDef(id)!;
  gs.mods[id] ??= defaultMods(def, gs.colors[id]);
  return gs.mods[id];
}

export function sanitizeGarage(raw: unknown): GarageState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const owned = Array.isArray(r.owned) ? [...new Set(r.owned.filter((x): x is string => typeof x === 'string' && !!carDef(x)))] : [];
  const colors: Record<string, number> = {};
  if (r.colors && typeof r.colors === 'object') {
    for (const [k, v] of Object.entries(r.colors as Record<string, unknown>)) {
      if (carDef(k) && typeof v === 'number' && Number.isFinite(v)) colors[k] = Math.max(0, Math.min(0xffffff, Math.round(v)));
    }
  }
  const mods: Record<string, CarMods> = {};
  if (r.mods && typeof r.mods === 'object') {
    for (const [k, v] of Object.entries(r.mods as Record<string, unknown>)) {
      const d = carDef(k);
      if (d) mods[k] = sanitizeMods(d, v);
    }
  }
  const hp: Record<string, number> = {};
  if (r.hp && typeof r.hp === 'object') {
    for (const [k, v] of Object.entries(r.hp as Record<string, unknown>)) {
      if (carDef(k) && typeof v === 'number' && Number.isFinite(v) && v < 1) hp[k] = Math.max(0, v);
    }
  }
  return { owned, colors, mods, hp };
}

let nextUid = 1;

/**
 * Cars: buy them at Velocity Motors, have them brought to you, steal any car out of the
 * traffic, and drive them around the city (W/S gas and brake, A/D steer, Space gets out).
 * Crash into buildings and traffic, run people over (the police won't like it).
 */
export class Driving {
  readonly group = new THREE.Group();
  vehicles: Vehicle[] = [];
  driving: Vehicle | null = null;
  private prevCam: { mode: 'top' | 'third' | 'first'; dist: number } | null = null;
  private crashT = 0;
  /** Nitro tank (0..1). */
  nitro = 1;
  private engineT = 0;
  /** Gear you're in (1–5); 0 while reversing. */
  gear = 1;
  /** Shifting yourself (Q/E) instead of the automatic. */
  manual = false;
  /** Engine revs, 0..1 of the limiter (for the dial and the engine note). */
  rpm = 0;
  /** Seconds left in a gear change (no drive meanwhile). */
  private shiftT = 0;
  private limiterT = 0;
  private lastGear = 1;
  private prevThrottle = 0;
  /** Tyre squeal (0..1), smoothed for the sound. */
  private skid = 0;
  /** Tank shells in flight (global frame). */
  private shells: { x: number; z: number; tx: number; tz: number; t: number; dur: number; mesh: THREE.Mesh }[] = [];

  constructor(private g: Game) {}

  private get cols(): number {
    return this.g.street.cols;
  }

  /** Can this spot (global) take a car? */
  private fits(x: number, z: number, yaw: number, len: number, wid: number): boolean {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = fz;
    const rz = -fx;
    for (const [a, b] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5], [0, 0]]) {
      const px = x + fx * len * a + rx * wid * b;
      const pz = z + fz * len * a + rz * wid * b;
      if (!openGround(px, pz, this.cols) && !this.inGarage(px, pz)) return false;
    }
    return true;
  }

  /** A curbside spot on the nearest road (global), lined up with it. */
  private roadSpot(px: number, pz: number, len: number): { x: number; z: number; yaw: number } | null {
    const cands: { x: number; z: number; yaw: number; d: number }[] = [];
    for (let r = 0; r < STREET_ROWS; r++) {
      for (const side of [-1, 1]) {
        const z = streetZ(r) + side * ROAD_HALF * 0.55;
        cands.push({ x: px, z, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, d: Math.abs(z - pz) });
      }
    }
    for (let k = 0; k <= blocksFor(this.cols); k++) {
      const [a, b] = avenueX(k);
      for (const side of [-1, 1]) {
        const x = (a + b) / 2 + side * (AVE_W / 2 - 2.2);
        cands.push({ x, z: pz, yaw: side > 0 ? Math.PI : 0, d: Math.abs(x - px) });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 6)) {
      for (const off of [0, 3, -3, 6, -6, 10, -10, 15, -15]) {
        const x = c.x + (Math.abs(Math.sin(c.yaw)) > 0.5 ? off : 0);
        const z = c.z + (Math.abs(Math.sin(c.yaw)) > 0.5 ? 0 : off);
        // Not on top of you, nor another car.
        if (Math.hypot(x - px, z - pz) < len / 2 + 1.5) continue;
        if (this.fits(x, z, c.yaw, len, 2.2) && !this.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 5)) return { x, z, yaw: c.yaw };
      }
    }
    return null;
  }

  private playerGlobal(): { x: number; z: number } {
    const p = this.g.player;
    return this.g.street.worldToGlobal(p.x, p.z);
  }

  /** Have one of your cars brought to the nearest curb. */
  bring(id: string): boolean {
    const g = this.g;
    const def = carDef(id);
    if (!def || !g.garage.owned.includes(id)) return false;
    if (g.inside || g.player.floor > 0) {
      g.notify('Step out onto the street first: your car comes to the curb.', 'bad');
      return false;
    }
    if (conditionOf(g.garage, id) <= 0) {
      audio.play('error');
      g.notify(`Your ${def.name} is wrecked. Get it repaired first (${formatMoney(repairCost(def))}, 10% of its price) from My cars.`, 'bad');
      return false;
    }
    if (this.driving) this.exit();
    const pg = this.playerGlobal();
    const mods = modsOf(g.garage, id);
    const color = mods.color;
    const probe = buildCar(def, undefined, mods);
    const spot = this.roadSpot(pg.x, pg.z, probe.length);
    if (!spot) {
      g.notify('No room at the curb here. Try somewhere else.', 'bad');
      return false;
    }
    // Only one of each of your cars on the street at a time.
    const old = this.vehicles.find((v) => v.owned && v.def?.id === id);
    if (old) this.remove(old);
    const v = this.addVehicle(def, probe, color, spot.x, spot.z, spot.yaw, true, false, mods);
    // It leaves the garage if it was parked there.
    if (g.house) g.house.parked = g.house.parked.filter((p) => p.id !== id);
    audio.play('honk');
    g.notify(`Your ${def.name} is at the curb. Walk up to it and press Space.`, 'good');
    return !!v;
  }

  /** Put a vehicle on the street (global frame); used by the military base too. */
  addVehicle(def: CarDef, m: ReturnType<typeof buildCar>, color: number, x: number, z: number, yaw: number, owned: boolean, stolen: boolean, mods: CarMods | null = null): Vehicle {
    m.root.position.set(x, 0, z);
    m.root.rotation.y = yaw;
    this.group.add(m.root);
    const v: Vehicle = {
      uid: nextUid++, def, name: def.name, color, root: m.root, wheels: m.wheels, front: m.front, open: m.open, seat: m.seat,
      x, z, yaw, speed: 0, steer: 0, length: m.length, width: def.kind === 'truck' ? 2.3 : carWidth(def), owned, stolen, mods, flames: m.flames, brakeLights: m.brakeLights,
      hp: carHp(def), maxHp: carHp(def), armor: def.armor ?? 1, wreck: -1, burnT: 0, turret: m.turret, muzzle: m.muzzle, cannonT: 0, beacons: m.beacons,
    };
    // Your own cars keep their damage until you pay to have them fixed.
    if (owned) v.hp = Math.max(1, Math.round(v.maxHp * conditionOf(this.g.garage, def.id)));
    this.vehicles.push(v);
    return v;
  }

  private remove(v: Vehicle): void {
    if (this.driving === v) this.exit();
    v.root.removeFromParent();
    this.vehicles = this.vehicles.filter((o) => o !== v);
  }

  /** Take a car out of the traffic. */
  steal(c: Car): void {
    const g = this.g;
    g.street.city.releaseCar(c);
    const v: Vehicle = {
      uid: nextUid++, def: null, name: 'stolen car', color: 0, root: c.root, wheels: [], front: [], open: false, seat: new THREE.Vector3(-0.38, 0.8, 0),
      x: c.x, z: c.z, yaw: c.yaw, speed: 0, steer: 0, length: c.length, width: 2, owned: false, stolen: true, mods: null, flames: [], brakeLights: [],
      kept: { kind: c.kind, color: c.color }, hp: c.hp, maxHp: c.maxHp, armor: 1, wreck: -1, burnT: 0,
    };
    this.vehicles.push(v);
    g.street.police.crime(HEAT.knockout);
    g.stats.carsStolen = (g.stats.carsStolen ?? 0) + 1;
    audio.play('carAlarm');
    g.notify('You stole a car! The police are on their way.', 'bad');
    this.enter(v);
  }

  /** Jump into a police cruiser that's stopped and take it (that's a lot of heat). */
  stealCruiser(c: Car): void {
    const g = this.g;
    const pol = g.street.police;
    const def = carDef('police');
    if (!def || !pol.dropCruiser(c)) return;
    const x = c.root.position.x;
    const z = c.root.position.z;
    const yaw = c.root.rotation.y;
    c.root.removeFromParent();
    const v = this.addVehicle(def, buildCar(def), def.colors[0], x, z, yaw, false, true);
    pol.crime(HEAT.copCar);
    g.stats.carsStolen = (g.stats.carsStolen ?? 0) + 1;
    audio.play('siren');
    g.notify('You stole a police cruiser! C works the siren. Hide it in your garage to keep it.', 'bad');
    this.enter(v);
    this.siren = true;
  }

  /** Siren on (police cruiser you took). */
  siren = false;
  private sirenT = 0;

  enter(v: Vehicle): void {
    const g = this.g;
    if (v.wreck >= 0 || g.combat.ko > 0) return;
    g.stopActivity();
    g.standUp();
    if (g.build.active) g.build.cancel();
    this.driving = v;
    v.speed = 0;
    this.gear = 1;
    if (!this.prevCam) this.prevCam = { mode: g.cam.mode, dist: g.cam.distTarget };
    g.setCameraMode('third', false);
    g.cam.setThirdDist(v.def?.kind === 'tank' ? 13 : v.length > 6 ? 11 : 8.5);
    audio.play('doorbell', { pitch: 0.6 });
    audio.play('ignition', { pitch: v.def?.kind === 'tank' ? 0.6 : 1, volume: 0.8 });
    if (v.base) {
      g.stats.baseRaids = (g.stats.baseRaids ?? 0) + 1;
      g.base.vehicleTaken(v.name);
    }
    v.base = false;
    g.events.emit('driving', undefined);
  }

  /** Get out on the driver's side (or wherever there's room). */
  exit(): void {
    const g = this.g;
    const v = this.driving;
    if (!v) return;
    this.driving = null;
    v.speed = 0;
    audio.engine(null);
    this.siren = false;
    v.beacons?.forEach((b) => (b.visible = true));
    g.player.seat = null;
    g.player.emote = null;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const spots = [[-fz, fx, 1.8], [fz, -fx, 1.8], [-fx, -fz, v.length / 2 + 1]] as const;
    let at: { x: number; z: number } | null = null;
    for (const [dx, dz, d] of spots) {
      const x = v.x + dx * d;
      const z = v.z + dz * d;
      if (openGround(x, z, this.cols)) {
        at = { x, z };
        break;
      }
    }
    // Wedged in somewhere: the nearest open ground around the car, never inside a wall.
    for (let r = 2.4; !at && r < 30; r += 0.8) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = v.x + Math.cos(a) * r;
        const z = v.z + Math.sin(a) * r;
        if (openGround(x, z, this.cols)) {
          at = { x, z };
          break;
        }
      }
    }
    at ??= { x: v.x, z: v.z };
    const w = g.street.globalToWorld(at.x, at.z);
    g.player.x = w.x;
    g.player.z = w.z;
    g.player.halt();
    if (this.prevCam) {
      g.setCameraMode(this.prevCam.mode, false);
      g.cam.distTarget = this.prevCam.dist;
      this.prevCam = null;
    }
    audio.play('doorbell', { pitch: 0.5 });
    g.events.emit('driving', undefined);
  }

  /** The nearest car you could get into or steal (global), within reach. */
  nearest(): { v?: Vehicle; traffic?: Car; cruiser?: Car; d: number } | null {
    const pg = this.playerGlobal();
    let best: { v?: Vehicle; traffic?: Car; cruiser?: Car; d: number } | null = null;
    const cr = this.g.street.police.stealable(pg.x, pg.z, 1.6);
    if (cr) best = { cruiser: cr.car, d: cr.d };
    for (const v of this.vehicles) {
      if (v.wreck >= 0) continue;
      const d = Math.hypot(v.x - pg.x, v.z - pg.z) - v.length / 2;
      if (d < 1.6 && (!best || d < best.d)) best = { v, d };
    }
    for (const c of this.g.street.city.traffic) {
      if (!c.root.visible) continue;
      const d = Math.hypot(c.x - pg.x, c.z - pg.z) - c.length / 2;
      if (d < 1.4 && (!best || d < best.d)) best = { traffic: c, d };
    }
    return best;
  }

  update(dt: number): void {
    const g = this.g;
    const city = g.street.city;
    city.obstacles = this.vehicles.map((v) => ({ x: v.x, z: v.z }));
    this.crashT = Math.max(0, this.crashT - dt);
    this.updateGarage(dt);
    this.updateCondition(dt);
    this.updateShells(dt);
    const v = this.driving;
    g.cam.chase = !!v;
    if (!v) {
      audio.engine(null);
      return;
    }
    g.cam.chaseSpeed = v.speed;
    const input = g.input;
    let throttle = 0;
    let steer = 0;
    if (!g.modalOpen) {
      if (input.down('KeyW') || input.down('ArrowUp')) throttle += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) throttle -= 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) steer += 1;
      if (input.down('KeyD') || input.down('ArrowRight')) steer -= 1;
      if (input.joy.active) {
        throttle -= input.joy.y;
        steer -= input.joy.x;
      }
    }
    throttle = clamp(throttle, -1, 1);
    steer = clamp(steer, -1, 1);
    const spec = v.def ? tunedSpecs(v.def, v.mods) : { ...STOLEN_SPECS, brake: 1, nitro: 0 };
    // Self-repairing armour (the prototype) patches itself up as you drive.
    if (v.def?.regen && v.wreck < 0 && v.hp > 0) v.hp = Math.min(v.maxHp, v.hp + v.def.regen * dt);
    // A badly damaged engine loses power.
    const health = v.hp / v.maxHp;
    const weak = health < 0.5 ? 0.55 + health * 0.9 : 1;
    const top = spec.top * weak;
    const accel = spec.accel * weak;
    const grip = spec.grip;
    // Shift: nitro if fitted (a tank that refills), otherwise a little extra push.
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    const nitroOn = shift && spec.nitro > 0 && this.nitro > 0 && throttle > 0;
    if (v.def?.infiniteNitro) this.nitro = 1;
    else if (nitroOn) this.nitro = Math.max(0, this.nitro - dt / (2 + spec.nitro));
    else this.nitro = Math.min(1, this.nitro + dt * 0.12);
    const boost = nitroOn ? 1.3 + spec.nitro * 0.12 : shift ? 1.1 : 1;
    for (const f of v.flames) {
      f.visible = nitroOn;
      if (nitroOn) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    }
    for (const b of v.brakeLights) b.scale.y = throttle < 0 && v.speed > 0.5 ? 1.6 : 1;
    if (nitroOn && Math.random() < dt * 6) audio.play('whoosh', { volume: 0.3, pitch: 0.6 });
    // Gearbox: Q/E shift yourself (switches to manual), Z goes back to automatic.
    if (!g.modalOpen) {
      const up = input.hit('KeyE');
      const down = input.hit('KeyQ');
      if ((up || down) && !this.manual) {
        this.manual = true;
        g.notify('Manual gearbox: E shifts up, Q shifts down. Z for automatic.', 'info');
      }
      if (input.hit('KeyZ')) {
        this.manual = !this.manual;
        g.notify(this.manual ? 'Manual gearbox: E shifts up, Q shifts down.' : 'Automatic gearbox.', 'info');
      }
      if (this.manual && (up || down) && v.speed >= -0.5) {
        const next = clamp(this.gear + (up ? 1 : -1), 1, GEARS);
        if (next !== this.gear) {
          this.gear = next;
          this.shiftT = 0.18;
          audio.play('shift', { pitch: up ? 1.1 : 0.85, volume: 0.6 });
        }
      }
    }
    this.shiftT = Math.max(0, this.shiftT - dt);
    if (v.speed < -0.3) this.gear = 0;
    else if (this.gear === 0) this.gear = 1;
    if (!this.manual && this.gear > 0) {
      const next = autoGear(this.gear, v.speed, top * boost);
      if (next !== this.gear) {
        this.gear = next;
        this.shiftT = 0.12;
      }
    }
    const gearTopNow = this.gear > 0 ? gearTop(top * boost, this.gear) : 9;
    this.rpm = this.gear > 0 ? Math.min(this.gear >= GEARS ? 0.94 : 1.05, rpmOf(v.speed, top * boost, this.gear)) : Math.min(1, Math.abs(v.speed) / 9);
    if (throttle > 0) {
      if (v.speed < 0) v.speed += accel * 2.2 * throttle * dt;
      else if (this.shiftT <= 0) {
        // Pull from the gear you're in (×1.15 keeps the average close to the old single-speed feel).
        const pull = drive(v.speed, top * boost, Math.max(1, this.gear)) * 1.15;
        v.speed += accel * pull * (nitroOn ? boost * 1.6 : boost) * throttle * dt;
        // Bouncing off the limiter (not in top gear: there it's the air holding you back)
        if (this.rpm >= 0.99 && this.gear < GEARS) {
          this.limiterT -= dt;
          if (this.limiterT <= 0) {
            this.limiterT = 0.14;
            audio.play('backfire', { volume: 0.18, pitch: 1.4 });
          }
        }
      }
    } else if (throttle < 0) v.speed += (v.speed > 0 ? accel * 2.4 * spec.brake : accel * 0.6) * throttle * dt;
    else v.speed = damp(v.speed, 0, 0.8, dt);
    // Too fast for the gear (a manual downshift): engine braking pulls the speed down.
    if (this.gear > 0 && v.speed > gearTopNow) v.speed = Math.max(gearTopNow, v.speed - 7 * dt);
    v.speed = clamp(v.speed, -9, top * boost);
    v.steer = damp(v.steer, steer, 8, dt);
    // Sharper turns at low speed, gentler at high speed.
    const turn = v.steer * grip * 2.3 * clamp(v.speed / 7, -1, 1) * (1 - Math.min(0.55, Math.abs(v.speed) / (top * 2.2)));
    v.yaw += turn * dt;
    const nx = v.x + Math.sin(v.yaw) * v.speed * dt;
    const nz = v.z + Math.cos(v.yaw) * v.speed * dt;
    // Hitbox a little inside the body, so you can squeeze past corners and lamp posts.
    if (this.fits(nx, nz, v.yaw, v.length * 0.8, v.width * 0.72)) {
      v.x = nx;
      v.z = nz;
    } else {
      // Into a wall: bounce back.
      this.crash(v, Math.abs(v.speed));
      v.speed *= -0.3;
    }
    if (v.wreck >= 0) return;
    // Traffic
    for (const c of city.traffic) {
      if (!c.root.visible) continue;
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      if (d < c.length + v.length && carsTouch(v, c.x, c.z, c.length) && Math.abs(v.speed) > 0.5) {
        const away = Math.atan2(v.x - c.x, v.z - c.z);
        v.x += Math.sin(away) * 0.4;
        v.z += Math.cos(away) * 0.4;
        const hitSpeed = Math.abs(v.speed);
        this.crash(v, hitSpeed);
        city.hitCar(c);
        // Heavy armour flattens whatever it hits.
        this.hurtTraffic(c, crashDamage(hitSpeed) * (v.armor < 0.5 ? 6 : 1.2), true);
        v.speed *= v.armor < 0.5 ? 0.7 : -0.25;
      }
    }
    // Other parked cars
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (carsTouch(v, o.x, o.z, o.length) && Math.abs(v.speed) > 0.5) {
        const away = Math.atan2(v.x - o.x, v.z - o.z);
        v.x += Math.sin(away) * 0.4;
        v.z += Math.cos(away) * 0.4;
        const hitSpeed = Math.abs(v.speed);
        const fresh = this.crashT <= 0;
        this.crash(v, hitSpeed);
        if (fresh) this.damage(o, crashDamage(hitSpeed) * (v.armor < 0.5 ? 6 : 1), true);
        v.speed *= -0.25;
      }
    }
    // Cruisers you smash into
    for (const c of g.street.police.cruisersNear(v.x, v.z, v.length)) {
      if (!carsTouch(v, c.root.position.x, c.root.position.z, c.length) || Math.abs(v.speed) < 4) continue;
      const fresh = this.crashT <= 0;
      const hitSpeed = Math.abs(v.speed);
      this.crash(v, hitSpeed);
      if (fresh) this.hurtCruiser(c, crashDamage(hitSpeed) * (v.armor < 0.5 ? 6 : 1.2), true);
      if (v.armor >= 0.5) v.speed *= -0.25;
    }
    // People in the way
    if (Math.abs(v.speed) > 4) {
      const fx = Math.sin(v.yaw);
      const fz = Math.cos(v.yaw);
      const hx = v.x + fx * v.length * 0.35 * Math.sign(v.speed);
      const hz = v.z + fz * v.length * 0.35 * Math.sign(v.speed);
      for (const r of g.street.crowd.raycast(hx - fx, hz - fz, fx, fz, 2.2)) {
        const res = g.street.crowd.damage(r.ped, 999, fx, fz);
        if (res.ko) {
          g.street.police.crime(HEAT.knockout);
          g.stats.knockouts++;
          audio.play('thud');
          g.cam.shake(0.08);
        }
      }
      for (const r of g.street.police.raycast(hx - fx, hz - fz, fx, fz, 2.2)) {
        if (g.street.police.damage(r.cop, 999)) {
          audio.play('thud');
          g.stats.knockouts++;
        }
      }
    }
    // Model
    v.root.position.set(v.x, 0, v.z);
    v.root.rotation.y = v.yaw;
    for (const w of v.wheels) w.rotation.x += (v.speed * dt) / 0.37;
    for (const f of v.front) f.rotation.y = v.steer * 0.45;
    // You're in the driver's seat.
    const sx = v.x + Math.cos(v.yaw) * v.seat.x + Math.sin(v.yaw) * v.seat.z;
    const sz = v.z - Math.sin(v.yaw) * v.seat.x + Math.cos(v.yaw) * v.seat.z;
    const w = g.street.globalToWorld(sx, sz);
    const flip = g.street.placeOf(g.street.activeId).side === 1;
    const yawW = v.yaw + (flip ? Math.PI : 0);
    g.player.seat = { x: w.x, z: w.z, yaw: yawW, sit: true, height: v.seat.y };
    g.player.playEmote('sit', 999);
    g.player.yaw = yawW;
    g.cam.followYaw = yawW;
    if (v.turret) {
      // The turret settles back to face forward; the barrel recoils after a shot.
      v.turret.position.z = -0.3 - Math.max(0, (v.cannonT ?? 0) - 2.2) * 0.8;
    }
    // Engine: a running engine voice that follows the revs and how hard you're on the gas.
    const profile = engineOf(v.def);
    const speedAbs = Math.abs(v.speed);
    // Tyres squeal in hard corners, under heavy braking and when the wheels spin off the line.
    const corner = Math.abs(v.steer) * speedAbs / Math.max(10, top) * (2.2 - grip);
    const braking = throttle < 0 && v.speed > 8 ? 0.6 : 0;
    const launch = throttle > 0 && speedAbs < 6 && this.gear <= 1 && accel > 11 ? 0.5 : 0;
    const want = profile === 'tank' ? 0 : clamp(Math.max(corner - 0.35, braking, launch), 0, 1);
    this.skid = damp(this.skid, want, 10, dt);
    if (this.skid > 0.35 && Math.random() < dt * 12) {
      const w = g.street.globalToWorld(v.x - Math.sin(v.yaw) * v.length * 0.4, v.z - Math.cos(v.yaw) * v.length * 0.4);
      g.effects.dust(w.x, w.z, 0.4);
    }
    audio.engine({ profile, rpm: this.gear === 0 ? Math.min(0.6, speedAbs / 9) : this.rpm, throttle: Math.max(0, throttle) * (this.shiftT > 0 ? 0.3 : 1), skid: this.skid, damage: 1 - health, speed: speedAbs });
    // Shifting up at speed: the turbo's blow-off and a crackle from the exhaust.
    if (this.gear !== this.lastGear) {
      if (this.gear > this.lastGear && this.gear > 1) {
        audio.play('shift', { volume: 0.5 });
        if ((v.mods?.turbo ?? 0) > 0 || profile === 'sport') audio.play('turbo', { volume: 0.7 });
      }
      this.lastGear = this.gear;
    }
    // Lift off at high revs: pops and bangs.
    if (this.prevThrottle > 0 && throttle <= 0 && this.rpm > 0.65 && profile !== 'electric' && profile !== 'tank') {
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) window.setTimeout(() => audio.play('backfire', { volume: 0.35, pitch: 0.8 + Math.random() * 0.5 }), i * 90 + Math.random() * 60);
    }
    this.prevThrottle = throttle;
    void this.engineT;
    // A police cruiser: C works the siren (lights flash while it's on); everything else honks.
    if (v.def?.id === 'police') {
      if (input.hit('KeyC')) {
        this.siren = !this.siren;
        audio.play(this.siren ? 'siren' : 'click');
        this.sirenT = 1.1;
      }
      if (this.siren) {
        this.sirenT -= dt;
        if (this.sirenT <= 0) {
          this.sirenT = 1.1;
          audio.play('siren', { volume: 0.7 });
        }
      }
      const ph = Math.floor(performance.now() / 160) % 2 === 0;
      v.beacons?.forEach((b, i) => (b.visible = !this.siren || (i % 2 === 0) === ph));
    } else if (input.hit('KeyC')) audio.play('honk', { pitch: v.armor < 0.5 ? 0.6 : 1 });
    // Tank: click or F fires the main gun.
    if (v.def?.cannon && v.muzzle) {
      v.cannonT = Math.max(0, (v.cannonT ?? 0) - dt);
      const fire = !g.modalOpen && (input.hit('KeyF') || (input.mousePresses > 0 && !input.isTouch) || this.fireRequest);
      this.fireRequest = false;
      if (fire && v.cannonT <= 0) this.fireCannon(v);
    }
  }

  /** The HUD's fire button (touch) asks the tank to fire. */
  fireRequest = false;

  /** A police cruiser rammed you: shoved sideways and slowed down (it takes a knock too). */
  rammed(dx: number, dz: number, speedMul: number, by?: Car): void {
    const v = this.driving;
    if (!v) return;
    this.damage(v, 9, false);
    if (by && v.armor < 0.5) this.hurtCruiser(by, 30, true);
    if (this.driving !== v) return;
    if (v.armor < 0.5) {
      // Armour doesn't get pushed around.
      speedMul = Math.max(speedMul, 0.92);
      dx *= 0.15;
      dz *= 0.15;
    }
    if (this.fits(v.x + dx, v.z + dz, v.yaw, v.length * 0.8, v.width * 0.72)) {
      v.x += dx;
      v.z += dz;
    }
    v.speed *= speedMul;
    v.yaw += (Math.random() - 0.5) * 0.25;
    this.g.cam.shake(0.18);
    audio.play('glass', { volume: 0.3 });
  }

  private crash(v: Vehicle, speed: number): void {
    if (this.crashT > 0 || speed < 2) return;
    this.crashT = 0.4;
    audio.play(speed > 7 ? 'crash' : 'thud', { volume: Math.min(1, speed / 15), pitch: v.armor < 0.5 ? 0.6 : 0.9 + Math.random() * 0.2 });
    if (speed > 12 && v.armor >= 0.5) audio.play('glass', { volume: 0.4 });
    this.g.cam.shake(Math.min(0.25, speed / 60));
    this.damage(v, crashDamage(speed, v.armor), false);
  }

  // ------------------------------------------------------------------ durability

  /** Wear a vehicle down; at 0 it blows up. `byPlayer` = you did it (the police notice). */
  damage(v: Vehicle, amount: number, byPlayer: boolean): void {
    if (v.wreck >= 0 || amount <= 0 || !this.vehicles.includes(v)) return;
    const was = v.hp;
    v.hp = Math.max(0, v.hp - amount);
    this.noteCondition(v);
    if (v === this.driving && Math.floor(was / v.maxHp * 4) !== Math.floor(v.hp / v.maxHp * 4) && v.hp > 0) {
      this.g.notify(v.hp / v.maxHp < 0.25 ? `Your ${v.name} is on fire! Get out before it blows!` : v.hp / v.maxHp < 0.5 ? `Your ${v.name} is smoking: ${Math.round((v.hp / v.maxHp) * 100)}% left.` : `Your ${v.name} took a beating.`, 'bad');
    }
    // Burning: it goes up a few seconds later unless it's already gone.
    if (v.hp > 0 && v.hp < v.maxHp * 0.15 && v.burnT <= 0) v.burnT = 6;
    if (v.hp <= 0) this.explode(v, byPlayer);
    this.g.events.emit('combat', undefined);
  }

  /** A traffic car takes damage; at 0 it explodes (it's out of the traffic as a wreck). */
  hurtTraffic(c: Car, amount: number, byPlayer: boolean): void {
    if (amount <= 0) return;
    c.hp = Math.max(0, c.hp - amount);
    if (c.hp > 0) return;
    this.g.street.city.releaseCar(c);
    this.wreckCar(c, byPlayer);
  }

  /** A police cruiser takes damage; at 0 it blows up and leaves the chase. */
  hurtCruiser(c: Car, amount: number, byPlayer: boolean): void {
    if (amount <= 0) return;
    c.hp = Math.max(0, c.hp - amount);
    if (c.hp > 0) return;
    const pol = this.g.street.police;
    if (!pol.dropCruiser(c)) return;
    if (byPlayer) pol.crime(HEAT.copCar);
    this.wreckCar(c, byPlayer);
  }

  /** Turn a traffic or police car into one of ours and blow it up. */
  private wreckCar(c: Car, byPlayer: boolean): void {
    c.root.removeFromParent();
    c.hazard.visible = false;
    this.group.add(c.root);
    const v: Vehicle = {
      uid: nextUid++, def: null, name: 'car', color: c.color, root: c.root, wheels: [], front: [], open: false, seat: new THREE.Vector3(),
      x: c.x, z: c.z, yaw: c.root.rotation.y, speed: 0, steer: 0, length: c.length, width: 2, owned: false, stolen: false, mods: null, flames: [], brakeLights: [],
      hp: 0, maxHp: c.maxHp, armor: 1, wreck: -1, burnT: 0,
    };
    // Cruisers move by their own coordinates; traffic cars by x/z.
    v.x = c.root.position.x;
    v.z = c.root.position.z;
    this.vehicles.push(v);
    this.explode(v, byPlayer);
  }

  /** Boom: fireball, the shell left charred and burning, everything close by hurt. */
  explode(v: Vehicle, byPlayer: boolean): void {
    const g = this.g;
    if (v.wreck >= 0) return;
    // Thrown clear (the blast below still hurts).
    if (this.driving === v) this.exit();
    v.hp = 0;
    v.wreck = 0;
    v.burnT = 14;
    v.speed = 0;
    // Charred: every paint, chrome and lamp goes black.
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.95, metalness: 0.2 });
    v.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = burnt;
    });
    for (const f of v.flames) f.visible = false;
    v.root.rotation.z = (Math.random() - 0.5) * 0.12;
    v.root.position.y = -0.08;
    const w = g.street.globalToWorld(v.x, v.z);
    const big = v.def?.kind === 'tank' || v.def?.kind === 'apc' ? 1.6 : 1;
    g.effects.explosion(w.x, 0.8, w.z, big);
    audio.playAt('explosion', w.x, w.z, 1.4);
    const pg = this.playerGlobal();
    const dist = Math.hypot(pg.x - v.x, pg.z - v.z);
    g.cam.shake(Math.max(0.05, 0.45 - dist / 60));
    g.stats.carsWrecked = (g.stats.carsWrecked ?? 0) + 1;
    if (byPlayer) g.street.police.crime(HEAT.wreck);
    this.noteCondition(v);
    if (v.owned && v.def) g.notify(`Your ${v.def.name} blew up! Rebuilding it costs ${formatMoney(repairCost(v.def))} (10% of its price): Menu → My cars.`, 'bad');
    this.blast(v.x, v.z, 6.5 * big, 70 * big, byPlayer, v);
  }

  /** Remember how damaged one of your own cars is (saved). */
  private noteCondition(v: Vehicle): void {
    const g = this.g;
    if (!v.owned || !v.def || !g.garage.owned.includes(v.def.id)) return;
    g.garage.hp ??= {};
    const f = v.wreck >= 0 ? 0 : v.hp / v.maxHp;
    if (f >= 0.999) delete g.garage.hp[v.def.id];
    else g.garage.hp[v.def.id] = Math.round(f * 1000) / 1000;
    g.requestSave();
  }

  /** Pay to have one of your cars fixed after a crash: 10% of what it cost, good as new. */
  repair(id: string): boolean {
    const g = this.g;
    const def = carDef(id);
    if (!def || !g.garage.owned.includes(id)) return false;
    if (conditionOf(g.garage, id) >= 1) {
      g.notify(`Your ${def.name} doesn't need fixing.`, 'info');
      return false;
    }
    const cost = repairCost(def);
    if (g.money < cost) {
      audio.play('error');
      g.notify(`Fixing your ${def.name} costs ${formatMoney(cost)} (10% of its price).`, 'bad');
      return false;
    }
    g.spend(cost, 'upkeep');
    delete g.garage.hp?.[id];
    // Out on the street (and not a burnt-out shell): fixed where it stands.
    const v = this.vehicles.find((o) => o.owned && o.def?.id === id && o.wreck < 0);
    if (v) {
      v.hp = v.maxHp;
      v.burnT = 0;
    }
    audio.play('repair');
    g.notify(`Your ${def.name} is fixed, good as new (${formatMoney(cost)}).`, 'good');
    g.events.emit('combat', undefined);
    g.requestSave();
    return true;
  }

  /** An explosion at a point (global frame): hurts cars, people, the police and you. */
  blast(x: number, z: number, radius: number, power: number, byPlayer: boolean, source?: Vehicle): void {
    const g = this.g;
    const st = g.street;
    const fall = (d: number) => Math.max(0, 1 - d / radius);
    for (const o of [...this.vehicles]) {
      if (o === source || o.wreck >= 0) continue;
      const k = fall(Math.hypot(o.x - x, o.z - z) - o.length * 0.3);
      if (k > 0) this.damage(o, power * 1.4 * k * (o.armor < 0.5 ? 0.5 : 1), byPlayer);
    }
    for (const c of [...st.city.traffic]) {
      const k = fall(Math.hypot(c.x - x, c.z - z) - 1);
      if (k > 0) {
        st.city.hitCar(c);
        this.hurtTraffic(c, power * 1.4 * k, byPlayer);
      }
    }
    for (const c of st.police.cruisersNear(x, z, radius + 2)) this.hurtCruiser(c, power * 1.4 * fall(Math.hypot(c.root.position.x - x, c.root.position.z - z) - 1), byPlayer);
    for (const ped of st.crowd.around(x, z, radius)) {
      const d = Math.hypot(ped.x - x, ped.z - z);
      const r = st.crowd.damage(ped, power * 2 * fall(d), ped.x - x, ped.z - z);
      if (r.ko && byPlayer) {
        st.police.crime(HEAT.knockout);
        g.stats.knockouts++;
      }
    }
    for (const o of st.police.officers) {
      if (o.ko > 0) continue;
      const k = fall(Math.hypot(o.x - x, o.z - z));
      if (k > 0 && st.police.damage(o, power * 2 * k) && byPlayer) g.stats.knockouts++;
    }
    g.base.blast(x, z, radius, power, byPlayer);
    // You, on foot nearby (in a car, your car takes it instead).
    if (!this.driving) {
      const pg = this.playerGlobal();
      const k = fall(Math.hypot(pg.x - x, pg.z - z));
      if (k > 0) g.combat.damage(Math.round(power * 1.3 * k), 'world', 'the explosion');
    }
  }

  /** Burning, smoking and clearing away wrecks; smoke from damaged traffic. */
  private updateCondition(dt: number): void {
    const g = this.g;
    const st = g.street;
    const pg = this.playerGlobal();
    for (const v of [...this.vehicles]) {
      const near = Math.hypot(v.x - pg.x, v.z - pg.z) < 140;
      if (v.wreck >= 0) {
        v.wreck += dt;
        v.burnT = Math.max(0, v.burnT - dt);
        if (near) {
          const w = st.globalToWorld(v.x, v.z);
          if (v.burnT > 0 && Math.random() < dt * 30) g.effects.fire(w.x, 0.9, w.z, 1.2);
          if (Math.random() < dt * (v.burnT > 0 ? 8 : 2)) g.effects.soot(w.x, 1.2, w.z, 1);
        }
        // Towed away after a while.
        if (v.wreck > 45) this.remove(v);
        continue;
      }
      const f = v.hp / v.maxHp;
      if (f < 0.5 && near && Math.random() < dt * (f < 0.25 ? 10 : 4)) {
        const fx = v.x + Math.sin(v.yaw) * v.length * 0.35;
        const fz = v.z + Math.cos(v.yaw) * v.length * 0.35;
        const w = st.globalToWorld(fx, fz);
        g.effects.soot(w.x, 1.0, w.z, f < 0.25 ? 1 : 0);
        if (f < 0.15) g.effects.fire(w.x, 0.9, w.z, 0.6);
      }
      // On fire: it goes up when the fire reaches the tank.
      if (v.burnT > 0) {
        v.burnT -= dt;
        if (v.burnT <= 0) this.explode(v, false);
      }
    }
    // Shot-up traffic smokes too.
    for (const c of st.city.traffic) {
      if (c.hp >= c.maxHp * 0.5 || !c.root.visible || Math.random() > dt * 4) continue;
      const w = st.globalToWorld(c.x, c.z);
      g.effects.soot(w.x, 1.0, w.z, c.hp < c.maxHp * 0.25 ? 1 : 0);
    }
  }

  // ------------------------------------------------------------------ bullets and shells

  /** The first car (traffic, police or parked) along a ray (global frame, unit direction). */
  raycast(ox: number, oz: number, dx: number, dz: number, range: number): CarTarget | null {
    const st = this.g.street;
    let best: CarTarget | null = null;
    const tr = st.city.raycastCars(ox, oz, dx, dz, range);
    if (tr) best = { t: tr.t, traffic: tr.car };
    const cr = st.police.raycastCruisers(ox, oz, dx, dz, best ? best.t : range);
    if (cr && (!best || cr.t < best.t)) best = { t: cr.t, cruiser: cr.car };
    for (const v of this.vehicles) {
      if (v === this.driving) continue;
      const t = rayBox(ox, oz, dx, dz, best ? best.t : range, v.x, v.z, v.yaw, v.width / 2, v.length / 2);
      if (t !== null && (!best || t < best.t)) best = { t, v };
    }
    return best;
  }

  /** A bullet (gun damage `dmg`) hit this car. */
  shoot(tg: CarTarget, dmg: number): void {
    if (tg.traffic) this.hurtTraffic(tg.traffic, shotDamage(dmg), true);
    else if (tg.cruiser) this.hurtCruiser(tg.cruiser, shotDamage(dmg), true);
    else if (tg.v) this.damage(tg.v, shotDamage(dmg, tg.v.armor), true);
  }

  /** The tank's main gun: a shell flies down the barrel's line and explodes where it lands. */
  private fireCannon(v: Vehicle): void {
    const g = this.g;
    const st = g.street;
    v.cannonT = 2.6;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const mx = v.x + fx * (v.length / 2 + 1.8);
    const mz = v.z + fz * (v.length / 2 + 1.8);
    // Where it lands: the first building, car, person or the end of its range.
    let t = 0;
    const range = 140;
    for (; t < range; t += 0.8) {
      const w = st.globalToWorld(mx + fx * t, mz + fz * t);
      if (!st.isOutdoors(w.x, w.z)) break;
    }
    const car = this.raycast(mx, mz, fx, fz, t);
    if (car) t = Math.min(t, car.t);
    for (const p of st.crowd.raycast(mx, mz, fx, fz, t)) t = Math.min(t, p.s);
    for (const c of st.police.raycast(mx, mz, fx, fz, t)) t = Math.min(t, c.s);
    for (const so of g.base.raycast(mx, mz, fx, fz, t)) t = Math.min(t, so.s);
    const wm = st.globalToWorld(mx, mz);
    g.effects.explosion(wm.x, 2.0, wm.z, 0.35);
    audio.play('cannon');
    g.cam.shake(0.22);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a, toneMapped: false }));
    shell.position.set(wm.x, 2.0, wm.z);
    g.effects.group.add(shell);
    this.shells.push({ x: mx, z: mz, tx: mx + fx * t, tz: mz + fz * t, t: 0, dur: Math.max(0.05, t / 180), mesh: shell });
    v.speed -= 1.5;
  }

  private updateShells(dt: number): void {
    const st = this.g.street;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      const w = st.globalToWorld(s.x + (s.tx - s.x) * u, s.z + (s.tz - s.z) * u);
      s.mesh.position.set(w.x, 2.0 - u * 1.2, w.z);
      if (u >= 1) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        this.shells.splice(i, 1);
        const e = st.globalToWorld(s.tx, s.tz);
        this.g.effects.explosion(e.x, 0.8, e.z, 1.2);
        audio.playAt('explosion', e.x, e.z, 1.4);
        this.g.cam.shake(0.12);
        this.blast(s.tx, s.tz, 8, 260, true);
      }
    }
  }

  /** After customizing: swap the model of that car if it's out on the street. */
  refresh(id: string): void {
    const v = this.vehicles.find((o) => o.owned && o.def?.id === id);
    if (!v || !v.def) return;
    const mods = modsOf(this.g.garage, id);
    const m = buildCar(v.def, undefined, mods);
    const parent = v.root.parent;
    v.root.removeFromParent();
    m.root.position.copy(v.root.position);
    m.root.rotation.copy(v.root.rotation);
    parent?.add(m.root);
    Object.assign(v, { root: m.root, wheels: m.wheels, front: m.front, open: m.open, seat: m.seat, length: m.length, color: mods.color, mods, flames: m.flames, brakeLights: m.brakeLights, turret: m.turret, muzzle: m.muzzle, beacons: m.beacons });
  }

  /** Buy a car at Velocity Motors (cash from your casino). */
  buy(id: string, color?: number): boolean {
    const g = this.g;
    const def = carDef(id);
    if (!def || g.garage.owned.includes(id)) return false;
    if (g.homeLevel < def.unlock) {
      g.notify(`The ${def.name} unlocks at casino level ${def.unlock}.`, 'bad');
      return false;
    }
    if (g.money < def.price) {
      audio.play('error');
      g.notify(`The ${def.name} costs ${formatMoney(def.price)}.`, 'bad');
      return false;
    }
    g.spend(def.price, 'purchase');
    g.garage.owned.push(id);
    if (color !== undefined) g.garage.colors[id] = color;
    g.garage.mods[id] = defaultMods(def, color);
    audio.play('purchase');
    g.notify(`You bought a ${def.name}! Have it brought to you from the Cars panel.`, 'good');
    g.requestSave();
    return true;
  }

  // ------------------------------------------------------------------ your garage

  private garage = new GarageModel();
  private garageKey = '';

  /** Centre line of your garage in the house lot's frame (null without a house on the map). */
  private garageX(): number | null {
    const g = this.g;
    const hi = g.houseInfo();
    if (!hi || !g.street.get('house')) return null;
    const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, hi.width))].w;
    return CENTER_X + w / 2 + 3.6;
  }

  /** Is this global point on the driveway in front of your garage? */
  atGarage(x: number, z: number): boolean {
    const gx = this.garageX();
    if (gx === null) return false;
    const l = this.g.street.fromGlobal('house', x, z);
    const depth = garageTier(this.g.house?.garage ?? 0)?.depth ?? 0;
    return Math.abs(l.x - gx) < GARAGE_W / 2 + 0.6 && l.z > FACADE_Z - depth - 0.5 && l.z < SIDEWALK_Z0 + 7;
  }

  /** Inside your garage, between its walls (cars can drive in and out through the door). */
  private inGarage(x: number, z: number): boolean {
    const h = this.g.house;
    const t = h ? garageTier(h.garage) : null;
    if (!t) return false;
    const gx = this.garageX();
    if (gx === null) return false;
    const l = this.g.street.fromGlobal('house', x, z);
    return Math.abs(l.x - gx) < 2.7 && l.z > FACADE_Z - t.depth + 0.15 && l.z < SIDEWALK_Z0 + 0.5;
  }

  /** You're standing (or driving) on your driveway. */
  get playerAtGarage(): boolean {
    const g = this.g;
    if (g.inside || g.player.floor > 0) return false;
    const p = this.playerGlobal();
    return this.atGarage(p.x, p.z);
  }

  private parkedModel(p: ParkedCar): THREE.Object3D | null {
    if (p.id) {
      const d = carDef(p.id);
      return d ? buildCar(d, undefined, modsOf(this.g.garage, p.id)).root : null;
    }
    if (p.kind !== undefined) return new Car(p.kind, p.color ?? 0xffffff).root;
    return null;
  }

  private updateGarage(dt: number): void {
    const g = this.g;
    const h = g.house;
    const gx = this.garageX();
    const t = h ? garageTier(h.garage) : null;
    if (!h || gx === null || !t) {
      if (this.garage.root.parent) {
        this.garage.clear();
        this.garage.root.removeFromParent();
        this.garageKey = '';
      }
      return;
    }
    const look = g.houseInfo()!.look;
    const key = JSON.stringify([gx, t.depth, look.wallColor, look.trimColor, h.parked, h.parked.map((p) => (p.id ? g.garage.mods[p.id] ?? null : null))]);
    if (key !== this.garageKey) {
      this.garageKey = key;
      const cars = h.parked.map((p) => this.parkedModel(p)).filter((c): c is THREE.Object3D => !!c);
      this.garage.build(gx, t.depth, look.wallColor, look.trimColor, cars);
      if (!this.garage.root.parent) this.group.add(this.garage.root);
      this.g.renderer.markShadowsDirty();
    }
    const o = g.street.toGlobal('house', 0, 0);
    this.garage.root.position.set(o.x, 0, o.z);
    this.garage.root.rotation.y = g.street.placeOf('house').side === 1 ? Math.PI : 0;
    const pg = this.playerGlobal();
    const door = g.street.toGlobal('house', gx, FACADE_Z + 2);
    const d = Math.hypot(pg.x - door.x, pg.z - door.z);
    this.garage.root.visible = d < 260;
    // Inside the garage the roof lifts off so you can see your car.
    this.garage.update(dt, !g.inside && d < (this.driving ? 24 : 12), !this.inGarage(pg.x, pg.z) || g.cam.mode === 'first');
  }

  /** Build your garage, or make it bigger. */
  buyGarage(): boolean {
    const g = this.g;
    const h = g.house;
    if (!h) {
      audio.play('error');
      g.notify('Buy a house first: the garage goes right next to it.', 'bad');
      return false;
    }
    const next = garageTier(h.garage + 1);
    if (!next) return false;
    if (g.money < next.price) {
      audio.play('error');
      g.notify(`The ${next.name} costs ${formatMoney(next.price)}.`, 'bad');
      return false;
    }
    g.spend(next.price, 'expand');
    h.garage = next.tier;
    g.events.emit('house', undefined);
    audio.play('levelup');
    g.notify(`${next.name} built next to your house: room for ${next.cap} cars. Drive up to the door and press Space to park.`, 'good');
    g.saveNow();
    return true;
  }

  /** Drive into your garage: the car is parked inside (stolen ones become yours). */
  park(): boolean {
    const g = this.g;
    const v = this.driving;
    const h = g.house;
    const t = h ? garageTier(h.garage) : null;
    if (!v || !h) return false;
    if (!t) {
      audio.play('error');
      g.notify('You have no garage yet: build one from your house (Home → Garage).', 'bad');
      return false;
    }
    if (g.street.police.stars > 0) {
      audio.play('error');
      g.notify('The police are on your tail: lose them before you hide a car in your garage.', 'bad');
      return false;
    }
    if (Math.abs(v.speed) > 4) {
      g.notify('Slow down to drive in.', 'bad');
      return false;
    }
    const entry: ParkedCar | null = v.def ? { id: v.def.id } : v.kept ? { ...v.kept } : null;
    if (!entry) return false;
    const already = !!entry.id && h.parked.some((p) => p.id === entry.id);
    if (!already) {
      if (h.parked.length >= t.cap) {
        audio.play('error');
        g.notify(`Your garage is full (${t.cap} cars). Make it bigger, or take a car out first.`, 'bad');
        return false;
      }
      h.parked.push(entry);
    }
    const stolen = !v.def;
    // A vehicle taken from the military base is yours once it's in your garage.
    const taken = !!v.def && !g.garage.owned.includes(v.def.id);
    if (taken && v.def) {
      g.garage.owned.push(v.def.id);
      g.garage.mods[v.def.id] = defaultMods(v.def, v.color);
      v.owned = true;
      this.noteCondition(v);
    }
    this.exit();
    this.remove(v);
    // Step back out onto the driveway.
    const gx = this.garageX();
    if (gx !== null) {
      const out = g.street.toGlobal('house', gx - 1.5, SIDEWALK_Z0 + 1.2);
      const w = g.street.globalToWorld(out.x, out.z);
      g.player.x = w.x;
      g.player.z = w.z;
      g.player.yaw = g.street.rotOf('house') + Math.PI;
      g.player.halt();
    }
    this.nitro = 1;
    audio.play('doorbell', { pitch: 0.7 });
    const cond = v.def ? conditionOf(g.garage, v.def.id) : 1;
    g.notify(stolen || taken ? `You hid the ${taken ? v.name : 'car'} in your garage. It’s yours now!`
      : cond < 1 && v.def ? `Your ${v.name} is parked in your garage, washed and the nitro topped up. It's damaged (${Math.round(cond * 100)}%): fixing it costs ${formatMoney(repairCost(v.def))}.`
        : `Your ${v.name} is parked in your garage, washed and the nitro topped up.`, 'good');
    g.stats.carsParked = (g.stats.carsParked ?? 0) + 1;
    g.requestSave();
    return true;
  }

  /** Drive a parked car out of the garage (you have to be at the garage). */
  takeOut(i: number): boolean {
    const g = this.g;
    const h = g.house;
    const gx = this.garageX();
    const p = h?.parked[i];
    if (!h || gx === null || !p) return false;
    if (!this.playerAtGarage) {
      audio.play('error');
      g.notify('Go to your garage to drive a car out (or have it brought to you from My cars).', 'bad');
      return false;
    }
    const def = p.id ? carDef(p.id) ?? null : null;
    if (p.id && !def) return false;
    if (def && conditionOf(g.garage, def.id) <= 0) {
      audio.play('error');
      g.notify(`Your ${def.name} is wrecked. Get it repaired first (${formatMoney(repairCost(def))}).`, 'bad');
      return false;
    }
    const mods = def ? modsOf(g.garage, def.id) : null;
    const built = def ? buildCar(def, undefined, mods!) : null;
    const len = built ? built.length : new Car(p.kind ?? 0, 0).length;
    // Nose just inside the door: drive it out.
    const depth = garageTier(h.garage)?.depth ?? 7;
    const at = g.street.toGlobal('house', gx, Math.max(FACADE_Z - 0.2 - len / 2, FACADE_Z - depth + 0.25 + len * 0.46));
    const yaw = g.street.placeOf('house').side === 1 ? Math.PI : 0;
    if (this.vehicles.some((o) => Math.hypot(o.x - at.x, o.z - at.z) < 4)) {
      audio.play('error');
      g.notify('Another car is blocking the garage door.', 'bad');
      return false;
    }
    if (this.driving) this.exit();
    if (def) {
      const old = this.vehicles.find((o) => o.owned && o.def?.id === def.id);
      if (old) this.remove(old);
    }
    h.parked.splice(i, 1);
    let v: Vehicle;
    if (def && built && mods) v = this.addVehicle(def, built, mods.color, at.x, at.z, yaw, true, false, mods);
    else {
      const c = new Car(p.kind ?? 0, p.color ?? 0xffffff);
      c.root.position.set(at.x, 0, at.z);
      c.root.rotation.y = yaw;
      this.group.add(c.root);
      v = {
        uid: nextUid++, def: null, name: 'your car', color: p.color ?? 0, root: c.root, wheels: [], front: [], open: false, seat: new THREE.Vector3(-0.38, 0.8, 0),
        x: at.x, z: at.z, yaw, speed: 0, steer: 0, length: c.length, width: 2, owned: true, stolen: false, mods: null, flames: [], brakeLights: [],
        kept: { kind: c.kind, color: c.color }, hp: c.maxHp, maxHp: c.maxHp, armor: 1, wreck: -1, burnT: 0,
      };
      this.vehicles.push(v);
    }
    this.enter(v);
    g.requestSave();
    return true;
  }

  /** Have a car you own taken home and parked in your garage (from anywhere). */
  sendHome(id: string): boolean {
    const g = this.g;
    const h = g.house;
    const t = h ? garageTier(h.garage) : null;
    if (!h || !t || !g.garage.owned.includes(id) || h.parked.some((p) => p.id === id)) return false;
    if (h.parked.length >= t.cap) {
      audio.play('error');
      g.notify(`Your garage is full (${t.cap} cars).`, 'bad');
      return false;
    }
    const out = this.vehicles.find((o) => o.owned && o.def?.id === id);
    if (out) this.remove(out);
    h.parked.push({ id });
    g.events.emit('house', undefined);
    audio.play('click');
    g.notify(`A valet is taking your ${carDef(id)?.name ?? 'car'} home to your garage.`, 'good');
    g.requestSave();
    return true;
  }

  /** Clear the street (new game or loading a save). */
  reset(): void {
    if (this.driving) this.exit();
    for (const v of this.vehicles) v.root.removeFromParent();
    this.vehicles = [];
    this.g.base?.resetVehicles();
  }

  /** Every car on sale. */
  get catalog(): CarDef[] {
    return DEALER_CARS;
  }
}

/**
 * Does another car (centre, length) touch yours? Checked along and across your car, so cars
 * side by side in neighbouring lanes pass each other; a bit smaller than the bodies.
 */
export function carsTouch(v: { x: number; z: number; yaw: number; length: number; width: number }, ox: number, oz: number, olen: number): boolean {
  const dx = ox - v.x;
  const dz = oz - v.z;
  const along = Math.abs(dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw));
  const across = Math.abs(dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw));
  return along < v.length * 0.45 + olen * 0.4 && across < v.width * 0.4 + 0.75;
}
