import * as THREE from 'three';
import { CharacterModel, type Pose } from './characterModel';
import type { Appearance } from './appearance';
import type { Grid } from '../world/grid';
import { clamp, damp, dampAngle } from '../core/math';

const RADIUS = 0.27;

/** The manager: WASD / joystick movement with tile collision and a few emotes. */
export class Player {
  readonly model: CharacterModel;
  x: number;
  z: number;
  yaw = Math.PI;
  private vx = 0;
  private vz = 0;
  emote: Pose | null = null;
  private emoteT = 0;
  readonly pos = new THREE.Vector3();
  name = 'Boss';

  constructor(public appearance: Appearance, x: number, z: number) {
    this.model = new CharacterModel(appearance, { castShadow: false });
    this.x = x;
    this.z = z;
  }

  setAppearance(a: Appearance): void {
    this.appearance = { ...a };
    this.model.setAppearance(a);
  }

  playEmote(p: Pose, seconds: number): void {
    this.emote = p;
    this.emoteT = seconds;
  }

  get moving(): boolean {
    return Math.hypot(this.vx, this.vz) > 0.3;
  }

  private blocked(grid: Grid, x: number, z: number): boolean {
    const x0 = Math.floor(x - RADIUS);
    const x1 = Math.floor(x + RADIUS);
    const z0 = Math.floor(z - RADIUS);
    const z1 = Math.floor(z + RADIUS);
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (grid.isWalkable(tx, tz)) continue;
        const cx = clamp(x, tx, tx + 1);
        const cz = clamp(z, tz, tz + 1);
        if ((cx - x) ** 2 + (cz - z) ** 2 < RADIUS * RADIUS) return true;
      }
    }
    return false;
  }

  /** Move with input in camera space (ix = right, iz = up on screen). */
  update(dt: number, ix: number, iz: number, sprint: boolean, basis: { fx: number; fz: number; rx: number; rz: number }, grid: Grid): void {
    const len = Math.hypot(ix, iz);
    const maxSpeed = sprint ? 5.6 : 3.7;
    let tvx = 0;
    let tvz = 0;
    if (len > 0.05) {
      const k = Math.min(1, len) / Math.max(len, 1e-6);
      const dx = (basis.rx * ix + basis.fx * iz) * k;
      const dz = (basis.rz * ix + basis.fz * iz) * k;
      tvx = dx * maxSpeed * Math.min(1, len);
      tvz = dz * maxSpeed * Math.min(1, len);
      this.emote = null;
    }
    this.vx = damp(this.vx, tvx, 14, dt);
    this.vz = damp(this.vz, tvz, 14, dt);
    // Sub-stepped, per-axis collision so we slide along walls and machines.
    const steps = Math.ceil((Math.hypot(this.vx, this.vz) * dt) / 0.08) || 1;
    for (let i = 0; i < steps; i++) {
      const sx = (this.vx * dt) / steps;
      const sz = (this.vz * dt) / steps;
      if (!this.blocked(grid, this.x + sx, this.z)) this.x += sx;
      else this.vx *= 0.5;
      if (!this.blocked(grid, this.x, this.z + sz)) this.z += sz;
      else this.vz *= 0.5;
    }
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.2) this.yaw = dampAngle(this.yaw, Math.atan2(this.vx, this.vz), 14, dt);
    const m = this.model;
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      if (this.emoteT <= 0) this.emote = null;
    }
    if (speed > 0.3) {
      m.moveSpeed = speed / 1.4;
      m.setPose(speed > 4.4 ? 'run' : 'walk');
    } else {
      m.setPose(this.emote ?? 'idle');
    }
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.yaw;
    m.update(dt);
    this.pos.set(this.x, 0, this.z);
  }

  /** If a new machine landed on top of us, hop to the nearest free tile. */
  unstick(grid: Grid): void {
    if (!this.blocked(grid, this.x, this.z)) return;
    const near = grid.nearestWalkable(Math.floor(this.x), Math.floor(this.z));
    if (near) {
      this.x = near[0] + 0.5;
      this.z = near[1] + 0.5;
    }
  }
}
