import * as THREE from 'three';
import type { Game } from './game';
import { type CarDef, type CarMods, CARS, STOLEN_SPECS, buildCar, carDef, defaultMods, sanitizeMods, tunedSpecs } from '../world/vehicles';
import type { Car } from '../world/cityView';
import { AVE_W, ROAD_HALF, STREET_ROWS, avenueX, blocksFor, onRoadNetwork, streetZ } from '../world/city';
import { HEAT } from '../world/police';
import { audio } from '../core/audio';
import { clamp, damp, formatMoney } from '../core/math';

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
}

/** Cars you own (saved). */
export interface GarageState {
  owned: string[];
  colors: Record<string, number>;
  /** Customization and tuning per car you own. */
  mods: Record<string, CarMods>;
}

export function emptyGarage(): GarageState {
  return { owned: [], colors: {}, mods: {} };
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
  return { owned, colors, mods };
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
      if (!onRoadNetwork(px, pz, this.cols)) return false;
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
    audio.play('honk');
    g.notify(`Your ${def.name} is at the curb. Walk up to it and press Space.`, 'good');
    return !!v;
  }

  private addVehicle(def: CarDef, m: ReturnType<typeof buildCar>, color: number, x: number, z: number, yaw: number, owned: boolean, stolen: boolean, mods: CarMods | null = null): Vehicle {
    m.root.position.set(x, 0, z);
    m.root.rotation.y = yaw;
    this.group.add(m.root);
    const v: Vehicle = {
      uid: nextUid++, def, name: def.name, color, root: m.root, wheels: m.wheels, front: m.front, open: m.open, seat: m.seat,
      x, z, yaw, speed: 0, steer: 0, length: m.length, width: def.kind === 'truck' ? 2.3 : 1.95, owned, stolen, mods, flames: m.flames, brakeLights: m.brakeLights,
    };
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
    };
    this.vehicles.push(v);
    g.street.police.crime(HEAT.knockout);
    g.stats.carsStolen = (g.stats.carsStolen ?? 0) + 1;
    audio.play('carAlarm');
    g.notify('You stole a car! The police are on their way.', 'bad');
    this.enter(v);
  }

  enter(v: Vehicle): void {
    const g = this.g;
    g.stopActivity();
    g.standUp();
    if (g.build.active) g.build.cancel();
    this.driving = v;
    v.speed = 0;
    if (!this.prevCam) this.prevCam = { mode: g.cam.mode, dist: g.cam.distTarget };
    g.setCameraMode('third', false);
    g.cam.setThirdDist(v.length > 6 ? 11 : 8.5);
    audio.play('doorbell', { pitch: 0.6 });
    g.events.emit('driving', undefined);
  }

  /** Get out on the driver's side (or wherever there's room). */
  exit(): void {
    const g = this.g;
    const v = this.driving;
    if (!v) return;
    this.driving = null;
    v.speed = 0;
    g.player.seat = null;
    g.player.emote = null;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const spots = [[-fz, fx, 1.8], [fz, -fx, 1.8], [-fx, -fz, v.length / 2 + 1]] as const;
    let at = { x: v.x - fz * 1.8, z: v.z + fx * 1.8 };
    for (const [dx, dz, d] of spots) {
      const x = v.x + dx * d;
      const z = v.z + dz * d;
      if (onRoadNetwork(x, z, this.cols)) {
        at = { x, z };
        break;
      }
    }
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
  nearest(): { v?: Vehicle; traffic?: Car; d: number } | null {
    const pg = this.playerGlobal();
    let best: { v?: Vehicle; traffic?: Car; d: number } | null = null;
    for (const v of this.vehicles) {
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
    const v = this.driving;
    if (!v) return;
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
    const top = spec.top;
    const accel = spec.accel;
    const grip = spec.grip;
    // Shift: nitro if fitted (a tank that refills), otherwise a little extra push.
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    const nitroOn = shift && spec.nitro > 0 && this.nitro > 0 && throttle > 0;
    if (nitroOn) this.nitro = Math.max(0, this.nitro - dt / (2 + spec.nitro));
    else this.nitro = Math.min(1, this.nitro + dt * 0.12);
    const boost = nitroOn ? 1.3 + spec.nitro * 0.12 : shift ? 1.1 : 1;
    for (const f of v.flames) {
      f.visible = nitroOn;
      if (nitroOn) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    }
    for (const b of v.brakeLights) b.scale.y = throttle < 0 && v.speed > 0.5 ? 1.6 : 1;
    if (nitroOn && Math.random() < dt * 6) audio.play('whoosh', { volume: 0.3, pitch: 0.6 });
    if (throttle > 0) v.speed += (v.speed < 0 ? accel * 2.2 : accel * (nitroOn ? boost * 1.6 : boost)) * throttle * dt;
    else if (throttle < 0) v.speed += (v.speed > 0 ? accel * 2.4 * spec.brake : accel * 0.6) * throttle * dt;
    else v.speed = damp(v.speed, 0, 0.8, dt);
    v.speed = clamp(v.speed, -9, top * boost);
    v.steer = damp(v.steer, steer, 8, dt);
    // Sharper turns at low speed, gentler at high speed.
    const turn = v.steer * grip * 2.3 * clamp(v.speed / 7, -1, 1) * (1 - Math.min(0.55, Math.abs(v.speed) / (top * 2.2)));
    v.yaw += turn * dt;
    const nx = v.x + Math.sin(v.yaw) * v.speed * dt;
    const nz = v.z + Math.cos(v.yaw) * v.speed * dt;
    if (this.fits(nx, nz, v.yaw, v.length * 0.92, v.width * 0.9)) {
      v.x = nx;
      v.z = nz;
    } else {
      // Into a wall: bounce back.
      this.crash(v, Math.abs(v.speed));
      v.speed *= -0.3;
    }
    // Traffic
    for (const c of city.traffic) {
      if (!c.root.visible) continue;
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      if (d < (c.length + v.length) * 0.42 && Math.abs(v.speed) > 0.5) {
        const away = Math.atan2(v.x - c.x, v.z - c.z);
        v.x += Math.sin(away) * 0.4;
        v.z += Math.cos(away) * 0.4;
        this.crash(v, Math.abs(v.speed));
        city.hitCar(c);
        v.speed *= -0.25;
      }
    }
    // Other parked cars
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (Math.hypot(o.x - v.x, o.z - v.z) < (o.length + v.length) * 0.42 && Math.abs(v.speed) > 0.5) {
        const away = Math.atan2(v.x - o.x, v.z - o.z);
        v.x += Math.sin(away) * 0.4;
        v.z += Math.cos(away) * 0.4;
        this.crash(v, Math.abs(v.speed));
        v.speed *= -0.25;
      }
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
    // Engine note
    this.engineT -= dt;
    if (this.engineT <= 0 && Math.abs(v.speed) > 1) {
      this.engineT = 0.5 - Math.min(0.35, Math.abs(v.speed) / 120);
      audio.play('drumhit', { volume: 0.12 + Math.min(0.2, Math.abs(v.speed) / 150), pitch: 0.5 + Math.abs(v.speed) / 40 });
    }
    if (input.hit('KeyC')) audio.play('honk');
  }

  private crash(v: Vehicle, speed: number): void {
    if (this.crashT > 0 || speed < 2) return;
    this.crashT = 0.4;
    audio.play('thud', { volume: Math.min(1, speed / 15) });
    if (speed > 12) audio.play('glass', { volume: 0.4 });
    this.g.cam.shake(Math.min(0.25, speed / 60));
    void v;
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
    Object.assign(v, { root: m.root, wheels: m.wheels, front: m.front, open: m.open, seat: m.seat, length: m.length, color: mods.color, mods, flames: m.flames, brakeLights: m.brakeLights });
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

  /** Clear the street (new game or loading a save). */
  reset(): void {
    if (this.driving) this.exit();
    for (const v of this.vehicles) v.root.removeFromParent();
    this.vehicles = [];
  }

  /** Every car on sale. */
  get catalog(): CarDef[] {
    return CARS;
  }
}
