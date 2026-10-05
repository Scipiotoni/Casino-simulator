import type { Card } from './types';
import { Shoe, bestHand, isRed } from './cards';

/**
 * Standard casino rule sets (Las Vegas / European conventions) used both by the games you
 * play at other casinos and by the guests at your own tables. Everything here is pure and
 * unit-tested; payouts are "to 1" unless a name says otherwise.
 */

const pv = (c: Card) => (c.rank === 0 ? 14 : c.rank + 1);

// ------------------------------------------------------------------ baccarat (punto banco)

/** Baccarat point value: A=1, 2–9 face value, 10/J/Q/K = 0. */
export function baccaratValue(c: Card): number {
  return c.rank >= 9 ? 0 : c.rank + 1;
}

export function baccaratTotal(cards: Card[]): number {
  return cards.reduce((a, c) => a + baccaratValue(c), 0) % 10;
}

export type BaccaratSide = 'player' | 'banker' | 'tie';

export interface BaccaratRound {
  player: Card[];
  banker: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: BaccaratSide;
  playerPair: boolean;
  bankerPair: boolean;
  natural: boolean;
}

/** Deal one coup with the full third-card tableau. */
export function dealBaccarat(draw: () => Card): BaccaratRound {
  const player = [draw(), draw()];
  const banker = [draw(), draw()];
  let p = baccaratTotal(player);
  let b = baccaratTotal(banker);
  const natural = p >= 8 || b >= 8;
  if (!natural) {
    let third: Card | null = null;
    if (p <= 5) {
      third = draw();
      player.push(third);
      p = baccaratTotal(player);
    }
    if (third === null) {
      if (b <= 5) banker.push(draw());
    } else {
      const t = baccaratValue(third);
      const bankerDraws =
        b <= 2 ||
        (b === 3 && t !== 8) ||
        (b === 4 && t >= 2 && t <= 7) ||
        (b === 5 && t >= 4 && t <= 7) ||
        (b === 6 && (t === 6 || t === 7));
      if (bankerDraws) banker.push(draw());
    }
    b = baccaratTotal(banker);
  }
  return {
    player, banker, playerTotal: p, bankerTotal: b, natural,
    winner: p > b ? 'player' : b > p ? 'banker' : 'tie',
    playerPair: player[0].rank === player[1].rank,
    bankerPair: banker[0].rank === banker[1].rank,
  };
}

/** Total returned (stake included) for a bet; 0 = lost. Player 1:1, banker 0.95:1, tie 8:1, pairs 11:1. */
export function baccaratReturn(bet: BaccaratSide | 'playerPair' | 'bankerPair', amount: number, r: BaccaratRound): number {
  switch (bet) {
    case 'player':
      return r.winner === 'player' ? amount * 2 : r.winner === 'tie' ? amount : 0;
    case 'banker':
      return r.winner === 'banker' ? amount * 1.95 : r.winner === 'tie' ? amount : 0;
    case 'tie':
      return r.winner === 'tie' ? amount * 9 : 0;
    case 'playerPair':
      return r.playerPair ? amount * 12 : 0;
    case 'bankerPair':
      return r.bankerPair ? amount * 12 : 0;
  }
}

// ------------------------------------------------------------------ video poker (Jacks or Better 9/6)

export const JOB_PAYTABLE: { name: string; pays: number }[] = [
  { name: 'Royal Flush', pays: 800 },
  { name: 'Straight Flush', pays: 50 },
  { name: 'Four of a Kind', pays: 25 },
  { name: 'Full House', pays: 9 },
  { name: 'Flush', pays: 6 },
  { name: 'Straight', pays: 4 },
  { name: 'Three of a Kind', pays: 3 },
  { name: 'Two Pair', pays: 2 },
  { name: 'Jacks or Better', pays: 1 },
];

/**
 * What a hand pays on a real machine for `coins` coins (1–5), stake included: the table
 * times the coins, except the royal flush, which pays 250 a coin and jumps to 4,000 at
 * five coins (that's why you always play max coins).
 */
export function vpPays(name: string, coins: number): number {
  if (name === 'Royal Flush') return coins >= 5 ? 4000 : 250 * coins;
  return (JOB_PAYTABLE.find((l) => l.name === name)?.pays ?? 0) * coins;
}

/** Jacks or Better result for a final five-card hand ("pays" is for 1 coin, stake included). */
export function jacksOrBetter(cards: Card[]): { name: string; pays: number } {
  const s = bestHand(cards);
  const byCat: Record<number, string> = { 9: 'Royal Flush', 8: 'Straight Flush', 7: 'Four of a Kind', 6: 'Full House', 5: 'Flush', 4: 'Straight', 3: 'Three of a Kind', 2: 'Two Pair' };
  if (s.cat >= 2) {
    const name = byCat[s.cat];
    return { name, pays: JOB_PAYTABLE.find((l) => l.name === name)!.pays };
  }
  if (s.cat === 1 && s.key[1] >= 11) return { name: 'Jacks or Better', pays: 1 };
  return { name: s.cat === 1 ? 'Low pair' : 'Nothing', pays: 0 };
}

/**
 * A simple, decent hold strategy (used for guests): keep any paying hand, four to a
 * flush, a low pair, or up to two high cards. Returns which of the five to hold.
 */
export function simpleHold(hand: Card[]): boolean[] {
  const res = jacksOrBetter(hand);
  const s = bestHand(hand);
  if (res.pays >= 4 || s.cat === 4 || s.cat === 5) return hand.map(() => true);
  const counts = new Map<number, number>();
  for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  if (s.cat >= 1) return hand.map((c) => (counts.get(c.rank) ?? 0) >= 2);
  const suits = new Map<number, number>();
  for (const c of hand) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  for (const [suit, n] of suits) if (n === 4) return hand.map((c) => c.suit === suit);
  const high = hand.map((c, i) => [pv(c), i] as [number, number]).filter(([v]) => v >= 11).sort((a, b) => a[0] - b[0]).slice(0, 2);
  return hand.map((_, i) => high.some(([, j]) => j === i));
}

// ------------------------------------------------------------------ three card poker

export const TCP_NAMES = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a kind', 'Straight flush'];

/** Three-card hand score: [category, ...ranks] (categories: 0 high, 1 pair, 2 flush, 3 straight, 4 trips, 5 straight flush). */
export function threeCardScore(cards: Card[]): number[] {
  const v = cards.map(pv).sort((a, b) => b - a);
  const flush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  let straightHigh = 0;
  if (v[0] - v[1] === 1 && v[1] - v[2] === 1) straightHigh = v[0];
  else if (v[0] === 14 && v[1] === 3 && v[2] === 2) straightHigh = 3;
  if (straightHigh && flush) return [5, straightHigh];
  if (v[0] === v[2]) return [4, v[0]];
  if (straightHigh) return [3, straightHigh];
  if (flush) return [2, ...v];
  if (v[0] === v[1]) return [1, v[0], v[2]];
  if (v[1] === v[2]) return [1, v[1], v[0]];
  return [0, ...v];
}

export function compareThree(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The dealer plays with queen-high or better. */
export function tcpDealerQualifies(s: number[]): boolean {
  return s[0] > 0 || s[1] >= 12;
}

/** Pair Plus pays (to 1): pair 1, flush 4, straight 6, trips 30, straight flush 40. */
export function pairPlusPays(s: number[]): number {
  return [0, 1, 4, 6, 30, 40][s[0]];
}

/** Ante bonus (to 1), paid whatever the dealer has: straight 1, trips 4, straight flush 5. */
export function anteBonusPays(s: number[]): number {
  return s[0] === 5 ? 5 : s[0] === 4 ? 4 : s[0] === 3 ? 1 : 0;
}

/** Total returned for Ante + Play (each `ante` big) after a showdown; null play = folded. */
export function threeCardReturn(ante: number, played: boolean, player: number[], dealer: number[]): { total: number; note: string } {
  const bonus = ante * anteBonusPays(player);
  if (!played) return { total: 0, note: 'Folded' };
  if (!tcpDealerQualifies(dealer)) return { total: ante * 2 + ante + bonus, note: 'Dealer doesn’t qualify: ante pays, play pushes' };
  const c = compareThree(player, dealer);
  if (c > 0) return { total: ante * 4 + bonus, note: 'You beat the dealer' };
  if (c === 0) return { total: ante * 2 + bonus, note: 'Tie: push' };
  return { total: bonus, note: 'Dealer wins' };
}

// ------------------------------------------------------------------ sic bo

export type SicBoBet =
  | { kind: 'small' } | { kind: 'big' }
  | { kind: 'total'; n: number }
  | { kind: 'single'; n: number }
  | { kind: 'double'; n: number }
  | { kind: 'triple'; n: number }
  | { kind: 'anyTriple' }
  /** Two different numbers both showing (a domino), 5:1. */
  | { kind: 'combo'; n: number; m: number };

export const SICBO_TOTAL_PAYS: Record<number, number> = { 4: 60, 5: 30, 6: 17, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 17, 16: 30, 17: 60 };

/** Total returned (stake included) for a sic bo bet on three dice. */
export function sicBoReturn(bet: SicBoBet, amount: number, dice: [number, number, number]): number {
  const sum = dice[0] + dice[1] + dice[2];
  const triple = dice[0] === dice[1] && dice[1] === dice[2];
  const count = (n: number) => dice.filter((d) => d === n).length;
  switch (bet.kind) {
    case 'small':
      return !triple && sum >= 4 && sum <= 10 ? amount * 2 : 0;
    case 'big':
      return !triple && sum >= 11 && sum <= 17 ? amount * 2 : 0;
    case 'total':
      return sum === bet.n ? amount * (SICBO_TOTAL_PAYS[bet.n] + 1) : 0;
    case 'single': {
      const k = count(bet.n);
      return k ? amount * (k + 1) : 0;
    }
    case 'double':
      return count(bet.n) >= 2 ? amount * 11 : 0;
    case 'triple':
      return count(bet.n) === 3 ? amount * 181 : 0;
    case 'anyTriple':
      return triple ? amount * 31 : 0;
    case 'combo':
      return count(bet.n) && count(bet.m) ? amount * 6 : 0;
  }
}

export function rollThree(rnd: () => number = Math.random): [number, number, number] {
  return [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
}

// ------------------------------------------------------------------ keno

/** Pays for 1 (stake included) by number of spots picked, then by number of catches. */
export const KENO_PAYS: Record<number, Record<number, number>> = {
  1: { 1: 3 },
  2: { 2: 12 },
  3: { 2: 1, 3: 42 },
  4: { 2: 1, 3: 4, 4: 100 },
  5: { 3: 2, 4: 12, 5: 750 },
  6: { 3: 1, 4: 4, 5: 70, 6: 1500 },
  7: { 3: 1, 4: 2, 5: 20, 6: 350, 7: 7000 },
  8: { 4: 2, 5: 12, 6: 100, 7: 1500, 8: 25000 },
  9: { 4: 1, 5: 5, 6: 40, 7: 300, 8: 4000, 9: 50000 },
  10: { 5: 2, 6: 20, 7: 130, 8: 1000, 9: 5000, 10: 100000 },
};

/** Twenty distinct numbers from 1–80. */
export function kenoDraw(rnd: () => number = Math.random): number[] {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let i = 0; i < 20; i++) {
    const j = i + Math.floor(rnd() * (80 - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 20);
}

export function kenoReturn(picks: number[], drawn: number[], amount: number): { hits: number; total: number } {
  const set = new Set(drawn);
  const hits = picks.filter((p) => set.has(p)).length;
  return { hits, total: amount * (KENO_PAYS[picks.length]?.[hits] ?? 0) };
}

// ------------------------------------------------------------------ craps

/** True odds paid on pass-line odds for each point (to 1). */
export function passOddsPays(point: number): number {
  return point === 4 || point === 10 ? 2 : point === 5 || point === 9 ? 1.5 : 1.2;
}

/** Lay odds behind don't pass pay the inverse. */
export function dontPassOddsPays(point: number): number {
  return 1 / passOddsPays(point);
}

// ------------------------------------------------------------------ big six wheel

/** The standard 54-stop Big Six: $1 ×24, $2 ×15, $5 ×7, $10 ×4, $20 ×2, Joker ×1, Logo ×1. */
export const BIG_SIX_LAYOUT: number[] = (() => {
  const counts: [number, number][] = [[1, 24], [2, 15], [5, 7], [10, 4], [20, 2]];
  const out: number[] = new Array(54).fill(0);
  // Spread each value around the wheel so equal symbols never bunch up.
  const slots = counts.flatMap(([v, n]) => Array.from({ length: n }, (_, i) => ({ v, pos: (i + 0.5) / n })));
  slots.sort((a, b) => a.pos - b.pos || b.v - a.v);
  let k = 0;
  for (let i = 0; i < 54; i++) {
    if (i === 0) out[i] = 40; // joker at the top
    else if (i === 27) out[i] = 41; // logo opposite
    else out[i] = slots[k++].v;
  }
  return out;
})();

/** Big Six payout to 1 for a symbol (40 = Joker, 41 = Logo, both 40:1). */
export function bigSixPays(sym: number): number {
  return sym >= 40 ? 40 : sym;
}

// ------------------------------------------------------------------ shoe helper

const shared = new Shoe(8);
export function shoeDraw(): Card {
  return shared.draw();
}

// ------------------------------------------------------------------ blackjack side bets

/**
 * Perfect Pairs on your first two cards: a perfect pair (same rank and suit) 25:1, a
 * coloured pair (same rank and colour) 12:1, a mixed pair 6:1. Returns the pay "to 1"
 * (0 = lost) and the name.
 */
export function perfectPairs(a: Card, b: Card): { name: string; pays: number } {
  if (a.rank !== b.rank) return { name: 'No pair', pays: 0 };
  if (a.suit === b.suit) return { name: 'Perfect pair', pays: 25 };
  if (isRed(a) === isRed(b)) return { name: 'Coloured pair', pays: 12 };
  return { name: 'Mixed pair', pays: 6 };
}

/**
 * 21+3: your two cards and the dealer's up card as a three-card poker hand. Suited trips
 * 100:1, straight flush 40:1, three of a kind 30:1, straight 10:1, flush 5:1.
 */
export function twentyOnePlus3(cards: Card[]): { name: string; pays: number } {
  const s = threeCardScore(cards);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  if (s[0] === 4 && flush) return { name: 'Suited trips', pays: 100 };
  if (s[0] === 5) return { name: 'Straight flush', pays: 40 };
  if (s[0] === 4) return { name: 'Three of a kind', pays: 30 };
  if (s[0] === 3) return { name: 'Straight', pays: 10 };
  if (s[0] === 2) return { name: 'Flush', pays: 5 };
  return { name: 'Nothing', pays: 0 };
}

// ------------------------------------------------------------------ poker side bets

/**
 * Casino Hold'em AA Bonus: your two cards and the flop. Pair of aces or better pays;
 * judged before you call or fold.
 */
export function aaBonus(five: Card[]): { name: string; pays: number } {
  const s = bestHand(five);
  const pays = [0, 0, 7, 7, 7, 20, 30, 40, 50, 100][s.cat];
  if (s.cat >= 2) return { name: s.name, pays };
  if (s.cat === 1 && s.key[1] === 14) return { name: 'Pair of aces', pays: 7 };
  return { name: s.name, pays: 0 };
}

/**
 * Three Card Poker 6-Card Bonus: the best five of your three and the dealer's three.
 * Royal 1000:1, straight flush 200:1, quads 100:1, full house 20:1, flush 15:1,
 * straight 10:1, three of a kind 5:1.
 */
export function sixCardBonus(six: Card[]): { name: string; pays: number } {
  const s = bestHand(six);
  const pays = [0, 0, 0, 5, 10, 15, 20, 100, 200, 1000][s.cat];
  return { name: s.name, pays };
}

// ------------------------------------------------------------------ baccarat scoreboards

export type CoupMark = { winner: 'P' | 'B' | 'T'; pp?: boolean; bp?: boolean; natural?: boolean };

export interface RoadCell {
  col: number;
  row: number;
  winner: 'P' | 'B' | 'T';
  ties: number;
  pp?: boolean;
  bp?: boolean;
}

/** Bead plate: every coup in order, down six rows then across. */
export function beadPlate(coups: CoupMark[], rows = 6): RoadCell[] {
  return coups.map((c, i) => ({ col: Math.floor(i / rows), row: i % rows, winner: c.winner, ties: 0, pp: c.pp, bp: c.bp }));
}

/**
 * The big road: a new column each time the winner changes, down the column while it
 * repeats, turning right along the row when the column is full or blocked (the "dragon
 * tail"). Ties don't take a cell: they're counted on the last one (green slashes).
 */
export function bigRoad(coups: CoupMark[], rows = 6): RoadCell[] {
  const out: RoadCell[] = [];
  const taken = new Set<string>();
  const at = (c: number, r: number) => taken.has(`${c},${r}`);
  let lead = 0;
  let startCol = -1;
  let last: RoadCell | null = null;
  for (const c of coups) {
    if (c.winner === 'T') {
      if (last) last.ties++;
      else lead++;
      continue;
    }
    let col: number;
    let row: number;
    if (!last || last.winner !== c.winner) {
      col = startCol + 1;
      while (at(col, 0)) col++;
      startCol = col;
      row = 0;
    } else if (last.row + 1 < rows && !at(last.col, last.row + 1)) {
      col = last.col;
      row = last.row + 1;
    } else {
      col = last.col + 1;
      row = last.row;
      while (at(col, row)) col++;
    }
    const cell: RoadCell = { col, row, winner: c.winner, ties: lead, pp: c.pp, bp: c.bp };
    lead = 0;
    taken.add(`${col},${row}`);
    out.push(cell);
    last = cell;
  }
  return out;
}
