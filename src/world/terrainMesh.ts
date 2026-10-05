import * as THREE from 'three';
import { canvasTexture, makeCanvas, seeded } from '../render/textures';
import { cityZ } from './city';
import { VIEW } from './viewDistance';
import { RIVER_HALF_TOWN } from './plan';
import { CITY_GROUND, type Terrain, fbm, smooth } from './terrain';

/**
 * The land drawn as square tiles, each in three levels of detail (every sample, every 2nd,
 * every 4th): near tiles are drawn in full, far ones coarser, and flat ones always coarse.
 * Skirts round every tile hide the cracks where levels meet. Where the river runs between its
 * stone walls through town the land has a hole (the channel is its own mesh).
 */

const TILE = 64;
const LEVELS = 4;

interface Tile {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  cx: number;
  cz: number;
  r: number;
  /** Worst height error of each level against the full one. */
  err: number[];
  /** Has a hole for the river channel (always drawn in full). */
  holes: boolean;
  meshes: (THREE.Mesh | null)[];
  level: number;
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  /** Colour and normal at every sample (the map's hillshade uses them too). */
  readonly colors: Float32Array;
  readonly normals: Float32Array;
  /** Cells (by lower corner) cut out for the walled river channel. */
  private hole: Uint8Array;
  private material: THREE.MeshStandardMaterial;

  /** `tint` may recolour the land at a point (forest floor, beaches). */
  constructor(private t: Terrain, private tint: ((x: number, z: number, c: THREE.Color) => void) | null = null) {
    const n = t.nx * t.nz;
    this.colors = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    this.hole = new Uint8Array(n);
    this.computeNormals();
    this.computeColors();
    this.computeHoles();
    const tex = sandTexture();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    for (let j0 = 0; j0 < t.nz - 1; j0 += TILE) {
      for (let i0 = 0; i0 < t.nx - 1; i0 += TILE) {
        const i1 = Math.min(t.nx - 1, i0 + TILE);
        const j1 = Math.min(t.nz - 1, j0 + TILE);
        let lo = Infinity;
        let hi = -Infinity;
        let holes = false;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const y = t.h[t.idx(i, j)];
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
            if (i < i1 && j < j1 && this.hole[t.idx(i, j)]) holes = true;
          }
        }
        const w = (i1 - i0) * t.step;
        const d = (j1 - j0) * t.step;
        const tile: Tile = {
          i0, j0, i1, j1,
          cx: t.x0 + (i0 * t.step + w / 2),
          cz: t.z0 + (j0 * t.step + d / 2),
          r: Math.hypot(w, d, hi - lo) / 2,
          err: [0, this.error(i0, j0, i1, j1, 2), this.error(i0, j0, i1, j1, 4), this.error(i0, j0, i1, j1, 8)],
          holes,
          meshes: [null, null, null, null],
          level: -1,
        };
        this.tiles.push(tile);
      }
    }
  }

  /** Normals from the height field (the same on both sides of a tile edge: no seams). */
  private computeNormals(): void {
    const { nx, nz, h, step } = this.t;
    const v = new THREE.Vector3();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const l = h[j * nx + Math.max(0, i - 1)];
        const r = h[j * nx + Math.min(nx - 1, i + 1)];
        const u = h[Math.max(0, j - 1) * nx + i];
        const d = h[Math.min(nz - 1, j + 1) * nx + i];
        v.set(l - r, 2 * step, u - d).normalize();
        this.normals[k * 3] = v.x;
        this.normals[k * 3 + 1] = v.y;
        this.normals[k * 3 + 2] = v.z;
      }
    }
  }

  /**
   * Colours: sand on the plain (lighter in the dunes), olive scrub here and there and green
   * along the river, red rock on cliffs and mesas, brown then grey rock up the mountains,
   * snow on the highest peaks.
   */
  private computeColors(): void {
    const t = this.t;
    const [, z1] = cityZ();
    const sand = new THREE.Color(0xd9a86c);
    const sand2 = new THREE.Color(0xc58c55);
    const dune = new THREE.Color(0xe8c48a);
    const scrub = new THREE.Color(0x8f8a4c);
    const green = new THREE.Color(0x6f8a3c);
    const mud = new THREE.Color(0x8a7356);
    const red = new THREE.Color(0xb4623a);
    const cliff = new THREE.Color(0x8e4a30);
    const dark = new THREE.Color(0x6e3b2a);
    const grey = new THREE.Color(0x8c8178);
    const peak = new THREE.Color(0xd8cfc6);
    const snow = new THREE.Color(0xf4f6f8);
    const c = new THREE.Color();
    const water = new Float32Array(t.nx * t.nz).fill(1e9);
    // How far each sample is from the river (only near it matters).
    const r = t.river;
    for (let i = 0; i < r.pts.length; i += 2) {
      const p = r.pts[i];
      const R = 70;
      const i0 = Math.max(0, Math.floor((p.x - R - t.x0) / t.step));
      const i1 = Math.min(t.nx - 1, Math.ceil((p.x + R - t.x0) / t.step));
      const j0 = Math.max(0, Math.floor((p.z - R - t.z0) / t.step));
      const j1 = Math.min(t.nz - 1, Math.ceil((p.z + R - t.z0) / t.step));
      for (let j = j0; j <= j1; j++) {
        for (let ii = i0; ii <= i1; ii++) {
          const k = t.idx(ii, j);
          const d = Math.hypot(t.x0 + ii * t.step - p.x, t.z0 + j * t.step - p.z);
          if (d < water[k]) water[k] = d;
        }
      }
    }
    const l = t.lake;
    for (let j = 0; j < t.nz; j++) {
      const z = t.z0 + j * t.step;
      for (let i = 0; i < t.nx; i++) {
        const x = t.x0 + i * t.step;
        const k = t.idx(i, j);
        const y = t.h[k];
        const sl = t.slope[k];
        c.copy(sand).lerp(sand2, fbm(x / 40, z / 40, 2));
        // Dunes to the south.
        if (z > z1 + 500) c.lerp(dune, smooth((z - z1 - 500) / 500) * 0.7);
        // Scrub patches on the plain.
        const sc = fbm(x / 60 + 4, z / 60 - 9, 2);
        if (sc > 0.55 && sl < 0.35) c.lerp(scrub, smooth((sc - 0.55) / 0.2) * 0.45);
        // Green along the river and the lake shore; wet mud at the water's edge.
        const lakeE = Math.hypot((x - l.x) / l.rx, (z - l.z) / l.rz);
        const wet = 1 - water[k] / 60;
        if (wet > 0 && y > -2 && lakeE > 1.5 && t.cityDist(x, z) > 30) c.lerp(green, smooth(wet) * 0.6);
        if (y < -1.4 && (water[k] < 40 || lakeE < 1.3)) c.lerp(mud, smooth((-1.4 - y) / 1.5));
        // Rock: red on the mesas and buttes, cliffs darker, brown then grey up high, snow on top.
        if (y > 6) c.lerp(red, smooth((y - 6) / 30) * 0.8);
        if (y > 90) c.lerp(dark, smooth((y - 90) / 100) * 0.7);
        if (y > 220) c.lerp(grey, smooth((y - 220) / 80));
        if (y > 330) c.lerp(peak, smooth((y - 330) / 80));
        if (y > 430) c.lerp(snow, smooth((y - 430) / 50));
        if (sl > 0.45) c.lerp(y > 200 ? grey : cliff, smooth((sl - 0.45) / 0.8) * 0.85);
        if (Math.abs(y - CITY_GROUND) < 0.01) c.copy(sand).lerp(sand2, fbm(x / 40, z / 40, 2));
        this.tint?.(x, z, c);
        this.colors[k * 3] = c.r;
        this.colors[k * 3 + 1] = c.g;
        this.colors[k * 3 + 2] = c.b;
      }
    }
  }

  /** Cut the cells the walled river channel runs through out of the land. */
  private computeHoles(): void {
    const t = this.t;
    const r = t.river;
    const st = t.step;
    for (let i = 0; i < r.pts.length; i += 2) {
      if (!t.walled[i]) continue;
      const p = r.pts[i];
      const R = 26;
      const i0 = Math.max(0, Math.floor((p.x - R - t.x0) / st));
      const i1 = Math.min(t.nx - 2, Math.ceil((p.x + R - t.x0) / st));
      const j0 = Math.max(0, Math.floor((p.z - R - t.z0) / st));
      const j1 = Math.min(t.nz - 2, Math.ceil((p.z + R - t.z0) / st));
      for (let j = j0; j <= j1; j++) {
        for (let ii = i0; ii <= i1; ii++) {
          const k = t.idx(ii, j);
          if (this.hole[k]) continue;
          const cx = t.x0 + (ii + 0.5) * st;
          const cz = t.z0 + (j + 0.5) * st;
          const n = r.nearest(cx, cz, RIVER_HALF_TOWN + 10);
          if (n && t.isWalled(n.s) && n.d < t.riverHalf(n.s) + st * 0.71) this.hole[k] = 1;
        }
      }
    }
  }

  /** Worst height error drawing this tile with every `s`-th sample. */
  private error(i0: number, j0: number, i1: number, j1: number, s: number): number {
    const t = this.t;
    let worst = 0;
    const xs = this.ticks(i0, i1, s);
    const zs = this.ticks(j0, j1, s);
    for (let b = 0; b < zs.length - 1; b++) {
      for (let a = 0; a < xs.length - 1; a++) {
        const ia = xs[a];
        const ib = xs[a + 1];
        const ja = zs[b];
        const jb = zs[b + 1];
        const h00 = t.h[t.idx(ia, ja)];
        const h10 = t.h[t.idx(ib, ja)];
        const h01 = t.h[t.idx(ia, jb)];
        const h11 = t.h[t.idx(ib, jb)];
        for (let j = ja; j <= jb; j++) {
          const v = (j - ja) / Math.max(1, jb - ja);
          for (let i = ia; i <= ib; i++) {
            const u = (i - ia) / Math.max(1, ib - ia);
            // The coarse quad is split along the same diagonal as the mesh.
            const est = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
            worst = Math.max(worst, Math.abs(est - t.h[t.idx(i, j)]));
          }
        }
      }
    }
    return worst;
  }

  /** Sample indices from a to b every s (b always included). */
  private ticks(a: number, b: number, s: number): number[] {
    const out: number[] = [];
    for (let i = a; i < b; i += s) out.push(i);
    out.push(b);
    return out;
  }

  /** Build one tile at one level of detail. */
  private build(tile: Tile, level: number): THREE.Mesh {
    const t = this.t;
    const s = 1 << level;
    const xs = this.ticks(tile.i0, tile.i1, s);
    const zs = this.ticks(tile.j0, tile.j1, s);
    const W = xs.length;
    const D = zs.length;
    const skirt = 2 + tile.err[Math.max(1, level)] * 1.5 + tile.err[LEVELS - 1] * 0.5;
    const count = W * D + 2 * (W + D) * 2;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let v = 0;
    const put = (i: number, j: number, drop: number) => {
      const k = t.idx(i, j);
      const x = t.x0 + i * t.step;
      const z = t.z0 + j * t.step;
      pos[v * 3] = x;
      pos[v * 3 + 1] = t.h[k] - drop;
      pos[v * 3 + 2] = z;
      nor.set(this.normals.subarray(k * 3, k * 3 + 3), v * 3);
      col.set(this.colors.subarray(k * 3, k * 3 + 3), v * 3);
      uv[v * 2] = x / 6;
      uv[v * 2 + 1] = z / 6;
      return v++;
    };
    const grid: number[] = [];
    for (let b = 0; b < D; b++) for (let a = 0; a < W; a++) grid.push(put(xs[a], zs[b], 0));
    const idx: number[] = [];
    const quad = (a0: number, b0: number, a1: number, b1: number) => {
      const p00 = grid[b0 * W + a0];
      const p10 = grid[b0 * W + a1];
      const p01 = grid[b1 * W + a0];
      const p11 = grid[b1 * W + a1];
      idx.push(p00, p01, p10, p10, p01, p11);
    };
    if (level === 0 && tile.holes) {
      // Full detail only round the river channel; flat 4x4 blocks away from it are one quad.
      for (let b0 = 0; b0 < D - 1; b0 += 4) {
        for (let a0 = 0; a0 < W - 1; a0 += 4) {
          const a1 = Math.min(W - 1, a0 + 4);
          const b1 = Math.min(D - 1, b0 + 4);
          const y = t.h[t.idx(xs[a0], zs[b0])];
          let simple = true;
          for (let b = b0; b <= b1 && simple; b++) {
            for (let a = a0; a <= a1; a++) {
              const k = t.idx(xs[a], zs[b]);
              if (Math.abs(t.h[k] - y) > 0.005 || (a < a1 && b < b1 && this.hole[k])) {
                simple = false;
                break;
              }
            }
          }
          if (simple) {
            quad(a0, b0, a1, b1);
            continue;
          }
          for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) if (!this.hole[t.idx(xs[a], zs[b])]) quad(a, b, a + 1, b + 1);
        }
      }
    } else {
      for (let b = 0; b < D - 1; b++) for (let a = 0; a < W - 1; a++) quad(a, b, a + 1, b + 1);
    }
    // Skirts: a curtain hanging down from each edge, facing out (a crack is seen from the other side).
    const edge = (list: number[], forward: boolean) => {
      const low = list.map((g) => {
        const k = v;
        pos[k * 3] = pos[g * 3];
        pos[k * 3 + 1] = pos[g * 3 + 1] - skirt;
        pos[k * 3 + 2] = pos[g * 3 + 2];
        nor.set(nor.subarray(g * 3, g * 3 + 3), k * 3);
        col.set(col.subarray(g * 3, g * 3 + 3), k * 3);
        uv[k * 2] = uv[g * 2];
        uv[k * 2 + 1] = uv[g * 2 + 1] + skirt / 6;
        return v++;
      });
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        const c = low[i];
        const d = low[i + 1];
        if (forward) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    };
    edge(grid.slice(0, W), true);
    edge(grid.slice((D - 1) * W), false);
    edge(Array.from({ length: D }, (_, b) => grid[b * W]), false);
    edge(Array.from({ length: D }, (_, b) => grid[b * W + W - 1]), true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.material);
    m.receiveShadow = true;
    m.name = 'terrain';
    m.matrixAutoUpdate = false;
    this.group.add(m);
    return m;
  }

  /** Pick each tile's level of detail for a viewer at (fx, fz) (global frame). */
  update(fx: number, fz: number): void {
    const k = VIEW.scale;
    for (const tile of this.tiles) {
      const d = Math.max(0, Math.hypot(tile.cx - fx, tile.cz - fz) - tile.r);
      let level = d < 650 * k ? 0 : d < 1600 * k ? 1 : d < 3000 * k ? 2 : 3;
      // A flat tile looks the same coarse; one with the river channel is always drawn in full.
      while (level < LEVELS - 1 && tile.err[level + 1] < 0.08) level++;
      if (tile.holes && d < 2500) level = 0;
      if (level === tile.level) continue;
      if (tile.level >= 0) {
        const old = tile.meshes[tile.level];
        if (old) old.visible = false;
      }
      tile.level = level;
      let m = tile.meshes[level];
      if (!m) m = tile.meshes[level] = this.build(tile, level);
      m.visible = true;
    }
  }

  /** How many triangles are drawn now (tests and stats). */
  triangles(): number {
    let n = 0;
    for (const tile of this.tiles) {
      const m = tile.level >= 0 ? tile.meshes[tile.level] : null;
      if (m?.visible) n += (m.geometry.index?.count ?? 0) / 3;
    }
    return n;
  }

  dispose(): void {
    for (const tile of this.tiles) for (const m of tile.meshes) m?.geometry.dispose();
    this.material.dispose();
  }
}

let sandTex: THREE.CanvasTexture | null = null;
/** Fine sand grain, tinted by the vertex colours. */
export function sandTexture(): THREE.CanvasTexture {
  if (sandTex) return sandTex;
  const { canvas, ctx } = makeCanvas(128, 128);
  const rnd = seeded(21);
  ctx.fillStyle = '#e6e0d8';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    const v = 190 + rnd() * 65;
    ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},0.6)`;
    ctx.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1);
  }
  ctx.strokeStyle = 'rgba(160,140,120,0.25)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const y = rnd() * 128;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) ctx.lineTo(x, y + Math.sin(x / 20 + i) * 4);
    ctx.stroke();
  }
  sandTex = canvasTexture(canvas, true);
  return sandTex;
}
