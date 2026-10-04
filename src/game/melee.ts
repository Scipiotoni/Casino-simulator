/**
 * Melee fighting: fists and melee weapons. Tap to jab (three-hit combos), hold to wind up a
 * heavy blow, hold block to soak hits (it drains stamina; heavy blows can break your guard),
 * and block just as a hit lands to parry: the attacker is stunned and your next hit counters
 * for double damage. Pure rules here; the Brawl class keeps your fighter's state.
 */

export const MAX_STAMINA = 100;
/** Stamina regained per second once you've stopped spending it for a moment. */
export const STAMINA_REGEN = 32;
export const REGEN_DELAY = 0.6;
/** Stamina each move costs. */
export const COST = { light: 7, heavy: 20, roll: 16 };
/** Below this you're winded: no attacking until you get some back. */
export const WINDED = 6;

/** A tap shorter than this is a jab; hold longer and you're winding up a heavy. */
export const TAP_TIME = 0.2;
/** A heavy blow reaches full power after this much wind-up (seconds after the tap time). */
export const HEAVY_CHARGE = 0.7;
/** Jabs within this long of the last one chain into a combo. */
export const COMBO_WINDOW = 0.8;
/** Damage of each step of a three-hit combo, and of a heavy blow at no / full charge. */
export const COMBO_MUL = [1, 1, 1.5];
export const HEAVY_MUL: [number, number] = [1.6, 2.6];

/** Blocking: the first moment of a block is a parry. */
export const PARRY_WINDOW = 0.25;
/** Let go of block and you can't get a fresh parry window again for a moment (no mashing). */
export const PARRY_REARM = 0.45;
/** Damage that gets through a block (jab / heavy), and the stamina a blocked hit costs. */
export const BLOCK_THROUGH = { light: 0.15, heavy: 0.5 };
export const BLOCK_STAMINA = { light: 0.6, heavy: 1.8 };
/** Seconds stunned after a parry or a broken guard. */
export const PARRY_STUN = 1.2;
export const GUARD_BREAK_STUN = 1.0;
/** After a parry, your next hit within this long counters for double damage. */
export const RIPOSTE_TIME = 1.6;
export const RIPOSTE_MUL = 2;

export type Incoming = 'parry' | 'block' | 'guardbreak' | 'hit';

/** How a hit coming in is met: parried, blocked (maybe breaking the guard), or taken. */
export function resolveIncoming(o: { blocking: boolean; blockFor: number; parryArmed: boolean; stamina: number; heavy: boolean; dmg: number; stunned: boolean }): { kind: Incoming; dmg: number; stamina: number } {
  if (o.stunned || !o.blocking) return { kind: 'hit', dmg: o.dmg, stamina: 0 };
  if (o.parryArmed && o.blockFor <= PARRY_WINDOW) return { kind: 'parry', dmg: 0, stamina: 0 };
  const cost = o.dmg * (o.heavy ? BLOCK_STAMINA.heavy : BLOCK_STAMINA.light);
  if (cost >= o.stamina) {
    // Guard broken: the hit gets through at half strength and you're left reeling.
    return { kind: 'guardbreak', dmg: Math.round(o.dmg * 0.5), stamina: o.stamina };
  }
  return { kind: 'block', dmg: Math.round(o.dmg * (o.heavy ? BLOCK_THROUGH.heavy : BLOCK_THROUGH.light)), stamina: cost };
}

/** Damage of a jab at this combo step. */
export function lightDamage(base: number, step: number): number {
  return Math.round(base * COMBO_MUL[Math.max(0, Math.min(COMBO_MUL.length - 1, step))]);
}

/** Damage of a heavy blow wound up to `k` (0..1). */
export function heavyDamage(base: number, k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return Math.round(base * (HEAVY_MUL[0] + (HEAVY_MUL[1] - HEAVY_MUL[0]) * c));
}

/** An attack about to land: what it is and how hard it hits. */
export interface Attack {
  heavy: boolean;
  dmg: number;
  /** Combo step 0..2 (jabs). */
  step: number;
  /** A counter after a parry. */
  riposte: boolean;
}

/**
 * Your fighter: stamina, the combo you're on, a heavy wind-up, blocking and parrying, being
 * stunned, and the counter after a parry. Fed input once a frame; hands back an attack when
 * one should land.
 */
export class Brawl {
  stamina = MAX_STAMINA;
  private sinceSpend = 9;
  /** Seconds left before you can attack again. */
  cool = 0;
  combo = 0;
  private sinceAttack = 9;
  /** How long the attack button has been held (0 = not held). */
  holdT = 0;
  blocking = false;
  /** Seconds you've been blocking for. */
  blockFor = 0;
  private sinceBlock = 9;
  /** This block started fresh enough to parry with. */
  parryArmed = false;
  /** Seconds left stunned. */
  stun = 0;
  /** Seconds left in which your next hit counters. */
  riposte = 0;
  /** Parries landed and guards broken (for the HUD flash). */
  lastEvent: { kind: 'parry' | 'parried' | 'guardbreak' | 'block' | 'counter'; at: number } | null = null;

  /** Wind-up of a heavy blow (0..1), or 0. */
  get charge(): number {
    return this.holdT > TAP_TIME ? Math.min(1, (this.holdT - TAP_TIME) / HEAVY_CHARGE) : 0;
  }

  get stunned(): boolean {
    return this.stun > 0;
  }

  get winded(): boolean {
    return this.stamina < WINDED;
  }

  spend(n: number): boolean {
    if (this.stamina < n * 0.5) return false;
    this.stamina = Math.max(0, this.stamina - n);
    this.sinceSpend = 0;
    return true;
  }

  reset(): void {
    this.stamina = MAX_STAMINA;
    this.cool = 0;
    this.combo = 0;
    this.holdT = 0;
    this.blocking = false;
    this.blockFor = 0;
    this.parryArmed = false;
    this.stun = 0;
    this.riposte = 0;
  }

  /**
   * One frame of input. `rate` is the weapon's attacks per second. Returns an attack to swing
   * now, or null.
   */
  update(dt: number, i: { held: boolean; block: boolean; rate: number; base: number; now: number }): Attack | null {
    this.cool = Math.max(0, this.cool - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.riposte = Math.max(0, this.riposte - dt);
    this.sinceAttack += dt;
    this.sinceSpend += dt;
    if (this.sinceAttack > COMBO_WINDOW) this.combo = 0;
    // Blocking (not while stunned).
    const wantBlock = i.block && !this.stunned;
    if (wantBlock && !this.blocking) {
      this.blocking = true;
      this.blockFor = 0;
      this.parryArmed = this.sinceBlock > PARRY_REARM;
    }
    if (!wantBlock && this.blocking) {
      this.blocking = false;
      this.sinceBlock = 0;
    }
    if (this.blocking) this.blockFor += dt;
    else this.sinceBlock += dt;
    if (!this.blocking && this.sinceSpend > REGEN_DELAY) this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * dt);
    else if (this.blocking && this.sinceSpend > REGEN_DELAY) this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN * 0.25 * dt);
    if (this.stunned || this.blocking) {
      this.holdT = 0;
      return null;
    }
    if (i.held) {
      this.holdT += dt;
      return null;
    }
    if (this.holdT <= 0) return null;
    // Released: a tap is a jab, a hold is a heavy blow.
    const held = this.holdT;
    const k = this.charge;
    this.holdT = 0;
    if (this.cool > 0 || this.winded) return null;
    const heavy = held > TAP_TIME;
    if (!this.spend(heavy ? COST.heavy : COST.light)) return null;
    const riposte = this.riposte > 0;
    let dmg: number;
    let step = 0;
    if (heavy) {
      dmg = heavyDamage(i.base, k);
      this.combo = 0;
      this.cool = Math.max(0.55, 1.4 / i.rate);
    } else {
      step = this.combo;
      dmg = lightDamage(i.base, step);
      this.combo = (this.combo + 1) % COMBO_MUL.length;
      // The finisher of a combo takes a little longer to recover from.
      this.cool = (1 / i.rate) * (step === COMBO_MUL.length - 1 ? 1.5 : 0.85);
    }
    if (riposte) {
      dmg *= RIPOSTE_MUL;
      this.riposte = 0;
      this.lastEvent = { kind: 'counter', at: i.now };
    }
    this.sinceAttack = 0;
    return { heavy, dmg: Math.round(dmg), step, riposte };
  }

  /** A melee hit is coming in: parry, block or take it. Returns how it went and the damage left. */
  incoming(dmg: number, heavy: boolean, now: number): { kind: Incoming; dmg: number } {
    const r = resolveIncoming({ blocking: this.blocking, blockFor: this.blockFor, parryArmed: this.parryArmed, stamina: this.stamina, heavy, dmg, stunned: this.stunned });
    if (r.kind === 'parry') {
      this.riposte = RIPOSTE_TIME;
      this.parryArmed = false;
      this.lastEvent = { kind: 'parry', at: now };
    } else if (r.kind === 'block') {
      this.stamina = Math.max(0, this.stamina - r.stamina);
      this.sinceSpend = 0;
      this.lastEvent = { kind: 'block', at: now };
    } else if (r.kind === 'guardbreak') {
      this.stamina = 0;
      this.sinceSpend = 0;
      this.blocking = false;
      this.sinceBlock = 0;
      this.stun = GUARD_BREAK_STUN;
      this.lastEvent = { kind: 'guardbreak', at: now };
    }
    return { kind: r.kind, dmg: r.dmg };
  }

  /** Your attack got parried: you're left wide open. */
  parried(now: number): void {
    this.stun = PARRY_STUN;
    this.holdT = 0;
    this.combo = 0;
    this.lastEvent = { kind: 'parried', at: now };
  }
}
