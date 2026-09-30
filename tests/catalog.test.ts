import { describe, expect, it } from 'vitest';
import { ITEMS, footprintTiles, localPosToWorld, localTileToWorld, rotateOffset, rotatedSize } from '../src/items/catalog';

describe('catalog', () => {
  it('has unique ids and sane numbers', () => {
    const ids = new Set<string>();
    for (const d of ITEMS) {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      if (!d.fixed && !d.hidden) expect(d.price).toBeGreaterThan(0);
      expect(d.size[0]).toBeGreaterThan(0);
      expect(d.size[1]).toBeGreaterThan(0);
      expect(d.colors.length).toBeGreaterThan(0);
      if (d.maxBet) expect(d.maxBet).toBeGreaterThanOrEqual(d.minBet);
    }
  });

  it('keeps every seat inside its footprint', () => {
    for (const d of ITEMS) {
      for (const s of d.seats) {
        expect(s.tile[0]).toBeGreaterThanOrEqual(0);
        expect(s.tile[1]).toBeGreaterThanOrEqual(0);
        expect(s.tile[0]).toBeLessThan(d.size[0]);
        expect(s.tile[1]).toBeLessThan(d.size[1]);
        // The exact seat position lies within the footprint rectangle.
        expect(Math.abs(s.pos[0])).toBeLessThanOrEqual(d.size[0] / 2);
        expect(Math.abs(s.pos[1])).toBeLessThanOrEqual(d.size[1] / 2);
      }
    }
  });

  it('rotates offsets like Object3D.rotation.y', () => {
    // Ry(θ): x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ
    for (let r = 0; r < 4; r++) {
      const th = (r * Math.PI) / 2;
      const [x, z] = rotateOffset(0.3, 0.7, r);
      expect(x).toBeCloseTo(0.3 * Math.cos(th) + 0.7 * Math.sin(th));
      expect(z).toBeCloseTo(-0.3 * Math.sin(th) + 0.7 * Math.cos(th));
    }
  });

  it('maps local tiles into the rotated footprint for every rotation', () => {
    for (const d of ITEMS) {
      for (let rot = 0; rot < 4; rot++) {
        const tiles = footprintTiles(d, 10, 20, rot);
        const set = new Set(tiles.map(([x, z]) => `${x},${z}`));
        const [w, dd] = rotatedSize(d, rot);
        expect(tiles.length).toBe(w * dd);
        for (let lx = 0; lx < d.size[0]; lx++) {
          for (let lz = 0; lz < d.size[1]; lz++) {
            const [x, z] = localTileToWorld(d, 10, 20, rot, lx, lz);
            expect(set.has(`${x},${z}`)).toBe(true);
          }
        }
        // A hotel guest walks to the room's doorway, then lies down in the bed inside.
        for (const s of d.kind === 'room' ? [] : d.seats) {
          const [tx, tz] = localTileToWorld(d, 10, 20, rot, s.tile[0], s.tile[1]);
          const [px, pz] = localPosToWorld(d, 10, 20, rot, s.pos[0], s.pos[1]);
          // Seat positions stay close to their tile (within one tile).
          expect(Math.abs(px - (tx + 0.5))).toBeLessThanOrEqual(1.05);
          expect(Math.abs(pz - (tz + 0.5))).toBeLessThanOrEqual(1.05);
        }
      }
    }
  });
});
