import * as THREE from 'three';
import { mat, glow } from '../render/materials';
import { canvasTexture, labelTexture, makeCanvas } from '../render/textures';
import { FACADE_Z, SIDEWALK_Z0 } from './grid';

/** Garage width (metres) and the roll-up door. */
export const GARAGE_W = 6.6;
const DOOR_W = 5.6;
const DOOR_H = 2.6;
const H = 3.2;

/** Where bay `i` parks a car (lot-local, relative to the garage centre line `gx`). */
export function bayPos(gx: number, i: number): { x: number; z: number } {
  return { x: gx + (i % 2 === 0 ? -1.6 : 1.6), z: FACADE_Z - 3.3 - Math.floor(i / 2) * 6 };
}

let doorTex: THREE.CanvasTexture | null = null;
function rollerTexture(): THREE.CanvasTexture {
  if (doorTex) return doorTex;
  const { canvas, ctx } = makeCanvas(64, 128);
  ctx.fillStyle = '#d9d6cf';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 8) {
    ctx.fillStyle = '#b9b5ac';
    ctx.fillRect(0, y + 6, 64, 2);
    ctx.fillStyle = '#ecebe6';
    ctx.fillRect(0, y, 64, 1);
  }
  doorTex = canvasTexture(canvas, true);
  return doorTex;
}

/**
 * Your garage beside the house on Palm Avenue (lot-local frame, door facing the street):
 * concrete floor, lights, a roll-up door that opens when you come near, and the cars
 * you've parked inside.
 */
export class GarageModel {
  readonly root = new THREE.Group();
  private door: THREE.Mesh | null = null;
  private roof: THREE.Mesh | null = null;
  private doorK = 0;
  /** Centre line of the garage (lot-local x). */
  gx = 0;

  build(gx: number, depth: number, wallColor: number, trimColor: number, cars: THREE.Object3D[]): void {
    this.clear();
    this.gx = gx;
    const s = this.root;
    const z1 = FACADE_Z;
    const zc = z1 - depth / 2;
    const wall = mat(wallColor, { rough: 0.8 });
    const dark = mat(0x2b2b35, { rough: 0.6 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      s.add(mesh);
      return mesh;
    };
    const T = 0.25;
    // Floor, walls and roof
    add(new THREE.BoxGeometry(GARAGE_W, 0.06, depth), mat(0x8e8a84, { rough: 0.85 }), gx, 0.03, zc, false);
    add(new THREE.BoxGeometry(T, H, depth), wall, gx - GARAGE_W / 2, H / 2, zc);
    add(new THREE.BoxGeometry(T, H, depth), wall, gx + GARAGE_W / 2, H / 2, zc);
    add(new THREE.BoxGeometry(GARAGE_W + T, H, T), wall, gx, H / 2, z1 - depth);
    this.roof = add(new THREE.BoxGeometry(GARAGE_W + 0.5, 0.3, depth + 0.5), dark, gx, H + 0.15, zc + 0.1);
    // Front: piers either side of the door and a header above it
    const pier = (GARAGE_W - DOOR_W) / 2;
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(pier + T / 2, H, T), wall, gx + sx * (DOOR_W / 2 + pier / 2), H / 2, z1);
    add(new THREE.BoxGeometry(DOOR_W, H - DOOR_H, T), wall, gx, DOOR_H + (H - DOOR_H) / 2, z1);
    add(new THREE.BoxGeometry(GARAGE_W + 0.3, 0.08, 0.1), mat(trimColor, { emissive: trimColor, emissiveIntensity: 1.2 }), gx, H + 0.02, z1 + 0.2, false);
    // Roll-up door
    const tex = rollerTexture().clone();
    tex.repeat.set(DOOR_W / 2, DOOR_H / 2);
    tex.needsUpdate = true;
    this.door = add(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.3 }), gx, DOOR_H / 2, z1 + 0.02);
    // Sign and lamps
    const sign = add(new THREE.PlaneGeometry(3, 0.55), mat(0xffffff, { map: labelTexture('GARAGE', { w: 256, h: 48, color: `#${trimColor.toString(16).padStart(6, '0')}`, bg: '#14121a' }), emissive: 0xffffff, emissiveMap: labelTexture('GARAGE', { w: 256, h: 48, color: `#${trimColor.toString(16).padStart(6, '0')}`, bg: '#14121a' }), emissiveIntensity: 0.7 }), gx, H - 0.3, z1 + 0.14, false);
    sign.receiveShadow = false;
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.13, 10, 8), glow(0xffe2a8, 2), gx + sx * (DOOR_W / 2 + 0.25), 2.3, z1 + 0.22, false);
    // Strip lights inside
    for (let z = z1 - 2; z > z1 - depth; z -= 5) add(new THREE.BoxGeometry(0.2, 0.05, 2), glow(0xf4f8ff, 2.2), gx, H - 0.05, z, false);
    // Painted bay lines and the apron out to the sidewalk
    const line = mat(0xf2c230, { rough: 0.6 });
    for (let z = z1 - 0.6; z > z1 - depth + 0.5; z -= 6) add(new THREE.BoxGeometry(0.08, 0.01, 5), line, gx, 0.065, z - 2.5, false);
    add(new THREE.BoxGeometry(GARAGE_W - 0.4, 0.04, SIDEWALK_Z0 - z1 + 0.05), mat(0x9a948c, { rough: 0.9 }), gx, 0.02, (z1 + SIDEWALK_Z0) / 2, false);
    // Tool wall at the back
    add(new THREE.BoxGeometry(3, 1.2, 0.08), mat(0x3a3a42, { rough: 0.6 }), gx, 1.6, z1 - depth + 0.2, false);
    add(new THREE.BoxGeometry(1.6, 0.9, 0.5), mat(0xc8102e, { rough: 0.4, metal: 0.3 }), gx + 2.2, 0.45, z1 - depth + 0.45);
    // The cars
    cars.forEach((c, i) => {
      const p = bayPos(gx, i);
      c.position.set(p.x, 0, p.z);
      c.rotation.y = 0;
      c.userData.car = true;
      c.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
      s.add(c);
    });
    this.doorK = 0;
  }

  /** Open or close the door (0..1), smoothly. */
  update(dt: number, open: boolean, roof = true): void {
    if (this.roof) this.roof.visible = roof;
    const d = this.door;
    if (!d) return;
    this.doorK += ((open ? 1 : 0) - this.doorK) * Math.min(1, dt * 2.5);
    const k = this.doorK;
    // Rolls up into the header.
    d.scale.y = Math.max(0.06, 1 - k * 0.94);
    d.position.y = DOOR_H - (DOOR_H * d.scale.y) / 2;
  }

  get open(): number {
    return this.doorK;
  }

  clear(): void {
    for (const c of [...this.root.children]) {
      c.removeFromParent();
      // Car models may share geometry with the traffic: leave those alone.
      if (c.userData.car) continue;
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.door = null;
    this.roof = null;
  }
}
