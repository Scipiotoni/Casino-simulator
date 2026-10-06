import * as THREE from 'three';
import { mat, glow, gold, chrome } from '../../render/materials';
import { type GunDef, type GunMods, GUN_SKINS, gunTakes } from '../../game/guns';
import { canvasTexture, makeCanvas, seeded } from '../../render/textures';
import { box, cyl, sph } from './common';

/**
 * A gun model built along +z (barrel forward), grip down (-y), origin at the grip. Returns the
 * group and the muzzle point (in the group's frame).
 */
/** What you look through when aiming: none (iron sights), a red dot, a holographic sight or a scope. */
export type Optic = 'iron' | 'reddot' | 'holo' | 'scope';

export interface BuiltGun {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  spin?: THREE.Object3D;
  /** The optic on the gun, and the point your eye lines up with when aiming (group frame). */
  optic: Optic;
  sight?: THREE.Vector3;
  /** A scope's rear lens (shows the magnified view). */
  lens?: THREE.Mesh;
  /** Parts of the gun in the line of sight through the optic (hidden while you aim through it). */
  blockers?: THREE.Object3D[];
}

export function buildGun(def: GunDef, mods?: GunMods | null, beam = false): BuiltGun {
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
  const optics: { optic: Optic; sight?: THREE.Vector3; lens?: THREE.Mesh } = { optic: 'iron' };
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
    // A hollow tube with clear glass at both ends: you really see through it.
    scopeTube(g, r, len, 0, y, z);
    for (const sz of [-1, 1]) {
      const bell = scopeTube(g, r * 1.2, 0.04, 0, y, z + sz * (len / 2 + 0.015), r * 1.35, r);
      bell.rotation.x = Math.PI / 2 * (sz > 0 ? 1 : -1);
      const lens = scopeGlass(g, r * 1.15, 0, y, z + sz * (len / 2 + 0.034));
      if (sz < 0) Object.assign(optics, { optic: 'scope', sight: new THREE.Vector3(0, y, z + sz * (len / 2 + 0.034)), lens });
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
        // Red-dot sight: a short open tube with clear glass.
        B(black, 0.026, 0.012, 0.04, 0, 0.078, 0.05).userData.optic = true;
        scopeTube(g, 0.017, 0.045, 0, 0.1, 0.05);
        const lens = scopeGlass(g, 0.016, 0, 0.1, 0.07);
        Object.assign(optics, { optic: 'reddot', sight: new THREE.Vector3(0, 0.1, 0.07), lens });
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
    case 'launcher': {
      // Grenade launcher: a fat revolving cylinder, a short wide barrel, folding stock.
      barrel(0.032, 0.26, 0.05, 0.17, dark, 16);
      const cylr = cyl(g, 0.058, 0.058, 0.14, body, 0, 0.045, 0.08, 14);
      cylr.rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const ch = cyl(g, 0.016, 0.016, 0.142, black, Math.cos(a) * 0.036, 0.045 + Math.sin(a) * 0.036, 0.08, 8);
        ch.rotation.x = Math.PI / 2;
      }
      B(body, 0.04, 0.05, 0.12, 0, 0.03, -0.04);
      B(polymer, 0.03, 0.06, 0.06, 0, -0.02, 0.26); // fore grip
      rail(0.105, 0.0, 0.16);
      grip(polymer, null, -0.06, -0.06, 0.11, 0.3);
      trigger(-0.01, -0.012);
      B(steel, 0.008, 0.008, 0.2, -0.022, 0.03, -0.18);
      B(steel, 0.008, 0.008, 0.2, 0.022, 0.03, -0.18);
      B(polymer, 0.05, 0.07, 0.02, 0, 0.02, -0.28);
      muzzle = new THREE.Vector3(0, 0.05, 0.44);
      break;
    }
    case 'rocket': {
      // Shoulder-fired tube with a rocket poking out the front.
      const tube = cyl(g, 0.055, 0.055, 0.95, body, 0, 0.06, 0.05, 16);
      tube.rotation.x = Math.PI / 2;
      for (const z of [-0.4, 0.5]) {
        const ring = cyl(g, 0.064, 0.064, 0.05, dark, 0, 0.06, z, 16);
        ring.rotation.x = Math.PI / 2;
      }
      const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 12), mat(0x6b7a3a, { rough: 0.5 }));
      warhead.rotation.x = Math.PI / 2;
      warhead.position.set(0, 0.06, 0.6);
      g.add(warhead);
      B(dark, 0.04, 0.05, 0.12, 0, 0.12, 0.08); // sight box
      sph(g, 0.006, glow(0xff4d4d, 2), 0, 0.15, 0.13, 6, 4);
      B(polymer, 0.035, 0.1, 0.05, 0, -0.04, 0.0, 0.2);
      B(polymer, 0.035, 0.09, 0.05, 0, -0.035, 0.22, 0.1);
      trigger(0.03, -0.01);
      muzzle = new THREE.Vector3(0, 0.06, 0.68);
      break;
    }
    case 'railgun': {
      // Twin rails with glowing coils between them.
      B(body, 0.06, 0.08, 0.28, 0, 0.035, 0.0);
      for (const sx of [-1, 1]) B(steel, 0.012, 0.03, 0.6, sx * 0.03, 0.05, 0.42);
      for (let i = 0; i < 6; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), glow(def.tracer, 2.2));
        coil.position.set(0, 0.05, 0.18 + i * 0.08);
        g.add(coil);
      }
      const core = cyl(g, 0.006, 0.006, 0.6, glow(def.tracer, 3), 0, 0.05, 0.42, 6);
      core.rotation.x = Math.PI / 2;
      scope(0.11, 0.02, 0.18, 0.018);
      const cell = cyl(g, 0.02, 0.02, 0.1, glow(0x39ff88, 1.6), 0, -0.02, -0.08, 10);
      cell.rotation.x = Math.PI / 2;
      grip(polymer, null, -0.06, -0.05, 0.11, 0.3);
      trigger(0.0, -0.012);
      B(body, 0.04, 0.07, 0.2, 0, 0.012, -0.22);
      muzzle = new THREE.Vector3(0, 0.05, 0.74);
      break;
    }
    case 'flamer': {
      // Fuel tanks under a long nozzle with a pilot light.
      for (const sx of [-1, 1]) {
        const tank = cyl(g, 0.035, 0.035, 0.24, body, sx * 0.04, -0.02, 0.02, 12);
        tank.rotation.x = Math.PI / 2;
      }
      B(dark, 0.06, 0.05, 0.3, 0, 0.04, 0.1);
      barrel(0.018, 0.34, 0.045, 0.24, steel);
      const nozzle = cyl(g, 0.03, 0.022, 0.06, dark, 0, 0.045, 0.6, 12);
      nozzle.rotation.x = Math.PI / 2;
      sph(g, 0.01, glow(0x4aa8ff, 3), 0, 0.02, 0.62, 6, 4); // pilot light
      const hose = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 12, Math.PI), black);
      hose.rotation.set(0, Math.PI / 2, 0);
      hose.position.set(0, 0.0, -0.06);
      g.add(hose);
      grip(polymer, null, -0.06, -0.04, 0.11, 0.3);
      B(polymer, 0.03, 0.08, 0.04, 0, -0.01, 0.3);
      trigger(0.0, -0.012);
      muzzle = new THREE.Vector3(0, 0.045, 0.64);
      break;
    }
    case 'fists': {
      // Taped-up knuckles: there's nothing in your hand but your fist.
      const tape = mat(0xf1ece2, { rough: 0.9 });
      B(tape, 0.075, 0.05, 0.06, 0, 0.0, 0.03);
      B(tape, 0.08, 0.018, 0.064, 0, 0.012, 0.03);
      muzzle = new THREE.Vector3(0, 0.0, 0.08);
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
  if (mods) {
    applySkin(g, mods.skin, new Set<THREE.Material>([body, polymer, wood]), new Set<THREE.Material>([dark, woodDark]));
    muzzle = addAttachments(g, def, mods, muzzle, beam, optics);
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = false;
  });
  // The lab's prototypes: glowing power lines down both sides.
  if (def.secret && !beam) {
    const bb = new THREE.Box3().setFromObject(g);
    const len = (bb.max.z - bb.min.z) * 0.62;
    const y = bb.min.y + (bb.max.y - bb.min.y) * 0.58;
    const zc = (bb.max.z + bb.min.z) / 2;
    for (const sx of [-1, 1]) box(g, 0.006, 0.012, len, glow(def.tracer, 2.4), sx * (bb.max.x + 0.002), y, zc);
  }
  return { group: g, muzzle, spin, ...optics, blockers: optics.sight ? sightBlockers(g, optics.sight) : [] };
}

// ------------------------------------------------------------------ scopes

const scopeBody = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
const scopeGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xbfe8ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
});

/**
 * Everything (but the optic itself) the line of sight through the optic passes through:
 * front sight posts, a second sight, rails, a scope behind a red dot… Hidden while aiming.
 */
function sightBlockers(g: THREE.Group, sight: THREE.Vector3): THREE.Object3D[] {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const bb = new THREE.Box3();
  const out: THREE.Object3D[] = [];
  const r = 0.018;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.optic) return;
    m.geometry.computeBoundingBox();
    bb.copy(m.geometry.boundingBox!).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (bb.max.z < sight.z - 0.35) return;
    if (bb.min.x > r || bb.max.x < -r || bb.min.y > sight.y + r || bb.max.y < sight.y - r) return;
    out.push(m);
  });
  return out;
}

/** An open-ended tube along z (you look down the inside of it). */
function scopeTube(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, rTop = r, rBot = r): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 16, 1, true), scopeBody);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.userData.optic = true;
  g.add(m);
  return m;
}

/** A disc of clear glass across a scope (facing along z). */
function scopeGlass(g: THREE.Object3D, r: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), scopeGlassMat);
  m.position.set(x, y, z);
  m.renderOrder = 2;
  m.userData.optic = true;
  g.add(m);
  return m;
}

// ------------------------------------------------------------------ skins and attachments

const patternCache = new Map<string, THREE.Texture>();
function patternTexture(kind: string): THREE.Texture {
  const hit = patternCache.get(kind);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(64, 64);
  const rnd = seeded(kind.length * 31);
  if (kind === 'camo') {
    ctx.fillStyle = '#5a6a3a';
    ctx.fillRect(0, 0, 64, 64);
    for (const c of ['#2f3a22', '#7a6a3a', '#3e4a2a', '#1f2616']) {
      ctx.fillStyle = c;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(rnd() * 64, rnd() * 64, 4 + rnd() * 10, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'digital') {
    const cols = ['#c8a878', '#9a7a4a', '#e2c89a', '#7a5a3a'];
    for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.fillRect(x, y, 4, 4);
    }
  } else if (kind === 'carbon') {
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
      const g2 = ctx.createLinearGradient(x, y, x + 8, y + 8);
      const flip = ((x + y) / 8) % 2 === 0;
      g2.addColorStop(0, flip ? '#3a3a42' : '#18181c');
      g2.addColorStop(1, flip ? '#18181c' : '#3a3a42');
      ctx.fillStyle = g2;
      ctx.fillRect(x, y, 8, 8);
    }
  } else if (kind === 'tiger') {
    ctx.fillStyle = '#ff8a1f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#17151f';
    for (let i = 0; i < 7; i++) {
      const x = i * 10 + rnd() * 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + 8, 32, x - 2, 64);
      ctx.lineTo(x + 3, 64);
      ctx.quadraticCurveTo(x + 12, 32, x + 4, 0);
      ctx.fill();
    }
  } else if (kind === 'galaxy') {
    const gr = ctx.createLinearGradient(0, 0, 64, 64);
    gr.addColorStop(0, '#1a0d33');
    gr.addColorStop(0.5, '#4a1a7a');
    gr.addColorStop(1, '#0d2a4a');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`;
      ctx.fillRect(rnd() * 64, rnd() * 64, 1, 1);
    }
  }
  const t = canvasTexture(canvas, true);
  t.repeat.set(4, 4);
  patternCache.set(kind, t);
  return t;
}

const skinMats = new Map<string, [THREE.Material, THREE.Material]>();
function skinMaterials(id: string): [THREE.Material, THREE.Material] | null {
  const sk = GUN_SKINS.find((s) => s.id === id);
  if (!sk || sk.id === 'stock') return null;
  const hit = skinMats.get(id);
  if (hit) return hit;
  // Shiny metals read dark under the dim close-up lighting of the gun in your hands:
  // keep some of the colour diffuse and give it a faint glow of its own.
  const shiny = sk.metal > 0.8;
  const main = new THREE.MeshStandardMaterial({
    color: sk.color ?? 0xffffff, metalness: shiny ? 0.55 : sk.metal, roughness: shiny ? Math.max(0.22, sk.rough) : sk.rough,
    map: sk.pattern ? patternTexture(sk.pattern) : null,
    emissive: sk.glow ? (sk.color ?? 0xffffff) : shiny ? (sk.color ?? 0xffffff) : 0x000000,
    emissiveIntensity: sk.glow ? (sk.id === 'diamond' ? 0.3 : 0.9) : shiny ? 0.12 : 0,
  });
  const accent = new THREE.MeshStandardMaterial({ color: sk.accent ?? 0x17151f, metalness: Math.min(1, sk.metal + 0.1), roughness: Math.max(0.1, sk.rough) });
  const pair: [THREE.Material, THREE.Material] = [main, accent];
  skinMats.set(id, pair);
  return pair;
}

function applySkin(g: THREE.Group, skin: string, mainSet: Set<THREE.Material>, accentSet: Set<THREE.Material>): void {
  const mats = skinMaterials(skin);
  if (!mats) return;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const cur = m.material as THREE.Material;
    if (mainSet.has(cur)) m.material = mats[0];
    else if (accentSet.has(cur)) m.material = mats[1];
  });
}

/** Sights, muzzle devices, magazines, a laser and a charm, placed from the gun's own shape. */
function addAttachments(g: THREE.Group, def: GunDef, mods: GunMods, muzzle: THREE.Vector3, beam: boolean, optics: { optic: Optic; sight?: THREE.Vector3; lens?: THREE.Mesh }): THREE.Vector3 {
  const takes = gunTakes(def);
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g);
  const black = mat(0x0c0c10, { rough: 0.5, metal: 0.4 });
  const steel = chrome();
  const len = Math.max(0.15, bb.max.z - bb.min.z);
  const top = bb.max.y;
  const out = muzzle.clone();
  const tube = (r: number, l: number, m: THREE.Material, x: number, y: number, z: number, seg = 12) => {
    const c = cyl(g, r, r, l, m, x, y, z, seg);
    c.rotation.x = Math.PI / 2;
    return c;
  };
  if (takes.sight && mods.sight !== 'iron') {
    const z = bb.min.z + len * 0.42;
    if (mods.sight === 'reddot') {
      box(g, 0.026, 0.008, 0.04, black, 0, top + 0.004, z).userData.optic = true;
      scopeTube(g, 0.016, 0.03, 0, top + 0.024, z);
      const lens = scopeGlass(g, 0.015, 0, top + 0.024, z + 0.012);
      Object.assign(optics, { optic: 'reddot', sight: new THREE.Vector3(0, top + 0.024, z + 0.012), lens });
    } else if (mods.sight === 'holo') {
      // An open window frame: you look straight through it.
      box(g, 0.03, 0.01, 0.06, black, 0, top + 0.005, z).userData.optic = true;
      for (const sx of [-1, 1]) box(g, 0.005, 0.04, 0.05, black, sx * 0.022, top + 0.03, z).userData.optic = true;
      box(g, 0.05, 0.005, 0.05, black, 0, top + 0.054, z).userData.optic = true;
      const lens = scopeGlass(g, 0.015, 0, top + 0.03, z + 0.02);
      Object.assign(optics, { optic: 'holo', sight: new THREE.Vector3(0, top + 0.03, z + 0.02), lens });
    } else {
      const sl = Math.min(0.22, len * 0.55);
      for (const sz of [-0.3, 0.3]) box(g, 0.02, 0.022, 0.018, black, 0, top + 0.011, z + sz * sl);
      scopeTube(g, 0.02, sl, 0, top + 0.04, z);
      for (const sz of [-1, 1]) {
        scopeTube(g, 0.027, 0.04, 0, top + 0.04, z + sz * (sl / 2 + 0.015));
        const lens = scopeGlass(g, 0.024, 0, top + 0.04, z + sz * (sl / 2 + 0.034));
        if (sz < 0) Object.assign(optics, { optic: 'scope', sight: new THREE.Vector3(0, top + 0.04, z + sz * (sl / 2 + 0.034)), lens });
      }
      cyl(g, 0.01, 0.01, 0.02, black, 0, top + 0.068, z, 10);
    }
  }
  if (takes.muzzle && mods.muzzle !== 'none') {
    if (mods.muzzle === 'suppressor') {
      tube(0.02, 0.16, black, out.x, out.y, out.z + 0.08, 14);
      tube(0.022, 0.01, steel, out.x, out.y, out.z + 0.005, 14);
      out.z += 0.16;
    } else {
      tube(0.016, 0.05, steel, out.x, out.y, out.z + 0.025, 12);
      for (const sx of [-1, 1]) box(g, 0.004, 0.012, 0.03, black, out.x + sx * 0.016, out.y + 0.004, out.z + 0.025);
      out.z += 0.05;
    }
  }
  if (takes.mag && mods.mag !== 'standard') {
    const z = Math.max(bb.min.z + 0.04, muzzle.z * 0.38);
    const y = bb.min.y + 0.02;
    if (mods.mag === 'extended') box(g, 0.026, 0.12, 0.036, black, 0, y - 0.05, z).rotation.x = -0.1;
    else {
      const d = cyl(g, 0.06, 0.06, 0.04, black, 0, y - 0.05, z, 18);
      d.rotation.z = Math.PI / 2;
      cyl(g, 0.02, 0.02, 0.045, steel, 0, y - 0.05, z, 10).rotation.z = Math.PI / 2;
    }
  }
  if (takes.laser && mods.laser) {
    const z = def.melee ? 0.1 : muzzle.z * 0.72;
    const y = def.melee ? 0.03 : muzzle.y - 0.035;
    box(g, 0.02, 0.018, 0.05, black, 0, y, z);
    const tip = sph(g, 0.006, glow(0xff2020, 4), 0, y, z + 0.027, 8, 6);
    void tip;
    if (beam) {
      const L = 9;
      const b = cyl(g, 0.0025, 0.0025, L, new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.45, depthWrite: false }), 0, y, z + 0.03 + L / 2, 5);
      b.rotation.x = Math.PI / 2;
    }
  }
  if (mods.charm !== 'none') {
    // Hangs off the back of the gun (the pommel on a melee weapon).
    const z = bb.min.z + (def.melee ? 0.01 : 0.05);
    const y = def.melee ? -0.02 : muzzle.y - 0.04;
    cyl(g, 0.002, 0.002, 0.04, mat(0x9aa0ab, { metal: 0.8 }), 0.022, y - 0.02, z, 4);
    const cy = y - 0.045;
    if (mods.charm === 'dice') box(g, 0.022, 0.022, 0.022, mat(0xf4f1ea, { rough: 0.4 }), 0.022, cy, z).rotation.set(0.5, 0.6, 0);
    else if (mods.charm === 'chip') tube(0.016, 0.006, mat(0xc8102e, { rough: 0.5 }), 0.022, cy, z, 14).rotation.set(0, 0, 0);
    else if (mods.charm === 'cherry') {
      sph(g, 0.01, mat(0xd21f3c, { rough: 0.3 }), 0.016, cy, z, 10, 8);
      sph(g, 0.01, mat(0xd21f3c, { rough: 0.3 }), 0.03, cy - 0.004, z, 10, 8);
    } else if (mods.charm === 'star') sph(g, 0.013, gold(), 0.022, cy, z, 5, 2);
    else sph(g, 0.013, mat(0xf4f1ea, { rough: 0.6 }), 0.022, cy, z, 10, 8);
  }
  return out;
}
