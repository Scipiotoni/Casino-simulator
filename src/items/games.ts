import { ROULETTE_ORDER, WHEEL_SEGMENTS, rouletteColor } from '../render/textures';
import {
  bigSixPays, dealBaccarat, baccaratReturn, jacksOrBetter, simpleHold, kenoDraw, kenoReturn, threeCardScore,
  threeCardReturn, TCP_NAMES, rollThree, sicBoReturn, type BaccaratSide, type SicBoBet,
} from './rules';
import { Shoe } from './cards';
import type { Card, Outcome, SharedVisual, Tier } from './types';

/**
 * Pure game rules. Every game resolves to an Outcome with a payout; the house edge comes
 * from each machine's RTP so the casino profits over time while players still see wins.
 */

// Reel symbol indices (see REEL_SYMBOLS): 0 seven, 1 cherry, 2 bar, 3 lemon, 4 bell, 5 grape, 6 diamond, 7 star
const SEVEN = 0;
const CHERRY = 1;
const SYMBOL_COUNT = 8;

interface SlotLine {
  kind: 'three' | 'two' | 'one';
  sym: number;
  p: number;
  mult: number;
  label: string;
}

export const SLOT_TABLE: SlotLine[] = [
  { kind: 'three', sym: SEVEN, p: 0.0004, mult: 150, label: 'TRIPLE 7s!' },
  { kind: 'three', sym: 6, p: 0.002, mult: 40, label: 'Diamonds!' },
  { kind: 'three', sym: 7, p: 0.004, mult: 20, label: 'Triple stars!' },
  { kind: 'three', sym: 2, p: 0.007, mult: 12, label: 'Triple BAR!' },
  { kind: 'three', sym: 4, p: 0.012, mult: 8, label: 'Bells!' },
  { kind: 'three', sym: 5, p: 0.018, mult: 5, label: 'Grapes!' },
  { kind: 'three', sym: 3, p: 0.03, mult: 3, label: 'Lemons!' },
  { kind: 'three', sym: CHERRY, p: 0.022, mult: 4, label: 'Cherries!' },
  { kind: 'two', sym: CHERRY, p: 0.05, mult: 2, label: 'Two cherries' },
  { kind: 'one', sym: CHERRY, p: 0.12, mult: 1, label: 'Cherry' },
];

/** Low-volatility paytable: smaller prizes, far more frequent hits (Lucky 7s). */
export const SLOT_TABLE_LOW: SlotLine[] = [
  { kind: 'three', sym: SEVEN, p: 0.001, mult: 50, label: 'TRIPLE 7s!' },
  { kind: 'three', sym: 6, p: 0.003, mult: 20, label: 'Diamonds!' },
  { kind: 'three', sym: 7, p: 0.006, mult: 12, label: 'Triple stars!' },
  { kind: 'three', sym: 2, p: 0.01, mult: 8, label: 'Triple BAR!' },
  { kind: 'three', sym: 4, p: 0.016, mult: 6, label: 'Bells!' },
  { kind: 'three', sym: 5, p: 0.024, mult: 4, label: 'Grapes!' },
  { kind: 'three', sym: 3, p: 0.04, mult: 3, label: 'Lemons!' },
  { kind: 'three', sym: CHERRY, p: 0.03, mult: 3, label: 'Cherries!' },
  { kind: 'two', sym: CHERRY, p: 0.06, mult: 2, label: 'Two cherries' },
  { kind: 'one', sym: CHERRY, p: 0.12, mult: 1, label: 'Cherry' },
];

export const SLOT_BASE_RTP = SLOT_TABLE.reduce((a, l) => a + l.p * l.mult, 0);
const SLOT_LOW_RTP = SLOT_TABLE_LOW.reduce((a, l) => a + l.p * l.mult, 0);

function randSym(exclude: number[] = []): number {
  for (;;) {
    const s = Math.floor(Math.random() * SYMBOL_COUNT);
    if (!exclude.includes(s)) return s;
  }
}

export function tierFor(mult: number): Tier {
  if (mult <= 0) return 'lose';
  if (mult < 1.01) return 'push';
  if (mult >= 10) return 'big';
  return 'win';
}

export function resolveSlot(bet: number, rtp: number, cheat: boolean, jackpotPot = 0, volatility: 'low' | 'normal' = 'normal'): Outcome {
  const table = volatility === 'low' ? SLOT_TABLE_LOW : SLOT_TABLE;
  const scale = (rtp / (volatility === 'low' ? SLOT_LOW_RTP : SLOT_BASE_RTP)) * (cheat ? 1.8 : 1);
  let r = Math.random();
  for (const line of table) {
    const p = line.p * scale;
    if (r < p) {
      let symbols: [number, number, number];
      if (line.kind === 'three') symbols = [line.sym, line.sym, line.sym];
      else if (line.kind === 'two') symbols = [CHERRY, CHERRY, randSym([CHERRY])];
      else {
        const b = randSym([CHERRY]);
        symbols = [CHERRY, b, randSym([CHERRY])];
      }
      const isSeven = line.kind === 'three' && line.sym === SEVEN;
      if (isSeven && jackpotPot > 0) {
        return { bet, payout: Math.round(jackpotPot), label: 'MEGA JACKPOT!', tier: 'jackpot', visual: { kind: 'slot', symbols } };
      }
      const payout = Math.round(bet * line.mult);
      const tier = isSeven && line.mult >= 100 ? 'jackpot' : tierFor(line.mult);
      return { bet, payout, label: line.label, tier, visual: { kind: 'slot', symbols } };
    }
    r -= p;
  }
  // Loss. Sometimes show a teasing near miss.
  let symbols: [number, number, number];
  if (Math.random() < 0.14) {
    const s = Math.random() < 0.6 ? SEVEN : 6;
    symbols = [s, s, randSym([s, CHERRY])];
  } else {
    const a = randSym([CHERRY]);
    const b = randSym();
    const c = a === b ? randSym([a]) : randSym();
    symbols = [a, b, c];
  }
  return { bet, payout: 0, label: 'No luck', tier: 'lose', visual: { kind: 'slot', symbols } };
}

export function resolveClaw(bet: number, cheat: boolean): Outcome {
  const win = Math.random() < (cheat ? 0.6 : 0.2);
  return { bet, payout: 0, label: win ? 'Got a plushie!' : 'So close...', tier: win ? 'win' : 'lose', visual: { kind: 'claw', win } };
}

const PACHINKO_TABLE = [
  { mult: 40, p: 0.003, label: 'FEVER MODE!!' },
  { mult: 10, p: 0.015, label: 'Big hit!' },
  { mult: 4, p: 0.05, label: 'Hit!' },
  { mult: 2, p: 0.1, label: 'Nice!' },
  { mult: 1, p: 0.18, label: 'Break even' },
];
const PACHINKO_BASE = PACHINKO_TABLE.reduce((a, l) => a + l.p * l.mult, 0);

export function resolvePachinko(bet: number, rtp: number, cheat: boolean): Outcome {
  const scale = (rtp / PACHINKO_BASE) * (cheat ? 1.7 : 1);
  let r = Math.random();
  for (const l of PACHINKO_TABLE) {
    const p = l.p * scale;
    if (r < p) {
      return { bet, payout: Math.round(bet * l.mult), label: l.label, tier: l.mult >= 40 ? 'jackpot' : tierFor(l.mult), visual: { kind: 'pachinko', mult: l.mult } };
    }
    r -= p;
  }
  return { bet, payout: 0, label: 'Balls lost', tier: 'lose', visual: { kind: 'pachinko', mult: 0 } };
}

// ------------------------------------------------------------------ roulette

export type RouletteBet = { kind: 'color'; color: 'red' | 'black' } | { kind: 'dozen'; dozen: number } | { kind: 'straight'; number: number };

export function pickRouletteBet(risk: number): RouletteBet {
  const r = Math.random();
  if (r < 0.55 - risk * 0.2) return { kind: 'color', color: Math.random() < 0.5 ? 'red' : 'black' };
  if (r < 0.82 - risk * 0.2) return { kind: 'dozen', dozen: Math.floor(Math.random() * 3) };
  return { kind: 'straight', number: 1 + Math.floor(Math.random() * 36) };
}

/** Draw the winning pocket; the zero is weighted so every bet type returns `rtp`. */
export function spinRoulette(rtp: number): number {
  const zeroP = Math.max(1 / 37, 1 - rtp);
  if (Math.random() < zeroP) return 0;
  return 1 + Math.floor(Math.random() * 36);
}

export function resolveRouletteBet(bet: number, rb: RouletteBet, number: number, cheat: boolean): Outcome {
  let win = false;
  let mult = 0;
  let label = '';
  const col = rouletteColor(number);
  const numLabel = `${col === 'green' ? 'Green' : col === 'red' ? 'Red' : 'Black'} ${number}`;
  if (rb.kind === 'color') {
    win = col === rb.color;
    mult = 2;
    label = win ? `${numLabel}!` : numLabel;
  } else if (rb.kind === 'dozen') {
    win = number > 0 && Math.floor((number - 1) / 12) === rb.dozen;
    mult = 3;
    label = win ? `${['1st', '2nd', '3rd'][rb.dozen]} dozen hits!` : numLabel;
  } else {
    win = number === rb.number;
    mult = 36;
    label = win ? `Straight up ${number}!!` : numLabel;
  }
  if (!win && cheat && Math.random() < 0.35) {
    win = true;
    label = 'Lucky push...';
    mult = rb.kind === 'straight' ? 8 : mult;
  }
  const betLabel = rb.kind === 'color' ? rb.color : rb.kind === 'dozen' ? `dozen ${rb.dozen + 1}` : `#${rb.number}`;
  return {
    bet,
    payout: win ? Math.round(bet * mult) : 0,
    label,
    tier: win ? tierFor(mult) : 'lose',
    visual: { kind: 'roulette', number, bet: betLabel },
  };
}

export function rouletteNumberExists(n: number): boolean {
  return ROULETTE_ORDER.includes(n);
}

// ------------------------------------------------------------------ big wheel

const WHEEL_BET_WEIGHTS: [number, number][] = [
  [1, 50], [2, 20], [5, 15], [10, 8], [20, 4], [40, 2], [41, 2],
];

export function pickWheelBet(risk: number): number {
  const total = WHEEL_BET_WEIGHTS.reduce((a, [m, w]) => a + w * (m > 5 ? 1 + risk * 2 : 1), 0);
  let r = Math.random() * total;
  for (const [m, w] of WHEEL_BET_WEIGHTS) {
    r -= w * (m > 5 ? 1 + risk * 2 : 1);
    if (r <= 0) return m;
  }
  return 1;
}

export function spinWheel(): number {
  return Math.floor(Math.random() * WHEEL_SEGMENTS.length);
}

export function resolveWheelBet(bet: number, betOn: number, segment: number, cheat: boolean): Outcome {
  const seg = WHEEL_SEGMENTS[segment];
  let win = seg.mult === betOn;
  if (!win && cheat && Math.random() < 0.3) win = true;
  const payMult = bigSixPays(betOn) + 1;
  return {
    bet,
    payout: win ? Math.round(bet * payMult) : 0,
    label: win ? (betOn >= 40 ? `${seg.label} pays 40 to 1!!` : `${seg.label} pays!`) : `Landed on ${seg.label}`,
    tier: win ? tierFor(payMult) : 'lose',
    visual: { kind: 'wheel', segment, bet: betOn },
  };
}

// ------------------------------------------------------------------ craps

export type CrapsBet = 'field' | 'seven' | 'craps' | 'yo';

export function pickCrapsBet(risk: number): CrapsBet {
  const r = Math.random();
  if (r < 0.55 - risk * 0.2) return 'field';
  if (r < 0.75 - risk * 0.1) return 'seven';
  if (r < 0.9) return 'craps';
  return 'yo';
}

export function rollDice(): [number, number] {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

export function resolveCrapsBet(bet: number, kind: CrapsBet, dice: [number, number], cheat: boolean): Outcome {
  const sum = dice[0] + dice[1];
  let mult = 0;
  let label = `Rolled ${sum}`;
  switch (kind) {
    case 'field':
      if ([2, 12].includes(sum)) {
        mult = 3;
        label = `Field ${sum} pays double!`;
      } else if ([3, 4, 9, 10, 11].includes(sum)) {
        mult = 2;
        label = `Field ${sum}!`;
      }
      break;
    case 'seven':
      if (sum === 7) {
        mult = 5;
        label = 'Lucky seven!';
      }
      break;
    case 'craps':
      if ([2, 3, 12].includes(sum)) {
        mult = 8;
        label = 'Any craps!';
      }
      break;
    case 'yo':
      if (sum === 11) {
        mult = 16;
        label = 'YO-LEVEN!!';
      }
      break;
  }
  if (mult === 0 && cheat && Math.random() < 0.3) {
    mult = 2;
    label = 'Loaded dice...';
  }
  return { bet, payout: Math.round(bet * mult), label, tier: tierFor(mult), visual: { kind: 'craps', dice, bet: kind } };
}

// ------------------------------------------------------------------ cards

export function drawCard(): Card {
  return { rank: Math.floor(Math.random() * 13), suit: Math.floor(Math.random() * 4) };
}

function cardValue(c: Card): number {
  if (c.rank === 0) return 11;
  return Math.min(10, c.rank + 1);
}

export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 0) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function dealDealerHand(): Card[] {
  const d = [drawCard(), drawCard()];
  while (handValue(d) < 17) d.push(drawCard());
  return d;
}

/** Player hand using a simple "hit below 17, stand vs weak dealer" strategy. */
export function playBlackjackHand(dealerUp: Card): Card[] {
  const p = [drawCard(), drawCard()];
  const up = cardValue(dealerUp);
  for (;;) {
    const v = handValue(p);
    if (v >= 17) break;
    if (v >= 13 && up <= 6 && Math.random() < 0.7) break;
    if (v === 12 && up >= 4 && up <= 6 && Math.random() < 0.5) break;
    p.push(drawCard());
  }
  return p;
}

export function scoreBlackjack(bet: number, player: Card[], dealer: Card[]): Outcome {
  const pv = handValue(player);
  const dv = handValue(dealer);
  const pBJ = pv === 21 && player.length === 2;
  const dBJ = dv === 21 && dealer.length === 2;
  let payout = 0;
  let label: string;
  if (pv > 21) label = `Bust with ${pv}`;
  else if (pBJ && !dBJ) {
    payout = bet * 2.5;
    label = 'BLACKJACK!';
  } else if (dBJ && !pBJ) label = 'Dealer blackjack';
  else if (dv > 21) {
    payout = bet * 2;
    label = `Dealer busts! (${pv})`;
  } else if (pv > dv) {
    payout = bet * 2;
    label = `${pv} beats ${dv}!`;
  } else if (pv === dv) {
    payout = bet;
    label = `Push at ${pv}`;
  } else label = `${dv} beats ${pv}`;
  const mult = payout / bet;
  return {
    bet,
    payout: Math.round(payout),
    label,
    tier: pBJ && !dBJ ? 'big' : tierFor(mult),
    visual: { kind: 'blackjack', player, dealer },
  };
}

export function resolveBlackjackSeat(bet: number, dealer: Card[], cheat: boolean): Outcome {
  let out = scoreBlackjack(bet, playBlackjackHand(dealer[0]), dealer);
  if (cheat && out.payout < bet) {
    for (let i = 0; i < 20 && out.payout < bet * 2; i++) out = scoreBlackjack(bet, playBlackjackHand(dealer[0]), dealer);
  }
  return out;
}

// ------------------------------------------------------------------ poker (house-banked hold'em)

const POKER_TABLE: { p: number; mult: number; hands: string[] }[] = [
  { p: 0.0004, mult: 100, hands: ['Royal Flush'] },
  { p: 0.002, mult: 20, hands: ['Four of a Kind'] },
  { p: 0.006, mult: 7, hands: ['Full House'] },
  { p: 0.025, mult: 4, hands: ['Flush', 'Straight'] },
  { p: 0.33, mult: 2, hands: ['Pair of Aces', 'Two Pair', 'Three of a Kind', 'Pair of Kings', 'High Pair'] },
  { p: 0.05, mult: 1, hands: ['Split pot'] },
];
const POKER_BASE = POKER_TABLE.reduce((a, l) => a + l.p * l.mult, 0);

export function resolvePokerSeat(bet: number, rtp: number, cheat: boolean): Outcome {
  const scale = (rtp / POKER_BASE) * (cheat ? 1.4 : 1);
  let r = Math.random();
  const hole = [drawCard(), drawCard()];
  for (const l of POKER_TABLE) {
    const p = l.mult === 1 ? l.p : l.p * scale;
    if (r < p) {
      const hand = l.hands[Math.floor(Math.random() * l.hands.length)];
      return {
        bet,
        payout: Math.round(bet * l.mult),
        label: l.mult === 1 ? 'Split pot' : `${hand}!`,
        tier: l.mult >= 100 ? 'jackpot' : tierFor(l.mult),
        visual: { kind: 'poker', hole, board: [], hand },
      };
    }
    r -= p;
  }
  return { bet, payout: 0, label: 'Dealer takes it', tier: 'lose', visual: { kind: 'poker', hole, board: [], hand: 'High card' } };
}

export function dealBoard(): Card[] {
  return [drawCard(), drawCard(), drawCard(), drawCard(), drawCard()];
}

export function sharedFor(kind: string): SharedVisual {
  switch (kind) {
    case 'baccarat':
      return sharedBaccarat();
    case 'threecard':
      return sharedThreeCard();
    case 'sicbo':
      return sharedSicBo();
    case 'blackjack':
      return { kind: 'blackjack', dealer: dealDealerHand() };
    case 'poker':
      return { kind: 'poker', board: dealBoard() };
    case 'craps':
      return { kind: 'craps', dice: rollDice() };
    case 'wheel':
      return { kind: 'wheel', segment: spinWheel() };
    default:
      return { kind: 'none' };
  }
}

// ------------------------------------------------------------------ guests at the newer games (real rules)

/** A guest plays a hand of Jacks or Better with a simple hold strategy. */
export function resolveVideoPoker(bet: number): Outcome {
  const deck = new Shoe(1);
  const hand = [deck.draw(), deck.draw(), deck.draw(), deck.draw(), deck.draw()];
  const hold = simpleHold(hand);
  const final = hand.map((c, i) => (hold[i] ? c : deck.draw()));
  const r = jacksOrBetter(final);
  const payout = bet * r.pays;
  // The cabinet shows reels: three matching symbols for a paying hand.
  const sym = r.pays >= 800 ? SEVEN : r.pays >= 25 ? 6 : r.pays >= 4 ? 7 : r.pays >= 2 ? 4 : 1;
  const a = randSym();
  const symbols: [number, number, number] = r.pays ? [sym, sym, sym] : [a, randSym([a]), randSym([a])];
  return { bet, payout, label: r.pays ? `${r.name}!` : r.name, tier: r.pays >= 800 ? 'jackpot' : tierFor(r.pays), visual: { kind: 'slot', symbols } };
}

/** A guest marks 4–8 spots on a keno ticket. */
export function resolveKeno(bet: number): Outcome {
  const spots = 4 + Math.floor(Math.random() * 5);
  const picks: number[] = [];
  while (picks.length < spots) {
    const n = 1 + Math.floor(Math.random() * 80);
    if (!picks.includes(n)) picks.push(n);
  }
  const r = kenoReturn(picks, kenoDraw(), bet);
  const mult = r.total / bet;
  const a = randSym();
  const symbols: [number, number, number] = mult > 0 ? [5, 5, 5] : [a, randSym([a]), randSym([a])];
  return { bet, payout: r.total, label: `Caught ${r.hits} of ${spots}`, tier: mult >= 100 ? 'jackpot' : tierFor(mult), visual: { kind: 'slot', symbols } };
}

export function pickBaccaratBet(risk: number): BaccaratSide {
  const r = Math.random();
  return r < 0.05 + risk * 0.06 ? 'tie' : r < 0.55 ? 'banker' : 'player';
}

/** One coup for the whole table: the dealer deals punto banco with the real tableau. */
export function sharedBaccarat(): SharedVisual {
  const r = dealBaccarat(drawCard);
  const note = `Player ${r.playerTotal} · Banker ${r.bankerTotal}`;
  return { kind: 'blackjack', dealer: r.banker, player: r.player, note: `${r.winner}|${note}|${r.playerPair ? 1 : 0}|${r.bankerPair ? 1 : 0}` };
}

export function resolveBaccaratSeat(bet: number, side: BaccaratSide, shared: SharedVisual): Outcome {
  const s = shared as { dealer: Card[]; player: Card[]; note: string };
  const [winner, text] = s.note.split('|');
  const round = {
    player: s.player, banker: s.dealer, playerTotal: 0, bankerTotal: 0, natural: false,
    winner: winner as BaccaratSide, playerPair: false, bankerPair: false,
  };
  const payout = Math.round(baccaratReturn(side, bet, round));
  const label = payout > bet ? `${side === 'tie' ? 'Tie' : side === 'banker' ? 'Banker' : 'Player'} wins! ${text}` : payout === bet ? `Tie: push. ${text}` : `${winner === 'tie' ? 'Tie' : winner === 'banker' ? 'Banker' : 'Player'} wins. ${text}`;
  return { bet, payout, label, tier: side === 'tie' && payout ? 'big' : tierFor(payout / bet), visual: { kind: 'blackjack', player: s.player, dealer: s.dealer } };
}

/** The dealer's three cards (shown as the board's first three). */
export function sharedThreeCard(): SharedVisual {
  const d = [drawCard(), drawCard(), drawCard()];
  return { kind: 'poker', board: [...d, drawCard(), drawCard()], dealer3: d };
}

/** A guest's stake is Ante + Play (half each); they play Q-6-4 or better, else fold. */
export function resolveThreeCardSeat(bet: number, shared: SharedVisual): Outcome {
  const dealer = (shared as { dealer3: Card[] }).dealer3;
  const hand = [drawCard(), drawCard(), drawCard()];
  const me = threeCardScore(hand);
  const plays = me[0] > 0 || me[1] > 12 || (me[1] === 12 && (me[2] > 6 || (me[2] === 6 && me[3] >= 4)));
  const ante = bet / 2;
  const r = threeCardReturn(ante, plays, me, threeCardScore(dealer));
  // Folding keeps the unplayed Play half.
  const payout = Math.round(plays ? r.total : ante);
  return {
    bet, payout, label: plays ? `${TCP_NAMES[me[0]]}: ${r.note}` : 'Folded',
    tier: me[0] >= 4 ? 'big' : tierFor(payout / bet), visual: { kind: 'poker', hole: hand.slice(0, 2), board: [], hand: TCP_NAMES[me[0]] },
  };
}

export function pickSicBoBet(risk: number): SicBoBet {
  const r = Math.random();
  if (r < 0.62 - risk * 0.3) return Math.random() < 0.5 ? { kind: 'small' } : { kind: 'big' };
  if (r < 0.8) return { kind: 'total', n: 4 + Math.floor(Math.random() * 14) };
  if (r < 0.92) return { kind: 'single', n: 1 + Math.floor(Math.random() * 6) };
  if (r < 0.97) return { kind: 'double', n: 1 + Math.floor(Math.random() * 6) };
  return Math.random() < 0.5 ? { kind: 'anyTriple' } : { kind: 'triple', n: 1 + Math.floor(Math.random() * 6) };
}

export function sicBoLabel(b: SicBoBet): string {
  switch (b.kind) {
    case 'small':
      return 'Small';
    case 'big':
      return 'Big';
    case 'total':
      return `Total ${b.n}`;
    case 'single':
      return `Single ${b.n}`;
    case 'double':
      return `Double ${b.n}s`;
    case 'triple':
      return `Triple ${b.n}s`;
    case 'anyTriple':
      return 'Any triple';
  }
}

export function sharedSicBo(): SharedVisual {
  return { kind: 'craps', dice: rollThree() };
}

export function resolveSicBoSeat(bet: number, choice: SicBoBet, shared: SharedVisual): Outcome {
  const dice = (shared as { dice: number[] }).dice as [number, number, number];
  const payout = Math.round(sicBoReturn(choice, bet, dice));
  const sum = dice[0] + dice[1] + dice[2];
  return {
    bet, payout, label: `${dice.join('-')} (${sum}) · ${sicBoLabel(choice)} ${payout ? 'wins' : 'loses'}`,
    tier: tierFor(payout / bet), visual: { kind: 'craps', dice, bet: sicBoLabel(choice) },
  };
}
