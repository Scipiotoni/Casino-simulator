import { describe, expect, it } from 'vitest';
import {
  SLOT_BASE_RTP, dealDealerHand, handValue, resolveCrapsBet, resolvePachinko, resolveRouletteBet, resolveSlot, resolveWheelBet,
  scoreBlackjack, spinRoulette,
} from '../src/items/games';
import { WHEEL_SEGMENTS, rouletteColor } from '../src/render/textures';

function rtp(n: number, f: () => { bet: number; payout: number }): number {
  let bet = 0;
  let paid = 0;
  for (let i = 0; i < n; i++) {
    const o = f();
    bet += o.bet;
    paid += o.payout;
  }
  return paid / bet;
}

describe('slot machines', () => {
  it('pays back close to the configured RTP', () => {
    expect(SLOT_BASE_RTP).toBeGreaterThan(0.8);
    const r = rtp(400_000, () => resolveSlot(10, 0.9, false));
    expect(r).toBeGreaterThan(0.84);
    expect(r).toBeLessThan(0.96);
  });

  it('shows symbols that match the outcome', () => {
    for (let i = 0; i < 5000; i++) {
      const o = resolveSlot(5, 0.9, false);
      if (o.visual.kind !== 'slot') throw new Error('bad visual');
      const [a, b, c] = o.visual.symbols;
      if (o.tier === 'lose') {
        expect(a === b && b === c).toBe(false);
        expect(a).not.toBe(1); // a cherry on reel one always pays
      }
      if (o.label === 'TRIPLE 7s!') expect([a, b, c]).toEqual([0, 0, 0]);
    }
  });

  it('lets cheaters win far more often', () => {
    const honest = rtp(200_000, () => resolveSlot(10, 0.9, false));
    const cheat = rtp(200_000, () => resolveSlot(10, 0.9, true));
    expect(cheat).toBeGreaterThan(honest * 1.4);
  });

  it('low-volatility machines hit more often at the same RTP', () => {
    let hitsLow = 0;
    let hitsNormal = 0;
    for (let i = 0; i < 100_000; i++) {
      if (resolveSlot(10, 0.88, false, 0, 'low').payout > 0) hitsLow++;
      if (resolveSlot(10, 0.88, false).payout > 0) hitsNormal++;
    }
    expect(hitsLow).toBeGreaterThan(hitsNormal);
    const r = rtp(400_000, () => resolveSlot(10, 0.88, false, 0, 'low'));
    expect(r).toBeGreaterThan(0.84);
    expect(r).toBeLessThan(0.92);
  });

  it('pays the progressive pot on the mega jackpot', () => {
    let hit = false;
    for (let i = 0; i < 200_000 && !hit; i++) {
      const o = resolveSlot(25, 0.86, false, 12345);
      if (o.tier === 'jackpot') {
        expect(o.payout).toBe(12345);
        hit = true;
      }
    }
    expect(hit).toBe(true);
  });
});

describe('table games keep a house edge', () => {
  it('roulette', () => {
    const r = rtp(300_000, () => {
      const n = spinRoulette(0.92);
      return resolveRouletteBet(10, { kind: 'color', color: 'red' }, n, false);
    });
    expect(r).toBeGreaterThan(0.87);
    expect(r).toBeLessThan(0.97);
    expect(rouletteColor(0)).toBe('green');
  });

  it('big wheel segments and payouts', () => {
    const counts = new Map<number, number>();
    for (const s of WHEEL_SEGMENTS) counts.set(s.mult, (counts.get(s.mult) ?? 0) + 1);
    expect(WHEEL_SEGMENTS.length).toBe(54);
    expect([1, 2, 5, 10, 20, 40, 41].map((m) => counts.get(m))).toEqual([24, 15, 7, 4, 2, 1, 1]);
    const r = rtp(300_000, () => resolveWheelBet(10, 1, Math.floor(Math.random() * WHEEL_SEGMENTS.length), false));
    expect(r).toBeLessThan(1);
  });

  it('craps single-roll bets', () => {
    const roll = (): [number, number] => [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    for (const kind of ['field', 'seven', 'craps', 'yo'] as const) {
      const r = rtp(300_000, () => resolveCrapsBet(10, kind, roll(), false));
      expect(r).toBeLessThan(1);
      expect(r).toBeGreaterThan(0.75);
    }
  });

  it('pachinko', () => {
    const r = rtp(300_000, () => resolvePachinko(10, 0.86, false));
    expect(r).toBeGreaterThan(0.78);
    expect(r).toBeLessThan(0.94);
  });

  it('blackjack scoring', () => {
    const c = (rank: number) => ({ rank, suit: 0 });
    expect(handValue([c(0), c(12)])).toBe(21);
    expect(handValue([c(0), c(0), c(8)])).toBe(21);
    expect(scoreBlackjack(10, [c(0), c(12)], [c(9), c(8)]).payout).toBe(25);
    expect(scoreBlackjack(10, [c(9), c(9), c(9)], [c(9), c(8)]).payout).toBe(0);
    expect(scoreBlackjack(10, [c(9), c(8)], [c(9), c(8)]).payout).toBe(10);
    for (let i = 0; i < 200; i++) expect(handValue(dealDealerHand())).toBeGreaterThanOrEqual(17);
  });
});
