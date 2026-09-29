import * as THREE from 'three';
import { mat, glow, gold, chrome, blackGloss } from '../../render/materials';
import { REEL_SYMBOLS, canvasTexture, drawNeonText, labelTexture, makeCanvas, reelTexture, roundRect } from '../../render/textures';
import { easeOutBack, easeInOutQuad, TAU } from '../../core/math';
import { formatMoney } from '../../core/math';
import type { ItemModel, ModelCtx, ModelEvent } from '../types';
import { type BuildOpts, Dyn, add, bake, box, cyl, disposeTree, plane, rbox, shadeHex, sph, stool } from './common';

const REEL_N = REEL_SYMBOLS.length;
const reelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.19, 28, 1, true);

interface Reel {
  mesh: THREE.Object3D;
  phi: number;
  spinning: boolean;
  stopAt: number;
  easeFrom: number;
  easeTo: number;
  easeT: number;
  easing: boolean;
}

interface Cabinet {
  reels: Reel[];
  lever: THREE.Group;
  leverT: number;
  candle: THREE.Mesh;
  candleMat: THREE.MeshStandardMaterial;
  topMat: THREE.MeshStandardMaterial;
  screenMat: THREE.MeshStandardMaterial;
  flashT: number;
  flashBig: boolean;
  symbols: [number, number, number] | null;
  spinT: number;
  duration: number;
}

function symbolAngle(k: number): number {
  return -((k + 0.5) / REEL_N) * TAU;
}

/** One slot cabinet (machine + stool) centred at local x, machine in the back tile. */
function buildCabinet(root: THREE.Group, dyn: Dyn, x: number, o: BuildOpts, topper: THREE.Texture | null): Cabinet {
  const body = mat(o.color, { rough: 0.32, metal: 0.25 });
  const dark = mat(shadeHex(o.color, 0.45), { rough: 0.4, metal: 0.2 });
  const chromeM = chrome();
  const trimM = o.level >= 3 || o.params.trim ? gold() : chromeM;
  const zc = -0.52;
  // Plinth
  box(root, 0.9, 0.08, 0.82, o.level >= 2 ? gold() : blackGloss(), x, 0.04, zc);
  // Lower cabinet
  rbox(root, 0.84, 0.92, 0.72, 0.05, body, x, 0.54, zc - 0.02);
  box(root, 0.86, 0.035, 0.74, trimM, x, 1.0, zc - 0.02);
  // Belly glass with glow panel
  const bellyMat = glow(shadeHex(o.color, 1.35) | 0x202020, 0.55);
  plane(root, 0.64, 0.3, bellyMat, x, 0.52, zc + 0.345);
  // Coin tray
  box(root, 0.52, 0.07, 0.14, chromeM, x, 0.25, zc + 0.39);
  // Button deck
  const deck = box(root, 0.84, 0.07, 0.3, dark, x, 1.07, zc + 0.24);
  deck.rotation.x = -0.32;
  const btnMat = glow(0xffd23f, 1.6);
  for (let i = 0; i < 3; i++) {
    const b = cyl(root, 0.045, 0.045, 0.03, btnMat, x - 0.2 + i * 0.2, 1.12, zc + 0.26, 12);
    b.rotation.x = -0.32;
  }
  // Screen housing: back block + frame around a recessed reel window
  box(root, 0.84, 0.8, 0.34, body, x, 1.47, zc - 0.2);
  box(root, 0.84, 0.17, 0.3, body, x, 1.785, zc + 0.02);
  box(root, 0.84, 0.17, 0.3, body, x, 1.155, zc + 0.02);
  box(root, 0.1, 0.46, 0.3, body, x - 0.37, 1.47, zc + 0.02);
  box(root, 0.1, 0.46, 0.3, body, x + 0.37, 1.47, zc + 0.02);
  box(root, 0.86, 0.03, 0.31, trimM, x, 1.875, zc + 0.02);
  box(root, 0.86, 0.03, 0.31, trimM, x, 1.07, zc + 0.02);
  const screenMat = mat(0x0b0714, { rough: 0.3, emissive: 0x221133, emissiveIntensity: 1 });
  plane(root, 0.66, 0.46, screenMat, x, 1.47, zc - 0.03);

  // Reels
  const reelTex = reelTexture();
  const reelMat = mat(0xffffff, { map: reelTex, rough: 0.5, emissive: 0xffffff, emissiveMap: reelTex, emissiveIntensity: 0.35 });
  const reels: Reel[] = [];
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();
    holder.position.set(x - 0.215 + i * 0.215, 1.47, zc - 0.13);
    holder.rotation.z = Math.PI / 2;
    const drum = new THREE.Mesh(reelGeo, reelMat);
    drum.userData.sharedGeo = true;
    holder.add(drum);
    root.add(holder);
    dyn.keep(holder);
    const start = Math.floor(Math.random() * REEL_N);
    drum.rotation.y = symbolAngle(start);
    reels.push({ mesh: drum, phi: drum.rotation.y, spinning: false, stopAt: 0, easeFrom: 0, easeTo: 0, easeT: 0, easing: false });
  }
  // Payline
  box(root, 0.7, 0.012, 0.01, glow(0xff2d55, 2), x, 1.47, zc + 0.085);

  // Topper
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: topper, emissive: 0xffffff, emissiveMap: topper, emissiveIntensity: 1.1, roughness: 0.4,
  });
  rbox(root, 0.84, 0.32, 0.4, 0.06, dark, x, 2.05, zc - 0.12);
  if (topper) plane(root, 0.78, 0.26, topMat, x, 2.05, zc + 0.085);

  // Candle / deco on top
  const candleMat = new THREE.MeshStandardMaterial({ color: 0x3a0a14, emissive: 0xff3d5a, emissiveIntensity: 1.2, roughness: 0.3 });
  const deco = String(o.params.deco ?? 'candle');
  let candle: THREE.Mesh;
  if (deco === 'diamond') {
    candle = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), candleMat);
    candle.scale.set(1, 1.3, 1);
    add(root, candle, x, 2.42, zc - 0.12);
    candleMat.emissive.setHex(0x7ff3ff);
    candleMat.color.setHex(0x0a3040);
  } else if (deco === 'cherry') {
    candle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), candleMat);
    add(root, candle, x, 2.32, zc - 0.12);
    candleMat.emissive.setHex(0xff2d55);
    cyl(root, 0.012, 0.012, 0.16, mat(0x2f8f2f), x + 0.03, 2.44, zc - 0.12, 6).rotation.z = -0.4;
  } else {
    candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.18, 14), candleMat);
    add(root, candle, x, 2.3, zc - 0.12);
    cyl(root, 0.08, 0.08, 0.03, chromeM, x, 2.21, zc - 0.12, 14);
  }
  dyn.keep(candle);

  // Lever
  // Lever pivot hub is static; the arm + knob rotate together.
  cyl(root, 0.05, 0.05, 0.1, chromeM, x + 0.45, 1.2, zc - 0.05, 10).rotation.z = Math.PI / 2;
  const lever = new THREE.Group();
  lever.position.set(x + 0.45, 1.2, zc - 0.05);
  cyl(lever, 0.022, 0.022, 0.42, chromeM, 0.04, 0.21, 0, 8);
  sph(lever, 0.065, mat(0xe8132d, { rough: 0.25, metal: 0.1 }), 0.04, 0.44, 0);
  root.add(lever);
  dyn.keep(lever);

  // Stool
  stool(root, x, 0.42, 0x8a1030);

  return {
    reels, lever, leverT: 0, candle, candleMat, topMat, screenMat, flashT: 0, flashBig: false, symbols: null, spinT: 0, duration: 3,
  };
}

function startSpin(c: Cabinet, symbols: [number, number, number], duration: number, t: number): void {
  c.symbols = symbols;
  c.duration = duration;
  c.spinT = 0;
  c.leverT = 0.001;
  const stops = [0.42, 0.6, 0.78];
  c.reels.forEach((r, i) => {
    r.spinning = true;
    r.easing = false;
    r.stopAt = t + duration * stops[i];
  });
}

function updateCabinet(c: Cabinet, dt: number, ctx: ModelCtx): void {
  for (let i = 0; i < c.reels.length; i++) {
    const r = c.reels[i];
    if (r.spinning) {
      r.phi -= dt * 19;
      if (ctx.t >= r.stopAt && c.symbols) {
        r.spinning = false;
        r.easing = true;
        r.easeT = 0;
        r.easeFrom = r.phi;
        const base = symbolAngle(c.symbols[i]);
        const t0 = r.phi - 2.2;
        r.easeTo = base + TAU * Math.floor((t0 - base) / TAU);
      }
    } else if (r.easing) {
      r.easeT += dt / 0.42;
      const u = Math.min(1, r.easeT);
      r.phi = r.easeFrom + (r.easeTo - r.easeFrom) * easeOutBack(u);
      if (u >= 1) {
        r.easing = false;
        r.phi = r.easeTo % TAU;
      }
    }
    if (ctx.broken) r.mesh.rotation.y = r.phi + Math.sin(ctx.t * 40 + i) * 0.02;
    else r.mesh.rotation.y = r.phi;
  }
  if (c.leverT > 0) {
    c.leverT += dt;
    const u = c.leverT / 0.5;
    c.lever.rotation.x = u < 0.4 ? -(u / 0.4) * 1.1 : -1.1 * (1 - easeInOutQuad((u - 0.4) / 0.6));
    if (u >= 1) {
      c.leverT = 0;
      c.lever.rotation.x = 0;
    }
  }
  if (c.flashT > 0) {
    c.flashT -= dt;
    const on = Math.floor(ctx.t * (c.flashBig ? 14 : 9)) % 2 === 0;
    c.candleMat.emissiveIntensity = on ? 4 : 0.6;
    c.topMat.emissiveIntensity = on ? 2.2 : 1.1;
  } else {
    const idle = ctx.broken ? 0.05 : ctx.busy ? 1.4 : 0.9 + Math.sin(ctx.t * 2 + c.reels[0].phi) * 0.3;
    c.candleMat.emissiveIntensity = idle;
    c.topMat.emissiveIntensity = ctx.broken ? 0.08 : 1.1;
  }
  c.screenMat.emissiveIntensity = ctx.broken ? 0 : 1;
  c.candle.rotation.y += dt * (c.flashT > 0 ? 6 : 0.6);
}

function slotEvent(cabs: Cabinet[], ev: ModelEvent, now: () => number): void {
  if (ev.type === 'start' && ev.outcome.visual.kind === 'slot') {
    const c = cabs[ev.seat] ?? cabs[0];
    startSpin(c, ev.outcome.visual.symbols, ev.duration, now());
  } else if (ev.type === 'result') {
    const c = cabs[ev.seat] ?? cabs[0];
    if (ev.outcome.tier === 'win' || ev.outcome.tier === 'big' || ev.outcome.tier === 'jackpot') {
      c.flashT = ev.outcome.tier === 'win' ? 1.6 : 4.5;
      c.flashBig = ev.outcome.tier !== 'win';
    }
  }
}

export function slotModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const topper = labelTexture(String(o.params.sign ?? o.params.topper ?? 'SLOTS'), {
    w: 320, h: 96, bg: '#140a22', color: String(o.params.topColor ?? '#ffd24a'), border: 'rgba(255,210,110,0.7)',
  });
  const cab = buildCabinet(root, dyn, 0, o, topper);
  bake(root, dyn);
  let t = 0;
  return {
    root,
    height: 2.6,
    update(dt, ctx) {
      t = ctx.t;
      updateCabinet(cab, dt, ctx);
    },
    event(ev) {
      slotEvent([cab], ev, () => t);
    },
    dispose() {
      disposeTree(root);
      cab.candleMat.dispose();
      cab.topMat.dispose();
      cab.screenMat.dispose();
    },
  };
}

export function megaSlotModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const cabs = [buildCabinet(root, dyn, -0.5, o, null), buildCabinet(root, dyn, 0.5, o, null)];
  // Big arched jackpot display spanning both cabinets
  const { canvas, ctx: c2d } = makeCanvas(512, 200);
  const tex = canvasTexture(canvas);
  const dispMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.2, roughness: 0.4 });
  const frame = gold();
  rbox(root, 1.95, 0.72, 0.36, 0.1, mat(shadeHex(o.color, 0.5), { rough: 0.35, metal: 0.3 }), 0, 2.45, -0.62);
  box(root, 2.0, 0.05, 0.4, frame, 0, 2.1, -0.62);
  box(root, 2.0, 0.05, 0.4, frame, 0, 2.8, -0.62);
  plane(root, 1.82, 0.62, dispMat, 0, 2.45, -0.435);
  const crown = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = sph(crown, 0.07, glow(i % 2 ? 0xff3fa4 : 0xffd23f, 2), -0.9 + i * 0.3, 0, 0, 10, 8);
    s.userData.sharedGeo = false;
  }
  crown.position.set(0, 2.9, -0.62);
  root.add(crown);
  dyn.keep(crown);
  bake(root, dyn);
  let lastDrawn = -1;
  let t = 0;
  const draw = (pot: number) => {
    const W = canvas.width;
    const H = canvas.height;
    c2d.clearRect(0, 0, W, H);
    const g = c2d.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a0845');
    g.addColorStop(1, '#0c0418');
    c2d.fillStyle = g;
    roundRect(c2d, 0, 0, W, H, 24);
    c2d.fill();
    drawNeonText(c2d, String(o.params.sign ?? 'MEGA JACKPOT'), W / 2, 52, W - 60, 56, 'Bungee, "Arial Black", sans-serif', '#ff3fa4');
    drawNeonText(c2d, formatMoney(pot), W / 2, 136, W - 60, 86, 'Bungee, "Arial Black", sans-serif', '#ffd24a');
    tex.needsUpdate = true;
  };
  draw(5000);
  return {
    root,
    height: 3.2,
    update(dt, ctx) {
      t = ctx.t;
      cabs.forEach((c) => updateCabinet(c, dt, ctx));
      const pot = Math.floor(ctx.jackpotPot);
      if (pot !== lastDrawn && Math.floor(ctx.t * 4) % 2 === 0) {
        lastDrawn = pot;
        draw(pot);
      }
      crown.children.forEach((b, i) => {
        const m = (b as THREE.Mesh).scale;
        const s = 0.8 + 0.4 * Math.max(0, Math.sin(ctx.t * 6 + i));
        m.setScalar(s);
      });
      dispMat.emissiveIntensity = ctx.broken ? 0.1 : 1.1 + Math.sin(ctx.t * 3) * 0.15;
    },
    event(ev) {
      slotEvent(cabs, ev, () => t);
    },
    dispose() {
      disposeTree(root);
      tex.dispose();
      dispMat.dispose();
      cabs.forEach((c) => {
        c.candleMat.dispose();
        c.topMat.dispose();
        c.screenMat.dispose();
      });
    },
  };
}

// ------------------------------------------------------------------ claw crane

export function clawModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const body = mat(o.color, { rough: 0.35, metal: 0.2 });
  const zc = -0.5;
  rbox(root, 0.88, 0.62, 0.82, 0.05, body, 0, 0.31, zc);
  box(root, 0.9, 0.04, 0.84, gold(), 0, 0.63, zc);
  // Glass cabinet frame
  const post = chrome();
  for (const px of [-0.42, 0.42]) for (const pz of [-0.39, 0.39]) box(root, 0.045, 1.12, 0.045, post, px, 1.2, zc + pz);
  const glass = mat(0xbfe9ff, { transparent: true, opacity: 0.16, rough: 0.05, depthWrite: false });
  plane(root, 0.84, 1.1, glass, 0, 1.2, zc + 0.4);
  const side = plane(root, 0.78, 1.1, glass, -0.42, 1.2, zc);
  side.rotation.y = Math.PI / 2;
  const side2 = plane(root, 0.78, 1.1, glass, 0.42, 1.2, zc);
  side2.rotation.y = -Math.PI / 2;
  box(root, 0.84, 1.1, 0.02, mat(shadeHex(o.color, 0.4)), 0, 1.2, zc - 0.39);
  rbox(root, 0.9, 0.28, 0.84, 0.05, body, 0, 1.9, zc);
  const sign = labelTexture(String(o.params.sign ?? 'CLAW'), { w: 256, h: 80, bg: '#1a0b2b', color: '#7ff3ff', border: 'rgba(255,255,255,0.4)' });
  plane(root, 0.72, 0.22, new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 1.1 }), 0, 1.9, zc + 0.425);
  // Joystick + button
  cyl(root, 0.012, 0.012, 0.12, blackGloss(), -0.15, 0.7, zc + 0.3, 6);
  sph(root, 0.035, mat(0xe8132d, { rough: 0.3 }), -0.15, 0.77, zc + 0.3);
  cyl(root, 0.04, 0.04, 0.03, glow(0x3ddc84, 1.8), 0.15, 0.66, zc + 0.3, 12);
  // Chute
  box(root, 0.22, 0.26, 0.04, mat(0x0b0714), 0.26, 0.36, zc + 0.412);
  // Plush pile
  const plushCols = [0xff6fb5, 0xffd23f, 0x7ff3ff, 0x9b59ff, 0x3ddc84, 0xff8a1f, 0xf4f1ea];
  const plushGeo = new THREE.SphereGeometry(0.075, 12, 10);
  const earGeo = new THREE.SphereGeometry(0.028, 8, 6);
  const plushies: THREE.Group[] = [];
  for (let i = 0; i < 11; i++) {
    const g = new THREE.Group();
    const m = mat(plushCols[i % plushCols.length], { rough: 0.9 });
    const b = new THREE.Mesh(plushGeo, m);
    b.userData.sharedGeo = true;
    g.add(b);
    const e1 = new THREE.Mesh(earGeo, m);
    e1.position.set(-0.05, 0.06, 0);
    e1.userData.sharedGeo = true;
    const e2 = e1.clone();
    e2.position.x = 0.05;
    g.add(e1, e2);
    g.position.set(-0.3 + (i % 4) * 0.19 + (Math.random() - 0.5) * 0.06, 0.72 + Math.floor(i / 4) * 0.08, zc - 0.25 + ((i * 7) % 5) * 0.11);
    g.rotation.set(Math.random(), Math.random() * 6, Math.random() * 0.5);
    root.add(g);
    dyn.keep(g);
    plushies.push(g);
  }
  // Claw assembly
  const claw = new THREE.Group();
  const rod = cyl(claw, 0.01, 0.01, 1, chrome(), 0, 0.5, 0, 6);
  cyl(claw, 0.045, 0.05, 0.06, chrome(), 0, 0, 0, 10);
  const prongs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const pr = new THREE.Group();
    const p = box(pr, 0.015, 0.12, 0.015, chrome(), 0, -0.06, 0);
    pr.rotation.y = (i / 3) * TAU;
    pr.position.y = -0.02;
    claw.add(pr);
    prongs.push(p);
  }
  claw.position.set(0.25, 1.6, zc + 0.25);
  root.add(claw);
  dyn.keep(claw);
  bake(root, dyn);

  let t0 = -1;
  let dur = 6;
  let win = false;
  let grabbed: THREE.Group | null = null;
  const home = new THREE.Vector3(0.25, 1.6, zc + 0.25);
  const target = new THREE.Vector3();
  let t = 0;
  return {
    root,
    height: 2.3,
    update(dt, ctx) {
      t = ctx.t;
      if (t0 < 0) {
        claw.position.x = home.x + Math.sin(ctx.t * 0.7) * 0.02;
        rod.scale.y = 1;
        return;
      }
      const u = (ctx.t - t0) / dur;
      if (u >= 1) {
        t0 = -1;
        claw.position.copy(home);
        if (grabbed) {
          grabbed.visible = true;
          grabbed.position.set(-0.3 + Math.random() * 0.6, 0.72, zc - 0.3 + Math.random() * 0.25);
          grabbed = null;
        }
        return;
      }
      let y = 1.6;
      let x = home.x;
      let z = home.z;
      if (u < 0.25) {
        const k = easeInOutQuad(u / 0.25);
        x = home.x + (target.x - home.x) * k;
        z = home.z + (target.z - home.z) * k;
      } else if (u < 0.55) {
        x = target.x;
        z = target.z;
        const k = u < 0.4 ? easeInOutQuad((u - 0.25) / 0.15) : 1 - easeInOutQuad((u - 0.4) / 0.15);
        y = 1.6 - k * 0.72;
        if (u >= 0.4 && !grabbed) {
          grabbed = plushies.reduce((best, p) => (p.position.distanceTo(target) < best.position.distanceTo(target) ? p : best), plushies[0]);
        }
      } else {
        const k = easeInOutQuad((u - 0.55) / 0.45);
        x = target.x + (home.x - target.x) * k;
        z = target.z + (home.z - target.z) * k;
        if (!win && grabbed && u > 0.7) {
          grabbed.position.y = Math.max(0.72, grabbed.position.y - dt * 3);
          if (grabbed.position.y <= 0.72) grabbed = null;
        }
      }
      claw.position.set(x, y, z);
      rod.scale.y = 1;
      if (grabbed && (win || u < 0.7)) {
        grabbed.position.set(x, y - 0.15, z);
        if (win && u > 0.97) grabbed.visible = false;
      }
      const close = u > 0.38 && u < 0.97 ? 0.1 : 0.5;
      prongs.forEach((p) => (p.parent!.rotation.x = close));
    },
    event(ev: ModelEvent) {
      if (ev.type === 'start' && ev.outcome.visual.kind === 'claw') {
        t0 = t;
        dur = ev.duration;
        win = ev.outcome.visual.win;
        const p = plushies[Math.floor(Math.random() * plushies.length)];
        target.set(p.position.x, 1.6, p.position.z);
      }
    },
    dispose() {
      disposeTree(root);
      plushGeo.dispose();
      earGeo.dispose();
    },
  };
}

// ------------------------------------------------------------------ pachinko

function pachinkoBoardTexture(color: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 448);
  const g = ctx.createLinearGradient(0, 0, 0, 448);
  g.addColorStop(0, '#16213e');
  g.addColorStop(1, '#0b0714');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 448);
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 200, 110, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#cfd6e4';
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 10; col++) {
      const x = 22 + col * 23.5 + (row % 2 ? 11 : 0);
      const y = 70 + row * 20;
      if (Math.hypot(x - 128, y - 200) > 108) continue;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#ffd23f';
  roundRect(ctx, 98, 190, 60, 36, 8);
  ctx.fill();
  ctx.fillStyle = '#1a0b2b';
  ctx.font = '400 20px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('777', 128, 210);
  drawNeonText(ctx, 'PACHINKO', 128, 36, 220, 34, 'Bungee, "Arial Black", sans-serif', '#ff6fb5');
  return canvasTexture(canvas);
}

export function pachinkoModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const body = mat(o.color, { rough: 0.3, metal: 0.25 });
  const zc = -0.62;
  box(root, 0.9, 0.08, 0.6, blackGloss(), 0, 0.04, -0.6);
  rbox(root, 0.86, 1.9, 0.36, 0.05, body, 0, 1.03, zc);
  const tex = pachinkoBoardTexture(o.color);
  const boardMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7, roughness: 0.3 });
  plane(root, 0.72, 1.26, boardMat, 0, 1.2, zc + 0.185);
  box(root, 0.8, 0.12, 0.3, chrome(), 0, 0.45, zc + 0.22);
  for (let i = 0; i < 8; i++) sph(root, 0.025, chrome(), -0.2 + i * 0.055, 0.53, zc + 0.24, 8, 6);
  box(root, 0.88, 0.05, 0.38, glow(0xff6fb5, 1.6), 0, 1.96, zc);
  cyl(root, 0.035, 0.035, 0.06, glow(0xffd23f, 1.8), 0.3, 0.62, zc + 0.3, 10).rotation.x = Math.PI / 2;
  stool(root, 0, 0.42, 0x1f1a3a);
  const balls: THREE.Mesh[] = [];
  const ballGeo = new THREE.SphereGeometry(0.022, 8, 6);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(ballGeo, chrome());
    b.visible = false;
    root.add(b);
    dyn.keep(b);
    balls.push(b);
  }
  bake(root, dyn);
  let active = 0;
  let t = 0;
  return {
    root,
    height: 2.4,
    update(dt, ctx) {
      t = ctx.t;
      boardMat.emissiveIntensity = ctx.broken ? 0.05 : 0.6 + (active > 0 ? 0.4 : 0);
      if (active > 0) active -= dt;
      balls.forEach((b, i) => {
        if (active <= 0) {
          b.visible = false;
          return;
        }
        b.visible = true;
        const cycle = ((ctx.t * 0.9 + i / balls.length) % 1);
        const y = 1.78 - cycle * 1.15;
        const x = Math.sin(cycle * 25 + i * 1.7) * 0.22 * (1 - cycle * 0.5);
        b.position.set(x, y, zc + 0.205);
      });
    },
    event(ev) {
      if (ev.type === 'start') active = ev.duration;
      void t;
    },
    dispose() {
      disposeTree(root);
      tex.dispose();
      boardMat.dispose();
      ballGeo.dispose();
    },
  };
}

// ------------------------------------------------------------------ ATM

export function atmModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const body = mat(o.color, { rough: 0.35, metal: 0.4 });
  const zc = -0.55;
  rbox(root, 0.74, 1.5, 0.56, 0.05, body, 0, 0.75, zc);
  box(root, 0.78, 0.06, 0.6, chrome(), 0, 1.52, zc);
  const screen = labelTexture('ATM', { w: 256, h: 180, bg: '#0a2a5a', color: '#9fe8ff' });
  const screenMat = new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 1, roughness: 0.3 });
  const scr = plane(root, 0.42, 0.3, screenMat, 0, 1.17, zc + 0.29);
  scr.rotation.x = -0.18;
  box(root, 0.6, 0.06, 0.24, mat(shadeHex(o.color, 0.6)), 0, 1.4, zc + 0.36).rotation.x = 0.4;
  const keypad = box(root, 0.26, 0.03, 0.18, mat(0x9aa0ab, { metal: 0.6, rough: 0.35 }), 0, 0.93, zc + 0.33);
  keypad.rotation.x = 0.35;
  box(root, 0.2, 0.02, 0.02, mat(0x0b0714), 0.18, 1.0, zc + 0.29);
  const slotLight = box(root, 0.3, 0.035, 0.02, glow(0x3ddc84, 1.8), 0, 0.72, zc + 0.285);
  const bill = box(root, 0.18, 0.005, 0.12, mat(0x7ccf7a, { rough: 0.8 }), 0, 0.72, zc + 0.32);
  bill.visible = false;
  dyn.keep(bill);
  void slotLight;
  const topSign = labelTexture('CASH', { w: 256, h: 72, bg: '#062612', color: '#3ddc84' });
  box(root, 0.7, 0.2, 0.1, mat(0x0b0714), 0, 1.64, zc - 0.03);
  plane(root, 0.6, 0.17, new THREE.MeshStandardMaterial({ map: topSign, emissive: 0xffffff, emissiveMap: topSign, emissiveIntensity: 1 }), 0, 1.64, zc + 0.022);
  bake(root, dyn);
  let billT = 0;
  return {
    root,
    height: 2.0,
    update(dt, ctx) {
      screenMat.emissiveIntensity = ctx.broken ? 0.05 : 0.9 + Math.sin(ctx.t * 4) * 0.1;
      if (billT > 0) {
        billT -= dt;
        bill.visible = true;
        bill.position.z = zc + 0.3 + Math.min(1, (1.5 - billT) * 2) * 0.1;
        if (billT <= 0) bill.visible = false;
      }
    },
    event(ev) {
      if (ev.type === 'result') billT = 1.5;
    },
    dispose() {
      disposeTree(root);
      screenMat.dispose();
    },
  };
}
