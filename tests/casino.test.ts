import { describe, expect, it } from 'vitest';
import { Shoe } from '../src/items/cards';
import {
  aaBonus, beadPlate, bigRoad, perfectPairs, sicBoReturn, sixCardBonus, twentyOnePlus3, vpPays, type CoupMark,
} from '../src/items/rules';
import {
  CALL_BETS, RED_NUMBERS, WHEEL_ORDER, neighbours, numberAt, rouletteReturn, rouletteSpots, spotFor, spotPays,
} from '../src/items/roulette';
import { canPlace, crapsRoll, fmtPays, isContract, oddsMultiple, placePays } from '../src/items/craps';
import type { Card } from '../src/items/types';

const c = (s: string): Card => ({ rank: 'A23456789TJQK'.indexOf(s[0]), suit: 'shdc'.indexOf(s[1]) });
const hand = (s: string) => s.split(' ').map(c);

describe('the shoe and its cut card', () => {
  it('deals down to the cut card instead of shuffling mid-hand', () => {
    const shoe = new Shoe(6, Math.random, 78);
    expect(shoe.size).toBe(312);
    let n = 0;
    while (!shoe.cutCardOut) {
      shoe.draw();
      n++;
    }
    expect(n).toBe(312 - 78);
    expect(shoe.dealt).toBe(n);
    // Past the cut it keeps dealing (the round finishes) until the table shuffles.
    for (let i = 0; i < 20; i++) shoe.draw();
    expect(shoe.remaining).toBe(58);
    shoe.shuffle();
    expect(shoe.remaining).toBe(312);
    expect(shoe.dealt).toBe(0);
    expect(shoe.cutCardOut).toBe(false);
  });
});

describe('blackjack side bets', () => {
  it('pays Perfect Pairs', () => {
    expect(perfectPairs(c('Ks'), c('Ks')).pays).toBe(25);
    expect(perfectPairs(c('Ks'), c('Kc')).pays).toBe(12);
    expect(perfectPairs(c('Kh'), c('Kc')).pays).toBe(6);
    expect(perfectPairs(c('Kh'), c('Qh')).pays).toBe(0);
  });

  it('pays 21+3 on the three-card poker hand', () => {
    expect(twentyOnePlus3(hand('7h 7h 7h'))).toEqual({ name: 'Suited trips', pays: 100 });
    expect(twentyOnePlus3(hand('7h 7d 7c')).pays).toBe(30);
    expect(twentyOnePlus3(hand('9s Ts Js')).pays).toBe(40);
    expect(twentyOnePlus3(hand('Qs Kd Ac')).pays).toBe(10);
    expect(twentyOnePlus3(hand('As 2d 3c')).pays).toBe(10);
    expect(twentyOnePlus3(hand('2h 9h Kh')).pays).toBe(5);
    expect(twentyOnePlus3(hand('2h 9d Kh')).pays).toBe(0);
  });
});

describe('poker bonus bets', () => {
  it('pays the AA bonus on pocket cards and flop', () => {
    expect(aaBonus(hand('As Ad 4c 9h Jd')).pays).toBe(7);
    expect(aaBonus(hand('Ks Kd 4c 9h Jd')).pays).toBe(0);
    expect(aaBonus(hand('2h 7h 9h Jh Kh')).pays).toBe(20);
    expect(aaBonus(hand('As Ks Qs Js Ts')).pays).toBe(100);
  });

  it('pays the 6-card bonus on the best five of six', () => {
    expect(sixCardBonus(hand('As Ks Qs Js Ts 2d')).pays).toBe(1000);
    expect(sixCardBonus(hand('9h 9d 9s 2c 2h 5d')).pays).toBe(20);
    expect(sixCardBonus(hand('9h 9d 9s 3c 2h 5d')).pays).toBe(5);
    expect(sixCardBonus(hand('9h 9d 4s 3c 2h 5d')).pays).toBe(0);
  });
});

describe('video poker coins', () => {
  it('pays the royal 4,000 only on five coins', () => {
    expect(vpPays('Royal Flush', 5)).toBe(4000);
    expect(vpPays('Royal Flush', 4)).toBe(1000);
    expect(vpPays('Full House', 3)).toBe(27);
    expect(vpPays('Jacks or Better', 5)).toBe(5);
    expect(vpPays('Nothing', 5)).toBe(0);
  });
});

describe('sic bo combinations', () => {
  it('pays 5:1 when both numbers show', () => {
    expect(sicBoReturn({ kind: 'combo', n: 2, m: 5 }, 10, [5, 1, 2])).toBe(60);
    expect(sicBoReturn({ kind: 'combo', n: 2, m: 5 }, 10, [5, 5, 3])).toBe(0);
  });
});

describe('roulette layout', () => {
  const spots = rouletteSpots();
  it('has every bet a European layout takes', () => {
    const count = (k: string) => spots.filter((s) => s.kind === k).length;
    expect(count('straight')).toBe(37);
    expect(count('split')).toBe(60);
    expect(count('street')).toBe(12);
    expect(count('trio')).toBe(2);
    expect(count('corner')).toBe(22);
    expect(count('firstFour')).toBe(1);
    expect(count('line')).toBe(11);
    expect(count('column') + count('dozen')).toBe(6);
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
  });

  it('pays by the numbers covered, all with the same edge', () => {
    expect(spotPays(spotFor('straight', [17])!)).toBe(35);
    expect(spotPays(spotFor('split', [17, 20])!)).toBe(17);
    expect(spotPays(spotFor('street', [16, 17, 18])!)).toBe(11);
    expect(spotPays(spotFor('corner', [17, 18, 20, 21])!)).toBe(8);
    expect(spotPays(spotFor('line', [16, 17, 18, 19, 20, 21])!)).toBe(5);
    for (const s of spots) {
      let back = 0;
      for (let n = 0; n <= 36; n++) back += rouletteReturn(s, 1, n, false);
      expect(back / 37).toBeCloseTo(36 / 37, 9);
    }
    // La partage: an even-money bet loses only half on zero.
    const red = spots.find((s) => s.id === 'red')!;
    expect(rouletteReturn(red, 10, 0)).toBe(5);
    expect(rouletteReturn(spotFor('straight', [5])!, 10, 0)).toBe(0);
  });

  it('only joins neighbours on the felt', () => {
    expect(numberAt(0, 0)).toBe(3);
    expect(numberAt(0, 2)).toBe(1);
    expect(numberAt(11, 0)).toBe(36);
    const pos = (n: number) => ({ col: Math.floor((n - 1) / 3), row: 2 - ((n - 1) % 3) });
    for (const s of spots.filter((x) => x.kind === 'split' && !x.numbers.includes(0))) {
      const [a, b] = s.numbers.map(pos);
      expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
    }
    expect(RED_NUMBERS.size).toBe(18);
  });

  it('builds the call bets from the wheel', () => {
    const covered = (id: string) => new Set(CALL_BETS.find((b) => b.id === id)!.chips.flatMap(([k, ns]) => spotFor(k, ns)!.numbers));
    expect(covered('voisins').size).toBe(17);
    expect(covered('tiers').size).toBe(12);
    expect(covered('orphelins').size).toBe(8);
    expect(covered('jeu0').size).toBe(7);
    expect(CALL_BETS.find((b) => b.id === 'voisins')!.chips.reduce((a, [, , u]) => a + u, 0)).toBe(9);
    // Together they cover the whole wheel exactly once (voisins, tiers, orphelins).
    const all = [...covered('voisins'), ...covered('tiers'), ...covered('orphelins')];
    expect(new Set(all).size).toBe(37);
    expect(all.length).toBe(37);
    expect(neighbours(0, 2)).toEqual([3, 26, 0, 32, 15]);
    expect(WHEEL_ORDER.length).toBe(37);
  });
});

describe('craps', () => {
  const B = (o: Record<string, number>) => new Map(Object.entries(o));

  it('settles the line on the come-out and with a point', () => {
    let r = crapsRoll(0, B({ pass: 10, dontPass: 10 }), [5, 6]);
    expect(r.point).toBe(0);
    expect(r.decisions.find((d) => d.id === 'pass')!.back).toBe(20);
    expect(r.decisions.find((d) => d.id === 'dontPass')!.back).toBe(0);
    r = crapsRoll(0, B({ dontPass: 10 }), [6, 6]);
    expect(r.bets.get('dontPass')).toBe(10); // bar 12
    r = crapsRoll(0, B({ pass: 10 }), [4, 2]);
    expect(r.point).toBe(6);
    expect(r.bets.get('pass')).toBe(10);
    r = crapsRoll(6, B({ pass: 10, passOdds: 50 }), [3, 3]);
    expect(r.point).toBe(0);
    expect(r.decisions.reduce((a, d) => a + d.back, 0)).toBe(20 + 50 + 60);
    r = crapsRoll(4, B({ dontPass: 10, dontOdds: 60 }), [3, 4]);
    expect(r.decisions.reduce((a, d) => a + d.back, 0)).toBe(20 + 60 + 30);
  });

  it('moves come bets to their number and pays them', () => {
    let r = crapsRoll(6, B({ pass: 10, come: 10 }), [5, 4]);
    expect(r.bets.get('come:9')).toBe(10);
    expect(r.moved).toEqual([{ from: 'come', to: 'come:9' }]);
    r = crapsRoll(6, B({ 'come:9': 10, 'comeOdds:9': 20 }), [4, 5]);
    expect(r.decisions.reduce((a, d) => a + d.back, 0)).toBe(20 + 50);
    // On the come-out the odds are off: a 7 takes the come bet but returns the odds.
    r = crapsRoll(0, B({ 'come:9': 10, 'comeOdds:9': 20 }), [3, 4]);
    const back = Object.fromEntries(r.decisions.map((d) => [d.id, d.back]));
    expect(back['come:9']).toBe(0);
    expect(back['comeOdds:9']).toBe(20);
    expect(isContract(0, 'come:9')).toBe(true);
    expect(isContract(6, 'pass')).toBe(true);
    expect(isContract(0, 'pass')).toBe(false);
  });

  it('pays place bets and leaves them up, off on the come-out', () => {
    let r = crapsRoll(5, B({ 'place:6': 12, 'place:4': 5 }), [2, 4]);
    expect(r.decisions).toEqual([{ id: 'place:6', stake: 0, back: 14, note: 'Place 6 pays 7:6' }]);
    expect(r.bets.get('place:6')).toBe(12);
    r = crapsRoll(0, B({ 'place:6': 12, 'hard:8': 5 }), [3, 4]);
    expect(r.decisions).toHaveLength(0);
    r = crapsRoll(5, B({ 'place:6': 12, 'hard:8': 5 }), [3, 4]);
    expect(r.bets.size).toBe(0);
    r = crapsRoll(5, B({ 'hard:8': 5 }), [4, 4]);
    expect(r.decisions[0].back).toBe(45);
    r = crapsRoll(5, B({ 'hard:8': 5 }), [5, 3]);
    expect(r.decisions[0].back).toBe(0);
  });

  it('pays the propositions', () => {
    const back = (id: string, d: [number, number], a = 4) => crapsRoll(0, B({ [id]: a }), d).decisions.find((x) => x.id === id)!.back;
    expect(back('horn', [1, 1])).toBe(4 + 27);
    expect(back('horn', [1, 2])).toBe(4 + 12);
    expect(back('horn', [3, 4])).toBe(0);
    expect(back('ce', [5, 6], 2)).toBe(2 + 14);
    expect(back('ce', [1, 2], 2)).toBe(2 + 6);
    expect(back('field', [6, 6], 5)).toBe(20);
    expect(back('field', [3, 4], 5)).toBe(0);
    expect(back('any7', [3, 4], 5)).toBe(25);
  });

  it('enforces odds limits and when bets can go down', () => {
    expect(canPlace(0, B({}), 'come').ok).toBe(false);
    expect(canPlace(6, B({}), 'pass').ok).toBe(false);
    expect(canPlace(6, B({ pass: 10 }), 'passOdds').max).toBe(50);
    expect(canPlace(4, B({ pass: 10 }), 'passOdds').max).toBe(30);
    expect(canPlace(5, B({ dontPass: 10 }), 'dontOdds').max).toBe(60);
    expect(oddsMultiple(9)).toBe(4);
    expect(placePays(5)).toBeCloseTo(1.4);
    expect(fmtPays(1.2)).toBe('6:5');
    expect(fmtPays(7 / 6)).toBe('7:6');
  });

  it('has the textbook house edge', () => {
    let point = 0;
    let bets = new Map<string, number>();
    let staked = 0;
    let back = 0;
    let rolls = 0;
    // Pass line ≈ 1.41%, measured per resolved bet.
    let decided = 0;
    while (decided < 300_000) {
      if (!point && !bets.get('pass')) bets.set('pass', 100);
      const r = crapsRoll(point, bets, [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      rolls++;
      for (const d of r.decisions) {
        staked += d.stake;
        back += d.back;
        decided++;
      }
      point = r.point;
      bets = r.bets;
    }
    expect(rolls).toBeGreaterThan(decided);
    const edge = 1 - back / staked;
    expect(edge).toBeGreaterThan(0.004);
    expect(edge).toBeLessThan(0.025);
  });
});

describe('baccarat scoreboards', () => {
  const coups = (s: string): CoupMark[] => [...s].map((w) => ({ winner: w as 'P' | 'B' | 'T' }));
  it('fills the bead plate down then across', () => {
    const b = beadPlate(coups('PBTPPBB'));
    expect(b[5]).toMatchObject({ col: 0, row: 5, winner: 'B' });
    expect(b[6]).toMatchObject({ col: 1, row: 0, winner: 'B' });
  });

  it('draws the big road with streaks, ties and a dragon tail', () => {
    const r = bigRoad(coups('TBBTPPPPPPPPBP'));
    expect(r[0]).toMatchObject({ col: 0, row: 0, winner: 'B', ties: 1 });
    expect(r[1]).toMatchObject({ col: 0, row: 1, winner: 'B', ties: 1 });
    // Eight players in a row: six down, then the tail turns right along the bottom.
    const ps = r.filter((x) => x.winner === 'P');
    expect(ps[5]).toMatchObject({ col: 1, row: 5 });
    expect(ps[6]).toMatchObject({ col: 2, row: 5 });
    expect(ps[7]).toMatchObject({ col: 3, row: 5 });
    expect(r[10]).toMatchObject({ col: 2, row: 0, winner: 'B' });
    expect(r[11]).toMatchObject({ col: 3, row: 0, winner: 'P' });
  });
});
