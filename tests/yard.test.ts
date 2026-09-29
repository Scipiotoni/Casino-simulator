import { describe, expect, it } from 'vitest';
import { Grid, YARD_Z0, YARD_Z1, YARD_GAP, CENTER_X } from '../src/world/grid';
import { findPath } from '../src/world/pathfinding';

describe('yard', () => {
  it('marks two sidewalk rows in front of the lot, leaving the carpet clear', () => {
    const g = new Grid(0);
    const r = g.rect;
    expect(g.isYard(r.x0, YARD_Z0)).toBe(true);
    expect(g.isYard(r.x1, YARD_Z1)).toBe(true);
    expect(g.isYard(r.x0 - 1, YARD_Z0)).toBe(false);
    expect(g.isYard(r.x0, YARD_Z1 + 1)).toBe(false);
    for (let x = YARD_GAP[0]; x <= YARD_GAP[1]; x++) expect(g.isYard(x, YARD_Z0)).toBe(false);
    expect(g.isYard(CENTER_X, YARD_Z0)).toBe(false);
    expect(new Grid(1).isYard(r.x0, YARD_Z0)).toBe(false);
  });

  it('blocks walkers on occupied sidewalk tiles but keeps the street passable', () => {
    const g = new Grid(0);
    const r = g.rect;
    for (let x = r.x0; x < YARD_GAP[0]; x++) {
      g.setOcc(x, YARD_Z0, 9);
      g.setOcc(x, YARD_Z1, 9);
    }
    expect(g.isWalkable(r.x0, YARD_Z0)).toBe(false);
    const path = findPath(g, r.x0, YARD_Z1 + 2, CENTER_X, 30)!;
    expect(path).not.toBeNull();
    for (const [x, z] of path) expect(g.occupant(x, z)).toBe(0);
  });
});
