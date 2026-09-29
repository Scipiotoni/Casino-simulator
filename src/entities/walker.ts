import * as THREE from 'three';
import { CharacterModel } from './characterModel';
import type { Appearance } from './appearance';
import { findPath, smoothPath } from '../world/pathfinding';
import type { Grid } from '../world/grid';
import { dampAngle } from '../core/math';
import { badgeTexture } from '../render/textures';

/** Shared movement for every NPC: A* paths, smooth steering and walk animation. */
export class Walker {
  readonly model: CharacterModel;
  x: number;
  z: number;
  yaw = 0;
  speed = 1.35;
  run = false;
  protected path: [number, number][] = [];
  protected pathIdx = 0;
  protected goal: { tx: number; tz: number; final: [number, number] | null } | null = null;
  protected gridVersion = -1;
  private stuckT = 0;
  private lastProgress = 0;
  private badge: THREE.Sprite | null = null;
  private badgeKind = '';
  readonly headPos = new THREE.Vector3();

  constructor(appearance: Appearance, x: number, z: number) {
    this.model = new CharacterModel(appearance);
    this.x = x;
    this.z = z;
    this.model.root.position.set(x, 0, z);
  }

  get walking(): boolean {
    return this.goal !== null;
  }

  /** Plan a path to a tile; `final` is an exact point to slide into at the end (seats). */
  walkTo(grid: Grid, tx: number, tz: number, final: [number, number] | null = null): boolean {
    const sx = Math.floor(this.x);
    const sz = Math.floor(this.z);
    let tiles = findPath(grid, sx, sz, tx, tz);
    if (!tiles) {
      // We may be standing somewhere odd (inside a new footprint); hop to the nearest free tile.
      const near = grid.nearestWalkable(sx, sz);
      if (!near) return false;
      tiles = findPath(grid, near[0], near[1], tx, tz);
      if (!tiles) return false;
      this.x = near[0] + 0.5;
      this.z = near[1] + 0.5;
    }
    this.path = smoothPath(grid, tiles, this.x, this.z);
    if (final) this.path.push(final);
    this.pathIdx = 0;
    this.goal = { tx, tz, final };
    this.gridVersion = grid.version;
    this.stuckT = 0;
    return true;
  }

  stop(): void {
    this.goal = null;
    this.path = [];
  }

  /** Advance along the path. Returns 'arrived' once, 'blocked' if the route vanished. */
  protected stepPath(dt: number, grid: Grid): 'moving' | 'arrived' | 'blocked' | 'idle' {
    if (!this.goal) return 'idle';
    if (grid.version !== this.gridVersion) {
      const g = this.goal;
      if (!this.walkTo(grid, g.tx, g.tz, g.final)) {
        this.stop();
        return 'blocked';
      }
    }
    const target = this.path[this.pathIdx];
    if (!target) {
      this.stop();
      return 'arrived';
    }
    const dx = target[0] - this.x;
    const dz = target[1] - this.z;
    const d = Math.hypot(dx, dz);
    const sp = this.speed * (this.run ? 1.9 : 1);
    const step = sp * dt;
    if (d <= Math.max(step, 0.04)) {
      this.x = target[0];
      this.z = target[1];
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.stop();
        return 'arrived';
      }
    } else {
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt);
    }
    this.lastProgress += step;
    this.stuckT += dt;
    if (this.stuckT > 1) {
      this.stuckT = 0;
      this.lastProgress = 0;
    }
    return 'moving';
  }

  /** Push model transform + locomotion pose. */
  protected syncModel(dt: number, idlePose: Parameters<CharacterModel['setPose']>[0] = 'idle'): void {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.yaw;
    if (this.goal) {
      m.moveSpeed = this.speed * (this.run ? 1.9 : 1);
      m.setPose(this.run ? 'run' : 'walk');
    } else {
      m.setPose(idlePose);
    }
    m.update(dt);
    this.headPos.set(this.x, m.height + 0.05, this.z);
  }

  faceTowards(x: number, z: number): void {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }

  setBadge(kind: '' | 'vip' | 'cheat'): void {
    if (kind === this.badgeKind) return;
    this.badgeKind = kind;
    if (!kind) {
      if (this.badge) this.badge.visible = false;
      return;
    }
    if (!this.badge) {
      this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
      this.badge.scale.set(0.42, 0.42, 0.42);
      this.badge.renderOrder = 10;
      this.model.root.add(this.badge);
    }
    const m = this.badge.material as THREE.SpriteMaterial;
    m.map = badgeTexture(kind);
    m.needsUpdate = true;
    this.badge.visible = true;
    this.badge.position.set(0, this.model.height + 0.3, 0);
  }

  dispose(): void {
    if (this.badge) (this.badge.material as THREE.Material).dispose();
    this.model.dispose();
  }
}
