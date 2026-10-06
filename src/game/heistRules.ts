/**
 * House heists: the rules, kept free of the 3D world so they can be tested on their own.
 *
 * Walk into another player's house, beat its security (guards, lasers, cameras, locked
 * doors) and crack the vault with a few minigames. How well you play them decides your take:
 * at most 10% of the vault while the owner is offline, 50% while they're online (and can come
 * home to stop you). Once a house has been robbed, nobody can rob it again for a while, and
 * every player sees who did it and how long is left. Lose a minigame and you pay a fine and
 * get thrown out of that house for a few minutes.
 */

/** Most of the vault a heist can take: owner offline / online. */
export const OFFLINE_SHARE = 0.1;
export const ONLINE_SHARE = 0.5;

/** How long a robbed house is off limits to everyone (the owner beefs up security). */
export const OFFLINE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const ONLINE_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Heist records older than this are dropped from what robbers publish: an owner who comes
 * back within a week still finds the robbery taken out of their vault.
 */
export const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Most heist records a player publishes at once. */
export const MAX_RECORDS = 8;

/** One robbery, as the robber publishes it for everyone (the victim applies it to their vault). */
export interface HeistRecord {
  /** Unique id (the victim applies each one once). */
  i: string;
  /** Victim's player id. */
  v: string;
  /** Robber's name (for the victim's log and everyone's door sign). */
  by: string;
  /** When it happened (epoch ms). */
  t: number;
  /** Amount taken from the vault. */
  a: number;
  /** 1 if the owner was online (shorter cooldown, bigger take). */
  on: 0 | 1;
}

/** Cooldown after a robbery. */
export function cooldownMs(online: boolean): number {
  return online ? ONLINE_COOLDOWN_MS : OFFLINE_COOLDOWN_MS;
}

/**
 * The latest robbery of a house and when it can be robbed again (0 = it can right now).
 * `records` can come from anyone (robbers publish theirs, the victim publishes the last one).
 */
export function houseCooldown(victim: string, records: readonly HeistRecord[], now = Date.now()): { last: HeistRecord | null; until: number } {
  let last: HeistRecord | null = null;
  for (const r of records) {
    if (r.v !== victim || r.t > now + 60_000) continue;
    if (!last || r.t > last.t) last = r;
  }
  if (!last) return { last: null, until: 0 };
  const until = last.t + cooldownMs(last.on === 1);
  return { last, until: until > now ? until : 0 };
}

/** Each floor safe hides some valuables out of reach (up to three count). */
export function safeCut(safes: number): number {
  return 1 - 0.12 * Math.max(0, Math.min(3, Math.floor(safes)));
}

/**
 * What a heist takes: the vault times the most you may take (`share`), times how well you
 * played the minigames (0..1), less what the floor safes hide.
 */
export function shareTake(vault: number, share: number, quality: number, safes = 0): number {
  if (!Number.isFinite(vault) || vault <= 0) return 0;
  const q = Math.max(0, Math.min(1, Number.isFinite(quality) ? quality : 0));
  const sh = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return Math.max(0, Math.floor(vault * sh * q * safeCut(safes)));
}

/** A player's house: at most 10% of the vault while the owner is offline, 50% while they're online. */
export function heistTake(vault: number, online: boolean, quality: number, safes = 0): number {
  return shareTake(vault, online ? ONLINE_SHARE : OFFLINE_SHARE, quality, safes);
}

/** The most a heist could take right now (a perfect run). */
export function maxTake(vault: number, online: boolean, safes = 0): number {
  return heistTake(vault, online, 1, safes);
}

/**
 * Uncle Sal's house, the NPC house anyone can rob: a little cash (more as your casino grows)
 * that a perfect run takes all of. Each player has their own Uncle Sal: it refills 15 minutes
 * after you rob it.
 */
export const NPC_REFILL_MS = 15 * 60 * 1000;

/** What Uncle Sal keeps at home when it's full: $3,000 at casino level 1, up to $25,000. */
export function npcStash(level: number): number {
  const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return Math.min(25_000, Math.round((3000 + 1100 * (l - 1)) / 100) * 100);
}

/** How long until Uncle Sal's stash is back after a robbery at `robbedAt` (0 = ready). */
export function npcRefillLeft(robbedAt: number | undefined, now = Date.now()): number {
  if (!robbedAt || !Number.isFinite(robbedAt)) return 0;
  return Math.max(0, Math.min(NPC_REFILL_MS, robbedAt + NPC_REFILL_MS - now));
}

/** Quality of a run from its minigame scores (each 0..1): the average, never below a floor for a win. */
export function runQuality(scores: readonly number[]): number {
  if (!scores.length) return 0;
  const avg = scores.reduce((a, s) => a + Math.max(0, Math.min(1, s)), 0) / scores.length;
  return Math.max(0.25, Math.min(1, avg));
}

/** Lose a minigame: a fine (2% of your cash plus $500 per vault tier, capped, never more than you have). */
export function failFine(cash: number, tier: number): number {
  const c = Math.max(0, Math.floor(Number.isFinite(cash) ? cash : 0));
  const t = Math.max(1, Math.min(5, Math.round(tier) || 1));
  return Math.min(c, 100_000, Math.floor(c * 0.02) + 500 * t);
}

/** Knocked out by the guards: they take a bigger cut (5% plus $1,000 per tier, capped). */
export function guardFine(cash: number, tier: number): number {
  const c = Math.max(0, Math.floor(Number.isFinite(cash) ? cash : 0));
  const t = Math.max(1, Math.min(5, Math.round(tier) || 1));
  return Math.min(c, 250_000, Math.floor(c * 0.05) + 1000 * t);
}

/** Thrown out after losing: how long before you can try that house again. */
export function lockoutMs(tier: number): number {
  const t = Math.max(1, Math.min(5, Math.round(tier) || 1));
  return (3 + 2 * t) * 60_000;
}

/** Seconds the vault's time lock takes to open once it's cracked (better vaults, longer waits). */
export function timelockSeconds(tier: number): number {
  return [10, 18, 28, 40, 55][Math.max(1, Math.min(5, Math.round(tier) || 1)) - 1];
}

export type StageKind = 'pick' | 'dial' | 'hack' | 'drill';

/** One minigame of a heist and how hard it is (1 = easy .. 5 = brutal). */
export interface Stage {
  kind: StageKind;
  level: number;
  /** Mistakes shock you (laser door). */
  shock?: boolean;
}

/** The minigames between you and the money: more and harder for every vault tier. */
export function vaultStages(tier: number): Stage[] {
  const t = Math.max(1, Math.min(5, Math.round(tier) || 1));
  switch (t) {
    case 1:
      return [{ kind: 'pick', level: 1 }, { kind: 'drill', level: 1 }];
    case 2:
      return [{ kind: 'pick', level: 2 }, { kind: 'dial', level: 2 }, { kind: 'drill', level: 2 }];
    case 3:
      return [{ kind: 'hack', level: 3 }, { kind: 'dial', level: 3 }, { kind: 'drill', level: 3 }];
    case 4:
      return [{ kind: 'pick', level: 4 }, { kind: 'hack', level: 4 }, { kind: 'dial', level: 4 }, { kind: 'drill', level: 4 }];
    default:
      return [{ kind: 'pick', level: 5 }, { kind: 'hack', level: 5 }, { kind: 'dial', level: 5 }, { kind: 'drill', level: 5 }];
  }
}

/** The minigames that open a locked door (0 = no lock). */
export function doorStages(lock: number): Stage[] {
  switch (Math.max(0, Math.min(5, Math.round(lock) || 0))) {
    case 0:
      return [];
    case 1:
      return [{ kind: 'pick', level: 1 }];
    case 2:
      return [{ kind: 'pick', level: 3 }];
    case 3:
      return [{ kind: 'hack', level: 2 }];
    case 4:
      return [{ kind: 'dial', level: 3 }, { kind: 'pick', level: 3 }];
    default:
      return [{ kind: 'hack', level: 5, shock: true }];
  }
}

/** Lock-pick: pins to set, how wide the sweet spot is (0..1 of the bar) and how fast the pick sweeps (bars a second). */
export function pickParams(level: number): { pins: number; zone: number; speed: number; picks: number } {
  const l = Math.max(1, Math.min(5, level));
  return { pins: 2 + l, zone: Math.max(0.07, 0.24 - l * 0.033), speed: 0.75 + l * 0.32, picks: 3 };
}

/** Safe dial: numbers to find, dial size, how noisy the stethoscope is and the time allowed. */
export function dialParams(level: number): { numbers: number; size: number; noise: number; time: number; tries: number } {
  const l = Math.max(1, Math.min(5, level));
  return { numbers: 1 + Math.ceil(l / 2), size: 40, noise: 0.04 + l * 0.05, time: 22 + (1 + Math.ceil(l / 2)) * 9, tries: 3 };
}

/** Keypad hack: the sequence to repeat, how fast it flashes (seconds per light) and the lives you get. */
export function hackParams(level: number): { length: number; flash: number; lives: number } {
  const l = Math.max(1, Math.min(5, level));
  return { length: 3 + l, flash: Math.max(0.26, 0.62 - l * 0.07), lives: 2 };
}

/** Thermal drill: how long it has to run (seconds in the green), the green band and the bits you have. */
export function drillParams(level: number): { work: number; band: [number, number]; bits: number; heatUp: number; coolDown: number } {
  const l = Math.max(1, Math.min(5, level));
  const w = Math.max(0.16, 0.34 - l * 0.035);
  const mid = 0.58;
  return { work: 5 + l * 2.5, band: [mid - w / 2, mid + w / 2], bits: 2, heatUp: 0.42 + l * 0.08, coolDown: 0.3 + l * 0.03 };
}

/** Records worth keeping: well formed, not too old (newest first, at most MAX_RECORDS). */
export function cleanRecords(raw: unknown, now = Date.now()): HeistRecord[] {
  const out: HeistRecord[] = [];
  if (!Array.isArray(raw)) return out;
  for (const it of raw.slice(0, 40)) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    if (typeof r.i !== 'string' || typeof r.v !== 'string' || typeof r.t !== 'number' || typeof r.a !== 'number') continue;
    if (!Number.isFinite(r.t) || !Number.isFinite(r.a) || r.a < 0) continue;
    if (now - r.t > RECORD_TTL_MS || r.t > now + 60_000) continue;
    out.push({
      i: r.i.slice(0, 16), v: r.v.slice(0, 80), by: typeof r.by === 'string' ? r.by.replace(/[\u0000-\u001f]/g, '').slice(0, 20) : 'Someone',
      t: r.t, a: Math.min(1e12, Math.floor(r.a)), on: r.on === 1 ? 1 : 0,
    });
  }
  out.sort((a, b) => b.t - a.t);
  return out.slice(0, MAX_RECORDS);
}

/**
 * The victim's side: how much of a published robbery to take out of the vault. A robbery
 * never takes more than half of what's there, and one that comes too soon after the last
 * (a forged or duplicate record) is ignored.
 */
export function applyRobbery(vault: number, rec: HeistRecord, lastRobbedAt: number): number {
  if (rec.t < lastRobbedAt + 10 * 60_000 && lastRobbedAt > 0) return 0;
  return Math.max(0, Math.min(Math.floor(vault * ONLINE_SHARE), Math.floor(rec.a)));
}

/** "1 h 23 min", "12 min", "40 s". */
export function waitText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
