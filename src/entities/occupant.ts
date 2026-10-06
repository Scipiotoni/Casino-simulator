import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Someone sitting in a vehicle: a light figure (head, hair, torso, arms, thighs) in one mesh
 * with its colours baked in, cheap enough for every car in the traffic. The origin is the
 * seat (hips), facing +z; a driver's hands are on the wheel.
 */

export interface OccupantLook {
  skin: number;
  shirt: number;
  hair: number;
  /** A helmet instead of hair (soldiers). */
  helmet?: boolean;
  driver: boolean;
}

/** Heights above the seat: where the body and the head are (for hits). */
export const OCC_TOP = 0.86;
export const OCC_HEAD = 0.56;

const SKINS = [0xf1c7a5, 0xe0ac86, 0xc68a62, 0x9b6544, 0x6e4630, 0xf5d6c0];
const SHIRTS = [0xc8102e, 0x1f4fbf, 0x2f8f45, 0xf4f1ea, 0x17151f, 0xffc53d, 0x6a2cc2, 0xff8a1f, 0x2fb8c9, 0x8c9aa8, 0xff6fb5];
const HAIRS = [0x1c1410, 0x3b2516, 0x6b4a2a, 0xc9a05a, 0x8a8a8a, 0x2a1a12, 0xa0522d];

/** A random civilian (driver or passenger). */
export function randomLook(driver: boolean, rnd: () => number = Math.random): OccupantLook {
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length) % a.length];
  return { skin: pick(SKINS), shirt: pick(SHIRTS), hair: pick(HAIRS), driver };
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });

/** One figure as a mesh (its own geometry: colours baked in). */
export function occupantMesh(look: OccupantLook): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const part = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.rotateX(rx);
    geo.rotateZ(rz);
    geo.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };
  // Torso and head.
  part(new THREE.BoxGeometry(0.38, 0.5, 0.22), look.shirt, 0, 0.27, -0.02);
  part(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), look.skin, 0, 0.55, -0.01);
  part(new THREE.SphereGeometry(0.135, 12, 9), look.skin, 0, 0.7, 0);
  if (look.helmet) part(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), look.hair, 0, 0.72, -0.01);
  else part(new THREE.SphereGeometry(0.145, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.1), look.hair, 0, 0.72, -0.02);
  // Arms: on the wheel, or resting in the lap.
  for (const sx of [-1, 1]) {
    if (look.driver) {
      part(new THREE.BoxGeometry(0.09, 0.09, 0.42), look.shirt, sx * 0.2, 0.42, 0.15, 0.55);
      part(new THREE.BoxGeometry(0.08, 0.08, 0.08), look.skin, sx * 0.16, 0.3, 0.37);
    } else {
      part(new THREE.BoxGeometry(0.09, 0.36, 0.09), look.shirt, sx * 0.23, 0.3, 0.0, 0, sx * 0.12);
      part(new THREE.BoxGeometry(0.08, 0.08, 0.2), look.skin, sx * 0.2, 0.1, 0.12);
    }
    // Thighs forward along the seat (hidden under the dash, mostly).
    part(new THREE.BoxGeometry(0.15, 0.14, 0.42), 0x2a3550, sx * 0.1, 0.03, 0.2);
  }
  const geo = mergeGeometries(parts)!;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  return mesh;
}
