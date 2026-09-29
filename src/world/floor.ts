import * as THREE from 'three';
import { FLOOR_STYLES, floorTexture } from '../render/textures';
import { mat } from '../render/materials';
import type { Grid } from './grid';

/**
 * Carpet renderer: one merged mesh per carpet style so painting stays cheap and each
 * pattern flows continuously across neighbouring tiles.
 */
export class FloorRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private gridLines: THREE.LineSegments | null = null;
  private highlight: THREE.Mesh;

  constructor(private grid: Grid) {
    this.group.name = 'floor';
    const hlGeo = new THREE.PlaneGeometry(1, 1);
    hlGeo.rotateX(-Math.PI / 2);
    this.highlight = new THREE.Mesh(
      hlGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.highlight.visible = false;
    this.highlight.renderOrder = 2;
    this.group.add(this.highlight);
  }

  rebuild(): void {
    const g = this.grid;
    const r = g.rect;
    const buckets = new Map<number, number[]>();
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const s = g.getFloor(x, z);
        let list = buckets.get(s);
        if (!list) {
          list = [];
          buckets.set(s, list);
        }
        list.push(x, z);
      }
    }
    for (const [style, mesh] of this.meshes) {
      if (!buckets.has(style)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(style);
      }
    }
    for (const [style, tiles] of buckets) {
      const count = tiles.length / 2;
      const pos = new Float32Array(count * 12);
      const nor = new Float32Array(count * 12);
      const uv = new Float32Array(count * 8);
      const idx = new Uint32Array(count * 6);
      for (let t = 0; t < count; t++) {
        const x = tiles[t * 2];
        const z = tiles[t * 2 + 1];
        const corners = [
          [x, z],
          [x + 1, z],
          [x + 1, z + 1],
          [x, z + 1],
        ];
        for (let c = 0; c < 4; c++) {
          const [px, pz] = corners[c];
          pos.set([px, 0, pz], t * 12 + c * 3);
          nor.set([0, 1, 0], t * 12 + c * 3);
          uv.set([px / 2, -pz / 2], t * 8 + c * 2);
        }
        const b = t * 4;
        idx.set([b, b + 2, b + 1, b, b + 3, b + 2], t * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      let mesh = this.meshes.get(style);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geo;
      } else {
        const def = FLOOR_STYLES[style] ?? FLOOR_STYLES[0];
        const tex = floorTexture(style);
        const material = mat(0xffffff, {
          map: tex,
          rough: def.rough,
          metal: def.metal ?? 0,
          emissive: def.emissive ? 0xffffff : 0x000000,
          emissiveMap: def.emissive ? tex : null,
          emissiveIntensity: def.emissive ? 0.9 : 1,
        });
        mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.name = `floor-${def.id}`;
        this.meshes.set(style, mesh);
        this.group.add(mesh);
      }
    }
    this.rebuildGridLines();
  }

  private rebuildGridLines(): void {
    const r = this.grid.rect;
    const pts: number[] = [];
    const y = 0.012;
    for (let x = r.x0; x <= r.x1 + 1; x++) pts.push(x, y, r.z0, x, y, r.z1 + 1);
    for (let z = r.z0; z <= r.z1 + 1; z++) pts.push(r.x0, y, z, r.x1 + 1, y, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (this.gridLines) {
      this.gridLines.geometry.dispose();
      this.gridLines.geometry = geo;
    } else {
      this.gridLines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false }),
      );
      this.gridLines.visible = false;
      this.gridLines.renderOrder = 1;
      this.group.add(this.gridLines);
    }
  }

  showGrid(on: boolean): void {
    if (this.gridLines) this.gridLines.visible = on;
  }

  showTileHighlight(x: number | null, z: number | null, color = 0xffffff): void {
    if (x === null || z === null) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(x + 0.5, 0.015, z + 0.5);
    (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(color);
  }
}
