import { dontPassOddsPays, passOddsPays } from './rules';

/**
 * A full Las Vegas craps layout as a pure state machine: pass / don't pass with 3-4-5x
 * odds, come / don't come travelling to their numbers (with odds), place bets, the field,
 * big 6 / 8, hardways and the one-roll propositions (any 7, any craps, aces, ace-deuce,
 * yo, twelve, C&E and the horn).
 *
 * Bet ids: `pass`, `dontPass`, `passOdds`, `dontOdds`, `come`, `dontCome` (in the box),
 * `come:N`, `comeOdds:N`, `dontCome:N`, `dontComeOdds:N` (travelled to N), `place:N`,
 * `hard:N`, `big6`, `big8`, `field`, `any7`, `anyCraps`, `aces`, `aceDeuce`, `yo`,
 * `twelve`, `ce`, `horn`.
 *
 * House conventions: place bets, hardways and the odds on come bets are OFF on the
 * come-out roll; winning place, hardway and big 6/8 bets are paid and stay up; wins are
 * paid to the dollar (fractions are kept by the house, as at a real table).
 */

export const POINTS = [4, 5, 6, 8, 9, 10];

export interface CrapsDecision {
  id: string;
  /** What came off the layout (lost, or returned with the win). 0 when the bet stays up. */
  stake: number;
  /** Everything handed back to the player (stake included). */
  back: number;
  note: string;
}

export interface CrapsRoll {
  point: number;
  bets: Map<string, number>;
  decisions: CrapsDecision[];
  /** Come and don't come bets that travelled to a number on this roll. */
  moved: { from: string; to: string }[];
}

/** Place bets pay 9:5 on 4/10, 7:5 on 5/9 and 7:6 on 6/8. */
export function placePays(n: number): number {
  return n === 4 || n === 10 ? 9 / 5 : n === 5 || n === 9 ? 7 / 5 : 7 / 6;
}

/** 3-4-5x odds: the most odds allowed behind a line or come bet on this number. */
export function oddsMultiple(n: number): number {
  return n === 4 || n === 10 ? 3 : n === 5 || n === 9 ? 4 : 5;
}

/** Lay odds behind a don't bet: up to six times the flat bet on any number. */
export const LAY_MULTIPLE = 6;

const ONE_ROLL: Record<string, (sum: number, d: [number, number]) => number> = {
  // Each returns the pay "to 1" for the whole bet on this roll (−1 = lost).
  field: (s) => (s === 2 ? 2 : s === 12 ? 3 : [3, 4, 9, 10, 11].includes(s) ? 1 : -1),
  any7: (s) => (s === 7 ? 4 : -1),
  anyCraps: (s) => ([2, 3, 12].includes(s) ? 7 : -1),
  aces: (s) => (s === 2 ? 30 : -1),
  aceDeuce: (s) => (s === 3 ? 15 : -1),
  yo: (s) => (s === 11 ? 15 : -1),
  twelve: (s) => (s === 12 ? 30 : -1),
  // C&E: half on any craps (7:1), half on eleven (15:1).
  ce: (s) => (s === 11 ? 7 : [2, 3, 12].includes(s) ? 3 : -1),
  // Horn: a quarter each on 2, 3, 11 and 12.
  horn: (s) => (s === 2 || s === 12 ? 27 / 4 : s === 3 || s === 11 ? 3 : -1),
};

export const ONE_ROLL_BETS = Object.keys(ONE_ROLL);

export const BET_NAMES: Record<string, string> = {
  pass: 'Pass Line', dontPass: "Don't Pass", passOdds: 'Pass odds', dontOdds: "Don't Pass odds",
  come: 'Come', dontCome: "Don't Come", field: 'Field', big6: 'Big 6', big8: 'Big 8',
  any7: 'Any Seven', anyCraps: 'Any Craps', aces: 'Aces', aceDeuce: 'Ace-Deuce', yo: 'Yo-leven', twelve: 'Twelve', ce: 'C & E', horn: 'Horn',
};

export function betName(id: string): string {
  if (BET_NAMES[id]) return BET_NAMES[id];
  const [kind, n] = id.split(':');
  switch (kind) {
    case 'come': return `Come ${n}`;
    case 'comeOdds': return `Odds on come ${n}`;
    case 'dontCome': return `Don't come ${n}`;
    case 'dontComeOdds': return `Lay odds on ${n}`;
    case 'place': return `Place ${n}`;
    case 'hard': return `Hard ${n}`;
  }
  return id;
}

/** Can this bet go down now? (`reason` says why not.) */
export function canPlace(point: number, bets: Map<string, number>, id: string): { ok: boolean; reason?: string; max?: number } {
  const [kind, ns] = id.split(':');
  const n = Number(ns);
  switch (kind) {
    case 'pass':
    case 'dontPass':
      return point ? { ok: false, reason: 'Line bets go down on the come-out roll.' } : { ok: true };
    case 'come':
    case 'dontCome':
      if (ns) return { ok: false, reason: 'Come bets travel to the numbers by themselves.' };
      return point ? { ok: true } : { ok: false, reason: 'Come bets need a point: use the Pass Line on the come-out.' };
    case 'passOdds':
      if (!point || !bets.get('pass')) return { ok: false, reason: 'Odds go behind a Pass Line bet once there is a point.' };
      return { ok: true, max: bets.get('pass')! * oddsMultiple(point) };
    case 'dontOdds':
      if (!point || !bets.get('dontPass')) return { ok: false, reason: "Lay odds go behind a Don't Pass bet once there is a point." };
      return { ok: true, max: bets.get('dontPass')! * LAY_MULTIPLE };
    case 'comeOdds':
      if (!bets.get(`come:${n}`)) return { ok: false, reason: `No come bet on ${n} to put odds behind.` };
      return { ok: true, max: bets.get(`come:${n}`)! * oddsMultiple(n) };
    case 'dontComeOdds':
      if (!bets.get(`dontCome:${n}`)) return { ok: false, reason: `No don't come bet on ${n} to lay odds behind.` };
      return { ok: true, max: bets.get(`dontCome:${n}`)! * LAY_MULTIPLE };
    case 'place':
      return POINTS.includes(n) ? { ok: true } : { ok: false };
    case 'hard':
      return [4, 6, 8, 10].includes(n) ? { ok: true } : { ok: false };
  }
  return id in ONE_ROLL || id === 'big6' || id === 'big8' ? { ok: true } : { ok: false };
}

/** Contract bets can't be taken down: the pass line once there's a point, and come bets on a number. */
export function isContract(point: number, id: string): boolean {
  return (id === 'pass' && point > 0) || id.startsWith('come:');
}

/** Roll the dice against everything on the layout. */
export function crapsRoll(point: number, before: Map<string, number>, dice: [number, number]): CrapsRoll {
  const bets = new Map(before);
  const decisions: CrapsDecision[] = [];
  const moved: { from: string; to: string }[] = [];
  const sum = dice[0] + dice[1];
  const hard = dice[0] === dice[1];
  const comeOut = point === 0;
  const amt = (id: string) => bets.get(id) ?? 0;
  /** Off the layout: lost (pays −1), pushed (0) or won (pays > 0, stake comes back too). */
  const decide = (id: string, pays: number, note: string) => {
    const a = amt(id);
    if (!a) return;
    bets.delete(id);
    decisions.push({ id, stake: a, back: pays < 0 ? 0 : a + Math.floor(a * pays), note });
  };
  /** A winner that stays up: only the win is handed over. */
  const payUp = (id: string, pays: number, note: string) => {
    const a = amt(id);
    if (a) decisions.push({ id, stake: 0, back: Math.floor(a * pays), note });
  };

  // One-roll bets.
  for (const id of ONE_ROLL_BETS) {
    if (!amt(id)) continue;
    const p = ONE_ROLL[id](sum, dice);
    decide(id, p, p < 0 ? `${betName(id)} loses` : `${betName(id)} pays ${fmtPays(p)}`);
  }
  // Big 6 / big 8 work all the time.
  for (const [id, n] of [['big6', 6], ['big8', 8]] as [string, number][]) {
    if (!amt(id)) continue;
    if (sum === n) payUp(id, 1, `${betName(id)} wins`);
    else if (sum === 7) decide(id, -1, `${betName(id)} loses`);
  }
  // Hardways and place bets are off on the come-out.
  if (!comeOut) {
    for (const n of [4, 6, 8, 10]) {
      const id = `hard:${n}`;
      if (!amt(id)) continue;
      if (sum === n && hard) payUp(id, n === 6 || n === 8 ? 9 : 7, `Hard ${n} pays ${n === 6 || n === 8 ? 9 : 7}:1`);
      else if (sum === n || sum === 7) decide(id, -1, `Hard ${n} loses`);
    }
    for (const n of POINTS) {
      const id = `place:${n}`;
      if (!amt(id)) continue;
      if (sum === n) payUp(id, placePays(n), `Place ${n} pays ${fmtPays(placePays(n))}`);
      else if (sum === 7) decide(id, -1, `Place ${n} loses`);
    }
  }
  // Come bets already on their numbers (their odds are off on the come-out).
  for (const n of POINTS) {
    if (sum === n) {
      decide(`come:${n}`, 1, `Come ${n} wins`);
      decide(`comeOdds:${n}`, comeOut ? 0 : passOddsPays(n), comeOut ? `Come odds on ${n} returned (off)` : `Come odds pay ${fmtPays(passOddsPays(n))}`);
      decide(`dontCome:${n}`, -1, `Don't come ${n} loses`);
      decide(`dontComeOdds:${n}`, -1, '');
    } else if (sum === 7) {
      decide(`come:${n}`, -1, `Come ${n} loses`);
      decide(`comeOdds:${n}`, comeOut ? 0 : -1, comeOut ? `Come odds on ${n} returned (off)` : '');
      decide(`dontCome:${n}`, 1, `Don't come ${n} wins`);
      decide(`dontComeOdds:${n}`, dontPassOddsPays(n), `Lay odds on ${n} pay ${fmtPays(dontPassOddsPays(n))}`);
    }
  }
  // The come and don't come boxes act like a come-out roll of their own.
  if (amt('come')) {
    if (sum === 7 || sum === 11) decide('come', 1, `Come wins on ${sum}`);
    else if (sum === 2 || sum === 3 || sum === 12) decide('come', -1, 'Come loses to craps');
    else {
      bets.set(`come:${sum}`, amt(`come:${sum}`) + amt('come'));
      bets.delete('come');
      moved.push({ from: 'come', to: `come:${sum}` });
    }
  }
  if (amt('dontCome')) {
    if (sum === 2 || sum === 3) decide('dontCome', 1, `Don't come wins on ${sum}`);
    else if (sum === 12) decisions.push({ id: 'dontCome', stake: 0, back: 0, note: "Don't come bars the 12: push" });
    else if (sum === 7 || sum === 11) decide('dontCome', -1, "Don't come loses");
    else {
      bets.set(`dontCome:${sum}`, amt(`dontCome:${sum}`) + amt('dontCome'));
      bets.delete('dontCome');
      moved.push({ from: 'dontCome', to: `dontCome:${sum}` });
    }
  }
  // The line.
  let next = point;
  if (comeOut) {
    if (sum === 7 || sum === 11) {
      decide('pass', 1, `${sum}: winner, Pass Line pays`);
      decide('dontPass', -1, "Don't Pass loses");
    } else if (sum === 2 || sum === 3 || sum === 12) {
      decide('pass', -1, `${sum}: craps, Pass Line loses`);
      if (sum === 12) {
        if (amt('dontPass')) decisions.push({ id: 'dontPass', stake: 0, back: 0, note: "Bar 12: Don't Pass pushes" });
      } else decide('dontPass', 1, "Don't Pass wins");
    } else next = sum;
  } else if (sum === point) {
    decide('pass', 1, `${sum}: point made, Pass Line wins`);
    decide('passOdds', passOddsPays(point), `Odds pay ${fmtPays(passOddsPays(point))}`);
    decide('dontPass', -1, "Don't Pass loses");
    decide('dontOdds', -1, '');
    next = 0;
  } else if (sum === 7) {
    decide('pass', -1, 'Seven out: Pass Line loses');
    decide('passOdds', -1, '');
    decide('dontPass', 1, "Don't Pass wins");
    decide('dontOdds', dontPassOddsPays(point), `Lay odds pay ${fmtPays(dontPassOddsPays(point))}`);
    next = 0;
  }
  return { point: next, bets, decisions, moved };
}

/** 1.2 → "6:5", 1.5 → "3:2", 2 → "2:1". */
export function fmtPays(p: number): string {
  for (const d of [1, 2, 3, 4, 5, 6]) {
    const n = p * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return `${Math.round(n)}:${d}`;
  }
  return `${Math.round(p * 100) / 100}:1`;
}
