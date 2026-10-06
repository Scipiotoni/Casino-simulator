import { describe, expect, it } from 'vitest';
import { migrateSave } from '../src/game/save';
import { generateRival, rivalTier } from '../src/game/rival';
import { newRival } from '../src/game/save';

describe('saves', () => {
  it('migrates a version 1 save onto the new lot rules', () => {
    // v1: 48-wide grid from z = 0, carpet style 3 on row 30 at x = 20..22
    const floor = `0:${30 * 48 + 20},3:3,0:${48 * 46 - (30 * 48 + 23)}`;
    const v1 = {
      v: 1, name: 'Old Joint', look: { name: 'Old Joint', signFont: 'bungee', signColor: 1, wallColor: 2, trimColor: 3 },
      money: 1234, xp: 5, level: 4, day: 3, dayMinutes: 100, rating: 3, satAvg: 60, expansion: 5, floor,
      items: [], staff: [{ role: 'cashier', name: 'Pat', look: {} }], player: { look: {}, name: 'Boss', x: 24, z: 37 },
      objectives: ['first_slot'], stats: {}, jackpotPot: 5000, trash: [[20, 30]], history: [], floorPainted: 3, lookEdited: true, renamed: false, speed: 1,
    };
    const s = migrateSave(v1)!;
    expect(s.v).toBe(2);
    expect(s.layout.width).toBe(2);
    expect(s.floors).toBe(1);
    expect(s.staff[0].role).toBe('doorman');
    expect(s.trash[0]).toEqual([20, 30, 0]);
    expect(s.paint[0]).toContain('3:3');
    expect(s.money).toBe(1234);
  });

  it('rejects junk', () => {
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave({ v: 99 })).toBeNull();
  });
});

describe('rival', () => {
  it('grows with its bank and fills every floor', () => {
    const r = newRival();
    expect(rivalTier(r.bank)).toBe(0);
    r.bank = 1_000_000;
    r.tier = rivalTier(r.bank);
    const snap = generateRival(r);
    expect(snap.floors).toBeGreaterThan(1);
    for (let f = 0; f < snap.floors; f++) expect(snap.items.some((i) => (i.f ?? 0) === f)).toBe(true);
    expect(snap.items.some((i) => i.id === 'blackjack')).toBe(true);
  });
});

describe('table dealers in saves', () => {
  it('keeps whether a table has a dealer, and leaves old tables unmarked', async () => {
    const { sanitizeSnapshot } = await import('../src/game/save');
    const look = { name: 'X', signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 };
    const item = (dl?: unknown) => ({ id: 'blackjack', tx: 20, tz: 30, rot: 0, level: 1, color: 0, dl });
    const snap = sanitizeSnapshot({ look, layout: { width: 0, depth: 0 }, floors: 1, items: [item(true), item(false), item(), item('yes')], staff: [] }, ['bungee'], () => ({}) as never)!;
    expect(snap.items.map((i) => i.dl)).toEqual([true, false, undefined, undefined]);
  });
});
