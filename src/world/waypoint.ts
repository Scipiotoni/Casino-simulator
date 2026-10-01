import * as THREE from 'three';

/**
 * Your map waypoint out in the world (global frame): a tall golden beam you can see from
 * across town, a spinning marker and a pulsing ring on the ground.
 */
export class WaypointBeacon {
  readonly group = new THREE.Group();
  private beam: THREE.Mesh;
  private gem: THREE.Mesh;
  private ring: THREE.Mesh;
  private t = 0;

  constructor() {
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc53d, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    const geo = new THREE.CylinderGeometry(0.5, 0.9, 140, 12, 1, true);
    geo.translate(0, 70, 0);
    this.beam = new THREE.Mesh(geo, beamMat);
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: 0xffd76a, fog: false }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.8, 32), new THREE.MeshBasicMaterial({ color: 0xffc53d, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    for (const m of [this.beam, this.gem, this.ring]) m.frustumCulled = false;
    this.group.add(this.beam, this.gem, this.ring);
    this.group.visible = false;
  }

  /** Show it at a global point (null hides it). `near` = how far the player is from it. */
  update(dt: number, at: { x: number; z: number } | null, near: number): void {
    this.group.visible = !!at;
    if (!at) return;
    this.t += dt;
    this.group.position.set(at.x, 0, at.z);
    this.gem.position.y = 3.2 + Math.sin(this.t * 2) * 0.3;
    this.gem.rotation.y += dt * 1.5;
    const k = (this.t * 0.8) % 1;
    this.ring.scale.setScalar(1 + k * 1.5);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    // Fade the beam out as you walk up to it (and widen it far away so it stays visible).
    (this.beam.material as THREE.MeshBasicMaterial).opacity = Math.min(0.35, Math.max(0.05, (near - 6) / 60));
    this.beam.scale.set(1 + near / 150, 1, 1 + near / 150);
  }
}
