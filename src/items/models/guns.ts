import * as THREE from 'three';
import { mat, glow, gold, chrome } from '../../render/materials';
import type { GunDef } from '../../game/guns';
import { box, cyl, sph } from './common';

/**
 * A gun model built along +z (barrel forward), grip down (-y), origin at the grip. Returns the
 * group and the muzzle point (in the group's frame).
 */
export function buildGun(def: GunDef): { group: THREE.Group; muzzle: THREE.Vector3; spin?: THREE.Object3D } {
  const g = new THREE.Group();
  const body = def.kind === 'cannon' ? gold() : mat(def.color, { rough: 0.32, metal: 0.65 });
  const dark = mat(0x17151f, { rough: 0.42, metal: 0.55 });
  const black = mat(0x0c0c10, { rough: 0.55, metal: 0.3 });
  const polymer = mat(0x23222a, { rough: 0.75, metal: 0.05 });
  const wood = mat(0x6b4422, { rough: 0.6 });
  const woodDark = mat(0x4a2c16, { rough: 0.6 });
  const steel = chrome();
  const brass = gold();
  let muzzle = new THREE.Vector3(0, 0.05, 0.3);
  let spin: THREE.Object3D | undefined;
  const B = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const b = box(g, w, h, d, m, x, y, z);
    b.rotation.x = rx;
    return b;
  };
  /** A barrel along z (with a dark bore at the front). */
  const barrel = (r: number, len: number, y: number, z0: number, m: THREE.Material = steel, seg = 14) => {
    const c = cyl(g, r, r, len, m, 0, y, z0 + len / 2, seg);
    c.rotation.x = Math.PI / 2;
    const bore = cyl(g, r * 0.55, r * 0.55, 0.004, black, 0, y, z0 + len + 0.002, 10);
    bore.rotation.x = Math.PI / 2;
    return c;
  };
  /** Angled grip with textured side panels. */
  const grip = (m: THREE.Material, panel: THREE.Material | null, y = -0.065, z = -0.01, h = 0.12, rake = 0.28) => {
    const gr = B(m, 0.034, h, 0.05, 0, y, z, rake);
    if (panel) for (const sx of [-1, 1]) {
      const p = box(g, 0.004, h * 0.75, 0.036, panel, sx * 0.018, y - 0.005, z);
      p.rotation.x = rake;
    }
    return gr;
  };
  /** Trigger guard and trigger in front of the grip. */
  const trigger = (z = 0.035, y = -0.015) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 14, Math.PI), dark);
    ring.rotation.set(0, Math.PI / 2, Math.PI);
    ring.position.set(0, y, z);
    g.add(ring);
    const t = B(steel, 0.006, 0.026, 0.008, 0, y - 0.004, z - 0.004, 0.3);
    void t;
  };
  /** Picatinny rail on top (little teeth). */
  const rail = (y: number, z0: number, len: number) => {
    B(black, 0.022, 0.008, len, 0, y, z0 + len / 2);
    for (let i = 0; i < Math.floor(len / 0.018); i++) B(black, 0.026, 0.006, 0.008, 0, y + 0.006, z0 + 0.009 + i * 0.018);
  };
  /** Iron sights: front post and rear notch. */
  const sights = (y: number, zFront: number, zRear: number) => {
    B(black, 0.006, 0.014, 0.01, 0, y + 0.007, zFront);
    B(black, 0.008, 0.014, 0.01, -0.009, y + 0.007, zRear);
    B(black, 0.008, 0.014, 0.01, 0.009, y + 0.007, zRear);
    sph(g, 0.0035, glow(0x39ff88, 2), 0, y + 0.016, zFront, 6, 4);
  };
  /** A scope with glass at both ends. */
  const scope = (y: number, z: number, len: number, r: number) => {
    const tube = cyl(g, r, r, len, black, 0, y, z, 14);
    tube.rotation.x = Math.PI / 2;
    for (const sz of [-1, 1]) {
      const bell = cyl(g, r * 1.35, r, 0.04, black, 0, y, z + sz * (len / 2 + 0.015), 14);
      bell.rotation.x = Math.PI / 2 * (sz > 0 ? 1 : -1);
      const lens = cyl(g, r * 1.2, r * 1.2, 0.004, mat(0x2fe6ff, { rough: 0.05, metal: 0.9, emissive: 0x0b3a44, emissiveIntensity: 1 }), 0, y, z + sz * (len / 2 + 0.036), 14);
      lens.rotation.x = Math.PI / 2;
    }
    const turret = cyl(g, 0.012, 0.012, 0.025, black, 0, y + r + 0.01, z, 10);
    void turret;
    for (const sz of [-0.3, 0.3]) B(black, 0.02, 0.025, 0.02, 0, y - r - 0.01, z + sz * len);
  };
  switch (def.kind) {
    case 'pistol': {
      // Frame, slide with serrations, barrel, sights, mag base
      B(polymer, 0.034, 0.03, 0.17, 0, 0.012, 0.06);
      const slide = B(body, 0.036, 0.034, 0.2, 0, 0.044, 0.07);
      void slide;
      for (let i = 0; i < 6; i++) B(dark, 0.038, 0.026, 0.004, 0, 0.044, -0.015 + i * 0.008);
      B(black, 0.037, 0.012, 0.03, 0, 0.05, 0.1); // ejection port
      barrel(0.008, 0.02, 0.044, 0.165);
      sights(0.061, 0.16, -0.015);
      grip(polymer, dark, -0.065, -0.012);
      B(dark, 0.036, 0.012, 0.05, 0, -0.128, -0.03, 0.28);
      trigger(0.032, -0.012);
      muzzle = new THREE.Vector3(0, 0.044, 0.19);
      break;
    }
    case 'revolver': {
      barrel(0.012, 0.2, 0.05, 0.06);
      B(steel, 0.016, 0.012, 0.2, 0, 0.066, 0.16); // top rib
      B(steel, 0.03, 0.05, 0.08, 0, 0.035, 0.0);
      const drum = cyl(g, 0.034, 0.034, 0.055, steel, 0, 0.036, 0.03, 12);
      drum.rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const hole = cyl(g, 0.007, 0.007, 0.058, black, Math.cos(a) * 0.02, 0.036 + Math.sin(a) * 0.02, 0.03, 8);
        hole.rotation.x = Math.PI / 2;
      }
      B(steel, 0.008, 0.025, 0.02, 0, 0.07, -0.03, -0.5); // hammer
      sights(0.072, 0.25, -0.02);
      grip(wood, woodDark, -0.06, -0.035, 0.12, 0.4);
      trigger(0.02, -0.01);
      muzzle = new THREE.Vector3(0, 0.05, 0.27);
      break;
    }
    case 'cannon': {
      B(body, 0.05, 0.065, 0.27, 0, 0.038, 0.09);
      B(mat(0xfff1b8, { metal: 0.9, rough: 0.15 }), 0.042, 0.022, 0.25, 0, 0.08, 0.09);
      for (let i = 0; i < 7; i++) B(dark, 0.052, 0.04, 0.004, 0, 0.05, -0.03 + i * 0.008);
      barrel(0.016, 0.03, 0.04, 0.225, brass);
      // Muzzle brake with ports
      for (const sx of [-1, 1]) B(black, 0.006, 0.02, 0.025, sx * 0.026, 0.045, 0.235);
      sights(0.091, 0.2, -0.02);
      grip(mat(0x17151f, { rough: 0.5 }), brass, -0.065, -0.012);
      trigger(0.035, -0.012);
      sph(g, 0.012, glow(0xff3fa4, 2), 0, 0.04, -0.04, 8, 6);
      muzzle = new THREE.Vector3(0, 0.04, 0.26);
      break;
    }
    case 'smg': {
      B(body, 0.045, 0.07, 0.26, 0, 0.032, 0.06);
      B(dark, 0.047, 0.02, 0.08, 0, 0.05, 0.1);
      rail(0.072, -0.04, 0.2);
      barrel(0.012, 0.08, 0.035, 0.19);
      B(black, 0.026, 0.15, 0.036, 0, -0.08, 0.075, -0.08); // magazine
      B(black, 0.03, 0.08, 0.03, 0, -0.02, 0.17); // fore grip
      grip(polymer, null, -0.06, -0.035, 0.11, 0.3);
      trigger(0.015, -0.01);
      // Folding stock wire
      B(steel, 0.006, 0.006, 0.16, -0.02, 0.03, -0.14);
      B(steel, 0.006, 0.006, 0.16, 0.02, 0.03, -0.14);
      B(steel, 0.046, 0.05, 0.008, 0, 0.01, -0.22);
      muzzle = new THREE.Vector3(0, 0.035, 0.28);
      break;
    }
    case 'shotgun': {
      barrel(0.019, 0.56, 0.055, 0.0);
      const tube = cyl(g, 0.015, 0.015, 0.42, dark, 0, 0.022, 0.2, 10);
      tube.rotation.x = Math.PI / 2;
      // Pump with ridges
      B(wood, 0.044, 0.042, 0.16, 0, 0.026, 0.27);
      for (let i = 0; i < 6; i++) B(woodDark, 0.046, 0.044, 0.005, 0, 0.026, 0.2 + i * 0.025);
      B(dark, 0.046, 0.06, 0.2, 0, 0.04, -0.01); // receiver
      B(black, 0.047, 0.02, 0.05, 0, 0.05, 0.03); // ejection port
      sph(g, 0.006, glow(0xff4d4d, 2), 0, 0.077, 0.545, 6, 4); // bead sight
      grip(wood, null, -0.05, -0.08, 0.1, 0.5);
      const st = B(wood, 0.042, 0.075, 0.26, 0, -0.005, -0.25, -0.12);
      void st;
      B(black, 0.044, 0.085, 0.02, 0, -0.022, -0.385, -0.12); // butt pad
      trigger(-0.02, -0.005);
      muzzle = new THREE.Vector3(0, 0.055, 0.56);
      break;
    }
    case 'rifle':
    case 'sniper': {
      const long = def.kind === 'sniper';
      B(body, 0.046, 0.072, 0.3, 0, 0.032, 0.06); // receiver
      // Handguard with vents
      B(dark, 0.05, 0.058, long ? 0.26 : 0.22, 0, 0.038, long ? 0.34 : 0.32);
      for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) B(black, 0.004, 0.018, 0.022, sx * 0.026, 0.04, (long ? 0.24 : 0.24) + i * 0.035);
      barrel(0.011, long ? 0.38 : 0.2, 0.04, long ? 0.47 : 0.43);
      // Muzzle device
      const md = cyl(g, 0.016, 0.016, 0.05, black, 0, 0.04, (long ? 0.85 : 0.63) + 0.025, 10);
      md.rotation.x = Math.PI / 2;
      rail(0.072, -0.05, long ? 0.4 : 0.36);
      if (long) scope(0.105, 0.08, 0.26, 0.022);
      else {
        // Red-dot sight
        B(black, 0.03, 0.035, 0.05, 0, 0.098, 0.05);
        const lens = B(mat(0xff3b4d, { emissive: 0xff2a3a, emissiveIntensity: 1.2, rough: 0.1 }), 0.024, 0.024, 0.004, 0, 0.1, 0.077);
        void lens;
        B(black, 0.008, 0.035, 0.012, 0, 0.096, 0.42); // front sight
      }
      B(black, 0.028, 0.15, 0.045, 0, -0.085, 0.14, -0.22); // magazine
      grip(polymer, null, -0.06, -0.03, 0.11, 0.35);
      trigger(0.025, -0.012);
      // Stock
      B(body, 0.04, 0.07, 0.24, 0, 0.012, -0.2);
      B(black, 0.042, 0.085, 0.02, 0, 0.0, -0.325);
      if (long) for (const sx of [-1, 1]) {
        const leg = B(black, 0.008, 0.008, 0.18, sx * 0.03, -0.03, 0.62, 0.5);
        void leg;
      }
      muzzle = new THREE.Vector3(0, 0.04, long ? 0.9 : 0.68);
      break;
    }
    case 'minigun': {
      B(body, 0.1, 0.12, 0.3, 0, 0.0, 0.02);
      B(dark, 0.11, 0.05, 0.12, 0, 0.08, -0.02); // motor
      const barrels = new THREE.Group();
      barrels.position.set(0, 0.0, 0.4);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = cyl(barrels, 0.012, 0.012, 0.52, steel, Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0, 8);
        b.rotation.x = Math.PI / 2;
      }
      for (const z of [-0.18, 0.05, 0.24]) {
        const clamp = cyl(barrels, 0.052, 0.052, 0.025, dark, 0, 0, z, 14);
        clamp.rotation.x = Math.PI / 2;
      }
      g.add(barrels);
      spin = barrels;
      // Ammo box and belt
      B(mat(0x4a4f3a, { rough: 0.7 }), 0.12, 0.1, 0.14, 0.11, -0.05, -0.02);
      for (let i = 0; i < 5; i++) B(brass, 0.02, 0.008, 0.012, 0.06 - i * 0.012, -0.0 - i * 0.008, 0.02);
      B(dark, 0.03, 0.12, 0.05, 0, -0.1, -0.05);
      B(dark, 0.14, 0.02, 0.02, 0, 0.13, -0.05); // carry handle
      muzzle = new THREE.Vector3(0, 0.0, 0.68);
      break;
    }
    case 'laser': {
      B(body, 0.06, 0.075, 0.3, 0, 0.032, 0.08);
      B(dark, 0.064, 0.02, 0.26, 0, 0.075, 0.07);
      for (let i = 0; i < 3; i++) {
        const r = cyl(g, 0.042 - i * 0.005, 0.042 - i * 0.005, 0.02, glow(def.tracer, 2.4), 0, 0.032, 0.12 + i * 0.06, 16);
        r.rotation.x = Math.PI / 2;
      }
      const tip = cyl(g, 0.015, 0.028, 0.09, steel, 0, 0.032, 0.275, 12);
      tip.rotation.x = Math.PI / 2;
      sph(g, 0.012, glow(def.tracer, 3), 0, 0.032, 0.322, 8, 6);
      // Power cell
      const cell = cyl(g, 0.018, 0.018, 0.08, glow(0x39ff88, 1.6), 0, 0.085, -0.02, 10);
      cell.rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) B(glow(def.tracer, 1.8), 0.004, 0.006, 0.2, sx * 0.031, 0.05, 0.08);
      grip(polymer, null);
      trigger();
      muzzle = new THREE.Vector3(0, 0.032, 0.33);
      break;
    }
    case 'paint': {
      B(body, 0.05, 0.075, 0.22, 0, 0.032, 0.05);
      // Hopper
      sph(g, 0.065, mat(0xffc53d, { rough: 0.2, transparent: true, opacity: 0.8 }), 0, 0.13, 0.02, 14, 10);
      for (let i = 0; i < 4; i++) sph(g, 0.017, mat([0xff6fb5, 0x39ff88, 0x2fe6ff, 0xffc53d][i], { rough: 0.3 }), (i - 1.5) * 0.02, 0.12, 0.02, 8, 6);
      const neck = cyl(g, 0.018, 0.018, 0.05, dark, 0, 0.085, 0.03, 10);
      void neck;
      barrel(0.017, 0.22, 0.04, 0.15, dark);
      // CO2 tank
      const tank = cyl(g, 0.028, 0.028, 0.18, mat(0x8c9099, { metal: 0.8, rough: 0.3 }), 0, -0.02, -0.15, 12);
      tank.rotation.x = Math.PI / 2;
      grip(polymer, null);
      trigger();
      muzzle = new THREE.Vector3(0, 0.04, 0.37);
      break;
    }
    case 'confetti': {
      const tube = cyl(g, 0.05, 0.068, 0.42, body, 0, 0.042, 0.15, 18);
      tube.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const band = cyl(g, 0.07, 0.07, 0.025, mat([0xffc53d, 0x2fe6ff, 0x39ff88][i], { rough: 0.4 }), 0, 0.042, 0.02 + i * 0.12, 18);
        band.rotation.x = Math.PI / 2;
      }
      const star = sph(g, 0.02, glow(0xffc53d, 2), 0, 0.12, 0.1, 8, 6);
      void star;
      grip(dark, null);
      trigger();
      muzzle = new THREE.Vector3(0, 0.042, 0.37);
      break;
    }
    case 'knuckles': {
      B(body, 0.095, 0.032, 0.03, 0, 0.015, 0.06);
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.006, 6, 12), body);
        r.rotation.y = Math.PI / 2;
        r.position.set(-0.033 + i * 0.022, 0.045, 0.06);
        g.add(r);
        sph(g, 0.007, body, -0.033 + i * 0.022, 0.062, 0.07, 6, 4);
      }
      muzzle = new THREE.Vector3(0, 0.03, 0.12);
      break;
    }
    case 'bat': {
      // Lathe-turned bat: knob, thin handle, wide barrel
      const pts = [[0.0, -0.06], [0.034, -0.06], [0.034, -0.045], [0.018, -0.03], [0.018, 0.25], [0.035, 0.5], [0.05, 0.72], [0.052, 0.82], [0.0, 0.84]].map(([r, y]) => new THREE.Vector2(r, y));
      const bat = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), mat(def.color, { rough: 0.5 }));
      bat.rotation.x = Math.PI / 2;
      g.add(bat);
      // Grip tape
      const tape = cyl(g, 0.02, 0.02, 0.2, mat(0x17151f, { rough: 0.9 }), 0, 0, 0.06, 12);
      tape.rotation.x = Math.PI / 2;
      // Brand label
      const lbl = cyl(g, 0.0505, 0.048, 0.06, mat(0xc8102e, { rough: 0.5 }), 0, 0, 0.62, 18);
      lbl.rotation.x = Math.PI / 2;
      muzzle = new THREE.Vector3(0, 0, 0.82);
      break;
    }
    case 'golf': {
      const sh = cyl(g, 0.009, 0.014, 0.95, steel, 0, 0, 0.45, 10);
      sh.rotation.x = Math.PI / 2;
      const gripC = cyl(g, 0.017, 0.015, 0.22, mat(0x17151f, { rough: 0.9 }), 0, 0, 0.0, 12);
      gripC.rotation.x = Math.PI / 2;
      // Driver head
      const head = sph(g, 0.055, mat(0x1b2748, { metal: 0.8, rough: 0.2 }), 0.045, -0.015, 0.94, 14, 10);
      head.scale.set(1.3, 0.6, 0.9);
      B(steel, 0.08, 0.004, 0.05, 0.045, -0.045, 0.94);
      muzzle = new THREE.Vector3(0, 0, 0.94);
      break;
    }
    case 'katana': {
      // Wrapped handle, tsuba, curved blade with an edge line
      const hdl = cyl(g, 0.017, 0.017, 0.24, mat(0x17151f, { rough: 0.8 }), 0, 0, 0.04, 10);
      hdl.rotation.x = Math.PI / 2;
      for (let i = 0; i < 7; i++) B(mat(0xc8102e, { rough: 0.7 }), 0.036, 0.008, 0.012, 0, 0, -0.06 + i * 0.03, 0.6);
      const guard = cyl(g, 0.048, 0.048, 0.014, brass, 0, 0, 0.17, 16);
      guard.rotation.x = Math.PI / 2;
      B(brass, 0.022, 0.03, 0.03, 0, 0.004, 0.19); // habaki
      const blade = new THREE.Group();
      blade.position.set(0, 0, 0.2);
      for (let i = 0; i < 6; i++) {
        const seg = box(blade, 0.007, 0.034 - i * 0.002, 0.13, steel, 0, i * i * 0.0012, 0.065 + i * 0.125);
        seg.rotation.x = -i * 0.018;
        box(blade, 0.008, 0.004, 0.13, mat(0xf4f8ff, { metal: 1, rough: 0.02 }), 0, -0.016 + i * i * 0.0012, 0.065 + i * 0.125).rotation.x = -i * 0.018;
      }
      g.add(blade);
      muzzle = new THREE.Vector3(0, 0.03, 0.92);
      break;
    }
    case 'hammer': {
      const h = cyl(g, 0.019, 0.022, 0.82, wood, 0, 0, 0.37, 10);
      h.rotation.x = Math.PI / 2;
      const gripC = cyl(g, 0.023, 0.023, 0.16, mat(0x17151f, { rough: 0.9 }), 0, 0, 0.02, 10);
      gripC.rotation.x = Math.PI / 2;
      const head = cyl(g, 0.055, 0.055, 0.22, mat(0x5a5d66, { metal: 0.75, rough: 0.35 }), 0, 0, 0.79, 14);
      head.rotation.z = Math.PI / 2;
      for (const sx of [-1, 1]) {
        const face = cyl(g, 0.06, 0.06, 0.02, steel, sx * 0.115, 0, 0.79, 14);
        face.rotation.z = Math.PI / 2;
      }
      muzzle = new THREE.Vector3(0, 0, 0.8);
      break;
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = false;
  });
  return { group: g, muzzle, spin };
}
