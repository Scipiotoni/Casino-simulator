import * as THREE from 'three';

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  map?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  side?: THREE.Side;
  flat?: boolean;
  vertexColors?: boolean;
  depthWrite?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
let texIds = new WeakMap<THREE.Texture, number>();
let nextTexId = 1;

function texKey(t: THREE.Texture | null | undefined): string {
  if (!t) return '-';
  let id = texIds.get(t);
  if (!id) {
    id = nextTexId++;
    texIds.set(t, id);
  }
  return String(id);
}

/** Cached MeshStandardMaterial factory so identical looks share one material (and one shader). */
export function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = [
    color, o.rough ?? 0.6, o.metal ?? 0, o.emissive ?? 0, o.emissiveIntensity ?? 1, o.transparent ? 1 : 0,
    o.opacity ?? 1, texKey(o.map), texKey(o.emissiveMap), o.side ?? 0, o.flat ? 1 : 0, o.vertexColors ? 1 : 0,
    o.depthWrite === false ? 0 : 1,
  ].join('|');
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.6,
      metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      map: o.map ?? null,
      emissiveMap: o.emissiveMap ?? null,
      side: o.side ?? THREE.FrontSide,
      flatShading: o.flat ?? false,
      vertexColors: o.vertexColors ?? false,
      depthWrite: o.depthWrite ?? true,
    });
    cache.set(key, m);
  }
  return m;
}

/** Glowing material (bloom picks it up). */
export function glow(color: number, intensity = 2.8): THREE.MeshStandardMaterial {
  return mat(color, { emissive: color, emissiveIntensity: intensity, rough: 0.4 });
}

export function gold(): THREE.MeshStandardMaterial {
  return mat(0xf2b632, { metal: 0.85, rough: 0.28, emissive: 0x4a2c00, emissiveIntensity: 0.35 });
}

export function chrome(): THREE.MeshStandardMaterial {
  return mat(0xc9cfdb, { metal: 0.75, rough: 0.42 });
}

export function blackGloss(): THREE.MeshStandardMaterial {
  return mat(0x15121c, { rough: 0.25, metal: 0.3 });
}

export function resetMaterialCache(): void {
  cache.clear();
  texIds = new WeakMap();
}
