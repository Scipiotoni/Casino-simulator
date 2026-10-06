import { RED_NUMBERS, WHEEL_ORDER } from '../../items/roulette';

/**
 * A European roulette wheel on a canvas, seen from above: the wooden bowl with its ball
 * track and diamond deflectors stays still while the rotor (numbered pockets, frets,
 * cone and turret) turns. A spin throws the ball the other way round the track; it slows,
 * drops off, clatters over the deflectors and pockets, and settles in the winning number,
 * then rides round with the rotor.
 *
 * Landing exactly on the chosen number without the ball visibly cheating: the ball's path
 * is fixed in advance, and the rotor's launch speed is picked so the right pocket arrives
 * under the ball as it drops (a croupier's spin varies that much anyway).
 */

const N = WHEEL_ORDER.length;
const TAU = Math.PI * 2;
const SEG = TAU / N;

// Radii as fractions of the wheel radius.
const R_TRACK = 0.8;
const R_NUM_OUT = 0.72;
const R_NUM_IN = 0.61;
const R_POCKET_IN = 0.5;
const R_POCKET = 0.555;

// Spin timeline (seconds).
const T_TRACK = 3.1;
const T_DROP = 4.5;
const T_SETTLE = 5.7;
export const SPIN_SECONDS = T_SETTLE + 0.3;

const ROTOR_K = 0.12;
const easeOut = (s: number) => 1 - (1 - s) ** 3;

export class RouletteWheelView {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 0;
  private stator: HTMLCanvasElement | null = null;
  private rotorImg: HTMLCanvasElement | null = null;
  /** Rotor angle and speed (rad, rad/s; positive = clockwise on screen). */
  private rotor = Math.random() * TAU;
  private rotorV = 0.5;
  private ball: { a: number; r: number; visible: boolean } = { a: 0, r: R_POCKET, visible: false };
  private spin: null | {
    t: number;
    start: number;
    a0: number;
    b0: number;
    k1: number;
    w0: number;
    rot0: number;
    phiT: number;
    delta: number;
    dropA: number;
    hopSeed: number;
    done: () => void;
  } = null;
  /** Where the ball is resting (rotor-relative angle) between spins. */
  private restPhi: number | null = null;
  private raf = 0;
  private last = 0;
  private dead = false;

  constructor(cssSize = 240) {
    this.el = document.createElement('canvas');
    this.el.className = 'rl-wheel';
    this.el.style.width = this.el.style.height = `${cssSize}px`;
    this.ctx = this.el.getContext('2d')!;
    this.resize(cssSize);
    const loop = (now: number) => {
      if (this.dead) return;
      const dt = Math.min(0.25, (now - (this.last || now)) / 1000);
      this.last = now;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(css: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.round(css * dpr);
    this.el.width = this.el.height = this.size;
    this.stator = this.paintStator();
    this.rotorImg = this.paintRotor();
  }

  dispose(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
  }

  /** Pocket angle of a number in the rotor's frame (0 at the top when the rotor is at 0). */
  private pocketPhi(n: number): number {
    return WHEEL_ORDER.indexOf(n) * SEG - Math.PI / 2;
  }

  /**
   * Spin and land on `n`. `onTick` fires as the ball hits deflectors/frets (for sound);
   * resolves when the ball has settled.
   */
  spinTo(n: number, onTick?: (kind: 'track' | 'drop' | 'pocket') => void): Promise<void> {
    return new Promise((resolve) => {
      this.restPhi = null;
      const a0 = Math.random() * TAU;
      // The ball's launch speed and how it slows on the track.
      const b0 = 10 + Math.random() * 2;
      const b1 = 3.4;
      const k1 = Math.log(b0 / b1) / T_TRACK;
      // Where the ball is when it reaches the pockets (fixed, see ballAngle()).
      const dropA = a0 - (b0 * (1 - Math.exp(-k1 * T_TRACK))) / k1 - ((b1 + 1.4) / 2) * (T_DROP - T_TRACK);
      const delta = 0.9 + Math.random() * 0.5;
      const phiT = this.pocketPhi(n);
      // Rotor launch speed so the winning pocket is `delta` ahead of the ball at the drop.
      const F = (1 - Math.exp(-ROTOR_K * T_DROP)) / ROTOR_K;
      const need = dropA - this.rotor - phiT - delta;
      const base = 2.0 * F;
      const m = Math.ceil((base - need) / TAU);
      const W = need + m * TAU;
      const w0 = W / F;
      const spin = { t: 0, start: performance.now(), a0, b0, k1, w0, rot0: this.rotor, phiT, delta, dropA, hopSeed: Math.random() * 10, done: resolve };
      this.spin = spin;
      this.ticks = { fired: new Set(), onTick };
      this.ball.visible = true;
      // The spin runs on the clock, not on frames: if the tab is hidden (no frames) the
      // ball still lands on time.
      window.setTimeout(() => {
        if (this.spin !== spin) return;
        this.restPhi = spin.phiT;
        this.spin = null;
        resolve();
      }, SPIN_SECONDS * 1000 + 400);
    });
  }

  private ticks: { fired: Set<number>; onTick?: (kind: 'track' | 'drop' | 'pocket') => void } = { fired: new Set() };

  private tick(id: number, kind: 'track' | 'drop' | 'pocket'): void {
    if (this.ticks.fired.has(id)) return;
    this.ticks.fired.add(id);
    this.ticks.onTick?.(kind);
  }

  private rotorAt(t: number): number {
    const s = this.spin!;
    return s.rot0 + (s.w0 * (1 - Math.exp(-ROTOR_K * t))) / ROTOR_K;
  }

  private step(dt: number): void {
    const s = this.spin;
    if (!s) {
      // Between spins the rotor coasts slowly; a resting ball rides with it.
      this.rotorV = Math.max(0.35, this.rotorV * Math.exp(-0.25 * dt));
      this.rotor += this.rotorV * dt;
      if (this.restPhi !== null) {
        this.ball.a = this.rotor + this.restPhi;
        this.ball.r = R_POCKET;
      }
      return;
    }
    s.t = (performance.now() - s.start) / 1000;
    const t = s.t;
    this.rotor = this.rotorAt(Math.min(t, 30));
    this.rotorV = s.w0 * Math.exp(-ROTOR_K * t);
    const b1 = 3.4;
    if (t < T_TRACK) {
      // Round the track, slowing.
      this.ball.a = s.a0 - (s.b0 * (1 - Math.exp(-s.k1 * t))) / s.k1;
      this.ball.r = R_TRACK;
      if (t > 1.2) this.tick(Math.floor(t * 3), 'track');
    } else if (t < T_DROP) {
      // Off the track and spiralling in, bouncing off a deflector on the way.
      const u = t - T_TRACK;
      const D = T_DROP - T_TRACK;
      const s01 = u / D;
      const aTrack = s.a0 - (s.b0 * (1 - Math.exp(-s.k1 * T_TRACK))) / s.k1;
      this.ball.a = aTrack - (b1 * u - ((b1 - 1.4) * u * u) / (2 * D));
      const bump = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (s01 - 0.35) / 0.3)))) * 0.06;
      this.ball.r = R_TRACK + (R_POCKET - R_TRACK) * s01 * s01 + bump;
      if (s01 > 0.35) this.tick(100, 'drop');
      if (s01 > 0.85) this.tick(101, 'pocket');
    } else if (t < T_SETTLE) {
      // Rattling over the frets into the pocket.
      const u = (t - T_DROP) / (T_SETTLE - T_DROP);
      const hop = Math.sin(u * Math.PI * 5) * 0.05 * (1 - u) ** 2 * (s.hopSeed > 5 ? 1 : -1);
      const phi = s.phiT + s.delta * (1 - easeOut(u)) + hop;
      this.ball.a = this.rotor + phi;
      this.ball.r = R_POCKET + Math.abs(Math.sin(u * Math.PI * 4)) * 0.035 * (1 - u);
      const fret = Math.floor((s.delta * (1 - easeOut(u))) / SEG);
      this.tick(200 + fret, 'pocket');
    } else {
      this.ball.a = this.rotor + s.phiT;
      this.ball.r = R_POCKET;
      if (t > SPIN_SECONDS) {
        this.restPhi = s.phiT;
        this.spin = null;
        s.done();
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  private paintStator(): HTMLCanvasElement {
    const S = this.size;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const R = S / 2;
    g.translate(R, R);
    // Wooden bowl.
    const wood = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
    wood.addColorStop(0, '#2a1208');
    wood.addColorStop(0.55, '#6b3517');
    wood.addColorStop(0.85, '#8a4a22');
    wood.addColorStop(1, '#3a1a0a');
    g.fillStyle = wood;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    // Wood grain rings.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, R * (0.9 + i * 0.016), 0, TAU);
      g.stroke();
    }
    // Brass rim and the polished ball track.
    g.strokeStyle = '#d9b25a';
    g.lineWidth = R * 0.018;
    g.beginPath();
    g.arc(0, 0, R * 0.885, 0, TAU);
    g.stroke();
    const track = g.createRadialGradient(0, 0, R * 0.74, 0, 0, R * 0.88);
    track.addColorStop(0, '#1b0d06');
    track.addColorStop(0.5, '#4a2410');
    track.addColorStop(1, '#2a1208');
    g.fillStyle = track;
    g.beginPath();
    g.arc(0, 0, R * 0.875, 0, TAU);
    g.arc(0, 0, R * 0.735, 0, TAU, true);
    g.fill();
    // Eight diamond deflectors, alternately upright and flat.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      g.save();
      g.rotate(a);
      g.translate(R * 0.775, 0);
      if (i % 2) g.rotate(Math.PI / 2);
      const dg = g.createLinearGradient(-R * 0.03, 0, R * 0.03, 0);
      dg.addColorStop(0, '#fff6d8');
      dg.addColorStop(1, '#b08a3a');
      g.fillStyle = dg;
      g.beginPath();
      g.moveTo(-R * 0.035, 0);
      g.lineTo(0, -R * 0.016);
      g.lineTo(R * 0.035, 0);
      g.lineTo(0, R * 0.016);
      g.closePath();
      g.fill();
      g.restore();
    }
    return c;
  }

  private paintRotor(): HTMLCanvasElement {
    const S = this.size;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const R = S / 2;
    g.translate(R, R);
    for (let i = 0; i < N; i++) {
      const num = WHEEL_ORDER[i];
      const a0 = i * SEG - Math.PI / 2 - SEG / 2;
      const a1 = a0 + SEG;
      const col = num === 0 ? '#0f8a3c' : RED_NUMBERS.has(num) ? '#c8102e' : '#141218';
      // Number ring.
      g.fillStyle = col;
      g.beginPath();
      g.arc(0, 0, R * R_NUM_OUT, a0, a1);
      g.arc(0, 0, R * R_NUM_IN, a1, a0, true);
      g.closePath();
      g.fill();
      // Pocket (darker, deeper).
      const pg = g.createRadialGradient(0, 0, R * R_POCKET_IN, 0, 0, R * R_NUM_IN);
      pg.addColorStop(0, shade(col, 0.45));
      pg.addColorStop(1, shade(col, 0.8));
      g.fillStyle = pg;
      g.beginPath();
      g.arc(0, 0, R * R_NUM_IN, a0, a1);
      g.arc(0, 0, R * R_POCKET_IN, a1, a0, true);
      g.closePath();
      g.fill();
      // Number, upright facing outwards.
      const am = (a0 + a1) / 2;
      g.save();
      g.rotate(am + Math.PI / 2);
      g.translate(0, -R * ((R_NUM_OUT + R_NUM_IN) / 2));
      g.fillStyle = '#fff';
      g.font = `800 ${Math.round(R * 0.062)}px Nunito, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(num), 0, 0);
      g.restore();
      // Metal frets between pockets.
      g.strokeStyle = '#e8d8a8';
      g.lineWidth = Math.max(1, R * 0.008);
      g.beginPath();
      g.moveTo(Math.cos(a0) * R * R_POCKET_IN, Math.sin(a0) * R * R_POCKET_IN);
      g.lineTo(Math.cos(a0) * R * R_NUM_OUT, Math.sin(a0) * R * R_NUM_OUT);
      g.stroke();
    }
    // Gold rings round the numbers.
    g.strokeStyle = '#d9b25a';
    for (const r of [R_NUM_OUT, R_NUM_IN, R_POCKET_IN]) {
      g.lineWidth = R * 0.01;
      g.beginPath();
      g.arc(0, 0, R * r, 0, TAU);
      g.stroke();
    }
    // The cone, in wood, with four gold spokes and the turret.
    const cone = g.createRadialGradient(-R * 0.08, -R * 0.1, R * 0.02, 0, 0, R * R_POCKET_IN);
    cone.addColorStop(0, '#c7894a');
    cone.addColorStop(0.5, '#7a3f18');
    cone.addColorStop(1, '#3a1a0a');
    g.fillStyle = cone;
    g.beginPath();
    g.arc(0, 0, R * (R_POCKET_IN - 0.005), 0, TAU);
    g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const sp = g.createLinearGradient(0, 0, Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4);
      sp.addColorStop(0, '#fff2c2');
      sp.addColorStop(1, '#a8782a');
      g.strokeStyle = sp;
      g.lineWidth = R * 0.035;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.08, Math.sin(a) * R * 0.08);
      g.lineTo(Math.cos(a) * R * 0.36, Math.sin(a) * R * 0.36);
      g.stroke();
      g.fillStyle = '#f3dc96';
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.38, Math.sin(a) * R * 0.38, R * 0.03, 0, TAU);
      g.fill();
    }
    const knob = g.createRadialGradient(-R * 0.03, -R * 0.03, 0, 0, 0, R * 0.09);
    knob.addColorStop(0, '#fffbe6');
    knob.addColorStop(1, '#a8782a');
    g.fillStyle = knob;
    g.beginPath();
    g.arc(0, 0, R * 0.085, 0, TAU);
    g.fill();
    return c;
  }

  private draw(): void {
    const g = this.ctx;
    const S = this.size;
    const R = S / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    if (this.stator) g.drawImage(this.stator, 0, 0);
    if (this.rotorImg) {
      g.save();
      g.translate(R, R);
      g.rotate(this.rotor);
      g.drawImage(this.rotorImg, -R, -R);
      g.restore();
    }
    if (this.ball.visible) {
      const x = R + Math.cos(this.ball.a) * this.ball.r * R;
      const y = R + Math.sin(this.ball.a) * this.ball.r * R;
      const br = R * 0.034;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.ellipse(x + br * 0.35, y + br * 0.5, br, br * 0.8, 0, 0, TAU);
      g.fill();
      const bg = g.createRadialGradient(x - br * 0.35, y - br * 0.4, br * 0.1, x, y, br);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.6, '#e8e8ee');
      bg.addColorStop(1, '#9aa0ad');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(x, y, br, 0, TAU);
      g.fill();
    }
    // Overhead light on the lacquer.
    const glare = g.createRadialGradient(R * 0.7, R * 0.55, 0, R * 0.7, R * 0.55, R * 0.9);
    glare.addColorStop(0, 'rgba(255,255,255,0.16)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glare;
    g.beginPath();
    g.arc(R, R, R, 0, TAU);
    g.fill();
  }
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}
