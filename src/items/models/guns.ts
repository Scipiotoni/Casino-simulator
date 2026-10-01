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
  const body = def.kind === 'cannon' ? gold() : mat(def.color, { rough: 0.35, metal: 0.6 });
  const dark = mat(0x17151f, { rough: 0.45, metal: 0.5 });
  const wood = mat(0x6b4422, { rough: 0.7 });
  const steel = chrome();
  let muzzle = new THREE.Vector3(0, 0.05, 0.3);
  let spin: THREE.Object3D | undefined;
  const grip = (m: THREE.Material, y = -0.06, z = 0) => {
    const gr = box(g, 0.035, 0.11, 0.05, m, 0, y, z);
    gr.rotation.x = 0.25;
  };
  switch (def.kind) {
    case 'pistol':
      box(g, 0.04, 0.05, 0.2, body, 0, 0.03, 0.07);
      grip(dark);
      muzzle = new THREE.Vector3(0, 0.035, 0.18);
      break;
    case 'revolver': {
      const bar = cyl(g, 0.012, 0.012, 0.22, steel, 0, 0.045, 0.14, 8);
      bar.rotation.x = Math.PI / 2;
      const drum = cyl(g, 0.03, 0.03, 0.05, steel, 0, 0.035, 0.02, 10);
      drum.rotation.x = Math.PI / 2;
      grip(wood, -0.05, -0.03);
      muzzle = new THREE.Vector3(0, 0.045, 0.26);
      break;
    }
    case 'cannon': {
      box(g, 0.05, 0.065, 0.26, body, 0, 0.035, 0.09);
      box(g, 0.035, 0.02, 0.24, mat(0xfff1b8, { metal: 0.9, rough: 0.2 }), 0, 0.075, 0.09);
      grip(mat(0x17151f, { rough: 0.5 }));
      sph(g, 0.012, glow(0xff3fa4, 2), 0, 0.03, -0.035, 8, 6);
      muzzle = new THREE.Vector3(0, 0.04, 0.23);
      break;
    }
    case 'smg':
      box(g, 0.045, 0.07, 0.26, body, 0, 0.03, 0.06);
      box(g, 0.025, 0.14, 0.035, dark, 0, -0.07, 0.07);
      grip(dark, -0.05, -0.04);
      muzzle = new THREE.Vector3(0, 0.04, 0.22);
      break;
    case 'shotgun': {
      const bar = cyl(g, 0.018, 0.018, 0.55, steel, 0, 0.05, 0.25, 8);
      bar.rotation.x = Math.PI / 2;
      box(g, 0.04, 0.05, 0.22, wood, 0, 0.02, 0.18);
      box(g, 0.045, 0.06, 0.18, dark, 0, 0.03, -0.03);
      const st = box(g, 0.04, 0.09, 0.22, wood, 0, -0.01, -0.2);
      st.rotation.x = -0.15;
      muzzle = new THREE.Vector3(0, 0.05, 0.53);
      break;
    }
    case 'rifle':
    case 'sniper': {
      const long = def.kind === 'sniper';
      box(g, 0.045, 0.07, 0.42, body, 0, 0.03, 0.12);
      const bar = cyl(g, 0.012, 0.012, long ? 0.45 : 0.25, steel, 0, 0.045, long ? 0.55 : 0.45, 8);
      bar.rotation.x = Math.PI / 2;
      box(g, 0.025, 0.13, 0.05, dark, 0, -0.06, 0.12);
      box(g, 0.04, 0.09, 0.2, body, 0, 0.0, -0.2);
      grip(dark, -0.05, -0.03);
      if (long) {
        const sc = cyl(g, 0.022, 0.022, 0.2, dark, 0, 0.1, 0.1, 10);
        sc.rotation.x = Math.PI / 2;
      } else box(g, 0.02, 0.03, 0.12, dark, 0, 0.085, 0.08);
      muzzle = new THREE.Vector3(0, 0.045, long ? 0.78 : 0.58);
      break;
    }
    case 'minigun': {
      box(g, 0.1, 0.12, 0.3, body, 0, 0.0, 0.02);
      const barrels = new THREE.Group();
      barrels.position.set(0, 0.0, 0.4);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = cyl(barrels, 0.012, 0.012, 0.5, steel, Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0, 6);
        b.rotation.x = Math.PI / 2;
      }
      g.add(barrels);
      spin = barrels;
      box(g, 0.03, 0.12, 0.05, dark, 0, -0.1, -0.05);
      muzzle = new THREE.Vector3(0, 0.0, 0.66);
      break;
    }
    case 'laser': {
      box(g, 0.06, 0.07, 0.3, body, 0, 0.03, 0.08);
      for (let i = 0; i < 3; i++) {
        const r = cyl(g, 0.04 - i * 0.005, 0.04 - i * 0.005, 0.02, glow(def.tracer, 2.2), 0, 0.03, 0.12 + i * 0.06, 12);
        r.rotation.x = Math.PI / 2;
      }
      const tip = cyl(g, 0.015, 0.025, 0.08, steel, 0, 0.03, 0.27, 10);
      tip.rotation.x = Math.PI / 2;
      grip(dark);
      muzzle = new THREE.Vector3(0, 0.03, 0.32);
      break;
    }
    case 'paint': {
      box(g, 0.05, 0.07, 0.22, body, 0, 0.03, 0.05);
      sph(g, 0.06, mat(0xffc53d, { rough: 0.3, transparent: true, opacity: 0.85 }), 0, 0.12, 0.02, 12, 10);
      const bar = cyl(g, 0.016, 0.016, 0.22, dark, 0, 0.04, 0.24, 8);
      bar.rotation.x = Math.PI / 2;
      grip(dark);
      muzzle = new THREE.Vector3(0, 0.04, 0.36);
      break;
    }
    case 'knuckles': {
      box(g, 0.09, 0.035, 0.03, body, 0, 0.02, 0.06);
      for (let i = 0; i < 4; i++) {
        const r = cyl(g, 0.016, 0.016, 0.03, body, -0.033 + i * 0.022, 0.05, 0.06, 8);
        r.rotation.x = Math.PI / 2;
      }
      muzzle = new THREE.Vector3(0, 0.03, 0.12);
      break;
    }
    case 'bat': {
      const b = cyl(g, 0.055, 0.022, 0.85, mat(def.color, { rough: 0.55 }), 0, 0, 0.4, 10);
      b.rotation.x = Math.PI / 2;
      const knob = cyl(g, 0.035, 0.035, 0.03, mat(0x2a1a12, { rough: 0.6 }), 0, 0, -0.03, 10);
      knob.rotation.x = Math.PI / 2;
      muzzle = new THREE.Vector3(0, 0, 0.82);
      break;
    }
    case 'golf': {
      const sh = cyl(g, 0.011, 0.016, 0.95, steel, 0, 0, 0.45, 8);
      sh.rotation.x = Math.PI / 2;
      box(g, 0.035, 0.04, 0.12, mat(0x17151f, { rough: 0.5 }), 0, 0, 0.0);
      box(g, 0.1, 0.05, 0.035, steel, 0.04, -0.01, 0.93);
      muzzle = new THREE.Vector3(0, 0, 0.93);
      break;
    }
    case 'katana': {
      box(g, 0.035, 0.035, 0.24, mat(0x17151f, { rough: 0.6 }), 0, 0, 0.04);
      const guard = cyl(g, 0.05, 0.05, 0.015, gold(), 0, 0, 0.17, 12);
      guard.rotation.x = Math.PI / 2;
      box(g, 0.012, 0.04, 0.75, chrome(), 0, 0.005, 0.55);
      muzzle = new THREE.Vector3(0, 0, 0.92);
      break;
    }
    case 'hammer': {
      const h = cyl(g, 0.02, 0.02, 0.8, wood, 0, 0, 0.36, 8);
      h.rotation.x = Math.PI / 2;
      box(g, 0.18, 0.1, 0.1, mat(0x5a5d66, { metal: 0.7, rough: 0.4 }), 0, 0, 0.78);
      muzzle = new THREE.Vector3(0, 0, 0.8);
      break;
    }
    case 'confetti': {
      const tube = cyl(g, 0.05, 0.065, 0.42, body, 0, 0.04, 0.15, 14);
      tube.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const band = cyl(g, 0.067, 0.067, 0.025, mat([0xffc53d, 0x2fe6ff, 0x39ff88][i], { rough: 0.4 }), 0, 0.04, 0.02 + i * 0.12, 14);
        band.rotation.x = Math.PI / 2;
      }
      grip(dark);
      muzzle = new THREE.Vector3(0, 0.04, 0.37);
      break;
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = false;
  });
  return { group: g, muzzle, spin };
}
