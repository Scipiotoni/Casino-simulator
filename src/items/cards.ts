import type { Card } from './types';

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function cardLabel(c: Card): string {
  return `${RANKS[c.rank]}${SUITS[c.suit]}`;
}

export function isRed(c: Card): boolean {
  return c.suit === 1 || c.suit === 2;
}

/** A shuffled multi-deck shoe that reshuffles itself when it runs low. */
export class Shoe {
  private cards: Card[] = [];

  constructor(private decks = 6, private rng: () => number = Math.random) {
    this.shuffle();
  }

  shuffle(): void {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) this.cards.push({ rank: r, suit: s });
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(): Card {
    if (this.cards.length < 15) this.shuffle();
    return this.cards.pop()!;
  }

  get remaining(): number {
    return this.cards.length;
  }
}

// ------------------------------------------------------------------ blackjack

/** Best blackjack total (aces count 11 when that doesn't bust) and whether it's soft. */
export function bjTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 0) {
      aces++;
      total += 1;
    } else total += Math.min(10, c.rank + 1);
  }
  let soft = false;
  if (aces && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && bjTotal(cards).total === 21;
}

/** Dealer draws to 17 and stands on all 17s. */
export function dealerShouldHit(cards: Card[]): boolean {
  return bjTotal(cards).total < 17;
}

// ------------------------------------------------------------------ poker

export const HAND_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush',
];

export interface HandScore {
  /** 0 = high card … 9 = royal flush. */
  cat: number;
  /** Category then tiebreak ranks, compare lexicographically. */
  key: number[];
  name: string;
  cards: Card[];
}

const pokerValue = (c: Card) => (c.rank === 0 ? 14 : c.rank + 1);

function score5(cards: Card[]): HandScore {
  const vals = cards.map(pokerValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // wheel
  }
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroups = groups.map(([v]) => v);
  let cat: number;
  let key: number[];
  if (straightHigh && flush) {
    cat = straightHigh === 14 ? 9 : 8;
    key = [straightHigh];
  } else if (groups[0][1] === 4) {
    cat = 7;
    key = byGroups;
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 6;
    key = byGroups;
  } else if (flush) {
    cat = 5;
    key = vals;
  } else if (straightHigh) {
    cat = 4;
    key = [straightHigh];
  } else if (groups[0][1] === 3) {
    cat = 3;
    key = byGroups;
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 2;
    key = byGroups;
  } else if (groups[0][1] === 2) {
    cat = 1;
    key = byGroups;
  } else {
    cat = 0;
    key = vals;
  }
  return { cat, key: [cat, ...key], name: HAND_NAMES[cat], cards };
}

export function compareScores(a: HandScore, b: HandScore): number {
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Best five-card hand out of five to seven cards. */
export function bestHand(cards: Card[]): HandScore {
  if (cards.length <= 5) return score5(cards);
  let best: HandScore | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const s = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
    if (!best || compareScores(s, best) > 0) best = s;
  }
  return best!;
}

/** Casino Hold'em: the dealer plays with a pair of fours or better. */
export function dealerQualifies(s: HandScore): boolean {
  return s.cat >= 2 || (s.cat === 1 && s.key[1] >= 4);
}

/** Ante bonus paytable (to 1) for the player's final hand. */
export function holdemAntePays(cat: number): number {
  return cat === 9 ? 100 : cat === 8 ? 20 : cat === 7 ? 10 : cat === 6 ? 3 : cat === 5 ? 2 : 1;
}
