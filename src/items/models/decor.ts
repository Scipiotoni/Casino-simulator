import * as THREE from 'three';
import { mat, glow, gold, chrome, blackGloss } from '../../render/materials';
import { canvasTexture, coinTexture, makeCanvas, roundRect, seeded } from '../../render/textures';
import { TAU } from '../../core/math';
import { CharacterModel, GOLD_STATUE } from '../../entities/characterModel';
import type { Appearance } from '../../entities/appearance';
import type { ItemModel } from '../types';
import { type BuildOpts, Dyn, add, bake, box, cyl, disposeTree, floorPlane, rbox, shadeHex, sph } from './common';

function hexCss(h: number): string {
  return `#${h.toString(16).padStart(6, '0')}`;
}

function staticModel(root: THREE.Group, dyn: Dyn, height: number, update?: (dt: number, t: number) => void, dispose?: () => void): ItemModel {
  bake(root, dyn);
  return {
    root,
    height,
    update(dt, ctx) {
      update?.(dt, ctx.t);
    },
    event() {},
    dispose() {
      dispose?.();
      disposeTree(root);
    },
  };
}

const LEAF_GREENS = [0x2f8f45, 0x3aa655, 0x26773a, 0x49b865];

export function plantModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const pot = mat(o.color, { rough: 0.35, metal: 0.2 });
  cyl(root, 0.24, 0.17, 0.4, pot, 0, 0.2, 0, 18);
  cyl(root, 0.26, 0.26, 0.05, pot, 0, 0.4, 0, 18);
  cyl(root, 0.22, 0.22, 0.02, mat(0x3a2414, { rough: 1 }), 0, 0.41, 0, 16);
  const rnd = seeded(o.color);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rnd() * 0.3;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(LEAF_GREENS[i % 4], { rough: 0.7 }));
    leaf.scale.set(0.45, 2.4, 0.18);
    const tilt = 0.4 + rnd() * 0.45;
    leaf.position.set(Math.sin(a) * 0.14, 0.64 + rnd() * 0.08, Math.cos(a) * 0.14);
    leaf.rotation.set(tilt, a, 0, 'YXZ');
    root.add(leaf);
  }
  sph(root, 0.14, mat(0x2f8f45, { rough: 0.8 }), 0, 0.52, 0, 10, 8);
  return staticModel(root, dyn, 1.3);
}

export function palmModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const pot = mat(o.color, { rough: 0.35, metal: 0.2 });
  cyl(root, 0.32, 0.24, 0.45, pot, 0, 0.225, 0, 18);
  cyl(root, 0.34, 0.34, 0.05, gold(), 0, 0.45, 0, 18);
  cyl(root, 0.3, 0.3, 0.02, mat(0x3a2414, { rough: 1 }), 0, 0.46, 0, 16);
  const bark = mat(0x8a5a2e, { rough: 0.9 });
  const bark2 = mat(0x6b4422, { rough: 0.9 });
  let x = 0;
  let y = 0.46;
  for (let i = 0; i < 7; i++) {
    const seg = cyl(root, 0.07 - i * 0.004, 0.085 - i * 0.004, 0.3, i % 2 ? bark : bark2, x, y + 0.15, 0, 10);
    seg.rotation.z = -0.06;
    x += 0.018;
    y += 0.28;
  }
  const top = new THREE.Vector3(x, y + 0.05, 0);
  const frondM = mat(0x2f9a4a, { rough: 0.7, side: THREE.DoubleSide });
  const frondM2 = mat(0x3fb35a, { rough: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const frond = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.95, 1, 4), i % 2 ? frondM : frondM2);
    // Bend the leaf downward along its length
    const pos = leaf.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const py = pos.getY(k) + 0.475;
      pos.setZ(k, -py * py * 0.35);
      pos.setX(k, pos.getX(k) * (1 - py * 0.6));
    }
    leaf.geometry.computeVertexNormals();
    leaf.position.y = 0.475;
    frond.add(leaf);
    frond.position.copy(top);
    frond.rotation.set(-1.0, a, 0, 'YXZ');
    root.add(frond);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    sph(root, 0.055, mat(0x5a3a1a, { rough: 0.8 }), top.x + Math.sin(a) * 0.08, top.y - 0.08, Math.cos(a) * 0.08, 8, 6);
  }
  return staticModel(root, dyn, 2.8);
}

export function ropeModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const g = gold();
  const posts: THREE.Vector3[] = [];
  for (const x of [-0.4, 0.4]) {
    cyl(root, 0.12, 0.14, 0.04, g, x, 0.02, 0, 16);
    cyl(root, 0.03, 0.035, 0.85, g, x, 0.45, 0, 10);
    sph(root, 0.05, g, x, 0.9, 0, 10, 8);
    posts.push(new THREE.Vector3(x, 0.8, 0));
  }
  const mid = posts[0].clone().lerp(posts[1], 0.5);
  mid.y -= 0.2;
  const curve = new THREE.QuadraticBezierCurve3(posts[0], mid, posts[1]);
  add(root, new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.035, 8), mat(o.color, { rough: 0.6 })));
  return staticModel(root, dyn, 1.1);
}

export function binModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const m = mat(o.color, { rough: 0.3, metal: 0.6 });
  cyl(root, 0.2, 0.17, 0.62, m, 0, 0.31, 0, 18);
  cyl(root, 0.215, 0.215, 0.05, blackGloss(), 0, 0.62, 0, 18);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, TAU, 0, Math.PI / 2), m);
  add(root, dome, 0, 0.64, 0);
  box(root, 0.16, 0.06, 0.04, mat(0x0b0714), 0, 0.72, 0.16).rotation.x = -0.6;
  cyl(root, 0.205, 0.205, 0.06, glow(0x3ddc84, 0.8), 0, 0.2, 0, 18);
  return staticModel(root, dyn, 1.0);
}

const rugCache = new Map<number, THREE.CanvasTexture>();
function rugTexture(color: number): THREE.CanvasTexture {
  const c = rugCache.get(color);
  if (c) return c;
  const { canvas, ctx } = makeCanvas(256, 384);
  const base = hexCss(color);
  const dark = hexCss(shadeHex(color, 0.55));
  const light = hexCss(shadeHex(color, 1.5) | 0x101010);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = base;
  ctx.fillRect(18, 18, 220, 348);
  ctx.strokeStyle = '#e8b23a';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 232, 360);
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, 200, 328);
  ctx.save();
  ctx.translate(128, 192);
  for (let r = 0; r < 3; r++) {
    ctx.fillStyle = r % 2 ? light : '#e8b23a';
    ctx.beginPath();
    const s = 90 - r * 26;
    ctx.moveTo(0, -s * 1.3);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s * 1.3);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, TAU);
  ctx.fill();
  ctx.restore();
  for (const [x, y] of [[44, 44], [212, 44], [44, 340], [212, 340]]) {
    ctx.fillStyle = '#e8b23a';
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, TAU);
    ctx.fill();
  }
  const t = canvasTexture(canvas);
  rugCache.set(color, t);
  return t;
}

export function rugModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const m = mat(0xffffff, { map: rugTexture(o.color), rough: 1 });
  rbox(root, 1.9, 0.025, 2.9, 0.012, mat(shadeHex(o.color, 0.5), { rough: 1 }), 0, 0.0125, 0);
  floorPlane(root, 1.88, 2.88, m, 0, 0.027, 0);
  const fringe = mat(0xf4e6c8, { rough: 1 });
  for (const z of [-1.47, 1.47]) box(root, 1.84, 0.012, 0.06, fringe, 0, 0.008, z);
  const model = staticModel(root, dyn, 0.2);
  root.traverse((c) => ((c as THREE.Mesh).castShadow = false));
  return model;
}

export function lampModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const g = gold();
  cyl(root, 0.18, 0.22, 0.06, g, 0, 0.03, 0, 18);
  cyl(root, 0.025, 0.03, 1.45, g, 0, 0.75, 0, 8);
  sph(root, 0.05, g, 0, 0.9, 0, 10, 8);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.32, 20, 1, true), mat(o.color, { emissive: o.color, emissiveIntensity: 1.3, side: THREE.DoubleSide, rough: 0.8 }));
  add(root, shade, 0, 1.55, 0);
  sph(root, 0.08, glow(0xfff4d6, 3), 0, 1.47, 0, 10, 8);
  const pool = floorPlane(root, 1.6, 1.6, new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.02, 0);
  pool.renderOrder = 3;
  dyn.keep(pool);
  return staticModel(root, dyn, 2.0);
}

function heartShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -r);
  s.bezierCurveTo(r * 1.25, -r * 0.15, r * 0.8, r * 0.95, 0, r * 0.4);
  s.bezierCurveTo(-r * 0.8, r * 0.95, -r * 1.25, -r * 0.15, 0, -r);
  return s;
}
function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return s;
}
function diamondShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, r);
  s.lineTo(r * 0.75, 0);
  s.lineTo(0, -r);
  s.lineTo(-r * 0.75, 0);
  s.closePath();
  return s;
}
function spadeShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, r);
  s.bezierCurveTo(r * 0.2, r * 0.6, r * 1.1, r * 0.2, r * 0.7, -r * 0.35);
  s.bezierCurveTo(r * 0.45, -r * 0.65, r * 0.1, -r * 0.45, r * 0.05, -r * 0.3);
  s.lineTo(r * 0.25, -r);
  s.lineTo(-r * 0.25, -r);
  s.lineTo(-r * 0.05, -r * 0.3);
  s.bezierCurveTo(-r * 0.1, -r * 0.45, -r * 0.45, -r * 0.65, -r * 0.7, -r * 0.35);
  s.bezierCurveTo(-r * 1.1, r * 0.2, -r * 0.2, r * 0.6, 0, r);
  return s;
}

export function neonModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  cyl(root, 0.26, 0.3, 0.08, blackGloss(), 0, 0.04, 0, 18);
  cyl(root, 0.03, 0.03, 1.2, chrome(), 0, 0.64, 0, 8);
  const shapes = [heartShape, starShape, diamondShape, spadeShape];
  const pick = Math.abs(Math.floor(o.color / 7)) % shapes.length;
  const shape = shapes[pick](0.36);
  const neonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: o.color, emissiveIntensity: 2.6, roughness: 0.4 });
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  geo.center();
  const sign = new THREE.Mesh(geo, neonMat);
  sign.position.set(0, 1.55, 0);
  sign.rotation.x = -0.25;
  root.add(sign);
  dyn.keep(sign);
  const backing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }), mat(0x0b0714, { rough: 0.5 }));
  backing.geometry.center();
  backing.scale.setScalar(1.18);
  backing.position.set(0, 1.55, -0.05);
  backing.rotation.x = -0.25;
  root.add(backing);
  bake(root, dyn);
  let flick = 0;
  return {
    root,
    height: 2.1,
    update(dt, ctx) {
      flick -= dt;
      if (flick < -3 && Math.random() < 0.01) flick = 0.25;
      neonMat.emissiveIntensity = flick > 0 && Math.floor(ctx.t * 30) % 2 === 0 ? 0.4 : 2.6;
      sign.rotation.y = Math.sin(ctx.t * 0.8) * 0.25;
    },
    event() {},
    dispose() {
      disposeTree(root);
      neonMat.dispose();
    },
  };
}

const diceTexCache = new Map<number, THREE.MeshStandardMaterial[]>();
function diceMats(color: number): THREE.MeshStandardMaterial[] {
  const c = diceTexCache.get(color);
  if (c) return c;
  const light = ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255) > 500;
  const pipCol = light ? '#16121c' : '#ffffff';
  const values = [3, 4, 1, 6, 2, 5];
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
    6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
  };
  const mats = values.map((v) => {
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = hexCss(color);
    roundRect(ctx, 0, 0, 128, 128, 18);
    ctx.fill();
    ctx.fillStyle = pipCol;
    for (const [x, y] of pips[v]) {
      ctx.beginPath();
      ctx.arc(x * 128, y * 128, 11, 0, TAU);
      ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.2, metalness: 0.05 });
  });
  diceTexCache.set(color, mats);
  return mats;
}

export function diceModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const mats = diceMats(o.color);
  const big = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), mats);
  big.position.set(-0.05, 0.28, 0.02);
  big.rotation.y = 0.4;
  const small = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mats);
  small.position.set(0.06, 0.78, -0.02);
  small.rotation.set(0.35, 0.9, 0.5);
  root.add(big, small);
  dyn.keep(big);
  dyn.keep(small);
  bake(root, dyn);
  big.castShadow = true;
  small.castShadow = true;
  return {
    root,
    height: 1.3,
    update(dt, ctx) {
      small.rotation.y = 0.9 + Math.sin(ctx.t * 0.6) * 0.15;
    },
    event() {},
    dispose() {
      disposeTree(root);
    },
  };
}

export function pillarModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const m = mat(o.color, { rough: 0.3, metal: o.color === 0xf2b632 ? 0.8 : 0.1, flat: true });
  box(root, 0.82, 0.22, 0.82, m, 0, 0.11, 0);
  box(root, 0.7, 0.1, 0.7, m, 0, 0.27, 0);
  cyl(root, 0.26, 0.29, 2.1, m, 0, 1.37, 0, 12);
  box(root, 0.7, 0.1, 0.7, m, 0, 2.47, 0);
  box(root, 0.82, 0.14, 0.82, m, 0, 2.59, 0);
  cyl(root, 0.3, 0.3, 0.04, glow(0xffd24a, 1.6), 0, 2.36, 0, 16);
  cyl(root, 0.3, 0.3, 0.04, glow(0xffd24a, 1.6), 0, 0.38, 0, 16);
  return staticModel(root, dyn, 2.9);
}

export function fountainModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const stone = mat(o.color, { rough: 0.35, metal: 0.1 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.1, 10, 40), stone);
  ring.rotation.x = Math.PI / 2;
  add(root, ring, 0, 0.38, 0);
  cyl(root, 0.94, 0.96, 0.36, stone, 0, 0.18, 0, 40);
  const water = mat(0x2a8fd8, { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.85, emissive: 0x0a3a6a, emissiveIntensity: 0.6 });
  cyl(root, 0.86, 0.86, 0.02, water, 0, 0.37, 0, 40);
  // Coins on the bottom
  const coinM = gold();
  const rnd = seeded(5);
  for (let i = 0; i < 10; i++) {
    const a = rnd() * TAU;
    const r = 0.25 + rnd() * 0.5;
    cyl(root, 0.035, 0.035, 0.008, coinM, Math.cos(a) * r, 0.385, Math.sin(a) * r, 10);
  }
  cyl(root, 0.12, 0.16, 0.8, stone, 0, 0.75, 0, 16);
  cyl(root, 0.42, 0.2, 0.12, stone, 0, 1.16, 0, 24);
  cyl(root, 0.38, 0.38, 0.02, water, 0, 1.225, 0, 24);
  cyl(root, 0.06, 0.08, 0.35, stone, 0, 1.4, 0, 12);
  sph(root, 0.1, coinM, 0, 1.62, 0, 12, 10);
  // Water jets: droplets on parabolic arcs
  const dropGeo = new THREE.SphereGeometry(0.03, 6, 5);
  const dropMat = mat(0xbfe9ff, { rough: 0.05, emissive: 0x4ab0ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 });
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, 48);
  root.add(drops);
  dyn.keep(drops);
  const ripples: THREE.Mesh[] = [];
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.4, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const rp = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 24), rippleMat.clone());
    rp.rotation.x = -Math.PI / 2;
    rp.position.y = 0.385;
    root.add(rp);
    dyn.keep(rp);
    ripples.push(rp);
  }
  bake(root, dyn);
  const m4 = new THREE.Matrix4();
  return {
    root,
    height: 2.0,
    update(dt, ctx) {
      for (let i = 0; i < 48; i++) {
        const lane = i % 12;
        const a = (lane / 12) * TAU;
        const u = (ctx.t * 0.7 + Math.floor(i / 12) * 0.25) % 1;
        const r = 0.08 + u * 0.62;
        const y = 1.62 + u * 0.45 - u * u * 1.7;
        m4.makeTranslation(Math.cos(a) * r, Math.max(0.38, y), Math.sin(a) * r);
        drops.setMatrixAt(i, m4);
      }
      drops.instanceMatrix.needsUpdate = true;
      ripples.forEach((rp, i) => {
        const u = (ctx.t * 0.5 + i / 3) % 1;
        rp.scale.setScalar(1 + u * 5);
        (rp.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - u);
      });
      void dt;
    },
    event() {},
    dispose() {
      disposeTree(root);
      dropGeo.dispose();
      dropMat.dispose();
      ripples.forEach((r) => (r.material as THREE.Material).dispose());
    },
  };
}

export function aquariumModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const frame = mat(o.color, { rough: 0.3, metal: 0.4 });
  rbox(root, 1.92, 0.62, 0.84, 0.04, frame, 0, 0.31, 0);
  // Open rim so the fish are visible from the top-down camera.
  for (const z of [-0.41, 0.41]) box(root, 1.94, 0.05, 0.04, frame, 0, 1.5, z);
  for (const x of [-0.95, 0.95]) box(root, 0.04, 0.05, 0.86, frame, x, 1.5, 0);
  for (const x of [-0.95, 0.95]) for (const z of [-0.41, 0.41]) box(root, 0.04, 0.88, 0.04, frame, x, 1.06, z);
  const water = mat(0x1f8fd6, { transparent: true, opacity: 0.32, rough: 0.05, depthWrite: false, emissive: 0x0a4a7a, emissiveIntensity: 0.6 });
  box(root, 1.86, 0.8, 0.78, water, 0, 1.03, 0);
  const surface = floorPlane(root, 1.86, 0.78, mat(0x7fd8ff, { transparent: true, opacity: 0.35, rough: 0.02, emissive: 0x1a6aa0, emissiveIntensity: 0.5, depthWrite: false }), 0, 1.43, 0);
  surface.renderOrder = 2;
  box(root, 1.86, 0.08, 0.78, mat(0xe8d5a0, { rough: 1 }), 0, 0.66, 0);
  const rnd = seeded(8);
  for (let i = 0; i < 7; i++) {
    const weed = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3 + rnd() * 0.3, 6), mat(0x2f9a4a, { rough: 0.8 }));
    weed.position.set(-0.8 + rnd() * 1.6, 0.82, -0.3 + rnd() * 0.6);
    root.add(weed);
  }
  for (let i = 0; i < 4; i++) sph(root, 0.06 + rnd() * 0.05, mat(0x8a8f99, { rough: 0.9, flat: true }), -0.7 + rnd() * 1.4, 0.72, -0.25 + rnd() * 0.5, 7, 5);
  // Fish
  const fishCols = [0xff8a1f, 0xffd23f, 0x2fe6ff, 0xff4fa3, 0x9b59ff, 0x3ddc84];
  const fish: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Group();
    const m = mat(fishCols[i], { rough: 0.4, emissive: fishCols[i], emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), m);
    body.scale.set(1.6, 1, 0.6);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 4), m);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -0.09;
    f.add(body, tail);
    root.add(f);
    dyn.keep(f);
    fish.push(f);
  }
  // Glass panes
  const glass = mat(0xd8f4ff, { transparent: true, opacity: 0.12, rough: 0.02, depthWrite: false });
  box(root, 1.9, 0.86, 0.01, glass, 0, 1.05, 0.41);
  box(root, 1.9, 0.86, 0.01, glass, 0, 1.05, -0.41);
  const bubbleGeo = new THREE.SphereGeometry(0.015, 6, 4);
  const bubbles = new THREE.InstancedMesh(bubbleGeo, mat(0xffffff, { transparent: true, opacity: 0.6 }), 14);
  root.add(bubbles);
  dyn.keep(bubbles);
  bake(root, dyn);
  const m4 = new THREE.Matrix4();
  return {
    root,
    height: 1.8,
    update(dt, ctx) {
      fish.forEach((f, i) => {
        const sp = 0.35 + i * 0.07;
        const a = ctx.t * sp + i * 1.3;
        const x = Math.sin(a) * 0.72;
        const z = Math.cos(a * 1.7 + i) * 0.22;
        const y = 0.95 + Math.sin(a * 0.8 + i) * 0.18;
        const dx = Math.cos(a) * sp;
        f.position.set(x, y, z);
        f.rotation.y = dx > 0 ? 0 : Math.PI;
        f.rotation.z = Math.sin(ctx.t * 8 + i) * 0.08;
      });
      for (let i = 0; i < 14; i++) {
        const u = (ctx.t * 0.35 + i / 14) % 1;
        m4.makeTranslation(-0.6 + (i % 3) * 0.02 + Math.sin(u * 20 + i) * 0.02, 0.72 + u * 0.72, 0.1 - (i % 2) * 0.2);
        bubbles.setMatrixAt(i, m4);
      }
      bubbles.instanceMatrix.needsUpdate = true;
      void dt;
    },
    event() {},
    dispose() {
      disposeTree(root);
      bubbleGeo.dispose();
    },
  };
}

export function statueModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const marble = mat(o.color, { rough: 0.3, metal: 0.1 });
  box(root, 0.8, 0.12, 0.8, marble, 0, 0.06, 0);
  box(root, 0.66, 0.7, 0.66, marble, 0, 0.47, 0);
  box(root, 0.8, 0.1, 0.8, marble, 0, 0.87, 0);
  box(root, 0.68, 0.04, 0.02, gold(), 0, 0.6, 0.335);
  bake(root, dyn);
  const look = o.statueLook as Appearance | undefined;
  let figure: CharacterModel | null = null;
  if (look) {
    figure = new CharacterModel({ ...look }, { override: GOLD_STATUE, castShadow: true });
    figure.setPose('point');
    for (let i = 0; i < 30; i++) figure.update(1 / 30);
    figure.root.position.set(0, 0.92, 0);
    figure.root.scale.setScalar(1.3);
    root.add(figure.root);
  }
  return {
    root,
    height: 2.8,
    update() {},
    event() {},
    dispose() {
      figure?.dispose();
      disposeTree(root);
    },
  };
}

export function moneyTreeModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const pot = mat(o.color, { rough: 0.25, metal: o.color === 0xf2b632 ? 0.85 : 0.1 });
  cyl(root, 0.3, 0.22, 0.45, pot, 0, 0.225, 0, 18);
  cyl(root, 0.32, 0.32, 0.05, gold(), 0, 0.45, 0, 18);
  const bark = mat(0x6b4422, { rough: 0.9 });
  cyl(root, 0.06, 0.09, 1.0, bark, 0, 0.95, 0, 10);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const b = cyl(root, 0.025, 0.04, 0.5, bark, Math.cos(a) * 0.15, 1.35, Math.sin(a) * 0.15, 6);
    b.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
  }
  const canopy = new THREE.Group();
  canopy.position.y = 1.6;
  const { canvas, ctx } = makeCanvas(64, 32);
  ctx.fillStyle = '#6fbf6a';
  ctx.fillRect(0, 0, 64, 32);
  ctx.strokeStyle = '#2d6b30';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 58, 26);
  ctx.fillStyle = '#2d6b30';
  ctx.font = '400 20px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 32, 17);
  const billMat = mat(0xffffff, { map: canvasTexture(canvas), rough: 0.8, side: THREE.DoubleSide });
  const billGeo = new THREE.PlaneGeometry(0.2, 0.1);
  const bills = new THREE.InstancedMesh(billGeo, billMat, 70);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rnd = seeded(12);
  for (let i = 0; i < 70; i++) {
    const u = rnd();
    const v = rnd();
    const th = u * TAU;
    const ph = Math.acos(2 * v - 1) * 0.8;
    const r = 0.45 + rnd() * 0.12;
    const p = new THREE.Vector3(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r * 0.7, Math.sin(ph) * Math.sin(th) * r);
    q.setFromEuler(new THREE.Euler(rnd() * TAU, rnd() * TAU, rnd() * TAU));
    m4.compose(p, q, new THREE.Vector3(1, 1, 1));
    bills.setMatrixAt(i, m4);
  }
  canopy.add(bills);
  const coinM = mat(0xffffff, { map: coinTexture(), metal: 0.7, rough: 0.3, emissive: 0x6b4a00, emissiveIntensity: 0.4 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 14), coinM);
    const a = (i / 9) * TAU;
    c.position.set(Math.cos(a) * 0.5, -0.15 + (i % 3) * 0.2, Math.sin(a) * 0.5);
    c.rotation.x = Math.PI / 2;
    canopy.add(c);
  }
  root.add(canopy);
  dyn.keep(canopy);
  bake(root, dyn);
  return {
    root,
    height: 2.4,
    update(dt, ctx) {
      canopy.rotation.y += dt * 0.25;
      canopy.position.y = 1.6 + Math.sin(ctx.t * 1.2) * 0.03;
    },
    event() {},
    dispose() {
      disposeTree(root);
      billGeo.dispose();
    },
  };
}

export function giantDiamondModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  cyl(root, 0.85, 0.95, 0.3, blackGloss(), 0, 0.15, 0, 32);
  cyl(root, 0.87, 0.87, 0.05, gold(), 0, 0.31, 0, 32);
  cyl(root, 0.6, 0.6, 0.06, glow(o.color, 1.1), 0, 0.34, 0, 32);
  const pts = [
    new THREE.Vector2(0.001, -0.75),
    new THREE.Vector2(0.72, 0.05),
    new THREE.Vector2(0.72, 0.12),
    new THREE.Vector2(0.45, 0.42),
    new THREE.Vector2(0.001, 0.42),
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  const gem = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: o.color, metalness: 0.4, roughness: 0.08, emissive: o.color, emissiveIntensity: 0.22, flatShading: true,
  }));
  const holder = new THREE.Group();
  holder.position.y = 1.55;
  holder.add(gem);
  root.add(holder);
  dyn.keep(holder);
  const sparkGeo = new THREE.OctahedronGeometry(0.04, 0);
  const sparks = new THREE.InstancedMesh(sparkGeo, glow(0xffffff, 3), 16);
  root.add(sparks);
  dyn.keep(sparks);
  bake(root, dyn);
  const m4 = new THREE.Matrix4();
  return {
    root,
    height: 2.7,
    update(dt, ctx) {
      holder.rotation.y += dt * 0.6;
      holder.position.y = 1.55 + Math.sin(ctx.t * 1.3) * 0.08;
      for (let i = 0; i < 16; i++) {
        const a = ctx.t * 0.8 + (i / 16) * TAU;
        const r = 1.0 + Math.sin(ctx.t * 2 + i) * 0.1;
        const s = Math.max(0.01, Math.sin(ctx.t * 3 + i * 1.7));
        m4.makeScale(s, s, s);
        m4.setPosition(Math.cos(a) * r, 1.4 + Math.sin(a * 2 + i) * 0.5, Math.sin(a) * r);
        sparks.setMatrixAt(i, m4);
      }
      sparks.instanceMatrix.needsUpdate = true;
    },
    event() {},
    dispose() {
      disposeTree(root);
      sparkGeo.dispose();
      (gem.material as THREE.Material).dispose();
    },
  };
}
