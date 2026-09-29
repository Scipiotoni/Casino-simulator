import type { Game } from '../../game/game';
import type { Modals } from '../modals';
import type { PlacedItem } from '../../items/placedItem';
import type { Card } from '../../items/types';
import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { RANKS, SUITS, isRed } from '../../items/cards';

export interface GameCtx {
  game: Game;
  modals: Modals;
  item: PlacedItem;
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

  constructor(readonly ctx: GameCtx) {
    this.head = h('div', { class: 'tg-head' },
      h('span', { class: 'tg-where', text: `${ctx.game.hereName} · min ${formatMoney(this.min)} · no max bet` }),
      h('span', {}, 'Bank ', this.bankEl, ' ', this.netEl),
    );
    this.offMoney = ctx.game.events.on('money', () => this.refresh());
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
    return this.ctx.game.money;
  }

  refresh(): void {
    this.bankEl.textContent = formatMoney(Math.floor(this.ctx.game.money));
    this.netEl.textContent = this.net ? `(session ${this.net >= 0 ? '+' : ''}${formatMoney(this.net)})` : '';
    this.netEl.className = `tg-net ${this.net > 0 ? 'pos' : this.net < 0 ? 'neg' : ''}`;
  }

  /** Put chips down. Returns false (and complains) if you can't cover it. */
  bet(amount: number): boolean {
    if (this.closed) return false;
    if (!this.ctx.game.visitorBet(amount)) {
      audio.play('error');
      this.ctx.game.notify('Not enough cash in the bank for that bet!', 'bad');
      return false;
    }
    audio.play('chips');
    return true;
  }

  /** `stake` is everything you put down this round, `payout` everything handed back. */
  settle(stake: number, payout: number): void {
    if (this.closed) return;
    this.net += payout - stake;
    this.ctx.game.visitorSettle(stake, payout, this.ctx.item);
    const d = payout - stake;
    if (d > 0) audio.play(d >= stake * 5 ? 'bigwin' : 'win');
    this.refresh();
    if (this.ctx.game.checkWinnerLimit()) {
      this.closed = true;
      this.ctx.modals.closeAll();
    }
  }

  dispose(): void {
    this.closed = true;
    this.offMoney();
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
