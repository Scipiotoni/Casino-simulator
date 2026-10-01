import * as THREE from 'three';
import { mat, glow, gold, chrome } from '../render/materials';

export type CarModelKind = 'hatch' | 'coupe' | 'muscle' | 'limo' | 'truck' | 'super' | 'ev' | 'hyper' | 'cabrio';

/** A car from Velocity Motors. */
export interface CarDef {
  id: string;
  name: string;
  kind: CarModelKind;
  price: number;
  /** Casino level needed to buy it. */
  unlock: number;
  /** Top speed (m/s), acceleration (m/s²) and how sharply it turns. */
  top: number;
  accel: number;
  grip: number;
  colors: number[];
  blurb: string;
}

export const CARS: CarDef[] = [
  { id: 'hatch', name: 'City Hatch', kind: 'hatch', price: 8_000, unlock: 1, top: 20, accel: 7, grip: 1.15, colors: [0x39ff88, 0xffc53d, 0x2fe6ff, 0xff6fb5, 0xf4f1ea], blurb: 'Small, cheap, cheerful. Parks anywhere.' },
  { id: 'cabrio', name: 'Riviera Convertible', kind: 'cabrio', price: 28_000, unlock: 2, top: 25, accel: 8, grip: 1.1, colors: [0xc8102e, 0xf4f1ea, 0x2fb8c9, 0xffc53d], blurb: 'Top down, sunglasses on. You can see who’s driving.' },
  { id: 'coupe', name: 'Strip Coupe', kind: 'coupe', price: 45_000, unlock: 3, top: 29, accel: 10, grip: 1.2, colors: [0x1f4fbf, 0xc8102e, 0x17151f, 0xf4f1ea], blurb: 'A sleek two-door with a little spoiler.' },
  { id: 'muscle', name: 'Muscle Car', kind: 'muscle', price: 70_000, unlock: 4, top: 32, accel: 12, grip: 0.95, colors: [0xff8a1f, 0x17151f, 0xc8102e, 0x2a6bff], blurb: 'Racing stripes, a big engine and a bigger rumble.' },
  { id: 'limo', name: 'Stretch Limo', kind: 'limo', price: 110_000, unlock: 5, top: 24, accel: 6, grip: 0.8, colors: [0x0b0b0e, 0xf4f1ea, 0xff6fb5], blurb: 'Arrive like a high roller. Turns like a boat.' },
  { id: 'truck', name: 'Monster Truck', kind: 'truck', price: 140_000, unlock: 6, top: 26, accel: 9, grip: 1, colors: [0x39ff88, 0xc8102e, 0x1f4fbf, 0xffc53d], blurb: 'Huge wheels, huge fun, huge fuel bill.' },
  { id: 'ev', name: 'Neon EV', kind: 'ev', price: 190_000, unlock: 7, top: 36, accel: 16, grip: 1.25, colors: [0xf4f1ea, 0x17151f, 0x6a2cc2], blurb: 'Silent, instant torque and glowing underlights.' },
  { id: 'super', name: 'Viper Supercar', kind: 'super', price: 320_000, unlock: 8, top: 42, accel: 17, grip: 1.3, colors: [0xff2a2a, 0xffc53d, 0x39ff88, 0x2fe6ff], blurb: 'Scissor-door looks, a wing on the back and silly speed.' },
  { id: 'hyper', name: 'Golden Hypercar', kind: 'hyper', price: 1_000_000, unlock: 10, top: 50, accel: 20, grip: 1.35, colors: [0xf2b632], blurb: 'Solid gold. The fastest thing in the city.' },
];

export function carDef(id: string | null | undefined): CarDef | null {
  return CARS.find((c) => c.id === id) ?? null;
}

/** A traffic car you took: how it drives. */
export const STOLEN_SPECS = { top: 23, accel: 8, grip: 1 };

export interface CarModel {
  root: THREE.Group;
  /** Front then rear wheels (they spin and the front ones steer). */
  wheels: THREE.Object3D[];
  front: THREE.Object3D[];
  /** Where the driver sits (local), for convertibles. */
  seat: THREE.Vector3;
  length: number;
  open: boolean;
}

/**
 * The cars at Velocity Motors, built from simple shapes. They face +z (front at +z) and
 * stand on y = 0.
 */
export function buildCar(def: CarDef, color: number): CarModel {
  const g = new THREE.Group();
  const k = def.kind;
  const paint = k === 'hyper' ? gold() : mat(color, { rough: 0.22, metal: 0.6 });
  const dark = mat(0x101018, { rough: 0.15, metal: 0.5 });
  const black = mat(0x15141a, { rough: 0.7 });
  const trim = chrome();
  const L = k === 'limo' ? 7.2 : k === 'truck' ? 4.6 : k === 'hatch' ? 3.7 : 4.4;
  const W = k === 'truck' ? 2.3 : k === 'hatch' ? 1.75 : 1.95;
  const ride = k === 'truck' ? 1.05 : k === 'super' || k === 'hyper' || k === 'ev' ? 0.28 : 0.38;
  const bodyH = k === 'super' || k === 'hyper' ? 0.5 : k === 'truck' ? 0.75 : 0.62;
  const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // Body
  box(paint, W, bodyH, L, 0, ride + bodyH / 2, 0);
  // Nose slopes on sports cars
  if (k === 'super' || k === 'hyper' || k === 'coupe' || k === 'ev') box(paint, W * 0.98, 0.18, L * 0.3, 0, ride + bodyH + 0.04, L * 0.3, -0.12);
  // Cabin
  const open = k === 'cabrio';
  if (!open) {
    const cabL = k === 'limo' ? L * 0.62 : k === 'hatch' ? L * 0.55 : k === 'super' || k === 'hyper' ? L * 0.36 : L * 0.42;
    const cabH = k === 'super' || k === 'hyper' ? 0.38 : k === 'truck' ? 0.65 : 0.5;
    const cabZ = k === 'hatch' ? -L * 0.08 : k === 'super' || k === 'hyper' ? -L * 0.05 : -L * 0.06;
    box(paint, W * 0.86, cabH, cabL, 0, ride + bodyH + cabH / 2, cabZ);
    box(dark, W * 0.88, cabH * 0.72, cabL * 0.96, 0, ride + bodyH + cabH * 0.48, cabZ);
  } else {
    // Windscreen frame and seats
    box(dark, W * 0.85, 0.35, 0.06, 0, ride + bodyH + 0.18, L * 0.12, -0.35);
    box(mat(0xe9e1d3, { rough: 0.8 }), W * 0.7, 0.4, 0.5, 0, ride + bodyH + 0.1, -L * 0.12);
  }
  // Stripes, wings, extras
  if (k === 'muscle') {
    box(mat(0xf4f1ea, { rough: 0.3 }), 0.22, 0.02, L * 1.001, -0.22, ride + bodyH + 0.005, 0);
    box(mat(0xf4f1ea, { rough: 0.3 }), 0.22, 0.02, L * 1.001, 0.22, ride + bodyH + 0.005, 0);
    box(trim, 0.6, 0.18, 0.7, 0, ride + bodyH + 0.09, L * 0.22);
  }
  if (k === 'super' || k === 'hyper' || k === 'coupe') {
    const wy = ride + bodyH + (k === 'coupe' ? 0.15 : 0.35);
    box(k === 'hyper' ? gold() : black, W * 0.95, 0.06, 0.4, 0, wy, -L / 2 + 0.25);
    for (const sx of [-1, 1]) box(black, 0.06, wy - ride - bodyH, 0.12, sx * W * 0.35, (wy + ride + bodyH) / 2, -L / 2 + 0.3);
  }
  if (k === 'limo') {
    for (const sx of [-1, 1]) box(trim, 0.03, 0.06, L * 0.7, sx * (W / 2 + 0.01), ride + bodyH * 0.6, 0);
  }
  if (k === 'truck') box(mat(0x2a2c33, { rough: 0.6, metal: 0.4 }), W * 0.9, 0.12, L * 0.9, 0, ride - 0.05, 0);
  // Bumpers and lights
  box(trim, W * 0.96, 0.14, 0.12, 0, ride + 0.12, L / 2 + 0.04);
  box(trim, W * 0.96, 0.14, 0.12, 0, ride + 0.12, -L / 2 - 0.04);
  for (const sx of [-1, 1]) {
    box(glow(0xfff2c8, 2.6), 0.36, 0.12, 0.05, sx * W * 0.34, ride + bodyH * 0.65, L / 2 + 0.01);
    box(glow(0xff2a2a, 1.8), 0.38, 0.1, 0.05, sx * W * 0.34, ride + bodyH * 0.65, -L / 2 - 0.01);
  }
  // Underglow
  if (k === 'ev' || k === 'super' || k === 'hyper') {
    const ug = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, L * 1.1), new THREE.MeshBasicMaterial({ color: k === 'ev' ? 0x2fe6ff : k === 'hyper' ? 0xffc53d : 0xff3fa4, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ug.rotation.x = -Math.PI / 2;
    ug.position.y = 0.03;
    g.add(ug);
  }
  // Wheels
  const R = k === 'truck' ? 0.75 : k === 'hatch' ? 0.32 : 0.37;
  const tyreW = k === 'truck' ? 0.55 : 0.3;
  const tyre = new THREE.CylinderGeometry(R, R, tyreW, 16);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(R * 0.55, R * 0.55, tyreW + 0.02, 10);
  hub.rotateZ(Math.PI / 2);
  const wheels: THREE.Object3D[] = [];
  const front: THREE.Object3D[] = [];
  const wz = L / 2 - (k === 'limo' ? 0.9 : 0.8);
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W / 2 - tyreW / 2 + (k === 'truck' ? 0.25 : 0.02)), R, sz * wz);
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tyre, black), new THREE.Mesh(hub, k === 'hyper' ? gold() : trim));
      pivot.add(wheel);
      g.add(pivot);
      wheels.push(wheel);
      if (sz > 0) front.push(pivot);
    }
  }
  return { root: g, wheels, front, seat: new THREE.Vector3(-0.38, ride + bodyH - 0.2, -L * 0.1), length: L, open };
}
