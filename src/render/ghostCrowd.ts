import * as THREE from 'three';

/** Most guests Ultra AFK draws (and lets in). */
export const GHOST_MAX = 10_000;

/** One person to draw: where they stand and what colour they are. */
export interface GhostDot {
  x: number;
  z: number;
  color: number;
  /** 0..1 (popping in or shrinking away). */
  scale: number;
}

/**
 * Ultra AFK's crowd: every guest is one plain six-sided post, all of them in a single
 * instanced draw call, so thousands cost about as much as one character.
 */
export class GhostCrowd {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(max = GHOST_MAX) {
    const geo = new THREE.CylinderGeometry(0.2, 0.24, 1.55, 6, 1);
    geo.translate(0, 0.775, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'ghostCrowd';
  }

  /** Draw exactly these people this frame. */
  set(dots: readonly GhostDot[]): void {
    const n = Math.min(dots.length, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const d = dots[i];
      const k = Math.max(0.01, d.scale);
      this.p.set(d.x, 0, d.z);
      this.s.set(k, k, k);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setHex(d.color));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
