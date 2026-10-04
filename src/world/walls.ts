import * as THREE from 'three';
import { mat } from '../render/materials';
import { DOOR_BASE, type Grid } from './grid';
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

/** A door hung in a wall line. The lock decides what a burglar has to beat to get through. */
export interface DoorType {
  id: string;
  name: string;
  price: number;
  /** 0 = opens for anyone; 1..5 = a lock burglars have to crack (harder each step). */
  lock: number;
  /** Points it adds to the house's security rating. */
  security: number;
  /** Door leaf colour (and the swatch in the build bar). */
  color: number;
  swatch: string;
  blurb: string;
}

export const DOOR_TYPES: DoorType[] = [
  { id: 'wood', name: 'Wooden Door', price: 300, lock: 0, security: 1, color: 0x8a5a2e, swatch: '#8a5a2e', blurb: 'A panelled door. It opens for anyone.' },
  { id: 'lock', name: 'Deadbolt Door', price: 1500, lock: 1, security: 3, color: 0x4a2a14, swatch: '#4a2a14', blurb: 'A solid door with a deadbolt: burglars have to pick the lock.' },
  { id: 'steel', name: 'Steel Security Door', price: 6000, lock: 2, security: 5, color: 0x8c9099, swatch: '#8c9099', blurb: 'Riveted steel with a high-security lock: a much harder pick.' },
  { id: 'keypad', name: 'Keypad Door', price: 15000, lock: 3, security: 7, color: 0x3a3f48, swatch: '#3a3f48', blurb: 'Armoured door with a coded keypad: burglars have to hack it.' },
  { id: 'blast', name: 'Blast Door', price: 40000, lock: 4, security: 10, color: 0x55585e, swatch: '#c9a227', blurb: 'Vault-grade steel with a combination wheel. A dial and a lock to crack.' },
  { id: 'laserdoor', name: 'Laser Door', price: 90000, lock: 5, security: 13, color: 0x9fdcff, swatch: '#ff2a2a', blurb: 'Glass and laser bars. The hardest hack there is, and every mistake shocks the burglar.' },
];

export function doorType(type: number): DoorType {
  return DOOR_TYPES[type] ?? DOOR_TYPES[0];
}

/** Doors in an encoded wall layer (a save or another player's floor plan): their types, one per door. */
export function doorsInEncoded(enc: string | undefined): number[] {
  const out: number[] = [];
  if (!enc) return out;
  for (const part of enc.split(',')) {
    const [v, n] = part.split(':').map(Number);
    if (!(v >= DOOR_BASE) || !(n > 0)) continue;
    for (let k = 0; k < Math.min(n, 400) && out.length < 400; k++) out.push(Math.min(DOOR_TYPES.length - 1, v - DOOR_BASE));
  }
  return out;
}

/** A wall's thickness, and how tall built walls stand (up to the ceiling). */
const T = 0.24;
export const BUILT_WALL_H = WALL_H;
/** Height of a doorway (the lintel fills the rest up to the ceiling). */
const DOOR_H = 2.2;

/**
 * The cutaway: walls standing between the camera and what you're looking at drop down to a
 * stub (like the building's outer walls do), the rest stand to the ceiling. Shared by every
 * floor's walls; the game sets it each frame.
 */
export const WALL_CUT = {
  /** Point the camera looks at (world xz). */
  focus: new THREE.Vector2(),
  /** Horizontal direction from the focus towards the camera (unit). */
  toCam: new THREE.Vector2(0, 1),
  /** 0 = every wall full height (first person), 1 = cut the ones in front. */
  on: 0,
  /** Height the cut walls drop to. */
  low: 0.42,
  /** Also cut every wall that faces the camera, wherever it is (the top-down view). */
  face: 0,
};
const cutUniforms = {
  uCutFocus: { value: WALL_CUT.focus },
  uCutDir: { value: WALL_CUT.toCam },
  uCutOn: { value: 0 },
  uCutLow: { value: 0.42 },
  uCutFace: { value: 0 },
};
/** Copy WALL_CUT into the shader uniforms (call once per frame). */
export function syncWallCut(): void {
  cutUniforms.uCutOn.value = WALL_CUT.on;
  cutUniforms.uCutLow.value = WALL_CUT.low;
  cutUniforms.uCutFace.value = WALL_CUT.face;
}

const cutCache = new Map<string, THREE.Material>();
/**
 * A copy of a wall material whose vertices fold down when the wall is in front of the camera.
 * `lift` raises trims a hair above the folded wall top so they don't flicker against it.
 */
function cutaway(m: THREE.Material, lift = 0): THREE.Material {
  const key = `${m.uuid}:${lift}`;
  const hit = cutCache.get(key);
  if (hit) return hit;
  const c = m.clone();
  c.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, cutUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aCenter;
        uniform vec2 uCutFocus;
        uniform vec2 uCutDir;
        uniform float uCutOn;
        uniform float uCutLow;
        uniform float uCutFace;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 cw = (modelMatrix * vec4(aCenter.x, 0.0, aCenter.y, 1.0)).xz;
          float front = dot(cw - uCutFocus, uCutDir);
          // Which way the wall runs: 1 = along x (faces ±z), 2 = along z (faces ±x), 0 = a post.
          float fx = abs(uCutDir.y);
          float fz = abs(uCutDir.x);
          float facing = aCenter.z < 0.5 ? min(fx, fz) : aCenter.z < 1.5 ? fx : fz;
          float k = uCutOn * max(smoothstep(0.2, 1.4, front), uCutFace * smoothstep(0.5, 0.72, facing));
          transformed.y = mix(transformed.y, transformed.y > uCutLow ? uCutLow + ${lift.toFixed(3)} : transformed.y, k);
        }`);
  };
  c.customProgramCacheKey = () => `wallcut${lift}`;
  cutCache.set(key, c);
  return c;
}

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
  cen: number[] = [];
  /** Tile the next boxes belong to (decides whether they're cut away). */
  cx = 0;
  cz = 0;
  /** 1 = runs along x, 2 = along z, 0 = a corner post. */
  dir = 0;

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
        this.cen.push(this.cx, this.cz, this.dir);
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
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.cen, 3));
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
  /** Doors in the walls: their swinging leaves. */
  private doorGroup = new THREE.Group();
  private doorList: { x: number; z: number; type: number; pivot: THREE.Group; base: number; open: number; want: boolean }[] = [];
  /** Should the door on this tile be open now (somebody it lets through is close)? Set by the game. */
  doorOpen: ((x: number, z: number, type: number) => boolean) | null = null;
  private doorT = 0;

  constructor(private grid: Grid) {
    this.group.name = 'walls';
    this.group.add(this.doorGroup);
  }

  /** The swinging leaf of one door: hinged on one jamb, it folds down with the walls in the cutaway. */
  private addDoorLeaf(x: number, z: number, type: number, run: 'x' | 'z'): void {
    const dt = doorType(type);
    const dir = run === 'x' ? 1 : 2;
    const pivot = new THREE.Group();
    const W = 0.84;
    const LH = DOOR_H - 0.06;
    const th = dt.id === 'blast' ? 0.13 : 0.06;
    const part = (sx: number, sy: number, sz: number, px: number, py: number, pz: number, m: THREE.Material, shadow = true) => {
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      geo.translate(px, py, pz);
      const n = geo.getAttribute('position').count;
      const cen = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        cen[i * 3] = W / 2;
        cen[i * 3 + 1] = 0;
        cen[i * 3 + 2] = dir;
      }
      geo.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
      const mesh = new THREE.Mesh(geo, cutaway(m, 0.006));
      mesh.castShadow = shadow;
      pivot.add(mesh);
      return mesh;
    };
    const brass = mat(0xd9a531, { rough: 0.3, metal: 0.9 });
    const dark = mat(0x17151f, { rough: 0.5, metal: 0.4 });
    if (dt.id === 'laserdoor') {
      part(W, LH, 0.04, W / 2, LH / 2, 0, mat(0x9fdcff, { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.28, depthWrite: false }), false);
      part(W, 0.08, 0.08, W / 2, 0.04, 0, dark);
      part(W, 0.08, 0.08, W / 2, LH - 0.04, 0, dark);
      part(0.06, LH, 0.08, 0.03, LH / 2, 0, dark);
      part(0.06, LH, 0.08, W - 0.03, LH / 2, 0, dark);
      const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      for (let i = 0; i < 6; i++) part(W - 0.1, 0.02, 0.02, W / 2, 0.3 + i * 0.32, 0, red, false);
    } else {
      const leafMat = mat(dt.color, { rough: dt.id === 'wood' || dt.id === 'lock' ? 0.7 : 0.35, metal: dt.id === 'wood' || dt.id === 'lock' ? 0 : 0.75 });
      part(W, LH, th, W / 2, LH / 2, 0, leafMat);
      if (dt.id === 'wood' || dt.id === 'lock') {
        const inset = mat(dt.id === 'wood' ? 0x6b4422 : 0x2e1a0c, { rough: 0.75 });
        for (const y of [0.62, 1.52]) part(W * 0.62, 0.62, th + 0.02, W / 2, y, 0, inset);
        part(0.05, 0.05, th + 0.12, W - 0.1, 1.02, 0, brass, false);
        if (dt.id === 'lock') part(0.09, 0.16, th + 0.03, W - 0.1, 1.22, 0, brass, false);
      } else if (dt.id === 'steel') {
        const rivet = mat(0xc9ced6, { rough: 0.3, metal: 0.9 });
        for (const y of [0.15, LH - 0.15]) for (let i = 0; i < 5; i++) part(0.035, 0.035, th + 0.02, 0.1 + i * ((W - 0.2) / 4), y, 0, rivet, false);
        part(0.04, 0.4, th + 0.14, W - 0.1, 1.05, 0, rivet, false);
      } else if (dt.id === 'keypad') {
        part(W * 0.8, 0.05, th + 0.02, W / 2, 0.5, 0, dark);
        part(W * 0.8, 0.05, th + 0.02, W / 2, 1.7, 0, dark);
        const pad = new THREE.MeshBasicMaterial({ color: 0x39ff88, toneMapped: false });
        part(0.12, 0.17, th + 0.04, W - 0.13, 1.2, 0, pad, false);
        part(0.04, 0.35, th + 0.12, W - 0.1, 0.95, 0, dark, false);
      } else if (dt.id === 'blast') {
        const hazard = mat(0xf2c12e, { rough: 0.5, metal: 0.3 });
        for (const y of [0.18, LH - 0.18]) part(W, 0.12, th + 0.02, W / 2, y, 0, hazard, false);
        const wheel = new THREE.TorusGeometry(0.2, 0.03, 6, 18);
        for (const sd of [-1, 1]) {
          const g2 = wheel.clone();
          g2.translate(W / 2, 1.1, sd * (th / 2 + 0.04));
          const n = g2.getAttribute('position').count;
          const cen = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            cen[i * 3] = W / 2;
            cen[i * 3 + 2] = dir;
          }
          g2.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
          pivot.add(new THREE.Mesh(g2, cutaway(mat(0xc9ced6, { rough: 0.3, metal: 0.9 }), 0.006)));
        }
        wheel.dispose();
      }
    }
    // Hinged on one jamb; the leaf runs along the wall line when it's shut.
    const cx = x + 0.5;
    const cz = z + 0.5;
    const base = run === 'x' ? 0 : -Math.PI / 2;
    if (run === 'x') pivot.position.set(cx - W / 2, 0, cz);
    else pivot.position.set(cx, 0, cz - W / 2);
    pivot.rotation.y = base;
    this.doorGroup.add(pivot);
    this.doorList.push({ x, z, type, pivot, base, open: 0, want: false });
  }

  rebuild(): void {
    for (const c of [...this.group.children]) {
      if (c === this.doorGroup) continue;
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    for (const c of [...this.doorGroup.children]) {
      c.removeFromParent();
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.doorList = [];
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
    const doorTiles: { x: number; z: number; type: number }[] = [];
    for (let z = g.zMin; z < g.zMin + g.d; z++) {
      for (let x = 0; x < g.w; x++) {
        const dt = g.doorAt(x, z);
        if (dt >= 0) {
          doorTiles.push({ x, z, type: dt });
          continue;
        }
        const s = g.wallAt(x, z);
        if (s < 0) continue;
        const st = WALL_STYLES[s] ?? WALL_STYLES[0];
        const cx = x + 0.5;
        const cz = z + 0.5;
        // Walls reach out to their neighbours, doors included.
        const e = g.inWallLine(x + 1, z);
        const w = g.inWallLine(x - 1, z);
        const so = g.inWallLine(x, z + 1);
        const n = g.inWallLine(x, z - 1);
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
        const runX = lone || ((e || w) && !(so || n));
        const runZ = !lone && (so || n) && !(e || w);
        for (const b of [body, trim, neon]) {
          if (!b) continue;
          b.cx = cx;
          b.cz = cz;
          b.dir = runX ? 1 : runZ ? 2 : 0;
        }
        const plain = st.glass || st.pattern === 'hedge';
        // Grow a piece sideways (away from the wall face) only, never along its length.
        const proud = (sx: number, sz: number, d: number): [number, number] => sx > sz ? [sx, sz + d * 2] : sz > sx ? [sx + d * 2, sz] : [sx + d * 2, sz + d * 2];
        const tileDir = runX ? 1 : runZ ? 2 : 0;
        const setDir = (d: number) => {
          for (const bb of [body, trim, neon]) if (bb) bb.dir = d;
        };
        for (const [px, pz, sx, sz] of pieces) {
          setDir(sx > sz + 0.01 ? 1 : sz > sx + 0.01 ? 2 : tileDir);
          if (st.glass) {
            // Glass pane in a metal frame: rails top and bottom.
            body.add(px, H / 2, pz, sx, H - 0.24, sz);
            const [bx, bz] = proud(sx, sz, 0.02);
            trim.add(px, 0.08, pz, bx, 0.16, bz);
            trim.add(px, H - 0.06, pz, bx, 0.12, bz);
            continue;
          }
          body.add(px, (H - 0.012) / 2, pz, sx, H - 0.012, sz);
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
        setDir(tileDir);
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
    // Door frames: a lintel up to the ceiling in the wall's own style, jambs and a header.
    for (const d of doorTiles) {
      const run = g.doorRun(d.x, d.z) ?? (g.inWallLine(d.x - 1, d.z) || g.inWallLine(d.x + 1, d.z) ? 'x' : 'z');
      const nb = run === 'x' ? [g.wallAt(d.x - 1, d.z), g.wallAt(d.x + 1, d.z)] : [g.wallAt(d.x, d.z - 1), g.wallAt(d.x, d.z + 1)];
      const s = Math.max(0, nb.find((v) => v >= 0) ?? 0);
      const st = WALL_STYLES[s] ?? WALL_STYLES[0];
      const body = batch(bodies, s);
      const trim = batch(trims, s);
      const cx = d.x + 0.5;
      const cz = d.z + 0.5;
      const dir = run === 'x' ? 1 : 2;
      for (const b of [body, trim]) {
        b.cx = cx;
        b.cz = cz;
        b.dir = dir;
      }
      const along = (len: number, thick: number): [number, number] => (run === 'x' ? [len, thick] : [thick, len]);
      const [lx, lz] = along(1, T);
      body.add(cx, (DOOR_H + H) / 2, cz, lx, H - DOOR_H, lz);
      for (const sd of [-1, 1]) {
        const off = sd * (0.5 - 0.045);
        const [jx, jz] = along(0.09, T + 0.07);
        trim.add(run === 'x' ? cx + off : cx, DOOR_H / 2, run === 'x' ? cz : cz + off, jx, DOOR_H, jz);
      }
      const [hx, hz] = along(1, T + 0.07);
      trim.add(cx, DOOR_H + 0.05, cz, hx, 0.1, hz);
      const [c1x, c1z] = along(1, T + 0.06);
      trim.add(cx, H - 0.1, cz, c1x, 0.08, c1z);
      const [c2x, c2z] = along(1, T + 0.12);
      trim.add(cx, H - 0.025, cz, c2x, 0.05, c2z);
      if (st.neon) {
        const nb2 = batch(neons, s);
        nb2.cx = cx;
        nb2.cz = cz;
        nb2.dir = dir;
        const [nx, nz] = along(1, T + 0.09);
        nb2.add(cx, H - 0.17, cz, nx, 0.04, nz);
      }
      this.addDoorLeaf(d.x, d.z, d.type, run);
    }
    for (const [s, b] of bodies) {
      const st = WALL_STYLES[s] ?? WALL_STYLES[0];
      const m = styleMats(st);
      const add = (geo: THREE.BufferGeometry | null, material: THREE.Material, shadow: boolean, lift = 0) => {
        if (!geo) return;
        const mesh = new THREE.Mesh(geo, cutaway(material, lift));
        mesh.castShadow = shadow;
        mesh.receiveShadow = !st.glass;
        if (st.glass) mesh.renderOrder = 3;
        this.group.add(mesh);
      };
      add(b.build(), m.body, !st.glass);
      add(trims.get(s)?.build() ?? null, m.trim, true, 0.012);
      if (m.neon) add(neons.get(s)?.build() ?? null, m.neon, false, 0.02);
    }
  }

  update(dt: number): void {
    this.height = damp(this.height, this.heightTarget, 8, dt);
    this.group.scale.y = this.height;
    this.group.visible = this.group.children.length > 1 || this.doorList.length > 0;
    // Doors swing open for whoever they let through, and shut behind them.
    if (!this.doorList.length) return;
    this.doorT -= dt;
    const check = this.doorT <= 0;
    if (check) this.doorT = 0.12;
    for (const d of this.doorList) {
      if (check) d.want = !!this.doorOpen?.(d.x, d.z, d.type);
      const want = d.want ? 1 : 0;
      const before = d.open;
      d.open = damp(d.open, want, want ? 7 : 4, dt);
      if (Math.abs(d.open - before) > 1e-4) d.pivot.rotation.y = d.base - d.open * 1.5;
    }
  }

  /** How far the door on this tile stands open (0 shut .. 1 open), or -1 if there's none. */
  doorOpenness(x: number, z: number): number {
    return this.doorList.find((d) => d.x === x && d.z === z)?.open ?? -1;
  }
}
