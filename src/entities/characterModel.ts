import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance, EyeStyle } from './appearance';
import { damp } from '../core/math';
import { blobShadowTexture } from '../render/textures';

/**
 * Procedural chibi characters. Every rigid body part (head, torso, each limb) is merged into
 * a single vertex-coloured geometry so a fully dressed character costs ~7 draw calls.
 */

type Bone = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

export type Expression = 'neutral' | 'happy' | 'excited' | 'sad' | 'angry' | 'surprised' | 'blink';

export type Pose =
  | 'idle' | 'walk' | 'run' | 'sneak' | 'sit' | 'sitPlay' | 'lever' | 'standPlay' | 'cheer' | 'celebrate' | 'dance'
  | 'angry' | 'sad' | 'repair' | 'sweep' | 'deal' | 'bartend' | 'drink' | 'wave' | 'clap' | 'point' | 'handsUp'
  | 'sing' | 'think' | 'phone' | 'crouch' | 'sleep' | 'ko' | 'box' | 'drum' | 'strum';

const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
const SHINY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 });
const FACE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 });
export const GOLD_STATUE = new THREE.MeshStandardMaterial({ color: 0xf2b632, roughness: 0.25, metalness: 1, emissive: 0x3a2200, emissiveIntensity: 0.4 });

let blobGeo: THREE.PlaneGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
function blobShadow(): THREE.Mesh {
  if (!blobGeo) {
    blobGeo = new THREE.PlaneGeometry(0.85, 0.85);
    blobGeo.rotateX(-Math.PI / 2);
    blobMat = new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.75 });
  }
  const m = new THREE.Mesh(blobGeo, blobMat!);
  m.position.y = 0.012;
  m.renderOrder = 1;
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function xf(
  g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx,
): THREE.BufferGeometry {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

function prep(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  const c = new THREE.Color(color);
  const n = out.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

class Parts {
  private lists: Record<Bone, { matte: THREE.BufferGeometry[]; shiny: THREE.BufferGeometry[] }> = {
    head: { matte: [], shiny: [] },
    torso: { matte: [], shiny: [] },
    armL: { matte: [], shiny: [] },
    armR: { matte: [], shiny: [] },
    legL: { matte: [], shiny: [] },
    legR: { matte: [], shiny: [] },
  };

  add(bone: Bone, g: THREE.BufferGeometry, color: number, shiny = false): void {
    this.lists[bone][shiny ? 'shiny' : 'matte'].push(prep(g, color));
  }

  build(bone: Bone): { geo: THREE.BufferGeometry; hasShiny: boolean } {
    const l = this.lists[bone];
    const matte = l.matte.length ? mergeGeometries(l.matte, false) : null;
    const shiny = l.shiny.length ? mergeGeometries(l.shiny, false) : null;
    l.matte.forEach((g) => g.dispose());
    l.shiny.forEach((g) => g.dispose());
    if (matte && shiny) {
      const both = mergeGeometries([matte, shiny], true);
      matte.dispose();
      shiny.dispose();
      both.computeBoundingSphere();
      return { geo: both, hasShiny: true };
    }
    const one = (matte ?? shiny)!;
    one.computeBoundingSphere();
    return { geo: one, hasShiny: false };
  }
}

// Geometry shorthands (fresh instances, transformed in place).
const sphere = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10);
const cyl = (rt: number, rb: number, h: number, seg = 14, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const torus = (r: number, t: number, arc = Math.PI * 2, rs = 6, ts = 16) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);

function starShape(r: number, inner = 0.45): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * rr;
    const y = -Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function heartShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -r);
  s.bezierCurveTo(r * 1.2, -r * 0.2, r * 0.8, r * 0.9, 0, r * 0.35);
  s.bezierCurveTo(-r * 0.8, r * 0.9, -r * 1.2, -r * 0.2, 0, -r);
  return s;
}

interface Dims {
  hipY: number;
  legLen: number;
  torsoW: number;
  torsoH: number;
  torsoD: number;
  shoulderX: number;
  neckY: number;
}

export function dimsFor(a: Appearance): Dims {
  let torsoW = 0.38;
  let torsoD = 0.26;
  let torsoH = 0.4;
  let legLen = 0.4;
  if (a.body === 'slim') {
    torsoW *= 0.86;
    torsoD *= 0.9;
  } else if (a.body === 'round') {
    torsoW *= 1.2;
    torsoD *= 1.3;
  } else if (a.body === 'tall') {
    legLen *= 1.2;
    torsoH *= 1.08;
    torsoW *= 0.95;
  }
  return { hipY: legLen, legLen, torsoW, torsoH, torsoD, shoulderX: torsoW / 2 + 0.045, neckY: legLen + torsoH };
}

const HEAD_R = 0.23;
const EYE_Y = 0.215;
const EYE_X = 0.085;
const EYE_Z = 0.196;

// ---------------------------------------------------------------- body parts

function buildHead(p: Parts, a: Appearance): void {
  const skin = a.skin;
  p.add('head', xf(sphere(HEAD_R, 22, 16), 0, 0.2, 0, 0, 0, 0, 1, 0.96, 0.95), skin);
  p.add('head', xf(sphere(0.055, 10, 8), -0.222, 0.19, 0, 0, 0, 0, 0.55, 0.85, 0.7), skin);
  p.add('head', xf(sphere(0.055, 10, 8), 0.222, 0.19, 0, 0, 0, 0, 0.55, 0.85, 0.7), skin);
  p.add('head', xf(sphere(0.03, 10, 8), 0, 0.155, 0.218), shade(skin, 0.94));
  if (a.blush) {
    p.add('head', xf(sphere(0.04, 10, 8), -0.125, 0.125, 0.176, 0, -0.5, 0, 1, 0.55, 0.3), 0xff8fa3);
    p.add('head', xf(sphere(0.04, 10, 8), 0.125, 0.125, 0.176, 0, 0.5, 0, 1, 0.55, 0.3), 0xff8fa3);
  }
  buildHair(p, a);
  buildHat(p, a);
  buildEyewear(p, a);
  buildFacialHair(p, a);
}

function capGeo(r: number, theta: number, tilt = -0.28): THREE.BufferGeometry {
  return xf(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, theta), 0, 0.2, 0, tilt, 0, 0);
}

function buildHair(p: Parts, a: Appearance): void {
  const c = a.hairColor;
  const hatCovers = ['tophat', 'cowboy', 'beanie', 'hardhat', 'chef', 'cap', 'fedora'].includes(a.hat);
  switch (a.hair) {
    case 'bald':
      break;
    case 'buzz':
      p.add('head', xf(capGeo(0.236, Math.PI * 0.43), 0, 0, 0, 0, 0, 0, 1, 0.97, 0.97), c);
      break;
    case 'short':
      p.add('head', capGeo(0.246, Math.PI * 0.5), c);
      p.add('head', xf(sphere(0.13, 12, 8), 0.04, 0.37, 0.12, 0.3, 0, -0.3, 1.4, 0.45, 0.8), c);
      break;
    case 'spiky':
      p.add('head', capGeo(0.242, Math.PI * 0.46), c);
      if (!hatCovers) {
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2;
          const tilt = 0.55;
          p.add('head', xf(cone(0.06, 0.2, 6), Math.sin(ang) * 0.12, 0.44, Math.cos(ang) * 0.12 - 0.02, Math.cos(ang) * tilt, 0, -Math.sin(ang) * tilt), c);
        }
        p.add('head', xf(cone(0.065, 0.22, 6), 0, 0.5, 0, 0, 0, 0), c);
      }
      break;
    case 'long':
      p.add('head', capGeo(0.248, Math.PI * 0.52), c);
      p.add('head', xf(rbox(0.46, 0.46, 0.2, 0.08), 0, 0.1, -0.12), c);
      p.add('head', xf(rbox(0.1, 0.36, 0.14, 0.05), -0.2, 0.12, 0.02), c);
      p.add('head', xf(rbox(0.1, 0.36, 0.14, 0.05), 0.2, 0.12, 0.02), c);
      p.add('head', xf(sphere(0.13, 12, 8), -0.05, 0.37, 0.12, 0.3, 0, 0.3, 1.5, 0.45, 0.8), c);
      break;
    case 'bob':
      p.add('head', capGeo(0.25, Math.PI * 0.55), c);
      p.add('head', xf(cyl(0.262, 0.27, 0.2, 20, true), 0, 0.14, -0.02, 0, 0, 0, 1, 1, 0.95), c);
      p.add('head', xf(rbox(0.4, 0.08, 0.1, 0.03), 0, 0.36, 0.17, 0.3, 0, 0), c);
      break;
    case 'ponytail':
      p.add('head', capGeo(0.246, Math.PI * 0.5), c);
      p.add('head', xf(sphere(0.07, 10, 8), 0, 0.36, -0.22), c);
      p.add('head', xf(capsule(0.06, 0.18), 0, 0.2, -0.3, 0.35, 0, 0), c);
      break;
    case 'bun':
      p.add('head', capGeo(0.244, Math.PI * 0.5), c);
      if (!hatCovers) p.add('head', xf(sphere(0.1, 12, 10), 0, 0.46, -0.08), c);
      break;
    case 'slick':
      p.add('head', capGeo(0.244, Math.PI * 0.48), c);
      if (!hatCovers) p.add('head', xf(capsule(0.08, 0.16), 0, 0.42, 0.09, 0, 0, Math.PI / 2, 1, 1, 1.25), c);
      break;
    case 'curly':
      p.add('head', capGeo(0.244, Math.PI * 0.5), c);
      for (let i = 0; i < 16; i++) {
        const u = i / 16;
        const theta = u * Math.PI * 2 * 3;
        const phi = 0.3 + u * 1.0;
        const r = 0.255;
        const x = Math.sin(phi) * Math.sin(theta) * r;
        const y = 0.2 + Math.cos(phi) * r;
        const z = Math.sin(phi) * Math.cos(theta) * r;
        if (z > 0.15 && y < 0.38) continue;
        p.add('head', xf(sphere(0.07, 8, 6), x, y, z - 0.02), c);
      }
      break;
    case 'afro':
      p.add('head', xf(sphere(0.31, 18, 14), 0, 0.36, -0.1), c);
      break;
    case 'mohawk':
      p.add('head', xf(capGeo(0.234, Math.PI * 0.44), 0, 0, 0, 0, 0, 0, 1, 0.97, 0.97), shade(c, 0.6));
      if (!hatCovers) {
        for (let i = 0; i < 6; i++) {
          const t = -0.2 + i * 0.08;
          const ang = t * 3.5;
          p.add('head', xf(box(0.05, 0.16, 0.09), 0, 0.2 + Math.cos(ang) * 0.27, Math.sin(ang) * 0.27, ang, 0, 0), c);
        }
      }
      break;
  }
}

function buildHat(p: Parts, a: Appearance): void {
  const c = a.hatColor;
  const band = shade(c, 0.55);
  switch (a.hat) {
    case 'none':
      break;
    case 'tophat':
      p.add('head', xf(cyl(0.3, 0.3, 0.03, 22), 0, 0.41, 0, -0.1, 0, 0), c);
      p.add('head', xf(cyl(0.19, 0.19, 0.34, 20), 0, 0.59, -0.02, -0.1, 0, 0), c);
      p.add('head', xf(cyl(0.195, 0.195, 0.06, 20), 0, 0.46, -0.01, -0.1, 0, 0), 0xc8102e);
      break;
    case 'fedora':
      p.add('head', xf(cyl(0.33, 0.33, 0.025, 22), 0, 0.4, 0, -0.12, 0, 0), c);
      p.add('head', xf(cyl(0.16, 0.2, 0.17, 18), 0, 0.49, -0.015, -0.12, 0, 0), c);
      p.add('head', xf(cyl(0.2, 0.205, 0.045, 18), 0, 0.435, -0.005, -0.12, 0, 0), band);
      break;
    case 'cowboy':
      p.add('head', xf(cyl(0.42, 0.42, 0.022, 24), 0, 0.37, 0, -0.1, 0, 0, 1, 1, 0.85), c);
      p.add('head', xf(capsule(0.04, 0.42), -0.37, 0.41, -0.01, Math.PI / 2, 0, 0.35, 1, 1, 1), c);
      p.add('head', xf(capsule(0.04, 0.42), 0.37, 0.41, -0.01, Math.PI / 2, 0, -0.35, 1, 1, 1), c);
      p.add('head', xf(sphere(0.21, 16, 10), 0, 0.46, -0.02, -0.1, 0, 0, 1, 0.8, 1.05), c);
      p.add('head', xf(cyl(0.215, 0.215, 0.04, 18), 0, 0.41, -0.01, -0.1, 0, 0), band);
      break;
    case 'cap':
      p.add('head', xf(new THREE.SphereGeometry(0.25, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.22, 0, -0.18, 0, 0), c);
      p.add('head', xf(cyl(0.16, 0.16, 0.02, 16), 0, 0.33, 0.22, -0.18, 0, 0, 1, 1, 0.9), c);
      p.add('head', xf(sphere(0.025, 8, 6), 0, 0.47, -0.05), band);
      break;
    case 'crown':
      p.add('head', xf(cyl(0.17, 0.16, 0.09, 16, true), 0, 0.44, -0.02, -0.1, 0, 0), 0xf2b632, true);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        p.add('head', xf(cone(0.045, 0.1, 6), Math.sin(ang) * 0.16, 0.53, Math.cos(ang) * 0.16 - 0.03), 0xf2b632, true);
        p.add('head', xf(sphere(0.022, 8, 6), Math.sin(ang) * 0.17, 0.44, Math.cos(ang) * 0.17 - 0.02), i % 2 ? 0xc8102e : 0x2fb8c9, true);
      }
      break;
    case 'beanie':
      p.add('head', xf(new THREE.SphereGeometry(0.255, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), 0, 0.2, 0, -0.2, 0, 0), c);
      p.add('head', xf(torus(0.24, 0.035, Math.PI * 2, 6, 20), 0, 0.28, 0.02, Math.PI / 2 - 0.2, 0, 0), band);
      p.add('head', xf(sphere(0.07, 10, 8), 0, 0.48, -0.05), 0xf4f1ea);
      break;
    case 'party':
      p.add('head', xf(cone(0.12, 0.3, 14), 0.06, 0.54, 0, 0, 0, -0.2), c);
      p.add('head', xf(sphere(0.045, 8, 6), 0.09, 0.7, 0), 0xffd23f);
      p.add('head', xf(torus(0.1, 0.018, Math.PI * 2, 5, 14), 0.045, 0.45, 0, Math.PI / 2, 0.2, 0), 0xffd23f);
      break;
    case 'hardhat':
      p.add('head', xf(new THREE.SphereGeometry(0.26, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.23, 0), c);
      p.add('head', xf(cyl(0.3, 0.3, 0.025, 20), 0, 0.24, 0.02, -0.05, 0, 0), c);
      p.add('head', xf(box(0.05, 0.03, 0.46), 0, 0.49, 0), shade(c, 0.85));
      break;
    case 'visor':
      p.add('head', xf(cyl(0.245, 0.245, 0.07, 20, true), 0, 0.33, 0), c);
      p.add('head', xf(cyl(0.16, 0.16, 0.02, 16), 0, 0.31, 0.24, -0.15, 0, 0, 1, 1, 0.9), c);
      break;
    case 'chef':
      p.add('head', xf(cyl(0.2, 0.2, 0.16, 18), 0, 0.44, -0.02), 0xf8f8f8);
      p.add('head', xf(sphere(0.23, 14, 10), 0, 0.6, -0.02, 0, 0, 0, 1, 0.75, 1), 0xf8f8f8);
      break;
    case 'beret':
      p.add('head', xf(sphere(0.24, 16, 10), 0.05, 0.42, -0.02, 0, 0, -0.25, 1, 0.35, 1), c);
      p.add('head', xf(cyl(0.012, 0.012, 0.05, 6), 0.07, 0.51, -0.02), band);
      break;
    case 'halo':
      p.add('head', xf(torus(0.17, 0.025, Math.PI * 2, 8, 24), 0, 0.62, -0.02, Math.PI / 2, 0, 0), 0xffe066, true);
      break;
    case 'horns':
      p.add('head', xf(cone(0.05, 0.16, 8), -0.13, 0.43, 0.02, 0, 0, 0.45), 0xc8102e);
      p.add('head', xf(cone(0.05, 0.16, 8), 0.13, 0.43, 0.02, 0, 0, -0.45), 0xc8102e);
      break;
  }
}

function buildEyewear(p: Parts, a: Appearance): void {
  const zf = EYE_Z + 0.03;
  switch (a.eyewear) {
    case 'none':
      break;
    case 'shades':
      p.add('head', xf(rbox(0.14, 0.085, 0.03, 0.02), -EYE_X, EYE_Y, zf, 0, -0.18, 0), 0x0d0b12, true);
      p.add('head', xf(rbox(0.14, 0.085, 0.03, 0.02), EYE_X, EYE_Y, zf, 0, 0.18, 0), 0x0d0b12, true);
      p.add('head', xf(box(0.06, 0.02, 0.02), 0, EYE_Y + 0.02, zf + 0.012), 0x0d0b12, true);
      p.add('head', xf(box(0.02, 0.02, 0.2), -0.215, EYE_Y + 0.01, 0.1), 0x0d0b12);
      p.add('head', xf(box(0.02, 0.02, 0.2), 0.215, EYE_Y + 0.01, 0.1), 0x0d0b12);
      break;
    case 'aviators':
      for (const s of [-1, 1]) {
        p.add('head', xf(sphere(0.062, 12, 8), s * EYE_X, EYE_Y - 0.005, zf, 0, s * 0.18, 0, 1.05, 0.95, 0.3), 0x3a2a12, true);
        p.add('head', xf(torus(0.063, 0.008, Math.PI * 2, 5, 16), s * EYE_X, EYE_Y - 0.005, zf + 0.004, 0, s * 0.18, 0), 0xf2b632, true);
        p.add('head', xf(box(0.015, 0.015, 0.2), s * 0.215, EYE_Y + 0.02, 0.1), 0xf2b632, true);
      }
      p.add('head', xf(box(0.06, 0.012, 0.012), 0, EYE_Y + 0.04, zf + 0.01), 0xf2b632, true);
      break;
    case 'glasses':
      for (const s of [-1, 1]) {
        p.add('head', xf(torus(0.056, 0.011, Math.PI * 2, 5, 16), s * EYE_X, EYE_Y, zf, 0, s * 0.18, 0), 0x1a1020);
        p.add('head', xf(box(0.015, 0.015, 0.2), s * 0.215, EYE_Y + 0.01, 0.1), 0x1a1020);
      }
      p.add('head', xf(box(0.05, 0.012, 0.012), 0, EYE_Y + 0.01, zf + 0.01), 0x1a1020);
      break;
    case 'monocle':
      p.add('head', xf(torus(0.058, 0.01, Math.PI * 2, 5, 16), EYE_X, EYE_Y, zf, 0, 0.18, 0), 0xf2b632, true);
      p.add('head', xf(cyl(0.004, 0.004, 0.18, 4), 0.12, EYE_Y - 0.1, zf - 0.02, 0, 0, 0.2), 0xf2b632, true);
      break;
    case 'hearts':
      for (const s of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(heartShape(0.06), { depth: 0.02, bevelEnabled: false });
        p.add('head', xf(g, s * EYE_X, EYE_Y, zf - 0.01, 0, s * 0.18, 0), 0xff4fa3, true);
      }
      p.add('head', xf(box(0.05, 0.012, 0.012), 0, EYE_Y + 0.02, zf + 0.01), 0xff4fa3);
      break;
    case 'stars':
      for (const s of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(starShape(0.075), { depth: 0.02, bevelEnabled: false });
        p.add('head', xf(g, s * EYE_X, EYE_Y, zf - 0.01, 0, s * 0.18, 0), 0xffc53d, true);
      }
      p.add('head', xf(box(0.05, 0.012, 0.012), 0, EYE_Y + 0.02, zf + 0.01), 0xffc53d);
      break;
  }
}

function buildFacialHair(p: Parts, a: Appearance): void {
  const c = a.hairColor;
  switch (a.facialHair) {
    case 'none':
      break;
    case 'mustache':
      p.add('head', xf(capsule(0.022, 0.05), -0.035, 0.125, 0.212, 0, 0.3, Math.PI / 2 - 0.25), c);
      p.add('head', xf(capsule(0.022, 0.05), 0.035, 0.125, 0.212, 0, -0.3, -Math.PI / 2 + 0.25), c);
      break;
    case 'handlebar':
      p.add('head', xf(capsule(0.02, 0.06), -0.04, 0.125, 0.212, 0, 0.3, Math.PI / 2 - 0.1), c);
      p.add('head', xf(capsule(0.02, 0.06), 0.04, 0.125, 0.212, 0, -0.3, -Math.PI / 2 + 0.1), c);
      p.add('head', xf(torus(0.025, 0.01, Math.PI * 1.2, 4, 8), -0.1, 0.14, 0.19, 0, -0.5, 0), c);
      p.add('head', xf(torus(0.025, 0.01, Math.PI * 1.2, 4, 8), 0.1, 0.14, 0.19, 0, 0.5, Math.PI - 0.6), c);
      break;
    case 'goatee':
      p.add('head', xf(rbox(0.07, 0.08, 0.04, 0.018), 0, 0.03, 0.19, 0.3, 0, 0), c);
      break;
    case 'beard':
      p.add('head', xf(new THREE.SphereGeometry(0.235, 18, 10, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.55, Math.PI * 0.3), 0, 0.22, 0, 0, 0, 0, 1.02, 1.05, 1), c);
      p.add('head', xf(rbox(0.16, 0.1, 0.08, 0.035), 0, 0.02, 0.15, 0.3, 0, 0), c);
      break;
  }
}

function buildTorso(p: Parts, a: Appearance, d: Dims): void {
  const { torsoW: W, torsoH: H, torsoD: D } = d;
  const top = a.topColor;
  const acc = a.accentColor;
  const shinyTop = a.top === 'sequin';
  const fz = D / 2;
  const lowerColor = a.top === 'dress' || a.top === 'overalls' ? top : a.bottom === 'skirt' ? a.bottomColor : a.bottomColor;
  // Pelvis (pants waistline)
  p.add('torso', xf(rbox(W * 0.94, 0.14, D * 0.95, 0.06), 0, 0.03, 0), lowerColor);
  // Neck
  p.add('torso', xf(cyl(0.07, 0.075, 0.1, 10), 0, H + 0.02, 0), a.skin);

  const body = (color: number, shiny = false) => p.add('torso', xf(rbox(W, H, D, 0.1), 0, H / 2 + 0.02, 0), color, shiny);

  switch (a.top) {
    case 'suit':
    case 'tux':
    case 'sequin': {
      body(top, shinyTop);
      p.add('torso', xf(box(0.13, H * 0.5, 0.02), 0, H - H * 0.22, fz + 0.002), acc);
      const lapel = a.top === 'tux' ? shade(top, 1.4) : shade(top, 0.8);
      p.add('torso', xf(box(0.05, H * 0.46, 0.02), -0.06, H - H * 0.24, fz + 0.01, 0, 0, -0.3), lapel, a.top !== 'suit');
      p.add('torso', xf(box(0.05, H * 0.46, 0.02), 0.06, H - H * 0.24, fz + 0.01, 0, 0, 0.3), lapel, a.top !== 'suit');
      const btn = a.top === 'sequin' ? 0xf2b632 : 0x17151f;
      p.add('torso', xf(sphere(0.018, 8, 6), 0, H * 0.3, fz + 0.01), btn, true);
      p.add('torso', xf(sphere(0.018, 8, 6), 0, H * 0.14, fz + 0.01), btn, true);
      if (a.top === 'sequin') {
        p.add('torso', xf(box(0.16, 0.14, 0.03), -0.1, H + 0.04, -D * 0.25, -0.35, 0, 0.35), acc, true);
        p.add('torso', xf(box(0.16, 0.14, 0.03), 0.1, H + 0.04, -D * 0.25, -0.35, 0, -0.35), acc, true);
        for (let i = 0; i < 8; i++) {
          p.add('torso', xf(sphere(0.02, 6, 4), (i % 2 ? 1 : -1) * (0.1 + (i % 3) * 0.02), 0.08 + i * 0.035, fz + 0.005), acc, true);
        }
      }
      break;
    }
    case 'tshirt':
      body(top);
      p.add('torso', xf(torus(0.075, 0.018, Math.PI * 2, 5, 14), 0, H + 0.005, 0, Math.PI / 2, 0, 0), shade(top, 0.8));
      break;
    case 'tank':
      body(top);
      p.add('torso', xf(box(0.16, 0.08, 0.02), 0, H - 0.02, fz + 0.001), a.skin);
      break;
    case 'hawaiian': {
      body(top);
      p.add('torso', xf(box(0.1, 0.1, 0.02), 0, H - 0.04, fz + 0.003, 0, 0, Math.PI / 4), a.skin);
      const spots: [number, number, number][] = [
        [-0.1, 0.3, 1], [0.08, 0.26, 1], [-0.04, 0.14, 1], [0.12, 0.1, 1], [-0.13, 0.06, 1],
        [-0.09, 0.28, -1], [0.1, 0.22, -1], [0, 0.1, -1],
      ];
      spots.forEach(([x, y, s], i) => {
        const col = i % 2 === 0 ? acc : 0xfff6e0;
        p.add('torso', xf(sphere(0.035, 8, 6), x * (W / 0.38), y * (H / 0.4), s * (fz + 0.003), 0, 0, 0, 1, 1, 0.3), col);
      });
      p.add('torso', xf(box(0.05, 0.04, 0.02), -0.06, H - 0.01, fz + 0.01, 0, 0, 0.6), shade(top, 0.85));
      p.add('torso', xf(box(0.05, 0.04, 0.02), 0.06, H - 0.01, fz + 0.01, 0, 0, -0.6), shade(top, 0.85));
      break;
    }
    case 'hoodie':
      body(top);
      p.add('torso', xf(torus(0.13, 0.05, Math.PI * 2, 6, 16), 0, H + 0.01, -0.05, Math.PI / 2 + 0.4, 0, 0, 1, 1, 0.8), shade(top, 0.9));
      p.add('torso', xf(rbox(W * 0.66, 0.1, 0.03, 0.02), 0, 0.12, fz + 0.005), shade(top, 0.85));
      p.add('torso', xf(box(0.012, 0.1, 0.012), -0.04, H - 0.08, fz + 0.012), acc);
      p.add('torso', xf(box(0.012, 0.1, 0.012), 0.04, H - 0.08, fz + 0.012), acc);
      break;
    case 'jacket':
      body(top);
      p.add('torso', xf(box(0.11, H * 0.45, 0.02), 0, H - H * 0.2, fz + 0.002), acc);
      p.add('torso', xf(box(0.012, H * 0.55, 0.012), 0.03, H * 0.3, fz + 0.012), 0xd8dde8, true);
      p.add('torso', xf(torus(0.1, 0.03, Math.PI * 2, 5, 14), 0, H, 0, Math.PI / 2, 0, 0, 1, 1, 0.8), shade(top, 0.85));
      break;
    case 'dress':
      p.add('torso', xf(rbox(W * 0.9, H * 0.75, D * 0.9, 0.09), 0, H * 0.62, 0), top);
      p.add('torso', xf(cone(W * 0.9, 0.46, 16), 0, -0.07, 0, 0, 0, 0, 1, 1, 0.85), top);
      p.add('torso', xf(cyl(W * 0.47, W * 0.47, 0.05, 16), 0, H * 0.28, 0, 0, 0, 0, 1, 1, 0.75), acc);
      break;
    case 'vest':
      body(acc);
      p.add('torso', xf(box(W * 0.42, H * 0.82, 0.03), -W * 0.26, H * 0.44, fz + 0.004, 0, 0, 0.05), top);
      p.add('torso', xf(box(W * 0.42, H * 0.82, 0.03), W * 0.26, H * 0.44, fz + 0.004, 0, 0, -0.05), top);
      p.add('torso', xf(box(W * 1.01, H * 0.9, 0.03), 0, H * 0.47, -fz - 0.004), top);
      p.add('torso', xf(sphere(0.014, 6, 4), -0.035, H * 0.35, fz + 0.02), 0xf2b632, true);
      p.add('torso', xf(sphere(0.014, 6, 4), -0.035, H * 0.2, fz + 0.02), 0xf2b632, true);
      break;
    case 'overalls':
      body(acc);
      p.add('torso', xf(box(W * 0.62, H * 0.5, 0.03), 0, H * 0.3, fz + 0.004), top);
      p.add('torso', xf(box(W * 1.01, H * 0.36, D * 1.02), 0, H * 0.18, 0), top);
      p.add('torso', xf(box(0.045, H * 0.6, 0.02), -W * 0.26, H * 0.7, fz + 0.006), top);
      p.add('torso', xf(box(0.045, H * 0.6, 0.02), W * 0.26, H * 0.7, fz + 0.006), top);
      p.add('torso', xf(box(0.045, H * 0.6, 0.02), -W * 0.26, H * 0.7, -fz - 0.006), top);
      p.add('torso', xf(box(0.045, H * 0.6, 0.02), W * 0.26, H * 0.7, -fz - 0.006), top);
      p.add('torso', xf(box(0.08, 0.06, 0.02), 0, H * 0.4, fz + 0.012), shade(top, 0.8));
      break;
    case 'trench':
      body(top);
      p.add('torso', xf(rbox(W * 1.08, 0.36, D * 1.1, 0.06), 0, -0.13, 0), top);
      p.add('torso', xf(box(W * 1.1, 0.05, D * 1.12), 0, 0.1, 0), acc);
      p.add('torso', xf(sphere(0.025, 8, 6), 0, 0.1, fz + 0.03), 0xc9a24a, true);
      p.add('torso', xf(box(0.16, 0.16, 0.03), -0.09, H + 0.02, fz - 0.02, -0.2, 0, 0.4), shade(top, 0.9));
      p.add('torso', xf(box(0.16, 0.16, 0.03), 0.09, H + 0.02, fz - 0.02, -0.2, 0, -0.4), shade(top, 0.9));
      break;
  }
  if (a.bottom === 'skirt' && a.top !== 'dress' && a.top !== 'trench') {
    p.add('torso', xf(cone(W * 0.82, 0.36, 16), 0, -0.05, 0, 0, 0, 0, 1, 1, 0.85), a.bottomColor);
  }
  buildNeck(p, a, d);
}

function buildNeck(p: Parts, a: Appearance, d: Dims): void {
  const { torsoH: H, torsoD: D } = d;
  const fz = D / 2 + 0.012;
  const c = a.neckColor;
  switch (a.neck) {
    case 'none':
      break;
    case 'tie':
      p.add('torso', xf(box(0.055, 0.035, 0.03), 0, H - 0.03, fz + 0.005), c);
      p.add('torso', xf(box(0.055, H * 0.55, 0.015), 0, H - 0.05 - H * 0.28, fz + 0.004, 0, 0, 0), c);
      p.add('torso', xf(box(0.04, 0.04, 0.015), 0, H - 0.05 - H * 0.55, fz + 0.004, 0, 0, Math.PI / 4), c);
      break;
    case 'bowtie':
      p.add('torso', xf(cone(0.045, 0.08, 8), -0.04, H - 0.035, fz + 0.02, 0, 0, -Math.PI / 2), c);
      p.add('torso', xf(cone(0.045, 0.08, 8), 0.04, H - 0.035, fz + 0.02, 0, 0, Math.PI / 2), c);
      p.add('torso', xf(sphere(0.022, 8, 6), 0, H - 0.035, fz + 0.025), shade(c, 0.8));
      break;
    case 'chain':
      p.add('torso', xf(torus(0.11, 0.013, Math.PI * 2, 5, 18), 0, H - 0.07, 0.05, -1.15, 0, 0), 0xf2b632, true);
      p.add('torso', xf(cyl(0.035, 0.035, 0.012, 12), 0, H - 0.17, fz + 0.012, Math.PI / 2, 0, 0), 0xf2b632, true);
      break;
    case 'pearls':
      for (let i = 0; i < 12; i++) {
        const ang = Math.PI * 0.15 + (i / 11) * Math.PI * 0.7;
        p.add('torso', xf(sphere(0.02, 6, 5), Math.cos(ang) * 0.11, H - 0.04 - Math.sin(ang) * 0.05, 0.02 + Math.sin(ang) * 0.1), 0xfaf5ec, true);
      }
      break;
    case 'scarf':
      p.add('torso', xf(torus(0.1, 0.045, Math.PI * 2, 6, 16), 0, H + 0.01, 0, Math.PI / 2, 0, 0), c);
      p.add('torso', xf(box(0.07, 0.2, 0.03), 0.07, H - 0.1, fz + 0.02, 0, 0, 0.1), c);
      break;
    case 'camera':
      p.add('torso', xf(torus(0.13, 0.008, Math.PI * 2, 4, 16), 0, H - 0.1, 0.02, -1.25, 0, 0), 0x17151f);
      p.add('torso', xf(rbox(0.12, 0.08, 0.06, 0.015), 0, H * 0.45, fz + 0.03), 0x2b2b35);
      p.add('torso', xf(cyl(0.028, 0.028, 0.05, 12), 0, H * 0.45, fz + 0.075, Math.PI / 2, 0, 0), 0x0d0b12, true);
      break;
  }
}

function sleeveInfo(a: Appearance): { upper: number; lower: number; cuff: number | null } {
  const skin = a.skin;
  switch (a.top) {
    case 'suit':
    case 'tux':
    case 'sequin':
      return { upper: a.topColor, lower: a.topColor, cuff: a.accentColor };
    case 'hoodie':
    case 'jacket':
    case 'trench':
      return { upper: a.topColor, lower: a.topColor, cuff: null };
    case 'vest':
      return { upper: a.accentColor, lower: a.accentColor, cuff: null };
    case 'tshirt':
    case 'hawaiian':
      return { upper: a.topColor, lower: skin, cuff: null };
    case 'overalls':
      return { upper: a.accentColor, lower: skin, cuff: null };
    case 'tank':
    case 'dress':
      return { upper: skin, lower: skin, cuff: null };
  }
}

function buildArm(p: Parts, a: Appearance, bone: 'armL' | 'armR'): void {
  const s = sleeveInfo(a);
  const shinySleeve = a.top === 'sequin';
  p.add(bone, xf(capsule(0.062, 0.1), 0, -0.085, 0), s.upper, shinySleeve && s.upper === a.topColor);
  p.add(bone, xf(capsule(0.055, 0.1), 0, -0.2, 0), s.lower, shinySleeve && s.lower === a.topColor);
  if (s.cuff !== null) p.add(bone, xf(cyl(0.058, 0.058, 0.035, 10), 0, -0.275, 0), s.cuff);
  p.add(bone, xf(sphere(0.062, 12, 10), 0, -0.315, 0.005), a.skin);
  if (bone === 'armR') buildProp(p, a);
}

function buildProp(p: Parts, a: Appearance): void {
  const hy = -0.33;
  switch (a.prop) {
    case 'none':
      break;
    case 'broom':
      p.add('armR', xf(cyl(0.018, 0.018, 1.0, 6), 0, hy - 0.2, 0.12, 0.45, 0, 0), 0xa0652e);
      p.add('armR', xf(rbox(0.22, 0.12, 0.08, 0.03), 0, hy - 0.64, 0.34, 0.45, 0, 0), 0xe8c170);
      break;
    case 'wrench':
      p.add('armR', xf(box(0.035, 0.22, 0.02), 0, hy - 0.04, 0.09, -1.2, 0, 0), 0xb0b6c3, true);
      p.add('armR', xf(torus(0.04, 0.015, Math.PI * 1.6, 5, 10), 0, hy + 0.0, 0.2, -1.2, 0, 0), 0xb0b6c3, true);
      break;
    case 'radio':
      p.add('armR', xf(rbox(0.06, 0.12, 0.04, 0.012), 0, hy - 0.02, 0.05), 0x17151f);
      p.add('armR', xf(cyl(0.007, 0.007, 0.1, 5), 0.018, hy + 0.08, 0.05), 0x17151f);
      break;
    case 'cashbag':
      p.add('armR', xf(sphere(0.11, 12, 10), 0, hy - 0.13, 0.02, 0, 0, 0, 1, 1.1, 0.9), 0xc9a26b);
      p.add('armR', xf(cyl(0.035, 0.05, 0.05, 8), 0, hy - 0.02, 0.02), 0xa0652e);
      p.add('armR', xf(cyl(0.04, 0.04, 0.01, 12), 0, hy - 0.13, 0.12, Math.PI / 2, 0, 0), 0x1e7a46);
      break;
    case 'shaker':
      p.add('armR', xf(cyl(0.04, 0.05, 0.16, 12), 0, hy - 0.02, 0.06, -0.3, 0, 0), 0xd8dde8, true);
      break;
    case 'mic':
      p.add('armR', xf(cyl(0.018, 0.012, 0.14, 8), 0, hy + 0.02, 0.07, -0.9, 0, 0), 0x17151f);
      p.add('armR', xf(sphere(0.035, 10, 8), 0, hy + 0.07, 0.13), 0x9aa0ab, true);
      break;
    case 'cane':
      p.add('armR', xf(cyl(0.014, 0.014, 0.62, 6), 0, hy - 0.27, 0.05), 0x17151f, true);
      p.add('armR', xf(sphere(0.035, 10, 8), 0, hy + 0.04, 0.05), 0xf2b632, true);
      break;
    case 'phone':
      p.add('armR', xf(rbox(0.07, 0.13, 0.015, 0.01), 0, hy - 0.02, 0.07, -0.4, 0, 0), 0x17151f, true);
      break;
    case 'cocktail':
      p.add('armR', xf(cone(0.06, 0.07, 12), 0, hy + 0.06, 0.06, Math.PI, 0, 0), 0xbfe9ff, true);
      p.add('armR', xf(cyl(0.006, 0.006, 0.08, 5), 0, hy - 0.01, 0.06), 0xbfe9ff, true);
      p.add('armR', xf(sphere(0.015, 6, 5), 0.02, hy + 0.08, 0.06), 0x3ddc84);
      break;
  }
}

function buildLeg(p: Parts, a: Appearance, bone: 'legL' | 'legR', d: Dims): void {
  const L = d.legLen;
  const skirtish = a.bottom === 'skirt' || a.top === 'dress';
  const upper = skirtish ? a.skin : a.top === 'overalls' ? a.topColor : a.bottomColor;
  const lower = skirtish || a.bottom === 'shorts' ? a.skin : a.top === 'overalls' ? a.topColor : a.bottomColor;
  const ul = L * 0.3;
  p.add(bone, xf(capsule(0.077, ul), 0, -L * 0.25, 0), upper);
  p.add(bone, xf(capsule(0.068, ul), 0, -L * 0.63, 0), lower);
  if (a.bottom === 'shorts' && !skirtish) p.add(bone, xf(cyl(0.082, 0.082, 0.05, 10), 0, -L * 0.42, 0), a.bottomColor);
  p.add(bone, xf(rbox(0.14, 0.085, 0.22, 0.035), 0, -L + 0.04, 0.035), a.shoeColor);
}

// ---------------------------------------------------------------- faces (shared, cached)

const faceCache = new Map<string, THREE.BufferGeometry>();

function faceGeometry(style: EyeStyle, expr: Expression): THREE.BufferGeometry {
  const key = `${style}:${expr}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const list: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) => list.push(prep(g, color));
  const DARK = 0x1a1020;
  const MOUTH = 0x5a1424;
  const eyeFor = (s: number) => {
    const x = s * EYE_X;
    const rotY = s * 0.38;
    switch (expr) {
      case 'happy':
        add(xf(torus(0.036, 0.011, Math.PI, 4, 10), x, EYE_Y - 0.012, EYE_Z + 0.005, 0, rotY, 0), DARK);
        return;
      case 'excited': {
        const g = new THREE.ExtrudeGeometry(starShape(0.05), { depth: 0.012, bevelEnabled: false });
        add(xf(g, x, EYE_Y, EYE_Z, 0, rotY, 0), 0xffc53d);
        return;
      }
      case 'blink':
        add(xf(box(0.06, 0.012, 0.012), x, EYE_Y - 0.01, EYE_Z + 0.01, 0, rotY, 0), DARK);
        return;
      case 'surprised':
        add(xf(sphere(0.042, 12, 10), x, EYE_Y + 0.005, EYE_Z - 0.004, 0, rotY, 0, 1, 1.1, 0.45), 0xffffff);
        add(xf(sphere(0.022, 10, 8), x, EYE_Y + 0.005, EYE_Z + 0.012, 0, rotY, 0, 1, 1, 0.5), DARK);
        return;
    }
    switch (style) {
      case 'wide':
        add(xf(sphere(0.042, 12, 10), x, EYE_Y, EYE_Z - 0.004, 0, rotY, 0, 1, 1.15, 0.45), 0xffffff);
        add(xf(sphere(0.025, 10, 8), x + s * 0.004, EYE_Y - 0.004, EYE_Z + 0.012, 0, rotY, 0, 1, 1.1, 0.5), DARK);
        break;
      case 'sleepy':
        add(xf(sphere(0.035, 12, 10), x, EYE_Y - 0.01, EYE_Z, 0, rotY, 0, 1.1, 0.55, 0.45), DARK);
        add(xf(box(0.075, 0.012, 0.012), x, EYE_Y + 0.008, EYE_Z + 0.012, 0, rotY, 0), DARK);
        break;
      case 'cool':
        add(xf(sphere(0.036, 12, 10), x, EYE_Y, EYE_Z, 0, rotY, 0, 1.3, 0.7, 0.45), DARK);
        add(xf(sphere(0.01, 6, 5), x + 0.012, EYE_Y + 0.008, EYE_Z + 0.016), 0xffffff);
        break;
      default:
        add(xf(sphere(0.034, 12, 10), x, EYE_Y, EYE_Z, 0, rotY, 0, 1, 1.28, 0.45), DARK);
        add(xf(sphere(0.011, 6, 5), x + 0.012, EYE_Y + 0.016, EYE_Z + 0.016), 0xffffff);
        if (style === 'lashes') {
          add(xf(box(0.03, 0.009, 0.009), x + s * 0.038, EYE_Y + 0.04, EYE_Z + 0.004, 0, rotY, s * 0.6), DARK);
          add(xf(box(0.026, 0.009, 0.009), x + s * 0.046, EYE_Y + 0.022, EYE_Z + 0.002, 0, rotY, s * 0.2), DARK);
        }
    }
  };
  eyeFor(-1);
  eyeFor(1);
  // Brows
  const browTilt = expr === 'angry' ? 0.42 : expr === 'sad' ? -0.35 : expr === 'surprised' ? 0 : 0.05;
  const browY = EYE_Y + (expr === 'surprised' ? 0.08 : 0.062);
  for (const s of [-1, 1]) {
    add(xf(box(0.068, 0.014, 0.012), s * EYE_X, browY, EYE_Z - 0.004, 0, s * 0.38, s * browTilt), 0x2a1a14);
  }
  // Mouth
  const mz = 0.2;
  const my = 0.1;
  switch (expr) {
    case 'happy':
    case 'excited': {
      const g = new THREE.CircleGeometry(0.058, 16, Math.PI, Math.PI);
      add(xf(g, 0, my + 0.012, mz + 0.004, -0.25, 0, 0), MOUTH);
      add(xf(new THREE.CircleGeometry(0.03, 12, Math.PI, Math.PI), 0, my - 0.02, mz + 0.012, -0.25, 0, 0), 0xff7f96);
      break;
    }
    case 'sad':
      add(xf(torus(0.038, 0.01, Math.PI, 4, 10), 0, my - 0.03, mz, -0.25, 0, 0), MOUTH);
      break;
    case 'angry':
      add(xf(box(0.07, 0.014, 0.012), 0, my - 0.005, mz + 0.004, -0.25, 0, 0), MOUTH);
      break;
    case 'surprised':
      add(xf(torus(0.024, 0.011, Math.PI * 2, 5, 12), 0, my - 0.005, mz + 0.004, -0.25, 0, 0), MOUTH);
      break;
    default:
      add(xf(torus(0.042, 0.01, Math.PI, 4, 10), 0, my + 0.03, mz - 0.004, -0.25, 0, Math.PI), MOUTH);
  }
  const merged = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  faceCache.set(key, merged);
  return merged;
}

function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------------- rig + animation

interface Joints {
  legL: number;
  legR: number;
  armLx: number;
  armLz: number;
  armRx: number;
  armRz: number;
  bodyY: number;
  bodyRx: number;
  bodyRz: number;
  headRx: number;
  headRy: number;
  headRz: number;
}

const ZERO_JOINTS: Joints = {
  legL: 0, legR: 0, armLx: 0, armLz: -0.08, armRx: 0, armRz: 0.08, bodyY: 0, bodyRx: 0, bodyRz: 0, headRx: 0, headRy: 0, headRz: 0,
};

export interface CharacterOpts {
  override?: THREE.Material;
  castShadow?: boolean;
}

export class CharacterModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private headPivot = new THREE.Group();
  private hips = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private face: THREE.Mesh;
  appearance!: Appearance;
  private dims!: Dims;
  pose: Pose = 'idle';
  private poseT = 0;
  private phase = 0;
  moveSpeed = 0;
  seatHeight = 0.5;
  private j: Joints = { ...ZERO_JOINTS };
  private target: Joints = { ...ZERO_JOINTS };
  private expression: Expression = 'neutral';
  private baseExpression: Expression = 'neutral';
  private exprTimer = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private blinking = 0;
  private spin = 0;
  private t = Math.random() * 10;
  /** 0..1 — a few cocktails in, the whole body sways and the head lolls. */
  tipsy = 0;
  /** Holding something out in the right hand (a gun): 1 = one hand, 2 = both hands. */
  aim = 0;
  /** Kick from the last shot (decays by itself). */
  recoil = 0;
  /** Flinch from being hit (decays by itself). */
  flinch = 0;
  /** A melee swing (1 = arms raised, falling to 0 as it lands). */
  swing = 0;
  /** A punch being thrown (decays by itself); `jabLeft` picks the arm. */
  jab = 0;
  jabLeft = false;
  /** Right hand, for holding props (a gun's +z points where the arm points). */
  readonly hand = new THREE.Group();

  constructor(appearance: Appearance, private opts: CharacterOpts = {}) {
    this.root.add(this.body);
    if (!opts.override) this.root.add(blobShadow());
    this.body.add(this.hips, this.armL, this.armR, this.legL, this.legR, this.headPivot);
    this.hand.position.set(0, -0.33, 0.02);
    this.hand.rotation.x = Math.PI / 2;
    this.armR.add(this.hand);
    this.face = new THREE.Mesh(faceGeometry('dots', 'neutral'), opts.override ?? FACE);
    this.setAppearance(appearance);
  }

  setAppearance(a: Appearance): void {
    this.appearance = { ...a };
    for (const m of this.meshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const d = dimsFor(a);
    this.dims = d;
    const p = new Parts();
    buildHead(p, a);
    buildTorso(p, a, d);
    buildArm(p, a, 'armL');
    buildArm(p, a, 'armR');
    buildLeg(p, a, 'legL', d);
    buildLeg(p, a, 'legR', d);
    const mk = (bone: Bone, parent: THREE.Object3D) => {
      const { geo, hasShiny } = p.build(bone);
      const material = this.opts.override ?? (hasShiny ? [MATTE, SHINY] : MATTE);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = this.opts.castShadow ?? false;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    this.hips.position.set(0, d.hipY, 0);
    mk('torso', this.hips);
    this.headPivot.position.set(0, d.neckY + 0.02, 0);
    mk('head', this.headPivot);
    this.headPivot.add(this.face);
    this.armL.position.set(-d.shoulderX, d.hipY + d.torsoH - 0.07, 0);
    this.armR.position.set(d.shoulderX, d.hipY + d.torsoH - 0.07, 0);
    mk('armL', this.armL);
    mk('armR', this.armR);
    this.legL.position.set(-d.torsoW * 0.25, d.hipY, 0);
    this.legR.position.set(d.torsoW * 0.25, d.hipY, 0);
    mk('legL', this.legL);
    mk('legR', this.legR);
    this.refreshFace();
  }

  /** Group that follows the head (for hats, crowns and halos). */
  get headAnchor(): THREE.Group {
    return this.headPivot;
  }

  get height(): number {
    return this.dims.neckY + 0.5;
  }

  setPose(p: Pose): void {
    if (p !== this.pose) {
      this.pose = p;
      this.poseT = 0;
    }
  }

  /** Show an expression for `duration` seconds (0 = keep as base mood). */
  setExpression(e: Expression, duration = 0): void {
    if (duration > 0) {
      this.expression = e;
      this.exprTimer = duration;
    } else {
      this.baseExpression = e;
      if (this.exprTimer <= 0) this.expression = e;
    }
    this.refreshFace();
  }

  private refreshFace(): void {
    const e = this.pose === 'sleep' || this.pose === 'ko' ? 'blink' : this.blinking > 0 && (this.expression === 'neutral' || this.expression === 'sad' || this.expression === 'angry') ? 'blink' : this.expression;
    this.face.geometry = faceGeometry(this.appearance.eyes, e);
  }

  private computeTargets(): void {
    const t = this.t;
    const T = this.target;
    Object.assign(T, ZERO_JOINTS);
    const sitY = this.seatHeight - this.dims.hipY + 0.06;
    switch (this.pose) {
      case 'idle':
        T.armLx = Math.sin(t * 1.4) * 0.05;
        T.armRx = -Math.sin(t * 1.4) * 0.05;
        T.bodyY = Math.sin(t * 2.2) * 0.006;
        T.headRy = Math.sin(t * 0.45) * 0.3;
        T.headRx = Math.sin(t * 0.3) * 0.05;
        break;
      case 'walk':
      case 'run':
      case 'sneak': {
        const run = this.pose === 'run';
        const sneak = this.pose === 'sneak';
        const s = Math.sin(this.phase);
        const amp = run ? 0.95 : sneak ? 0.42 : 0.62;
        T.legL = s * amp;
        T.legR = -s * amp;
        T.armLx = -s * (run ? 0.9 : 0.5) - (sneak ? 0.5 : 0);
        T.armRx = s * (run ? 0.9 : 0.5) - (sneak ? 0.5 : 0);
        T.armLz = -0.1;
        T.armRz = 0.1;
        T.bodyY = Math.abs(Math.cos(this.phase)) * (run ? 0.07 : 0.035) - (sneak ? 0.07 : 0);
        T.bodyRx = run ? 0.16 : sneak ? 0.3 : 0.05;
        if (sneak) T.headRy = Math.sin(t * 1.8) * 0.7;
        break;
      }
      case 'sit':
      case 'sitPlay':
      case 'lever':
      case 'drink':
        T.legL = -1.45;
        T.legR = -1.45;
        T.bodyY = sitY;
        T.armLx = -0.55;
        T.armRx = -0.55;
        if (this.pose === 'sitPlay') {
          T.armLx = -1.05;
          T.armRx = -1.15 + Math.sin(t * 9) * 0.08;
          T.headRx = 0.12;
        } else if (this.pose === 'lever') {
          const c = (t % 1.1) / 1.1;
          T.armLx = -1.0;
          T.armRx = c < 0.35 ? -2.3 + c * 3.5 : -1.1;
          T.armRz = 0.25;
          T.headRx = 0.1;
        } else if (this.pose === 'drink') {
          const c = (t % 3) / 3;
          T.armRx = c < 0.4 ? -2.4 : -0.7;
          T.armRz = c < 0.4 ? -0.35 : 0.1;
          T.headRx = c < 0.4 ? -0.25 : 0.05;
        } else {
          T.headRy = Math.sin(t * 0.5) * 0.3;
        }
        break;
      case 'standPlay':
        T.armLx = -0.85;
        T.armRx = -0.95 + Math.sin(t * 2) * 0.12;
        T.headRx = 0.18;
        T.bodyY = Math.sin(t * 2) * 0.005;
        break;
      case 'cheer':
      case 'celebrate':
        T.bodyY = Math.abs(Math.sin(t * 8)) * 0.16;
        T.armLz = -2.65 + Math.sin(t * 16) * 0.2;
        T.armRz = 2.65 - Math.sin(t * 16) * 0.2;
        T.headRx = -0.2;
        break;
      case 'dance':
      case 'sing': {
        const b = t * 5.2;
        T.bodyRz = Math.sin(b) * 0.14;
        T.bodyY = Math.abs(Math.sin(b)) * 0.05;
        T.armLz = -1.1 - Math.sin(b) * 0.9;
        T.armRz = 1.1 - Math.sin(b + Math.PI) * 0.9;
        T.legL = Math.sin(b) * 0.3;
        T.legR = -Math.sin(b) * 0.3;
        T.headRz = Math.sin(b) * 0.15;
        if (this.pose === 'sing') {
          T.armRx = -2.1;
          T.armRz = -0.25;
        }
        break;
      }
      case 'angry':
        T.armLx = Math.sin(t * 14) * 0.5 - 0.35;
        T.armRx = -Math.sin(t * 14) * 0.5 - 0.35;
        T.bodyY = Math.abs(Math.sin(t * 14)) * 0.03;
        T.headRy = Math.sin(t * 9) * 0.25;
        break;
      case 'sad':
        T.headRx = 0.42;
        T.armLz = 0.02;
        T.armRz = -0.02;
        T.bodyRx = 0.1;
        T.bodyY = -0.015;
        break;
      case 'sleep':
        // Flat on the back (the body pivots at the feet, so the head ends up toward -z).
        T.bodyRx = -Math.PI / 2;
        T.bodyY = this.seatHeight + 0.14;
        T.armLz = -0.18;
        T.armRz = 0.18;
        T.headRx = -0.1 + Math.sin(t * 0.8) * 0.03;
        break;
      case 'box':
        // Boxing guard: fists up, bouncing on the toes.
        T.armLx = -1.35;
        T.armRx = -1.25;
        T.armLz = 0.55;
        T.armRz = -0.55;
        T.bodyY = Math.abs(Math.sin(t * 6)) * 0.03;
        T.headRx = 0.12;
        break;
      case 'drum':
        T.armRx = -0.95 + Math.sin(t * 17) * 0.45;
        T.armLx = -0.95 + Math.sin(t * 17 + Math.PI) * 0.45;
        T.armLz = 0.35;
        T.armRz = -0.35;
        T.headRx = 0.15 + Math.sin(t * 8.5) * 0.12;
        break;
      case 'strum':
        T.armLx = -1.15;
        T.armLz = 0.65;
        T.armRx = -0.7 + Math.sin(t * 13) * 0.22;
        T.armRz = -0.55;
        T.headRz = Math.sin(t * 4) * 0.12;
        T.bodyRz = Math.sin(t * 4) * 0.05;
        break;
      case 'ko':
        // Knocked out flat on the pavement, arms out, seeing stars.
        T.bodyRx = -Math.PI / 2;
        T.bodyY = 0.16;
        T.armLz = -1.3;
        T.armRz = 1.3;
        T.legL = 0.15;
        T.legR = -0.12;
        T.headRz = Math.sin(t * 2) * 0.15;
        break;
      case 'repair':
      case 'crouch':
        T.legL = -1.2;
        T.legR = -0.25;
        T.bodyY = -0.13;
        T.bodyRx = 0.22;
        T.armRx = this.pose === 'repair' ? -1.35 + Math.sin(t * 15) * 0.4 : -0.9;
        T.armLx = -1.0;
        T.headRx = 0.25;
        break;
      case 'sweep':
        T.armLx = -0.7 + Math.sin(t * 4) * 0.3;
        T.armRx = -0.5 + Math.sin(t * 4) * 0.3;
        T.armLz = 0.25;
        T.bodyRz = Math.sin(t * 4) * 0.06;
        T.headRx = 0.2;
        break;
      case 'deal':
        T.armRx = -1.0 + Math.sin(t * 5) * 0.35;
        T.armRz = 0.2 + Math.sin(t * 2.5) * 0.25;
        T.armLx = -0.9;
        T.headRx = 0.2;
        break;
      case 'bartend':
        T.armRx = -1.7 + Math.sin(t * 18) * 0.25;
        T.armLx = -1.5 + Math.sin(t * 18) * 0.25;
        T.armRz = -0.3;
        T.armLz = 0.3;
        break;
      case 'wave':
        T.armRz = 2.55 + Math.sin(t * 11) * 0.3;
        T.headRz = 0.1;
        break;
      case 'clap': {
        const c = Math.abs(Math.sin(t * 10));
        T.armLx = -1.2;
        T.armRx = -1.2;
        T.armLz = 0.45 - c * 0.35;
        T.armRz = -0.45 + c * 0.35;
        T.bodyY = c * 0.02;
        break;
      }
      case 'point':
        T.armRx = -1.55;
        T.armRz = 0.1;
        break;
      case 'handsUp':
        T.armLz = -2.8;
        T.armRz = 2.8;
        T.headRx = -0.1;
        break;
      case 'think':
      case 'phone':
        T.armRx = -2.1;
        T.armRz = -0.55;
        T.headRz = 0.12;
        T.headRx = this.pose === 'think' ? -0.12 : 0.05;
        break;
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.poseT += dt;
    const moving = this.pose === 'walk' || this.pose === 'run' || this.pose === 'sneak';
    if (moving) this.phase += dt * Math.max(0.8, this.moveSpeed) * (this.pose === 'run' ? 3.2 : 4.6);
    this.computeTargets();
    if (this.aim > 0 && this.pose !== 'sitPlay' && this.pose !== 'standPlay') {
      const T = this.target;
      T.armRx = -1.5 - this.recoil * 0.5;
      T.armRz = 0.05;
      if (this.aim > 1) {
        T.armLx = -1.35 - this.recoil * 0.3;
        T.armLz = 0.45;
      }
    }
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.swing > 0) {
      // Raised overhead, then down and across.
      const T = this.target;
      T.armRx = -0.5 - this.swing * 2.4;
      T.armRz = -0.1 - this.swing * 0.3;
      if (this.aim > 1) {
        T.armLx = T.armRx + 0.1;
        T.armLz = 0.3;
      }
      T.bodyRz = (this.swing - 0.5) * 0.3;
      this.swing = Math.max(0, this.swing - dt * 5);
    }
    if (this.jab > 0) {
      const T = this.target;
      if (this.jabLeft) {
        T.armLx = -1.62;
        T.armLz = 0.08;
      } else {
        T.armRx = -1.62;
        T.armRz = -0.08;
      }
      T.bodyRz = this.jabLeft ? 0.12 : -0.12;
      this.jab = Math.max(0, this.jab - dt * 4);
    }
    if (this.flinch > 0) {
      const T = this.target;
      T.bodyRx -= this.flinch * 0.35;
      T.headRx -= this.flinch * 0.4;
      this.flinch = Math.max(0, this.flinch - dt * 4);
    }
    const k = moving || this.pose === 'dance' || this.pose === 'cheer' || this.pose === 'celebrate' ? 22 : 11;
    const j = this.j;
    const T = this.target;
    for (const key of Object.keys(j) as (keyof Joints)[]) j[key] = damp(j[key], T[key], k, dt);
    this.legL.rotation.x = j.legL;
    this.legR.rotation.x = j.legR;
    this.armL.rotation.set(j.armLx, 0, j.armLz);
    this.armR.rotation.set(j.armRx, 0, j.armRz);
    this.body.position.y = j.bodyY;
    this.body.rotation.x = j.bodyRx;
    this.body.rotation.z = j.bodyRz;
    this.headPivot.rotation.set(j.headRx, j.headRy, j.headRz);
    if (this.tipsy > 0) {
      const w = this.tipsy;
      this.body.rotation.z += Math.sin(this.t * 2.1) * 0.13 * w;
      this.body.position.x = Math.sin(this.t * 1.3 + 0.7) * 0.06 * w;
      this.headPivot.rotation.z += Math.sin(this.t * 1.6 + 1.2) * 0.2 * w;
    }
    if (this.pose === 'celebrate') this.spin += dt * 9;
    else this.spin = damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 6, dt);
    this.body.rotation.y = this.spin;

    // Expressions and blinking
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) {
        this.expression = this.baseExpression;
        this.refreshFace();
      }
    }
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinking = 0.13;
      this.blinkTimer = 2 + Math.random() * 4;
      this.refreshFace();
    } else if (this.blinking > 0) {
      this.blinking -= dt;
      if (this.blinking <= 0) this.refreshFace();
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.meshes = [];
    this.root.removeFromParent();
  }
}
