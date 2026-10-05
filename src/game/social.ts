import { COSMETIC_IDS } from '../cosmetics/catalog';

// ------------------------------------------------------------------ gifts

/**
 * A gift you sent: cash, a luxury item, or both, with a short note. Each sender keeps
 * their recent gifts in their ledger (so they arrive even if the receiver is offline) and
 * in their presence (so they arrive at once if the receiver is online).
 */
export interface GiftOut {
  /** Unique id (the receiver remembers which ones it already opened). */
  i: string;
  /** Receiver's player id and name. */
  to: string;
  nm: string;
  /** Cash in the box. */
  a: number;
  /** A luxury item (cosmetic id) in the box. */
  c?: string;
  /** Note. */
  m: string;
  /** When it was sent (epoch ms). */
  t: number;
}

/** A gift you opened (for the gift history). */
export interface GiftIn {
  from: string;
  a: number;
  c?: string;
  m: string;
  t: number;
}

/** The most cash one gift can hold, and how many gifts a minute you can send. */
export const GIFT_MAX = 1_000_000;
export const GIFT_MIN = 100;
export const GIFTS_PER_MIN = 5;
/** Gifts are kept (and can be opened) for two weeks. */
export const GIFT_KEEP_MS = 14 * 86400_000;
/** Gifts you've sent kept in your ledger. */
export const GIFT_LOG = 30;
/** One-tap amounts on the gift screen. */
export const GIFT_CHOICES = [1_000, 5_000, 25_000, 100_000, 500_000];
/** One-tap notes. */
export const GIFT_NOTES = ['Good luck! 🍀', 'Thanks for visiting! 🎰', 'GG 🤝', 'Happy birthday! 🎂', 'Drinks are on me 🍸', 'Welcome to the Strip! 🌴'];

export function giftId(now = Date.now()): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** A gift note: one line, no markup, short. */
export function cleanNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Other players' gift lists are untrusted: keep only well-formed, recent gifts. */
export function cleanGifts(raw: unknown, now = Date.now()): GiftOut[] {
  if (!Array.isArray(raw)) return [];
  const out: GiftOut[] = [];
  for (const g of raw.slice(-GIFT_LOG)) {
    if (!g || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    if (typeof r.i !== 'string' || !/^[a-z0-9]{4,24}$/.test(r.i)) continue;
    if (typeof r.to !== 'string' || !r.to || r.to.length > 80) continue;
    const t = typeof r.t === 'number' && Number.isFinite(r.t) ? r.t : 0;
    if (t <= 0 || now - t > GIFT_KEEP_MS || t - now > 5 * 60_000) continue;
    const a = typeof r.a === 'number' && Number.isFinite(r.a) ? Math.max(0, Math.min(GIFT_MAX, Math.round(r.a))) : 0;
    const c = typeof r.c === 'string' && COSMETIC_IDS.has(r.c) ? r.c : undefined;
    if (!a && !c) continue;
    out.push({ i: r.i, to: r.to, nm: typeof r.nm === 'string' ? r.nm.slice(0, 24) : '', a, c, m: cleanNote(r.m), t });
  }
  return out;
}

/** Gifts in someone's list addressed to `pid` that haven't been opened yet. */
export function unopenedGifts(list: readonly GiftOut[], pid: string, seen: Record<string, number>, since: number): GiftOut[] {
  return list.filter((g) => g.to === pid && !seen[g.i] && g.t >= since);
}

/** Ids of the gifts you opened lately (published, so senders can see their gift arrived). */
export function openedIds(seen: Record<string, number>, now = Date.now()): string[] {
  return Object.entries(seen)
    .filter(([, t]) => now - t < GIFT_KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([k]) => k);
}

/** Someone else's list of opened gift ids (untrusted). */
export function cleanIds(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw.slice(0, 40)) if (typeof v === 'string' && /^[a-z0-9]{4,24}$/.test(v)) out.add(v);
  return out;
}

/** Forget opened gifts older than the keep window (they can't come back anyway). */
export function pruneSeen(seen: Record<string, number>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(seen)) if (now - v < GIFT_KEEP_MS + 86400_000) out[k] = v;
  return out;
}

/** Why a gift can't be sent (null = go ahead). */
export function giftBlock(o: { amount: number; itemPrice: number; money: number; recent: number; self: boolean }): string | null {
  if (o.self) return 'You can’t send a gift to yourself.';
  if (o.amount <= 0 && o.itemPrice <= 0) return 'Put some cash or a luxury item in the box.';
  if (o.amount > 0 && o.amount < GIFT_MIN) return `The smallest cash gift is $${GIFT_MIN}.`;
  if (o.amount > GIFT_MAX) return 'One gift can hold up to $1,000,000.';
  if (o.recent >= GIFTS_PER_MIN) return 'Easy, Santa: wait a minute before sending more gifts.';
  if (o.money < o.amount + o.itemPrice) return 'You don’t have that much in the bank.';
  return null;
}

/** A number rounded to `n` significant figures (leaderboard numbers that don't change every tick). */
export function roundSig(v: number, n: number): number {
  if (!v || !Number.isFinite(v)) return 0;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(v))) + 1 - n));
  return Math.round(v / p) * p;
}

// ------------------------------------------------------------------ daily reward

/** A day's reward multiplier along a 7-day streak (day 7 is the big one). */
export const DAILY_MULT = [1, 1.5, 2, 3, 4, 5, 10];

export interface DailyState {
  /** Local date of the last claim (YYYY-MM-DD). */
  day: string;
  /** Days in a row claimed (1 = first). */
  streak: number;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** What claiming today would give: can you claim, and which day of the streak it is. */
export function dailyStatus(state: DailyState | undefined, now: Date): { claimable: boolean; streak: number } {
  const today = dayKey(now);
  if (state?.day === today) return { claimable: false, streak: state.streak };
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const streak = state && state.day === dayKey(y) ? state.streak + 1 : 1;
  return { claimable: true, streak };
}

/** Cash for day `streak` of a login streak, growing with your casino's level. */
export function dailyReward(streak: number, level: number): number {
  const mult = DAILY_MULT[(Math.max(1, streak) - 1) % DAILY_MULT.length];
  return Math.round(((500 + Math.max(1, level) * 250) * mult) / 50) * 50;
}

// ------------------------------------------------------------------ bank loans

/**
 * Interest per game day (one game day is five real minutes). It's charged only while you
 * play, so closing the game for a week doesn't bury you.
 */
export const LOAN_RATE = 0.03;
export const LOAN_PERIOD_MS = 5 * 60_000;
/** Owe more than this many times your credit line and the bank calls the loan in. */
export const LOAN_CALL = 1.5;

/** How much the bank will lend you in total: grows with your level and rebirths. */
export function loanLimit(level: number, rebirths: number): number {
  return Math.round(20_000 * Math.max(1, level) * (1 + rebirths * 0.5));
}

/** What you owe after `ms` of play with interest. */
export function accrue(owed: number, ms: number): number {
  if (owed <= 0 || ms <= 0) return Math.max(0, owed);
  return owed * Math.pow(1 + LOAN_RATE, ms / LOAN_PERIOD_MS);
}

/** How much more you can borrow right now. */
export function canBorrow(owed: number, level: number, rebirths: number): number {
  return Math.max(0, Math.floor(loanLimit(level, rebirths) - owed));
}

/** Loan balance from a save or an older version: a sane number. */
export function cleanLoan(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.min(1e10, raw) : 0;
}
