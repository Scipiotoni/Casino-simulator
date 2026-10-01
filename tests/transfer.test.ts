import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, parseImport } from '../src/game/transfer';
import { COSMETICS, sanitizeCosmetics } from '../src/cosmetics/catalog';

const base = {
  v: 2, name: 'Test Palace', look: { name: 'Test Palace', signFont: 'bungee', signColor: 0xff3fa4, wallColor: 0x3a1d4d, trimColor: 0x2fe6ff },
  layout: { width: 1, depth: 2, lift: [20, 30] }, floors: 2, paint: ['', ''],
  items: [{ id: 'slot_lucky7', tx: 20, tz: 36, rot: 0, level: 2, color: 0xffffff, f: 1 }],
  staff: [], rating: 3, money: 123456, xp: 50, level: 4, day: 3, dayMinutes: 700, satAvg: 0.8,
  player: { look: {}, name: 'Ace', x: 1, z: 2, floor: 0 }, objectives: ['a'], stats: { visitors: 12 },
  trash: [], history: [1, 2], floorPainted: 0, lookEdited: false, renamed: true, speed: 2,
  rival: { bank: 5, tier: 1, banUntil: 99999999999999, net: 3 }, createdAt: 1000,
  cosmetics: { owned: ['crown', 'bogus'], on: ['crown', 'searchlights'] },
  hotel: { floors: 5, tier: 2, staying: 12 },
  rebirths: 3,
};

describe('casino export / import', () => {
  it('reads an exported file', () => {
    const r = parseImport(JSON.stringify({ format: EXPORT_FORMAT, v: 2, save: base }));
    if ('error' in r) throw new Error(r.error);
    const s = r.save;
    expect(s.name).toBe('Test Palace');
    expect(s.money).toBe(123456);
    expect(s.layout.lift).toEqual([20, 30]);
    expect(s.items[0].f).toBe(1);
    expect(s.stats.visitors).toBe(12);
    expect(s.rival.banUntil).toBe(0);
    expect(s.cosmetics).toEqual({ owned: ['crown'], on: ['crown'] });
    // An old-style hotel (a tier, no floor plan) becomes a fresh one with cash to rebuild.
    expect(s.hotel).toMatchObject({ bank: 20000, level: 1 });
    expect(s.hotel?.buildings[0].snap.items).toEqual([]);
    expect(s.rebirths).toBe(3);
  });

  it('rejects junk and clamps nonsense', () => {
    expect('error' in parseImport('not json')).toBe(true);
    expect('error' in parseImport('{"hello":1}')).toBe(true);
    const r = parseImport(JSON.stringify({ ...base, level: 1e9, floors: 999, money: 'lots', items: [{ id: 'x'.repeat(99) }] }));
    if ('error' in r) throw new Error(r.error);
    expect(r.save.level).toBe(99);
    expect(r.save.floors).toBeLessThanOrEqual(12);
    expect(r.save.money).toBe(3000);
    expect(r.save.items.length).toBe(0);
  });

  it('cosmetics are all unique and priced', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    for (const c of COSMETICS) expect(c.price).toBeGreaterThanOrEqual(100_000);
    expect(sanitizeCosmetics({ owned: ['halo'], on: ['halo', 'crown'] })).toEqual({ owned: ['halo'], on: ['halo'] });
  });
});

describe('rebirth numerals', () => {
  it('writes roman numerals', async () => {
    const { roman } = await import('../src/game/game');
    expect([1, 4, 9, 14, 40].map(roman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL']);
  });
});
