import { describe, expect, it } from 'vitest';
import { Grid, layoutRect } from '../src/world/grid';
import { WALL_STYLES } from '../src/world/walls';
import { sanitizeSnapshot } from '../src/game/save';
import { sanitizeAppearance } from '../src/entities/appearance';
import { KO_MAX_LOSS, koLoss } from '../src/game/combat';
import { GUNS } from '../src/game/guns';

describe('built walls', () => {
  it('block walking, only go inside, and survive an encode round trip', () => {
    const g = new Grid(0, { width: 1, depth: 2 });
    const r = layoutRect({ width: 1, depth: 2 });
    const x = r.x0 + 2;
    const z = r.z0 + 3;
    expect(g.isWalkable(x, z)).toBe(true);
    g.setWall(x, z, 3);
    expect(g.isWall(x, z)).toBe(true);
    expect(g.wallAt(x, z)).toBe(3);
    expect(g.isWalkable(x, z)).toBe(false);
    // Outside the building nothing happens.
    g.setWall(r.x1 + 3, z, 1);
    expect(g.isWall(r.x1 + 3, z)).toBe(false);
    g.setWall(x + 1, z, 0);
    const enc = g.encodeWalls();
    const h = new Grid(0, { width: 1, depth: 2 });
    h.decodeWalls(enc);
    expect(h.wallAt(x, z)).toBe(3);
    expect(h.wallAt(x + 1, z)).toBe(0);
    expect(h.wallCount).toBe(2);
    g.setWall(x, z, -1);
    expect(g.isWalkable(x, z)).toBe(true);
    // No walls: nothing to save.
    expect(new Grid(0).encodeWalls()).toBe('');
  });

  it('walls stay when the building grows', () => {
    const g = new Grid(0, { width: 0, depth: 0 });
    const r = g.rect;
    g.setWall(r.x0 + 1, r.z0 + 1, 5);
    g.setLayout({ width: 2, depth: 4 });
    expect(g.wallAt(r.x0 + 1, r.z0 + 1)).toBe(5);
  });

  it('every style has a price and a swatch', () => {
    expect(WALL_STYLES.length).toBeGreaterThanOrEqual(12);
    for (const s of WALL_STYLES) {
      expect(s.price).toBeGreaterThan(0);
      expect(s.swatch).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('snapshots keep clean wall data and drop junk', () => {
    const base = { look: { name: 'A', signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 }, layout: { width: 0, depth: 0 }, floors: 2, items: [], staff: [] };
    const ok = sanitizeSnapshot({ ...base, walls: ['0:5,3:2,0:4', ''] }, ['bungee'], sanitizeAppearance);
    expect(ok?.walls?.[0]).toBe('0:5,3:2,0:4');
    const bad = sanitizeSnapshot({ ...base, walls: ['<script>', 7] }, ['bungee'], sanitizeAppearance);
    expect(bad?.walls).toBeUndefined();
  });
});

describe('street fights', () => {
  it('a knockout costs 10% of the cash on you, capped', () => {
    expect(koLoss(0)).toBe(0);
    expect(koLoss(-500)).toBe(0);
    expect(koLoss(12345)).toBe(1234);
    expect(koLoss(1e12)).toBe(KO_MAX_LOSS);
  });

  it('every gun has damage and an aiming zoom', () => {
    for (const d of GUNS) {
      expect(d.dmg).toBeGreaterThanOrEqual(0);
      expect(d.adsFov).toBeGreaterThan(5);
      expect(d.adsFov).toBeLessThan(72);
    }
    expect(GUNS.find((d) => d.kind === 'confetti')?.dmg).toBe(0);
    expect(GUNS.find((d) => d.kind === 'sniper')?.adsFov).toBeLessThan(20);
  });
});
