import type { Game } from '../../game/game';
import type { Modals } from '../modals';
import type { PlacedItem } from '../../items/placedItem';
import type { Card, Outcome, SharedVisual } from '../../items/types';
import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { RANKS, SUITS, isRed } from '../../items/cards';

export interface GameCtx {
  game: Game;
  modals: Modals;
  item: PlacedItem;
  /** Practice play with pretend chips: no real money changes hands. */
  practice?: boolean;
}

export const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Chip denominations from the table minimum up (there's no maximum for visitors). */
export function chipValues(min: number): number[] {
  const base = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 100000];
  const out = base.filter((v) => v >= min);
  if (!out.includes(min)) out.unshift(min);
  return out.slice(0, 8);
}

/**
 * Your wallet at someone else's table: shows your bank and session result, takes bets and
 * settles each round with the casino's owner (the rival or another player).
 */
export class Session {
  readonly head: HTMLElement;
  private bankEl = h('b', { class: 'tg-bank' });
  private netEl = h('span', { class: 'tg-net' });
  net = 0;
  closed = false;
  private offMoney: () => void;

  /** The seat your character took at this table. */
  readonly seat: number;
  private roundStake = 0;

  constructor(readonly ctx: GameCtx) {
    this.seat = Math.max(0, ctx.game.sitAt(ctx.item));
    const refill = h('button', {
      class: 'btn small', text: 'Refill chips', title: 'Practice chips are free',
      onClick: () => {
        ctx.game.refillChips();
        audio.play('chips');
      },
    });
    this.head = ctx.practice
      ? h('div', { class: 'tg-head practice' },
        h('span', { class: 'tg-where', text: '🎲 Practice play: pretend chips, no real money' }),
        h('span', {}, 'Chips ', this.bankEl, ' ', this.netEl, ' ', refill),
      )
      : h('div', { class: 'tg-head' },
        h('span', { class: 'tg-where', text: `${ctx.game.hereName} · min ${formatMoney(this.min)} · no max bet` }),
        h('span', {}, 'Bank ', this.bankEl, ' ', this.netEl),
      );
    const off1 = ctx.game.events.on('money', () => this.refresh());
    const off2 = ctx.game.events.on('chips', () => this.refresh());
    this.offMoney = () => {
      off1();
      off2();
    };
    this.refresh();
  }

  get min(): number {
    return this.ctx.item.minBet;
  }

  /** Visitors can bet as much as their bank holds. */
  get max(): number {
    return Infinity;
  }

  get bank(): number {
    return this.ctx.practice ? this.ctx.game.playChips : this.ctx.game.money;
  }

  refresh(): void {
    this.bankEl.textContent = this.ctx.practice ? `🪙 ${Math.floor(this.bank).toLocaleString()}` : formatMoney(Math.floor(this.ctx.game.money));
    const amt = this.ctx.practice ? `${Math.abs(this.net).toLocaleString()} chips` : formatMoney(Math.abs(this.net));
    this.netEl.textContent = this.net ? `(session ${this.net >= 0 ? '+' : '−'}${amt})` : '';
    this.netEl.className = `tg-net ${this.net > 0 ? 'pos' : this.net < 0 ? 'neg' : ''}`;
  }

  /** Put chips down. Returns false (and complains) if you can't cover it. */
  bet(amount: number): boolean {
    if (this.closed) return false;
    if (this.ctx.practice ? !this.ctx.game.chipBet(amount) : !this.ctx.game.visitorBet(amount)) {
      audio.play('error');
      this.ctx.game.notify(this.ctx.practice ? 'Out of practice chips: press Refill chips.' : 'Not enough cash in the bank for that bet!', 'bad');
      return false;
    }
    audio.play('chips');
    // Your chips go down on the real table.
    this.roundStake += amount;
    this.ctx.item.model.event({ type: 'bet', seat: this.seat, amount: this.roundStake });
    return true;
  }

  /** Play the round out on the 3D table (spin, roll or deal). */
  animate(shared: SharedVisual, duration: number, outcome?: Outcome): void {
    const outcomes = new Map<number, Outcome>();
    if (outcome) outcomes.set(this.seat, outcome);
    this.ctx.item.model.event({ type: 'tableStart', seats: outcome ? [this.seat] : [], outcomes, shared, duration });
  }

  /** Spin the reels of the machine you're sitting at. */
  spinMachine(outcome: Outcome, duration: number): void {
    this.ctx.item.model.event({ type: 'start', seat: this.seat, outcome, duration });
    window.setTimeout(() => this.ctx.item.model.event({ type: 'result', seat: this.seat, outcome }), duration * 1000);
  }

  /** `stake` is everything you put down this round, `payout` everything handed back. */
  settle(stake: number, payout: number): void {
    if (this.closed) return;
    this.net += payout - stake;
    const oc: Outcome = { bet: stake, payout, label: '', tier: payout > stake ? 'win' : payout === stake ? 'push' : 'lose', visual: { kind: 'none' } };
    this.ctx.item.model.event({ type: 'tableResult', seats: [this.seat], outcomes: new Map([[this.seat, oc]]), shared: { kind: 'none' } });
    this.roundStake = 0;
    if (this.ctx.practice) this.ctx.game.chipSettle(stake, payout, this.ctx.item);
    else this.ctx.game.visitorSettle(stake, payout, this.ctx.item);
    const d = payout - stake;
    if (d > 0) audio.play(d >= stake * 5 ? 'bigwin' : 'win');
    this.refresh();
    if (!this.ctx.practice && this.ctx.game.checkWinnerLimit()) {
      this.closed = true;
      this.ctx.modals.closeAll();
    }
  }

  dispose(): void {
    this.closed = true;
    this.offMoney();
    this.ctx.item.model.event({ type: 'clear', seat: this.seat });
    this.ctx.game.standUp();
  }
}

/**
 * Clickable chip selector. With `custom`, it also takes any amount typed in and has an
 * "All in" button, so bets are only limited by the table minimum and your bank.
 */
export function chipRow(values: number[], get: () => number, set: (v: number) => void, custom?: { min: number; bank: () => number }): HTMLElement {
  const wrap = h('div', { class: 'tg-chipwrap' });
  const row = h('div', { class: 'tg-chips' });
  wrap.appendChild(row);
  let input: HTMLInputElement | null = null;
  if (custom) {
    input = h('input', { class: 'text-input tg-amount', type: 'number', placeholder: `Any amount (min ${formatMoney(custom.min)})`, 'aria-label': 'Bet amount' }) as HTMLInputElement;
    input.min = String(custom.min);
    input.step = '1';
    input.inputMode = 'numeric';
    const apply = (v: number) => {
      if (!Number.isFinite(v)) return;
      const amt = Math.max(custom.min, Math.floor(v));
      set(amt);
      render();
    };
    input.addEventListener('change', () => apply(Number(input!.value)));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input!.blur();
    });
    const allIn = h('button', {
      class: 'btn small danger', text: 'All in',
      onClick: () => {
        apply(Math.max(custom.min, custom.bank()));
        audio.play('chips');
      },
    });
    wrap.appendChild(h('div', { class: 'tg-custom' }, input, allIn));
  }
  const render = () => {
    if (input && document.activeElement !== input) input.value = values.includes(get()) ? '' : String(get());
    row.replaceChildren(
      ...values.map((v, i) =>
        h('button', {
          class: `tg-chip c${i % 7}${v === get() ? ' on' : ''}`, text: v >= 1000 ? `${v / 1000}K` : String(v), 'aria-label': `Chip ${formatMoney(v)}`,
          onClick: () => {
            set(v);
            render();
            audio.play('click');
          },
        }),
      ),
    );
  };
  render();
  return wrap;
}

/** A playing card (face down when `card` is null). */
export function cardEl(card: Card | null, delay = 0): HTMLElement {
  const el = h('div', { class: `pc${card ? '' : ' back'}${card && isRed(card) ? ' red' : ''}` });
  if (card) {
    el.append(
      h('span', { class: 'pc-r', text: RANKS[card.rank] }),
      h('span', { class: 'pc-s', text: SUITS[card.suit] }),
      h('span', { class: 'pc-big', text: SUITS[card.suit] }),
    );
  }
  el.style.animationDelay = `${delay}ms`;
  return el;
}

/** Turn a face-down card face up in place. */
export function reveal(el: HTMLElement, card: Card): void {
  const fresh = cardEl(card);
  fresh.classList.add('flip');
  el.replaceWith(fresh);
}

export function resultLine(): HTMLElement {
  return h('div', { class: 'mg-result', text: '' });
}

export function setResult(el: HTMLElement, text: string, kind: '' | 'win' | 'big' | 'jackpot' | 'lose' = ''): void {
  el.textContent = text;
  el.className = `mg-result ${kind}`;
}

/** A betting spot on a layout: label, payout line and the chips riding on it. */
export function betSpot(label: string, sub: string, amount: number, onClick: () => void, cls = '', disabled = false): HTMLElement {
  return h('button', { class: `bet-spot ${cls}${amount ? ' on' : ''}`, disabled, onClick },
    h('span', { text: label }),
    sub ? h('small', { text: sub }) : null,
    amount ? h('span', { class: 'rb-chip', text: amount >= 1000 ? `${Math.round(amount / 100) / 10}K` : String(amount) }) : null);
}

/** Total of all the chips in a bet map. */
export function sumBets<K>(bets: Map<K, number>): number {
  let t = 0;
  bets.forEach((v) => (t += v));
  return t;
}
