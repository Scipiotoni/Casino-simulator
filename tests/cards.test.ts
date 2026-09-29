import { describe, expect, it } from 'vitest';
import { Shoe, bestHand, bjTotal, compareScores, dealerQualifies, isBlackjack } from '../src/items/cards';
import type { Card } from '../src/items/types';

const c = (s: string): Card => {
  const rank = 'A23456789TJQK'.indexOf(s[0]);
  const suit = 'shdc'.indexOf(s[1]);
  return { rank, suit };
};
const hand = (s: string) => s.split(' ').map(c);

describe('blackjack', () => {
  it('counts aces soft and hard', () => {
    expect(bjTotal(hand('As 6h'))).toEqual({ total: 17, soft: true });
    expect(bjTotal(hand('As 6h Td'))).toEqual({ total: 17, soft: false });
    expect(bjTotal(hand('As Ad 9c'))).toEqual({ total: 21, soft: true });
    expect(isBlackjack(hand('Ah Kd'))).toBe(true);
    expect(isBlackjack(hand('7h 7d 7c'))).toBe(false);
  });

  it('deals a full shoe without repeats before reshuffling', () => {
    const shoe = new Shoe(1);
    const seen = new Set<string>();
    for (let i = 0; i < 37; i++) {
      const d = shoe.draw();
      seen.add(`${d.rank}${d.suit}`);
    }
    expect(seen.size).toBe(37);
  });
});

describe('poker', () => {
  it('ranks the categories', () => {
    const names = [
      ['As Ks Qs Js Ts 2d 3c', 'Royal flush'],
      ['9h 8h 7h 6h 5h Ad Kc', 'Straight flush'],
      ['9h 9d 9s 9c 2h 3d 4c', 'Four of a kind'],
      ['9h 9d 9s 2c 2h 3d 4c', 'Full house'],
      ['2h 7h 9h Jh Kh 3d 4c', 'Flush'],
      ['Ah 2d 3s 4c 5h 9d Jc', 'Straight'],
      ['7h 7d 7s Jc 2h 3d 4c', 'Three of a kind'],
      ['7h 7d Js Jc 2h 3d 9c', 'Two pair'],
      ['7h 7d Js Qc 2h 3d 9c', 'Pair'],
      ['7h 5d Js Qc 2h 3d 9c', 'High card'],
    ];
    for (const [cards, name] of names) expect(bestHand(hand(cards)).name).toBe(name);
  });

  it('breaks ties by kickers and knows the wheel is the lowest straight', () => {
    const a = bestHand(hand('Ah Ad Kc 7s 4h 3d 2c'));
    const b = bestHand(hand('As Ac Qc 7d 4s 3h 2d'));
    expect(compareScores(a, b)).toBeGreaterThan(0);
    const wheel = bestHand(hand('Ah 2d 3s 4c 5h 9d Jc'));
    const six = bestHand(hand('2h 3d 4s 5c 6h 9d Jc'));
    expect(compareScores(six, wheel)).toBeGreaterThan(0);
  });

  it('needs a pair of fours for the dealer to qualify', () => {
    expect(dealerQualifies(bestHand(hand('4h 4d Ks 9c 2h')))).toBe(true);
    expect(dealerQualifies(bestHand(hand('3h 3d Ks 9c 2h')))).toBe(false);
    expect(dealerQualifies(bestHand(hand('Ah Qd 9s 7c 2h')))).toBe(false);
  });
});
