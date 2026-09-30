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
}

const STANDARD: Layout = {
  w: 4, d: 4, bedX: -0.6, tv: [1.92, -0.9], desk: [1.45, 0.35], minibar: [1.55, -1.6], plant: [1.65, 1.65], sofa: [-1.62, 1.2],
  chandelier: [0.2, -0.3], jacuzzi: [0, 0], piano: [0, 0],
};
const SUITE: Layout = {
  w: 6, d: 5, bedX: -1.5, tv: [2.92, -1.4], desk: [2.4, 0.6], minibar: [2.5, -2.1], plant: [2.6, 2.1], sofa: [-2.62, 1.4],
  chandelier: [0.3, -0.4], jacuzzi: [1.1, -1.3], piano: [-1.0, 1.35],
};

/** Bed: frame, mattress, pillows, blanket; bigger and grander with each tier. */
function bed(root: THREE.Object3D, tier: number, x: number, headZ: number): void {
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
  const suite = Number(o.params.suite) === 1;
  const L = suite ? SUITE : STANDARD;
  const s = o.setup ? sanitizeSetup(o.setup, suite) : defaultSetup();
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
  const bw = [1.0, 1.4, 1.7, 1.9][s.bed];
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

