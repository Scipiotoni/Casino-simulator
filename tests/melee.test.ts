import { describe, expect, it } from 'vitest';
import { Brawl, COMBO_MUL, GUARD_BREAK_STUN, HEAVY_CHARGE, MAX_STAMINA, PARRY_STUN, PARRY_WINDOW, RIPOSTE_MUL, TAP_TIME, heavyDamage, lightDamage, resolveIncoming } from '../src/game/melee';
import { FISTS, gunDef, hasWeapon, sanitizeGuns } from '../src/game/guns';

const step = (b: Brawl, sec: number, i: Partial<{ held: boolean; block: boolean }> = {}) => {
  let atk = null;
  for (let t = 0; t < sec - 1e-9; t += 0.02) atk = b.update(0.02, { held: false, block: false, rate: 3, base: 10, now: 0, ...i }) ?? atk;
  return atk;
};

describe('melee: attacks', () => {
  it('a tap is a jab and jabs chain into a three-hit combo', () => {
    const b = new Brawl();
    const hits: number[] = [];
    for (let k = 0; k < 3; k++) {
      step(b, 0.06, { held: true });
      const a = step(b, 0.02)!;
      expect(a.heavy).toBe(false);
      hits.push(a.dmg);
      step(b, 0.5);
    }
    expect(hits).toEqual(COMBO_MUL.map((m) => Math.round(10 * m)));
  });

  it('holding winds up a heavy blow that hits harder the longer you hold', () => {
    const b = new Brawl();
    step(b, TAP_TIME + 0.1, { held: true });
    const weak = step(b, 0.02)!;
    expect(weak.heavy).toBe(true);
    step(b, 2);
    step(b, TAP_TIME + HEAVY_CHARGE + 0.2, { held: true });
    expect(b.charge).toBe(1);
    const full = step(b, 0.02)!;
    expect(full.dmg).toBeGreaterThan(weak.dmg);
    expect(full.dmg).toBe(heavyDamage(10, 1));
  });

  it('attacks cost stamina, and a winded fighter can’t swing', () => {
    const b = new Brawl();
    b.stamina = 3;
    step(b, 0.06, { held: true });
    expect(step(b, 0.02)).toBeNull();
    expect(lightDamage(10, 9)).toBe(Math.round(10 * COMBO_MUL[2]));
  });
});

describe('melee: blocking and parrying', () => {
  it('blocking right as the hit lands parries it', () => {
    const b = new Brawl();
    step(b, 0.1, { block: true });
    const r = b.incoming(20, false, 0);
    expect(r).toEqual({ kind: 'parry', dmg: 0 });
    expect(b.riposte).toBeGreaterThan(0);
  });

  it('a late block only blocks, and costs stamina', () => {
    const b = new Brawl();
    step(b, PARRY_WINDOW + 0.2, { block: true });
    const r = b.incoming(20, false, 0);
    expect(r.kind).toBe('block');
    expect(r.dmg).toBeLessThan(20);
    expect(b.stamina).toBeLessThan(MAX_STAMINA);
  });

  it('mashing block doesn’t give a fresh parry window', () => {
    const b = new Brawl();
    step(b, 0.5, { block: true });
    step(b, 0.06);
    step(b, 0.06, { block: true });
    expect(b.incoming(20, false, 0).kind).toBe('block');
  });

  it('a heavy blow on an exhausted guard breaks it and stuns you', () => {
    const b = new Brawl();
    step(b, 0.5, { block: true });
    b.stamina = 10;
    const r = b.incoming(30, true, 0);
    expect(r.kind).toBe('guardbreak');
    expect(r.dmg).toBe(15);
    expect(b.stun).toBeCloseTo(GUARD_BREAK_STUN);
    expect(b.blocking).toBe(false);
  });

  it('not blocking (or stunned) means taking the full hit', () => {
    expect(resolveIncoming({ blocking: false, blockFor: 0, parryArmed: true, stamina: 100, heavy: false, dmg: 12, stunned: false })).toEqual({ kind: 'hit', dmg: 12, stamina: 0 });
    expect(resolveIncoming({ blocking: true, blockFor: 0, parryArmed: true, stamina: 100, heavy: false, dmg: 12, stunned: true }).kind).toBe('hit');
  });

  it('after a parry your next hit counters for double', () => {
    const b = new Brawl();
    step(b, 0.1, { block: true });
    b.incoming(20, false, 0);
    step(b, 0.04);
    step(b, 0.06, { held: true });
    const a = step(b, 0.02)!;
    expect(a.riposte).toBe(true);
    expect(a.dmg).toBe(10 * RIPOSTE_MUL);
  });

  it('getting parried stuns you: no attacking or blocking for a moment', () => {
    const b = new Brawl();
    b.parried(0);
    expect(b.stun).toBeCloseTo(PARRY_STUN);
    step(b, 0.06, { held: true, block: true });
    expect(b.blocking).toBe(false);
    expect(step(b, 0.02)).toBeNull();
    step(b, PARRY_STUN);
    expect(b.stunned).toBe(false);
  });
});

describe('fists', () => {
  it('everyone has them and they survive a save', () => {
    expect(gunDef(FISTS)?.melee).toBe(true);
    expect(hasWeapon([], FISTS)).toBe(true);
    expect(hasWeapon([], 'bat')).toBe(false);
    expect(sanitizeGuns({ owned: [], equipped: FISTS }).equipped).toBe(FISTS);
    expect(sanitizeGuns({ owned: [], equipped: 'bat' }).equipped).toBeNull();
  });
});
