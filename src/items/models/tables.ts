import * as THREE from 'three';
import { mat, glow, gold, chrome, blackGloss } from '../../render/materials';
import {
  ROULETTE_ORDER, WHEEL_SEGMENTS, bigWheelTexture, cardBackTexture, cardTexture, feltTexture, makeCanvas, canvasTexture, rouletteWheelTexture,
} from '../../render/textures';
import { TAU, easeInOutQuad, easeOutCubic, lerp } from '../../core/math';
import type { Card, ItemModel, ModelCtx, ModelEvent } from '../types';
import { type BuildOpts, ChipStacks, Dyn, add, bake, box, cyl, disposeTree, floorPlane, rbox, shadeHex, sph, stool } from './common';

function hexCss(h: number): string {
  return `#${h.toString(16).padStart(6, '0')}`;
}

const TABLE_WOOD = 0x3a1d10;

// ------------------------------------------------------------------ cards

const cardGeo = new THREE.BoxGeometry(0.1, 0.004, 0.14);
const cardSideMat = mat(0xf4f1ea, { rough: 0.7 });

interface FlyingCard {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t0: number;
  faceUp: boolean;
  flipT: number;
  rotY: number;
}

class CardDealer {
  private cards: FlyingCard[] = [];
  private pool: THREE.Mesh[] = [];
  readonly group = new THREE.Group();

  constructor(parent: THREE.Object3D, private shoe: THREE.Vector3, dyn: Dyn) {
    parent.add(this.group);
    dyn.keep(this.group);
  }

  private meshFor(card: Card): THREE.Mesh {
    const m = this.pool.pop() ?? new THREE.Mesh(cardGeo);
    m.userData.sharedGeo = true;
    const face = mat(0xffffff, { map: cardTexture(card.rank, card.suit), rough: 0.6 });
    const back = mat(0xffffff, { map: cardBackTexture(), rough: 0.6 });
    m.material = [cardSideMat, cardSideMat, face, back, cardSideMat, cardSideMat];
    return m;
  }

  deal(card: Card, to: THREE.Vector3, at: number, faceUp: boolean, rotY = 0): number {
    const mesh = this.meshFor(card);
    mesh.visible = false;
    this.group.add(mesh);
    this.cards.push({ mesh, from: this.shoe.clone(), to: to.clone(), t0: at, faceUp, flipT: faceUp ? -1 : Infinity, rotY });
    return this.cards.length - 1;
  }

  flip(index: number, at: number): void {
    const c = this.cards[index];
    if (c) c.flipT = at;
  }

  clear(): void {
    for (const c of this.cards) {
      c.mesh.removeFromParent();
      this.pool.push(c.mesh);
    }
    this.cards = [];
  }

  get count(): number {
    return this.cards.length;
  }

  update(t: number): void {
    for (const c of this.cards) {
      const u = (t - c.t0) / 0.32;
      if (u < 0) {
        c.mesh.visible = false;
        continue;
      }
      c.mesh.visible = true;
      const k = easeOutCubic(Math.min(1, u));
      c.mesh.position.lerpVectors(c.from, c.to, k);
      c.mesh.position.y += Math.sin(Math.min(1, u) * Math.PI) * 0.12;
      let flip = 0;
      if (c.flipT !== Infinity && c.flipT >= 0) {
        const f = Math.min(1, Math.max(0, (t - c.flipT) / 0.3));
        flip = (1 - f) * Math.PI;
      } else if (!c.faceUp) {
        flip = Math.PI;
      }
      c.mesh.rotation.set(0, c.rotY + (1 - k) * 2, flip);
    }
  }
}

function cardValue(c: Card): number {
  if (c.rank === 0) return 11;
  return Math.min(10, c.rank + 1);
}

export function handTotal(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 0) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

// ------------------------------------------------------------------ blackjack

export function blackjackModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const felt = feltTexture('blackjack', hexCss(o.color), String(o.params.felt ?? ''));
  const feltMat = mat(0xffffff, { map: felt, rough: 0.95 });
  const wood = mat(TABLE_WOOD, { rough: 0.45 });
  const cz = -0.55;
  const R = 1.32;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.06, 40, 1, false, -Math.PI / 2, Math.PI), wood);
  add(root, top, 0, 0.8, cz);
  const feltTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 40, Math.PI, Math.PI), feltMat);
  feltTop.rotation.x = -Math.PI / 2;
  add(root, feltTop, 0, 0.834, cz);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(R - 0.04, 0.06, 8, 40, Math.PI), blackGloss());
  rail.rotation.x = Math.PI / 2;
  rail.rotation.z = Math.PI;
  add(root, rail, 0, 0.84, cz);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.15, R - 0.25, 0.72, 32, 1, false, -Math.PI / 2, Math.PI), wood);
  add(root, skirt, 0, 0.42, cz);
  box(root, R * 2 - 0.3, 0.72, 0.1, wood, 0, 0.42, cz);
  box(root, R * 2, 0.08, 0.14, wood, 0, 0.8, cz - 0.02);
  // Chip rack
  box(root, 0.6, 0.05, 0.14, mat(0x2a2233, { rough: 0.4 }), 0, 0.86, cz + 0.12);
  const chipCols = [0xc8102e, 0x1f4fbf, 0x1e7a46, 0x17151f, 0xf2b632];
  for (let i = 0; i < 5; i++) {
    const c = cyl(root, 0.04, 0.04, 0.1, mat(chipCols[i], { rough: 0.4 }), -0.22 + i * 0.11, 0.88, cz + 0.12, 12);
    c.rotation.x = Math.PI / 2;
  }
  // Shoe
  rbox(root, 0.18, 0.1, 0.26, 0.02, mat(0x5a1a24, { rough: 0.5 }), 0.62, 0.9, cz + 0.2);
  const shoe = new THREE.Vector3(0.62, 0.95, cz + 0.2);
  const seats = [
    { x: -1.2, z: 0.55 },
    { x: 0, z: 1.05 },
    { x: 1.2, z: 0.55 },
  ];
  for (const s of seats) stool(root, s.x * 1.03, s.z + 0.08, 0x2a2233, 0.66);
  const dealer = new CardDealer(root, shoe, dyn);
  const seatCardPos = seats.map((s) => new THREE.Vector3(lerp(s.x, 0, 0.32), 0.845, lerp(s.z, cz, 0.42)));
  const chips = new ChipStacks(root, seats.map((s) => [lerp(s.x, 0, 0.18), 0.838, lerp(s.z, cz, 0.24)] as [number, number, number]), dyn);
  bake(root, dyn);

  let t = 0;
  let clearAt = Infinity;
  return {
    root,
    height: 2.2,
    update(dt, ctx: ModelCtx) {
      t = ctx.t;
      dealer.update(t);
      if (t > clearAt) {
        dealer.clear();
        chips.clearAll();
        clearAt = Infinity;
      }
    },
    event(ev: ModelEvent) {
      if (ev.type === 'bet') chips.set(ev.seat, ev.amount);
      if (ev.type === 'tableStart' && ev.shared.kind === 'blackjack') {
        dealer.clear();
        clearAt = Infinity;
        const D = ev.duration;
        const order = ev.seats;
        let k = 0;
        const step = Math.min(0.38, (D * 0.7) / (order.length * 3 + 5));
        // Two cards each, dealer up + hole
        for (let round = 0; round < 2; round++) {
          for (const s of order) {
            const oc = ev.outcomes.get(s);
            if (!oc || oc.visual.kind !== 'blackjack') continue;
            const pos = seatCardPos[s].clone();
            pos.x += round * 0.05;
            pos.z += round * 0.015;
            dealer.deal(oc.visual.player[round], pos, t + k++ * step, true, 0.1 * round);
          }
          const dpos = new THREE.Vector3(-0.1 + round * 0.12, 0.845, cz + 0.42);
          const idx = dealer.deal(ev.shared.dealer[round], dpos, t + k++ * step, round === 0);
          if (round === 1) dealer.flip(idx, t + D * 0.72);
        }
        // Hits
        for (const s of order) {
          const oc = ev.outcomes.get(s);
          if (!oc || oc.visual.kind !== 'blackjack') continue;
          for (let c = 2; c < oc.visual.player.length; c++) {
            const pos = seatCardPos[s].clone();
            pos.x += c * 0.05;
            pos.z += c * 0.015;
            dealer.deal(oc.visual.player[c], pos, t + k++ * step, true, 0.1 * c);
          }
        }
        // Dealer draws
        const dStart = Math.max(t + k * step, t + D * 0.75);
        for (let c = 2; c < ev.shared.dealer.length; c++) {
          const dpos = new THREE.Vector3(-0.1 + c * 0.12, 0.845, cz + 0.42);
          dealer.deal(ev.shared.dealer[c], dpos, dStart + (c - 2) * 0.3, true);
        }
      }
      if (ev.type === 'tableResult') {
        for (const [s, oc] of ev.outcomes) chips.set(s, oc.payout > oc.bet ? oc.payout : oc.payout === oc.bet ? oc.bet : 0);
        clearAt = t + 2.2;
      }
      if (ev.type === 'clear') chips.set(ev.seat, 0);
    },
    dispose() {
      dealer.clear();
      disposeTree(root);
    },
  };
}

// ------------------------------------------------------------------ roulette

export function rouletteModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(TABLE_WOOD, { rough: 0.45 });
  const felt = feltTexture('roulette', hexCss(o.color));
  const feltMat = mat(0xffffff, { map: felt, rough: 0.95 });
  // Table body
  rbox(root, 2.9, 0.74, 1.36, 0.08, wood, 0, 0.42, -0.1);
  rbox(root, 2.96, 0.08, 1.42, 0.03, blackGloss(), 0, 0.81, -0.1);
  floorPlane(root, 1.95, 0.98, feltMat, 0.42, 0.852, -0.08);
  box(root, 2.9, 0.05, 0.08, gold(), 0, 0.86, 0.6);
  // Wheel bowl
  const wx = -0.95;
  const wz = -0.12;
  cyl(root, 0.52, 0.48, 0.16, mat(0x5a2a10, { rough: 0.35, metal: 0.2 }), wx, 0.92, wz, 32);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.028, 8, 40), gold());
  rim.rotation.x = Math.PI / 2;
  add(root, rim, wx, 1.005, wz);
  const wheel = new THREE.Group();
  wheel.position.set(wx, 1.012, wz);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 48), mat(0xffffff, { map: rouletteWheelTexture(), rough: 0.35 }));
  disc.rotation.x = -Math.PI / 2;
  wheel.add(disc);
  const turret = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 12), gold());
  turret.position.y = 0.06;
  wheel.add(turret);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.015), gold());
    arm.position.y = 0.09;
    arm.rotation.y = (i * Math.PI) / 4;
    wheel.add(arm);
  }
  root.add(wheel);
  dyn.keep(wheel);
  const ball = sph(root, 0.022, mat(0xffffff, { rough: 0.15, metal: 0.1 }), wx + 0.38, 1.03, wz, 10, 8);
  dyn.keep(ball);
  // Chip rack at the dealer side
  box(root, 0.7, 0.05, 0.14, mat(0x2a2233, { rough: 0.4 }), 0.35, 0.88, -0.66);
  const seatPos: [number, number][] = [[-1.0, 0.95], [-0.3, 0.95], [0.4, 0.95], [1.1, 0.95]];
  for (const [x, z] of seatPos) stool(root, x, z + 0.1, 0x2a2233, 0.66);
  const chips = new ChipStacks(root, seatPos.map(([x]) => [0.1 + x * 0.55, 0.858, 0.1] as [number, number, number]), dyn);
  const marker = sph(root, 0.035, glow(0xffffff, 2), 0, 0.9, 0, 10, 8);
  marker.visible = false;
  dyn.keep(marker);
  bake(root, dyn);

  const n = ROULETTE_ORDER.length;
  let psi = 0;
  let wheelSpeed = 0.25;
  let spinT0 = -1;
  let dur = 8;
  let target = 0;
  let ballAngle = 0;
  let locked = false;
  let t = 0;
  let clearAt = Infinity;
  const pocketAngle = (num: number) => (ROULETTE_ORDER.indexOf(num) / n) * TAU - Math.PI / 2;
  return {
    root,
    height: 1.6,
    update(dt, ctx) {
      t = ctx.t;
      psi += wheelSpeed * dt;
      wheel.rotation.y = psi;
      let br = 0.37;
      let by = 1.03;
      if (spinT0 >= 0) {
        const u = (t - spinT0) / dur;
        wheelSpeed = lerp(3.2, 0.5, Math.min(1, u));
        if (u < 0.72) {
          ballAngle -= dt * lerp(11, 4, u / 0.72);
        } else if (u < 0.9) {
          const k = easeInOutQuad((u - 0.72) / 0.18);
          const want = pocketAngle(target) - psi;
          let delta = ((want - ballAngle) % TAU + TAU * 1.5) % TAU - Math.PI;
          ballAngle += delta * k * 0.35;
          br = lerp(0.37, 0.31, k);
          by = lerp(1.03, 1.015, k) + Math.abs(Math.sin(u * 60)) * 0.012 * (1 - k);
        } else {
          locked = true;
        }
        if (u >= 1.2) {
          spinT0 = -1;
          wheelSpeed = 0.25;
        }
      }
      if (locked) {
        ballAngle = pocketAngle(target) - psi;
        br = 0.31;
        by = 1.015;
      }
      ball.position.set(wx + Math.cos(ballAngle) * br, by, wz + Math.sin(ballAngle) * br);
      if (t > clearAt) {
        chips.clearAll();
        marker.visible = false;
        clearAt = Infinity;
      }
    },
    event(ev) {
      if (ev.type === 'bet') chips.set(ev.seat, ev.amount);
      if (ev.type === 'tableStart' && ev.shared.kind === 'roulette') {
        spinT0 = t;
        dur = ev.duration;
        target = ev.shared.number;
        locked = false;
        ballAngle = Math.random() * TAU;
      }
      if (ev.type === 'tableResult') {
        for (const [s, oc] of ev.outcomes) chips.set(s, oc.payout > 0 ? oc.payout : 0);
        clearAt = t + 2.5;
      }
      if (ev.type === 'clear') chips.set(ev.seat, 0);
    },
    dispose() {
      disposeTree(root);
    },
  };
}

// ------------------------------------------------------------------ big wheel

export function bigWheelModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const frameM = mat(o.color, { rough: 0.3, metal: 0.4 });
  const wy = 1.55;
  const wz = -0.62;
  const R = 0.82;
  // Stand
  box(root, 1.9, 0.1, 0.7, blackGloss(), 0, 0.05, wz);
  for (const x of [-0.72, 0.72]) {
    const leg = box(root, 0.1, 1.55, 0.1, frameM, x, 0.8, wz - 0.05);
    leg.rotation.z = x > 0 ? 0.25 : -0.25;
  }
  cyl(root, R + 0.08, R + 0.08, 0.1, frameM, 0, wy, wz - 0.02, 40).rotation.x = Math.PI / 2;
  cyl(root, R + 0.1, R + 0.1, 0.04, gold(), 0, wy, wz + 0.03, 40).rotation.x = Math.PI / 2;
  const wheel = new THREE.Group();
  wheel.position.set(0, wy, wz + 0.06);
  const face = new THREE.Mesh(new THREE.CircleGeometry(R, 48), mat(0xffffff, { map: bigWheelTexture(), rough: 0.4, emissive: 0xffffff, emissiveMap: bigWheelTexture(), emissiveIntensity: 0.25 }));
  wheel.add(face);
  const pegGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6);
  const pegMat = chrome();
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    const a = ((i + 0.5) / WHEEL_SEGMENTS.length) * TAU;
    const p = new THREE.Mesh(pegGeo, pegMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(Math.cos(a) * (R - 0.03), Math.sin(a) * (R - 0.03), 0.02);
    wheel.add(p);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), gold());
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.03;
  wheel.add(hub);
  root.add(wheel);
  dyn.keep(wheel);
  // Chasing bulbs
  const bulbs: THREE.Mesh[] = [];
  const bulbOn = glow(0xfff1b8, 3);
  const bulbOff = mat(0x6b5a3a, { rough: 0.4 });
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    const b = new THREE.Mesh(bulbGeo, bulbOn);
    b.position.set(Math.cos(a) * (R + 0.09), wy + Math.sin(a) * (R + 0.09), wz + 0.07);
    root.add(b);
    dyn.keep(b);
    bulbs.push(b);
  }
  // Pointer
  const pointer = new THREE.Group();
  pointer.position.set(0, wy + R + 0.12, wz + 0.12);
  const tri = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 3), mat(0xe8132d, { rough: 0.3 }));
  tri.rotation.z = Math.PI;
  tri.position.y = -0.06;
  pointer.add(tri);
  root.add(pointer);
  dyn.keep(pointer);
  // Betting counter
  const counter = rbox(root, 1.8, 0.88, 0.42, 0.05, mat(shadeHex(o.color, 0.5), { rough: 0.4 }), 0, 0.44, 0.05);
  void counter;
  const { canvas, ctx } = makeCanvas(512, 96);
  const segs = [1, 2, 5, 10, 20, 40];
  const colors = ['#f5c542', '#2e9df7', '#9b59ff', '#2ecc71', '#ff7a1a', '#e8132d'];
  ctx.fillStyle = '#0f5a35';
  ctx.fillRect(0, 0, 512, 96);
  segs.forEach((s, i) => {
    ctx.fillStyle = colors[i];
    ctx.fillRect(8 + i * 84, 12, 76, 72);
    ctx.fillStyle = '#fff';
    ctx.font = '400 28px Bungee, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s === 40 ? '★' : `$${s}`, 46 + i * 84, 50);
  });
  const layout = canvasTexture(canvas);
  floorPlane(root, 1.7, 0.34, mat(0xffffff, { map: layout, rough: 0.9 }), 0, 0.885, 0.05);
  const chips = new ChipStacks(root, [[-0.45, 0.885, 0.1], [0.45, 0.885, 0.1]], dyn);
  bake(root, dyn);

  let psi = 0;
  let spinT0 = -1;
  let dur = 8;
  let from = 0;
  let to = 0;
  let t = 0;
  let clearAt = Infinity;
  const n = WHEEL_SEGMENTS.length;
  return {
    root,
    height: 2.8,
    update(dt, ctx) {
      t = ctx.t;
      if (spinT0 >= 0) {
        const u = Math.min(1, (t - spinT0) / (dur * 0.9));
        psi = from + (to - from) * easeOutCubic(u);
        if (u >= 1) spinT0 = -1;
      } else {
        psi += dt * 0.05;
      }
      wheel.rotation.z = psi;
      const segA = TAU / n;
      const within = (((psi % segA) + segA) % segA) / segA;
      pointer.rotation.z = within < 0.25 ? -within * 1.6 : 0;
      const phase = Math.floor(t * (spinT0 >= 0 ? 16 : 6));
      bulbs.forEach((b, i) => (b.material = ctx.broken ? bulbOff : (i + phase) % 4 === 0 ? bulbOff : bulbOn));
      if (t > clearAt) {
        chips.clearAll();
        clearAt = Infinity;
      }
    },
    event(ev) {
      if (ev.type === 'bet') chips.set(ev.seat, ev.amount);
      if (ev.type === 'tableStart' && ev.shared.kind === 'wheel') {
        spinT0 = t;
        dur = ev.duration;
        from = psi;
        const base = (ev.shared.segment / n) * TAU;
        const minTo = psi + TAU * 3;
        to = base + TAU * Math.ceil((minTo - base) / TAU);
      }
      if (ev.type === 'tableResult') {
        for (const [s, oc] of ev.outcomes) chips.set(s, oc.payout > 0 ? oc.payout : 0);
        clearAt = t + 2.5;
      }
      if (ev.type === 'clear') chips.set(ev.seat, 0);
    },
    dispose() {
      disposeTree(root);
      bulbGeo.dispose();
      pegGeo.dispose();
      layout.dispose();
    },
  };
}

// ------------------------------------------------------------------ craps

let diceMats: THREE.MeshStandardMaterial[] | null = null;
function diceMaterials(): THREE.MeshStandardMaterial[] {
  if (diceMats) return diceMats;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const faceValues = [3, 4, 1, 6, 2, 5];
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
    6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
  };
  diceMats = faceValues.map((v) => {
    const { canvas, ctx } = makeCanvas(64, 64);
    ctx.fillStyle = '#d6152f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of pips[v]) {
      ctx.beginPath();
      ctx.arc(x * 64, y * 64, 6, 0, TAU);
      ctx.fill();
    }
    return new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.25 });
  });
  return diceMats;
}

const FACE_UP: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
};

export function crapsModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(TABLE_WOOD, { rough: 0.45 });
  const felt = feltTexture('craps', hexCss(o.color), String(o.params.felt ?? ''));
  const feltMat = mat(0xffffff, { map: felt, rough: 0.95 });
  const tz = -0.1;
  rbox(root, 3.7, 0.72, 1.36, 0.1, wood, 0, 0.4, tz);
  floorPlane(root, 3.4, 1.1, feltMat, 0, 0.77, tz);
  const railM = blackGloss();
  box(root, 3.7, 0.2, 0.12, railM, 0, 0.86, tz - 0.62);
  box(root, 3.7, 0.2, 0.12, railM, 0, 0.86, tz + 0.62);
  box(root, 0.12, 0.2, 1.36, railM, -1.8, 0.86, tz);
  box(root, 0.12, 0.2, 1.36, railM, 1.8, 0.86, tz);
  box(root, 3.5, 0.04, 0.12, gold(), 0, 0.97, tz + 0.62);
  // Stick
  const stick = cyl(root, 0.012, 0.012, 1.1, mat(0xa0652e, { rough: 0.5 }), 0.3, 0.8, tz - 0.3, 6);
  stick.rotation.z = Math.PI / 2;
  stick.rotation.y = 0.4;
  const diceGeo = new THREE.BoxGeometry(0.075, 0.075, 0.075);
  const dice = Array.from({ length: Number(o.params.dice ?? 2) }, () => {
    const d = new THREE.Mesh(diceGeo, diceMaterials());
    d.userData.sharedGeo = true;
    d.position.set(0, 0.81, tz);
    root.add(d);
    dyn.keep(d);
    return d;
  });
  const chips = new ChipStacks(root, [-1.45, -0.5, 0.5, 1.45].map((x) => [x, 0.775, tz + 0.38] as [number, number, number]), dyn);
  bake(root, dyn);
  let throwT0 = -1;
  let dur = 5;
  let values: number[] = [3, 4, 5];
  const from = new THREE.Vector3();
  let t = 0;
  let clearAt = Infinity;
  const finalQ = dice.map(() => new THREE.Quaternion());
  const spinQ = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  return {
    root,
    height: 1.4,
    update(dt, ctx) {
      t = ctx.t;
      if (throwT0 >= 0) {
        const start = throwT0 + dur * 0.35;
        const u = (t - start) / (dur * 0.45);
        dice.forEach((d, i) => {
          if (u < 0) {
            d.position.copy(from).add(new THREE.Vector3(i * 0.09, 0.02, 0));
            return;
          }
          const k = Math.min(1, u);
          const endX = (from.x > 0 ? -1.2 : 1.2) + i * 0.12;
          const x = lerp(from.x + i * 0.09, endX, easeOutCubic(k));
          const z = lerp(from.z, tz - 0.25 + i * 0.1, easeOutCubic(k));
          const bounce = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 0.25;
          d.position.set(x, 0.81 + bounce, z);
          if (k < 0.85) {
            axis.set(1, 0.4 + i, 0.3).normalize();
            spinQ.setFromAxisAngle(axis, dt * 22 * (1 - k));
            d.quaternion.premultiply(spinQ);
          } else {
            d.quaternion.slerp(finalQ[i], 0.35);
          }
        });
        if (u >= 1.2) throwT0 = -1;
      }
      if (t > clearAt) {
        chips.clearAll();
        clearAt = Infinity;
      }
    },
    event(ev) {
      if (ev.type === 'bet') chips.set(ev.seat, ev.amount);
      if (ev.type === 'tableStart' && ev.shared.kind === 'craps') {
        throwT0 = t;
        dur = ev.duration;
        values = ev.shared.dice;
        const shooter = ev.seats[Math.floor(Math.random() * ev.seats.length)] ?? 0;
        from.set([-1.45, -0.5, 0.5, 1.45][shooter] ?? 0, 0.83, tz + 0.45);
        values.forEach((v, i) => {
          const q = new THREE.Quaternion().setFromEuler(FACE_UP[v]);
          const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * TAU);
          finalQ[i] = yaw.multiply(q);
        });
      }
      if (ev.type === 'tableResult') {
        for (const [s, oc] of ev.outcomes) chips.set(s, oc.payout > 0 ? oc.payout : 0);
        clearAt = t + 2;
      }
      if (ev.type === 'clear') chips.set(ev.seat, 0);
    },
    dispose() {
      disposeTree(root);
      diceGeo.dispose();
    },
  };
}

// ------------------------------------------------------------------ poker

export function pokerModel(o: BuildOpts): ItemModel {
  const root = new THREE.Group();
  const dyn = new Dyn();
  const wood = mat(TABLE_WOOD, { rough: 0.45 });
  const felt = feltTexture('poker', hexCss(o.color), String(o.params.felt ?? ''));
  const feltMat = mat(0xffffff, { map: felt, rough: 0.95 });
  const cz = -0.05;
  const sx = 1.6;
  const sz = 0.92;
  const top = cyl(root, 1, 1, 0.08, wood, 0, 0.78, cz, 48);
  top.scale.set(sx, 1, sz);
  const feltDisc = new THREE.Mesh(new THREE.CircleGeometry(0.92, 48), feltMat);
  feltDisc.rotation.x = -Math.PI / 2;
  feltDisc.scale.set(sx, sz, 1);
  add(root, feltDisc, 0, 0.823, cz);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.07, 8, 48), blackGloss());
  rail.rotation.x = Math.PI / 2;
  rail.scale.set(sx, sz, 1);
  add(root, rail, 0, 0.83, cz);
  const ped = cyl(root, 0.5, 0.7, 0.72, wood, 0, 0.38, cz, 24);
  ped.scale.set(1.6, 1, 0.9);
  const seatPos: [number, number][] = [[-0.62, 1.2], [0.62, 1.2], [-1.75, 0.15], [1.75, 0.15], [-1.3, -0.95], [1.3, -0.95]];
  for (const [x, z] of seatPos) stool(root, x * 1.02, z * 1.05, 0x2a2233, 0.66);
  const center = new THREE.Vector3(0, 0.83, cz);
  const dealer = new CardDealer(root, new THREE.Vector3(0, 0.86, cz - 0.7), dyn);
  const holePos = seatPos.map(([x, z]) => new THREE.Vector3(lerp(x, 0, 0.38), 0.835, lerp(z, cz, 0.38)));
  const chips = new ChipStacks(root, seatPos.map(([x, z]) => [lerp(x, 0, 0.55), 0.83, lerp(z, cz, 0.55)] as [number, number, number]), dyn);
  const pot = new ChipStacks(root, [[0.05, 0.83, cz - 0.3]], dyn);
  bake(root, dyn);
  let t = 0;
  let clearAt = Infinity;
  let potAmt = 0;
  return {
    root,
    height: 1.6,
    update(dt, ctx) {
      t = ctx.t;
      dealer.update(t);
      if (t > clearAt) {
        dealer.clear();
        chips.clearAll();
        pot.clearAll();
        potAmt = 0;
        clearAt = Infinity;
      }
      void dt;
    },
    event(ev) {
      if (ev.type === 'bet') {
        chips.set(ev.seat, ev.amount);
        potAmt += ev.amount;
      }
      if (ev.type === 'tableStart' && ev.shared.kind === 'poker') {
        dealer.clear();
        clearAt = Infinity;
        const D = ev.duration;
        let k = 0;
        const step = Math.min(0.25, (D * 0.35) / (ev.seats.length * 2 + 1));
        const holeIdx: number[][] = [];
        for (let round = 0; round < 2; round++) {
          for (const s of ev.seats) {
            const oc = ev.outcomes.get(s);
            if (!oc || oc.visual.kind !== 'poker') continue;
            const p = holePos[s].clone();
            p.x += round * 0.06;
            const idx = dealer.deal(oc.visual.hole[round], p, t + k++ * step, false, 0.15 * round);
            (holeIdx[s] ??= []).push(idx);
          }
        }
        const board = ev.shared.board;
        const flopT = t + D * 0.4;
        for (let i = 0; i < 5; i++) {
          const at = i < 3 ? flopT + i * 0.15 : flopT + D * (i === 3 ? 0.15 : 0.3);
          dealer.deal(board[i], new THREE.Vector3(center.x - 0.26 + i * 0.13, 0.835, center.z + 0.05), at, true);
        }
        const showdown = t + D * 0.85;
        holeIdx.forEach((list) => list?.forEach((i) => dealer.flip(i, showdown)));
        chips.clearAll();
        pot.set(0, potAmt);
      }
      if (ev.type === 'tableResult') {
        pot.set(0, 0);
        potAmt = 0;
        for (const [s, oc] of ev.outcomes) chips.set(s, oc.payout > 0 ? oc.payout : 0);
        clearAt = t + 2.4;
      }
      if (ev.type === 'clear') chips.set(ev.seat, 0);
    },
    dispose() {
      dealer.clear();
      disposeTree(root);
    },
  };
}
