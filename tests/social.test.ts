import { describe, expect, it } from 'vitest';
import {
  GIFT_KEEP_MS, GIFT_MAX, LOAN_PERIOD_MS, LOAN_RATE, accrue, canBorrow, cleanGifts, cleanLoan, cleanNote, dailyReward, dailyStatus,
  cleanIds, dayKey, giftBlock, giftId, loanLimit, openedIds, pruneSeen, roundSig, unopenedGifts,
} from '../src/game/social';

const now = Date.UTC(2026, 9, 4, 12);

describe('gifts', () => {
  it('keeps only well-formed, recent gifts from untrusted data', () => {
    const list = cleanGifts([
      { i: 'abc123', to: 'p-1', nm: 'Ann', a: 5000, m: 'hi', t: now - 1000 },
      { i: 'abc124', to: 'p-1', a: 5e12, t: now - 1000 },
      { i: 'BAD ID', to: 'p-1', a: 10, t: now },
      { i: 'abc125', to: 'p-1', a: 0, t: now },
      { i: 'abc126', to: 'p-1', a: 100, t: now - GIFT_KEEP_MS - 1 },
      { i: 'abc127', to: 'p-1', a: 0, c: 'crown', t: now },
      { i: 'abc128', to: 'p-1', a: 0, c: 'not-a-thing', t: now },
      'junk',
    ], now);
    expect(list.map((g) => g.i)).toEqual(['abc123', 'abc124', 'abc127']);
    expect(list[1].a).toBe(GIFT_MAX);
    expect(list[2].c).toBe('crown');
    expect(cleanGifts('nope', now)).toEqual([]);
  });

  it('opens each gift once, only for its receiver, only after the player started', () => {
    const list = cleanGifts([
      { i: 'g1aaaa', to: 'me', a: 100, t: now - 5000 },
      { i: 'g2aaaa', to: 'you', a: 100, t: now - 5000 },
      { i: 'g3aaaa', to: 'me', a: 100, t: now - 60_000 },
    ], now);
    const seen: Record<string, number> = { g1aaaa: now };
    expect(unopenedGifts(list, 'me', seen, 0).map((g) => g.i)).toEqual(['g3aaaa']);
    expect(unopenedGifts(list, 'me', {}, now - 10_000).map((g) => g.i)).toEqual(['g1aaaa']);
  });

  it('forgets opened gifts long after they expire', () => {
    const seen = pruneSeen({ old: now - GIFT_KEEP_MS * 2, fresh: now - 1000 }, now);
    expect(Object.keys(seen)).toEqual(['fresh']);
  });

  it('rounds leaderboard numbers to a few significant figures', () => {
    expect(roundSig(1_234_567, 3)).toBe(1_230_000);
    expect(roundSig(-98_765, 3)).toBe(-98_800);
    expect(roundSig(42, 3)).toBe(42);
    expect(roundSig(0, 3)).toBe(0);
    expect(roundSig(NaN, 3)).toBe(0);
  });

  it('cleans notes and makes unique ids', () => {
    expect(cleanNote('  <b>hi</b>\n there ')).toBe('bhi/b there');
    expect(cleanNote(5)).toBe('');
    expect(cleanNote('x'.repeat(200))).toHaveLength(80);
    expect(giftId(now)).not.toBe(giftId(now));
    expect(giftId(now)).toMatch(/^[a-z0-9]{4,24}$/);
  });

  it('refuses gifts you can’t afford, to yourself, empty or too fast', () => {
    const ok = { amount: 1000, itemPrice: 0, money: 5000, recent: 0, self: false };
    expect(giftBlock(ok)).toBeNull();
    expect(giftBlock({ ...ok, self: true })).toMatch(/yourself/);
    expect(giftBlock({ ...ok, amount: 0 })).toMatch(/cash or a luxury/);
    expect(giftBlock({ ...ok, amount: 50 })).toMatch(/smallest/);
    expect(giftBlock({ ...ok, money: 500 })).toMatch(/don’t have/);
    expect(giftBlock({ ...ok, itemPrice: 250_000, money: 200_000 })).toMatch(/don’t have/);
    expect(giftBlock({ ...ok, recent: 5 })).toMatch(/wait a minute/);
    // Opened gifts are published so the sender sees them arrive (recent first, junk dropped).
    const now = Date.now();
    expect(openedIds({ aaaa1: now - 1000, bbbb2: now, cccc3: now - 30 * 86400_000 }, now)).toEqual(['bbbb2', 'aaaa1']);
    expect([...cleanIds(['abcd12', '<b>', 7, 'x'])]).toEqual(['abcd12']);
    expect(giftBlock({ ...ok, amount: GIFT_MAX + 1, money: 1e9 })).toMatch(/up to/);
  });
});

describe('daily reward', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 15);

  it('starts, continues and resets the streak', () => {
    expect(dailyStatus(undefined, d(2026, 10, 4))).toEqual({ claimable: true, streak: 1 });
    expect(dailyStatus({ day: '2026-10-04', streak: 3 }, d(2026, 10, 4))).toEqual({ claimable: false, streak: 3 });
    expect(dailyStatus({ day: '2026-10-03', streak: 3 }, d(2026, 10, 4))).toEqual({ claimable: true, streak: 4 });
    expect(dailyStatus({ day: '2026-10-01', streak: 6 }, d(2026, 10, 4))).toEqual({ claimable: true, streak: 1 });
    // Across a month boundary.
    expect(dailyStatus({ day: '2026-09-30', streak: 2 }, d(2026, 10, 1)).streak).toBe(3);
    expect(dayKey(d(2026, 1, 5))).toBe('2026-01-05');
  });

  it('pays more along the week and with level, day 7 the most', () => {
    expect(dailyReward(2, 1)).toBeGreaterThan(dailyReward(1, 1));
    expect(dailyReward(7, 1)).toBeGreaterThan(dailyReward(6, 1) * 1.5);
    expect(dailyReward(8, 1)).toBe(dailyReward(1, 1));
    expect(dailyReward(1, 10)).toBeGreaterThan(dailyReward(1, 1));
    expect(dailyReward(1, 1) % 50).toBe(0);
  });
});

describe('bank loans', () => {
  it('lends more at higher levels and after rebirths', () => {
    expect(loanLimit(2, 0)).toBeGreaterThan(loanLimit(1, 0));
    expect(loanLimit(5, 1)).toBeGreaterThan(loanLimit(5, 0));
    expect(canBorrow(loanLimit(3, 0) - 500, 3, 0)).toBe(500);
    expect(canBorrow(loanLimit(3, 0) + 500, 3, 0)).toBe(0);
  });

  it('charges interest only for time played', () => {
    expect(accrue(10_000, LOAN_PERIOD_MS)).toBeCloseTo(10_000 * (1 + LOAN_RATE));
    expect(accrue(10_000, 0)).toBe(10_000);
    expect(accrue(0, LOAN_PERIOD_MS)).toBe(0);
    // Two half days make one day.
    expect(accrue(accrue(10_000, LOAN_PERIOD_MS / 2), LOAN_PERIOD_MS / 2)).toBeCloseTo(accrue(10_000, LOAN_PERIOD_MS));
  });

  it('cleans stored balances', () => {
    expect(cleanLoan(5000)).toBe(5000);
    expect(cleanLoan(0.5)).toBe(0);
    expect(cleanLoan(-3)).toBe(0);
    expect(cleanLoan('lots')).toBe(0);
    expect(cleanLoan(Infinity)).toBe(0);
  });
});
