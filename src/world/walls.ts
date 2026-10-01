import * as THREE from 'three';
import { mat } from '../render/materials';
import type { Grid } from './grid';
import { WALL_H } from './building';
import { damp } from '../core/math';

export interface WallStyle {
  id: string;
  name: string;
  /** Price per tile of wall. */
  price: number;
  color: number;
  /** Top cap and skirting board. */
  trim: number;
  rough: number;
  metal?: number;
  /** See-through partition. */
  glass?: boolean;
  /** Glowing strip along the top. */
  neon?: number;
  /** Procedural surface pattern. */
  pattern?: 'brick' | 'wood' | 'marble' | 'stone' | 'tile' | 'hedge' | 'stripe';
  swatch: string;
}

export const WALL_STYLES: WallStyle[] = [
  { id: 'plaster', name: 'White Plaster', price: 30, color: 0xf1ece2, trim: 0xc9bfae, rough: 0.9, swatch: '#f1ece2' },
  { id: 'cream', name: 'Warm Cream', price: 30, color: 0xe9d6b0, trim: 0x9c7b4a, rough: 0.9, swatch: '#e9d6b0' },
  { id: 'brick', name: 'Red Brick', price: 55, color: 0xffffff, trim: 0x6b5446, rough: 0.95, pattern: 'brick', swatch: '#9c4630' },
  { id: 'wood', name: 'Walnut Panels', price: 70, color: 0xffffff, trim: 0x3a2414, rough: 0.6, pattern: 'wood', swatch: '#6b4224' },
  { id: 'stone', name: 'Grey Stone', price: 65, color: 0xffffff, trim: 0x55575c, rough: 0.95, pattern: 'stone', swatch: '#8d8f94' },
  { id: 'velvet', name: 'Casino Velvet', price: 90, color: 0x7a1026, trim: 0xd9a531, rough: 0.85, pattern: 'stripe', swatch: '#7a1026' },
  { id: 'emerald', name: 'Emerald Lounge', price: 90, color: 0x0f5a3c, trim: 0xd9a531, rough: 0.8, pattern: 'stripe', swatch: '#0f5a3c' },
  { id: 'navy', name: 'Midnight Navy', price: 80, color: 0x1b2748, trim: 0xc8ccd6, rough: 0.8, swatch: '#1b2748' },
  { id: 'tile', name: 'Subway Tile', price: 75, color: 0xffffff, trim: 0x9aa3ad, rough: 0.35, pattern: 'tile', swatch: '#e8eef2' },
  { id: 'marble', name: 'Carrara Marble', price: 140, color: 0xffffff, trim: 0xd9a531, rough: 0.25, pattern: 'marble', swatch: '#ece9e4' },
  { id: 'glass', name: 'Glass Partition', price: 160, color: 0xbfe8ff, trim: 0xb8c0c8, rough: 0.05, metal: 0.2, glass: true, swatch: '#bfe8ff' },
  { id: 'neon', name: 'Black Neon', price: 200, color: 0x15131c, trim: 0x2a2633, rough: 0.5, neon: 0xff3fb4, swatch: '#15131c' },
  { id: 'neonblue', name: 'Ice Neon', price: 200, color: 0x111a24, trim: 0x232d3a, rough: 0.5, neon: 0x2fe6ff, swatch: '#111a24' },
  { id: 'gold', name: 'Solid Gold', price: 400, color: 0xf2b632, trim: 0xfff0b8, rough: 0.25, metal: 1, swatch: '#f2b632' },
  { id: 'hedge', name: 'Garden Hedge', price: 45, color: 0xffffff, trim: 0x2e5a22, rough: 1, pattern: 'hedge', swatch: '#3f7a2e' },
];

/** A wall's thickness, and how tall built walls stand (a little taller than the building's own). */
const T = 0.24;
export const BUILT_WALL_H = WALL_H + 0.5;

const texCache = new Map<string, THREE.Texture>();
const neonMats = new Map<number, THREE.Material>();

function patternTexture(kind: NonNullable<WallStyle['pattern']>, base: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const key = `${kind}:${base}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  switch (kind) {
    case 'brick': {
      ctx.fillStyle = '#d8cfc4';
      ctx.fillRect(0, 0, S, S);
      const bh = S / 8;
      for (let r = 0; r < 8; r++) {
        const off = r % 2 ? S / 8 : 0;
        for (let k = -1; k < 4; k++) {
          const v = 0.8 + rnd() * 0.3;
          ctx.fillStyle = `rgb(${Math.round(156 * v)},${Math.round(70 * v)},${Math.round(48 * v)})`;
          ctx.fillRect(k * (S / 4) + off + 2, r * bh + 2, S / 4 - 4, bh - 4);
        }
      }
      break;
    }
    case 'wood': {
      for (let x = 0; x < S; x += 32) {
        const v = 0.85 + rnd() * 0.25;
        ctx.fillStyle = `rgb(${Math.round(107 * v)},${Math.round(66 * v)},${Math.round(36 * v)})`;
        ctx.fillRect(x, 0, 32, S);
        ctx.strokeStyle = 'rgba(40,20,8,0.35)';
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          const gx = x + 4 + rnd() * 24;
          ctx.moveTo(gx, 0);
          ctx.bezierCurveTo(gx + 4, S * 0.3, gx - 4, S * 0.6, gx + 2, S);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20,10,4,0.6)';
        ctx.fillRect(x, 0, 2, S);
      }
      break;
    }
    case 'stone': {
      ctx.fillStyle = '#5d5f63';
      ctx.fillRect(0, 0, S, S);
      for (let r = 0; r < 4; r++) {
        let x = r % 2 ? -20 : 0;
        while (x < S) {
          const w = 26 + rnd() * 30;
          const v = 0.75 + rnd() * 0.35;
          const g = Math.round(150 * v);
          ctx.fillStyle = `rgb(${g},${g + 2},${g + 6})`;
          ctx.fillRect(x + 2, r * 32 + 2, w - 4, 28);
          x += w;
        }
      }
      break;
    }
    case 'tile': {
      ctx.fillStyle = '#c4ccd3';
      ctx.fillRect(0, 0, S, S);
      for (let r = 0; r < 8; r++) {
        const off = r % 2 ? 16 : 0;
        for (let k = -1; k < 4; k++) {
          ctx.fillStyle = '#eef3f6';
          ctx.fillRect(k * 32 + off + 1.5, r * 16 + 1.5, 29, 13);
        }
      }
      break;
    }
    case 'marble': {
      ctx.fillStyle = '#efece6';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(120,120,130,0.35)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        let x = rnd() * S;
        let y = 0;
        ctx.moveTo(x, y);
        while (y < S) {
          x += (rnd() - 0.5) * 22;
          y += 8 + rnd() * 10;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'hedge': {
      ctx.fillStyle = '#2f5f24';
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        const v = 0.6 + rnd() * 0.7;
        ctx.fillStyle = `rgb(${Math.round(60 * v)},${Math.round(122 * v)},${Math.round(46 * v)})`;
        ctx.beginPath();
        ctx.arc(rnd() * S, rnd() * S, 2 + rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'stripe': {
      ctx.fillStyle = hex(base);
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 0; x < S; x += 32) ctx.fillRect(x, 0, 14, S);
      ctx.fillStyle = 'rgba(255,215,120,0.35)';
      for (let x = 0; x < S; x += 32) ctx.fillRect(x + 14, 0, 1.5, S);
      break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

/** Materials for one style: body, cap/skirting and (for neon) the glowing strip. */
function styleMats(s: WallStyle): { body: THREE.Material; trim: THREE.Material; neon: THREE.Material | null } {
  const map = s.pattern ? patternTexture(s.pattern, s.color) : null;
  const body = s.glass
    ? mat(s.color, { rough: s.rough, metal: s.metal ?? 0, transparent: true, opacity: 0.32, depthWrite: false })
    : mat(map && s.pattern !== 'stripe' ? 0xffffff : s.color, { rough: s.rough, metal: s.metal ?? 0, map: map ?? null, emissive: s.metal ? 0x2a1a00 : 0, emissiveIntensity: s.metal ? 0.5 : 1 });
  const trim = mat(s.trim, { rough: 0.4, metal: s.trim === 0xd9a531 || s.glass ? 0.85 : 0.1 });
  let neon: THREE.Material | null = null;
  if (s.neon) {
    neon = neonMats.get(s.neon) ?? new THREE.MeshBasicMaterial({ color: s.neon, toneMapped: false });
    neonMats.set(s.neon, neon);
  }
  return { body, trim, neon };
}

/** Builds merged box geometry with world-space UVs (so patterns flow across tiles). */
class BoxBatch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  add(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uvScale = 1.25): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    // [normal, 4 corners (ccw seen from outside)]
    const faces: [number[], number[][]][] = [
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [n, cs] of faces) {
      const b = this.pos.length / 3;
      for (const [px, py, pz] of cs) {
        this.pos.push(px, py, pz);
        this.nor.push(n[0], n[1], n[2]);
        const u = n[0] !== 0 ? pz : n[2] !== 0 ? px : px;
        const v = n[1] !== 0 ? pz : py;
        this.uv.push(u / uvScale, v / uvScale);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * The walls you build inside: every wall tile is a post that reaches out to its wall
 * neighbours, so lines and corners join up into proper rooms. From the top-down camera
 * they're drawn cut down (so you can still see in); from behind or through your own eyes
 * they stand full height.
 */
export class WallRenderer {
  readonly group = new THREE.Group();
  private height = 1;
  /** 1 = full height, lower values cut the walls down (top-down view). */
  heightTarget = 1;

  constructor(private grid: Grid) {
    this.group.name = 'walls';
  }

  rebuild(): void {
    for (const c of [...this.group.children]) {
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    const g = this.grid;
    const bodies = new Map<number, BoxBatch>();
    const trims = new Map<number, BoxBatch>();
    const neons = new Map<number, BoxBatch>();
    const batch = (m: Map<number, BoxBatch>, s: number) => {
      let b = m.get(s);
      if (!b) m.set(s, (b = new BoxBatch()));
      return b;
    };
    const H = BUILT_WALL_H;
    for (let z = g.zMin; z < g.zMin + g.d; z++) {
      for (let x = 0; x < g.w; x++) {
        const s = g.wallAt(x, z);
        if (s < 0) continue;
        const st = WALL_STYLES[s] ?? WALL_STYLES[0];
        const cx = x + 0.5;
        const cz = z + 0.5;
        const e = g.isWall(x + 1, z);
        const w = g.isWall(x - 1, z);
        const so = g.isWall(x, z + 1);
        const n = g.isWall(x, z - 1);
        const lone = !e && !w && !so && !n;
        const pieces: [number, number, number, number][] = [];
        // A lone tile stands as a short stretch of wall; otherwise a post plus arms.
        if (lone) pieces.push([cx, cz, 1, T]);
        else {
          pieces.push([cx, cz, T, T]);
          if (e) pieces.push([cx + 0.25 + T / 4, cz, 0.5 - T / 2, T]);
          if (w) pieces.push([cx - 0.25 - T / 4, cz, 0.5 - T / 2, T]);
          if (so) pieces.push([cx, cz + 0.25 + T / 4, T, 0.5 - T / 2]);
          if (n) pieces.push([cx, cz - 0.25 - T / 4, T, 0.5 - T / 2]);
        }
        const body = batch(bodies, s);
        const trim = batch(trims, s);
        const neon = st.neon ? batch(neons, s) : null;
        const plain = st.glass || st.pattern === 'hedge';
        // Grow a piece sideways (away from the wall face) only, never along its length.
        const proud = (sx: number, sz: number, d: number): [number, number] => sx > sz ? [sx, sz + d * 2] : sz > sx ? [sx + d * 2, sz] : [sx + d * 2, sz + d * 2];
        for (const [px, pz, sx, sz] of pieces) {
          if (st.glass) {
            // Glass pane in a metal frame: rails top and bottom.
            body.add(px, H / 2, pz, sx, H - 0.24, sz);
            const [bx, bz] = proud(sx, sz, 0.02);
            trim.add(px, 0.08, pz, bx, 0.16, bz);
            trim.add(px, H - 0.06, pz, bx, 0.12, bz);
            continue;
          }
          body.add(px, H / 2, pz, sx, H, sz);
          // Skirting board
          const [kx, kz] = proud(sx, sz, 0.025);
          trim.add(px, 0.09, pz, kx, 0.18, kz);
          if (!plain) {
            // Chair rail
            const [rx, rz] = proud(sx, sz, 0.02);
            trim.add(px, 1.05, pz, rx, 0.05, rz);
          }
          // Crown moulding: two steps.
          const [c1x, c1z] = proud(sx, sz, 0.03);
          trim.add(px, H - 0.1, pz, c1x, 0.08, c1z);
          const [c2x, c2z] = proud(sx, sz, 0.06);
          trim.add(px, H - 0.025, pz, c2x, 0.05, c2z);
          if (neon) {
            const [nx, nz] = proud(sx, sz, 0.045);
            neon.add(px, H - 0.17, pz, nx, 0.04, nz);
            neon.add(px, 0.2, pz, nx, 0.03, nz);
          }
        }
        // Pilasters at the ends and corners of every run.
        const count = (e ? 1 : 0) + (w ? 1 : 0) + (so ? 1 : 0) + (n ? 1 : 0);
        const corner = (e || w) && (so || n);
        if (count <= 1 || corner || lone) {
          const ends: [number, number][] = lone ? [[cx - 0.5 + 0.17, cz], [cx + 0.5 - 0.17, cz]] : [[cx, cz]];
          for (const [ex, ez] of ends) {
            const P = st.glass ? 0.12 : 0.36;
            trim.add(ex, H / 2, ez, P, H, P);
            trim.add(ex, H - 0.03, ez, P + 0.08, 0.06, P + 0.08);
            trim.add(ex, 0.1, ez, P + 0.06, 0.2, P + 0.06);
            if (neon) neon.add(ex, H + 0.02, ez, P * 0.6, 0.03, P * 0.6);
          }
        } else if (st.glass) {
          // A slim mullion between panes.
          trim.add(cx, H / 2, cz, 0.06, H, 0.06);
        }
      }
    }
    for (const [s, b] of bodies) {
      const st = WALL_STYLES[s] ?? WALL_STYLES[0];
      const m = styleMats(st);
      const add = (geo: THREE.BufferGeometry | null, material: THREE.Material, shadow: boolean) => {
        if (!geo) return;
        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = shadow;
        mesh.receiveShadow = !st.glass;
        if (st.glass) mesh.renderOrder = 3;
        this.group.add(mesh);
      };
      add(b.build(), m.body, !st.glass);
      add(trims.get(s)?.build() ?? null, m.trim, true);
      if (m.neon) add(neons.get(s)?.build() ?? null, m.neon, false);
    }
  }

  update(dt: number): void {
    this.height = damp(this.height, this.heightTarget, 8, dt);
    this.group.scale.y = this.height;
    this.group.visible = this.group.children.length > 0;
  }
}
