import { describe, expect, it } from 'vitest';
import { VAULT_TIERS, addLog, clampTransfer, newHouse, sanitizeHouse, securityRating, validCode, vaultInterest } from '../src/game/house';
import { GUNS, gunDef, sanitizeGuns } from '../src/game/guns';
import { ITEMS, categoriesFor, itemDef, soldAt } from '../src/items/catalog';
import { KIT_IDS } from '../src/items/models/kit';
import { sanitizeAppearance } from '../src/entities/appearance';

const look = { name: 'Lucky', signFont: 'bungee', signColor: 0, wallColor: 0x3a1d4d, trimColor: 0 };

describe('the house bank', () => {
  it('codes must match the tier length', () => {
    expect(validCode('1234', 1)).toBe(true);
    expect(validCode('123', 1)).toBe(false);
    expect(validCode('12a4', 1)).toBe(false);
    expect(validCode('12345', 2)).toBe(true);
    expect(validCode('1234', 0)).toBe(false);
  });

  it('transfers stay within the source, the vault and its capacity', () => {
    const cap = VAULT_TIERS[0].cap;
    expect(clampTransfer(5000, 0, 1, 3000)).toBe(3000);
    expect(clampTransfer(5000, cap - 1000, 1, 1e9)).toBe(1000);
    expect(clampTransfer(-5000, 2000, 1, 0)).toBe(-2000);
    expect(clampTransfer(100, 0, 0, 1e6)).toBe(0);
  });

  it('pays interest up to capacity, and bigger vaults hold more', () => {
    const h = newHouse('Ann', look);
    h.tier = 1;
    h.vault = 50000;
    expect(vaultInterest(h)).toBe(250);
    h.vault = VAULT_TIERS[0].cap;
    expect(vaultInterest(h)).toBe(0);
    for (let i = 1; i < VAULT_TIERS.length; i++) {
      expect(VAULT_TIERS[i].cap).toBeGreaterThan(VAULT_TIERS[i - 1].cap);
      expect(VAULT_TIERS[i].digits).toBe(VAULT_TIERS[i - 1].digits + 1);
    }
  });

  it('security grows with the vault, guards and gadgets', () => {
    expect(securityRating(0, 0, 0, 0)).toBe(0);
    expect(securityRating(2, 1, 0, 0)).toBeGreaterThan(securityRating(1, 1, 0, 0));
    expect(securityRating(5, 10, 2, 100)).toBe(100);
  });

  it('round-trips through a save and rejects junk', () => {
    const h = newHouse('Ann', look);
    h.tier = 2;
    h.code = '54321';
    h.vault = 12345;
    addLog(h, 3, 'Deposit', 12345);
    const back = sanitizeHouse(JSON.parse(JSON.stringify(h)), ['bungee'], sanitizeAppearance)!;
    expect(back.vault).toBe(12345);
    expect(back.code).toBe('54321');
    expect(back.log[0].amount).toBe(12345);
    // A code that doesn't fit the tier is dropped; money can't exceed the vault.
    const bad = sanitizeHouse({ ...h, code: '12', vault: 1e15 }, ['bungee'], sanitizeAppearance)!;
    expect(bad.code).toBe('');
    expect(bad.vault).toBe(VAULT_TIERS[1].cap);
    expect(sanitizeHouse(null, ['bungee'], sanitizeAppearance)).toBeNull();
  });
});

describe('guns', () => {
  it('saves only real guns and only equips owned ones', () => {
    expect(sanitizeGuns({ owned: ['pistol', 'nope', 'pistol'], equipped: 'shotgun' })).toEqual({ owned: ['pistol'], equipped: null });
    expect(sanitizeGuns({ owned: ['pistol', 'laser'], equipped: 'laser' }).equipped).toBe('laser');
    expect(gunDef('minigun')?.auto).toBe(true);
    expect(new Set(GUNS.map((g) => g.id)).size).toBe(GUNS.length);
  });
});

describe('catalogue', () => {
  it('every kit decoration has a model recipe', () => {
    for (const d of ITEMS) if (d.model === 'kit') expect(KIT_IDS).toContain(String(d.params?.kit));
    expect(ITEMS.filter((d) => d.model === 'kit').length).toBeGreaterThan(100);
    expect(new Set(ITEMS.map((d) => d.id)).size).toBe(ITEMS.length);
  });

  it('the house sells furniture, fun, decor, garden and security', () => {
    expect(categoriesFor('house').map((c) => c.id)).toEqual(['furniture', 'fun', 'decor', 'garden', 'security']);
    expect(soldAt(itemDef('vault'), 'house')).toBe(true);
    expect(soldAt(itemDef('vault'), 'casino')).toBe(false);
    expect(soldAt(itemDef('sofa'), 'hotel')).toBe(false);
    expect(soldAt(itemDef('discoball'), 'casino')).toBe(true);
    expect(soldAt(itemDef('discoball'), 'house')).toBe(true);
    expect(soldAt(itemDef('slot_lucky7'), 'house')).toBe(false);
    expect(itemDef('laser').security).toBeGreaterThan(0);
  });
});
