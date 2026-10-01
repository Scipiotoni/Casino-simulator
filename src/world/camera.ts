import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../core/math';

export type CamMode = 'top' | 'third' | 'first';

/**
 * Angled top-down camera that trails the player, with zoom, 90° rotation and shake; a
 * third-person camera that sits behind the player and turns with them; or first person,
 * looking out of the manager's own eyes (mouse look, aim down sights, recoil).
 */
export class CameraRig {
  mode: CamMode = 'top';
  /** Third-person distance (zoomed separately from the top-down view). */
  thirdDist = 5.5;
  private thirdTarget = 5.5;
  /** Heading of the followed character (third-person). */
  followYaw = 0;
  yaw = 0;
  yawTarget = 0;
  dist = 17;
  distTarget = 17;
  readonly minDist = 8;
  readonly maxDist = 36;
  readonly focus = new THREE.Vector3();
  private shakeAmt = 0;
  private shakeT = 0;
  orbit = false;
  private orbitCenter = new THREE.Vector3();
  /** First person: where the eyes are, which way they look, and how far zoomed in. */
  readonly eye = new THREE.Vector3();
  lookYaw = 0;
  pitch = 0;
  /** Recoil kick added on top of the pitch (recovers by itself). */
  kick = 0;
  /** Sideways recoil wobble. */
  kickYaw = 0;
  fovTarget = 72;
  /** First person with the mouse free: where the cursor aims on screen (-1..1), or null for the centre. */
  aimNdc: { x: number; y: number } | null = null;
  private bob = 0;
  /** Walking speed for the head bob (m/s). */
  bobSpeed = 0;
  /** Behind the wheel: a low chase camera that looks down the road to the horizon. */
  chase = false;
  /** Car speed (m/s) for the chase camera's speed feel. */
  chaseSpeed = 0;
  private chaseK = 0;
  private chaseFov = 0;
  private readonly baseFov: number;
  private readonly baseNear: number;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.baseFov = camera.fov;
    this.baseNear = camera.near;
  }

  /** The direction you're looking in first person (unit vector). */
  lookDir(out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.pitch + this.kick;
    const y = this.lookYaw + this.kickYaw;
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
  }

  snap(x: number, z: number): void {
    this.focus.set(x, 0, z);
    this.yaw = this.yawTarget;
    this.dist = this.distTarget;
  }

  rotate(dir: number): void {
    this.yawTarget += (dir * Math.PI) / 2;
  }

  /** Third-person distance (e.g. further back while driving). */
  setThirdDist(d: number): void {
    this.thirdTarget = clamp(d, 3, 14);
  }

  zoomBy(factor: number): void {
    if (this.mode === 'first') return;
    if (this.mode === 'third') this.thirdTarget = clamp(this.thirdTarget * factor, 3, 14);
    else this.distTarget = clamp(this.distTarget * factor, this.minDist, this.maxDist);
  }

  setMode(mode: CamMode): void {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (mode === 'first') {
      this.lookYaw = this.followYaw;
      this.pitch = 0;
    }
    if (was === 'first') {
      // Back to the normal lens.
      this.camera.fov = this.camera.aspect < 0.8 ? 52 : this.baseFov;
      this.camera.near = this.baseNear;
      this.camera.updateProjectionMatrix();
      this.yaw = this.lookYaw + Math.PI;
      this.yawTarget = this.yaw;
    }
    if (mode === 'top') {
      // Snap back to the nearest 90° view so walls cut away cleanly.
      this.yawTarget = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
    }
  }

  /** True while the camera is low behind the player (walls need to cut away earlier). */
  get low(): boolean {
    return this.mode !== 'top';
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  setOrbit(on: boolean, cx = 0, cz = 0): void {
    this.orbit = on;
    this.orbitCenter.set(cx, 0, cz);
  }

  /** Movement basis for "up on screen" (forward) and "right on screen". */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  update(dt: number, tx: number, tz: number): void {
    if (this.mode === 'first' && !this.orbit) {
      const cam = this.camera;
      this.focus.set(tx, 0, tz);
      // Movement basis follows where you look.
      this.yaw = this.lookYaw + Math.PI;
      this.yawTarget = this.yaw;
      this.kick = damp(this.kick, 0, 9, dt);
      this.kickYaw = damp(this.kickYaw, 0, 9, dt);
      if (Math.abs(cam.fov - this.fovTarget) > 0.05 || cam.near !== 0.04) {
        cam.fov = damp(cam.fov, this.fovTarget, 14, dt);
        cam.near = 0.04;
        cam.updateProjectionMatrix();
      }
      this.bob += dt * this.bobSpeed * 2.2;
      const bobAmt = Math.min(1, this.bobSpeed / 4) * 0.035;
      cam.position.set(this.eye.x, this.eye.y + Math.abs(Math.sin(this.bob)) * bobAmt, this.eye.z);
      if (this.shakeAmt > 0.001) {
        this.shakeT += dt * 40;
        cam.position.x += Math.sin(this.shakeT * 1.3) * this.shakeAmt * 0.3;
        cam.position.y += Math.sin(this.shakeT * 1.7) * this.shakeAmt * 0.3;
        this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
      }
      cam.rotation.order = 'YXZ';
      cam.rotation.set(this.pitch + this.kick, this.lookYaw + this.kickYaw + Math.PI, Math.sin(this.bob * 0.5) * bobAmt * 0.3);
      return;
    }
    if (this.mode === 'third' && !this.orbit) {
      this.focus.x = damp(this.focus.x, tx, 12, dt);
      this.focus.z = damp(this.focus.z, tz, 12, dt);
      this.yawTarget = this.followYaw + Math.PI;
      this.yaw = dampAngle(this.yaw, this.yawTarget, 5, dt);
      this.thirdDist = damp(this.thirdDist, this.thirdTarget, 8, dt);
      this.chaseK = damp(this.chaseK, this.chase ? 1 : 0, 4, dt);
      const pitch = lerp(lerp(0.28, 0.5, (this.thirdDist - 3) / 8), 0.13, this.chaseK);
      const horiz = Math.cos(pitch) * this.thirdDist;
      const cam = this.camera;
      cam.position.set(
        this.focus.x + Math.sin(this.yaw) * horiz,
        1.4 + Math.sin(pitch) * this.thirdDist,
        this.focus.z + Math.cos(this.yaw) * horiz,
      );
      if (this.shakeAmt > 0.001) {
        this.shakeT += dt * 40;
        cam.position.x += Math.sin(this.shakeT * 1.3) * this.shakeAmt;
        cam.position.y += Math.sin(this.shakeT * 1.7) * this.shakeAmt * 0.6;
        this.shakeAmt = damp(this.shakeAmt, 0, 5, dt);
      }
      // Chasing a car: look well ahead of it (the road and the horizon), and widen the lens with speed.
      const ahead = 14 * this.chaseK;
      cam.lookAt(this.focus.x - Math.sin(this.yaw) * ahead, 1.25 - 0.2 * this.chaseK, this.focus.z - Math.cos(this.yaw) * ahead);
      const fov = this.chaseK * Math.min(14, Math.abs(this.chaseSpeed) * 0.3);
      if (Math.abs(fov - this.chaseFov) > 0.05) {
        this.chaseFov = damp(this.chaseFov, fov, 3, dt);
        cam.fov = (cam.aspect < 0.8 ? 52 : this.baseFov) + this.chaseFov;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (this.orbit) {
      this.yawTarget += dt * 0.06;
      this.yaw = this.yawTarget;
      this.focus.x = damp(this.focus.x, this.orbitCenter.x, 2, dt);
      this.focus.z = damp(this.focus.z, this.orbitCenter.z, 2, dt);
      this.distTarget = 27;
    } else {
      this.focus.x = damp(this.focus.x, tx, 7, dt);
      this.focus.z = damp(this.focus.z, tz, 7, dt);
    }
    this.yaw = dampAngle(this.yaw, this.yawTarget, 9, dt);
    this.dist = damp(this.dist, this.distTarget, 8, dt);
    const zt = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    const pitch = lerp(0.82, 1.08, zt);
    const horiz = Math.cos(pitch) * this.dist;
    const cam = this.camera;
    cam.position.set(
      this.focus.x + Math.sin(this.yaw) * horiz,
      Math.sin(pitch) * this.dist,
      this.focus.z + Math.cos(this.yaw) * horiz,
    );
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 40;
      cam.position.x += Math.sin(this.shakeT * 1.3) * this.shakeAmt;
      cam.position.y += Math.sin(this.shakeT * 1.7) * this.shakeAmt * 0.6;
      cam.position.z += Math.cos(this.shakeT * 1.1) * this.shakeAmt;
      this.shakeAmt = damp(this.shakeAmt, 0, 5, dt);
    }
    cam.lookAt(this.focus.x, 0.6, this.focus.z);
  }
}
