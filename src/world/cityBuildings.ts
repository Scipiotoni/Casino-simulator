import * as THREE from 'three';
import { mat, glow, gold, chrome } from '../render/materials';
import { canvasTexture, makeCanvas, seeded } from '../render/textures';
import { box, cyl, sph } from '../items/models/common';
import { CENTER_X, FACADE_Z } from './grid';
import { type FillerSpec, hash01 } from './city';
import { CARS, buildCar } from './vehicles';

/** Facade textures: `map` is the wall (white, tinted by the material) with dark windows, `glow` lights some of them. */
interface Facade {
  map: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  /** World size one copy of the texture covers. */
  uw: number;
  uh: number;
}

const facades = new Map<string, Facade>();

/** 8×8 window modules, 2.5 m wide and one 3 m storey tall each. */
function facade(kind: 'punched' | 'glass' | 'metal' | 'brick' | 'shutters'): Facade {
  const hit = facades.get(kind);
  if (hit) return hit;
  const N = 256;
  const { canvas, ctx } = makeCanvas(N, N);
  const lit = makeCanvas(N, N);
  const g = lit.ctx;
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  const rnd = seeded(kind.length * 977);
  const M = N / 8;
  if (kind === 'glass') {
    ctx.fillStyle = '#6f8aa6';
    ctx.fillRect(0, 0, N, N);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x = c * M;
        const y = r * M;
        const grd = ctx.createLinearGradient(x, y, x + M, y + M);
        grd.addColorStop(0, '#2a3f5c');
        grd.addColorStop(1, '#4d6f94');
        ctx.fillStyle = grd;
        ctx.fillRect(x + 1, y + 2, M - 2, M - 7);
        if (rnd() < 0.35) {
          g.fillStyle = rnd() < 0.5 ? '#ffd9a0' : '#cfe6ff';
          g.globalAlpha = 0.5 + rnd() * 0.5;
          g.fillRect(x + 1, y + 2, M - 2, M - 7);
        }
      }
    }
    g.globalAlpha = 1;
    ctx.fillStyle = '#c9d3dd';
    for (let r = 0; r < 8; r++) ctx.fillRect(0, r * M + M - 5, N, 5);
  } else if (kind === 'metal') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, N, N);
    for (let x = 0; x < N; x += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, 0, 3, N);
    }
    for (let c = 0; c < 8; c += 3) {
      ctx.fillStyle = '#3a3c44';
      ctx.fillRect(c * M + 6, N - M * 0.55, M - 12, M * 0.12);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, N, N);
    if (kind === 'brick') {
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < N; y += 6) {
        ctx.fillRect(0, y, N, 1);
        for (let x = (y / 6) % 2 ? 0 : 6; x < N; x += 12) ctx.fillRect(x, y, 1, 6);
      }
    }
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x = c * M + 7;
        const y = r * M + 6;
        const w = M - 14;
        const h = M - 13;
        ctx.fillStyle = '#e8e2d6';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 5);
        ctx.fillStyle = '#26303d';
        ctx.fillRect(x, y, w, h);
        if (kind === 'shutters') {
          ctx.fillStyle = '#5b7a5a';
          ctx.fillRect(x - 6, y - 1, 5, h + 2);
          ctx.fillRect(x + w + 1, y - 1, 5, h + 2);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + w / 2 - 1, y, 2, h);
        if (rnd() < 0.42) {
          g.fillStyle = rnd() < 0.7 ? '#ffc874' : '#a8d2ff';
          g.globalAlpha = 0.55 + rnd() * 0.45;
          g.fillRect(x, y, w, h);
        }
      }
    }
    g.globalAlpha = 1;
  }
  const f: Facade = { map: canvasTexture(canvas, true), glow: canvasTexture(lit.canvas, true), uw: 20, uh: 24 };
  facades.set(kind, f);
  return f;
}

function facadeMat(kind: Parameters<typeof facade>[0], color: number): THREE.MeshStandardMaterial {
  const f = facade(kind);
  return mat(color, { map: f.map, emissive: 0xffffff, emissiveMap: f.glow, emissiveIntensity: 0.8, rough: kind === 'glass' ? 0.2 : 0.85, metal: kind === 'glass' ? 0.4 : 0 });
}

/** A box whose side faces tile the facade texture in world units (top and bottom take a plain wall pixel). */
function texBox(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, uw = 20, uh = 24): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const fw = f < 2 ? d : w;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (f === 2 || f === 3) uv.setXY(k, 0.001, 0.001);
      else uv.setXY(k, (uv.getX(k) * fw) / uw, (uv.getY(k) * h) / uh);
    }
  }
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Name plate texture (kept so the exterior can dispose it). */
function plate(text: string, bg: string, fg: string, font = '800 64px Nunito, Arial, sans-serif', w = 512, h = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4, w - 30);
  return canvasTexture(canvas);
}

function signMesh(parent: THREE.Object3D, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, glowing = true, rotY = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: glowing ? 0xffffff : 0x000000, emissiveMap: glowing ? tex : null, emissiveIntensity: glowing ? 0.9 : 0, roughness: 0.6 }));
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  parent.add(m);
  return m;
}

const hexCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface Built {
  /** Meshes that must not be merged (they carry their own material/texture). */
  keep: THREE.Object3D[];
  textures: THREE.Texture[];
  update?: (dt: number, t: number) => void;
}

function tree(s: THREE.Object3D, x: number, z: number, k = 1): void {
  cyl(s, 0.1 * k, 0.15 * k, 2 * k, mat(0x6b4422, { rough: 0.9 }), x, k, z, 7);
  const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * k, 1), mat(0x2f8f45, { rough: 0.8, flat: true }));
  c.position.set(x, 2.5 * k, z);
  s.add(c);
}

function palm(s: THREE.Object3D, x: number, z: number, hgt = 4): void {
  for (let i = 0; i < 6; i++) cyl(s, 0.12, 0.15, hgt / 6, mat(i % 2 ? 0x8a5a2e : 0x6b4422, { rough: 0.9 }), x + i * 0.03, (i + 0.5) * (hgt / 6), z, 7);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat(i % 2 ? 0x2f9a4a : 0x3fb35a, { rough: 0.7 }));
    leaf.scale.set(0.5, 0.22, 3.6);
    const a = (i / 7) * Math.PI * 2;
    leaf.position.set(x + 0.18 + Math.sin(a) * 0.75, hgt + 0.1, z + Math.cos(a) * 0.75);
    leaf.rotation.set(0.35, a, 0, 'YXZ');
    s.add(leaf);
  }
}

function parkedCar(s: THREE.Object3D, x: number, z: number, yaw: number, color: number): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  box(g, 1.8, 0.7, 4.2, mat(color, { rough: 0.25, metal: 0.55 }), 0, 0.7, 0);
  box(g, 1.55, 0.55, 2.1, mat(color, { rough: 0.25, metal: 0.55 }), 0, 1.3, -0.2);
  box(g, 1.58, 0.42, 1.95, mat(0x15141a, { rough: 0.3 }), 0, 1.3, -0.2);
  for (const sx of [-0.82, 0.82]) for (const sz of [-1.3, 1.3]) {
    const w = cyl(g, 0.36, 0.36, 0.26, mat(0x15141a, { rough: 0.6 }), sx, 0.36, sz, 12);
    w.rotation.z = Math.PI / 2;
  }
  s.add(g);
}

/** Generic block building with a textured facade, roof slab, parapet and rooftop clutter. */
function block(s: THREE.Object3D, spec: FillerSpec, kind: Parameters<typeof facade>[0], w: number, d: number, H: number, x = CENTER_X, zFront = FACADE_Z): void {
  const z0 = zFront - d;
  const wall = facadeMat(kind, spec.color);
  texBox(s, w, H, d, wall, x, H / 2, (z0 + zFront) / 2);
  const roof = mat(0x3a3742, { rough: 0.95 });
  box(s, w + 0.4, 0.4, d + 0.4, roof, x, H + 0.2, (z0 + zFront) / 2);
  const rnd = (k: number) => hash01(spec.seed + k * 13);
  for (let i = 0; i < Math.max(2, Math.round(w / 7)); i++) {
    const ax = x - w / 2 + 2 + rnd(i) * (w - 4);
    const az = z0 + 2 + rnd(i + 9) * Math.max(1, d - 4);
    box(s, 1.6, 0.9, 1.3, mat(0x8a8794, { rough: 0.6, metal: 0.3 }), ax, H + 0.85, az);
  }
}

function storefront(s: THREE.Object3D, x: number, w: number, color: number, text: string, b: Built, zFront = FACADE_Z, awning = true): void {
  box(s, w - 0.6, 2.2, 0.1, mat(0x2a3440, { emissive: 0xffc874, emissiveIntensity: 0.35, rough: 0.1, metal: 0.3 }), x, 1.3, zFront + 0.06);
  box(s, 1.2, 2.3, 0.12, mat(0x1a1a20, { rough: 0.3 }), x, 1.15, zFront + 0.08);
  if (awning) {
    const aw = box(s, w - 0.2, 0.12, 1.6, mat(color, { rough: 0.8 }), x, 2.75, zFront + 0.8);
    aw.rotation.x = 0.25;
  }
  const t = plate(text.toUpperCase(), '#14121a', hexCss(color === 0xffffff ? 0xffc53d : color), '800 58px Bungee, "Arial Black", sans-serif');
  b.textures.push(t);
  b.keep.push(signMesh(s, t, Math.min(w - 0.6, 6), 0.9, x, 3.35, zFront + 0.12));
}

/** A filler building (they're just scenery; players' buildings replace them). */
export function buildFiller(s: THREE.Group, spec: FillerSpec): Built {
  const b: Built = { keep: [], textures: [] };
  const { w, d } = spec;
  const H = spec.floors * 3;
  const x0 = CENTER_X - w / 2;
  const x1 = CENTER_X + w / 2;
  const zF = FACADE_Z;
  const z0 = zF - d;
  const rnd = (k: number) => hash01(spec.seed + k * 31);
  switch (spec.kind) {
    case 'apartments': {
      block(s, spec, rnd(1) < 0.5 ? 'punched' : 'shutters', w, d, H);
      // Ground-floor shops and an entrance canopy
      storefront(s, x0 + w * 0.25, w * 0.4, spec.accent, rnd(2) < 0.5 ? 'Café' : 'Market', b);
      box(s, 3.2, 0.15, 1.8, mat(0x2b2b35, { metal: 0.5 }), CENTER_X + w * 0.2, 2.8, zF + 0.9);
      for (let f = 1; f < spec.floors; f++) {
        for (let x = x0 + 2.5; x < x1 - 2; x += 5) {
          box(s, 2.2, 0.12, 0.9, mat(0xd8d2c6, { rough: 0.6 }), x, f * 3 + 0.05, zF + 0.45);
          box(s, 2.2, 0.6, 0.05, mat(0x2b2b35, { metal: 0.6 }), x, f * 3 + 0.4, zF + 0.88);
        }
      }
      break;
    }
    case 'office': {
      block(s, spec, 'glass', w, d, H);
      box(s, w + 0.6, 3.2, 0.5, mat(0x2b2b35, { metal: 0.6, rough: 0.3 }), CENTER_X, 1.6, zF + 0.1);
      box(s, w * 0.6, 2.6, 0.1, mat(0x2a3440, { emissive: 0xfff2d0, emissiveIntensity: 0.4, rough: 0.1 }), CENTER_X, 1.4, zF + 0.36);
      const t = plate(spec.name.toUpperCase(), '#1c1f26', '#f4f1ea', '800 50px Nunito, Arial, sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, Math.min(w - 2, 10), 1.1, CENTER_X, 3.8, zF + 0.4, false));
      break;
    }
    case 'tower': {
      const podium = 2 * 3;
      block(s, spec, 'punched', w + 2, d + 2, podium);
      const tw = w - 6;
      const td = d - 6;
      texBox(s, tw, H, td, facadeMat('glass', 0xffffff), CENTER_X, podium + H / 2, zF - 1 - td / 2 - 2);
      box(s, tw + 0.6, 0.6, td + 0.6, mat(0x2b2b35, { metal: 0.6 }), CENTER_X, podium + H + 0.3, zF - 3 - td / 2);
      cyl(s, 0.12, 0.2, 7, chrome(), CENTER_X + 2, podium + H + 3.8, zF - 3 - td / 2, 8);
      const beacon = sph(s, 0.3, glow(0xff2a2a, 3), CENTER_X + 2, podium + H + 7.4, zF - 3 - td / 2, 10, 8);
      b.keep.push(beacon);
      const t = plate(spec.name.toUpperCase(), '#0e1420', hexCss(spec.accent), '800 52px Bungee, "Arial Black", sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, tw * 0.8, tw * 0.2, CENTER_X, podium + H - 2, zF - 3 - td + td + 0.05));
      b.update = (_dt, t) => {
        (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 3) > 0.4 ? 3 : 0.2;
      };
      break;
    }
    case 'diner': {
      const dw = w;
      box(s, dw, 3.4, d, mat(0xd9dde3, { metal: 0.7, rough: 0.25 }), CENTER_X, 1.7, zF - d / 2);
      box(s, dw + 0.2, 0.35, d + 0.2, mat(spec.accent, { emissive: spec.accent, emissiveIntensity: 0.6 }), CENTER_X, 3.45, zF - d / 2);
      box(s, dw - 1.4, 1.5, 0.08, mat(0x2a3440, { emissive: 0xffd9a0, emissiveIntensity: 0.5, rough: 0.1 }), CENTER_X, 1.8, zF + 0.04);
      box(s, dw + 0.1, 0.5, 0.1, mat(0xc8102e, { rough: 0.5 }), CENTER_X, 0.4, zF + 0.05);
      const t = plate(spec.name.toUpperCase(), '#14121a', hexCss(spec.accent), '400 70px Pacifico, cursive');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 7, 1.8, CENTER_X, 4.8, zF - 1));
      cyl(s, 0.18, 0.18, 6, mat(0x9aa0ab, { metal: 0.7 }), x1 + 2, 3, zF + 1, 8);
      const pole = plate('EAT', '#c8102e', '#fff4d6', '800 90px Bungee, "Arial Black", sans-serif', 256, 128);
      b.textures.push(pole);
      b.keep.push(signMesh(s, pole, 2.4, 1.2, x1 + 2, 6.4, zF + 1.2));
      for (let i = 0; i < 3; i++) parkedCar(s, x0 + 4 + i * 5, zF - d - 4, 0, [0xc8102e, 0x7ff3ff, 0xf2b632][i]);
      break;
    }
    case 'gasstation': {
      box(s, 10, 3.2, 8, mat(0xe9e1d3, { rough: 0.7 }), x0 + 5, 1.6, zF - d + 4);
      box(s, 10.4, 0.5, 8.4, mat(spec.accent, { emissive: spec.accent, emissiveIntensity: 0.4 }), x0 + 5, 3.4, zF - d + 4);
      box(s, 14, 0.6, 9, mat(0xf4f1ea, { rough: 0.6 }), CENTER_X + 3, 5, zF - 4.5);
      box(s, 14.2, 0.25, 9.2, mat(spec.accent, { emissive: spec.accent, emissiveIntensity: 0.8 }), CENTER_X + 3, 4.65, zF - 4.5);
      for (const px of [CENTER_X - 1, CENTER_X + 7]) {
        cyl(s, 0.25, 0.25, 4.7, mat(0xf4f1ea), px, 2.35, zF - 4.5, 10);
        box(s, 0.8, 1.6, 0.6, mat(0xc8102e, { rough: 0.4 }), px + 1.4, 0.8, zF - 4.5);
      }
      const t = plate(spec.name.toUpperCase(), '#14121a', '#ffd23f', '800 60px Bungee, "Arial Black", sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 5, 1.2, x0 + 5, 4.4, zF - d + 8.05));
      parkedCar(s, CENTER_X + 3, zF - 4.5, Math.PI / 2, 0x1f4fbf);
      break;
    }
    case 'shops': {
      block(s, spec, 'brick', w, d, H);
      const n = 3;
      const sw = w / n;
      const names = ['Pizza', 'Pawn', 'Donuts', 'Barber', 'Chapel', 'Tattoo', 'Liquor', 'Gifts', 'Nails', 'Shoes'];
      for (let i = 0; i < n; i++) {
        const nm = names[Math.floor(rnd(i + 3) * names.length)];
        storefront(s, x0 + sw * (i + 0.5), sw, [0xc8102e, 0x1e7a46, 0x1f4fbf, 0xff6fb5, 0xf2b632, 0x6a2cc2][Math.floor(rnd(i + 7) * 6)], nm, b);
      }
      break;
    }
    case 'warehouse': {
      const wall = facadeMat('metal', spec.color);
      texBox(s, w, H + 2, d, wall, CENTER_X, (H + 2) / 2, zF - d / 2, 10, 10);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 16, 1, false, -Math.PI / 2, Math.PI), mat(0x8a8794, { metal: 0.5, rough: 0.5 }));
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.25);
      roof.position.set(CENTER_X, H + 2, zF - d / 2);
      s.add(roof);
      for (let i = 0; i < 3; i++) box(s, 4, 3.6, 0.1, mat(0x5b6575, { metal: 0.4 }), x0 + 5 + i * 8, 1.8, zF + 0.05);
      const t = plate(spec.name.toUpperCase(), '#f4f1ea', '#1c1f26', '800 56px Nunito, Arial, sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 8, 1.2, CENTER_X, H + 0.9, zF + 0.06, false));
      break;
    }
    case 'park': {
      box(s, w, 0.06, d, mat(0x3f8a37, { rough: 1 }), CENTER_X, 0.03, zF - d / 2);
      box(s, 2.4, 0.07, d, mat(0xd8cbb4, { rough: 0.9 }), CENTER_X, 0.04, zF - d / 2);
      box(s, w, 0.07, 2.4, mat(0xd8cbb4, { rough: 0.9 }), CENTER_X, 0.04, zF - d / 2);
      cyl(s, 2.2, 2.5, 0.6, mat(0xe9e1d3, { rough: 0.6 }), CENTER_X, 0.3, zF - d / 2, 24);
      const water = cyl(s, 2, 2, 0.05, mat(0x2fb8e0, { emissive: 0x0a5a80, emissiveIntensity: 0.6, rough: 0.05 }), CENTER_X, 0.6, zF - d / 2, 24);
      void water;
      cyl(s, 0.3, 0.4, 1.6, mat(0xe9e1d3), CENTER_X, 1.2, zF - d / 2, 12);
      for (let i = 0; i < 14; i++) {
        const tx = x0 + 2 + rnd(i) * (w - 4);
        const tz = z0 + 2 + rnd(i + 20) * (d - 4);
        if (Math.abs(tx - CENTER_X) < 2.5 || Math.abs(tz - (zF - d / 2)) < 3.5) continue;
        tree(s, tx, tz, 0.9 + rnd(i + 40) * 0.6);
      }
      for (const [bx, bz] of [[CENTER_X - 4, zF - d / 2 - 2], [CENTER_X + 4, zF - d / 2 + 2], [CENTER_X - 2, zF - 6]]) {
        box(s, 1.6, 0.08, 0.45, mat(0x8a5a2e, { rough: 0.8 }), bx, 0.45, bz);
        box(s, 1.5, 0.45, 0.35, mat(0x2b2b35, { metal: 0.5 }), bx, 0.22, bz);
      }
      // Low iron fence with a gate
      const fence = mat(0x1a1a20, { metal: 0.6, rough: 0.4 });
      box(s, CENTER_X - 1.5 - x0, 0.9, 0.08, fence, (x0 + CENTER_X - 1.5) / 2, 0.45, zF - 0.2);
      box(s, x1 - CENTER_X - 1.5, 0.9, 0.08, fence, (x1 + CENTER_X + 1.5) / 2, 0.45, zF - 0.2);
      const t = plate(spec.name, '#1d6b3e', '#f4f1ea');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 3.6, 0.9, CENTER_X, 2.2, zF - 0.1, false));
      for (const px of [CENTER_X - 1.9, CENTER_X + 1.9]) cyl(s, 0.12, 0.12, 2.6, fence, px, 1.3, zF - 0.2, 8);
      break;
    }
    case 'parking': {
      box(s, w, 0.04, d, mat(0x2d2a33, { rough: 0.95 }), CENTER_X, 0.02, zF - d / 2);
      const line = mat(0xf4f1ea, { rough: 0.6 });
      for (let row = 0; row < 3; row++) {
        const rz = zF - 6 - row * 12;
        for (let x = x0 + 1; x <= x1 - 1; x += 3) box(s, 0.12, 0.05, 5, line, x, 0.04, rz);
        for (let x = x0 + 2.5; x < x1 - 1; x += 3) if (rnd(x + row * 50) < 0.6) parkedCar(s, x, rz, rnd(x + row) < 0.5 ? 0 : Math.PI, [0xc8102e, 0x1f4fbf, 0xe9e1d3, 0x17151f, 0x9aa0ab, 0x1e7a46, 0xffc21a][Math.floor(rnd(x * 3 + row) * 7)]);
      }
      box(s, 2, 2.4, 2, mat(0xf2b632, { rough: 0.6 }), x1 - 2, 1.2, zF - 1.5);
      const t = plate('P  ' + spec.name.toUpperCase(), '#1f4fbf', '#ffffff', '800 64px Nunito, Arial, sans-serif');
      b.textures.push(t);
      cyl(s, 0.1, 0.1, 4, mat(0x9aa0ab, { metal: 0.6 }), x0 + 2, 2, zF - 0.5, 8);
      b.keep.push(signMesh(s, t, 4, 1, x0 + 2, 4.2, zF - 0.4));
      break;
    }
    case 'brownstone': {
      const n = 4;
      const uw = w / n;
      for (let i = 0; i < n; i++) {
        const c = [0x8c4a32, 0x9c6b4e, 0x7a3f2a, 0xa8775a][Math.floor(rnd(i) * 4)];
        texBox(s, uw - 0.1, H, d, facadeMat('brick', c), x0 + uw * (i + 0.5), H / 2, zF - d / 2);
        box(s, uw + 0.1, 0.5, 0.6, mat(0xe9e1d3, { rough: 0.7 }), x0 + uw * (i + 0.5), H + 0.1, zF + 0.1);
        // Stoop
        for (let st = 0; st < 4; st++) box(s, 1.8, 0.25, 0.5, mat(0x8a8178, { rough: 0.9 }), x0 + uw * (i + 0.5), 0.12 + st * 0.25, zF + 2 - st * 0.45);
        box(s, 1.2, 2.2, 0.08, mat(0x1d2a3a, { rough: 0.4 }), x0 + uw * (i + 0.5), 2.1, zF + 0.05);
      }
      box(s, w + 0.2, 0.4, d + 0.2, mat(0x3a3742, { rough: 0.95 }), CENTER_X, H + 0.2, zF - d / 2);
      break;
    }
    case 'hotelOld': {
      block(s, spec, 'punched', w, d, H);
      const rail = mat(spec.accent, { rough: 0.5 });
      box(s, w + 0.4, 0.15, 1.5, mat(0xd8d2c6), CENTER_X, 3, zF + 0.75);
      box(s, w + 0.4, 0.8, 0.06, rail, CENTER_X, 3.5, zF + 1.48);
      for (let x = x0; x <= x1; x += 4) cyl(s, 0.08, 0.08, 3, mat(0xd8d2c6), x, 1.5, zF + 1.4, 6);
      cyl(s, 0.2, 0.2, 8, mat(0x9aa0ab, { metal: 0.6 }), x1 + 2, 4, zF + 1, 8);
      const t = plate(spec.name.toUpperCase(), '#0b3a4a', hexCss(spec.accent), '400 66px Pacifico, cursive', 512, 192);
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 4, 1.5, x1 + 2, 8.2, zF + 1.2));
      const vac = plate('VACANCY', '#14121a', '#ff4d4d', '800 70px Bungee, "Arial Black", sans-serif', 512, 128);
      b.textures.push(vac);
      b.keep.push(signMesh(s, vac, 3, 0.7, x1 + 2, 6.9, zF + 1.2));
      break;
    }
    case 'villa': {
      const wall = mat(0xf4efe4, { rough: 0.8 });
      box(s, w, H, d, wall, CENTER_X, H / 2, zF - d / 2 - 3);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.6, 3, 4), mat(0xb5532e, { rough: 0.8 }));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(w / Math.hypot(w, d) * 1.45, 1, d / Math.hypot(w, d) * 1.45);
      roof.position.set(CENTER_X, H + 1.5, zF - d / 2 - 3);
      s.add(roof);
      for (let f = 0; f < spec.floors; f++) for (let x = x0 + 2; x < x1 - 1; x += 3.2) box(s, 1.4, 1.8, 0.1, mat(0x26303d, { emissive: 0xffc874, emissiveIntensity: rnd(x + f) < 0.4 ? 0.5 : 0, rough: 0.2 }), x, f * 3 + 1.6, zF - 2.95);
      box(s, 1.8, 2.5, 0.12, mat(0x5a3a1a, { rough: 0.6 }), CENTER_X, 1.25, zF - 2.94);
      // Garden wall and palms
      box(s, w + 4, 1.2, 0.4, wall, CENTER_X, 0.6, zF - 0.3);
      palm(s, x0 + 1, zF - 1.5, 4.5);
      palm(s, x1 - 1, zF - 1.5, 5);
      cyl(s, 1.5, 1.5, 0.1, mat(0x2fb8e0, { emissive: 0x0a5a80, emissiveIntensity: 0.6, rough: 0.05 }), x1 + 3, 0.1, zF - d / 2, 18);
      break;
    }
    case 'cottage': {
      const wall = mat(spec.color, { rough: 0.85 });
      box(s, w, 3, d, wall, CENTER_X, 1.5, zF - d / 2 - 3);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, d / 2 + 0.8, w + 0.8, 3, 1), mat(0x4a3a3a, { rough: 0.85, flat: true }));
      roof.rotation.z = Math.PI / 2;
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      roof.position.set(CENTER_X, 3 + 1.0, zF - d / 2 - 3);
      s.add(roof);
      box(s, 1.2, 2.2, 0.1, mat(0x1d4fa0, { rough: 0.5 }), CENTER_X, 1.1, zF - 2.95);
      for (const x of [x0 + 2, x1 - 2]) box(s, 1.6, 1.3, 0.1, mat(0x26303d, { emissive: 0xffc874, emissiveIntensity: 0.4, rough: 0.2 }), x, 1.6, zF - 2.95);
      // Picket fence
      const white = mat(0xf4f1ea, { rough: 0.7 });
      for (let x = x0 - 1; x <= x1 + 1; x += 0.5) if (Math.abs(x - CENTER_X) > 1) box(s, 0.1, 0.8, 0.06, white, x, 0.4, zF - 0.3);
      box(s, w + 2, 0.08, 0.06, white, CENTER_X, 0.6, zF - 0.3);
      tree(s, x1 + 2.5, zF - 6, 1.2);
      break;
    }
    case 'church': {
      box(s, w, 6, d, mat(0xf4efe4, { rough: 0.8 }), CENTER_X, 3, zF - d / 2);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, w / 2 + 0.6, d + 0.6, 3, 1), mat(0x5a2a2a, { rough: 0.8, flat: true }));
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      roof.position.set(CENTER_X, 6 + 1.6, zF - d / 2);
      s.add(roof);
      box(s, 3.2, 12, 3.2, mat(0xf4efe4, { rough: 0.8 }), CENTER_X, 6, zF - 1.6);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 4), mat(0x5a2a2a, { rough: 0.8 }));
      spire.rotation.y = Math.PI / 4;
      spire.position.set(CENTER_X, 14.5, zF - 1.6);
      s.add(spire);
      box(s, 0.15, 1.6, 0.15, gold(), CENTER_X, 17.6, zF - 1.6);
      box(s, 0.9, 0.15, 0.15, gold(), CENTER_X, 17.8, zF - 1.6);
      box(s, 1.8, 3, 0.1, mat(0x5a3a1a, { rough: 0.6 }), CENTER_X, 1.5, zF + 0.02);
      sph(s, 0.8, mat(0x8fd3ff, { emissive: 0x4fa0ff, emissiveIntensity: 0.6 }), CENTER_X, 9, zF + 0.02, 14, 10).scale.set(1, 1, 0.1);
      const t = plate(spec.name, '#f4efe4', '#5a2a2a', '400 56px Pacifico, cursive');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, 4, 1, CENTER_X, 3.6, zF + 0.06, false));
      break;
    }
    case 'cinema': {
      block(s, spec, 'brick', w, d, H);
      const mq = mat(0x14121a, { rough: 0.4 });
      box(s, w - 2, 2.2, 2.4, mq, CENTER_X, 4.4, zF + 1.2);
      const t = plate('NOW SHOWING · CASINO ROYALE', '#14121a', '#ffd23f', '800 40px Bungee, "Arial Black", sans-serif', 1024, 128);
      b.textures.push(t);
      b.keep.push(signMesh(s, t, w - 2.4, 1.1, CENTER_X, 4.4, zF + 2.42));
      const n = plate(spec.name.toUpperCase(), '#c8102e', '#fff4d6', '800 60px Bungee, "Arial Black", sans-serif', 256, 512);
      b.textures.push(n);
      b.keep.push(signMesh(s, n, 2, 6, x1 - 2, H + 1, zF + 0.4));
      const bulbs = glow(0xfff1b8, 2.2);
      for (let x = x0 + 1.2; x < x1 - 1; x += 0.6) sph(s, 0.08, bulbs, x, 3.25, zF + 2.42, 6, 4);
      box(s, w * 0.5, 2.4, 0.1, mat(0x2a3440, { emissive: 0xffd9a0, emissiveIntensity: 0.4 }), CENTER_X, 1.4, zF + 0.05);
      break;
    }
    case 'factory': {
      const wall = facadeMat('metal', spec.color);
      texBox(s, w, H, d, wall, CENTER_X, H / 2, zF - d / 2, 10, 10);
      // Saw-tooth roof lights and two smokestacks.
      const glass = mat(0x8fb4cf, { rough: 0.2, metal: 0.4, emissive: 0x203040, emissiveIntensity: 0.4 });
      for (let z = z0 + 3; z < zF - 2; z += 6) {
        const tooth = box(s, w - 1, 0.18, 3.4, glass, CENTER_X, H + 1.1, z);
        tooth.rotation.x = -0.6;
      }
      box(s, w + 0.3, 0.3, d + 0.3, mat(0x5a5862, { rough: 0.8 }), CENTER_X, H + 0.15, zF - d / 2);
      const brick = mat(0x8c4a32, { rough: 0.9 });
      for (const [sx, hh] of [[x0 + 4, 14], [x0 + 9, 11]] as const) {
        cyl(s, 0.9, 1.2, hh, brick, sx, H + hh / 2, z0 + 5, 12);
        cyl(s, 1.0, 1.0, 0.5, mat(0x2b2b35), sx, H + hh, z0 + 5, 12);
      }
      for (let i = 0; i < 2; i++) box(s, 5, 4, 0.1, mat(0x5b6575, { metal: 0.4 }), x1 - 5 - i * 7, 2, zF + 0.05);
      // Loading yard out back: pallets and a container.
      box(s, 6, 2.6, 2.4, mat([0xc8102e, 0x1f4fbf, 0x1e7a46][Math.floor(rnd(3) * 3)], { rough: 0.6, metal: 0.3 }), x0 + 6, 1.3, z0 - 4);
      const t = plate(spec.name.toUpperCase(), '#1c1f26', hexCss(spec.accent), '800 52px Bungee, "Arial Black", sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, Math.min(w - 4, 12), 1.6, CENTER_X, H - 1.2, zF + 0.06));
      break;
    }
    case 'hospital': {
      block(s, spec, 'punched', w, d, H);
      // White box, a red cross on the roof, an ambulance bay with a canopy.
      box(s, w + 0.3, 0.5, 0.4, mat(0xf4f1ea, { rough: 0.5 }), CENTER_X, 3.2, zF + 0.2);
      box(s, 10, 0.3, 4, mat(0xf4f1ea, { rough: 0.6 }), CENTER_X - 6, 3.4, zF + 2);
      for (const px of [CENTER_X - 10.5, CENTER_X - 1.5]) cyl(s, 0.15, 0.15, 3.4, mat(0xd8d2c6), px, 1.7, zF + 3.6, 8);
      const red = mat(0xd62a2a, { emissive: 0xd62a2a, emissiveIntensity: 0.8, rough: 0.5 });
      box(s, 6, 0.2, 1.8, red, CENTER_X, H + 0.55, zF - d / 2);
      box(s, 1.8, 0.2, 6, red, CENTER_X, H + 0.55, zF - d / 2);
      const t = plate(spec.name.toUpperCase(), '#f4f1ea', '#d62a2a', '800 50px Nunito, Arial, sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, Math.min(w - 4, 12), 1.2, CENTER_X, H - 1.6, zF + 0.06));
      parkedCar(s, CENTER_X - 6, zF + 2.4, 0, 0xf4f1ea);
      break;
    }
    case 'firestation': {
      const red = facadeMat('brick', 0xa8322a);
      texBox(s, w, H, d, red, CENTER_X, H / 2, zF - d / 2);
      box(s, w + 0.4, 0.4, d + 0.4, mat(0x3a3742, { rough: 0.95 }), CENTER_X, H + 0.2, zF - d / 2);
      // Three engine bays with roll-up doors, and the hose tower.
      for (let i = 0; i < 3; i++) box(s, 5, 3.6, 0.1, mat(0xd8d2c6, { rough: 0.4, metal: 0.4 }), x0 + 4 + i * 6.5, 1.8, zF + 0.06);
      box(s, 4, H + 6, 4, red, x1 - 2.5, (H + 6) / 2, z0 + 2.5);
      const t = plate(spec.name.toUpperCase(), '#14121a', '#ffd23f', '800 52px Bungee, "Arial Black", sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, Math.min(w - 4, 12), 1.1, CENTER_X, H - 0.9, zF + 0.08));
      const light = sph(s, 0.25, glow(0xff2a2a, 2.5), x1 - 2.5, H + 6.4, z0 + 2.5, 10, 8);
      b.keep.push(light);
      b.update = (_dt, tt) => {
        (light.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(tt * 4) > 0 ? 2.5 : 0.2;
      };
      break;
    }
    case 'school': {
      block(s, spec, 'brick', w, d, H);
      // A clock over the door, a flagpole and a yellow bus out front.
      cyl(s, 1.1, 1.1, 0.15, mat(0xf4f1ea, { rough: 0.4 }), CENTER_X, H - 1, zF + 0.1, 24).rotation.x = Math.PI / 2;
      cyl(s, 0.07, 0.07, 9, mat(0xd8d2c6, { metal: 0.6 }), x0 - 1.5, 4.5, zF - 1, 8);
      box(s, 1.6, 1.0, 0.04, mat(0x1f4fbf, { rough: 0.6 }), x0 - 0.7, 8.4, zF - 1);
      const bus = new THREE.Group();
      box(bus, 2.4, 2.4, 9, mat(0xffc21a, { rough: 0.5 }), 0, 1.5, 0);
      box(bus, 2.42, 0.7, 7.6, mat(0x1a1a20, { rough: 0.2 }), 0, 2.1, -0.4);
      bus.position.set(x1 - 3, 0, z0 - 8);
      s.add(bus);
      const t = plate(spec.name.toUpperCase(), '#f4efe4', '#7a1f1f', '800 50px Nunito, Arial, sans-serif');
      b.textures.push(t);
      b.keep.push(signMesh(s, t, Math.min(w - 4, 12), 1.1, CENTER_X, 3.2, zF + 0.06, false));
      break;
    }
    case 'centralpark':
      break;
  }
  return b;
}

/**
 * A player's house from the street: a modern two-storey villa sized to the lot's floor plan,
 * with big windows, a flat roof, a garage with a sports car beside it, hedges and a mailbox.
 */
export function buildHouse(s: THREE.Group, x0: number, x1: number, z0: number, H: number, wallColor: number, trimColor: number, name: string, garage = true): Built {
  const b: Built = { keep: [], textures: [] };
  const z1 = FACADE_Z;
  const w = x1 - x0;
  const d = z1 - z0;
  const wall = mat(wallColor, { rough: 0.8 });
  const dark = mat(0x2b2b35, { rough: 0.6 });
  const wood = mat(0x8a5a2e, { rough: 0.7 });
  const glass = mat(0x2a3440, { emissive: 0xffc874, emissiveIntensity: 0.45, rough: 0.08, metal: 0.3 });
  const T = 0.3;
  const door = 1;
  // Walls with the door opening
  box(s, w + T, H, T, wall, CENTER_X, H / 2, z0);
  box(s, T, H, d, wall, x0, H / 2, (z0 + z1) / 2);
  box(s, T, H, d, wall, x1, H / 2, (z0 + z1) / 2);
  box(s, CENTER_X - door - x0, H, T, wall, (x0 + CENTER_X - door) / 2, H / 2, z1);
  box(s, x1 - CENTER_X - door, H, T, wall, (x1 + CENTER_X + door) / 2, H / 2, z1);
  box(s, door * 2, H - 2.6, T, wall, CENTER_X, 2.6 + (H - 2.6) / 2, z1);
  // Wood cladding panel and a cantilevered flat roof
  box(s, Math.min(6, w * 0.3), H - 0.2, 0.12, wood, x0 + Math.min(6, w * 0.3) / 2 + 0.2, H / 2, z1 + 0.18);
  box(s, w + 2, 0.35, d + 1.6, mat(0xd8d2c6, { rough: 0.85 }), CENTER_X, H + 0.15, (z0 + z1) / 2 + 0.6);
  box(s, w + 2.1, 0.08, 0.1, mat(trimColor, { emissive: trimColor, emissiveIntensity: 1.2 }), CENTER_X, H, z1 + 1.42);
  // Roof terrace: decking, a glass rail, loungers and a row of solar panels
  const deckW = Math.min(w - 2, 10);
  box(s, deckW, 0.08, 6, wood, CENTER_X + w / 2 - deckW / 2 - 1, H + 0.37, z1 - 3.5);
  box(s, deckW, 0.8, 0.05, mat(0x9fdcff, { transparent: true, opacity: 0.35 }), CENTER_X + w / 2 - deckW / 2 - 1, H + 0.8, z1 - 0.5);
  for (let i = 0; i < 2; i++) {
    const lx = CENTER_X + w / 2 - 3 - i * 2.2;
    const l = box(s, 0.8, 0.12, 1.8, mat(0xf4f1ea, { rough: 0.8 }), lx, H + 0.55, z1 - 3.4);
    l.rotation.x = -0.15;
  }
  cyl(s, 1.1, 1.1, 0.06, mat(0xff6fb5, { rough: 0.7 }), CENTER_X + w / 2 - deckW + 1, H + 2.2, z1 - 3.8, 12);
  cyl(s, 0.04, 0.04, 1.9, dark, CENTER_X + w / 2 - deckW + 1, H + 1.3, z1 - 3.8, 6);
  const solar = mat(0x1d2a4a, { rough: 0.2, metal: 0.5, emissive: 0x0a1a3a, emissiveIntensity: 0.3 });
  for (let i = 0; i < Math.max(2, Math.floor((d - 8) / 2.4)); i++) {
    for (let j = 0; j < 2; j++) {
      const pnl = box(s, 1.8, 0.06, 1.1, solar, x0 + 2 + j * 2.1, H + 0.6, z0 + 2 + i * 1.4);
      pnl.rotation.x = -0.35;
    }
  }
  // Floor-to-ceiling glass
  const floors = Math.max(1, Math.round(H / 3));
  for (let f = 0; f < floors; f++) {
    const y = f * 3 + 1.45;
    for (const [a, c] of [[x0 + Math.min(6, w * 0.3) + 0.8, CENTER_X - 1.6], [CENTER_X + 1.6, x1 - 0.8]]) {
      if (c - a < 1) continue;
      box(s, c - a, 2.3, 0.08, glass, (a + c) / 2, y, z1 + 0.17);
    }
    if (f > 0) {
      box(s, 4, 0.1, 1.2, dark, CENTER_X, f * 3, z1 + 0.6);
      box(s, 4, 0.9, 0.04, mat(0x9fdcff, { transparent: true, opacity: 0.35 }), CENTER_X, f * 3 + 0.5, z1 + 1.18);
    }
  }
  box(s, door * 2, 2.6, 0.08, mat(0x3a2414, { rough: 0.5 }), CENTER_X, 1.3, z1 + 0.04);
  box(s, 0.06, 0.4, 0.06, gold(), CENTER_X + 0.6, 1.2, z1 + 0.12);
  // Name plate and house number
  const t = plate(name, '#1c1f26', '#f4f1ea', '800 54px Nunito, Arial, sans-serif');
  b.textures.push(t);
  b.keep.push(signMesh(s, t, 2.6, 0.65, CENTER_X, 3.0, z1 + 0.2));
  // Garage on the side with a sports car out front (your own house has a real one).
  const gx = x1 + 3.6;
  if (garage) {
    box(s, 6.4, 3, 7, wall, gx, 1.5, z1 - 3.6);
    box(s, 6.8, 0.3, 7.4, dark, gx, 3.1, z1 - 3.6);
    box(s, 5, 2.4, 0.08, mat(0xd8d2c6, { rough: 0.5, metal: 0.3 }), gx, 1.2, z1 - 0.06);
    box(s, 5.6, 0.04, 4.6, mat(0x8a8178, { rough: 0.9 }), gx, 0.02, z1 + 2.2);
    parkedCar(s, gx, z1 + 2.4, 0, trimColor === 0xffffff ? 0xc8102e : trimColor);
  }
  // Hedges, lamps and a mailbox
  const hedge = mat(0x2f7a3a, { rough: 0.95 });
  box(s, x0 - (CENTER_X - 18) , 1, 0.8, hedge, (x0 + CENTER_X - 18) / 2, 0.5, z1 - 0.2);
  for (const px of [CENTER_X - 2, CENTER_X + 2]) {
    cyl(s, 0.06, 0.06, 1.2, dark, px, 0.6, z1 + 0.9, 8);
    sph(s, 0.14, glow(0xffe2a8, 2), px, 1.25, z1 + 0.9, 10, 8);
  }
  box(s, 0.35, 0.3, 0.5, mat(0x1f4fbf, { rough: 0.5 }), x0 - 1.2, 1.1, z1 + 0.6);
  cyl(s, 0.04, 0.04, 1, dark, x0 - 1.2, 0.5, z1 + 0.6, 6);
  palm(s, x0 - 2.5, z1 - 2, 4.6);
  return b;
}

/** Bullseye Guns: a brick gun store with barred windows, a target logo and a range out back. */
export function buildGunShop(s: THREE.Group, name: string): Built {
  const b: Built = { keep: [], textures: [] };
  const w = 18;
  const d = 14;
  const x0 = CENTER_X - w / 2;
  const x1 = CENTER_X + w / 2;
  const zF = FACADE_Z;
  const z0 = zF - d;
  const brick = facadeMat('brick', 0x8c4a32);
  const T = 0.3;
  texBox(s, w + T, 4.5, T, brick, CENTER_X, 2.25, z0);
  texBox(s, T, 4.5, d, brick, x0, 2.25, (z0 + zF) / 2);
  texBox(s, T, 4.5, d, brick, x1, 2.25, (z0 + zF) / 2);
  texBox(s, CENTER_X - 1 - x0, 4.5, T, brick, (x0 + CENTER_X - 1) / 2, 2.25, zF);
  texBox(s, x1 - CENTER_X - 1, 4.5, T, brick, (x1 + CENTER_X + 1) / 2, 2.25, zF);
  texBox(s, 2, 2, T, brick, CENTER_X, 3.5, zF);
  box(s, w + 0.6, 0.4, d + 0.6, mat(0x2b2b35, { rough: 0.9 }), CENTER_X, 4.7, (z0 + zF) / 2);
  // Barred windows
  const bars = mat(0x1a1a20, { metal: 0.7, rough: 0.4 });
  for (const wx of [x0 + 4, x1 - 4]) {
    box(s, 4.5, 1.8, 0.08, mat(0x2a3440, { emissive: 0xffd9a0, emissiveIntensity: 0.35, rough: 0.1 }), wx, 1.7, zF + 0.17);
    for (let i = -2; i <= 2; i++) box(s, 0.06, 1.9, 0.06, bars, wx + i * 0.95, 1.7, zF + 0.24);
  }
  box(s, 2, 2.5, 0.08, mat(0x1a1a20, { rough: 0.4 }), CENTER_X, 1.25, zF + 0.05);
  // Big sign
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = '#14121a';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);
  for (const [r, c] of [[100, '#ff4d4d'], [76, '#f4f1ea'], [52, '#ff4d4d'], [28, '#f4f1ea'], [12, '#ff4d4d']] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(140, 128, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '400 92px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), 270, 120, 720);
  ctx.font = '700 34px Nunito, Arial, sans-serif';
  ctx.fillStyle = '#ffb3b3';
  ctx.fillText('STREET USE ONLY · NO GUNS INSIDE', 275, 205, 720);
  const t = canvasTexture(canvas);
  b.textures.push(t);
  b.keep.push(signMesh(s, t, 12, 3, CENTER_X, 6.6, zF + 0.1));
  for (const px of [CENTER_X - 5, CENTER_X + 5]) box(s, 0.15, 2.2, 0.15, bars, px, 5.6, zF - 0.2);
  // Target dummies and a fence out back (the range)
  const fence = mat(0x6b6478, { metal: 0.6, rough: 0.4 });
  box(s, w, 2, 0.08, fence, CENTER_X, 1, z0 - 12);
  box(s, 0.08, 2, 12, fence, x0, 1, z0 - 6);
  box(s, 0.08, 2, 12, fence, x1, 1, z0 - 6);
  for (let i = 0; i < 3; i++) {
    const tx = x0 + 4 + i * 5;
    box(s, 0.1, 1.6, 0.1, mat(0x8a5a2e), tx, 0.8, z0 - 10);
    const tg = cyl(s, 0.6, 0.6, 0.06, mat(0xf4f1ea), tx, 1.8, z0 - 10, 18);
    tg.rotation.x = Math.PI / 2;
    const tr = cyl(s, 0.35, 0.35, 0.07, mat(0xff4d4d), tx, 1.8, z0 - 10, 18);
    tr.rotation.x = Math.PI / 2;
  }
  // Open sign
  const op = plate('OPEN', '#14121a', '#39ff88', '800 80px Bungee, "Arial Black", sans-serif', 256, 128);
  b.textures.push(op);
  const om = signMesh(s, op, 1.2, 0.6, x0 + 4, 2.9, zF + 0.3);
  b.keep.push(om);
  b.update = (_dt, time) => {
    (om.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(time * 2.2) > -0.6 ? 1 : 0.2;
  };
  return b;
}

/** Velocity Motors: a glass car showroom with cars turning on turntables. */
export function buildDealer(s: THREE.Group, name: string): Built {
  const b: Built = { keep: [], textures: [] };
  const w = 20;
  const d = 14;
  const x0 = CENTER_X - w / 2;
  const x1 = CENTER_X + w / 2;
  const zF = FACADE_Z;
  const z0 = zF - d;
  const H = 6;
  const frame = mat(0x1b1d24, { metal: 0.7, rough: 0.35 });
  const glass = mat(0x9fd6ff, { transparent: true, opacity: 0.22, rough: 0.05, metal: 0.3, depthWrite: false });
  // Floor, back and side walls, roof
  box(s, w, 0.08, d, mat(0xe8e8ee, { rough: 0.12, metal: 0.2 }), CENTER_X, 0.04, (z0 + zF) / 2);
  box(s, w, H, 0.3, mat(0x2a2c33, { rough: 0.6 }), CENTER_X, H / 2, z0);
  box(s, 0.3, H, d, mat(0x2a2c33, { rough: 0.6 }), x0, H / 2, (z0 + zF) / 2);
  box(s, 0.3, H, d, mat(0x2a2c33, { rough: 0.6 }), x1, H / 2, (z0 + zF) / 2);
  box(s, w + 0.8, 0.5, d + 0.8, frame, CENTER_X, H + 0.25, (z0 + zF) / 2);
  // Glass front with mullions and a neon line along the top
  const pane = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.06), glass);
  pane.position.set(CENTER_X, H / 2, zF);
  pane.renderOrder = 3;
  s.add(pane);
  for (let i = 0; i <= 5; i++) box(s, 0.14, H, 0.14, frame, x0 + (i * w) / 5, H / 2, zF);
  box(s, w, 0.12, 0.12, glow(0x2fe6ff, 2.6), CENTER_X, H - 0.15, zF + 0.1);
  // Ceiling lights
  for (let i = 0; i < 4; i++) box(s, 3, 0.06, 0.4, glow(0xffffff, 1.6), x0 + 2.5 + i * 5, H - 0.05, (z0 + zF) / 2);
  // Cars on turntables
  const shown: { def: string; color: number; x: number; z: number }[] = [
    { def: 'super', color: 0xff2a2a, x: CENTER_X - 5, z: zF - 4.5 },
    { def: 'hyper', color: 0xf2b632, x: CENTER_X + 5, z: zF - 4.5 },
    { def: 'muscle', color: 0xff8a1f, x: CENTER_X, z: zF - 10 },
  ];
  const tables: THREE.Group[] = [];
  for (const c of shown) {
    const def = CARS.find((x) => x.id === c.def);
    if (!def) continue;
    const t = new THREE.Group();
    t.position.set(c.x, 0.1, c.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.12, 40), mat(0x2b2d36, { metal: 0.6, rough: 0.3 }));
    t.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.05, 6, 48), glow(0xff3fa4, 2.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.07;
    t.add(ring);
    const car = buildCar(def, c.color);
    car.root.position.y = 0.06;
    t.add(car.root);
    s.add(t);
    tables.push(t);
    b.keep.push(t);
  }
  // Big sign on the roof
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 0, 1024, 256);
  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#2fe6ff');
  grad.addColorStop(1, '#ff3fa4');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);
  ctx.fillStyle = grad;
  ctx.font = 'italic 400 100px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), 512, 112, 960);
  ctx.font = '700 34px Nunito, Arial, sans-serif';
  ctx.fillStyle = '#c9f7ff';
  ctx.fillText('SUPERCARS · MUSCLE · LIMOS · EVS', 512, 206, 900);
  const t = canvasTexture(canvas);
  b.textures.push(t);
  b.keep.push(signMesh(s, t, 14, 3.5, CENTER_X, H + 2.4, zF + 0.1));
  // Flags out front
  for (const fx of [x0 + 0.6, x1 - 0.6]) {
    box(s, 0.08, 4.5, 0.08, chrome(), fx, 2.25, zF + 1.2);
    box(s, 0.05, 1, 1.4, glow(fx < CENTER_X ? 0x2fe6ff : 0xff3fa4, 1.2), fx, 4, zF + 0.5);
  }
  b.update = (dt) => {
    for (const tb of tables) tb.rotation.y += dt * 0.35;
  };
  return b;
}
