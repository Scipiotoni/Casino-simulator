import * as THREE from 'three';
import { mat, glow, gold, chrome, blackGloss } from '../../render/materials';
import { labelTexture } from '../../render/textures';
import type { ItemModel, ModelEvent } from '../types';
import { type BuildOpts, Dyn, bake, box, cyl, disposeTree, plane, rbox, shadeHex, sph, stool } from './common';

const BOTTLE_COLS = [0x3ddc84, 0xc8102e, 0xf2b632, 0x2fb8c9, 0x9b59ff, 0xff8a1f, 0xf4f1ea, 0x6b3a1e];

function bottles(root: THREE.Object3D, y: number, z: number, from: number, to: number, seed: number): void {
  let i = seed;
  for (let x = from; x <= to; x += 0.17) {
    const col = BOTTLE_COLS[i++ % BOTTLE_COLS.length];
    const m = mat(col, { rough: 0.15, metal: 0.2, emissive: col, emissiveIntensity: 0.18 });
    const h = 0.22 + ((i * 37) % 7) * 0.012;
    cyl(root, 0.045, 0.05, h, m, x, y + h / 2, z, 10);
    cyl(root, 0.015, 0.02, 0.08, m, x, y + h + 0.04, z, 6);
  }
}

function makeGlass(kind: 'cocktail' | 'beer' | 'plate', color: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'cocktail') {
    const glassM = mat(0xbfe9ff, { rough: 0.05, transparent: true, opacity: 0.6 });
    const cup = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.08, 14, 1, true), glassM);
    cup.rotation.x = Math.PI;
    cup.position.y = 0.13;
    const drink = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.06, 14), mat(color, { emissive: color, emissiveIntensity: 0.5, rough: 0.2 }));
    drink.rotation.x = Math.PI;
    drink.position.y = 0.125;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), glassM);
    stem.position.y = 0.05;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 12), glassM);
    const olive = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat(0x3ddc84));
    olive.position.set(0.02, 0.15, 0);
    g.add(cup, drink, stem, foot, olive);
  } else if (kind === 'beer') {
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.14, 12), mat(0xf2b632, { rough: 0.2, emissive: 0x6b4a00, emissiveIntensity: 0.4 }));
    mug.position.y = 0.07;
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12), mat(0xfff8e6, { rough: 0.8 }));
    foam.position.y = 0.15;
    g.add(mug, foam);
  } else {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.015, 18), mat(0xf4f1ea, { rough: 0.3 }));
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd9a043, { rough: 0.6 }));
    bun.position.y = 0.05;
    const patty = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 14), mat(0x5a2a10, { rough: 0.8 }));
    patty.position.y = 0.04;
    const lettuce = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.008, 14), mat(0x3ddc84));
    lettuce.position.y = 0.052;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 14), mat(0xd9a043, { rough: 0.6 }));
    bottom.position.y = 0.022;
    const fries = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.035), mat(0xc8102e));
    fries.position.set(0.075, 0.05, 0.02);
    g.add(plate, bottom, patty, lettuce, bun, fries);
  }
  return g;
}

export function barModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(o.color, { rough: 0.4, metal: 0.1 });
  const darkWood = mat(shadeHex(o.color, 0.6), { rough: 0.45 });
  // Back bar
  box(root, 3.9, 1.0, 0.36, darkWood, 0, 0.5, -1.3);
  box(root, 3.9, 1.3, 0.05, mat(0x1a1424, { rough: 0.1, metal: 0.8 }), 0, 1.65, -1.46);
  box(root, 3.8, 0.04, 0.26, wood, 0, 1.3, -1.33);
  box(root, 3.8, 0.04, 0.26, wood, 0, 1.72, -1.33);
  bottles(root, 1.02, -1.3, -1.8, 1.8, 0);
  bottles(root, 1.32, -1.33, -1.75, 1.75, 3);
  bottles(root, 1.74, -1.33, -1.7, 1.7, 5);
  const sign = labelTexture(String(o.params.sign ?? 'COCKTAILS'), { w: 384, h: 96, bg: '#140a22', color: '#ff3fa4', border: 'rgba(255,63,164,0.6)' });
  plane(root, 1.8, 0.45, new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 1.2 }), 0, 2.25, -1.42);
  box(root, 1.9, 0.52, 0.06, mat(0x0b0714), 0, 2.25, -1.47);
  // Counter
  box(root, 3.9, 1.0, 0.54, wood, 0, 0.5, -0.08);
  box(root, 4.0, 0.07, 0.68, mat(0x17151f, { rough: 0.12, metal: 0.4 }), 0, 1.035, -0.1);
  box(root, 3.92, 0.04, 0.02, glow(0xff3fa4, 1.8), 0, 0.2, 0.2);
  box(root, 3.92, 0.035, 0.03, gold(), 0, 0.96, 0.2);
  box(root, 3.92, 0.03, 0.04, chrome(), 0, 0.1, 0.36);
  for (let i = 0; i < 4; i++) stool(root, -1.5 + i, 0.62, 0x8a1030, 0.74);
  // Glasses per seat
  const drinks: THREE.Group[] = [];
  const cocktailCols = [0xff3fa4, 0x2fe6ff, 0xffd23f, 0x3ddc84];
  for (let i = 0; i < 4; i++) {
    const g = makeGlass(i % 2 === 0 ? 'cocktail' : 'beer', cocktailCols[i]);
    g.position.set(-1.5 + i + 0.1, 1.07, 0.02);
    g.visible = false;
    root.add(g);
    dyn.keep(g);
    drinks.push(g);
  }
  bake(root, dyn);
  const timers = [0, 0, 0, 0];
  return {
    root,
    height: 2.6,
    update(dt) {
      for (let i = 0; i < 4; i++) {
        if (timers[i] > 0) {
          timers[i] -= dt;
          drinks[i].visible = true;
          if (timers[i] <= 0) drinks[i].visible = false;
        }
      }
    },
    event(ev: ModelEvent) {
      if (ev.type === 'start') timers[ev.seat] = ev.duration + 0.5;
      if (ev.type === 'clear') timers[ev.seat] = 0.01;
    },
    dispose() {
      disposeTree(root);
    },
  };
}

export function snackModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const body = mat(o.color, { rough: 0.35, metal: 0.15 });
  // Back kitchen
  box(root, 2.9, 0.95, 0.4, mat(0x9aa0ab, { metal: 0.7, rough: 0.35 }), 0, 0.475, -1.28);
  box(root, 1.2, 0.05, 0.36, mat(0x17151f, { rough: 0.5 }), -0.7, 0.97, -1.28);
  for (let i = 0; i < 4; i++) box(root, 1.1, 0.012, 0.02, glow(0xff5a1f, 2.2), -0.7, 0.99, -1.4 + i * 0.08);
  cyl(root, 0.22, 0.22, 0.18, chrome(), 0.7, 1.05, -1.28, 16);
  box(root, 2.9, 0.9, 0.05, mat(0xb9b0a3, { rough: 0.5 }), 0, 1.5, -1.47);
  const sign = labelTexture(String(o.params.sign ?? 'SNACKS'), { w: 320, h: 96, bg: '#1a0b10', color: '#ffd23f', border: 'rgba(255,210,63,0.6)' });
  plane(root, 1.5, 0.45, new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 1.2 }), 0, 2.2, -1.42);
  box(root, 1.6, 0.52, 0.06, mat(0x0b0714), 0, 2.2, -1.47);
  // Front counter with a display case
  box(root, 2.9, 1.0, 0.54, body, 0, 0.5, -0.08);
  box(root, 3.0, 0.07, 0.68, mat(0xcfc6b8, { rough: 0.45 }), 0, 1.035, -0.1);
  const glass = mat(0xbfe9ff, { transparent: true, opacity: 0.22, rough: 0.05, depthWrite: false });
  box(root, 1.2, 0.34, 0.4, glass, 0.6, 1.24, -0.18);
  for (let i = 0; i < 3; i++) {
    const food = makeGlass('plate', 0);
    food.position.set(0.25 + i * 0.35, 1.07, -0.18);
    food.scale.setScalar(0.9);
    root.add(food);
  }
  box(root, 2.92, 0.04, 0.02, glow(0xffd23f, 1.6), 0, 0.2, 0.2);
  for (let i = 0; i < 3; i++) stool(root, -1 + i, 0.62, 0xc8102e, 0.74);
  const plates: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const g = makeGlass('plate', 0);
    g.position.set(-1 + i, 1.075, 0.05);
    g.visible = false;
    root.add(g);
    dyn.keep(g);
    plates.push(g);
  }
  bake(root, dyn);
  const timers = [0, 0, 0];
  return {
    root,
    height: 2.6,
    update(dt) {
      for (let i = 0; i < 3; i++) {
        if (timers[i] > 0) {
          timers[i] -= dt;
          plates[i].visible = timers[i] > 0;
        }
      }
    },
    event(ev) {
      if (ev.type === 'start') timers[ev.seat] = ev.duration + 0.5;
      if (ev.type === 'clear') timers[ev.seat] = 0.01;
    },
    dispose() {
      disposeTree(root);
    },
  };
}

export function benchModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const cushion = mat(o.color, { rough: 0.8 });
  const g = gold();
  rbox(root, 1.84, 0.14, 0.52, 0.05, cushion, 0, 0.4, 0);
  rbox(root, 1.84, 0.5, 0.12, 0.05, cushion, 0, 0.72, -0.24);
  box(root, 1.9, 0.05, 0.56, g, 0, 0.32, 0);
  for (const x of [-0.85, 0.85]) for (const z of [-0.2, 0.2]) cyl(root, 0.03, 0.025, 0.3, g, x, 0.15, z, 8);
  for (const x of [-0.94, 0.94]) rbox(root, 0.08, 0.3, 0.5, 0.03, g, x, 0.55, 0);
  // Tufting buttons
  for (let i = 0; i < 6; i++) sph(root, 0.02, mat(shadeHex(o.color, 0.6)), -0.75 + i * 0.3, 0.8, -0.175, 6, 5);
  bake(root, dyn);
  return {
    root,
    height: 1.2,
    update() {},
    event() {},
    dispose() {
      disposeTree(root);
    },
  };
}

export function stageModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const H = 0.35;
  rbox(root, 3.9, H, 2.8, 0.05, mat(0x17151f, { rough: 0.3 }), 0, H / 2, 0);
  box(root, 3.95, 0.05, 0.05, gold(), 0, H, 1.4);
  const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3fa4, emissiveIntensity: 1.8 });
  box(root, 3.9, 0.03, 0.02, led, 0, H * 0.5, 1.41);
  // Curtain folds
  const velvet = mat(o.color, { rough: 0.9 });
  for (let i = 0; i < 16; i++) cyl(root, 0.14, 0.14, 2.4, velvet, -1.85 + i * 0.247, H + 1.2, -1.3, 10);
  box(root, 4.0, 0.36, 0.3, mat(shadeHex(o.color, 0.7), { rough: 0.9 }), 0, H + 2.45, -1.25);
  box(root, 4.0, 0.05, 0.32, gold(), 0, H + 2.28, -1.25);
  // Speakers
  for (const x of [-1.65, 1.65]) {
    rbox(root, 0.45, 0.8, 0.4, 0.04, blackGloss(), x, H + 0.4, -0.7);
    cyl(root, 0.14, 0.14, 0.02, mat(0x3a3a44), x, H + 0.52, -0.49, 16).rotation.x = Math.PI / 2;
    cyl(root, 0.08, 0.08, 0.02, mat(0x3a3a44), x, H + 0.2, -0.49, 14).rotation.x = Math.PI / 2;
  }
  // Mic stand
  cyl(root, 0.012, 0.012, 1.2, chrome(), 0.45, H + 0.6, 0.35, 6);
  cyl(root, 0.12, 0.12, 0.02, chrome(), 0.45, H + 0.01, 0.35, 12);
  // Spotlight rigs with animated beams
  const beams: THREE.Mesh[] = [];
  const beamMats: THREE.MeshBasicMaterial[] = [];
  for (const x of [-1.8, 1.8]) {
    cyl(root, 0.04, 0.04, 2.6, blackGloss(), x, 1.3, 1.25, 8);
    const head = new THREE.Group();
    head.position.set(x, 2.6, 1.25);
    const lamp = cyl(head, 0.1, 0.13, 0.22, blackGloss(), 0, 0, 0, 12);
    lamp.rotation.x = Math.PI / 2;
    const bm = new THREE.MeshBasicMaterial({ color: x < 0 ? 0xff9fdc : 0x9fe8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.8, 20, 1, true), bm);
    beam.position.y = -1.4;
    const pivot = new THREE.Group();
    pivot.add(beam);
    head.add(pivot);
    root.add(head);
    dyn.keep(head);
    beams.push(pivot as unknown as THREE.Mesh);
    beamMats.push(bm);
  }
  bake(root, dyn);
  return {
    root,
    height: 3.2,
    update(dt, ctx) {
      beams.forEach((b, i) => {
        const s = i === 0 ? 1 : -1;
        b.rotation.z = s * (0.45 + Math.sin(ctx.t * 0.9 + i) * 0.2);
        b.rotation.x = -0.55 + Math.sin(ctx.t * 0.7 + i * 2) * 0.15;
      });
      led.emissive.setHSL((ctx.t * 0.1) % 1, 0.9, 0.55);
      void dt;
    },
    event() {},
    dispose() {
      disposeTree(root);
      beamMats.forEach((m) => m.dispose());
      led.dispose();
    },
  };
}

/** Glass elevator linking the floors. Its doors open onto the +x side (the portal tile). */
export function elevatorModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const g = gold();
  const H = 2.45;
  // Marble plinth covering the 2×3 footprint
  rbox(root, 1.96, 0.1, 2.96, 0.03, mat(0xe9e1d3, { rough: 0.3 }), 0, 0.05, 0);
  box(root, 1.98, 0.03, 2.98, g, 0, 0.1, 0);
  // Shaft: gold posts, glass panels and a crown
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const R = 0.82;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    cyl(root, 0.035, 0.035, H, g, Math.sin(a) * R, 0.1 + H / 2, Math.cos(a) * R, 8);
  }
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 24, 1, true, Math.PI / 2 + 0.55, Math.PI * 2 - 1.1), glass);
  shaft.position.set(0, 0.1 + H / 2, 0);
  root.add(shaft);
  dyn.keep(shaft);
  cyl(root, R + 0.08, R + 0.08, 0.14, g, 0, 0.1 + H + 0.07, 0, 28);
  cyl(root, R + 0.02, R + 0.1, 0.12, mat(o.color, { rough: 0.4 }), 0, 0.1 + H + 0.2, 0, 28);
  // Car floor and a velvet bench inside
  cyl(root, R - 0.05, R - 0.05, 0.06, mat(0x8a1030, { rough: 0.9 }), 0, 0.13, 0, 24);
  rbox(root, 0.8, 0.12, 0.28, 0.04, mat(0x8a1030, { rough: 0.8 }), -0.35, 0.45, 0).rotation.y = Math.PI / 2;
  // Door frame on +x with the floor indicator
  box(root, 0.08, H - 0.1, 0.12, g, R + 0.02, 0.1 + (H - 0.1) / 2, -0.58);
  box(root, 0.08, H - 0.1, 0.12, g, R + 0.02, 0.1 + (H - 0.1) / 2, 0.58);
  box(root, 0.1, 0.12, 1.28, g, R + 0.02, 0.1 + H - 0.14, 0);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.26),
    new THREE.MeshStandardMaterial({ map: labelTexture('▲ ELEVATOR ▼', { w: 256, h: 72, bg: '#1a0b2b', color: '#ffd24a', border: 'rgba(255,210,74,0.6)' }), emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: labelTexture('▲ ELEVATOR ▼', { w: 256, h: 72, bg: '#1a0b2b', color: '#ffd24a', border: 'rgba(255,210,74,0.6)' }) }),
  );
  sign.rotation.y = Math.PI / 2;
  sign.position.set(R + 0.09, 0.1 + H + 0.12, 0);
  root.add(sign);
  // Call button panel
  box(root, 0.04, 0.3, 0.14, chrome(), R + 0.16, 1.05, 0.8);
  const lamp = sph(root, 0.035, glow(0x39ff88, 2.2), R + 0.19, 1.12, 0.8, 8, 6);
  dyn.keep(lamp);
  // Potted palms in the corners of the plinth
  for (const z of [-1.2, 1.2]) {
    cyl(root, 0.16, 0.12, 0.3, mat(0x2c2433, { rough: 0.6 }), -0.72, 0.25, z, 12);
    sph(root, 0.2, mat(0x2f7a3a, { rough: 0.9 }), -0.72, 0.52, z, 10, 8);
  }
  bake(root, dyn);
  let t = 0;
  return {
    root,
    height: H + 0.4,
    update(dt) {
      t += dt;
      lamp.visible = Math.sin(t * 3) > -0.2;
    },
    event() {},
    dispose() {
      disposeTree(root);
    },
  };
}

/** Hotel reception: a long marble counter with a bell, a key rack and a lit sign. */
export function frontDeskModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(o.color, { rough: 0.45 });
  const marble = mat(0xf1ece2, { rough: 0.15, metal: 0.05 });
  const g = gold();
  rbox(root, 3.6, 1.0, 0.7, 0.05, wood, 0, 0.5, 0.35);
  box(root, 3.7, 0.06, 0.8, marble, 0, 1.03, 0.35);
  box(root, 3.62, 0.04, 0.02, g, 0, 0.9, 0.71);
  // Back wall with key rack and sign
  rbox(root, 3.6, 2.3, 0.14, 0.03, mat(shadeHex(o.color, 0.6), { rough: 0.6 }), 0, 1.15, -0.85);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
    box(root, 0.16, 0.2, 0.05, mat(0x2a1a12, { rough: 0.7 }), -1.2 + c * 0.34, 1.0 + r * 0.3, -0.76);
    sph(root, 0.025, g, -1.2 + c * 0.34, 0.95 + r * 0.3, -0.72, 6, 5);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.42), new THREE.MeshStandardMaterial({ map: labelTexture('RECEPTION', { color: '#ffc53d', glow: '#ffc53d', bg: '#17151f', w: 512, h: 96 }), emissive: 0xffffff, emissiveIntensity: 0.6 }));
  sign.position.set(0, 2.0, -0.77);
  root.add(sign);
  // Bell and a little lamp
  cyl(root, 0.07, 0.09, 0.02, g, 0.9, 1.07, 0.3, 14);
  sph(root, 0.06, g, 0.9, 1.1, 0.3, 12, 8);
  cyl(root, 0.02, 0.02, 0.3, g, -1.3, 1.2, 0.2, 8);
  sph(root, 0.1, glow(0xffe0a0, 1.4), -1.3, 1.4, 0.2, 12, 8);
  bake(root, dyn);
  return { root, height: 2.3, update() {}, event() {}, dispose() { disposeTree(root); } };
}

/** A made-up hotel bed with pillows, a runner and a nightstand. */
export function hotelBedModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const frame = mat(0x2a1a12, { rough: 0.5 });
  const sheet = mat(0xf6f3ee, { rough: 0.9 });
  rbox(root, 1.7, 0.3, 2.3, 0.05, frame, 0, 0.15, 0.1);
  rbox(root, 1.6, 0.25, 2.2, 0.08, sheet, 0, 0.42, 0.12);
  rbox(root, 1.62, 0.08, 1.1, 0.04, mat(o.color, { rough: 0.8 }), 0, 0.56, 0.55);
  for (const x of [-0.4, 0.4]) rbox(root, 0.62, 0.16, 0.34, 0.07, sheet, x, 0.6, -0.72);
  rbox(root, 1.8, 1.1, 0.12, 0.04, mat(shadeHex(o.color, 0.55), { rough: 0.7 }), 0, 0.55, -1.05);
  rbox(root, 0.34, 0.45, 0.34, 0.03, frame, 1.1, 0.23, -0.8);
  cyl(root, 0.03, 0.05, 0.25, gold(), 1.1, 0.58, -0.8, 8);
  sph(root, 0.1, glow(0xffe0a0, 1.2), 1.1, 0.76, -0.8, 12, 8);
  bake(root, dyn);
  return { root, height: 1.2, update() {}, event() {}, dispose() { disposeTree(root); } };
}
