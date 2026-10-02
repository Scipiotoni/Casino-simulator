/**
 * Your crosshair: one look used everywhere you aim (the crosshair on screen, the reticle
 * etched in a scope's glass and the full-screen scope view). Picked in Menu → Settings.
 */
export type ReticleStyle = 'duplex' | 'cross' | 'dot' | 'circle' | 'chevron' | 'mildot';

export interface ReticleOpts {
  style: ReticleStyle;
  /** CSS colour. */
  color: string;
  /** 0.5 .. 2 */
  size: number;
  /** Line thickness, 1 .. 4 */
  thick: number;
}

export const RETICLE_STYLES: { id: ReticleStyle; name: string }[] = [
  { id: 'duplex', name: 'Duplex' },
  { id: 'cross', name: 'Fine cross' },
  { id: 'mildot', name: 'Mil-dot' },
  { id: 'circle', name: 'Circle' },
  { id: 'chevron', name: 'Chevron' },
  { id: 'dot', name: 'Dot' },
];

export const RETICLE_COLORS = ['#111111', '#ff2a2a', '#39ff88', '#2fe6ff', '#ffd24a', '#ff3fa4', '#ffffff'];

export function defaultReticle(): ReticleOpts {
  return { style: 'duplex', color: '#111111', size: 1, thick: 2 };
}

export function sanitizeReticle(raw: unknown): ReticleOpts {
  const r = (raw ?? {}) as Partial<ReticleOpts>;
  const d = defaultReticle();
  return {
    style: RETICLE_STYLES.some((s) => s.id === r.style) ? (r.style as ReticleStyle) : d.style,
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : d.color,
    size: typeof r.size === 'number' && Number.isFinite(r.size) ? Math.max(0.5, Math.min(2, r.size)) : d.size,
    thick: typeof r.thick === 'number' && Number.isFinite(r.thick) ? Math.max(1, Math.min(4, Math.round(r.thick))) : d.thick,
  };
}

export function reticleKey(o: ReticleOpts): string {
  return `${o.style}|${o.color}|${o.size}|${o.thick}`;
}

/**
 * Draw the reticle centred in a square of side `S` (canvas pixels). `R` is the radius of
 * the field it fills (the scope's glass); the centre mark scales with `size`.
 */
export function drawReticle(ctx: CanvasRenderingContext2D, S: number, o: ReticleOpts, R = S / 2): void {
  const c = S / 2;
  const k = S / 256;
  const lw = o.thick * k;
  const m = o.size;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineCap = 'butt';
  const line = (x0: number, y0: number, x1: number, y1: number, w = lw) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (o.style) {
    case 'duplex': {
      // Thin lines through the middle, thick posts toward the edge.
      line(c - R, c, c + R, c);
      line(c, c - R, c, c + R);
      const gap = 34 * k * m;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) line(c + dx * gap * 1.6, c + dy * gap * 1.6, c + dx * R, c + dy * R, lw * 3);
      break;
    }
    case 'cross': {
      const gap = 6 * k * m;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) line(c + dx * gap, c + dy * gap, c + dx * R, c + dy * R);
      dot(c, c, lw * 0.8);
      break;
    }
    case 'mildot': {
      line(c - R, c, c + R, c);
      line(c, c - R, c, c + R);
      const step = 18 * k * m;
      for (let i = 1; i * step < R * 0.9; i++) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(c + dx * i * step, c + dy * i * step, lw * 1.3);
      }
      break;
    }
    case 'circle': {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(c, c, 26 * k * m, 0, Math.PI * 2);
      ctx.stroke();
      dot(c, c, lw * 1.2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) line(c + dx * 26 * k * m * 1.6, c + dy * 26 * k * m * 1.6, c + dx * R, c + dy * R);
      break;
    }
    case 'chevron': {
      const s = 14 * k * m;
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(c - s, c + s);
      ctx.lineTo(c, c);
      ctx.lineTo(c + s, c + s);
      ctx.stroke();
      line(c - R, c + s * 3, c - s * 3, c + s * 3);
      line(c + s * 3, c + s * 3, c + R, c + s * 3);
      line(c, c + s * 2, c, c + R);
      break;
    }
    case 'dot':
      dot(c, c, 5 * k * m + lw);
      break;
  }
  ctx.restore();
}
