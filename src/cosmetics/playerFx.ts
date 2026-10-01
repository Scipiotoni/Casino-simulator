import * as THREE from 'three';
import type { CharacterModel } from '../entities/characterModel';
import { mat, glow, gold } from '../render/materials';
import { disposeTree } from '../items/models/common';
import { softDotTexture } from '../render/textures';

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function makeDie(size: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat(0xf6f1e6, { rough: 0.3 })));
  const pip = new THREE.CircleGeometry(size * 0.09, 10);
  const pipMat = mat(0xc8102e, { rough: 0.4 });
  const faces: [THREE.Euler, number][] = [
    [new THREE.Euler(0, 0, 0), 1], [new THREE.Euler(0, Math.PI, 0), 6], [new THREE.Euler(0, Math.PI / 2, 0), 3],
    [new THREE.Euler(0, -Math.PI / 2, 0), 4], [new THREE.Euler(-Math.PI / 2, 0, 0), 2], [new THREE.Euler(Math.PI / 2, 0, 0), 5],
  ];
  for (const [rot, n] of faces) {
    const face = new THREE.Group();
    face.rotation.copy(rot);
    for (const [px, py] of PIPS[n]) {
      const m = new THREE.Mesh(pip, pipMat);
      m.position.set(px * size * 0.25, py * size * 0.25, size / 2 + 0.002);
      face.add(m);
    }
    g.add(face);
  }
  return g;
}

function makePup(golden: boolean): THREE.Group {
  const g = new THREE.Group();
  const fur = golden ? gold() : mat(0xd9a066, { rough: 0.8 });
  const dark = golden ? gold() : mat(0x6b3f22, { rough: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 10), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), fur);
  head.position.set(0, 0.33, 0.17);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), dark);
  snout.position.set(0, 0.31, 0.27);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat(0x111111));
  nose.position.set(0, 0.33, 0.315);
  g.add(body, head, snout, nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark);
    ear.scale.set(0.6, 1.3, 0.6);
    ear.position.set(sx * 0.08, 0.38, 0.13);
    g.add(ear);
    for (const fz of [-0.1, 0.1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), dark);
      leg.position.set(sx * 0.06, 0.07, fz);
      g.add(leg);
    }
  }
  // Bow tie
  const bow = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), mat(0xc8102e, { emissive: 0x400000 }));
  bow.scale.set(1.6, 0.6, 0.5);
  bow.position.set(0, 0.25, 0.22);
  g.add(bow);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.14, 6), fur);
  tail.position.set(0, 0.3, -0.18);
  tail.rotation.x = -0.7;
  tail.name = 'tail';
  g.add(tail);
  return g;
}

function makeCrown(): THREE.Group {
  const g = new THREE.Group();
  const shiny = new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 1, roughness: 0.18, emissive: 0x8a5a00, emissiveIntensity: 0.9 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 20, 1, true), shiny);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), shiny);
    spike.position.set(Math.sin(a) * 0.19, 0.15, Math.cos(a) * 0.19);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), shiny);
    ball.position.set(Math.sin(a) * 0.19, 0.26, Math.cos(a) * 0.19);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), glow([0xff3fa4, 0x2fe6ff, 0x39ff88, 0xc8102e][i % 4], 2.8));
    gem.position.set(Math.sin(a) * 0.205, 0.0, Math.cos(a) * 0.205);
    g.add(spike, ball, gem);
  }
  // A soft golden glow so it reads from across the room.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xffd24a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(0.9, 0.6, 1);
  halo.position.y = 0.12;
  g.add(halo);
  return g;
}

function makeSparkles(n: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.PointsMaterial({ color: 0xffe27a, size: 0.14, map: softDotTexture(), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const p = new THREE.Points(geo, m);
  p.frustumCulled = false;
  p.userData.seed = Array.from({ length: n }, () => [Math.random() * Math.PI * 2, 0.35 + Math.random() * 0.6, Math.random() * 2.4, 0.6 + Math.random()]);
  return p;
}

/**
 * The character cosmetics on one model (you or another player). `set` switches the list,
 * `update` animates everything.
 */
export class PlayerFx {
  private group = new THREE.Group();
  private headGroup = new THREE.Group();
  private key = '';
  private t = Math.random() * 10;
  private pup: THREE.Group | null = null;
  private pupPos = new THREE.Vector3();
  private pupYaw = 0;
  private dice: THREE.Group[] = [];
  private sparkles: THREE.Points | null = null;

  constructor(private model: CharacterModel) {
    model.root.add(this.group);
    model.headAnchor.add(this.headGroup);
  }

  set(ids: string[]): void {
    const key = [...ids].sort().join(',');
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children, ...this.headGroup.children]) {
      c.removeFromParent();
      disposeTree(c);
    }
    this.pup?.removeFromParent();
    if (this.pup) disposeTree(this.pup);
    this.pup = null;
    this.dice = [];
    this.sparkles = null;
    if (ids.includes('crown')) {
      const c = makeCrown();
      c.position.y = 0.46;
      c.name = 'crown';
      this.headGroup.add(c);
    }
    if (ids.includes('halo')) {
      const halo = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.04, 10, 40), glow(0xfff4d6, 3.6));
      ring.rotation.x = Math.PI / 2;
      const shine = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xfff1b8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      shine.scale.set(1.1, 0.5, 1);
      halo.add(ring, shine);
      halo.position.y = ids.includes('crown') ? 0.82 : 0.6;
      halo.name = 'halo';
      this.headGroup.add(halo);
    }
    if (ids.includes('sparkle')) {
      this.sparkles = makeSparkles(130);
      this.group.add(this.sparkles);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ map: softDotTexture(), color: 0xffd24a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.03;
      disc.name = 'glowdisc';
      this.group.add(disc);
    }
    if (ids.includes('dice')) {
      for (let i = 0; i < 2; i++) {
        const d = makeDie(0.3);
        this.dice.push(d);
        this.group.add(d);
      }
    }
    const pupKind = ids.includes('goldpup') ? 'gold' : ids.includes('pup') ? 'plain' : null;
    if (pupKind) {
      // The pup lives in world space (it follows rather than being glued to you).
      this.pup = makePup(pupKind === 'gold');
      this.pup.scale.setScalar(1.7);
      this.model.root.parent?.add(this.pup);
      this.pupPos.copy(this.model.root.position);
    }
  }

  update(dt: number, visible = true): void {
    this.t += dt;
    const t = this.t;
    this.group.visible = visible;
    this.headGroup.visible = visible;
    if (this.sparkles) {
      const pos = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const seeds = this.sparkles.userData.seed as number[][];
      seeds.forEach(([a, r, h, sp], i) => {
        const y = (h + t * 0.5 * sp) % 2.4;
        const ang = a + t * sp * 1.4;
        pos.setXYZ(i, Math.sin(ang) * r, y, Math.cos(ang) * r);
      });
      pos.needsUpdate = true;
      (this.sparkles.material as THREE.PointsMaterial).opacity = 0.65 + Math.sin(t * 6) * 0.3;
    }
    this.dice.forEach((d, i) => {
      const a = t * 1.6 + i * Math.PI;
      d.position.set(Math.sin(a) * 1.0, 1.25 + Math.sin(t * 2 + i) * 0.15, Math.cos(a) * 1.0);
      d.rotation.set(t * 1.3 + i, t * 1.7, t * 0.9);
    });
    const halo = this.headGroup.getObjectByName('halo');
    if (halo) {
      halo.position.y = (this.key.includes('crown') ? 0.82 : 0.6) + Math.sin(t * 2.5) * 0.03;
      halo.rotation.y = t * 0.8;
    }
    const crown = this.headGroup.getObjectByName('crown');
    if (crown) crown.rotation.y = t * 0.6;
    const disc = this.group.getObjectByName('glowdisc') as THREE.Mesh | undefined;
    if (disc) (disc.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 3) * 0.15;
    if (this.pup) {
      if (!this.pup.parent && this.model.root.parent) this.model.root.parent.add(this.pup);
      this.pup.visible = visible && this.model.root.visible;
      // Trot to a spot just behind and beside the owner.
      const root = this.model.root;
      const yaw = root.rotation.y;
      const target = new THREE.Vector3(root.position.x - Math.sin(yaw) * 0.8 + Math.cos(yaw) * 0.45, root.position.y, root.position.z - Math.cos(yaw) * 0.8 - Math.sin(yaw) * 0.45);
      const d = target.clone().sub(this.pupPos);
      const dist = d.length();
      if (dist > 6) this.pupPos.copy(target);
      else if (dist > 0.05) {
        const step = Math.min(dist, dt * (2 + dist * 3));
        this.pupPos.addScaledVector(d.normalize(), step);
        this.pupYaw = Math.atan2(d.x, d.z);
      }
      const moving = dist > 0.12;
      this.pup.position.set(this.pupPos.x, this.pupPos.y + (moving ? Math.abs(Math.sin(t * 14)) * 0.05 : 0), this.pupPos.z);
      this.pup.rotation.y += ((((moving ? this.pupYaw : yaw) - this.pup.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 8);
      const tail = this.pup.getObjectByName('tail');
      if (tail) tail.rotation.z = Math.sin(t * 16) * 0.5;
    }
  }

  dispose(): void {
    this.set([]);
    this.group.removeFromParent();
    this.headGroup.removeFromParent();
  }
}
