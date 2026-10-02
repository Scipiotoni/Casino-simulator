import { h, clear } from '../dom';
import { audio } from '../../core/audio';
import type { Modals } from '../modals';

/**
 * Little games on your gaming setup's monitors (and the arcade cabinet): Snake, Flappy Chip
 * and Brick Breaker. Just for fun, with your best scores kept on this device.
 */
export type ArcadeId = 'snake' | 'flappy' | 'bricks';

export const ARCADE_GAMES: { id: ArcadeId; name: string; emoji: string; how: string }[] = [
  { id: 'snake', name: 'Snake', emoji: '🐍', how: 'Arrows / WASD (or swipe) to turn. Eat the chips, don’t bite yourself.' },
  { id: 'flappy', name: 'Flappy Chip', emoji: '🪙', how: 'Space / click / tap to flap through the gaps between the cards.' },
  { id: 'bricks', name: 'Brick Breaker', emoji: '🧱', how: 'Move the paddle with the mouse, your finger or ←/→. Clear every brick.' },
];

const BEST_KEY = 'jackpot-tycoon:arcade';

function loadBest(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function saveBest(b: Record<string, number>): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* private window: scores just aren't kept */
  }
}

/** A running game: step it, draw it, feed it input. */
export interface ArcadeSim {
  score: number;
  over: boolean;
  step(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  key(code: string): void;
  /** Pointer at x (0..1 across the screen), or a tap / click. */
  pointer(x: number, tap: boolean): void;
}

const W = 320;
const H = 320;

// ---------------------------------------------------------------- Snake

export class Snake implements ArcadeSim {
  static N = 16;
  score = 0;
  over = false;
  body: [number, number][] = [[8, 8], [7, 8], [6, 8]];
  dir: [number, number] = [1, 0];
  private next: [number, number] = [1, 0];
  food: [number, number] = [12, 8];
  private acc = 0;
  constructor(private rnd: () => number = Math.random) {
    this.placeFood();
  }
  get interval(): number {
    return Math.max(0.06, 0.16 - this.score * 0.004);
  }
  private placeFood(): void {
    const N = Snake.N;
    for (let i = 0; i < 400; i++) {
      const f: [number, number] = [Math.floor(this.rnd() * N), Math.floor(this.rnd() * N)];
      if (!this.body.some(([x, y]) => x === f[0] && y === f[1])) {
        this.food = f;
        return;
      }
    }
  }
  turn(dx: number, dy: number): void {
    // No turning straight back into yourself.
    if (dx === -this.dir[0] && dy === -this.dir[1]) return;
    this.next = [dx, dy];
  }
  key(code: string): void {
    if (code === 'ArrowUp' || code === 'KeyW') this.turn(0, -1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.turn(0, 1);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.turn(-1, 0);
    else if (code === 'ArrowRight' || code === 'KeyD') this.turn(1, 0);
  }
  pointer(): void {}
  /** One move of the snake. */
  tick(): void {
    if (this.over) return;
    this.dir = this.next;
    const N = Snake.N;
    const [hx, hy] = this.body[0];
    const nx = hx + this.dir[0];
    const ny = hy + this.dir[1];
    const eat = nx === this.food[0] && ny === this.food[1];
    // The tail moves out of the way unless you just ate.
    const rest = eat ? this.body : this.body.slice(0, -1);
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || rest.some(([x, y]) => x === nx && y === ny)) {
      this.over = true;
      return;
    }
    this.body = [[nx, ny], ...rest];
    if (eat) {
      this.score++;
      audio.play('coin', { volume: 0.4 });
      this.placeFood();
    }
  }
  step(dt: number): void {
    this.acc += dt;
    while (this.acc >= this.interval && !this.over) {
      this.acc -= this.interval;
      this.tick();
    }
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const c = W / Snake.N;
    ctx.fillStyle = '#0c1a12';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(57,255,136,0.06)';
    for (let i = 0; i <= Snake.N; i++) {
      ctx.beginPath();
      ctx.moveTo(i * c, 0);
      ctx.lineTo(i * c, H);
      ctx.moveTo(0, i * c);
      ctx.lineTo(W, i * c);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc((this.food[0] + 0.5) * c, (this.food[1] + 0.5) * c, c * 0.38, 0, Math.PI * 2);
    ctx.fill();
    this.body.forEach(([x, y], i) => {
      ctx.fillStyle = i === 0 ? '#9dffc6' : '#39ff88';
      ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
    });
  }
}

// ---------------------------------------------------------------- Flappy Chip

export class Flappy implements ArcadeSim {
  score = 0;
  over = false;
  y = H / 2;
  vy = 0;
  started = false;
  pipes: { x: number; gap: number; passed: boolean }[] = [];
  private spawn = 0;
  constructor(private rnd: () => number = Math.random) {}
  flap(): void {
    if (this.over) return;
    this.started = true;
    this.vy = -230;
    audio.play('whoosh', { volume: 0.25, pitch: 1.6 });
  }
  key(code: string): void {
    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') this.flap();
  }
  pointer(_x: number, tap: boolean): void {
    if (tap) this.flap();
  }
  step(dt: number): void {
    if (this.over || !this.started) return;
    this.vy += 700 * dt;
    this.y += this.vy * dt;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      this.spawn = 1.45;
      this.pipes.push({ x: W + 30, gap: 70 + this.rnd() * (H - 180), passed: false });
    }
    const speed = 110 + Math.min(60, this.score * 3);
    for (const p of this.pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x + 24 < 70) {
        p.passed = true;
        this.score++;
        audio.play('coin', { volume: 0.35 });
      }
      // The chip (r 11 at x 70) against the card (x..x+48) with a 95 px gap.
      if (70 + 11 > p.x && 70 - 11 < p.x + 48 && (this.y - 11 < p.gap || this.y + 11 > p.gap + 95)) this.over = true;
    }
    this.pipes = this.pipes.filter((p) => p.x > -60);
    if (this.y > H - 11 || this.y < 11) this.over = true;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b1036');
    sky.addColorStop(1, '#4a1d5e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const p of this.pipes) {
      for (const [y0, y1] of [[0, p.gap], [p.gap + 95, H]]) {
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(p.x, y0, 48, y1 - y0);
        ctx.strokeStyle = '#c8102e';
        ctx.lineWidth = 3;
        ctx.strokeRect(p.x + 3, y0 + 3, 42, y1 - y0 - 6);
      }
    }
    ctx.save();
    ctx.translate(70, this.y);
    ctx.rotate(Math.max(-0.5, Math.min(0.9, this.vy / 500)));
    ctx.fillStyle = '#c8102e';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (!this.started) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tap / Space to flap', W / 2, H / 2 + 50);
    }
  }
}

// ---------------------------------------------------------------- Brick Breaker

export class Bricks implements ArcadeSim {
  score = 0;
  over = false;
  paddle = W / 2;
  ball = { x: W / 2, y: H - 40, vx: 120, vy: -200 };
  bricks: { x: number; y: number; alive: boolean; c: string }[] = [];
  private keys = 0;
  won = false;
  constructor() {
    const colors = ['#ff3fa4', '#ffd24a', '#39ff88', '#2fe6ff', '#9b7bff'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) this.bricks.push({ x: 8 + c * 38.5, y: 30 + r * 16, alive: true, c: colors[r] });
  }
  key(code: string): void {
    if (code === 'ArrowLeft' || code === 'KeyA') this.keys = -1;
    else if (code === 'ArrowRight' || code === 'KeyD') this.keys = 1;
    else if (code === 'stop') this.keys = 0;
  }
  pointer(x: number): void {
    this.paddle = Math.max(30, Math.min(W - 30, x * W));
  }
  step(dt: number): void {
    if (this.over) return;
    this.paddle = Math.max(30, Math.min(W - 30, this.paddle + this.keys * 320 * dt));
    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 5 || b.x > W - 5) {
      b.vx = -b.vx;
      b.x = Math.max(5, Math.min(W - 5, b.x));
    }
    if (b.y < 5) {
      b.vy = Math.abs(b.vy);
    }
    // The paddle sends the ball off at an angle from where it hit.
    if (b.vy > 0 && b.y > H - 26 && b.y < H - 14 && Math.abs(b.x - this.paddle) < 32) {
      const sp = Math.min(420, Math.hypot(b.vx, b.vy) * 1.02);
      const a = ((b.x - this.paddle) / 32) * 1.05;
      b.vx = Math.sin(a) * sp;
      b.vy = -Math.cos(a) * sp;
      audio.play('ping', { volume: 0.3 });
    }
    for (const k of this.bricks) {
      if (!k.alive) continue;
      if (b.x > k.x - 4 && b.x < k.x + 36 + 4 && b.y > k.y - 4 && b.y < k.y + 12 + 4) {
        k.alive = false;
        this.score += 10;
        b.vy = -b.vy;
        audio.play('clack', { volume: 0.3 });
        break;
      }
    }
    if (!this.bricks.some((k) => k.alive)) {
      this.won = true;
      this.over = true;
    }
    if (b.y > H + 10) this.over = true;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0d0b1e';
    ctx.fillRect(0, 0, W, H);
    for (const k of this.bricks) {
      if (!k.alive) continue;
      ctx.fillStyle = k.c;
      ctx.fillRect(k.x, k.y, 36, 12);
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(this.paddle - 30, H - 20, 60, 8);
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeArcade(id: ArcadeId): ArcadeSim {
  return id === 'snake' ? new Snake() : id === 'flappy' ? new Flappy() : new Bricks();
}

/** The monitor: pick a game, play, try to beat your best. */
export function openArcade(modals: Modals, title: string, onClose?: () => void): void {
  const best = loadBest();
  const body = h('div', { class: 'arcade' });
  let raf = 0;
  let sim: ArcadeSim | null = null;
  let current: ArcadeId = 'snake';
  const canvas = h('canvas', { class: 'arcade-screen' }) as HTMLCanvasElement;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const scoreEl = h('div', { class: 'arcade-score' });
  const how = h('p', { class: 'muted small' });
  const tabs = h('div', { class: 'seg' });
  const again = h('button', { class: 'btn gold', text: 'Play again', onClick: () => start(current) });

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const showScore = () => {
    if (!sim) return;
    scoreEl.textContent = `Score ${sim.score} · Best ${best[current] ?? 0}`;
  };
  const finish = () => {
    if (!sim) return;
    const s = sim.score;
    const record = s > (best[current] ?? 0);
    if (record) {
      best[current] = s;
      saveBest(best);
    }
    audio.play(record && s > 0 ? 'win' : 'bust', { volume: 0.5 });
    showScore();
    if (ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(sim instanceof Bricks && sim.won ? 'YOU WIN!' : 'GAME OVER', W / 2, H / 2 - 10);
      ctx.font = '16px sans-serif';
      ctx.fillText(record && s > 0 ? `New best: ${s}!` : `Score ${s}`, W / 2, H / 2 + 20);
    }
    again.hidden = false;
  };
  const start = (id: ArcadeId) => {
    stop();
    current = id;
    sim = makeArcade(id);
    again.hidden = true;
    how.textContent = ARCADE_GAMES.find((g) => g.id === id)!.how;
    clear(tabs);
    for (const g of ARCADE_GAMES) tabs.appendChild(h('button', { class: `btn small${g.id === id ? ' gold' : ''}`, text: `${g.emoji} ${g.name}`, onClick: () => start(g.id) }));
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (!sim) return;
      sim.step(dt);
      if (ctx) sim.draw(ctx);
      showScore();
      if (sim.over) {
        raf = 0;
        finish();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    audio.play('blip');
  };

  const onKey = (e: KeyboardEvent) => {
    if (!sim || !canvas.isConnected) return;
    if (/^(Arrow|Space$|Key[WASD]$)/.test(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Space' && sim.over) start(current);
      else sim.key(e.code);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (sim && /^(ArrowLeft|ArrowRight|KeyA|KeyD)$/.test(e.code)) sim.key('stop');
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  const rel = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointermove', (e) => sim?.pointer(rel(e).x, false));
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = rel(e);
    sim?.pointer(down.x, true);
  });
  // Swipes steer the snake.
  canvas.addEventListener('pointerup', (e) => {
    const p = rel(e);
    if (down && sim instanceof Snake) {
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.06) {
        if (Math.abs(dx) > Math.abs(dy)) sim.turn(Math.sign(dx), 0);
        else sim.turn(0, Math.sign(dy));
      }
    }
    down = null;
  });

  body.append(tabs, canvas, scoreEl, how, again);
  modals.open(title, body, {
    cls: 'minigame arcade-modal',
    onClose: () => {
      stop();
      sim = null;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      onClose?.();
    },
  });
  start('snake');
}
