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

describe('the police', async () => {
  const { Police, HEAT } = await import('../src/world/police');
  const { bustFine } = await import('../src/game/combat');

  it('crimes raise the wanted level; hurting someone is always at least one star', () => {
    const p = new Police();
    expect(p.stars).toBe(0);
    p.crime(HEAT.car, false);
    expect(p.stars).toBe(0);
    p.crime(HEAT.hitPerson);
    expect(p.stars).toBe(1);
    for (let i = 0; i < 20; i++) p.crime(HEAT.koCop);
    expect(p.stars).toBe(5);
    p.clear();
    expect(p.stars).toBe(0);
  });

  it('getting busted costs more the more stars you had, never more than you carry', () => {
    expect(bustFine(10000, 1)).toBe(750);
    expect(bustFine(10000, 5)).toBe(3750);
    expect(bustFine(100, 3)).toBe(100);
    expect(bustFine(0, 2)).toBe(0);
    expect(bustFine(1e12, 5)).toBe(250000);
  });
});

describe('car tuning', async () => {
  const v = await import('../src/world/vehicles');
  it('tuning makes cars faster and grippier, stock cars drive as listed', () => {
    const d = v.carDef('muscle')!;
    const stock = v.tunedSpecs(d, v.defaultMods(d));
    expect(stock.top).toBe(d.top);
    const tuned = v.tunedSpecs(d, { ...v.defaultMods(d), engine: 3, turbo: 3, tires: 3, brakes: 3, nitro: 2 });
    expect(tuned.top).toBeGreaterThan(stock.top);
    expect(tuned.accel).toBeGreaterThan(stock.accel);
    expect(tuned.grip).toBeGreaterThan(stock.grip);
    expect(tuned.brake).toBeGreaterThan(1);
    expect(tuned.nitro).toBe(2);
  });
  it('mods from saves or other players are cleaned up', () => {
    const d = v.carDef('super')!;
    const m = v.sanitizeMods(d, { finish: 'plutonium', rims: 'mesh', engine: 99, plate: 'hi <b>!', glow: -5, spoiler: 'gt' });
    expect(m.finish).toBe(v.defaultMods(d).finish);
    expect(m.rims).toBe('mesh');
    expect(m.engine).toBe(3);
    expect(m.plate).toBe('HI B');
    expect(m.glow).toBe(0);
    expect(m.spoiler).toBe('gt');
  });
});

describe('double doors', () => {
  it('pair up two doors of the same kind side by side, both walkable', () => {
    const g = new Grid(0, { width: 1, depth: 2 });
    const r = layoutRect({ width: 1, depth: 2 });
    const z = r.z0 + 4;
    for (let x = r.x0 + 1; x <= r.x0 + 8; x++) g.setWall(x, z, 0);
    const a = r.x0 + 3;
    g.setDoor(a, z, 1);
    expect(g.doorPartner(a, z)).toBeNull();
    g.setDoor(a + 1, z, 1);
    expect(g.doorPartner(a, z)).toEqual([a + 1, z]);
    expect(g.doorPartner(a + 1, z)).toEqual([a, z]);
    expect(g.isWalkable(a, z) && g.isWalkable(a + 1, z)).toBe(true);
    // A different kind of door next to it isn't its other half.
    g.setDoor(a + 2, z, 2);
    expect(g.doorPartner(a + 2, z)).toBeNull();
    // A run of four of the same pairs up from the west end: two double doors.
    g.setDoor(a + 2, z, 1);
    g.setDoor(a + 3, z, 1);
    expect(g.doorPartner(a + 2, z)).toEqual([a + 3, z]);
    expect(g.doorPartner(a + 1, z)).toEqual([a, z]);
    // Survives saving.
    const h = new Grid(0, { width: 1, depth: 2 });
    h.decodeWalls(g.encodeWalls());
    expect(h.doorPartner(a, z)).toEqual([a + 1, z]);
  });

  it('pairs along north-south walls too', () => {
    const g = new Grid(0, { width: 1, depth: 2 });
    const r = layoutRect({ width: 1, depth: 2 });
    const x = r.x0 + 5;
    for (let z = r.z0 + 1; z <= r.z0 + 8; z++) g.setWall(x, z, 0);
    g.setDoor(x, r.z0 + 4, 0);
    g.setDoor(x, r.z0 + 5, 0);
    expect(g.doorPartner(x, r.z0 + 5)).toEqual([x, r.z0 + 4]);
  });
});
