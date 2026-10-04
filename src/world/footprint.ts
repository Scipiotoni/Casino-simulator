import type { LotLook } from './exterior';
import { CENTER_X, DEPTH_STEP, FACADE_Z, START_DEPTH, WIDTHS } from './grid';
import { MAX_DEPTH_STEPS, type FillerSpec } from './city';

/** A solid rectangle in a lot's own frame: x0, x1, z0, z1. */
export type SolidRect = [number, number, number, number];

/** Height of one storey seen from outside (matches the exteriors). */
const STOREY = 3;

/** Width and depth of a player building (casino, hotel, house) from its lot info. */
export function lotSize(info: LotLook): { w: number; d: number } {
  const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, info.width))].w;
  const d = START_DEPTH + Math.min(MAX_DEPTH_STEPS, Math.max(0, info.depth)) * DEPTH_STEP;
  return { w, d };
}

/** The solid parts of a filler building (the rest of its lot is open ground). */
function fillerSolids(f: FillerSpec): SolidRect[] {
  const x0 = CENTER_X - f.w / 2;
  const x1 = CENTER_X + f.w / 2;
  const zF = FACADE_Z;
  const z0 = zF - f.d;
  switch (f.kind) {
    case 'centralpark':
      return [];
    case 'park':
      // Only the fountain in the middle.
      return [[CENTER_X - 2.6, CENTER_X + 2.6, zF - f.d / 2 - 2.6, zF - f.d / 2 + 2.6]];
    case 'parking':
      // The attendant's booth.
      return [[x1 - 3.1, x1 - 0.9, zF - 2.6, zF - 0.4]];
    case 'gasstation':
      // The shop at the back; the pumps under the canopy are open.
      return [[x0, x0 + 10.2, z0, z0 + 8.2], [CENTER_X - 1.4, CENTER_X - 0.6, zF - 5, zF - 4], [CENTER_X + 6.6, CENTER_X + 7.4, zF - 5, zF - 4]];
    case 'villa':
      return [[x0, x1, z0 - 3, zF - 3], [x0 - 2, x1 + 2, zF - 0.5, zF - 0.1]];
    case 'cottage':
      return [[x0, x1, z0 - 3, zF - 3], [x0 - 1, CENTER_X - 1, zF - 0.4, zF - 0.2], [CENTER_X + 1, x1 + 1, zF - 0.4, zF - 0.2]];
    case 'tower':
      return [[x0 - 1, x1 + 1, z0 - 2, zF]];
    case 'factory':
      // The shed, and the container in the yard out back.
      return [[x0, x1, z0, zF], [x0 + 2.9, x0 + 9.1, z0 - 5.3, z0 - 2.7]];
    case 'school':
      // The school, and the bus parked behind it.
      return [[x0, x1, z0, zF], [x1 - 4.3, x1 - 1.7, z0 - 12.6, z0 - 3.4]];
    default:
      return [[x0, x1, z0, zF]];
  }
}

/**
 * Where a lot's building stands (lot frame), so everything around it can be walked and driven:
 * backyards, side gaps, alleys. A house has its garage beside it; your own house has a real
 * garage you can drive into (only its walls are solid).
 */
export function lotSolids(info: LotLook): SolidRect[] {
  if (info.style === 'filler') return info.filler ? fillerSolids(info.filler) : [];
  if (info.style === 'gunshop') {
    // The shop and the fenced range out back.
    return [[CENTER_X - 9, CENTER_X + 9, FACADE_Z - 26.2, FACADE_Z]];
  }
  if (info.style === 'dealer') return [[CENTER_X - 10.4, CENTER_X + 10.4, FACADE_Z - 14.4, FACADE_Z]];
  const { w, d } = lotSize(info);
  const x0 = CENTER_X - w / 2;
  const x1 = CENTER_X + w / 2;
  const out: SolidRect[] = [[x0 - 0.15, x1 + 0.15, FACADE_Z - d - 0.15, FACADE_Z + 0.1]];
  if (info.style === 'house') {
    // The hedge along the front, left of the house.
    out.push([CENTER_X - 18, x0, FACADE_Z - 0.6, FACADE_Z + 0.2]);
    const gx = x1 + 3.6;
    if (!info.ownGarage) out.push([x1 + 0.2, x1 + 7, FACADE_Z - 7.4, FACADE_Z]);
    else if (info.garage) {
      // Your own garage: side walls and the back wall (the door is open to drive through).
      const gd = info.garage;
      out.push([gx - 3.5, gx - 3.1, FACADE_Z - gd - 0.2, FACADE_Z], [gx + 3.1, gx + 3.5, FACADE_Z - gd - 0.2, FACADE_Z], [gx - 3.5, gx + 3.5, FACADE_Z - gd - 0.3, FACADE_Z - gd + 0.15]);
    }
  }
  return out;
}

/** How tall a lot's building is (metres), for the far skyline and for hiding what's in the way. */
export function lotHeight(info: LotLook): number {
  if (info.style === 'filler') {
    const f = info.filler;
    if (!f || f.floors <= 0) return 0;
    if (f.kind === 'tower') return 6 + f.floors * STOREY + 1;
    if (f.kind === 'church') return 14;
    if (f.kind === 'warehouse' || f.kind === 'factory') return f.floors * STOREY + 3;
    return f.floors * STOREY + 0.6;
  }
  if (info.style === 'garden') return 1.2;
  if (info.style === 'gunshop' || info.style === 'dealer') return 5;
  const floors = Math.max(1, info.floors);
  return floors * STOREY + (info.style === 'house' ? 1 : 4);
}
