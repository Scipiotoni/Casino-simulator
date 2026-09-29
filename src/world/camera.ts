import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../core/math';

/** Angled top-down camera that trails the player, with zoom, 90° rotation and shake. */
export class CameraRig {
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

  constructor(private camera: THREE.PerspectiveCamera) {}

  snap(x: number, z: number): void {
    this.focus.set(x, 0, z);
    this.yaw = this.yawTarget;
    this.dist = this.distTarget;
  }

  rotate(dir: number): void {
    this.yawTarget += (dir * Math.PI) / 2;
  }

  zoomBy(factor: number): void {
    this.distTarget = clamp(this.distTarget * factor, this.minDist, this.maxDist);
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
