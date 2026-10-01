import * as THREE from 'three';
import { mat, glow, gold, chrome, blackGloss } from '../../render/materials';
import type { ItemModel } from '../types';
import { type BuildOpts, Dyn, bake, box, cyl, disposeTree, rbox, shadeHex, sph } from './common';
import { ROOM_FLOORS, ROOM_WALLS, defaultSetup, sanitizeSetup } from '../../hotel/rooms';

const WALL_H = 1.25;
const WALL_T = 0.1;

interface Layout {
  w: number;
  d: number;
  bedX: number;
  tv: [number, number];
  desk: [number, number];
  minibar: [number, number];
  plant: [number, number];
  sofa: [number, number];
  chandelier: [number, number];
  jacuzzi: [number, number];
  piano: [number, number];
  aquarium: [number, number];
  bar: [number, number];
  cinema: [number, number];
  statue: [number, number];
}

const STANDARD: Layout = {
  w: 4, d: 4, bedX: -0.6, tv: [1.92, -0.9], desk: [1.45, 0.35], minibar: [1.55, -1.6], plant: [1.65, 1.65], sofa: [-1.62, 1.2],
  chandelier: [0.2, -0.3], jacuzzi: [0, 0], piano: [0, 0], aquarium: [0, 0], bar: [0, 0], cinema: [0, 0], statue: [0, 0],
};
const SUITE: Layout = {
  w: 6, d: 5, bedX: -1.5, tv: [2.92, -1.4], desk: [2.4, 0.6], minibar: [2.5, -2.1], plant: [2.6, 2.1], sofa: [-2.62, 1.4],
  chandelier: [0.3, -0.4], jacuzzi: [1.1, -1.3], piano: [-1.0, 1.35], aquarium: [-2.92, -0.6], bar: [0, 0], cinema: [0, 0], statue: [0, 0],
};
const PENTHOUSE: Layout = {
  w: 8, d: 6, bedX: -2.2, tv: [3.92, -1.9], desk: [3.4, 0.9], minibar: [3.5, -2.6], plant: [3.6, 2.6], sofa: [-3.62, 1.8],
  chandelier: [-0.2, -0.6], jacuzzi: [1.6, -1.6], piano: [-1.6, 1.75], aquarium: [-3.92, -0.4], bar: [2.4, 1.6], cinema: [0.6, 1.2], statue: [-0.2, 0.4],
};
const LAYOUTS = [STANDARD, SUITE, PENTHOUSE];

/** Bed: frame, mattress, pillows, blanket; bigger and grander with each tier. */
function bed(root: THREE.Object3D, tier: number, x: number, headZ: number): void {
  if (tier === 4) {
    // A round velvet bed on a gold plinth, with a ring of soft lights.
    const cz = headZ + 1.25;
    cyl(root, 1.2, 1.25, 0.22, gold(), x, 0.11, cz, 36);
    cyl(root, 1.1, 1.1, 0.26, mat(0x5a1446, { rough: 0.9 }), x, 0.35, cz, 36);
    cyl(root, 1.05, 1.05, 0.06, mat(0xf6f3ee, { rough: 0.9 }), x, 0.5, cz, 36);
    for (const px of [-0.35, 0, 0.35]) rbox(root, 0.32, 0.14, 0.26, 0.07, mat(0xe8a8b8, { rough: 0.9 }), x + px, 0.6, headZ + 0.45);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      sph(root, 0.035, glow(0xff9fcf, 1.8), x + Math.sin(a) * 1.22, 0.08, cz + Math.cos(a) * 1.22, 8, 6);
    }
    return;
  }
  const width = [1.0, 1.4, 1.7, 1.9][tier];
  const len = 2.1;
  const cz = headZ + len / 2;
  const wood = mat(tier >= 2 ? 0x2a1a12 : 0x6b4a2a, { rough: 0.5 });
  const sheet = mat(0xf6f3ee, { rough: 0.9 });
  const blanket = mat([0x5a7ea8, 0x8a1030, 0x1d3f8a, 0xc89b3c][tier], { rough: 0.8, metal: tier === 3 ? 0.4 : 0 });
  rbox(root, width + 0.1, 0.28, len, 0.04, wood, x, 0.14, cz);
  rbox(root, width, 0.2, len - 0.08, 0.07, sheet, x, 0.38, cz);
  rbox(root, width + 0.02, 0.07, len * 0.55, 0.03, blanket, x, 0.5, cz + len * 0.2);
  const pillows = tier === 0 ? [0] : [-width / 4, width / 4];
  for (const px of pillows) rbox(root, tier === 0 ? 0.6 : width / 2 - 0.08, 0.14, 0.32, 0.07, sheet, x + px, 0.53, headZ + 0.3);
  const hb = tier >= 2 ? mat(tier === 3 ? 0x5a1426 : 0x3a2a44, { rough: 0.85 }) : wood;
  rbox(root, width + 0.16, tier >= 2 ? 1.05 : 0.8, 0.1, 0.04, hb, x, tier >= 2 ? 0.52 : 0.4, headZ + 0.05);
  if (tier >= 2) {
    // Tufted headboard buttons
    for (let i = 0; i < 5; i++) sph(root, 0.02, gold(), x - width / 2 + 0.2 + (i * (width - 0.4)) / 4, 0.8, headZ + 0.11, 6, 5);
  }
  if (tier === 3) {
    // Canopy: four gold posts, a frame and drapes
    const g = gold();
    for (const [px, pz] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) cyl(root, 0.035, 0.035, 1.9, g, x + (px * (width + 0.1)) / 2, 0.95, headZ + pz * len, 8);
    box(root, width + 0.2, 0.06, len + 0.06, g, x, 1.9, cz);
    const drape = mat(0x8a1030, { rough: 0.95 });
    for (const px of [-1, 1]) box(root, 0.04, 1.3, 0.5, drape, x + (px * (width + 0.14)) / 2, 1.2, headZ + 0.3);
  }
}

/**
 * A hotel room seen from above: low walls (so the camera sees in), a door in the front
 * wall, and whatever the owner paid for. Everything comes from the room's setup.
 */
export function roomModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const cls = Math.max(0, Math.min(2, Number(o.params.cls) || 0));
  const suite = cls >= 1;
  const L = LAYOUTS[cls];
  const s = o.setup ? sanitizeSetup(o.setup, cls) : defaultSetup();
  const has = (id: string) => s.extras.includes(id);
  const W = L.w;
  const D = L.d;
  const wallC = ROOM_WALLS[s.wall].color;
  const fl = ROOM_FLOORS[s.floor];
  const wallMat = mat(wallC, { rough: s.wall === ROOM_WALLS.length - 1 ? 0.3 : 0.85, metal: s.wall === ROOM_WALLS.length - 1 ? 0.6 : 0 });
  const trim = mat(shadeHex(wallC, 0.6), { rough: 0.6 });
  // Floor
  box(root, W - 0.12, 0.03, D - 0.12, mat(fl.color, { rough: 0.9 - fl.sheen * 0.8, metal: fl.sheen * 0.2 }), 0, 0.015, 0);
  // Walls: back, sides, and the front with a doorway at local x 0..1
  box(root, W, WALL_H, WALL_T, wallMat, 0, WALL_H / 2, -D / 2 + WALL_T / 2);
  box(root, WALL_T, WALL_H, D, wallMat, -W / 2 + WALL_T / 2, WALL_H / 2, 0);
  box(root, WALL_T, WALL_H, D, wallMat, W / 2 - WALL_T / 2, WALL_H / 2, 0);
  box(root, W / 2, WALL_H, WALL_T, wallMat, -W / 4, WALL_H / 2, D / 2 - WALL_T / 2);
  box(root, W / 2 - 1, WALL_H, WALL_T, wallMat, (1 + W / 2) / 2, WALL_H / 2, D / 2 - WALL_T / 2);
  // Wall caps and a door frame
  for (const [w, d, x, z] of [
    [W, WALL_T + 0.04, 0, -D / 2 + WALL_T / 2], [WALL_T + 0.04, D, -W / 2 + WALL_T / 2, 0], [WALL_T + 0.04, D, W / 2 - WALL_T / 2, 0],
    [W / 2, WALL_T + 0.04, -W / 4, D / 2 - WALL_T / 2], [W / 2 - 1, WALL_T + 0.04, (1 + W / 2) / 2, D / 2 - WALL_T / 2],
  ] as [number, number, number, number][]) box(root, w, 0.05, d, trim, x, WALL_H + 0.025, z);
  for (const px of [0, 1]) box(root, 0.08, WALL_H + 0.1, 0.16, gold(), px, (WALL_H + 0.1) / 2, D / 2 - WALL_T / 2);
  // Room number plate
  box(root, 0.28, 0.16, 0.02, gold(), -0.3, 1.0, D / 2 + 0.01);

  const headZ = -D / 2 + WALL_T + 0.02;
  bed(root, s.bed, L.bedX, headZ);
  const wood = mat(0x2a1a12, { rough: 0.5 });
  const bw = [1.0, 1.4, 1.7, 1.9, 2.3][s.bed];
  if (has('lamps')) {
    for (const side of [-1, 1]) {
      const nx = L.bedX + side * (bw / 2 + 0.3);
      rbox(root, 0.36, 0.45, 0.34, 0.03, wood, nx, 0.23, headZ + 0.25);
      cyl(root, 0.03, 0.05, 0.22, gold(), nx, 0.56, headZ + 0.25, 8);
      cyl(root, 0.12, 0.08, 0.14, glow(0xffe0a0, 1.2), nx, 0.72, headZ + 0.25, 12);
    }
  }
  if (has('rug')) box(root, bw + 0.6, 0.02, 1.0, mat(0xe9e1d3, { rough: 1 }), L.bedX, 0.04, headZ + 2.6);
  if (has('art')) {
    box(root, 1.0, 0.6, 0.04, gold(), L.bedX, 1.02, headZ - 0.02);
    box(root, 0.88, 0.48, 0.02, mat(0x2fb8c9, { rough: 0.5, emissive: 0x0a3040, emissiveIntensity: 0.3 }), L.bedX, 1.02, headZ + 0.01);
    sph(root, 0.1, mat(0xffc53d, { emissive: 0x442200 }), L.bedX + 0.2, 1.1, headZ + 0.02, 10, 8);
  }
  if (has('tv')) {
    const [x, z] = L.tv;
    box(root, 0.06, 0.6, 1.0, blackGloss(), x - 0.03, 0.95, z);
    box(root, 0.02, 0.52, 0.92, glow(0x3a6ee0, 0.9), x - 0.07, 0.95, z);
    rbox(root, 0.4, 0.45, 1.2, 0.03, wood, x - 0.25, 0.22, z);
  }
  if (has('desk')) {
    const [x, z] = L.desk;
    box(root, 0.5, 0.05, 1.0, wood, x, 0.72, z);
    for (const dz of [-0.45, 0.45]) box(root, 0.46, 0.7, 0.05, wood, x, 0.36, z + dz);
    rbox(root, 0.4, 0.08, 0.4, 0.04, mat(0x8a1030, { rough: 0.8 }), x - 0.5, 0.45, z);
    box(root, 0.06, 0.45, 0.4, mat(0x8a1030, { rough: 0.8 }), x - 0.72, 0.68, z);
    cyl(root, 0.03, 0.05, 0.2, gold(), x + 0.05, 0.85, z - 0.3, 8);
    sph(root, 0.08, glow(0xffe0a0, 1), x + 0.05, 1.0, z - 0.3, 10, 8);
  }
  if (has('minibar')) {
    const [x, z] = L.minibar;
    rbox(root, 0.5, 0.85, 0.5, 0.04, chrome(), x, 0.43, z);
    box(root, 0.02, 0.6, 0.4, glow(0x9fe8ff, 0.5), x - 0.26, 0.5, z);
    for (let i = 0; i < 3; i++) cyl(root, 0.03, 0.03, 0.2, mat([0x1e7a46, 0x8a1030, 0xf2b632][i], { rough: 0.2 }), x - 0.1 + i * 0.1, 0.95, z, 8);
  }
  if (has('plant')) {
    const [x, z] = L.plant;
    cyl(root, 0.18, 0.13, 0.32, mat(0xe9e1d3, { rough: 0.4 }), x, 0.16, z, 14);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0x2f8f45, { rough: 0.7 }));
      leaf.scale.set(0.5, 2.3, 0.2);
      leaf.position.set(x + Math.sin(a) * 0.1, 0.5, z + Math.cos(a) * 0.1);
      leaf.rotation.set(0.5, a, 0, 'YXZ');
      root.add(leaf);
    }
  }
  if (has('sofa')) {
    const [x, z] = L.sofa;
    const velvet = mat(0x5a1426, { rough: 0.85 });
    rbox(root, 0.7, 0.35, 1.5, 0.08, velvet, x, 0.25, z);
    rbox(root, 0.18, 0.5, 1.5, 0.06, velvet, x - 0.28, 0.55, z);
    for (const dz of [-0.72, 0.72]) rbox(root, 0.7, 0.45, 0.14, 0.05, velvet, x, 0.35, z + dz);
    for (const dz of [-0.6, 0.6]) cyl(root, 0.03, 0.02, 0.1, gold(), x + 0.28, 0.05, z + dz, 6);
  }
  if (has('jacuzzi') && suite) {
    const [x, z] = L.jacuzzi;
    cyl(root, 0.78, 0.8, 0.5, mat(0xf4f1ea, { rough: 0.2 }), x, 0.25, z, 28);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.66, 28), new THREE.MeshStandardMaterial({ color: 0x2fb8e0, emissive: 0x0a5a80, emissiveIntensity: 0.6, roughness: 0.05, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 0.46, z);
    root.add(water);
    dyn.keep(water);
    water.name = 'jacuzzi';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      sph(root, 0.04, glow(0x9fe8ff, 1.6), x + Math.sin(a) * 0.72, 0.5, z + Math.cos(a) * 0.72, 8, 6);
    }
  }
  if (has('piano') && suite) {
    const [x, z] = L.piano;
    const gloss = blackGloss();
    const body = new THREE.Shape();
    body.moveTo(-0.7, -0.4);
    body.lineTo(0.7, -0.4);
    body.quadraticCurveTo(0.8, 0.5, 0.1, 0.55);
    body.quadraticCurveTo(-0.5, 0.6, -0.7, 0.2);
    body.lineTo(-0.7, -0.4);
    const geo = new THREE.ExtrudeGeometry(body, { depth: 0.3, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const top = new THREE.Mesh(geo, gloss);
    top.position.set(x, 0.95, z);
    root.add(top);
    for (const [px, pz] of [[-0.6, -0.3], [0.6, -0.3], [0, 0.4]]) cyl(root, 0.04, 0.04, 0.65, gloss, x + px, 0.33, z + pz, 8);
    box(root, 1.3, 0.04, 0.16, mat(0xf6f3ee), x, 0.72, z - 0.45);
    rbox(root, 0.8, 0.08, 0.3, 0.03, gloss, x, 0.48, z - 0.85);
  }
  if (has('aquarium') && suite) {
    const [x, z] = L.aquarium;
    rbox(root, 0.34, 1.0, 1.6, 0.03, blackGloss(), x + 0.07, 0.7, z);
    const glass = mat(0x1a7fb0, { emissive: 0x0a5a8a, emissiveIntensity: 0.9, rough: 0.05 });
    box(root, 0.04, 0.8, 1.45, glass, x + 0.26, 0.72, z);
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow([0xff8a1f, 0xffd24a, 0xff3fa4][i % 3], 1.4));
      f.scale.set(1.6, 0.8, 0.5);
      f.position.set(x + 0.28, 0.45 + (i % 3) * 0.2, z - 0.55 + i * 0.22);
      root.add(f);
    }
  }
  if (has('bar') && cls === 2) {
    const [x, z] = L.bar;
    rbox(root, 1.6, 0.95, 0.5, 0.04, mat(0x2a1a12, { rough: 0.4 }), x, 0.48, z);
    box(root, 1.66, 0.05, 0.56, mat(0xf1ece2, { rough: 0.15 }), x, 0.97, z);
    for (let i = 0; i < 5; i++) cyl(root, 0.035, 0.035, 0.24, mat([0x1e7a46, 0x8a1030, 0xf2b632, 0x2fb8c9, 0xe9e1d3][i], { rough: 0.15 }), x - 0.6 + i * 0.3, 1.12, z - 0.1, 8);
    for (const dx of [-0.5, 0.5]) {
      cyl(root, 0.03, 0.03, 0.6, chrome(), x + dx, 0.3, z + 0.55, 8);
      cyl(root, 0.18, 0.18, 0.06, mat(0x8a1030, { rough: 0.8 }), x + dx, 0.62, z + 0.55, 14);
    }
  }
  if (has('cinema') && cls === 2) {
    const [x, z] = L.cinema;
    box(root, 2.2, 1.0, 0.06, blackGloss(), x, 1.1, z + 1.3);
    box(root, 2.05, 0.88, 0.02, glow(0x6f8cff, 0.9), x, 1.1, z + 1.26);
    const leather = mat(0x17151f, { rough: 0.6 });
    for (const dx of [-0.55, 0.55]) {
      rbox(root, 0.8, 0.4, 0.8, 0.1, leather, x + dx, 0.25, z);
      rbox(root, 0.8, 0.55, 0.18, 0.08, leather, x + dx, 0.55, z - 0.35);
    }
  }
  if (has('statue') && cls === 2) {
    const [x, z] = L.statue;
    cyl(root, 0.32, 0.36, 0.3, mat(0xeeeae2, { rough: 0.2 }), x, 0.15, z, 18);
    cyl(root, 0.12, 0.16, 0.7, gold(), x, 0.65, z, 12);
    sph(root, 0.16, gold(), x, 1.12, z, 14, 10);
    for (const dx of [-0.18, 0.18]) cyl(root, 0.05, 0.05, 0.45, gold(), x + dx, 0.85, z, 8);
  }
  let crystals: THREE.Object3D | null = null;
  if (has('chandelier')) {
    const [x, z] = L.chandelier;
    const g = new THREE.Group();
    g.position.set(x, 1.75, z);
    cyl(g, 0.3, 0.3, 0.04, gold(), 0, 0, 0, 20);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), glow(0xfff4d6, 2.2));
      c.position.set(Math.sin(a) * 0.3, -0.12, Math.cos(a) * 0.3);
      g.add(c);
    }
    sph(g, 0.12, glow(0xffe8b0, 2.4), 0, -0.1, 0, 12, 8);
    root.add(g);
    dyn.keep(g);
    crystals = g;
  }
  bake(root, dyn);
  const water = root.getObjectByName('jacuzzi') as THREE.Mesh | undefined;
  return {
    root,
    height: WALL_H + 0.3,
    update(_dt, ctx) {
      if (crystals) crystals.rotation.y = ctx.t * 0.3;
      if (water) (water.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + Math.sin(ctx.t * 3) * 0.15;
    },
    event() {},
    dispose() {
      if (water) (water.material as THREE.Material).dispose();
      disposeTree(root);
    },
  };
}

/** An outdoor-style pool: tiled rim, shimmering water, a ladder and two sun loungers. */
export function poolModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const W = 5;
  const D = 4;
  const tile = mat(0xf4f1ea, { rough: 0.35 });
  const rimH = 0.32;
  box(root, W, 0.05, D, mat(0x3a6ee0, { rough: 0.3 }), 0, 0.025, 0);
  box(root, W, rimH, 0.22, tile, 0, rimH / 2, -D / 2 + 0.11);
  box(root, W, rimH, 0.22, tile, 0, rimH / 2, D / 2 - 0.11);
  box(root, 0.22, rimH, D, tile, -W / 2 + 0.11, rimH / 2, 0);
  box(root, 0.22, rimH, D, tile, W / 2 - 0.11, rimH / 2, 0);
  // Ladder
  for (const dx of [-0.2, 0.2]) cyl(root, 0.025, 0.025, 0.6, chrome(), 1.6 + dx, 0.45, -D / 2 + 0.2, 8);
  // Lane rope
  for (let i = 0; i < 12; i++) sph(root, 0.045, mat(i % 2 ? 0xffffff : 0xc8102e), -2.1 + i * 0.38, 0.28, 0, 8, 6);
  const waterMat = new THREE.MeshStandardMaterial({ color: o.color, emissive: shadeHex(o.color, 0.35), emissiveIntensity: 0.7, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.44, D - 0.44, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.26;
  root.add(water);
  dyn.keep(water);
  bake(root, dyn);
  return {
    root,
    height: 0.8,
    update(_dt, ctx) {
      waterMat.emissiveIntensity = 0.6 + Math.sin(ctx.t * 2.2) * 0.12;
    },
    event() {},
    dispose() {
      waterMat.dispose();
      disposeTree(root);
    },
  };
}


// ------------------------------------------------------------------ hotel services

function simple(root: THREE.Group, dyn: Dyn, height: number, update?: (dt: number, t: number) => void, extra?: () => void): ItemModel {
  bake(root, dyn);
  return {
    root,
    height,
    update(dt, ctx) {
      update?.(dt, ctx.t);
    },
    event() {},
    dispose() {
      extra?.();
      disposeTree(root);
    },
  };
}

function food(root: THREE.Object3D, x: number, z: number, y: number, i: number): void {
  const colors = [0xf2b632, 0xc8102e, 0x2f8f45, 0xffe08a, 0x8a5a2a, 0xff8a1f];
  cyl(root, 0.2, 0.18, 0.05, chrome(), x, y, z, 14);
  for (let k = 0; k < 4; k++) sph(root, 0.05, mat(colors[(i + k) % colors.length], { rough: 0.6 }), x - 0.08 + (k % 2) * 0.16, y + 0.06, z - 0.06 + Math.floor(k / 2) * 0.12, 8, 6);
}

/** Breakfast buffet: a long counter with chafing dishes, a chef behind it, stools in front. */
export function buffetModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(0x2a1a12, { rough: 0.5 });
  rbox(root, 4.8, 0.95, 0.9, 0.04, mat(o.color, { rough: 0.6 }), 0, 0.48, -0.55);
  box(root, 4.9, 0.05, 1.0, mat(0xf1ece2, { rough: 0.15 }), 0, 0.98, -0.55);
  // Sneeze guard and heat lamps
  box(root, 4.6, 0.04, 0.5, mat(0xbfe9ff, { transparent: true, opacity: 0.25, rough: 0.05 }), 0, 1.5, -0.45);
  for (let i = 0; i < 6; i++) {
    const x = -2 + i * 0.8;
    food(root, x, -0.55, 1.03, i);
    sph(root, 0.06, glow(0xff9a3d, 1.4), x, 1.45, -0.6, 8, 6);
  }
  // Back wall with juice dispensers
  box(root, 4.8, 1.6, 0.12, wood, 0, 0.8, -1.42);
  for (const [x, c] of [[-1.5, 0xff8a1f], [-1.1, 0xc8102e], [1.2, 0x2f8f45]] as [number, number][]) {
    cyl(root, 0.14, 0.14, 0.45, mat(c, { transparent: true, opacity: 0.8, rough: 0.1 }), x, 1.25, -1.25, 14);
  }
  // Dining counter in front
  box(root, 4.8, 0.06, 0.42, wood, 0, 0.78, 0.55);
  for (let i = 0; i < 4; i++) {
    const x = -1.5 + i;
    cyl(root, 0.03, 0.04, 0.6, chrome(), x, 0.31, 0.62, 8);
    cyl(root, 0.19, 0.19, 0.06, mat(0x8a1030, { rough: 0.8 }), x, 0.62, 0.62, 14);
    cyl(root, 0.11, 0.1, 0.02, mat(0xf6f3ee), x, 0.82, 0.48, 12);
  }
  return simple(root, dyn, 1.7);
}

export function vendingModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  rbox(root, 0.9, 1.9, 0.75, 0.04, mat(o.color, { rough: 0.35, metal: 0.2 }), 0, 0.95, -0.55);
  box(root, 0.6, 1.3, 0.02, glow(0xeaf6ff, 0.6), -0.08, 1.15, -0.17);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(root, 0.12, 0.16, 0.04, mat([0xc8102e, 0xf2b632, 0x1f4fbf, 0x2f8f45][(r + c) % 4]), -0.27 + c * 0.19, 0.65 + r * 0.3, -0.15);
  box(root, 0.16, 0.5, 0.03, blackGloss(), 0.33, 1.2, -0.16);
  return simple(root, dyn, 2);
}

export function giftshopModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(0x6b4a2a, { rough: 0.5 });
  rbox(root, 2.9, 0.9, 0.6, 0.04, mat(o.color, { rough: 0.5 }), 0, 0.45, 0.05);
  box(root, 2.95, 0.05, 0.65, mat(0xf1ece2, { rough: 0.2 }), 0, 0.92, 0.05);
  box(root, 2.9, 1.7, 0.3, wood, 0, 0.85, -0.82);
  for (let shelf = 0; shelf < 3; shelf++) {
    box(root, 2.8, 0.04, 0.32, wood, 0, 0.5 + shelf * 0.5, -0.7);
    for (let i = 0; i < 7; i++) {
      const x = -1.2 + i * 0.4;
      const c = [0xff6fb5, 0x2fb8c9, 0xf2b632, 0xc8102e, 0x6a2cc2][(i + shelf) % 5];
      if ((i + shelf) % 3 === 0) sph(root, 0.1, mat(c, { rough: 0.2, transparent: true, opacity: 0.8 }), x, 0.64 + shelf * 0.5, -0.7, 10, 8);
      else rbox(root, 0.18, 0.2, 0.14, 0.03, mat(c, { rough: 0.6 }), x, 0.62 + shelf * 0.5, -0.7);
    }
  }
  // Plush dice on the counter
  for (const [x, c] of [[-0.8, 0xc8102e], [0.9, 0xf4f1ea]] as [number, number][]) rbox(root, 0.22, 0.22, 0.22, 0.06, mat(c, { rough: 0.9 }), x, 1.06, 0.05);
  return simple(root, dyn, 1.8);
}

export function laundryModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  void o;
  const drums: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const x = -1 + i;
    rbox(root, 0.85, 0.95, 0.75, 0.05, mat(0xf4f1ea, { rough: 0.3 }), x, 0.48, -0.5);
    cyl(root, 0.3, 0.3, 0.03, chrome(), x, 0.5, -0.11, 20).rotation.x = Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), mat(0x6fb8e8, { emissive: 0x1a5a8a, emissiveIntensity: 0.5, rough: 0.1 }));
    glass.position.set(x, 0.5, -0.09);
    root.add(glass);
    dyn.keep(glass);
    drums.push(glass);
  }
  // Folded towels on a cart
  rbox(root, 1.2, 0.55, 0.5, 0.04, chrome(), 0.4, 0.3, 0.5);
  for (let i = 0; i < 6; i++) rbox(root, 0.32, 0.08, 0.3, 0.03, mat(0xffffff, { rough: 1 }), 0.05 + (i % 3) * 0.35, 0.62 + Math.floor(i / 3) * 0.09, 0.5);
  return simple(root, dyn, 1.1, (_dt, t) => drums.forEach((d, i) => (d.rotation.z = t * (4 + i))));
}

/** Three treadmills and a rack of dumbbells. */
export function gymModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const frame = mat(0x2b2b35, { metal: 0.5, rough: 0.4 });
  box(root, 4, 0.02, 3, mat(0x2a2a30, { rough: 0.95 }), 0, 0.01, 0);
  for (const x of [-1.2, 0, 1.2]) {
    rbox(root, 0.75, 0.12, 1.5, 0.03, frame, x, 0.08, 0.15);
    box(root, 0.6, 0.02, 1.3, mat(0x111111, { rough: 1 }), x, 0.15, 0.15);
    for (const dx of [-0.3, 0.3]) cyl(root, 0.03, 0.03, 1.1, chrome(), x + dx, 0.6, -0.55, 8);
    rbox(root, 0.7, 0.3, 0.12, 0.03, frame, x, 1.15, -0.6);
    box(root, 0.4, 0.18, 0.02, glow(o.color, 0.9), x, 1.18, -0.53);
  }
  box(root, 3.6, 0.06, 0.3, frame, 0, 0.5, -1.3);
  for (let i = 0; i < 8; i++) {
    const x = -1.6 + i * 0.45;
    for (const dx of [-0.12, 0.12]) cyl(root, 0.07, 0.07, 0.06, mat(0x17151f), x + dx, 0.6, -1.3, 12).rotation.z = Math.PI / 2;
    cyl(root, 0.02, 0.02, 0.28, chrome(), x, 0.6, -1.3, 6).rotation.z = Math.PI / 2;
  }
  return simple(root, dyn, 1.4);
}

/** Two candlelit tables for two, with a little lamp each. */
export function restaurantModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  box(root, 4, 0.02, 4, mat(o.color, { rough: 0.9 }), 0, 0.01, 0);
  const cloth = mat(0xf6f3ee, { rough: 0.9 });
  const wood = mat(0x2a1a12, { rough: 0.5 });
  for (const z of [-0.5, 0.5]) {
    cyl(root, 0.55, 0.55, 0.05, cloth, 0, 0.74, z, 24);
    cyl(root, 0.57, 0.6, 0.3, cloth, 0, 0.6, z, 24);
    cyl(root, 0.05, 0.08, 0.5, wood, 0, 0.25, z, 8);
    for (const x of [-0.25, 0.25]) {
      cyl(root, 0.12, 0.1, 0.02, mat(0xffffff), x, 0.78, z, 14);
      cyl(root, 0.01, 0.01, 0.12, chrome(), x + 0.1, 0.84, z - 0.12, 6);
    }
    cyl(root, 0.03, 0.03, 0.14, mat(0xf4f1ea), 0, 0.85, z, 8);
    sph(root, 0.035, glow(0xffb45a, 2.4), 0, 0.95, z, 8, 6);
  }
  for (const [x, z, f] of [[-1.5, -0.5, 1], [1.5, -0.5, -1], [-1.5, 0.5, 1], [1.5, 0.5, -1]] as [number, number, number][]) {
    rbox(root, 0.45, 0.06, 0.45, 0.03, mat(0x8a1030, { rough: 0.8 }), x, 0.48, z);
    box(root, 0.06, 0.6, 0.45, wood, x - f * 0.22, 0.78, z);
    for (const dz of [-0.18, 0.18]) for (const dx of [-0.18, 0.18]) cyl(root, 0.025, 0.025, 0.46, wood, x + dx, 0.23, z + dz, 6);
  }
  // A potted palm in the corner and a wine rack
  cyl(root, 0.2, 0.15, 0.4, gold(), 1.6, 0.2, -1.6, 12);
  sph(root, 0.35, mat(0x2f8f45, { rough: 0.8 }), 1.6, 0.75, -1.6, 10, 8);
  box(root, 1.2, 1.4, 0.3, wood, -1.2, 0.7, -1.82);
  for (let i = 0; i < 12; i++) cyl(root, 0.045, 0.045, 0.25, mat(0x5a1426, { rough: 0.2 }), -1.6 + (i % 4) * 0.27, 0.3 + Math.floor(i / 4) * 0.4, -1.75, 6).rotation.x = Math.PI / 2;
  return simple(root, dyn, 1.3);
}

/** Two massage tables between bamboo screens, with candles and stones. */
export function spaModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  box(root, 4, 0.02, 3, mat(0xd8cbb4, { rough: 0.6 }), 0, 0.01, 0);
  const towel = mat(0xffffff, { rough: 1 });
  for (const x of [-1, 1]) {
    rbox(root, 0.7, 0.12, 1.9, 0.05, mat(o.color, { rough: 0.6 }), x, 0.55, -0.35);
    rbox(root, 0.72, 0.03, 1.2, 0.02, towel, x, 0.62, -0.1);
    for (const dz of [-1.1, 0.4]) for (const dx of [-0.28, 0.28]) cyl(root, 0.03, 0.03, 0.5, mat(0x9a6a3c), x + dx, 0.25, dz, 6);
  }
  // Bamboo screens
  for (let i = 0; i < 9; i++) cyl(root, 0.04, 0.04, 1.6, mat(0x8fb05a, { rough: 0.6 }), -0.2 + i * 0.05, 0.8, -0.6, 6);
  for (let i = 0; i < 6; i++) {
    cyl(root, 0.05, 0.05, 0.1, mat(0xf4f1ea), -1.8 + (i % 2) * 0.15, 0.05, -1.3 + Math.floor(i / 2) * 0.15, 8);
    sph(root, 0.02, glow(0xffb45a, 2), -1.8 + (i % 2) * 0.15, 0.13, -1.3 + Math.floor(i / 2) * 0.15, 6, 4);
  }
  for (let i = 0; i < 4; i++) sph(root, 0.07, mat(0x2a2a30, { rough: 0.3 }), 1.6 + (i % 2) * 0.12, 0.06, -1.3 + Math.floor(i / 2) * 0.12, 8, 6);
  return simple(root, dyn, 1.6);
}

// ------------------------------------------------------------------ pool garden

export function loungerModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const frame = mat(0xf4f1ea, { rough: 0.4 });
  rbox(root, 0.7, 0.08, 1.4, 0.03, frame, 0, 0.28, 0.25);
  rbox(root, 0.66, 0.06, 1.3, 0.03, mat(o.color, { rough: 0.8 }), 0, 0.34, 0.25);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.6), mat(o.color, { rough: 0.8 }));
  back.position.set(0, 0.5, -0.55);
  back.rotation.x = 0.6;
  root.add(back);
  for (const [x, z] of [[-0.3, -0.35], [0.3, -0.35], [-0.3, 0.85], [0.3, 0.85]] as [number, number][]) cyl(root, 0.02, 0.02, 0.28, frame, x, 0.14, z, 6);
  // Umbrella
  cyl(root, 0.02, 0.02, 1.9, chrome(), 0.45, 0.95, -0.7, 6);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.3, 10, 1, true), mat(o.color === 0xffffff ? 0xff8a1f : 0xffffff, { rough: 0.9, side: THREE.DoubleSide }));
  top.position.set(0.45, 1.9, -0.7);
  root.add(top);
  return simple(root, dyn, 2);
}

export function hottubModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  cyl(root, 1.35, 1.4, 0.45, mat(0x6b4a2a, { rough: 0.6 }), 0, 0.22, 0, 28);
  const waterMat = new THREE.MeshStandardMaterial({ color: o.color, emissive: shadeHex(o.color, 0.4), emissiveIntensity: 0.8, roughness: 0.05, transparent: true, opacity: 0.85 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.2, 28), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.4;
  root.add(water);
  dyn.keep(water);
  const bubbles = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), mat(0xffffff, { transparent: true, opacity: 0.7 }));
    b.position.set(Math.sin(i * 2.3) * 0.8, 0.42, Math.cos(i * 1.7) * 0.8);
    bubbles.add(b);
  }
  root.add(bubbles);
  dyn.keep(bubbles);
  return simple(root, dyn, 0.8, (_dt, t) => {
    waterMat.emissiveIntensity = 0.7 + Math.sin(t * 3) * 0.15;
    bubbles.children.forEach((b, i) => (b.position.y = 0.42 + Math.abs(Math.sin(t * 3 + i)) * 0.06));
  }, () => waterMat.dispose());
}

/** Thatched tiki hut bar with coconuts and torches. */
export function tikibarModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const bamboo = mat(o.color, { rough: 0.7 });
  rbox(root, 3.8, 1.0, 0.7, 0.04, bamboo, 0, 0.5, -0.3);
  box(root, 3.9, 0.06, 0.8, mat(0x6b4a2a, { rough: 0.5 }), 0, 1.03, -0.3);
  for (const [x, z] of [[-1.8, -1.3], [1.8, -1.3], [-1.8, 0.2], [1.8, 0.2]] as [number, number][]) cyl(root, 0.07, 0.07, 2.4, bamboo, x, 1.2, z, 8);
  const thatch = new THREE.Mesh(new THREE.ConeGeometry(2.9, 0.9, 4, 1), mat(0xc8a35a, { rough: 1 }));
  thatch.position.set(0, 2.75, -0.55);
  thatch.rotation.y = Math.PI / 4;
  thatch.scale.set(1, 1, 0.65);
  root.add(thatch);
  for (let i = 0; i < 5; i++) sph(root, 0.09, mat(0x6b4a2a, { rough: 0.9 }), -1.4 + i * 0.7, 1.14, -0.3, 10, 8);
  for (const x of [-2.1, 2.1]) {
    cyl(root, 0.04, 0.04, 1.5, bamboo, x, 0.75, 1.3, 6);
    sph(root, 0.1, glow(0xff8a1f, 2.6), x, 1.6, 1.3, 8, 6);
  }
  for (let i = 0; i < 4; i++) {
    const x = -1.5 + i;
    cyl(root, 0.03, 0.04, 0.72, bamboo, x, 0.36, 0.62, 8);
    cyl(root, 0.2, 0.2, 0.06, mat(0x2f8f45, { rough: 0.9 }), x, 0.74, 0.62, 14);
  }
  return simple(root, dyn, 3.1);
}

/** Canopied daybed for two with curtains and an ice bucket. */
export function cabanaModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const cloth = mat(o.color, { rough: 0.95 });
  box(root, 3, 0.1, 3, mat(0x9a6a3c, { rough: 0.7 }), 0, 0.05, 0);
  for (const x of [-0.6, 0.6]) {
    rbox(root, 0.9, 0.24, 1.8, 0.05, mat(0xf6f3ee, { rough: 0.9 }), x, 0.28, -0.2);
    rbox(root, 0.8, 0.14, 0.3, 0.06, mat(0xc89b3c, { rough: 0.9 }), x, 0.46, -0.95);
  }
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as [number, number][]) cyl(root, 0.05, 0.05, 2.4, gold(), x, 1.2, z, 8);
  box(root, 3, 0.1, 3, cloth, 0, 2.4, 0);
  for (const x of [-1.42, 1.42]) box(root, 0.04, 1.9, 0.8, cloth, x, 1.4, 1.0);
  box(root, 2.9, 1.9, 0.04, cloth, 0, 1.4, -1.42);
  cyl(root, 0.15, 0.12, 0.3, chrome(), 0, 0.25, 1.05, 12);
  cyl(root, 0.035, 0.035, 0.35, mat(0x1e7a46, { rough: 0.2 }), 0, 0.45, 1.05, 8);
  return simple(root, dyn, 2.6);
}

/** A lagoon pool with a tall twisting slide and a splash zone. */
export function waterslideModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const W = 6;
  const tile = mat(0xf4f1ea, { rough: 0.35 });
  box(root, W, 0.05, W, mat(0x3a6ee0, { rough: 0.3 }), 0, 0.025, 0);
  for (const [w, d, x, z] of [[W, 0.25, 0, -W / 2 + 0.12], [W, 0.25, 0, W / 2 - 0.12], [0.25, W, -W / 2 + 0.12, 0], [0.25, W, W / 2 - 0.12, 0]] as [number, number, number, number][]) box(root, w, 0.32, d, tile, x, 0.16, z);
  const waterMat = new THREE.MeshStandardMaterial({ color: o.color, emissive: shadeHex(o.color, 0.35), emissiveIntensity: 0.7, roughness: 0.05, transparent: true, opacity: 0.8 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, W - 0.5), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.26;
  root.add(water);
  dyn.keep(water);
  // Tower and spiral slide
  const red = mat(0xc8102e, { rough: 0.35 });
  const yellow = mat(0xf2b632, { rough: 0.35 });
  for (const [x, z] of [[1.8, -2.6], [2.6, -2.6], [1.8, -1.8], [2.6, -1.8]] as [number, number][]) cyl(root, 0.06, 0.06, 3.6, chrome(), x, 1.8, z, 8);
  box(root, 1.0, 0.1, 1.0, yellow, 2.2, 3.6, -2.2);
  for (let i = 0; i < 28; i++) {
    const a = i * 0.32;
    const r = 1.3;
    const seg = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 10, Math.PI), i % 2 ? red : yellow);
    seg.position.set(2.2 - Math.cos(a) * r + (i / 28) * -2.5, 3.5 - i * 0.12, -2.2 + Math.sin(a) * r * 0.6 + (i / 28) * 1.6);
    seg.rotation.set(Math.PI / 2, 0, a);
    root.add(seg);
  }
  // Palm on an island
  cyl(root, 0.5, 0.6, 0.35, mat(0xd9c38a, { rough: 0.9 }), -1.6, 0.2, -1.6, 14);
  cyl(root, 0.08, 0.12, 1.8, mat(0x8a5a2a), -1.6, 1.2, -1.6, 8);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat(0x2f8f45, { rough: 0.7 }));
    leaf.scale.set(0.5, 0.25, 3.2);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(-1.6 + Math.sin(a) * 0.5, 2.05, -1.6 + Math.cos(a) * 0.5);
    leaf.rotation.y = a;
    root.add(leaf);
  }
  return simple(root, dyn, 3.8, (_dt, t) => (waterMat.emissiveIntensity = 0.6 + Math.sin(t * 2.2) * 0.12), () => waterMat.dispose());
}
