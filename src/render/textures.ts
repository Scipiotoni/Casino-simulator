import * as THREE from 'three';

/** Deterministic PRNG so procedural textures look identical every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

let maxAniso = 4;
export function setMaxAnisotropy(n: number): void {
  maxAniso = n;
}

export function canvasTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

/** Draw something at (x,y) plus its wrapped copies so repeating textures stay seamless. */
function wrapDraw(S: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * S;
      const py = y + oy * S;
      if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
      fn(px, py);
    }
  }
}

function speckle(ctx: CanvasRenderingContext2D, S: number, amount: number, rnd: () => number, light = true): void {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 255 * amount * (light ? 1 : -1);
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points = 5, inner = 0.45, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i * Math.PI) / points;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ------------------------------------------------------------------ floor styles

export interface FloorStyle {
  id: string;
  name: string;
  price: number;
  swatch: string;
  emissive?: boolean;
  rough: number;
  metal?: number;
  draw: (ctx: CanvasRenderingContext2D, S: number) => void;
}

export const FLOOR_STYLES: FloorStyle[] = [
  {
    id: 'royal', name: 'Royal Crimson', price: 8, swatch: '#7a1026', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(11);
      ctx.fillStyle = '#5c0a1a';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.08, rnd);
      const q = S / 4;
      // Darker diamonds
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          if ((i + j) % 2 !== 1) continue;
          const x = i * q;
          const y = j * q;
          ctx.fillStyle = 'rgba(40, 0, 10, 0.35)';
          ctx.beginPath();
          ctx.moveTo(x, y - q * 0.8);
          ctx.lineTo(x + q * 0.8, y);
          ctx.lineTo(x, y + q * 0.8);
          ctx.lineTo(x - q * 0.8, y);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(226, 168, 64, 0.62)';
      ctx.lineWidth = S * 0.01;
      const P = S / 2;
      for (let k = -3; k <= 5; k++) {
        ctx.beginPath();
        ctx.moveTo(-S, k * P - S);
        ctx.lineTo(2 * S, k * P + 2 * S);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-S, k * P + S);
        ctx.lineTo(2 * S, k * P - 2 * S);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          const x = i * q;
          const y = j * q;
          if ((i + j) % 2 === 0) {
            ctx.fillStyle = '#f5c75a';
            ctx.beginPath();
            ctx.arc(x, y, S * 0.018, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = 'rgba(235, 186, 84, 0.62)';
            for (let p = 0; p < 4; p++) {
              const a = (p * Math.PI) / 2;
              ctx.beginPath();
              ctx.ellipse(x + Math.cos(a) * S * 0.025, y + Math.sin(a) * S * 0.025, S * 0.022, S * 0.01, a, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    },
  },
  {
    id: 'midnight', name: 'Midnight Stars', price: 8, swatch: '#16225a', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(23);
      ctx.fillStyle = '#121c4d';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.07, rnd);
      for (let i = 0; i < 16; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = S * (0.03 + rnd() * 0.05);
        wrapDraw(S, x, y, r * 1.4, (px, py) => {
          ctx.strokeStyle = rnd() < 0.5 ? 'rgba(80, 220, 255, 0.55)' : 'rgba(255, 90, 170, 0.45)';
          ctx.lineWidth = S * 0.008;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
      for (let i = 0; i < 26; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = S * (0.012 + rnd() * 0.03);
        const rot = rnd() * Math.PI;
        const col = rnd() < 0.7 ? '#ffcf4d' : '#fff3c4';
        wrapDraw(S, x, y, r, (px, py) => {
          ctx.fillStyle = col;
          star(ctx, px, py, r, 5, 0.42, rot);
          ctx.fill();
        });
      }
    },
  },
  {
    id: 'emerald', name: 'Emerald Swirl', price: 10, swatch: '#0f5a3c', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(37);
      ctx.fillStyle = '#0c4631';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.07, rnd);
      const n = 4;
      const c = S / n;
      ctx.lineWidth = S * 0.014;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = i * c;
          const y = j * c;
          const flip = rnd() < 0.5;
          ctx.strokeStyle = 'rgba(240, 190, 80, 0.85)';
          ctx.beginPath();
          if (flip) {
            ctx.arc(x, y, c / 2, 0, Math.PI / 2);
            ctx.moveTo(x + c, y + c / 2);
            ctx.arc(x + c, y + c, c / 2, -Math.PI / 2, Math.PI, true);
          } else {
            ctx.arc(x + c, y, c / 2, Math.PI / 2, Math.PI);
            ctx.moveTo(x + c / 2, y + c);
            ctx.arc(x, y + c, c / 2, 0, -Math.PI / 2, true);
          }
          ctx.stroke();
          ctx.fillStyle = 'rgba(120, 230, 170, 0.35)';
          ctx.beginPath();
          ctx.arc(x + c / 2, y + c / 2, S * 0.012, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'vegas', name: 'Vegas Retro', price: 10, swatch: '#40165c', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(51);
      ctx.fillStyle = '#35104d';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.06, rnd);
      const cols = ['#ff4fa3', '#39e0d0', '#ffd23f', '#8c7bff', '#ff8a3d'];
      for (let i = 0; i < 34; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = S * (0.02 + rnd() * 0.045);
        const kind = Math.floor(rnd() * 4);
        const col = cols[Math.floor(rnd() * cols.length)];
        const rot = rnd() * Math.PI * 2;
        wrapDraw(S, x, y, r * 2, (px, py) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot);
          ctx.fillStyle = col;
          ctx.strokeStyle = col;
          ctx.lineWidth = S * 0.009;
          ctx.beginPath();
          if (kind === 0) {
            ctx.moveTo(0, -r);
            ctx.lineTo(r * 0.9, r * 0.7);
            ctx.lineTo(-r * 0.9, r * 0.7);
            ctx.closePath();
            ctx.fill();
          } else if (kind === 1) {
            ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
            ctx.stroke();
          } else if (kind === 2) {
            ctx.moveTo(-r * 1.4, 0);
            ctx.bezierCurveTo(-r * 0.6, -r, -r * 0.2, r, r * 0.6, 0);
            ctx.bezierCurveTo(r, -r * 0.5, r * 1.3, -r * 0.2, r * 1.5, 0);
            ctx.stroke();
          } else {
            ctx.fillRect(-r * 0.5, -r * 0.5, r, r);
          }
          ctx.restore();
        });
      }
    },
  },
  {
    id: 'checker', name: 'Classic Checker', price: 12, swatch: '#222', rough: 0.35,
    draw(ctx, S) {
      const rnd = seeded(61);
      const n = 4;
      const c = S / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#16131c' : '#ece8f0';
          ctx.fillRect(i * c, j * c, c, c);
        }
      }
      speckle(ctx, S, 0.05, rnd);
      ctx.strokeStyle = 'rgba(120, 110, 130, 0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(i * c, 0);
        ctx.lineTo(i * c, S);
        ctx.moveTo(0, i * c);
        ctx.lineTo(S, i * c);
        ctx.stroke();
      }
    },
  },
  {
    id: 'marble', name: 'White Marble', price: 14, swatch: '#e6e2ea', rough: 0.25,
    draw(ctx, S) {
      const rnd = seeded(71);
      ctx.fillStyle = '#e8e4ec';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.05, rnd);
      for (let i = 0; i < 9; i++) {
        let x = rnd() * S;
        let y = rnd() * S;
        ctx.strokeStyle = `rgba(${120 + rnd() * 40}, ${110 + rnd() * 30}, ${140 + rnd() * 30}, ${0.18 + rnd() * 0.25})`;
        ctx.lineWidth = 1 + rnd() * 2.5;
        const pts: [number, number][] = [[x, y]];
        for (let k = 0; k < 7; k++) {
          x += (rnd() - 0.3) * S * 0.18;
          y += (rnd() - 0.5) * S * 0.18;
          pts.push([x, y]);
        }
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
          for (const p of pts) ctx.lineTo(p[0] + ox, p[1] + oy);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(180, 170, 190, 0.8)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo((i * S) / 2, 0);
        ctx.lineTo((i * S) / 2, S);
        ctx.moveTo(0, (i * S) / 2);
        ctx.lineTo(S, (i * S) / 2);
        ctx.stroke();
      }
    },
  },
  {
    id: 'gold', name: 'Gold Tiles', price: 25, swatch: '#d9a53a', rough: 0.3, metal: 0.55,
    draw(ctx, S) {
      const rnd = seeded(81);
      ctx.fillStyle = '#2b1d08';
      ctx.fillRect(0, 0, S, S);
      const n = 4;
      const c = S / n;
      const g = S * 0.012;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const grad = ctx.createLinearGradient(i * c, j * c, i * c + c, j * c + c);
          const l = 0.9 + rnd() * 0.2;
          grad.addColorStop(0, `rgb(${255 * l | 0}, ${214 * l | 0}, ${110 * l | 0})`);
          grad.addColorStop(0.5, `rgb(${226 * l | 0}, ${168 * l | 0}, ${58 * l | 0})`);
          grad.addColorStop(1, `rgb(${170 * l | 0}, ${118 * l | 0}, ${30 * l | 0})`);
          ctx.fillStyle = grad;
          ctx.fillRect(i * c + g, j * c + g, c - 2 * g, c - 2 * g);
        }
      }
      speckle(ctx, S, 0.04, rnd);
    },
  },
  {
    id: 'parquet', name: 'Oak Parquet', price: 12, swatch: '#9a6434', rough: 0.55,
    draw(ctx, S) {
      const rnd = seeded(91);
      const rows = 8;
      const h = S / rows;
      for (let r = 0; r < rows; r++) {
        let x = r % 2 === 0 ? 0 : -S / 6;
        while (x < S) {
          const w = S / 3;
          const l = 0.75 + rnd() * 0.35;
          ctx.fillStyle = `rgb(${150 * l | 0}, ${96 * l | 0}, ${50 * l | 0})`;
          ctx.fillRect(x, r * h, w, h);
          ctx.fillStyle = 'rgba(60, 30, 10, 0.18)';
          for (let k = 0; k < 4; k++) ctx.fillRect(x, r * h + rnd() * h, w, 1);
          ctx.fillStyle = '#3b220f';
          ctx.fillRect(x, r * h, 2, h);
          if (x < 0) {
            ctx.fillStyle = `rgb(${150 * l | 0}, ${96 * l | 0}, ${50 * l | 0})`;
            ctx.fillRect(x + S, r * h, -x, h);
          }
          x += w;
        }
        ctx.fillStyle = '#3b220f';
        ctx.fillRect(0, r * h, S, 2);
      }
      speckle(ctx, S, 0.04, rnd);
    },
  },
  {
    id: 'neon', name: 'Neon Grid', price: 20, swatch: '#0b0816', emissive: true, rough: 0.4,
    draw(ctx, S) {
      ctx.fillStyle = '#07050d';
      ctx.fillRect(0, 0, S, S);
      const n = 4;
      const c = S / n;
      ctx.shadowBlur = 10;
      for (let i = 0; i <= n; i++) {
        const col = i % 2 === 0 ? '#ff3fa4' : '#2fe6ff';
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.lineWidth = i % 2 === 0 ? 4 : 2.5;
        ctx.beginPath();
        ctx.moveTo(i * c, 0);
        ctx.lineTo(i * c, S);
        ctx.moveTo(0, i * c);
        ctx.lineTo(S, i * c);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    },
  },
  {
    id: 'leopard', name: 'Leopard Luxe', price: 15, swatch: '#c89652', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(101);
      ctx.fillStyle = '#c99656';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.08, rnd);
      for (let i = 0; i < 30; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = S * (0.025 + rnd() * 0.03);
        const rot = rnd() * Math.PI;
        wrapDraw(S, x, y, r * 1.6, (px, py) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot);
          ctx.fillStyle = '#3a2412';
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r * 0.8, r * 0.42, r * 0.26, a, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#9a6a33';
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }
    },
  },
  {
    id: 'ocean', name: 'Ocean Waves', price: 10, swatch: '#0f5f6e', rough: 0.95,
    draw(ctx, S) {
      const rnd = seeded(111);
      ctx.fillStyle = '#0d4d5c';
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.06, rnd);
      ctx.lineWidth = S * 0.012;
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * (S / rows);
        ctx.strokeStyle = r % 2 === 0 ? 'rgba(120, 240, 230, 0.55)' : 'rgba(255, 210, 120, 0.45)';
        ctx.beginPath();
        for (let x = 0; x <= S; x += 4) {
          const yy = y + Math.sin((x / S) * Math.PI * 4 + r) * S * 0.02;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    },
  },
  {
    id: 'velvet', name: 'Plum Velvet', price: 8, swatch: '#4a1240', rough: 1,
    draw(ctx, S) {
      const rnd = seeded(121);
      const grad = ctx.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, '#4c1242');
      grad.addColorStop(0.5, '#5a1850');
      grad.addColorStop(1, '#4c1242');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, 0.1, rnd);
      ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
      const q = S / 4;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          ctx.beginPath();
          ctx.arc(i * q + q / 2, j * q + q / 2, S * 0.01, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
];

const floorTexCache = new Map<string, THREE.CanvasTexture>();

export function floorTexture(styleIndex: number): THREE.CanvasTexture {
  const style = FLOOR_STYLES[styleIndex] ?? FLOOR_STYLES[0];
  let t = floorTexCache.get(style.id);
  if (!t) {
    const S = 256;
    const { canvas, ctx } = makeCanvas(S, S);
    style.draw(ctx, S);
    t = canvasTexture(canvas, true);
    floorTexCache.set(style.id, t);
  }
  return t;
}

// ------------------------------------------------------------------ slot symbols

export type SlotSymbol = 'seven' | 'bar' | 'cherry' | 'lemon' | 'bell' | 'diamond' | 'star' | 'grape';
export const REEL_SYMBOLS: SlotSymbol[] = ['seven', 'cherry', 'bar', 'lemon', 'bell', 'grape', 'diamond', 'star'];

export function drawSymbol(ctx: CanvasRenderingContext2D, sym: SlotSymbol, size: number): void {
  const s = size;
  ctx.save();
  ctx.lineJoin = 'round';
  switch (sym) {
    case 'seven': {
      ctx.font = `900 ${s * 0.9}px Bungee, "Arial Black", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = s * 0.08;
      ctx.strokeStyle = '#ffd24a';
      ctx.strokeText('7', 0, s * 0.04);
      ctx.fillStyle = '#e8132d';
      ctx.fillText('7', 0, s * 0.04);
      break;
    }
    case 'bar': {
      ctx.fillStyle = '#16121e';
      roundRect(ctx, -s * 0.42, -s * 0.2, s * 0.84, s * 0.4, s * 0.08);
      ctx.fill();
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = s * 0.04;
      ctx.stroke();
      ctx.font = `900 ${s * 0.26}px Bungee, "Arial Black", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText('BAR', 0, s * 0.02);
      break;
    }
    case 'cherry': {
      ctx.strokeStyle = '#2f8f2f';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, s * 0.1);
      ctx.quadraticCurveTo(-s * 0.05, -s * 0.25, s * 0.15, -s * 0.36);
      ctx.moveTo(s * 0.2, s * 0.08);
      ctx.quadraticCurveTo(s * 0.15, -s * 0.2, s * 0.15, -s * 0.36);
      ctx.stroke();
      ctx.fillStyle = '#4caf50';
      ctx.beginPath();
      ctx.ellipse(s * 0.24, -s * 0.34, s * 0.12, s * 0.06, -0.4, 0, Math.PI * 2);
      ctx.fill();
      for (const [x, y] of [[-s * 0.2, s * 0.2], [s * 0.2, s * 0.18]]) {
        const g = ctx.createRadialGradient(x - s * 0.05, y - s * 0.05, s * 0.02, x, y, s * 0.18);
        g.addColorStop(0, '#ff7a8a');
        g.addColorStop(1, '#b3001b');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'lemon': {
      const g = ctx.createRadialGradient(-s * 0.1, -s * 0.1, s * 0.05, 0, 0, s * 0.4);
      g.addColorStop(0, '#fff7a0');
      g.addColorStop(1, '#f2c200');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.38, s * 0.27, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c79a00';
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
      break;
    }
    case 'bell': {
      const g = ctx.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
      g.addColorStop(0, '#b87a00');
      g.addColorStop(0.5, '#ffe066');
      g.addColorStop(1, '#b87a00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.22);
      ctx.quadraticCurveTo(-s * 0.3, -s * 0.36, 0, -s * 0.36);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.36, s * 0.34, s * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-s * 0.38, s * 0.2, s * 0.76, s * 0.07);
      ctx.fillStyle = '#8a5a00';
      ctx.beginPath();
      ctx.arc(0, s * 0.32, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'diamond': {
      ctx.fillStyle = '#35d7ff';
      ctx.beginPath();
      ctx.moveTo(-s * 0.36, -s * 0.1);
      ctx.lineTo(-s * 0.2, -s * 0.3);
      ctx.lineTo(s * 0.2, -s * 0.3);
      ctx.lineTo(s * 0.36, -s * 0.1);
      ctx.lineTo(0, s * 0.36);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b8f3ff';
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.3);
      ctx.lineTo(0, -s * 0.1);
      ctx.lineTo(s * 0.2, -s * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#0a7fa8';
      ctx.lineWidth = s * 0.025;
      ctx.beginPath();
      ctx.moveTo(-s * 0.36, -s * 0.1);
      ctx.lineTo(s * 0.36, -s * 0.1);
      ctx.moveTo(0, -s * 0.1);
      ctx.lineTo(0, s * 0.36);
      ctx.stroke();
      break;
    }
    case 'star': {
      ctx.fillStyle = '#ffcc1f';
      star(ctx, 0, s * 0.02, s * 0.38, 5, 0.45);
      ctx.fill();
      ctx.strokeStyle = '#c47a00';
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
      break;
    }
    case 'grape': {
      ctx.fillStyle = '#6a2cc2';
      const pts = [[0, -0.2], [-0.13, -0.08], [0.13, -0.08], [0, 0.04], [-0.13, 0.16], [0.13, 0.16], [0, 0.28], [-0.24, 0.02], [0.24, 0.02]];
      for (const [x, y] of pts) {
        const g = ctx.createRadialGradient((x - 0.03) * s, (y - 0.03) * s, s * 0.01, x * s, y * s, s * 0.1);
        g.addColorStop(0, '#c89bff');
        g.addColorStop(1, '#4a1590');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x * s, y * s, s * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#3c9b3c';
      ctx.fillRect(-s * 0.02, -s * 0.38, s * 0.04, s * 0.12);
      break;
    }
  }
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

let reelTex: THREE.CanvasTexture | null = null;

/**
 * Reel strip wrapped around a cylinder whose axis points along world X. Symbols are drawn
 * rotated so they read upright on the drum (see slot model for the matching math).
 */
export function reelTexture(): THREE.CanvasTexture {
  if (reelTex) return reelTex;
  const N = REEL_SYMBOLS.length;
  const cell = 128;
  const { canvas, ctx } = makeCanvas(cell * N, cell);
  ctx.fillStyle = '#fbf7ee';
  ctx.fillRect(0, 0, cell * N, cell);
  for (let i = 0; i < N; i++) {
    const cx = (i + 0.5) * cell;
    ctx.fillStyle = i % 2 === 0 ? '#fffdf6' : '#f1ece0';
    ctx.fillRect(i * cell, 0, cell, cell);
    ctx.save();
    ctx.translate(cx, cell / 2);
    ctx.rotate(Math.PI / 2);
    drawSymbol(ctx, REEL_SYMBOLS[i], cell * 0.82);
    ctx.restore();
  }
  reelTex = canvasTexture(canvas);
  return reelTex;
}

// ------------------------------------------------------------------ text textures

export interface TextTexOpts {
  font?: string;
  color?: string;
  glow?: string;
  bg?: string | null;
  border?: string | null;
  w?: number;
  h?: number;
  weight?: string;
  padding?: number;
}

export function drawNeonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  font: string,
  color: string,
  weight = '400',
): void {
  let size = maxH;
  ctx.font = `${weight} ${size}px ${font}`;
  let w = ctx.measureText(text).width;
  if (w > maxW) {
    size = Math.max(8, (size * maxW) / w);
    ctx.font = `${weight} ${size}px ${font}`;
    w = ctx.measureText(text).width;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.shadowBlur = size * 0.45;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = size * 0.2;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.globalAlpha = 0.55;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

const textTexCache = new Map<string, THREE.CanvasTexture>();

/** Cached neon label texture (slot toppers, table signs). */
export function labelTexture(text: string, o: TextTexOpts = {}): THREE.CanvasTexture {
  const key = JSON.stringify([text, o]);
  const cached = textTexCache.get(key);
  if (cached) return cached;
  const w = o.w ?? 256;
  const h = o.h ?? 64;
  const { canvas, ctx } = makeCanvas(w, h);
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = h * 0.08;
    roundRect(ctx, h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.15);
    ctx.stroke();
  }
  const pad = o.padding ?? h * 0.18;
  drawNeonText(ctx, text, w / 2, h / 2 + h * 0.03, w - pad * 2, h - pad * 2, o.font ?? 'Bungee, "Arial Black", sans-serif', o.color ?? '#ffd24a', o.weight ?? '400');
  const t = canvasTexture(canvas);
  textTexCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ table felts

let rouletteWheelTex: THREE.CanvasTexture | null = null;
export const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function rouletteColor(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

/** Top-down texture of the roulette wheel (pockets + numbers), mapped onto a disc. */
export function rouletteWheelTexture(): THREE.CanvasTexture {
  if (rouletteWheelTex) return rouletteWheelTex;
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const c = S / 2;
  ctx.fillStyle = '#3a1d0c';
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  const n = ROULETTE_ORDER.length;
  const outer = c * 0.94;
  const inner = c * 0.62;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    const num = ROULETTE_ORDER[i];
    const col = rouletteColor(num);
    ctx.fillStyle = col === 'red' ? '#c8102e' : col === 'black' ? '#141414' : '#0f8a3c';
    ctx.beginPath();
    ctx.arc(c, c, outer, a0, a1);
    ctx.arc(c, c, inner, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d9b25a';
    ctx.lineWidth = 2;
    ctx.stroke();
    const am = (a0 + a1) / 2;
    ctx.save();
    ctx.translate(c + Math.cos(am) * c * 0.85, c + Math.sin(am) * c * 0.85);
    ctx.rotate(am + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${S * 0.034}px Nunito, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  }
  const g = ctx.createRadialGradient(c, c, 0, c, c, inner);
  g.addColorStop(0, '#e8c46a');
  g.addColorStop(0.35, '#7a4a1c');
  g.addColorStop(1, '#4a2a10');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8c46a';
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner * 0.15, c + Math.sin(a) * inner * 0.15);
    ctx.lineTo(c + Math.cos(a) * inner * 0.8, c + Math.sin(a) * inner * 0.8);
    ctx.stroke();
  }
  rouletteWheelTex = canvasTexture(canvas);
  return rouletteWheelTex;
}

const feltCache = new Map<string, THREE.CanvasTexture>();

export function feltTexture(kind: 'roulette' | 'blackjack' | 'craps' | 'poker' | 'plain', feltColor: string): THREE.CanvasTexture {
  const key = kind + feltColor;
  const cached = feltCache.get(key);
  if (cached) return cached;
  const W = 512;
  const H = kind === 'plain' || kind === 'blackjack' ? 512 : 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = seeded(7);
  ctx.fillStyle = feltColor;
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, 0.05, rnd);
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.85)';
  ctx.fillStyle = 'rgba(255, 240, 200, 0.9)';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'roulette') {
    // Number grid on the right 70%
    const x0 = W * 0.3;
    const cw = (W * 0.66) / 12;
    const ch = H * 0.2;
    const y0 = H * 0.14;
    ctx.fillStyle = '#0f8a3c';
    ctx.fillRect(x0 - cw * 0.9, y0, cw * 0.9, ch * 3);
    ctx.strokeRect(x0 - cw * 0.9, y0, cw * 0.9, ch * 3);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${ch * 0.5}px Nunito, Arial, sans-serif`;
    ctx.fillText('0', x0 - cw * 0.45, y0 + ch * 1.5);
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 3; row++) {
        const num = col * 3 + (3 - row);
        const x = x0 + col * cw;
        const y = y0 + row * ch;
        ctx.fillStyle = rouletteColor(num) === 'red' ? '#c8102e' : '#141414';
        ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
        ctx.strokeStyle = 'rgba(255, 240, 200, 0.85)';
        ctx.strokeRect(x, y, cw, ch);
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${ch * 0.42}px Nunito, Arial, sans-serif`;
        ctx.fillText(String(num), x + cw / 2, y + ch / 2);
      }
    }
    const labels = ['1st 12', '2nd 12', '3rd 12'];
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * cw * 4;
      ctx.strokeRect(x, y0 + ch * 3, cw * 4, ch * 0.8);
      ctx.fillStyle = 'rgba(255, 240, 200, 0.95)';
      ctx.font = `800 ${ch * 0.36}px Nunito, Arial, sans-serif`;
      ctx.fillText(labels[i], x + cw * 2, y0 + ch * 3.4);
    }
    const bottoms = ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36'];
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * cw * 2;
      const y = y0 + ch * 3.8;
      if (bottoms[i] === 'RED' || bottoms[i] === 'BLACK') {
        ctx.fillStyle = bottoms[i] === 'RED' ? '#c8102e' : '#141414';
        ctx.beginPath();
        ctx.moveTo(x + cw, y + 6);
        ctx.lineTo(x + cw * 1.7, y + ch * 0.4);
        ctx.lineTo(x + cw, y + ch * 0.74);
        ctx.lineTo(x + cw * 0.3, y + ch * 0.4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255, 240, 200, 0.95)';
        ctx.font = `800 ${ch * 0.32}px Nunito, Arial, sans-serif`;
        ctx.fillText(bottoms[i], x + cw, y + ch * 0.4);
      }
      ctx.strokeRect(x, y, cw * 2, ch * 0.8);
    }
  } else if (kind === 'blackjack') {
    // Mapped onto a half-disc: only the lower half of the square canvas is visible,
    // with the dealer at the top edge (canvas y = H/2) and players around the arc.
    const cx = W / 2;
    const cy = H / 2;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, W * 0.36, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();
    ctx.font = `400 ${W * 0.042}px Bungee, "Arial Black", sans-serif`;
    ctx.fillText('BLACKJACK PAYS 3 TO 2', cx, cy + H * 0.12);
    ctx.font = `700 ${W * 0.028}px Nunito, Arial, sans-serif`;
    ctx.fillText('Dealer must draw to 16 and stand on all 17s', cx, cy + H * 0.18);
    ctx.font = `700 ${W * 0.024}px Nunito, Arial, sans-serif`;
    ctx.fillText('INSURANCE PAYS 2 TO 1', cx, cy + H * 0.25);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.25 + i * 0.25);
      const x = cx + Math.cos(a) * W * 0.4;
      const y = cy + Math.sin(a) * W * 0.4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a - Math.PI / 2);
      ctx.strokeRect(-20, -26, 40, 52);
      ctx.beginPath();
      ctx.arc(0, 44, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  } else if (kind === 'craps') {
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.font = `400 ${H * 0.1}px Bungee, "Arial Black", sans-serif`;
    ctx.fillText('PASS LINE', W / 2, H * 0.84);
    ctx.strokeRect(30, H * 0.72, W - 60, H * 0.22);
    ctx.font = `400 ${H * 0.085}px Bungee, "Arial Black", sans-serif`;
    ctx.fillText('FIELD  2 · 3 · 4 · 9 · 10 · 11 · 12', W / 2, H * 0.58);
    ctx.strokeRect(30, H * 0.48, W - 60, H * 0.2);
    ctx.fillText('COME', W / 2, H * 0.36);
    ctx.strokeRect(30, H * 0.26, W - 60, H * 0.2);
    for (let i = 0; i < 6; i++) {
      const x = 50 + i * ((W - 100) / 6);
      ctx.strokeRect(x, 26, (W - 100) / 6 - 8, H * 0.18);
      ctx.font = `800 ${H * 0.09}px Nunito, Arial, sans-serif`;
      ctx.fillText(String([4, 5, 6, 8, 9, 10][i]), x + (W - 100) / 12 - 4, 26 + H * 0.09);
    }
  } else if (kind === 'poker') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.34, H * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `400 ${H * 0.09}px Bungee, "Arial Black", sans-serif`;
    ctx.fillText("HOLD'EM", W / 2, H / 2);
  }
  const t = canvasTexture(canvas);
  feltCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ cards

const cardCache = new Map<string, THREE.CanvasTexture>();
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function cardTexture(rank: number, suit: number): THREE.CanvasTexture {
  const key = `${rank}-${suit}`;
  const cached = cardCache.get(key);
  if (cached) return cached;
  const { canvas, ctx } = makeCanvas(64, 90);
  ctx.fillStyle = '#fdfcf8';
  roundRect(ctx, 0, 0, 64, 90, 6);
  ctx.fill();
  const red = suit === 1 || suit === 2;
  ctx.fillStyle = red ? '#d0102a' : '#16121c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 22px Nunito, Arial, sans-serif';
  ctx.fillText(RANKS[rank], 16, 16);
  ctx.font = '700 36px Arial, sans-serif';
  ctx.fillText(SUITS[suit], 34, 56);
  const t = canvasTexture(canvas);
  cardCache.set(key, t);
  return t;
}

let cardBack: THREE.CanvasTexture | null = null;
export function cardBackTexture(): THREE.CanvasTexture {
  if (cardBack) return cardBack;
  const { canvas, ctx } = makeCanvas(64, 90);
  ctx.fillStyle = '#fdfcf8';
  roundRect(ctx, 0, 0, 64, 90, 6);
  ctx.fill();
  ctx.fillStyle = '#b3122e';
  roundRect(ctx, 5, 5, 54, 80, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = -90; i < 90; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 90, 90);
    ctx.moveTo(i + 90, 0);
    ctx.lineTo(i, 90);
    ctx.stroke();
  }
  cardBack = canvasTexture(canvas);
  return cardBack;
}

// ------------------------------------------------------------------ misc

let coinTex: THREE.CanvasTexture | null = null;
export function coinTexture(): THREE.CanvasTexture {
  if (coinTex) return coinTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(50, 45, 10, 64, 64, 64);
  g.addColorStop(0, '#fff2a8');
  g.addColorStop(0.6, '#f5b921');
  g.addColorStop(1, '#b77800');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a86a00';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 50, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#a86a00';
  ctx.font = '400 72px Bungee, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 64, 70);
  coinTex = canvasTexture(canvas);
  return coinTex;
}

let wheelTex: THREE.CanvasTexture | null = null;
export const WHEEL_SEGMENTS: { label: string; mult: number; color: string }[] = (() => {
  const pattern = [1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 2, 20, 1, 2, 1, 5, 10, 1, 2, 1, 40];
  const colors: Record<number, string> = { 1: '#f5c542', 2: '#2e9df7', 5: '#9b59ff', 10: '#2ecc71', 20: '#ff7a1a', 40: '#e8132d' };
  return pattern.map((m) => ({ label: m === 40 ? '★' : `$${m}`, mult: m, color: colors[m] }));
})();

export function bigWheelTexture(): THREE.CanvasTexture {
  if (wheelTex) return wheelTex;
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const c = S / 2;
  const n = WHEEL_SEGMENTS.length;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    ctx.fillStyle = WHEEL_SEGMENTS[i].color;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, c * 0.98, a0, a1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff6d8';
    ctx.lineWidth = 3;
    ctx.stroke();
    const am = (a0 + a1) / 2;
    ctx.save();
    ctx.translate(c + Math.cos(am) * c * 0.72, c + Math.sin(am) * c * 0.72);
    ctx.rotate(am + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.font = `400 ${S * 0.05}px Bungee, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(WHEEL_SEGMENTS[i].label, 0, 0);
    ctx.fillText(WHEEL_SEGMENTS[i].label, 0, 0);
    ctx.restore();
  }
  const g = ctx.createRadialGradient(c - 10, c - 10, 5, c, c, c * 0.22);
  g.addColorStop(0, '#fff2a8');
  g.addColorStop(1, '#b77800');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.2, 0, Math.PI * 2);
  ctx.fill();
  wheelTex = canvasTexture(canvas);
  return wheelTex;
}

let wallTex: THREE.CanvasTexture | null = null;
/** Light greyscale panelling; tinted by the wall material color. */
export function wallTexture(): THREE.CanvasTexture {
  if (wallTex) return wallTex;
  const { canvas, ctx } = makeCanvas(256, 256);
  const rnd = seeded(5);
  ctx.fillStyle = '#d9d4de';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 0.05, rnd);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 3, 256);
  ctx.fillRect(128, 0, 3, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 40, 96, 150);
  ctx.strokeRect(144, 40, 96, 150);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(18, 42, 92, 4);
  ctx.fillRect(146, 42, 92, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 214, 256, 42);
  wallTex = canvasTexture(canvas, true);
  return wallTex;
}

let sidewalkTex: THREE.CanvasTexture | null = null;
export function sidewalkTexture(): THREE.CanvasTexture {
  if (sidewalkTex) return sidewalkTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(3);
  ctx.fillStyle = '#9d98a6';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 0.12, rnd);
  ctx.strokeStyle = 'rgba(40, 36, 48, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128);
  sidewalkTex = canvasTexture(canvas, true);
  return sidewalkTex;
}

let asphaltTex: THREE.CanvasTexture | null = null;
export function asphaltTexture(): THREE.CanvasTexture {
  if (asphaltTex) return asphaltTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(4);
  ctx.fillStyle = '#26232c';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 0.14, rnd);
  asphaltTex = canvasTexture(canvas, true);
  return asphaltTex;
}

let lotTex: THREE.CanvasTexture | null = null;
/** Unbuilt land around the casino: dark gravel with a faint construction grid. */
export function lotTexture(): THREE.CanvasTexture {
  if (lotTex) return lotTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(9);
  ctx.fillStyle = '#1d1a24';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 0.12, rnd);
  ctx.strokeStyle = 'rgba(255, 200, 80, 0.07)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128);
  lotTex = canvasTexture(canvas, true);
  return lotTex;
}

let blobTex: THREE.CanvasTexture | null = null;
export function blobShadowTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(canvas);
  return blobTex;
}

let softDotTex: THREE.CanvasTexture | null = null;
export function softDotTexture(): THREE.CanvasTexture {
  if (softDotTex) return softDotTex;
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  softDotTex = new THREE.CanvasTexture(canvas);
  return softDotTex;
}

const iconCache = new Map<string, THREE.CanvasTexture>();
/** Round badge icon for 3D status sprites (broken / full / VIP ...). */
export function badgeTexture(kind: 'broken' | 'full' | 'cheat' | 'vip'): THREE.CanvasTexture {
  const cached = iconCache.get(kind);
  if (cached) return cached;
  const { canvas, ctx } = makeCanvas(128, 128);
  const colors = { broken: '#ff9f1c', full: '#2ecc71', cheat: '#ff2d55', vip: '#ffcc1f' };
  ctx.fillStyle = 'rgba(20, 10, 30, 0.85)';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = colors[kind];
  ctx.stroke();
  ctx.fillStyle = colors[kind];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'broken') {
    ctx.beginPath();
    ctx.moveTo(64, 26);
    ctx.lineTo(100, 92);
    ctx.lineTo(28, 92);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a0f24';
    ctx.font = '900 44px Arial Black, Arial, sans-serif';
    ctx.fillText('!', 64, 72);
  } else if (kind === 'full') {
    ctx.font = '400 60px Bungee, "Arial Black", sans-serif';
    ctx.fillText('$', 64, 70);
  } else if (kind === 'cheat') {
    ctx.font = '900 70px Arial Black, Arial, sans-serif';
    ctx.fillText('?', 64, 68);
  } else {
    star(ctx, 64, 66, 40, 5, 0.45);
    ctx.fill();
  }
  const t = canvasTexture(canvas);
  iconCache.set(kind, t);
  return t;
}
