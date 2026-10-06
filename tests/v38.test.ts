import { describe, expect, it } from 'vitest';
import { pickTarget, soldierHitChance, SOLDIER_HP, SOLDIER_KO } from '../src/world/militaryBase';
import { carDef, tunedSpecs } from '../src/world/vehicles';

describe('Fort Mojave raids as a crew', () => {
  it('soldiers go for the closest target they can see, so a crew splits their fire', () => {
    const all = () => true;
    const targets = [{ x: 30, z: 0, ok: true }, { x: 10, z: 0, ok: true }, { x: 5, z: 0, ok: false }];
    expect(pickTarget(0, 0, targets, 75, all)).toBe(1);
    // A wall hides the closer one: shoot the other.
    expect(pickTarget(0, 0, targets, 75, (x: number) => x !== 10)).toBe(0);
    // Nobody in sight range.
    expect(pickTarget(0, 0, [{ x: 80, z: 0, ok: true }], 75, all)).toBe(-1);
  });

  it('soldiers are easier: softer and less accurate', () => {
    expect(SOLDIER_HP.rifle).toBeLessThan(150);
    expect(SOLDIER_KO).toBeGreaterThan(30);
    expect(soldierHitChance(0)).toBeLessThanOrEqual(0.3);
    expect(soldierHitChance(0, true)).toBeLessThanOrEqual(0.38);
    expect(soldierHitChance(40)).toBeLessThan(soldierHitChance(5));
    expect(soldierHitChance(500)).toBeGreaterThan(0);
  });
});

describe('Prototype X-1', () => {
  it('is tough, repairs itself and has nitro that never runs out', () => {
    const d = carDef('stealth')!;
    expect(d.hp).toBeGreaterThanOrEqual(600);
    expect(d.armor).toBeLessThan(0.5);
    expect(d.regen).toBeGreaterThan(0);
    expect(tunedSpecs(d, null).nitro).toBeGreaterThan(0);
    // Tuning it never lowers the built-in nitro.
    expect(tunedSpecs(d, { engine: 0, turbo: 0, tires: 0, brakes: 0, nitro: 1 } as never).nitro).toBe(3);
    // Ordinary cars still have none until it's fitted.
    expect(tunedSpecs(carDef('hatch')!, null).nitro).toBe(0);
  });
});

describe('heist locked doors', () => {
  it('a locked door cuts a room off until it is cracked, whatever route you take', async () => {
    const { Grid, FACADE_Z } = await import('../src/world/grid');
    const { heistReachable } = await import('../src/game/heist');
    const g = new Grid(0, { width: 1, depth: 2 });
    const r = g.rect;
    // A wall across the house with one locked door in it.
    const wz = FACADE_Z - 4;
    for (let x = r.x0; x <= r.x1; x++) g.setWall(x, wz, 0);
    const dx = Math.floor((r.x0 + r.x1) / 2);
    g.setDoor(dx, wz, 2);
    const front: [number, number] = [dx, wz + 2];
    const back: [number, number] = [dx, wz - 2];
    expect(heistReachable(g, ...front, ...back, () => false)).toBe(false);
    expect(heistReachable(g, ...front, dx + 2, wz + 1, () => false)).toBe(true);
    expect(heistReachable(g, ...front, ...back, () => true)).toBe(true);
  });
});
