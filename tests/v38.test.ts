import { describe, expect, it } from 'vitest';
import { pickTarget, soldierHitChance, SOLDIER_HP, SOLDIER_MAX_HIT, SOLDIER_SIGHT } from '../src/world/militaryBase';
import { carDef, tunedSpecs } from '../src/world/vehicles';

describe('Fort Mojave raids as a crew', () => {
  it('soldiers go for the closest target they can see, so a crew splits their fire', () => {
    const all = () => true;
    const targets = [{ x: 30, z: 0, ok: true }, { x: 10, z: 0, ok: true }, { x: 5, z: 0, ok: false }];
    expect(pickTarget(0, 0, targets, all)).toBe(1);
    // A wall hides the closer one: shoot the other.
    expect(pickTarget(0, 0, targets, (x) => x !== 10)).toBe(0);
    // Nobody in sight range.
    expect(pickTarget(0, 0, [{ x: SOLDIER_SIGHT + 5, z: 0, ok: true }], all)).toBe(-1);
  });

  it('soldiers are easier: softer and less accurate', () => {
    expect(SOLDIER_HP).toBeLessThan(120);
    expect(soldierHitChance(0)).toBeLessThanOrEqual(SOLDIER_MAX_HIT);
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
