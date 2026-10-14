import { describe, expect, it } from 'vitest';
import { MAX_VAULTS, VAULT_TIERS, addLog, clampTransfer, fillVaults, houseCap, houseCash, newHouse, newVaultKey, sanitizeHouse, securityRating, topTier, validCode, vaultInterest } from '../src/game/house';
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
    const b = { key: 'V1', money: 50000, code: '', tier: 1 };
    expect(vaultInterest(b)).toBe(250);
    b.money = VAULT_TIERS[0].cap;
    expect(vaultInterest(b)).toBe(0);
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
    h.vaults.push({ key: 'V1', money: 12345, code: '54321', tier: 2 }, { key: 'V2', money: 500, code: '1111', tier: 1 });
    addLog(h, 3, 'Deposit', 12345);
    const back = sanitizeHouse(JSON.parse(JSON.stringify(h)), ['bungee'], sanitizeAppearance)!;
    expect(back.vaults).toEqual(h.vaults);
    expect(back.log[0].amount).toBe(12345);
    // A code that doesn't fit the tier is dropped; money can't exceed the vault.
    const bad = sanitizeHouse({ ...h, vaults: [{ key: 'V1', code: '12', money: 1e15, tier: 2 }, { key: 'V1', money: 5, code: '', tier: 1 }, { key: 'X', money: 5, tier: 1 }] }, ['bungee'], sanitizeAppearance)!;
    expect(bad.vaults.length).toBe(1);
    expect(bad.vaults[0].code).toBe('');
    expect(bad.vaults[0].money).toBe(VAULT_TIERS[1].cap);
    expect(sanitizeHouse(null, ['bungee'], sanitizeAppearance)).toBeNull();
  });
});

describe('several vaults', () => {
  const look2 = { name: 'Lucky', signFont: 'bungee', signColor: 0, wallColor: 0x3a1d4d, trimColor: 0 };

  it('an old save with one vault becomes vault V1', () => {
    const old = { ...newHouse('Ann', look2), vault: 7000, code: '4321', tier: 1 } as Record<string, unknown>;
    delete old.vaults;
    const h = sanitizeHouse(JSON.parse(JSON.stringify(old)), ['bungee'], sanitizeAppearance)!;
    expect(h.vaults).toEqual([{ key: 'V1', money: 7000, code: '4321', tier: 1 }]);
    // No vault in the old save: none now.
    const none = { ...newHouse('Ann', look2), vault: 0, code: '', tier: 0 } as Record<string, unknown>;
    delete none.vaults;
    expect(sanitizeHouse(none, ['bungee'], sanitizeAppearance)!.vaults).toEqual([]);
  });

  it('each vault keeps its own money, and totals add them up', () => {
    const h = newHouse('Ann', look2);
    h.vaults.push({ key: 'V1', money: 0, code: '', tier: 1 }, { key: 'V2', money: 0, code: '', tier: 2 });
    expect(newVaultKey(h)).toBe('V3');
    expect(houseCap(h)).toBe(VAULT_TIERS[0].cap + VAULT_TIERS[1].cap);
    expect(topTier(h)).toBe(2);
    // Overflow fills them in order, as far as they hold.
    expect(fillVaults(h, VAULT_TIERS[0].cap + 50)).toBe(VAULT_TIERS[0].cap + 50);
    expect(h.vaults[0].money).toBe(VAULT_TIERS[0].cap);
    expect(h.vaults[1].money).toBe(50);
    expect(houseCash(h)).toBe(VAULT_TIERS[0].cap + 50);
    expect(fillVaults(h, 1e15)).toBe(VAULT_TIERS[1].cap - 50);
    // Never more than MAX_VAULTS from a save.
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `V${i + 1}`, money: 1, code: '', tier: 1 }));
    expect(sanitizeHouse({ ...h, vaults: many }, ['bungee'], sanitizeAppearance)!.vaults.length).toBe(MAX_VAULTS);
  });
});

describe('guns', () => {
  it('saves only real guns and only equips owned ones', () => {
    expect(sanitizeGuns({ owned: ['pistol', 'nope', 'pistol'], equipped: 'shotgun' })).toEqual({ owned: ['pistol'], equipped: null, slots: ['pistol', null, null, null, null], mods: {} });
    // Slots keep only owned weapons, once each.
    expect(sanitizeGuns({ owned: ['bat', 'rifle'], slots: ['rifle', 'rifle', 'nope', null, 'bat', 'x'] }).slots).toEqual(['rifle', null, null, null, 'bat']);
    expect(gunDef('katana')?.melee).toBe(true);
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
