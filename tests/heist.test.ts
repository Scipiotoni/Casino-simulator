import { describe, expect, it } from 'vitest';
import {
  OFFLINE_COOLDOWN_MS, ONLINE_COOLDOWN_MS, applyRobbery, cleanRecords, cooldownMs, dialParams, doorStages, drillParams, failFine, guardFine, hackParams,
  heistTake, houseCooldown, lockoutMs, maxTake, pickParams, runQuality, safeCut, timelockSeconds, vaultStages, waitText, type HeistRecord,
} from '../src/game/heistRules';
import { DOOR_BASE, Grid, layoutRect } from '../src/world/grid';
import { DOOR_TYPES, doorsInEncoded } from '../src/world/walls';
import { sanitizeHouse } from '../src/game/house';
import { sanitizeAppearance } from '../src/entities/appearance';
import { securityRating } from '../src/game/house';

const rec = (over: Partial<HeistRecord> = {}): HeistRecord => ({ i: 'r1', v: 'victim', by: 'Robber', t: Date.now() - 60_000, a: 1000, on: 0, ...over });

describe('heist take', () => {
  it('is at most 10% of the vault offline and 50% online', () => {
    expect(maxTake(1_000_000, false)).toBe(100_000);
    expect(maxTake(1_000_000, true)).toBe(500_000);
    expect(heistTake(1_000_000, false, 0.5)).toBe(50_000);
    expect(heistTake(1_000_000, true, 2)).toBe(500_000);
    expect(heistTake(0, true, 1)).toBe(0);
    expect(heistTake(-5, true, 1)).toBe(0);
    expect(heistTake(Number.NaN, true, 1)).toBe(0);
  });

  it('floor safes hide some of it (up to three count)', () => {
    expect(safeCut(0)).toBe(1);
    expect(safeCut(1)).toBeCloseTo(0.88);
    expect(safeCut(3)).toBeCloseTo(0.64);
    expect(safeCut(10)).toBeCloseTo(0.64);
    expect(maxTake(1_000_000, false, 1)).toBe(88_000);
  });

  it('a run’s quality is the average score with a floor', () => {
    expect(runQuality([])).toBe(0);
    expect(runQuality([1, 1, 1])).toBe(1);
    expect(runQuality([1, 0.5])).toBe(0.75);
    expect(runQuality([0, 0])).toBe(0.25);
    expect(runQuality([5, -2])).toBe(0.5);
  });
});

describe('shared cooldown', () => {
  it('locks a robbed house for everyone: longer when the owner was offline', () => {
    const now = Date.now();
    expect(cooldownMs(false)).toBe(OFFLINE_COOLDOWN_MS);
    expect(cooldownMs(true)).toBe(ONLINE_COOLDOWN_MS);
    expect(OFFLINE_COOLDOWN_MS).toBeGreaterThan(ONLINE_COOLDOWN_MS);
    const off = houseCooldown('victim', [rec({ t: now - 60_000 })], now);
    expect(off.last?.by).toBe('Robber');
    expect(off.until).toBe(now - 60_000 + OFFLINE_COOLDOWN_MS);
    const on = houseCooldown('victim', [rec({ t: now - 2 * ONLINE_COOLDOWN_MS, on: 1 })], now);
    expect(on.until).toBe(0);
    // Other houses' robberies don't count; the latest one wins.
    const many = houseCooldown('victim', [rec({ v: 'other' }), rec({ i: 'a', t: now - 5000, by: 'Late' }), rec({ i: 'b', t: now - 90_000, by: 'Early' })], now);
    expect(many.last?.by).toBe('Late');
    expect(houseCooldown('nobody', [rec()], now).until).toBe(0);
  });

  it('cleans published records (untrusted)', () => {
    const now = Date.now();
    const out = cleanRecords([rec(), { i: 5 }, null, rec({ i: 'old', t: now - 10 * 86400_000 }), rec({ i: 'neg', a: -5 }), rec({ i: 'fut', t: now + 3600_000 }), rec({ i: 'x'.repeat(40), by: 'A\u0000B' })], now);
    expect(out.map((r) => r.i)).toEqual(['r1', 'x'.repeat(16)]);
    expect(out[1].by).toBe('AB');
    expect(cleanRecords('junk')).toEqual([]);
    expect(cleanRecords(Array.from({ length: 30 }, (_, k) => rec({ i: `r${k}`, t: now - k * 1000 })), now)).toHaveLength(8);
  });

  it('the victim never loses more than half the vault, and ignores robberies that come too soon', () => {
    expect(applyRobbery(100_000, rec({ a: 30_000 }), 0)).toBe(30_000);
    expect(applyRobbery(100_000, rec({ a: 90_000 }), 0)).toBe(50_000);
    const last = Date.now() - 2 * 60_000;
    expect(applyRobbery(100_000, rec({ a: 10_000 }), last)).toBe(0);
    expect(applyRobbery(100_000, rec({ a: 10_000, t: last + 11 * 60_000 }), last)).toBe(10_000);
  });
});

describe('losing', () => {
  it('fines never take more than you carry', () => {
    expect(failFine(0, 3)).toBe(0);
    expect(failFine(1000, 5)).toBe(1000);
    expect(failFine(100_000, 1)).toBe(2500);
    expect(failFine(1e12, 5)).toBe(100_000);
    expect(guardFine(100_000, 2)).toBe(7000);
    expect(guardFine(1e12, 5)).toBe(250_000);
    expect(lockoutMs(1)).toBe(5 * 60_000);
    expect(lockoutMs(5)).toBe(13 * 60_000);
  });

  it('formats waits', () => {
    expect(waitText(5000)).toBe('5 s');
    expect(waitText(12 * 60_000)).toBe('12 min');
    expect(waitText(83 * 60_000)).toBe('1 h 23 min');
    expect(waitText(4 * 3600_000)).toBe('4 h');
  });
});

describe('minigames scale with the vault', () => {
  it('better vaults ask for more, harder stages and a longer time lock', () => {
    for (let t = 1; t < 5; t++) {
      const a = vaultStages(t);
      const b = vaultStages(t + 1);
      expect(b.length).toBeGreaterThanOrEqual(a.length);
      expect(b.reduce((s, x) => s + x.level, 0)).toBeGreaterThan(a.reduce((s, x) => s + x.level, 0));
      expect(timelockSeconds(t + 1)).toBeGreaterThan(timelockSeconds(t));
      expect(vaultStages(t).at(-1)?.kind).toBe('drill');
    }
    expect(pickParams(5).zone).toBeLessThan(pickParams(1).zone);
    expect(pickParams(5).speed).toBeGreaterThan(pickParams(1).speed);
    expect(pickParams(5).pins).toBeGreaterThan(pickParams(1).pins);
    expect(dialParams(5).numbers).toBeGreaterThan(dialParams(1).numbers);
    expect(dialParams(5).noise).toBeGreaterThan(dialParams(1).noise);
    expect(hackParams(5).length).toBeGreaterThan(hackParams(1).length);
    expect(hackParams(5).flash).toBeLessThan(hackParams(1).flash);
    const d1 = drillParams(1);
    const d5 = drillParams(5);
    expect(d5.work).toBeGreaterThan(d1.work);
    expect(d5.band[1] - d5.band[0]).toBeLessThan(d1.band[1] - d1.band[0]);
  });

  it('doors: no lock, then harder locks, the laser door shocks', () => {
    expect(doorStages(0)).toEqual([]);
    expect(doorStages(1)).toHaveLength(1);
    expect(doorStages(4).length).toBeGreaterThan(1);
    expect(doorStages(5)[0].shock).toBe(true);
    for (const d of DOOR_TYPES) expect(doorStages(d.lock).length > 0).toBe(d.lock > 0);
  });
});

describe('doors in walls', () => {
  it('hang between walls, let people through and survive saving', () => {
    const g = new Grid(0, { width: 1, depth: 2 });
    const r = layoutRect({ width: 1, depth: 2 });
    const z = r.z0 + 5;
    const x = r.x0 + 4;
    g.setWall(x - 1, z, 0);
    g.setWall(x + 1, z, 0);
    expect(g.doorRun(x, z)).toBe('x');
    g.setDoor(x, z, 2);
    expect(g.doorAt(x, z)).toBe(2);
    expect(g.isWall(x, z)).toBe(false);
    expect(g.inWallLine(x, z)).toBe(true);
    expect(g.isWalkable(x, z)).toBe(true);
    expect(g.isWalkable(x - 1, z)).toBe(false);
    expect(g.wallCount).toBe(2);
    expect(g.doors()).toEqual([{ x, z, type: 2 }]);
    const enc = g.encodeWalls();
    expect(enc).toContain(`${DOOR_BASE + 2}:1`);
    expect(doorsInEncoded(enc)).toEqual([2]);
    const h = new Grid(0, { width: 1, depth: 2 });
    h.decodeWalls(enc);
    expect(h.doorAt(x, z)).toBe(2);
    g.setDoor(x, z, -1);
    expect(g.doorAt(x, z)).toBe(-1);
    expect(g.inWallLine(x, z)).toBe(false);
  });

  it('a door needs a wall on both sides (the building’s outer wall counts)', () => {
    const g = new Grid(0, { width: 0, depth: 0 });
    const r = g.rect;
    expect(g.doorRun(r.x0 + 4, r.z0 + 4)).toBe(null);
    // Against the outer wall: one built wall is enough.
    g.setWall(r.x0 + 1, r.z0 + 4, 0);
    expect(g.doorRun(r.x0, r.z0 + 4)).toBe('x');
    g.setWall(r.x0 + 6, r.z0 + 3, 0);
    g.setWall(r.x0 + 6, r.z0 + 5, 0);
    expect(g.doorRun(r.x0 + 6, r.z0 + 4)).toBe('z');
  });

  it('every door type has a price and the locks get stronger', () => {
    expect(DOOR_TYPES[0].lock).toBe(0);
    for (let i = 1; i < DOOR_TYPES.length; i++) {
      expect(DOOR_TYPES[i].lock).toBeGreaterThan(DOOR_TYPES[i - 1].lock);
      expect(DOOR_TYPES[i].price).toBeGreaterThan(DOOR_TYPES[i - 1].price);
      expect(DOOR_TYPES[i].security).toBeGreaterThan(DOOR_TYPES[i - 1].security);
    }
    expect(doorsInEncoded('0:10,1:3,205:2,999:1')).toEqual([5, 5, DOOR_TYPES.length - 1]);
    expect(doorsInEncoded(undefined)).toEqual([]);
  });
});

describe('house', () => {
  it('keeps the last robbery through a save and drops junk', () => {
    const snap = { look: { name: 'H', signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 }, layout: { width: 0, depth: 0 }, floors: 1, items: [], staff: [] };
    const h = sanitizeHouse({ snap, vault: 5000, tier: 1, code: '1234', log: [], robbed: rec() }, ['bungee'], sanitizeAppearance);
    expect(h?.robbed?.by).toBe('Robber');
    const bad = sanitizeHouse({ snap, vault: 5000, tier: 1, code: '1234', log: [], robbed: { i: 3 } }, ['bungee'], sanitizeAppearance);
    expect(bad?.robbed).toBeNull();
    expect(securityRating(2, 1, 1, 10)).toBe(20 + 9 + 6 + 10);
  });
});
