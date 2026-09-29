import { describe, expect, it } from 'vitest';
import { DOOR_TILES, EXPANSIONS, FACADE_Z, Grid, expansionRect } from '../src/world/grid';
import { findPath, smoothPath } from '../src/world/pathfinding';

describe('grid', () => {
  it('grows every expansion around the fixed entrance', () => {
    let prev = expansionRect(0);
    for (let i = 1; i < EXPANSIONS.length; i++) {
      const r = expansionRect(i);
      expect(r.z1).toBe(FACADE_Z - 1);
      expect(r.x0).toBeLessThanOrEqual(prev.x0);
      expect(r.x1).toBeGreaterThanOrEqual(prev.x1);
      expect(r.z0).toBeLessThanOrEqual(prev.z0);
      expect(r.x1 - r.x0 + 1).toBe(EXPANSIONS[i].w);
      expect(r.z1 - r.z0 + 1).toBe(EXPANSIONS[i].d);
      prev = r;
    }
  });

  it('only connects inside and outside through the door', () => {
    const g = new Grid(0);
    for (const [x, z] of DOOR_TILES) expect(g.isWalkable(x, z)).toBe(true);
    const r = g.rect;
    expect(g.isWalkable(r.x0, FACADE_Z)).toBe(false);
    expect(g.isWalkable(r.x0 - 1, r.z1)).toBe(false);
    expect(g.isWalkable(r.x0, r.z1)).toBe(true);
    const reach = g.reachableFromDoor();
    expect(reach[g.idx(r.x0, r.z0)]).toBe(1);
  });
});

describe('pathfinding', () => {
  it('walks from the sidewalk into the casino', () => {
    const g = new Grid(0);
    const path = findPath(g, 10, 43, 20, 30);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([10, 43]);
    expect(path![path!.length - 1]).toEqual([20, 30]);
    // Must pass through one of the door tiles.
    expect(path!.some(([x, z]) => DOOR_TILES.some(([dx, dz]) => dx === x && dz === z))).toBe(true);
  });

  it('routes around obstacles and never cuts corners', () => {
    const g = new Grid(0);
    for (let x = 18; x <= 28; x++) g.setOcc(x, 33, 99);
    const path = findPath(g, 20, 36, 20, 30)!;
    expect(path).not.toBeNull();
    for (const [x, z] of path) expect(g.occupant(x, z)).toBe(0);
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      if (ax !== bx && az !== bz) {
        expect(g.isWalkable(bx, az) && g.isWalkable(ax, bz)).toBe(true);
      }
    }
    const smooth = smoothPath(g, path, 20.5, 36.5);
    expect(smooth[smooth.length - 1]).toEqual([20.5, 30.5]);
  });

  it('can end on a blocked seat tile, entered orthogonally', () => {
    const g = new Grid(0);
    g.setOcc(22, 30, 5);
    g.setOcc(22, 31, 5);
    const path = findPath(g, 22, 36, 22, 31)!;
    expect(path).not.toBeNull();
    const [px, pz] = path[path.length - 2];
    expect(Math.abs(px - 22) + Math.abs(pz - 31)).toBe(1);
  });

  it('returns null when the goal is sealed off', () => {
    const g = new Grid(0);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.setOcc(24 + dx, 30 + dz, 7);
    g.setOcc(24, 30, 7);
    expect(findPath(g, 20, 36, 24, 30)).toBeNull();
  });
});
