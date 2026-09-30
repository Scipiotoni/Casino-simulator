import { describe, expect, it } from 'vitest';
import {
  baccaratTotal, dealBaccarat, baccaratReturn, jacksOrBetter, threeCardScore, compareThree, tcpDealerQualifies,
  pairPlusPays, sicBoReturn, kenoDraw, kenoReturn, KENO_PAYS, passOddsPays, BIG_SIX_LAYOUT, bigSixPays,
} from '../src/items/rules';
import { Shoe } from '../src/items/cards';
import type { Card } from '../src/items/types';

const c = (s: string): Card => ({ rank: 'A23456789TJQK'.indexOf(s[0]), suit: 'shdc'.indexOf(s[1]) });
const hand = (s: string) => s.split(' ').map(c);

describe('baccarat', () => {
  it('counts points mod 10 with faces as zero', () => {
    expect(baccaratTotal(hand('Ks 9h'))).toBe(9);
    expect(baccaratTotal(hand('7s 8h'))).toBe(5);
    expect(baccaratTotal(hand('As Td Qc'))).toBe(1);
  });

  it('follows the third-card tableau', () => {
    // Player 4 draws a 7 (value 7); banker 6 must draw on a player third card of 6 or 7.
    const seq = hand('4s Ks 6h Kd 7c 2h');
    let i = 0;
    const r = dealBaccarat(() => seq[i++]);
    expect(r.player.length).toBe(3);
    expect(r.banker.length).toBe(3);
    // Naturals stand.
    const nat = hand('8s Ks 2h 3d');
    let j = 0;
    const n = dealBaccarat(() => nat[j++]);
    expect(n.natural).toBe(true);
    expect(n.player.length + n.banker.length).toBe(4);
  });

  it('has the textbook house edge on banker and player', () => {
    const shoe = new Shoe(8);
    let b = 0;
    let p = 0;
    const N = 200_000;
    for (let k = 0; k < N; k++) {
      const r = dealBaccarat(() => shoe.draw());
      b += baccaratReturn('banker', 1, r);
      p += baccaratReturn('player', 1, r);
    }
    expect(b / N).toBeGreaterThan(0.98);
    expect(b / N).toBeLessThan(0.995);
    expect(p / N).toBeGreaterThan(0.978);
    expect(p / N).toBeLessThan(0.995);
  });
});

describe('video poker', () => {
  it('pays the 9/6 Jacks or Better table', () => {
    expect(jacksOrBetter(hand('As Ks Qs Js Ts')).pays).toBe(800);
    expect(jacksOrBetter(hand('9h 9d 9s 2c 2h')).pays).toBe(9);
    expect(jacksOrBetter(hand('2h 7h 9h Jh Kh')).pays).toBe(6);
    expect(jacksOrBetter(hand('Jh Jd 4s 7c 9h')).pays).toBe(1);
    expect(jacksOrBetter(hand('Th Td 4s 7c 9h')).pays).toBe(0);
  });
});

describe('three card poker', () => {
  it('ranks straights above flushes and knows the dealer rule', () => {
    expect(compareThree(threeCardScore(hand('4s 5d 6c')), threeCardScore(hand('2h 7h 9h')))).toBeGreaterThan(0);
    expect(threeCardScore(hand('As 2d 3c'))[0]).toBe(3);
    expect(tcpDealerQualifies(threeCardScore(hand('Qs 4d 2c')))).toBe(true);
    expect(tcpDealerQualifies(threeCardScore(hand('Js 9d 2c')))).toBe(false);
    expect(pairPlusPays(threeCardScore(hand('7s 7d 7c')))).toBe(30);
  });
});

describe('sic bo', () => {
  it('pays small/big except on triples, and specific totals', () => {
    expect(sicBoReturn({ kind: 'small' }, 10, [1, 2, 3])).toBe(20);
    expect(sicBoReturn({ kind: 'small' }, 10, [2, 2, 2])).toBe(0);
    expect(sicBoReturn({ kind: 'total', n: 4 }, 10, [1, 1, 2])).toBe(610);
    expect(sicBoReturn({ kind: 'single', n: 5 }, 10, [5, 5, 1])).toBe(30);
    expect(sicBoReturn({ kind: 'triple', n: 6 }, 1, [6, 6, 6])).toBe(181);
  });
});

describe('keno', () => {
  it('draws 20 distinct numbers and pays by catches', () => {
    const d = kenoDraw();
    expect(new Set(d).size).toBe(20);
    expect(d.every((n) => n >= 1 && n <= 80)).toBe(true);
    expect(kenoReturn([d[0], d[1], d[2], d[3]], d, 5).total).toBe(5 * KENO_PAYS[4][4]);
  });
});

describe('craps and big six', () => {
  it('pays true odds and uses the 54-stop layout', () => {
    expect(passOddsPays(4)).toBe(2);
    expect(passOddsPays(9)).toBe(1.5);
    expect(passOddsPays(6)).toBe(1.2);
    expect(BIG_SIX_LAYOUT.length).toBe(54);
    expect(bigSixPays(41)).toBe(40);
  });
});
