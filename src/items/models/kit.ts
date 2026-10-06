import * as THREE from 'three';
import { mat, glow, gold, chrome } from '../../render/materials';
import { canvasTexture, makeCanvas, seeded } from '../../render/textures';
import { TAU } from '../../core/math';
import type { ItemModel } from '../types';
import { type BuildOpts, Dyn, bake, box, cyl, disposeTree, floorPlane, rbox, sph } from './common';

/**
 * Data-light models for the big decoration catalogue: every item is a short recipe built
 * from boxes, cylinders and spheres (baked into a few meshes), with optional animation.
 */
interface Kit {
  root: THREE.Group;
  dyn: Dyn;
  c: number;
  /** Shorthand material. */
  m: (color: number, rough?: number, metal?: number) => THREE.MeshStandardMaterial;
  /** Animate something (it won't be merged). */
  anim: (o: THREE.Object3D, f: (o: THREE.Object3D, t: number, dt: number) => void) => void;
  rnd: () => number;
}

type Recipe = (k: Kit) => number;

const M = (color: number, rough = 0.6, metal = 0) => mat(color, { rough, metal });
const GLASS = () => mat(0xbfe9ff, { rough: 0.05, metal: 0.1, transparent: true, opacity: 0.35 });

function flame(k: Kit, x: number, y: number, z: number, s = 1): void {
  const f = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.28 * s, 8), glow(0xff9a3d, 2.6));
  f.position.set(x, y + 0.14 * s, z);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.04 * s, 0.16 * s, 6), glow(0xfff1b8, 3));
  core.position.y = -0.04 * s;
  f.add(core);
  k.root.add(f);
  const ph = Math.random() * 10;
  k.anim(f, (o, t) => {
    o.scale.set(1 + Math.sin(t * 13 + ph) * 0.12, 1 + Math.sin(t * 17 + ph) * 0.22, 1 + Math.cos(t * 11 + ph) * 0.12);
  });
}

function leafBall(k: Kit, r: number, x: number, y: number, z: number, color = 0x2f8f45): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(color, { rough: 0.8, flat: true }));
  b.position.set(x, y, z);
  k.root.add(b);
  return b;
}

function screenTex(kind: 'tv' | 'game' | 'movie' | 'code'): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 72);
  const rnd = seeded(kind.length * 31);
  const g = ctx.createLinearGradient(0, 0, 128, 72);
  if (kind === 'tv') {
    g.addColorStop(0, '#1f4fbf');
    g.addColorStop(1, '#2fe6ff');
  } else if (kind === 'game') {
    g.addColorStop(0, '#6a2cc2');
    g.addColorStop(1, '#ff3fa4');
  } else if (kind === 'movie') {
    g.addColorStop(0, '#0b0414');
    g.addColorStop(1, '#ffb45a');
  } else {
    g.addColorStop(0, '#0b1a10');
    g.addColorStop(1, '#0b1a10');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 72);
  if (kind === 'code') {
    ctx.fillStyle = '#39ff88';
    for (let y = 6; y < 70; y += 7) ctx.fillRect(6 + rnd() * 10, y, 30 + rnd() * 70, 3);
  } else if (kind === 'game') {
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < 8; i++) ctx.fillRect(rnd() * 120, rnd() * 64, 6, 6);
    ctx.fillStyle = '#39ff88';
    ctx.fillRect(10, 56, 108, 6);
  } else if (kind === 'movie') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(64, 36, 14, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(12, 50, 60, 8);
  }
  return canvasTexture(canvas);
}

const screenCache = new Map<string, THREE.MeshStandardMaterial>();
function screen(kind: 'tv' | 'game' | 'movie' | 'code'): THREE.MeshStandardMaterial {
  let m = screenCache.get(kind);
  if (!m) {
    const t = screenTex(kind);
    m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.3 });
    screenCache.set(kind, m);
  }
  return m;
}

function seat(k: Kit, x: number, z: number, w: number, d: number, color: number, back = true, yaw = 0): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const cm = mat(color, { rough: 0.75 });
  rbox(g, w, 0.32, d, 0.06, cm, 0, 0.32, 0);
  if (back) rbox(g, w, 0.45, 0.16, 0.06, cm, 0, 0.66, -d / 2 + 0.08);
  for (const sx of [-1, 1]) rbox(g, 0.14, 0.26, d, 0.05, cm, sx * (w / 2 - 0.07), 0.55, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.025, 0.025, 0.16, M(0x2a1a12), sx * (w / 2 - 0.1), 0.08, sz * (d / 2 - 0.1), 6);
  k.root.add(g);
}

const R: Record<string, Recipe> = {
  // ------------------------------------------------------------------ statues & sculpture
  bust: (k) => {
    const marble = M(0xeee8df, 0.35);
    box(k.root, 0.45, 0.9, 0.45, M(k.c, 0.5), 0, 0.45, 0);
    box(k.root, 0.55, 0.06, 0.55, marble, 0, 0.93, 0);
    sph(k.root, 0.22, marble, 0, 1.2, 0, 14, 10).scale.set(1.4, 0.8, 0.9);
    sph(k.root, 0.16, marble, 0, 1.47, 0, 14, 12);
    sph(k.root, 0.165, marble, 0, 1.52, -0.02, 12, 10).scale.set(1, 0.7, 1);
    return 1.7;
  },
  icesculpt: (k) => {
    const ice = mat(0xcff6ff, { rough: 0.05, transparent: true, opacity: 0.75, emissive: 0x4fc8ff, emissiveIntensity: 0.25 });
    cyl(k.root, 0.4, 0.45, 0.3, M(0x2b2b35, 0.4, 0.4), 0, 0.15, 0, 18);
    sph(k.root, 0.28, ice, 0, 0.62, 0, 14, 10).scale.set(1, 0.7, 1.4);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 8, 16, Math.PI * 1.1), ice);
    neck.position.set(0, 0.95, 0.15);
    neck.rotation.y = Math.PI / 2;
    k.root.add(neck);
    sph(k.root, 0.08, ice, 0, 1.15, 0.33, 10, 8);
    for (const s of [-1, 1]) {
      const w = sph(k.root, 0.24, ice, s * 0.25, 0.72, -0.05, 10, 8);
      w.scale.set(0.3, 0.7, 1.2);
    }
    return 1.3;
  },
  candelabra: (k) => {
    const g = gold();
    cyl(k.root, 0.2, 0.25, 0.06, g, 0, 0.03, 0, 16);
    cyl(k.root, 0.03, 0.04, 1.3, g, 0, 0.68, 0, 8);
    for (const a of [0, TAU / 3, (2 * TAU) / 3]) {
      const x = Math.sin(a) * 0.24;
      const z = Math.cos(a) * 0.24;
      box(k.root, Math.abs(x) + 0.02, 0.03, Math.abs(z) + 0.02, g, x / 2, 1.25, z / 2);
      cyl(k.root, 0.04, 0.03, 0.08, g, x, 1.3, z, 8);
      cyl(k.root, 0.02, 0.02, 0.18, M(0xf4f1ea), x, 1.42, z, 6);
      flame(k, x, 1.5, z, 0.5);
    }
    cyl(k.root, 0.02, 0.02, 0.2, M(0xf4f1ea), 0, 1.43, 0, 6);
    flame(k, 0, 1.53, 0, 0.5);
    return 1.8;
  },
  vase: (k) => {
    const v = new THREE.Mesh(new THREE.LatheGeometry([0.05, 0.16, 0.2, 0.14, 0.09, 0.13].map((r, i) => new THREE.Vector2(r, i * 0.12)), 16), mat(k.c, { rough: 0.1, transparent: true, opacity: 0.75 }));
    k.root.add(v);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      cyl(k.root, 0.008, 0.008, 0.45, M(0x2f8f45), Math.sin(a) * 0.04, 0.82, Math.cos(a) * 0.04, 4).rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
      sph(k.root, 0.07, M([0xff6fb5, 0xffc53d, 0xff4d4d, 0xffffff][i % 4], 0.6), Math.sin(a) * 0.12, 1.05, Math.cos(a) * 0.12, 8, 6);
    }
    return 1.2;
  },
  bonsai: (k) => {
    box(k.root, 0.6, 0.16, 0.4, M(k.c, 0.4), 0, 0.08, 0);
    const tr = cyl(k.root, 0.04, 0.07, 0.4, M(0x6b4422, 0.9), 0.05, 0.36, 0, 8);
    tr.rotation.z = -0.4;
    leafBall(k, 0.2, 0.15, 0.6, 0);
    leafBall(k, 0.15, -0.12, 0.52, 0.05);
    leafBall(k, 0.13, 0.3, 0.5, -0.05);
    return 0.85;
  },
  cactus: (k) => {
    cyl(k.root, 0.2, 0.16, 0.3, M(k.c, 0.6), 0, 0.15, 0, 14);
    const green = M(0x3a8a45, 0.7);
    cyl(k.root, 0.09, 0.1, 0.8, green, 0, 0.7, 0, 10);
    sph(k.root, 0.09, green, 0, 1.1, 0, 10, 6);
    for (const s of [-1, 1]) {
      cyl(k.root, 0.06, 0.06, 0.18, green, s * 0.14, 0.7 + s * 0.08, 0, 8).rotation.z = Math.PI / 2;
      cyl(k.root, 0.06, 0.06, 0.28, green, s * 0.22, 0.88 + s * 0.08, 0, 8);
      sph(k.root, 0.06, green, s * 0.22, 1.02 + s * 0.08, 0, 8, 6);
    }
    sph(k.root, 0.04, M(0xff6fb5), 0, 1.2, 0, 8, 6);
    return 1.3;
  },
  planter: (k) => {
    box(k.root, 1.8, 0.4, 0.7, M(k.c, 0.6), 0, 0.2, 0);
    box(k.root, 1.7, 0.04, 0.6, M(0x3a2414, 1), 0, 0.41, 0);
    for (let i = 0; i < 9; i++) {
      leafBall(k, 0.13, -0.75 + i * 0.19, 0.5, (i % 2) * 0.18 - 0.09, i % 3 ? 0x2f8f45 : 0x3aa655);
      sph(k.root, 0.06, M([0xff6fb5, 0xffc53d, 0xff4d4d, 0xb77bff][i % 4]), -0.75 + i * 0.19, 0.64, (i % 2) * 0.18 - 0.09, 8, 6);
    }
    return 0.75;
  },
  neonflamingo: (k) => {
    box(k.root, 0.5, 0.08, 0.3, M(0x17151f, 0.4), 0, 0.04, 0);
    const n = glow(k.c, 2.4);
    const leg = cyl(k.root, 0.02, 0.02, 0.8, n, 0, 0.48, 0, 6);
    void leg;
    const body = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24, Math.PI * 1.6), n);
    body.position.set(0, 1.05, 0);
    k.root.add(body);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 20, Math.PI * 1.3), n);
    neck.position.set(0.12, 1.4, 0);
    neck.rotation.z = -0.6;
    k.root.add(neck);
    sph(k.root, 0.05, n, 0.25, 1.52, 0, 8, 6);
    return 1.7;
  },
  neoncherry: (k) => {
    box(k.root, 0.5, 0.08, 0.3, M(0x17151f, 0.4), 0, 0.04, 0);
    cyl(k.root, 0.02, 0.02, 0.9, M(0x2b2b35, 0.4, 0.6), 0, 0.5, -0.1, 6);
    const red = glow(0xff2a4a, 2.4);
    for (const s of [-1, 1]) {
      const ch = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), red);
      ch.position.set(s * 0.16, 0.95, 0);
      k.root.add(ch);
      const st = cyl(k.root, 0.015, 0.015, 0.45, glow(0x39ff88, 2), s * 0.08, 1.28, 0, 6);
      st.rotation.z = s * 0.4;
    }
    return 1.6;
  },
  neoncrown: (k) => {
    box(k.root, 0.6, 0.08, 0.3, M(0x17151f, 0.4), 0, 0.04, 0);
    cyl(k.root, 0.02, 0.02, 0.8, M(0x2b2b35, 0.4, 0.6), 0, 0.45, -0.1, 6);
    const n = glow(k.c, 2.5);
    box(k.root, 0.7, 0.04, 0.04, n, 0, 0.9, 0);
    for (let i = 0; i < 5; i++) {
      const x = -0.3 + i * 0.15;
      const h = i % 2 ? 0.3 : 0.45;
      const sp = box(k.root, 0.035, h, 0.035, n, x, 0.9 + h / 2, 0);
      sp.rotation.z = (2 - i) * 0.12;
      sph(k.root, 0.04, n, x - (2 - i) * 0.03, 0.92 + h, 0, 8, 6);
    }
    return 1.5;
  },
  chipstack: (k) => {
    const cols = [k.c, 0xf4f1ea, 0x17151f];
    for (let s = 0; s < 3; s++) {
      const x = [-0.15, 0.17, 0][s];
      const z = [0.08, 0.05, -0.16][s];
      const n = [6, 9, 4][s];
      for (let i = 0; i < n; i++) {
        cyl(k.root, 0.17, 0.17, 0.09, M(cols[(i + s) % 3], 0.4), x, 0.05 + i * 0.095, z, 20);
        cyl(k.root, 0.172, 0.172, 0.02, M(0xf4f1ea, 0.4), x, 0.05 + i * 0.095, z, 20);
      }
    }
    return 1.0;
  },
  giantcard: (k) => {
    const { canvas, ctx } = makeCanvas(160, 224);
    ctx.fillStyle = '#fbf8f2';
    ctx.fillRect(0, 0, 160, 224);
    ctx.strokeStyle = '#c9b8a0';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 148, 212);
    ctx.fillStyle = k.c === 0xc8102e ? '#c8102e' : '#17151f';
    ctx.font = '700 120px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(k.c === 0xc8102e ? '♥' : '♠', 80, 120);
    ctx.font = '800 36px serif';
    ctx.fillText('A', 26, 30);
    const t = canvasTexture(canvas);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.05, 0.04), [M(0xf4f1ea), M(0xf4f1ea), M(0xf4f1ea), M(0xf4f1ea), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }), M(0x8a1030)]);
    face.position.set(0, 0.68, 0);
    face.rotation.x = -0.12;
    k.root.add(face);
    k.dyn.keep(face);
    box(k.root, 0.5, 0.1, 0.3, gold(), 0, 0.05, 0);
    return 1.3;
  },
  goldbars: (k) => {
    const g = gold();
    const bar = (x: number, y: number, z: number, r = 0) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.11, 4, 1), g);
      b.rotation.y = Math.PI / 4 + r;
      b.scale.set(1.4, 1, 0.6);
      b.position.set(x, y, z);
      k.root.add(b);
    };
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) bar(-0.2 + i * 0.2 + row * 0.1, 0.06 + row * 0.11, -0.1, 0);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 2 - row; i++) bar(-0.1 + i * 0.2 + row * 0.1, 0.06 + row * 0.11, 0.2, 0);
    return 0.5;
  },
  moneybags: (k) => {
    const sack = M(0xb59a6a, 0.9);
    for (const [x, z, s] of [[-0.15, 0.05, 1], [0.18, -0.05, 0.85], [0, -0.22, 0.7]] as const) {
      sph(k.root, 0.24 * s, sack, x, 0.22 * s, z, 14, 10).scale.set(1, 1.05, 1);
      cyl(k.root, 0.06 * s, 0.09 * s, 0.1 * s, sack, x, 0.48 * s, z, 8);
      cyl(k.root, 0.07 * s, 0.07 * s, 0.03, M(0x6b4422), x, 0.44 * s, z, 8);
      const label = box(k.root, 0.14 * s, 0.14 * s, 0.01, M(0x1e7a46), x, 0.24 * s, z + 0.23 * s);
      void label;
    }
    for (let i = 0; i < 5; i++) cyl(k.root, 0.06, 0.06, 0.012, gold(), -0.3 + i * 0.12, 0.006, 0.3, 12);
    return 0.65;
  },
  champagne: (k) => {
    box(k.root, 0.8, 0.5, 0.8, M(0xf4f1ea, 0.5), 0, 0.25, 0);
    const gl = mat(0xfff1b8, { rough: 0.05, transparent: true, opacity: 0.55, emissive: 0xffc874, emissiveIntensity: 0.25 });
    let y = 0.5;
    for (let layer = 3; layer >= 1; layer--) {
      for (let i = 0; i < layer; i++) for (let j = 0; j < layer; j++) {
        const x = (i - (layer - 1) / 2) * 0.18;
        const z = (j - (layer - 1) / 2) * 0.18;
        cyl(k.root, 0.075, 0.015, 0.1, gl, x, y + 0.11, z, 10);
        cyl(k.root, 0.006, 0.006, 0.06, gl, x, y + 0.03, z, 4);
      }
      y += 0.17;
    }
    const b = cyl(k.root, 0.05, 0.05, 0.28, M(0x1d4a2a, 0.2), 0, y + 0.18, 0, 10);
    void b;
    cyl(k.root, 0.02, 0.04, 0.1, gold(), 0, y + 0.37, 0, 8);
    return y + 0.5;
  },
  grandpiano: (k) => {
    const lac = mat(0x0b0b0e, { rough: 0.12, metal: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.32, 24, 1, false, 0, Math.PI), lac);
    body.position.set(0, 0.85, -0.1);
    body.rotation.y = -Math.PI / 2;
    body.scale.set(1, 1, 1.15);
    k.root.add(body);
    box(k.root, 1.7, 0.32, 0.5, lac, 0, 0.85, 0.35);
    box(k.root, 1.3, 0.04, 0.2, M(0xf8f6f0, 0.3), 0, 0.98, 0.62);
    for (let i = 0; i < 16; i++) box(k.root, 0.03, 0.02, 0.11, lac, -0.6 + i * 0.08, 1.0, 0.58);
    for (const [x, z] of [[-0.7, 0.4], [0.7, 0.4], [0, -0.7]]) cyl(k.root, 0.05, 0.04, 0.7, lac, x, 0.35, z, 8);
    const lid = box(k.root, 1.5, 0.03, 1.4, lac, 0, 1.4, -0.2);
    lid.rotation.x = 0.6;
    box(k.root, 0.7, 0.45, 0.32, lac, 0, 0.42, 0.95);
    return 1.8;
  },
  harp: (k) => {
    const g = gold();
    box(k.root, 0.5, 0.12, 0.35, g, 0, 0.06, 0);
    const col = cyl(k.root, 0.05, 0.06, 1.6, g, -0.2, 0.9, 0, 10);
    void col;
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 20, Math.PI * 0.9), g);
    neck.position.set(0.05, 1.55, 0);
    neck.rotation.z = Math.PI * 0.05;
    k.root.add(neck);
    const sound = box(k.root, 0.1, 1.3, 0.2, M(0x8a5a2e, 0.5), 0.3, 0.85, 0);
    sound.rotation.z = 0.35;
    for (let i = 0; i < 9; i++) cyl(k.root, 0.004, 0.004, 1.1 - i * 0.08, M(0xf4f1ea, 0.3), -0.15 + i * 0.05, 0.75 + i * 0.04, 0, 3);
    return 2;
  },
  jukebox: (k) => {
    const body = M(k.c, 0.3, 0.3);
    box(k.root, 0.8, 1.1, 0.5, body, 0, 0.55, 0);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 20, 1, false, -Math.PI / 2, Math.PI), body);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = Math.PI / 2;
    arch.position.set(0, 1.1, 0);
    k.root.add(arch);
    const lights = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 8, 24, Math.PI), glow(0xffc53d, 2));
    lights.position.set(0, 1.1, 0.26);
    k.root.add(lights);
    k.anim(lights, (o, t) => ((o as THREE.Mesh).material = Math.floor(t * 3) % 2 ? glow(0xffc53d, 2.4) : glow(0xff3fa4, 2.4)));
    box(k.root, 0.55, 0.35, 0.02, GLASS(), 0, 0.95, 0.26);
    for (let i = 0; i < 5; i++) box(k.root, 0.08, 0.3, 0.02, glow([0xff3fa4, 0x2fe6ff, 0x39ff88, 0xffc53d, 0xb77bff][i], 1.5), -0.24 + i * 0.12, 0.4, 0.26);
    return 1.6;
  },
  classiccar: (k) => {
    box(k.root, 1.9, 0.12, 3.9, M(0x2b2b35, 0.4, 0.4), 0, 0.06, 0);
    const paint = mat(k.c, { rough: 0.15, metal: 0.6 });
    const g = new THREE.Group();
    g.position.y = 0.12;
    rbox(g, 1.5, 0.55, 3.4, 0.2, paint, 0, 0.55, 0);
    rbox(g, 1.3, 0.45, 1.6, 0.18, paint, 0, 1.0, -0.2);
    box(g, 1.32, 0.35, 1.5, M(0x15141a, 0.2), 0, 1.0, -0.2);
    for (const sx of [-0.75, 0.75]) for (const sz of [-1.1, 1.1]) {
      const w = cyl(g, 0.3, 0.3, 0.2, M(0x15141a, 0.6), sx, 0.3, sz, 14);
      w.rotation.z = Math.PI / 2;
      const hub = cyl(g, 0.15, 0.15, 0.22, chrome(), sx, 0.3, sz, 12);
      hub.rotation.z = Math.PI / 2;
    }
    box(g, 1.55, 0.12, 0.1, chrome(), 0, 0.4, 1.72);
    box(g, 1.55, 0.12, 0.1, chrome(), 0, 0.4, -1.72);
    for (const sx of [-0.5, 0.5]) sph(g, 0.1, glow(0xfff2c8, 1.5), sx, 0.62, 1.7, 10, 8);
    for (const sx of [-0.5, 0.5]) {
      const fin = box(g, 0.06, 0.25, 0.6, paint, sx, 0.9, -1.4);
      fin.rotation.x = -0.3;
    }
    g.scale.setScalar(0.95);
    k.root.add(g);
    return 1.4;
  },
  motorbike: (k) => {
    const c = chrome();
    const paint = mat(k.c, { rough: 0.15, metal: 0.6 });
    for (const z of [-0.6, 0.6]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 20), M(0x15141a, 0.6));
      w.position.set(0, 0.36, z);
      w.rotation.y = Math.PI / 2;
      k.root.add(w);
      const hub = cyl(k.root, 0.12, 0.12, 0.1, c, 0, 0.36, z, 12);
      hub.rotation.z = Math.PI / 2;
    }
    rbox(k.root, 0.28, 0.25, 0.55, 0.08, paint, 0, 0.75, 0.1);
    rbox(k.root, 0.24, 0.12, 0.5, 0.05, M(0x17151f), 0, 0.72, -0.3);
    box(k.root, 0.22, 0.25, 0.5, c, 0, 0.5, 0);
    const fork = box(k.root, 0.06, 0.6, 0.06, c, 0, 0.65, 0.5);
    fork.rotation.x = -0.35;
    box(k.root, 0.6, 0.04, 0.04, c, 0, 1.0, 0.62);
    sph(k.root, 0.08, glow(0xfff2c8, 1.5), 0, 0.85, 0.66, 10, 8);
    return 1.1;
  },
  armor: (k) => {
    const steel = mat(0xb0b6c3, { metal: 0.85, rough: 0.25 });
    box(k.root, 0.5, 0.1, 0.4, M(0x3a2414), 0, 0.05, 0);
    for (const s of [-1, 1]) cyl(k.root, 0.07, 0.08, 0.75, steel, s * 0.1, 0.5, 0, 10);
    rbox(k.root, 0.42, 0.55, 0.3, 0.1, steel, 0, 1.15, 0);
    for (const s of [-1, 1]) {
      sph(k.root, 0.11, steel, s * 0.27, 1.35, 0, 10, 8);
      cyl(k.root, 0.05, 0.05, 0.55, steel, s * 0.3, 1.05, 0, 8);
    }
    sph(k.root, 0.15, steel, 0, 1.62, 0, 12, 10).scale.set(1, 1.2, 1);
    box(k.root, 0.2, 0.03, 0.05, M(0x17151f), 0, 1.62, 0.14);
    sph(k.root, 0.05, M(k.c, 0.5), 0, 1.84, 0, 8, 6).scale.set(0.6, 1.8, 0.6);
    cyl(k.root, 0.015, 0.015, 1.9, steel, 0.42, 0.95, 0.1, 6);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 4), steel);
    head.position.set(0.42, 1.98, 0.1);
    k.root.add(head);
    return 2.1;
  },
  sphinx: (k) => {
    const g = gold();
    box(k.root, 1.8, 0.3, 1.8, M(0xd8c39a, 0.8), 0, 0.15, 0);
    box(k.root, 0.8, 0.6, 1.4, g, 0, 0.6, -0.1);
    for (const s of [-1, 1]) box(k.root, 0.18, 0.16, 0.6, g, s * 0.3, 0.38, 0.75);
    box(k.root, 0.5, 0.55, 0.45, g, 0, 1.1, 0.45);
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 0.55, 4), mat(0x1f4fbf, { metal: 0.6, rough: 0.3 }));
    dress.rotation.y = Math.PI / 4;
    dress.position.set(0, 1.12, 0.38);
    k.root.add(dress);
    return 1.6;
  },
  obelisk: (k) => {
    box(k.root, 0.6, 0.2, 0.6, M(0xd8c39a, 0.8), 0, 0.1, 0);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 4), M(k.c, 0.6));
    s.rotation.y = Math.PI / 4;
    s.position.y = 1.3;
    k.root.add(s);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), gold());
    tip.rotation.y = Math.PI / 4;
    tip.position.y = 2.55;
    k.root.add(tip);
    return 2.7;
  },
  globe: (k) => {
    const g = gold();
    for (const s of [-1, 1]) cyl(k.root, 0.03, 0.03, 0.7, M(0x5a3a1a, 0.5), s * 0.2, 0.35, 0, 6);
    cyl(k.root, 0.25, 0.25, 0.04, M(0x5a3a1a, 0.5), 0, 0.03, 0, 16);
    const ball = new THREE.Group();
    ball.position.y = 0.95;
    ball.rotation.z = 0.4;
    sph(ball, 0.3, M(0x2a6fa0, 0.5), 0, 0, 0, 20, 14);
    for (let i = 0; i < 6; i++) {
      const land = sph(ball, 0.12, M(0x3a8a45, 0.7), 0, 0, 0, 8, 6);
      const a = i * 1.1;
      land.position.set(Math.cos(a) * 0.22, Math.sin(i * 2.1) * 0.15, Math.sin(a) * 0.22);
      land.scale.set(0.7, 0.5, 0.7);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.015, 6, 28), g);
    ring.rotation.y = Math.PI / 2;
    ball.add(ring);
    k.root.add(ball);
    k.anim(ball, (o, _t, dt) => (o.rotation.y += dt * 0.4));
    return 1.35;
  },
  grandclock: (k) => {
    const wood = M(0x5a3a1a, 0.5);
    box(k.root, 0.55, 2.0, 0.35, wood, 0, 1.0, 0);
    box(k.root, 0.62, 0.15, 0.42, wood, 0, 2.05, 0);
    cyl(k.root, 0.2, 0.2, 0.02, M(0xf4f1ea, 0.4), 0, 1.65, 0.18, 20).rotation.x = Math.PI / 2;
    box(k.root, 0.01, 0.14, 0.01, M(0x17151f), 0, 1.7, 0.2);
    box(k.root, 0.1, 0.01, 0.01, M(0x17151f), 0.04, 1.65, 0.2);
    box(k.root, 0.36, 0.9, 0.02, GLASS(), 0, 0.9, 0.18);
    const pend = new THREE.Group();
    pend.position.set(0, 1.35, 0.1);
    box(pend, 0.015, 0.6, 0.015, gold(), 0, -0.3, 0);
    cyl(pend, 0.08, 0.08, 0.02, gold(), 0, -0.62, 0, 14).rotation.x = Math.PI / 2;
    k.root.add(pend);
    k.anim(pend, (o, t) => (o.rotation.z = Math.sin(t * 3.14) * 0.25));
    return 2.2;
  },
  waterwall: (k) => {
    box(k.root, 1.9, 0.3, 0.7, M(0x2b2b35, 0.4), 0, 0.15, 0);
    box(k.root, 1.9, 2.2, 0.15, M(0x3a3844, 0.4, 0.3), 0, 1.4, -0.25);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.0), new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55, roughness: 0.05, emissive: 0x2fb8e0, emissiveIntensity: 0.4 }));
    water.position.set(0, 1.35, -0.16);
    k.root.add(water);
    k.anim(water, (o, t) => ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + Math.sin(t * 4) * 0.12);
    box(k.root, 1.8, 0.04, 0.55, mat(0x2fb8e0, { rough: 0.05, emissive: 0x0a5a80, emissiveIntensity: 0.5 }), 0, 0.31, 0.05);
    return 2.5;
  },
  firebowl: (k) => {
    cyl(k.root, 0.08, 0.15, 0.7, M(0x2b2b35, 0.4, 0.6), 0, 0.35, 0, 10);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2), M(0x3a3844, 0.4, 0.7));
    bowl.position.y = 0.95;
    k.root.add(bowl);
    for (let i = 0; i < 5; i++) flame(k, Math.sin(i * 1.3) * 0.15, 0.9, Math.cos(i * 1.3) * 0.15, 1.3);
    return 1.4;
  },
  discoball: (k) => {
    cyl(k.root, 0.03, 0.03, 1.8, M(0x2b2b35, 0.4, 0.6), 0, 0.9, 0, 6);
    cyl(k.root, 0.2, 0.25, 0.06, M(0x2b2b35, 0.4, 0.6), 0, 0.03, 0, 14);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), mat(0xe8eef6, { metal: 1, rough: 0.05, flat: true, emissive: 0x8899aa, emissiveIntensity: 0.3 }));
    ball.position.y = 1.85;
    k.root.add(ball);
    k.anim(ball, (o, t, dt) => {
      o.rotation.y += dt * 1.2;
      ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.setHSL((t * 0.2) % 1, 0.8, 0.4);
    });
    return 2.2;
  },
  lavalamp: (k) => {
    cyl(k.root, 0.12, 0.16, 0.25, M(0x9aa0ab, 0.3, 0.8), 0, 0.12, 0, 14);
    cyl(k.root, 0.1, 0.13, 0.5, mat(k.c, { rough: 0.1, transparent: true, opacity: 0.5, emissive: k.c, emissiveIntensity: 0.4 }), 0, 0.5, 0, 14);
    cyl(k.root, 0.06, 0.1, 0.1, M(0x9aa0ab, 0.3, 0.8), 0, 0.8, 0, 12);
    for (let i = 0; i < 3; i++) {
      const b = sph(k.root, 0.045 + i * 0.01, glow(k.c === 0x2fe6ff ? 0xff3fa4 : 0xffc53d, 1.6), 0, 0.4, 0, 10, 8);
      k.anim(b, (o, t) => (o.position.y = 0.42 + (Math.sin(t * (0.4 + i * 0.17) + i * 2) * 0.5 + 0.5) * 0.3));
    }
    return 0.9;
  },
  bamboo: (k) => {
    cyl(k.root, 0.25, 0.2, 0.35, M(k.c, 0.5), 0, 0.17, 0, 14);
    const green = M(0x7aa83a, 0.6);
    for (let i = 0; i < 5; i++) {
      const x = Math.sin(i * 1.5) * 0.1;
      const z = Math.cos(i * 1.5) * 0.1;
      const h = 1.3 + (i % 3) * 0.3;
      cyl(k.root, 0.03, 0.03, h, green, x, 0.35 + h / 2, z, 6);
      for (let j = 1; j < 4; j++) cyl(k.root, 0.035, 0.035, 0.03, M(0x5a7a2a), x, 0.35 + (h * j) / 4, z, 6);
      const leaf = sph(k.root, 0.1, M(0x3aa655, 0.7), x + 0.08, 0.35 + h, z, 6, 4);
      leaf.scale.set(1.6, 0.3, 0.6);
    }
    return 2.1;
  },
  topiary: (k) => {
    cyl(k.root, 0.25, 0.2, 0.4, M(k.c, 0.5), 0, 0.2, 0, 14);
    for (let i = 0; i < 4; i++) leafBall(k, 0.26 - i * 0.04, 0, 0.6 + i * 0.38, 0);
    return 2;
  },
  birdcage: (k) => {
    const g = gold();
    cyl(k.root, 0.03, 0.03, 1.1, g, 0, 0.55, 0, 6);
    cyl(k.root, 0.2, 0.25, 0.04, g, 0, 0.02, 0, 12);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      cyl(k.root, 0.006, 0.006, 0.6, g, Math.sin(a) * 0.25, 1.4, Math.cos(a) * 0.25, 3);
    }
    cyl(k.root, 0.27, 0.27, 0.03, g, 0, 1.1, 0, 18);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 8, 0, TAU, 0, Math.PI / 2), g);
    dome.position.y = 1.7;
    k.root.add(dome);
    const parrot = new THREE.Group();
    parrot.position.set(0, 1.3, 0);
    sph(parrot, 0.08, M(0xc8102e, 0.5), 0, 0, 0, 10, 8).scale.set(0.8, 1.3, 0.8);
    sph(parrot, 0.055, M(0xc8102e, 0.5), 0, 0.12, 0.02, 10, 8);
    sph(parrot, 0.02, M(0xffc53d), 0, 0.11, 0.07, 6, 4);
    box(parrot, 0.02, 0.1, 0.04, M(0x1f4fbf), 0.06, -0.02, -0.02);
    box(parrot, 0.02, 0.1, 0.04, M(0x1f4fbf), -0.06, -0.02, -0.02);
    k.root.add(parrot);
    k.anim(parrot, (o, t) => (o.rotation.y = Math.sin(t * 0.9) * 0.8));
    return 1.9;
  },
  telescope: (k) => {
    const brass = mat(0xc9a24a, { metal: 0.85, rough: 0.25 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const leg = cyl(k.root, 0.02, 0.02, 1.1, M(0x5a3a1a, 0.5), Math.sin(a) * 0.2, 0.52, Math.cos(a) * 0.2, 6);
      leg.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
    }
    const tube = cyl(k.root, 0.07, 0.1, 1.0, brass, 0, 1.15, 0.1, 14);
    tube.rotation.x = -1.1;
    return 1.5;
  },
  dragon: (k) => {
    const jade = mat(0x2fa86a, { rough: 0.2, metal: 0.2, emissive: 0x0a3a20, emissiveIntensity: 0.3 });
    box(k.root, 1.8, 0.25, 1.8, M(0x3a2414, 0.6), 0, 0.12, 0);
    let x = -0.6;
    let y = 0.45;
    for (let i = 0; i < 9; i++) {
      sph(k.root, 0.2 - i * 0.012, jade, x, y + Math.sin(i * 1.1) * 0.25, Math.cos(i * 1.1) * 0.35, 10, 8);
      x += 0.15;
      y += 0.08;
    }
    const head = sph(k.root, 0.22, jade, 0.75, 1.35, 0.1, 12, 10);
    head.scale.set(1.3, 0.9, 1);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 6), gold());
      horn.position.set(0.65, 1.6, 0.1 + s * 0.1);
      horn.rotation.z = 0.5;
      k.root.add(horn);
      sph(k.root, 0.035, glow(0xff4d4d, 2), 0.95, 1.4, 0.1 + s * 0.08, 6, 4);
    }
    sph(k.root, 0.12, gold(), 0.98, 1.2, 0.1, 10, 8);
    return 1.8;
  },
  lion: (k) => {
    const stone = M(0xb7ae9f, 0.85);
    box(k.root, 0.8, 0.4, 0.8, M(0x8a8178, 0.9), 0, 0.2, 0);
    sph(k.root, 0.3, stone, 0, 0.7, -0.1, 12, 10).scale.set(1, 1, 1.4);
    sph(k.root, 0.28, stone, 0, 1.0, 0.18, 12, 10);
    sph(k.root, 0.17, stone, 0, 0.98, 0.38, 10, 8);
    for (const s of [-1, 1]) box(k.root, 0.12, 0.3, 0.14, stone, s * 0.18, 0.55, 0.3);
    sph(k.root, 0.06, M(k.c, 0.4), 0, 0.95, 0.52, 8, 6);
    return 1.3;
  },
  angel: (k) => {
    const marble = M(0xf4f1ea, 0.35);
    cyl(k.root, 0.3, 0.35, 0.4, M(0xd8d2c6, 0.5), 0, 0.2, 0, 14);
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.0, 14), marble);
    robe.position.y = 0.9;
    k.root.add(robe);
    sph(k.root, 0.11, marble, 0, 1.5, 0, 12, 10);
    for (const s of [-1, 1]) {
      const w = sph(k.root, 0.3, marble, s * 0.25, 1.3, -0.15, 12, 8);
      w.scale.set(0.5, 1, 0.15);
      w.rotation.z = s * 0.4;
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 20), glow(0xffe08a, 2));
    halo.position.y = 1.72;
    halo.rotation.x = Math.PI / 2;
    k.root.add(halo);
    return 1.85;
  },
  trophy: (k) => {
    const g = gold();
    box(k.root, 0.4, 0.3, 0.4, M(0x17151f, 0.3), 0, 0.15, 0);
    cyl(k.root, 0.04, 0.08, 0.25, g, 0, 0.42, 0, 10);
    const cup = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.05, 0), new THREE.Vector2(0.18, 0.1), new THREE.Vector2(0.24, 0.35), new THREE.Vector2(0.26, 0.45)], 18), g);
    cup.position.y = 0.55;
    k.root.add(cup);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14, Math.PI), g);
      h.position.set(s * 0.26, 0.8, 0);
      h.rotation.z = s * -Math.PI / 2;
      k.root.add(h);
    }
    return 1.1;
  },
  velvetsofa: (k) => {
    seat(k, 0, 0, 1.8, 0.75, k.c);
    return 0.95;
  },
  // ------------------------------------------------------------------ floor inlays
  redrunner: (k) => {
    floorPlane(k.root, 0.9, 2.9, M(k.c, 1), 0, 0.012, 0);
    floorPlane(k.root, 1.0, 3.0, gold(), 0, 0.01, 0);
    return 0.05;
  },
  starfloor: (k) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.38 : 0.9;
      const a = (i / 10) * TAU;
      if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r);
      else s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    const star = new THREE.Mesh(new THREE.ShapeGeometry(s), mat(0xffd24a, { metal: 0.8, rough: 0.25, emissive: 0x6b4a00, emissiveIntensity: 0.4 }));
    star.rotation.x = -Math.PI / 2;
    star.position.y = 0.014;
    k.root.add(star);
    floorPlane(k.root, 1.95, 1.95, M(k.c, 0.6), 0, 0.01, 0);
    return 0.05;
  },
  checkrug: (k) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) floorPlane(k.root, 0.45, 0.45, M((i + j) % 2 ? 0xf4f1ea : k.c, 0.9), -0.72 + i * 0.48, 0.012, -0.72 + j * 0.48);
    floorPlane(k.root, 1.98, 1.98, M(0x17151f, 1), 0, 0.01, 0);
    return 0.05;
  },
  // ------------------------------------------------------------------ fun & party
  photobooth: (k) => {
    box(k.root, 0.95, 2.1, 1.6, M(k.c, 0.4), 0, 1.05, -0.15);
    box(k.root, 0.8, 1.6, 0.02, M(0xc8102e, 0.9), 0, 1.05, 0.66);
    const sign = box(k.root, 0.9, 0.3, 0.05, glow(0xffc53d, 1.6), 0, 1.95, 0.67);
    k.anim(sign, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 3) > -0.7));
    for (let i = 0; i < 4; i++) box(k.root, 0.18, 0.22, 0.02, M(0xf4f1ea), 0.48, 0.6 + i * 0.25, 0.3);
    return 2.2;
  },
  balloonarch: (k) => {
    const cols = [0xff4d4d, 0xffc53d, 0x2fe6ff, 0xff6fb5, 0x39ff88, 0xb77bff];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      sph(k.root, 0.17, mat(cols[i % cols.length], { rough: 0.25 }), -Math.cos(a) * 0.85, 0.15 + Math.sin(a) * 1.8, 0, 12, 10);
    }
    return 2.1;
  },
  giftpile: (k) => {
    const cols = [0xc8102e, 0x1e7a46, 0x1f4fbf, 0xffc53d, 0xff6fb5];
    for (const [x, y, z, s, c] of [[-0.15, 0.17, 0.05, 0.34, 0], [0.18, 0.13, -0.1, 0.26, 1], [0.05, 0.12, 0.25, 0.24, 2], [-0.05, 0.42, -0.02, 0.2, 3], [0.22, 0.34, 0.12, 0.14, 4]] as const) {
      box(k.root, s, s, s, M(cols[c], 0.5), x, y, z);
      box(k.root, s + 0.01, s + 0.01, 0.04, gold(), x, y, z);
      box(k.root, 0.04, s + 0.01, s + 0.01, gold(), x, y, z);
    }
    return 0.65;
  },
  xmastree: (k) => {
    cyl(k.root, 0.25, 0.22, 0.3, M(k.c, 0.5), 0, 0.15, 0, 14);
    cyl(k.root, 0.05, 0.07, 0.4, M(0x6b4422), 0, 0.4, 0, 8);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.55 - i * 0.11, 0.6, 14), mat(0x1e6a3a, { rough: 0.8, flat: true }));
      c.position.y = 0.75 + i * 0.35;
      k.root.add(c);
    }
    const star = sph(k.root, 0.1, glow(0xffe08a, 2.5), 0, 2.05, 0, 8, 6);
    void star;
    for (let i = 0; i < 18; i++) {
      const y = 0.65 + (i / 18) * 1.2;
      const r = 0.5 - (y - 0.65) * 0.36;
      const a = i * 2.4;
      const b = sph(k.root, 0.035, glow([0xff4d4d, 0xffc53d, 0x2fe6ff, 0x39ff88][i % 4], 2), Math.sin(a) * r, y, Math.cos(a) * r, 6, 4);
      k.anim(b, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 4 + i) > -0.3));
    }
    return 2.2;
  },
  pumpkins: (k) => {
    for (const [x, z, s] of [[-0.15, 0.08, 1], [0.2, -0.05, 0.8], [0.02, -0.25, 0.65]] as const) {
      const p = sph(k.root, 0.22 * s, M(0xff8a1f, 0.6), x, 0.18 * s, z, 14, 10);
      p.scale.set(1.2, 0.85, 1.2);
      cyl(k.root, 0.02, 0.03, 0.1 * s, M(0x3a6a2a), x, 0.38 * s, z, 6);
    }
    sph(k.root, 0.04, glow(0xffc53d, 2), -0.15, 0.18, 0.3, 6, 4);
    return 0.5;
  },
  pinball: (k) => {
    for (const [x, z] of [[-0.3, 0.6], [0.3, 0.6], [-0.3, -0.6], [0.3, -0.6]]) cyl(k.root, 0.03, 0.03, 0.8, chrome(), x, 0.4, z, 6);
    const table = box(k.root, 0.75, 0.25, 1.6, M(k.c, 0.3), 0, 0.92, 0);
    table.rotation.x = -0.12;
    box(k.root, 0.7, 0.02, 1.5, GLASS(), 0, 1.07, 0).rotation.x = -0.12;
    box(k.root, 0.75, 0.7, 0.15, M(k.c, 0.3), 0, 1.4, -0.78);
    const bb = box(k.root, 0.65, 0.5, 0.02, screen('game'), 0, 1.42, -0.69);
    void bb;
    for (let i = 0; i < 6; i++) {
      const l = sph(k.root, 0.04, glow([0xff3fa4, 0x2fe6ff, 0xffc53d][i % 3], 2), -0.2 + (i % 3) * 0.2, 1.07, -0.3 + Math.floor(i / 3) * 0.5, 6, 4);
      k.anim(l, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 6 + i * 1.7) > 0));
    }
    return 1.8;
  },
  arcade: (k) => {
    const body = M(k.c, 0.4);
    box(k.root, 0.7, 1.7, 0.7, body, 0, 0.85, -0.05);
    box(k.root, 0.72, 0.1, 0.4, M(0x17151f), 0, 1.0, 0.35);
    const sc = box(k.root, 0.55, 0.45, 0.02, screen('game'), 0, 1.35, 0.31);
    sc.rotation.x = -0.25;
    box(k.root, 0.72, 0.25, 0.1, glow(0xffc53d, 1.4), 0, 1.75, 0.27);
    sph(k.root, 0.05, M(0xc8102e), -0.12, 1.08, 0.42, 8, 6);
    for (let i = 0; i < 3; i++) sph(k.root, 0.03, M([0x2fe6ff, 0x39ff88, 0xffc53d][i]), 0.05 + i * 0.08, 1.07, 0.42, 6, 4);
    return 1.9;
  },
  teddy: (k) => {
    const fur = M(k.c, 0.95);
    sph(k.root, 0.32, fur, 0, 0.35, 0, 14, 10).scale.set(1, 1.1, 0.9);
    sph(k.root, 0.24, fur, 0, 0.85, 0, 14, 10);
    for (const s of [-1, 1]) {
      sph(k.root, 0.09, fur, s * 0.18, 1.05, 0, 10, 8);
      sph(k.root, 0.12, fur, s * 0.3, 0.45, 0.1, 10, 8);
      sph(k.root, 0.13, fur, s * 0.18, 0.08, 0.2, 10, 8);
      sph(k.root, 0.025, M(0x17151f), s * 0.08, 0.9, 0.2, 6, 4);
    }
    sph(k.root, 0.09, M(0xe9d7bd), 0, 0.8, 0.2, 10, 8);
    sph(k.root, 0.03, M(0x17151f), 0, 0.83, 0.28, 6, 4);
    const bow = box(k.root, 0.22, 0.08, 0.05, M(0xc8102e), 0, 0.64, 0.2);
    void bow;
    return 1.2;
  },
  rocket: (k) => {
    const body = M(0xf4f1ea, 0.3, 0.3);
    cyl(k.root, 0.22, 0.24, 1.4, body, 0, 0.95, 0, 16);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 16), M(k.c, 0.4));
    nose.position.y = 1.9;
    k.root.add(nose);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const fin = box(k.root, 0.04, 0.45, 0.3, M(k.c, 0.4), Math.sin(a) * 0.25, 0.4, Math.cos(a) * 0.25);
      fin.rotation.y = a;
    }
    cyl(k.root, 0.08, 0.08, 0.02, GLASS(), 0, 1.3, 0.22, 12).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) flame(k, Math.sin(i * 2) * 0.06, 0.05, Math.cos(i * 2) * 0.06, 1.2);
    return 2.2;
  },
  trex: (k) => {
    const bone = M(0xeae2cf, 0.7);
    box(k.root, 2.8, 0.2, 1.8, M(0x3a3742, 0.7), 0, 0.1, 0);
    for (const s of [-1, 1]) {
      cyl(k.root, 0.06, 0.08, 0.9, bone, -0.2, 0.65, s * 0.25, 8);
      cyl(k.root, 0.05, 0.06, 0.6, bone, -0.1, 0.35, s * 0.25, 8);
    }
    // Spine and ribs
    for (let i = 0; i < 14; i++) {
      const x = -1.3 + i * 0.18;
      const y = 1.25 + Math.sin(i * 0.3) * 0.15 - (i > 10 ? (i - 10) * 0.05 : 0);
      sph(k.root, 0.06, bone, x, y, 0, 8, 6);
      if (i > 3 && i < 10) {
        for (const s of [-1, 1]) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 12, Math.PI * 0.8), bone);
          r.position.set(x, y - 0.22, s * 0.02);
          r.rotation.set(0, s * Math.PI / 2, Math.PI);
          k.root.add(r);
        }
      }
    }
    const skull = box(k.root, 0.55, 0.32, 0.3, bone, 1.35, 1.45, 0);
    skull.rotation.z = -0.15;
    box(k.root, 0.45, 0.08, 0.26, bone, 1.4, 1.22, 0);
    for (let i = 0; i < 5; i++) box(k.root, 0.03, 0.06, 0.03, M(0xf4f1ea), 1.22 + i * 0.07, 1.27, 0.12);
    return 1.8;
  },
  hotairballoon: (k) => {
    box(k.root, 0.4, 0.06, 0.4, M(0x2b2b35), 0, 0.03, 0);
    cyl(k.root, 0.01, 0.01, 0.9, M(0x2b2b35), 0, 0.45, 0, 4);
    const g = new THREE.Group();
    g.position.y = 1.2;
    const env = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), mat(k.c, { rough: 0.6, flat: true }));
    env.scale.set(1, 1.2, 1);
    g.add(env);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.405, 12, 10, (i / 6) * TAU, TAU / 24), M(0xf4f1ea, 0.6));
      s.scale.set(1, 1.2, 1);
      g.add(s);
    }
    box(g, 0.18, 0.14, 0.18, M(0x8a5a2e, 0.8), 0, -0.68, 0);
    k.root.add(g);
    k.anim(g, (o, t) => (o.position.y = 1.2 + Math.sin(t * 1.2) * 0.08));
    return 1.8;
  },
  elephant: (k) => {
    const g = gold();
    box(k.root, 1.8, 0.25, 1.8, M(0x17151f, 0.4), 0, 0.12, 0);
    sph(k.root, 0.55, g, 0, 1.0, -0.1, 16, 12).scale.set(0.9, 0.85, 1.3);
    for (const [x, z] of [[-0.3, 0.35], [0.3, 0.35], [-0.3, -0.55], [0.3, -0.55]]) cyl(k.root, 0.13, 0.14, 0.6, g, x, 0.5, z, 10);
    sph(k.root, 0.33, g, 0, 1.3, 0.62, 14, 10);
    for (const s of [-1, 1]) {
      const ear = sph(k.root, 0.3, g, s * 0.35, 1.3, 0.5, 12, 8);
      ear.scale.set(0.2, 1, 0.9);
    }
    const trunk = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 14, Math.PI * 0.9), g);
    trunk.position.set(0, 0.95, 0.85);
    trunk.rotation.y = Math.PI / 2;
    k.root.add(trunk);
    box(k.root, 0.8, 0.06, 0.6, M(0xc8102e, 0.5), 0, 1.47, -0.15);
    return 1.8;
  },
  mirrorcol: (k) => {
    box(k.root, 0.6, 2.4, 0.6, mat(0xdde8f2, { metal: 1, rough: 0.05 }), 0, 1.2, 0);
    for (const y of [0.05, 2.38]) box(k.root, 0.7, 0.1, 0.7, gold(), 0, y, 0);
    return 2.5;
  },
  slotsculpt: (k) => {
    box(k.root, 0.7, 0.3, 0.5, M(0x17151f, 0.3), 0, 0.15, 0);
    const red = mat(0xc8102e, { metal: 0.4, rough: 0.2, emissive: 0x5a0000, emissiveIntensity: 0.3 });
    box(k.root, 0.7, 0.18, 0.2, red, 0, 1.55, 0);
    const stem = box(k.root, 0.2, 1.25, 0.2, red, 0.08, 0.9, 0);
    stem.rotation.z = -0.32;
    return 1.7;
  },
  horseshoe: (k) => {
    box(k.root, 0.45, 0.1, 0.3, M(0x17151f, 0.4), 0, 0.05, 0);
    cyl(k.root, 0.02, 0.02, 0.5, gold(), 0, 0.3, 0, 6);
    const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 24, Math.PI * 1.4), gold());
    shoe.position.set(0, 0.8, 0);
    shoe.rotation.z = -Math.PI * 0.2 + Math.PI;
    k.root.add(shoe);
    return 1.1;
  },
  ledcube: (k) => {
    box(k.root, 0.7, 0.08, 0.7, M(0x17151f), 0, 0.04, 0);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3fa4, emissiveIntensity: 1.2, transparent: true, opacity: 0.75, roughness: 0.2 }));
    cube.position.y = 0.4;
    k.root.add(cube);
    k.anim(cube, (o, t) => {
      ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.setHSL((t * 0.15) % 1, 1, 0.5);
      o.rotation.y = t * 0.3;
    });
    return 0.8;
  },
  crystaltree: (k) => {
    cyl(k.root, 0.25, 0.3, 0.2, M(0x17151f, 0.3), 0, 0.1, 0, 14);
    const trunk = cyl(k.root, 0.04, 0.08, 1.2, mat(0xe8eef6, { metal: 0.6, rough: 0.2 }), 0, 0.8, 0, 8);
    void trunk;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.1;
      const y = 1.0 + (i / 14) * 0.9;
      const r = 0.45 - (i / 14) * 0.25;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), mat(0xbff6ff, { rough: 0.05, emissive: [0x2fe6ff, 0xff9fcf, 0xb77bff][i % 3], emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
      c.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
      k.root.add(c);
    }
    return 2.1;
  },
  koi: (k) => {
    const stone = M(0x8a8178, 0.9);
    cyl(k.root, 0.95, 0.95, 0.25, stone, 0, 0.12, 0, 24);
    cyl(k.root, 0.85, 0.85, 0.02, mat(0x2a7a8a, { rough: 0.05, emissive: 0x0a3a40, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }), 0, 0.24, 0, 24);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group();
      const fish = sph(f, 0.08, M([0xff8a1f, 0xf4f1ea, 0xc8102e, 0xffc53d][i], 0.4), 0.45, 0, 0, 8, 6);
      fish.scale.set(0.6, 0.4, 1.6);
      f.position.y = 0.2;
      k.root.add(f);
      k.anim(f, (o, t) => (o.rotation.y = t * (0.5 + i * 0.1) + i * 1.6));
    }
    for (let i = 0; i < 3; i++) {
      const pad = cyl(k.root, 0.13, 0.13, 0.01, M(0x3a8a45), Math.sin(i * 2) * 0.5, 0.255, Math.cos(i * 2) * 0.5, 12);
      void pad;
    }
    return 0.4;
  },
  // ------------------------------------------------------------------ hotel lobby
  luggagecart: (k) => {
    const g = gold();
    box(k.root, 0.8, 0.05, 0.5, M(0xc8102e, 0.9), 0, 0.2, 0);
    for (const s of [-1, 1]) cyl(k.root, 0.02, 0.02, 1.4, g, s * 0.36, 0.9, 0, 6);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 18, Math.PI), g);
    arch.position.y = 1.6;
    k.root.add(arch);
    for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) cyl(k.root, 0.06, 0.06, 0.04, M(0x17151f), x, 0.06, z, 10).rotation.z = Math.PI / 2;
    box(k.root, 0.5, 0.35, 0.3, M(0x5a3a1a, 0.6), -0.05, 0.4, 0);
    box(k.root, 0.35, 0.28, 0.2, M(0x1f4fbf, 0.6), 0.1, 0.72, 0.02);
    return 1.8;
  },
  bellstand: (k) => {
    box(k.root, 0.5, 1.0, 0.4, M(0x5a3a1a, 0.5), 0, 0.5, 0);
    box(k.root, 0.56, 0.05, 0.46, gold(), 0, 1.02, 0);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 8, 0, TAU, 0, Math.PI / 2), gold());
    bell.position.y = 1.05;
    k.root.add(bell);
    sph(k.root, 0.02, gold(), 0, 1.15, 0, 6, 4);
    return 1.2;
  },
  roomservice: (k) => {
    box(k.root, 0.8, 0.04, 0.55, M(0xf4f1ea, 0.4), 0, 0.82, 0);
    box(k.root, 0.82, 0.3, 0.57, M(0xf4f1ea, 0.8), 0, 0.68, 0);
    for (const [x, z] of [[-0.35, -0.22], [0.35, -0.22], [-0.35, 0.22], [0.35, 0.22]]) cyl(k.root, 0.02, 0.02, 0.8, chrome(), x, 0.4, z, 6);
    const cloche = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, TAU, 0, Math.PI / 2), chrome());
    cloche.position.set(-0.15, 0.84, 0);
    k.root.add(cloche);
    cyl(k.root, 0.03, 0.03, 0.25, M(0x1d4a2a), 0.2, 0.96, 0.05, 8);
    cyl(k.root, 0.035, 0.015, 0.08, mat(0xfff1b8, { transparent: true, opacity: 0.6 }), 0.25, 0.88, -0.12, 8);
    return 1.1;
  },
  umbrellastand: (k) => {
    cyl(k.root, 0.18, 0.16, 0.6, gold(), 0, 0.3, 0, 14);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const u = cyl(k.root, 0.012, 0.012, 0.9, M(0x17151f), Math.sin(a) * 0.06, 0.75, Math.cos(a) * 0.06, 4);
      u.rotation.set(Math.cos(a) * 0.15, 0, -Math.sin(a) * 0.15);
      sph(k.root, 0.05, M([0xc8102e, 0x1f4fbf, 0x17151f, 0xffc53d][i]), Math.sin(a) * 0.12, 0.95, Math.cos(a) * 0.12, 8, 6).scale.set(1, 2.5, 1);
    }
    return 1.2;
  },
  wetfloor: (k) => {
    const y = M(0xffd23f, 0.5);
    for (const s of [-1, 1]) {
      const p = box(k.root, 0.4, 0.75, 0.02, y, 0, 0.36, s * 0.12);
      p.rotation.x = s * 0.18;
    }
    box(k.root, 0.12, 0.12, 0.03, M(0x17151f), 0, 0.5, 0.17).rotation.z = Math.PI / 4;
    return 0.8;
  },
  directory: (k) => {
    box(k.root, 0.7, 1.6, 0.12, M(0x17151f, 0.3), 0, 0.8, 0);
    box(k.root, 0.6, 1.2, 0.02, mat(0x2a3440, { emissive: 0xffd9a0, emissiveIntensity: 0.4 }), 0, 0.95, 0.07);
    for (let i = 0; i < 6; i++) box(k.root, 0.4, 0.04, 0.01, gold(), 0, 1.4 - i * 0.16, 0.085);
    box(k.root, 0.8, 0.06, 0.3, gold(), 0, 0.03, 0);
    return 1.7;
  },
  // ------------------------------------------------------------------ garden
  flowerbed: (k) => {
    box(k.root, 1.9, 0.25, 0.9, M(0x8a5a2e, 0.8), 0, 0.12, 0);
    box(k.root, 1.8, 0.03, 0.8, M(0x3a2414, 1), 0, 0.26, 0);
    for (let i = 0; i < 16; i++) {
      const x = -0.8 + (i % 8) * 0.23;
      const z = i < 8 ? -0.2 : 0.2;
      cyl(k.root, 0.01, 0.01, 0.25, M(0x2f8f45), x, 0.38, z, 4);
      sph(k.root, 0.06, M([k.c, 0xffc53d, 0xff6fb5, 0xb77bff, 0xffffff][i % 5], 0.6), x, 0.52, z, 8, 6);
    }
    return 0.6;
  },
  gnome: (k) => {
    sph(k.root, 0.13, M(0x1f4fbf, 0.6), 0, 0.17, 0, 10, 8).scale.set(1, 1.2, 1);
    sph(k.root, 0.09, M(0xf2c9a0, 0.6), 0, 0.37, 0, 10, 8);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 10), M(0xf4f1ea, 0.8));
    beard.position.set(0, 0.28, 0.05);
    beard.rotation.x = Math.PI;
    k.root.add(beard);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 12), M(k.c, 0.6));
    hat.position.y = 0.55;
    k.root.add(hat);
    sph(k.root, 0.025, M(0xff9a8a), 0, 0.37, 0.09, 6, 4);
    return 0.7;
  },
  birdbath: (k) => {
    const stone = M(0xd8d2c6, 0.8);
    cyl(k.root, 0.2, 0.25, 0.08, stone, 0, 0.04, 0, 14);
    cyl(k.root, 0.07, 0.1, 0.7, stone, 0, 0.42, 0, 10);
    const basin = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 8, 0, TAU, Math.PI / 2, Math.PI / 2), stone);
    basin.position.y = 0.95;
    k.root.add(basin);
    cyl(k.root, 0.3, 0.3, 0.02, mat(0x2fb8e0, { rough: 0.05, emissive: 0x0a5a80, emissiveIntensity: 0.4 }), 0, 0.92, 0, 18);
    const bird = new THREE.Group();
    sph(bird, 0.05, M(0x6b4422), 0, 0, 0, 8, 6).scale.set(1, 0.9, 1.5);
    sph(bird, 0.035, M(0x6b4422), 0, 0.04, 0.05, 8, 6);
    bird.position.set(0.3, 1.0, 0);
    k.root.add(bird);
    k.anim(bird, (o, t) => (o.rotation.y = Math.sin(t * 2) * 0.6));
    return 1.1;
  },
  tikitorch: (k) => {
    cyl(k.root, 0.03, 0.04, 1.7, M(0x8a5a2e, 0.9), 0, 0.85, 0, 6);
    cyl(k.root, 0.08, 0.06, 0.25, M(0x9a6a3c, 0.9), 0, 1.75, 0, 8);
    flame(k, 0, 1.88, 0, 1.6);
    return 2.2;
  },
  hammock: (k) => {
    const wood = M(0x8a5a2e, 0.8);
    for (const s of [-1, 1]) {
      cyl(k.root, 0.05, 0.05, 1.3, wood, s * 0.9, 0.65, 0, 8);
    }
    const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat(k.c, { rough: 0.9, side: THREE.DoubleSide }));
    sling.rotation.z = Math.PI / 2;
    sling.position.y = 0.95;
    k.root.add(sling);
    k.anim(sling, (o, t) => (o.rotation.x = Math.sin(t * 1.3) * 0.12));
    return 1.4;
  },
  bbq: (k) => {
    const black = M(0x17151f, 0.4, 0.5);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const l = cyl(k.root, 0.02, 0.02, 0.8, black, Math.sin(a) * 0.18, 0.4, Math.cos(a) * 0.18, 6);
      l.rotation.set(Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2);
    }
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8, 0, TAU, Math.PI / 2, Math.PI / 2), black);
    bowl.position.y = 0.9;
    k.root.add(bowl);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8, 0, TAU, 0, Math.PI / 2), M(k.c, 0.3, 0.5));
    lid.position.set(-0.15, 0.95, -0.15);
    lid.rotation.x = -0.9;
    k.root.add(lid);
    for (let i = 0; i < 3; i++) box(k.root, 0.15, 0.04, 0.05, M(0x8a3a2a, 0.6), -0.1 + i * 0.1, 0.93, 0.05);
    for (let i = 0; i < 3; i++) {
      const smoke = sph(k.root, 0.08, mat(0xdddddd, { transparent: true, opacity: 0.3 }), 0, 1.1, 0, 8, 6);
      k.anim(smoke, (o, t) => {
        const p = (t * 0.5 + i / 3) % 1;
        o.position.set(Math.sin(p * 6 + i) * 0.05, 1.05 + p * 0.8, 0);
        o.scale.setScalar(0.6 + p * 1.5);
      });
    }
    return 1.4;
  },
  firepit: (k) => {
    const stone = M(0x8a8178, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      box(k.root, 0.3, 0.25, 0.2, stone, Math.sin(a) * 0.7, 0.12, Math.cos(a) * 0.7).rotation.y = a;
    }
    for (let i = 0; i < 4; i++) {
      const log = cyl(k.root, 0.05, 0.05, 0.7, M(0x5a3a1a, 0.9), 0, 0.12, 0, 6);
      log.rotation.set(Math.PI / 2, i * 0.8, 0.3);
    }
    for (let i = 0; i < 5; i++) flame(k, Math.sin(i * 1.3) * 0.15, 0.15, Math.cos(i * 1.3) * 0.15, 2);
    return 0.9;
  },
  flamingo: (k) => {
    const pink = M(0xff6fb5, 0.5);
    for (const s of [-1, 1]) cyl(k.root, 0.01, 0.01, 0.55, M(0x17151f), s * 0.03, 0.28, 0, 4);
    sph(k.root, 0.13, pink, 0, 0.62, 0, 10, 8).scale.set(0.8, 0.8, 1.4);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14, Math.PI * 1.2), pink);
    neck.position.set(0, 0.82, 0.12);
    neck.rotation.y = Math.PI / 2;
    k.root.add(neck);
    sph(k.root, 0.05, pink, 0, 0.9, 0.24, 8, 6);
    return 1;
  },
  gardenlamp: (k) => {
    cyl(k.root, 0.03, 0.04, 1.1, M(0x17151f, 0.4, 0.5), 0, 0.55, 0, 6);
    box(k.root, 0.2, 0.25, 0.2, M(0x17151f, 0.4, 0.5), 0, 1.18, 0);
    box(k.root, 0.15, 0.2, 0.15, glow(0xffe2a8, 2.2), 0, 1.18, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), M(0x17151f, 0.4, 0.5));
    cap.rotation.y = Math.PI / 4;
    cap.position.y = 1.36;
    k.root.add(cap);
    return 1.45;
  },
  hedgeanimal: (k) => {
    cyl(k.root, 0.35, 0.3, 0.3, M(k.c, 0.6), 0, 0.15, 0, 14);
    leafBall(k, 0.3, 0, 0.6, -0.05);
    leafBall(k, 0.2, 0, 0.95, 0.15);
    for (const s of [-1, 1]) leafBall(k, 0.08, s * 0.12, 1.15, 0.12);
    leafBall(k, 0.1, 0, 0.5, -0.35);
    for (const s of [-1, 1]) leafBall(k, 0.09, s * 0.15, 0.36, 0.15);
    return 1.3;
  },
  gazebo: (k) => {
    const wood = M(0xf4f1ea, 0.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      cyl(k.root, 0.06, 0.06, 2.2, wood, Math.sin(a) * 1.3, 1.1, Math.cos(a) * 1.3, 8);
    }
    cyl(k.root, 1.45, 1.45, 0.15, wood, 0, 0.07, 0, 6);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 6), M(k.c, 0.6));
    roof.position.y = 2.6;
    k.root.add(roof);
    sph(k.root, 0.08, gold(), 0, 3.08, 0, 8, 6);
    seat(k, 0, -0.6, 1.4, 0.5, 0xc8102e, true);
    return 3.1;
  },
  beachballs: (k) => {
    for (const [x, z, r] of [[-0.12, 0.05, 0.2], [0.18, -0.1, 0.16], [0.05, 0.25, 0.14]] as const) {
      const b = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, (i / 6) * TAU, TAU / 6), M([0xff4d4d, 0xf4f1ea, 0x1f4fbf, 0xffc53d, 0x39ff88, 0xf4f1ea][i], 0.4));
        b.add(seg);
      }
      b.position.set(x, r, z);
      k.root.add(b);
    }
    return 0.4;
  },
  picnic: (k) => {
    const wood = M(0x9a6a3c, 0.8);
    box(k.root, 1.8, 0.06, 0.8, wood, 0, 0.72, 0);
    for (const s of [-1, 1]) {
      box(k.root, 1.8, 0.05, 0.28, wood, 0, 0.42, s * 0.62);
      const leg = box(k.root, 0.06, 0.8, 0.06, wood, s * 0.7, 0.36, 0);
      leg.scale.z = 18;
    }
    floorPlane(k.root, 1.0, 0.6, M(0xc8102e, 0.9), 0, 0.755, 0);
    return 0.9;
  },
  // ------------------------------------------------------------------ house: furniture
  sofa: (k) => {
    seat(k, 0, 0, 2.8, 0.85, k.c);
    for (const x of [-0.8, 0.1, 0.9]) box(k.root, 0.4, 0.35, 0.12, M(0xf4f1ea, 0.9), x, 0.62, -0.18).rotation.x = -0.2;
    return 1;
  },
  armchair: (k) => {
    seat(k, 0, 0, 0.85, 0.8, k.c);
    return 1;
  },
  coffeetable: (k) => {
    box(k.root, 1.4, 0.05, 0.6, GLASS(), 0, 0.42, 0);
    box(k.root, 1.3, 0.04, 0.5, M(k.c, 0.4), 0, 0.15, 0);
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.22, 0.22]) cyl(k.root, 0.02, 0.02, 0.42, gold(), sx, 0.21, sz, 6);
    box(k.root, 0.25, 0.04, 0.18, M(0xc8102e), -0.3, 0.46, 0.05);
    cyl(k.root, 0.06, 0.05, 0.1, M(0xf4f1ea), 0.35, 0.49, 0, 10);
    return 0.5;
  },
  tvwall: (k) => {
    box(k.root, 1.8, 0.45, 0.45, M(k.c, 0.4), 0, 0.22, 0);
    box(k.root, 1.6, 0.92, 0.05, M(0x0b0b0e, 0.2), 0, 1.0, -0.05);
    const sc = box(k.root, 1.5, 0.84, 0.01, screen('tv'), 0, 1.0, -0.02);
    k.anim(sc, (o, t) => (((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.75 + Math.sin(t * 2.3) * 0.15));
    for (const s of [-1, 1]) box(k.root, 0.15, 0.9, 0.15, M(0x17151f), s * 0.98, 0.45, 0.05);
    return 1.5;
  },
  kingbed: (k) => {
    box(k.root, 2.6, 0.35, 2.8, M(0x3a2414, 0.6), 0, 0.18, 0);
    rbox(k.root, 2.5, 0.3, 2.6, 0.08, M(0xf4f1ea, 0.85), 0, 0.5, 0.05);
    rbox(k.root, 2.52, 0.12, 1.7, 0.05, M(k.c, 0.8), 0, 0.66, 0.5);
    box(k.root, 2.7, 1.2, 0.2, M(k.c, 0.7), 0, 0.6, -1.35);
    for (const s of [-1, 1]) rbox(k.root, 0.8, 0.18, 0.45, 0.08, M(0xf4f1ea, 0.85), s * 0.6, 0.72, -1.0);
    return 1.3;
  },
  wardrobe: (k) => {
    box(k.root, 1.8, 2.1, 0.6, M(k.c, 0.5), 0, 1.05, -0.15);
    box(k.root, 0.02, 1.9, 0.02, M(0x17151f), 0, 1.05, 0.16);
    for (const s of [-1, 1]) box(k.root, 0.03, 0.3, 0.04, gold(), s * 0.1, 1.1, 0.18);
    return 2.1;
  },
  bookshelf: (k) => {
    const wood = M(k.c, 0.6);
    box(k.root, 1.8, 2.0, 0.08, wood, 0, 1.0, -0.36);
    for (const s of [-1, 1]) box(k.root, 0.06, 2.0, 0.4, wood, s * 0.87, 1.0, -0.2);
    const rnd = k.rnd;
    for (let sh = 0; sh < 5; sh++) {
      box(k.root, 1.7, 0.04, 0.4, wood, 0, 0.05 + sh * 0.45, -0.2);
      if (sh === 4) continue;
      let x = -0.8;
      while (x < 0.78) {
        const w = 0.04 + rnd() * 0.05;
        const h = 0.25 + rnd() * 0.12;
        box(k.root, w, h, 0.28, M([0xc8102e, 0x1f4fbf, 0x1e7a46, 0xf2b632, 0x6a2cc2, 0x17151f][Math.floor(rnd() * 6)], 0.7), x + w / 2, 0.07 + sh * 0.45 + h / 2, -0.2);
        x += w + 0.005;
      }
    }
    return 2.0;
  },
  diningtable: (k) => {
    box(k.root, 2.4, 0.08, 1.2, M(k.c, 0.4), 0, 0.76, 0);
    for (const sx of [-1.05, 1.05]) for (const sz of [-0.48, 0.48]) cyl(k.root, 0.04, 0.04, 0.74, M(k.c, 0.4), sx, 0.37, sz, 8);
    for (const x of [-0.7, 0, 0.7]) for (const s of [-1, 1]) {
      box(k.root, 0.45, 0.06, 0.45, M(0x5a3a1a, 0.6), x, 0.47, s * 0.85);
      box(k.root, 0.45, 0.55, 0.05, M(0x5a3a1a, 0.6), x, 0.75, s * 1.06);
      for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) cyl(k.root, 0.02, 0.02, 0.45, M(0x5a3a1a, 0.6), x + lx, 0.22, s * 0.85 + lz, 4);
    }
    for (let i = 0; i < 3; i++) cyl(k.root, 0.03, 0.03, 0.3, M(0xf4f1ea), -0.3 + i * 0.3, 0.95, 0, 6);
    for (let i = 0; i < 3; i++) flame(k, -0.3 + i * 0.3, 1.1, 0, 0.35);
    return 1.2;
  },
  kitchen: (k) => {
    box(k.root, 2.8, 0.9, 0.7, M(k.c, 0.5), 0, 0.45, -0.1);
    box(k.root, 2.85, 0.05, 0.75, M(0x2b2b35, 0.15, 0.3), 0, 0.92, -0.1);
    box(k.root, 0.6, 0.02, 0.4, chrome(), 0.6, 0.95, -0.1);
    const tap = cyl(k.root, 0.015, 0.015, 0.3, chrome(), 0.6, 1.08, -0.35, 6);
    void tap;
    for (let i = 0; i < 4; i++) box(k.root, 0.02, 0.6, 0.02, M(0x17151f), -1.2 + i * 0.6, 0.45, 0.26);
    box(k.root, 2.8, 0.7, 0.35, M(k.c, 0.5), 0, 1.9, -0.28);
    cyl(k.root, 0.12, 0.1, 0.12, M(0xc8102e, 0.4), -0.6, 1.0, -0.1, 12);
    return 2.3;
  },
  fridge: (k) => {
    rbox(k.root, 0.85, 1.95, 0.75, 0.05, mat(k.c, { rough: 0.25, metal: 0.6 }), 0, 0.98, -0.05);
    box(k.root, 0.01, 1.9, 0.02, M(0x17151f), 0, 0.98, 0.33);
    for (const s of [-1, 1]) box(k.root, 0.03, 0.5, 0.05, chrome(), s * 0.1, 1.2, 0.36);
    box(k.root, 0.3, 0.2, 0.01, mat(0x2a3440, { emissive: 0x2fe6ff, emissiveIntensity: 0.5 }), 0.22, 1.5, 0.33);
    return 2;
  },
  stove: (k) => {
    box(k.root, 0.85, 0.9, 0.7, mat(k.c, { rough: 0.3, metal: 0.5 }), 0, 0.45, -0.05);
    box(k.root, 0.6, 0.35, 0.02, M(0x17151f, 0.2), 0, 0.45, 0.31);
    for (const [x, z] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) cyl(k.root, 0.1, 0.1, 0.02, glow(0xff4d1a, 1.2), x, 0.91, z - 0.05, 14);
    cyl(k.root, 0.16, 0.14, 0.18, chrome(), -0.2, 1.0, -0.2, 14);
    return 1.1;
  },
  bathtub: (k) => {
    rbox(k.root, 1.75, 0.6, 0.85, 0.2, M(0xf8f6f0, 0.2), 0, 0.42, 0);
    box(k.root, 1.5, 0.02, 0.62, mat(0x9fdcff, { transparent: true, opacity: 0.6, emissive: 0x2fb8e0, emissiveIntensity: 0.2 }), 0, 0.66, 0);
    for (const [x, z] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) sph(k.root, 0.07, gold(), x, 0.08, z, 8, 6);
    const tap = cyl(k.root, 0.025, 0.025, 0.4, gold(), -0.78, 0.9, 0, 8);
    void tap;
    for (let i = 0; i < 6; i++) sph(k.root, 0.06 + (i % 3) * 0.02, mat(0xffffff, { rough: 0.9, transparent: true, opacity: 0.85 }), -0.4 + i * 0.16, 0.7, (i % 2) * 0.15 - 0.07, 8, 6);
    return 1;
  },
  desk: (k) => {
    box(k.root, 1.7, 0.05, 0.75, M(k.c, 0.5), 0, 0.75, 0);
    for (const s of [-1, 1]) box(k.root, 0.05, 0.74, 0.7, M(k.c, 0.5), s * 0.8, 0.37, 0);
    box(k.root, 0.8, 0.5, 0.04, M(0x0b0b0e, 0.2), 0, 1.1, -0.25);
    const sc = box(k.root, 0.74, 0.44, 0.01, screen('code'), 0, 1.1, -0.225);
    void sc;
    box(k.root, 0.5, 0.02, 0.15, M(0x2b2b35), 0, 0.79, 0.1);
    seat(k, 0, 0.75, 0.6, 0.55, 0x17151f, true, Math.PI);
    return 1.4;
  },
  fireplace: (k) => {
    box(k.root, 1.9, 1.4, 0.6, M(k.c, 0.8), 0, 0.7, -0.15);
    box(k.root, 1.0, 0.7, 0.4, M(0x17151f, 0.8), 0, 0.45, -0.08);
    box(k.root, 2.1, 0.1, 0.75, M(0x5a3a1a, 0.5), 0, 1.42, -0.1);
    for (let i = 0; i < 3; i++) cyl(k.root, 0.05, 0.05, 0.6, M(0x5a3a1a, 0.9), 0, 0.17 + i * 0.03, 0.05 - i * 0.08, 6).rotation.z = Math.PI / 2;
    for (let i = 0; i < 4; i++) flame(k, -0.25 + i * 0.17, 0.2, 0.0, 1.4);
    for (let i = 0; i < 3; i++) box(k.root, 0.12, 0.18, 0.08, M([0xc8102e, 0xffc53d, 0x1f4fbf][i]), -0.6 + i * 0.6, 1.56, -0.2);
    return 1.7;
  },
  floorlamp: (k) => {
    cyl(k.root, 0.15, 0.18, 0.04, gold(), 0, 0.02, 0, 14);
    cyl(k.root, 0.02, 0.02, 1.5, gold(), 0, 0.77, 0, 6);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.3, 16, 1, true), mat(k.c, { rough: 0.8, emissive: 0xffe2a8, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
    shade.position.y = 1.55;
    k.root.add(shade);
    sph(k.root, 0.06, glow(0xfff1b8, 2), 0, 1.5, 0, 8, 6);
    return 1.75;
  },
  plantbig: (k) => {
    cyl(k.root, 0.2, 0.16, 0.4, M(k.c, 0.5), 0, 0.2, 0, 14);
    cyl(k.root, 0.03, 0.04, 1.0, M(0x6b4422), 0, 0.85, 0, 6);
    for (let i = 0; i < 10; i++) {
      const a = i * 2.3;
      const y = 0.8 + (i / 10) * 0.9;
      const l = sph(k.root, 0.16, M(i % 2 ? 0x2f8f45 : 0x3aa655, 0.7), Math.sin(a) * 0.18, y, Math.cos(a) * 0.18, 8, 6);
      l.scale.set(1, 0.3, 0.7);
      l.rotation.y = a;
    }
    return 1.8;
  },
  nightstand: (k) => {
    box(k.root, 0.55, 0.55, 0.45, M(k.c, 0.5), 0, 0.27, 0);
    box(k.root, 0.15, 0.02, 0.03, gold(), 0, 0.4, 0.23);
    cyl(k.root, 0.06, 0.08, 0.1, gold(), 0.1, 0.6, -0.05, 10);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.15, 14, 1, true), mat(0xf4f1ea, { emissive: 0xffe2a8, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    shade.position.set(0.1, 0.78, -0.05);
    k.root.add(shade);
    return 0.9;
  },
  winerack: (k) => {
    box(k.root, 1.8, 1.8, 0.4, M(k.c, 0.6), 0, 0.9, -0.2);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      const b = cyl(k.root, 0.04, 0.04, 0.32, M([0x2a0a12, 0x1d4a2a, 0x3a1a0a][(r + c) % 3], 0.2), -0.72 + c * 0.2, 0.3 + r * 0.32, -0.05, 8);
      b.rotation.x = Math.PI / 2;
    }
    return 1.8;
  },
  homebar: (k) => {
    box(k.root, 1.8, 1.05, 0.6, M(k.c, 0.4), 0, 0.52, 0);
    box(k.root, 1.9, 0.06, 0.7, M(0x17151f, 0.1, 0.3), 0, 1.07, 0);
    box(k.root, 1.85, 0.06, 0.06, glow(0xff3fa4, 1.6), 0, 0.98, 0.31);
    for (let i = 0; i < 5; i++) cyl(k.root, 0.04, 0.04, 0.3, M([0x8a5a2e, 0x1d4a2a, 0xc8102e, 0xffc53d, 0x9fdcff][i], 0.2), -0.6 + i * 0.3, 1.25, -0.1, 8);
    for (const x of [-0.5, 0.5]) {
      cyl(k.root, 0.2, 0.2, 0.06, M(0xc8102e, 0.5), x, 0.8, 0.65, 14);
      cyl(k.root, 0.03, 0.03, 0.78, chrome(), x, 0.39, 0.65, 6);
    }
    return 1.4;
  },
  // ------------------------------------------------------------------ house: fun
  pooltable: (k) => {
    const wood = M(0x5a3a1a, 0.4);
    box(k.root, 2.6, 0.25, 1.5, wood, 0, 0.72, 0);
    box(k.root, 2.3, 0.02, 1.2, M(k.c, 0.95), 0, 0.86, 0);
    for (const sx of [-1.15, 1.15]) for (const sz of [-0.6, 0.6]) cyl(k.root, 0.09, 0.09, 0.7, wood, sx, 0.35, sz, 10);
    const cols = [0xffc53d, 0x1f4fbf, 0xc8102e, 0x6a2cc2, 0xff8a1f, 0x1e7a46, 0x8a1030, 0x17151f];
    let i = 0;
    for (let r = 0; r < 4; r++) for (let j = 0; j <= r; j++) sph(k.root, 0.04, M(cols[i++ % 8], 0.15), 0.5 + r * 0.07, 0.91, (j - r / 2) * 0.085, 10, 8);
    sph(k.root, 0.04, M(0xf8f6f0, 0.15), -0.6, 0.91, 0, 10, 8);
    const cue = cyl(k.root, 0.012, 0.02, 1.4, M(0xd8b88a, 0.5), -0.3, 0.92, 0.3, 6);
    cue.rotation.z = Math.PI / 2;
    cue.rotation.y = 0.2;
    return 1;
  },
  pingpong: (k) => {
    box(k.root, 2.6, 0.06, 1.5, M(k.c, 0.5), 0, 0.76, 0);
    floorPlane(k.root, 0.03, 1.5, M(0xf4f1ea), 0, 0.795, 0);
    box(k.root, 0.03, 0.16, 1.55, mat(0xf4f1ea, { transparent: true, opacity: 0.7 }), 0, 0.87, 0);
    for (const sx of [-1.1, 1.1]) for (const sz of [-0.6, 0.6]) box(k.root, 0.05, 0.74, 0.05, M(0x2b2b35, 0.4, 0.5), sx, 0.37, sz);
    sph(k.root, 0.025, M(0xff8a1f), 0.4, 0.82, 0.2, 8, 6);
    return 1;
  },
  drumkit: (k) => {
    const shell = mat(k.c, { rough: 0.2, metal: 0.5 });
    const kick = cyl(k.root, 0.35, 0.35, 0.35, shell, 0, 0.35, 0.1, 18);
    kick.rotation.x = Math.PI / 2;
    for (const [x, y, z, r] of [[-0.4, 0.65, 0.25, 0.18], [0.4, 0.65, 0.25, 0.18], [0.55, 0.5, -0.25, 0.22]] as const) {
      cyl(k.root, r, r, 0.22, shell, x, y, z, 16);
      cyl(k.root, 0.015, 0.015, y - 0.1, chrome(), x, (y - 0.1) / 2, z, 6);
    }
    for (const [x, y, z] of [[-0.75, 1.1, -0.1], [0.8, 1.2, 0.3]] as const) {
      cyl(k.root, 0.012, 0.012, y, chrome(), x, y / 2, z, 6);
      cyl(k.root, 0.28, 0.28, 0.01, gold(), x, y, z, 18);
    }
    seat(k, 0, -0.65, 0.4, 0.4, 0x17151f, false);
    return 1.3;
  },
  homecinema: (k) => {
    box(k.root, 2.9, 1.7, 0.08, M(0x0b0b0e), 0, 1.2, -0.38);
    const sc = box(k.root, 2.7, 1.5, 0.01, screen('movie'), 0, 1.2, -0.33);
    k.anim(sc, (o, t) => (((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(t * 1.7) * 0.25));
    for (const s of [-1, 1]) box(k.root, 0.3, 1.2, 0.3, M(0x17151f, 0.4), s * 1.3, 0.6, -0.1);
    box(k.root, 2.9, 0.1, 0.2, M(k.c, 0.8), 0, 2.1, -0.3);
    return 2.2;
  },
  gamingrig: (k) => {
    box(k.root, 1.7, 0.05, 0.75, M(0x17151f, 0.3), 0, 0.75, 0);
    for (const s of [-1, 1]) box(k.root, 0.05, 0.74, 0.7, M(0x17151f, 0.3), s * 0.8, 0.37, 0);
    for (const [x, r] of [[-0.45, 0.35], [0.45, -0.35], [0, 0]] as const) {
      const g = new THREE.Group();
      g.position.set(x, 1.05, -0.2);
      g.rotation.y = r;
      box(g, 0.55, 0.34, 0.03, M(0x0b0b0e), 0, 0, 0);
      box(g, 0.51, 0.3, 0.01, screen('game'), 0, 0, 0.02);
      k.root.add(g);
    }
    const strip = box(k.root, 1.7, 0.02, 0.02, glow(0xff3fa4, 2), 0, 0.73, 0.37);
    k.anim(strip, (o, t) => ((o as THREE.Mesh).material = glow([0xff3fa4, 0x2fe6ff, 0x39ff88, 0xffc53d][Math.floor(t * 2) % 4], 2)));
    box(k.root, 0.25, 0.5, 0.45, M(0x17151f), 0.65, 1.0, -0.1);
    seat(k, 0, 0.75, 0.65, 0.6, k.c, true, Math.PI);
    return 1.4;
  },
  treadmill: (k) => {
    box(k.root, 0.8, 0.15, 1.8, M(0x2b2b35, 0.5), 0, 0.12, 0);
    box(k.root, 0.6, 0.02, 1.6, M(0x17151f, 0.9), 0, 0.21, 0);
    for (const s of [-1, 1]) {
      const p = cyl(k.root, 0.03, 0.03, 1.2, M(k.c, 0.3, 0.5), s * 0.35, 0.7, -0.75, 6);
      p.rotation.x = 0.15;
    }
    box(k.root, 0.75, 0.25, 0.1, M(0x17151f), 0, 1.3, -0.85);
    box(k.root, 0.4, 0.15, 0.01, screen('code'), 0, 1.32, -0.8);
    return 1.4;
  },
  punchbag: (k) => {
    box(k.root, 0.6, 0.06, 0.6, M(0x2b2b35), 0, 0.03, 0);
    cyl(k.root, 0.03, 0.03, 2.2, M(0x2b2b35, 0.4, 0.5), -0.25, 1.1, 0, 6);
    box(k.root, 0.5, 0.04, 0.04, M(0x2b2b35, 0.4, 0.5), 0, 2.18, 0);
    const bag = new THREE.Group();
    bag.position.set(0.2, 2.1, 0);
    cyl(bag, 0.005, 0.005, 0.3, M(0x9aa0ab), 0, -0.15, 0, 4);
    cyl(bag, 0.18, 0.18, 0.9, M(k.c, 0.6), 0, -0.75, 0, 14);
    k.root.add(bag);
    k.anim(bag, (o, t) => (o.rotation.x = Math.sin(t * 1.4) * 0.06));
    return 2.3;
  },
  guitar: (k) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const l = cyl(k.root, 0.012, 0.012, 0.4, M(0x17151f), Math.sin(a) * 0.1, 0.18, Math.cos(a) * 0.1, 4);
      l.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4);
    }
    const g = new THREE.Group();
    g.position.set(0, 0.35, 0);
    g.rotation.x = -0.15;
    sph(g, 0.2, mat(k.c, { rough: 0.15, metal: 0.3 }), 0, 0.2, 0, 14, 10).scale.set(1, 1.2, 0.3);
    sph(g, 0.15, mat(k.c, { rough: 0.15, metal: 0.3 }), 0, 0.5, 0, 14, 10).scale.set(1, 1, 0.3);
    box(g, 0.06, 0.6, 0.03, M(0x5a3a1a), 0, 0.95, 0.02);
    box(g, 0.09, 0.15, 0.03, M(0x17151f), 0, 1.3, 0.02);
    cyl(g, 0.05, 0.05, 0.02, M(0x17151f), 0, 0.42, 0.06, 12).rotation.x = Math.PI / 2;
    k.root.add(g);
    return 1.7;
  },
  trophycase: (k) => {
    box(k.root, 1.8, 1.9, 0.5, M(k.c, 0.5), 0, 0.95, -0.2);
    box(k.root, 1.7, 1.75, 0.02, GLASS(), 0, 1.0, 0.06);
    for (let sh = 0; sh < 3; sh++) {
      box(k.root, 1.7, 0.03, 0.4, M(0xf4f1ea, 0.3), 0, 0.35 + sh * 0.55, -0.2);
      for (let i = 0; i < 3; i++) {
        const x = -0.55 + i * 0.55;
        cyl(k.root, 0.05, 0.08, 0.2, gold(), x, 0.47 + sh * 0.55, -0.2, 10);
        cyl(k.root, 0.08, 0.04, 0.12, gold(), x, 0.63 + sh * 0.55, -0.2, 10);
      }
    }
    return 2;
  },
  hottubhome: (k) => {
    rbox(k.root, 1.9, 0.8, 1.9, 0.15, M(k.c, 0.5), 0, 0.4, 0);
    const water = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.02, 1.6), mat(0x9fdcff, { emissive: 0x2fb8e0, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, rough: 0.05 }));
    water.position.y = 0.78;
    k.root.add(water);
    for (let i = 0; i < 6; i++) {
      const b = sph(k.root, 0.04, mat(0xffffff, { transparent: true, opacity: 0.6 }), 0, 0.8, 0, 6, 4);
      k.anim(b, (o, t) => {
        const p = (t * 0.8 + i / 6) % 1;
        o.position.set(Math.sin(i * 2.1) * 0.5, 0.78 + p * 0.06, Math.cos(i * 1.7) * 0.5);
        o.scale.setScalar(1 - p);
      });
    }
    return 0.9;
  },
  slothome: (k) => {
    rbox(k.root, 0.65, 1.5, 0.6, 0.08, M(k.c, 0.3, 0.4), 0, 0.75, 0);
    box(k.root, 0.45, 0.3, 0.02, mat(0xfffbf0, { emissive: 0xffd9a0, emissiveIntensity: 0.5 }), 0, 1.0, 0.31);
    for (let i = 0; i < 3; i++) box(k.root, 0.12, 0.24, 0.01, M(0xc8102e), -0.14 + i * 0.14, 1.0, 0.325);
    const top = box(k.root, 0.6, 0.18, 0.1, glow(0xffc53d, 1.8), 0, 1.4, 0.28);
    k.anim(top, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 5) > -0.5));
    const arm = cyl(k.root, 0.02, 0.02, 0.4, chrome(), 0.38, 1.0, 0, 6);
    void arm;
    sph(k.root, 0.05, M(0xc8102e), 0.38, 1.22, 0, 8, 6);
    return 1.6;
  },
  // ------------------------------------------------------------------ house: security
  cctv: (k) => {
    cyl(k.root, 0.04, 0.05, 2.2, M(0x9aa0ab, 0.4, 0.6), 0, 1.1, 0, 8);
    const cam = new THREE.Group();
    cam.name = 'camHead';
    cam.position.y = 2.2;
    box(cam, 0.15, 0.15, 0.4, M(0xf4f1ea, 0.4), 0, 0, 0.15);
    cyl(cam, 0.06, 0.06, 0.03, M(0x17151f), 0, 0, 0.36, 12).rotation.x = Math.PI / 2;
    const led = sph(cam, 0.02, glow(0xff2a2a, 3), 0.05, 0.05, 0.34, 6, 4);
    k.root.add(cam);
    k.anim(cam, (o, t) => (o.rotation.y = Math.sin(t * 0.6) * 0.9));
    k.anim(led, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 4) > 0));
    return 2.4;
  },
  laser: (k) => {
    for (const s of [-1, 1]) {
      box(k.root, 0.12, 1.4, 0.12, M(0x17151f, 0.3, 0.5), s * 0.85, 0.7, 0);
      for (let i = 0; i < 4; i++) sph(k.root, 0.03, glow(0xff2a2a, 3), s * 0.78, 0.25 + i * 0.32, 0, 6, 4);
    }
    const beams = new THREE.Group();
    beams.name = 'laserBeams';
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.015, 0.015), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      b.position.y = 0.25 + i * 0.32;
      b.rotation.z = (i % 2 ? 1 : -1) * 0.06;
      beams.add(b);
    }
    k.root.add(beams);
    k.anim(beams, (o, t) => {
      o.children.forEach((c, i) => (((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 8 + i) * 0.3));
    });
    return 1.5;
  },
  alarm: (k) => {
    box(k.root, 0.12, 1.2, 0.12, M(0x2b2b35, 0.4, 0.5), 0, 0.6, -0.2);
    box(k.root, 0.5, 0.6, 0.12, M(0xf4f1ea, 0.4), 0, 1.4, -0.15);
    box(k.root, 0.36, 0.2, 0.01, mat(0x0b1a10, { emissive: 0x39ff88, emissiveIntensity: 0.8 }), 0, 1.5, -0.085);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(k.root, 0.06, 0.04, 0.02, M(0x9aa0ab), -0.08 + c * 0.08, 1.33 - r * 0.06, -0.085);
    const beacon = sph(k.root, 0.08, glow(0xff2a2a, 3), 0, 1.8, -0.15, 10, 8);
    k.anim(beacon, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 6) > 0.2));
    return 1.9;
  },
  doghouse: (k) => {
    box(k.root, 1.2, 0.9, 1.2, M(k.c, 0.8), -0.3, 0.45, -0.3);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.85, 1.3, 3, 1), M(0xc8102e, 0.7));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, 0.5);
    roof.position.set(-0.3, 1.15, -0.3);
    k.root.add(roof);
    box(k.root, 0.45, 0.55, 0.02, M(0x17151f), -0.3, 0.28, 0.31);
    // A sleepy guard dog
    const dog = new THREE.Group();
    dog.name = 'guardDog';
    dog.position.set(0.45, 0, 0.5);
    const fur = M(0x6b4422, 0.9);
    sph(dog, 0.22, fur, 0, 0.25, 0, 12, 8).scale.set(0.8, 0.8, 1.4);
    sph(dog, 0.15, fur, 0, 0.42, 0.3, 12, 8);
    sph(dog, 0.07, fur, 0, 0.38, 0.45, 8, 6);
    sph(dog, 0.03, M(0x17151f), 0, 0.4, 0.52, 6, 4);
    for (const s of [-1, 1]) sph(dog, 0.07, M(0x3a2414), s * 0.12, 0.5, 0.25, 8, 6).scale.set(0.5, 1.2, 0.8);
    for (const [x, z] of [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]]) cyl(dog, 0.04, 0.04, 0.2, fur, x, 0.08, z, 6);
    box(dog, 0.3, 0.05, 0.05, M(0xc8102e), 0, 0.35, 0.22);
    k.root.add(dog);
    k.anim(dog, (o, t) => (o.children[0].scale.y = 0.8 + Math.sin(t * 1.5) * 0.04));
    return 1.4;
  },
  safe: (k) => {
    rbox(k.root, 0.75, 0.85, 0.65, 0.05, mat(0x3a3c44, { metal: 0.7, rough: 0.35 }), 0, 0.43, 0);
    box(k.root, 0.6, 0.7, 0.02, mat(0x2b2b35, { metal: 0.7, rough: 0.3 }), 0, 0.45, 0.33);
    const dial = cyl(k.root, 0.09, 0.09, 0.04, chrome(), -0.1, 0.5, 0.35, 16);
    dial.rotation.x = Math.PI / 2;
    box(k.root, 0.04, 0.2, 0.05, chrome(), 0.18, 0.45, 0.36);
    return 0.9;
  },
  metaldetector: (k) => {
    const gray = M(0xd8d2c6, 0.4);
    for (const s of [-1, 1]) box(k.root, 0.15, 2.1, 0.5, gray, s * 0.45, 1.05, 0);
    box(k.root, 1.05, 0.2, 0.5, gray, 0, 2.15, 0);
    for (const s of [-1, 1]) {
      const l = box(k.root, 0.02, 1.6, 0.02, glow(0x39ff88, 1.6), s * 0.37, 1.05, 0.24);
      void l;
    }
    const top = sph(k.root, 0.05, glow(0x39ff88, 2.5), 0, 2.28, 0.2, 6, 4);
    k.anim(top, (o, t) => ((o as THREE.Mesh).visible = Math.sin(t * 2) > -0.3));
    return 2.3;
  },
  spotlight: (k) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const l = cyl(k.root, 0.02, 0.02, 0.9, M(0x2b2b35), Math.sin(a) * 0.15, 0.42, Math.cos(a) * 0.15, 4);
      l.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    }
    const head = new THREE.Group();
    head.name = 'spotHead';
    head.position.y = 0.95;
    const c = cyl(head, 0.2, 0.15, 0.35, M(0x2b2b35, 0.4, 0.5), 0, 0, 0.05, 14);
    c.rotation.x = Math.PI / 2;
    cyl(head, 0.18, 0.18, 0.02, glow(0xfff2c8, 3), 0, 0, 0.23, 14).rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.rotation.x = -Math.PI / 2;
    beam.position.z = 2.2;
    head.add(beam);
    k.root.add(head);
    k.anim(head, (o, t) => {
      o.rotation.y = Math.sin(t * 0.5) * 0.9;
      o.rotation.x = -0.25;
    });
    return 1.3;
  },
  panicbutton: (k) => {
    cyl(k.root, 0.18, 0.22, 1.0, M(0x2b2b35, 0.4, 0.5), 0, 0.5, 0, 14);
    cyl(k.root, 0.2, 0.2, 0.06, M(0xffd23f, 0.5), 0, 1.03, 0, 16);
    const btn = sph(k.root, 0.12, mat(0xff2a2a, { emissive: 0xff2a2a, emissiveIntensity: 0.6, rough: 0.3 }), 0, 1.08, 0, 14, 8);
    btn.scale.y = 0.5;
    return 1.2;
  },
};

export function kitModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const anims: { o: THREE.Object3D; f: (o: THREE.Object3D, t: number, dt: number) => void }[] = [];
  const k: Kit = {
    root, dyn, c: o.color,
    m: (color, rough = 0.6, metal = 0) => mat(color, { rough, metal }),
    anim: (obj, f) => {
      dyn.keep(obj);
      anims.push({ o: obj, f });
    },
    rnd: seeded(o.color + String(o.params.kit ?? '').length * 17),
  };
  const recipe = R[String(o.params.kit)] ?? R.vase;
  const height = recipe(k);
  bake(root, dyn);
  return {
    root,
    height,
    update(dt, ctx) {
      for (const a of anims) a.f(a.o, ctx.t, dt);
    },
    event() {},
    dispose() {
      disposeTree(root);
    },
  };
}

/** The kits that exist (for tests). */
export const KIT_IDS = Object.keys(R);

/**
 * The vault: a steel door set in a reinforced frame. Its look follows the vault's tier
 * (`level`): more bolts, thicker steel, titanium blue, diamond white, solid gold. The door
 * swings open on a 'door' event and gold glows inside.
 */
export function vaultModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const tier = Math.max(1, Math.min(5, o.level));
  const steelCol = [0x8c9099, 0x6f7480, 0x7d93ad, 0xdfe9f5, 0xf2b632][tier - 1];
  const steel = tier === 5 ? gold() : mat(steelCol, { metal: 0.85, rough: tier === 4 ? 0.08 : 0.3, emissive: tier === 4 ? 0x3a4a66 : 0, emissiveIntensity: tier === 4 ? 0.4 : 1 });
  const dark = mat(0x2b2d33, { metal: 0.6, rough: 0.45 });
  const W = 2.9;
  const H = 2.6;
  // Frame: a thick wall block with a round opening (approximated by a ring)
  box(root, W, H, 0.7, mat(0x4a4d55, { metal: 0.5, rough: 0.6 }), 0, H / 2, -0.55);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.14 + tier * 0.02, 12, 40), steel);
  ring.position.set(0, 1.3, -0.17);
  root.add(ring);
  // Hazard stripes and a nameplate
  for (let i = 0; i < 7; i++) box(root, 0.3, 0.06, 0.02, mat(i % 2 ? 0x17151f : 0xffd23f, { rough: 0.6 }), -1.05 + i * 0.35, 0.08, -0.19);
  // Inside: gold bars glow behind the door
  const inside = new THREE.Group();
  inside.position.set(0, 1.3, -0.35);
  cyl(inside, 0.9, 0.9, 0.05, mat(0x1a1a20, { rough: 0.8 }), 0, 0, -0.1, 30).rotation.x = Math.PI / 2;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.14), mat(0xf2b632, { metal: 0.9, rough: 0.2, emissive: 0x6b4a00, emissiveIntensity: 0.6 }));
    b.position.set(-0.42 + i * 0.3 + r * 0.15, -0.6 + r * 0.11, 0);
    inside.add(b);
  }
  sph(inside, 0.3, glow(0xffd27a, 0.8), 0, 0, -0.05, 12, 8).scale.set(2.2, 2.2, 0.1);
  root.add(inside);
  // The door, hinged on its left edge
  const hinge = new THREE.Group();
  hinge.position.set(-0.95, 1.3, -0.12);
  const door = new THREE.Group();
  door.position.x = 0.95;
  hinge.add(door);
  const slab = cyl(door, 0.92, 0.92, 0.22 + tier * 0.04, steel, 0, 0, 0.05, 40);
  slab.rotation.x = Math.PI / 2;
  const face = cyl(door, 0.78, 0.78, 0.03, dark, 0, 0, 0.18 + tier * 0.02, 40);
  face.rotation.x = Math.PI / 2;
  // Bolts around the rim
  const bolts = [4, 6, 8, 10, 12][tier - 1];
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * TAU;
    const b = cyl(door, 0.06, 0.06, 0.18, chrome(), Math.cos(a) * 0.86, Math.sin(a) * 0.86, 0.12, 10);
    b.rotation.x = Math.PI / 2;
  }
  // Spoked wheel handle
  const wheel = new THREE.Group();
  wheel.position.z = 0.28 + tier * 0.03;
  const hub = cyl(wheel, 0.1, 0.1, 0.12, chrome(), 0, 0, 0, 16);
  hub.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const sp = cyl(wheel, 0.025, 0.025, 0.85, chrome(), 0, 0, 0.02, 8);
    sp.rotation.z = (i / 4) * Math.PI;
    sph(wheel, 0.05, chrome(), Math.cos((i / 4) * TAU) * 0.42, Math.sin((i / 4) * TAU) * 0.42, 0.02, 8, 6);
    sph(wheel, 0.05, chrome(), -Math.cos((i / 4) * TAU) * 0.42, -Math.sin((i / 4) * TAU) * 0.42, 0.02, 8, 6);
  }
  door.add(wheel);
  // Combination dial and keypad
  const dial = cyl(door, 0.13, 0.13, 0.05, mat(0x17151f, { metal: 0.4, rough: 0.3 }), 0, 0.5, 0.25 + tier * 0.02, 24);
  dial.rotation.x = Math.PI / 2;
  box(root, 0.32, 0.45, 0.06, dark, 1.25, 1.35, -0.18);
  const screenM = mat(0x0b1a10, { emissive: 0x39ff88, emissiveIntensity: 0.9 });
  box(root, 0.24, 0.08, 0.01, screenM, 1.25, 1.5, -0.145);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(root, 0.06, 0.05, 0.02, chrome(), 1.17 + c * 0.08, 1.4 - r * 0.07, -0.145);
  const led = sph(root, 0.03, glow(0xff2a2a, 3), 1.25, 1.62, -0.14, 8, 6);
  root.add(hinge);
  dyn.keep(hinge);
  dyn.keep(led);
  bake(root, dyn);
  let open = false;
  let swing = 0;
  return {
    root,
    height: H + 0.2,
    update(dt, ctx) {
      const target = open ? 1 : 0;
      // The wheel spins first, then the door swings.
      swing += (target - swing) * Math.min(1, dt * (open ? 1.6 : 3));
      wheel.rotation.z = swing * Math.PI * 2.2;
      hinge.rotation.y = -Math.max(0, swing - 0.15) / 0.85 * 1.9;
      led.material = open ? glow(0x39ff88, 3) : glow(0xff2a2a, 3);
      led.visible = open || Math.sin(ctx.t * 3) > -0.4;
    },
    event(ev) {
      if (ev.type === 'door') open = ev.open;
    },
    dispose() {
      disposeTree(root);
    },
  };
}
