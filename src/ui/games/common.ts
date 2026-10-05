import type { Game } from '../../game/game';
import type { Modals } from '../modals';
import type { PlacedItem } from '../../items/placedItem';
import type { Card, Outcome, SharedVisual } from '../../items/types';
import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { RANKS, SUITS } from '../../items/cards';
import { lessonFor, openLesson } from './lessons';
import { cardSvg } from './cardArt';

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
    const kind = ctx.item.def.kind;
    const learn = lessonFor(kind)
      ? h('button', { class: 'btn small tg-learn', text: '📖 How to play', onClick: () => openLesson(ctx.modals, kind) })
      : null;
    this.head = ctx.practice
      ? h('div', { class: 'tg-head practice' },
        h('span', { class: 'tg-where', text: '🎲 Practice play: pretend chips, no real money' }),
        h('span', {}, 'Chips ', this.bankEl, ' ', this.netEl, ' ', refill, ' ', learn),
      )
      : h('div', { class: 'tg-head' },
        h('span', { class: 'tg-where', text: `${ctx.game.hereName} · min ${formatMoney(this.min)} · no max bet` }),
        h('span', {}, 'Bank ', this.bankEl, ' ', this.netEl, ' ', learn),
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

/** Casino chip colours by denomination: [value, body, edge spots, ink]. */
const CHIP_COLORS: [number, string, string, string][] = [
  [1, '#f2efe6', '#1f4fbf', '#17151f'],
  [2, '#ffd24a', '#7a4a1c', '#17151f'],
  [5, '#c8102e', '#fffdf8', '#fff'],
  [10, '#1f4fbf', '#fffdf8', '#fff'],
  [25, '#1e7a46', '#fffdf8', '#fff'],
  [50, '#e8761e', '#fffdf8', '#fff'],
  [100, '#17151f', '#fffdf8', '#fff'],
  [250, '#ff6fb5', '#fffdf8', '#fff'],
  [500, '#6a2cc2', '#fffdf8', '#fff'],
  [1000, '#f0b400', '#17151f', '#17151f'],
  [2500, '#2fb8c9', '#fffdf8', '#fff'],
  [5000, '#7a4a2a', '#ffd24a', '#fff'],
  [10000, '#8c9aa8', '#17151f', '#17151f'],
  [25000, '#0f8a3c', '#ffd24a', '#fff'],
  [100000, '#c8102e', '#ffd24a', '#fff'],
];

/** The colours of the chip for this value (the nearest denomination at or below). */
export function chipStyle(v: number): string {
  let c = CHIP_COLORS[0];
  for (const x of CHIP_COLORS) if (v >= x[0]) c = x;
  return `--c:${c[1]};--e:${c[2]};--i:${c[3]}`;
}

/** Short chip label: 25, 1K, 2.5K, 100K. */
export function chipText(v: number): string {
  if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
  if (v >= 1000) return `${Math.round(v / 100) / 10}K`;
  return String(Math.round(v * 100) / 100);
}

const STACK_DENOMS = [100000, 25000, 10000, 5000, 1000, 500, 100, 25, 5, 1];

/**
 * The chips riding on a bet, stacked the way a dealer would make them up (biggest at the
 * bottom), with the total on a tag. Up to six chips are drawn.
 */
export function chipStack(amount: number, cls = ''): HTMLElement {
  const chips: number[] = [];
  let left = Math.floor(amount);
  for (const d of STACK_DENOMS) {
    while (left >= d && chips.length < 40) {
      chips.push(d);
      left -= d;
    }
  }
  if (!chips.length) chips.push(1);
  const shown = chips.slice(0, 6);
  const el = h('span', { class: `cstack ${cls}`, 'aria-label': formatMoney(amount) },
    ...shown.map((d, i) => h('i', { class: 'cs-chip', style: `${chipStyle(d)};--k:${i}` })),
    h('b', { class: 'cs-tag', text: chipText(amount) }));
  el.style.setProperty('--n', String(shown.length));
  return el;
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
      ...values.map((v) =>
        h('button', {
          class: `tg-chip${v === get() ? ' on' : ''}`, style: chipStyle(v), text: chipText(v), 'aria-label': `Chip ${formatMoney(v)}`,
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

/** A playing card (face down when `card` is null), dealt in from the shoe. */
export function cardEl(card: Card | null, delay = 0): HTMLElement {
  const el = h('div', { class: `pc${card ? '' : ' back'}`, 'aria-label': card ? `${RANKS[card.rank]}${SUITS[card.suit]}` : 'Face-down card', role: 'img' });
  el.innerHTML = cardSvg(card);
  el.style.animationDelay = `${delay}ms`;
  return el;
}

/** Turn a face-down card face up in place: it turns on its edge, then shows its face. */
export function reveal(el: HTMLElement, card: Card): void {
  const fresh = cardEl(card);
  fresh.classList.add('flip');
  if (!el.isConnected) return;
  el.classList.add('flip-out');
  window.setTimeout(() => {
    if (el.isConnected) el.replaceWith(fresh);
  }, 140);
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
    amount ? chipStack(amount) : null);
}

/** Total of all the chips in a bet map. */
export function sumBets<K>(bets: Map<K, number>): number {
  let t = 0;
  bets.forEach((v) => (t += v));
  return t;
}

/**
 * A betting circle printed on the felt: click it to add the chip you're holding,
 * right-click to take one back. `set()` shows what's riding on it.
 */
export function betCircle(label: string, sub: string, cls = ''): { el: HTMLButtonElement; set: (amount: number) => void } {
  const stack = h('span', { class: 'bc-stack' });
  const el = h('button', { class: `bet-circle ${cls}` }, h('span', { class: 'bc-label', text: label }), sub ? h('small', { class: 'bc-sub', text: sub }) : null, stack);
  return {
    el,
    set: (amount: number) => {
      stack.replaceChildren(...(amount > 0 ? [chipStack(amount)] : []));
      el.classList.toggle('on', amount > 0);
    },
  };
}

/** Where the cards come from and go: the shoe (with the cut card) and the discard tray. */
export function shoeView(shoe: { remaining: number; size: number; dealt: number; cutAt: number }): { el: HTMLElement; update: () => void } {
  const tray = h('div', { class: 'sv-tray' }, h('i'));
  const box = h('div', { class: 'sv-shoe' }, h('i', { class: 'sv-cards' }), h('i', { class: 'sv-cut' }));
  const label = h('small', { class: 'sv-label' });
  const el = h('div', { class: 'sv' }, tray, box, label);
  const update = () => {
    const left = shoe.remaining / shoe.size;
    (box.firstChild as HTMLElement).style.width = `${Math.max(2, left * 100)}%`;
    (box.lastChild as HTMLElement).style.left = `${(shoe.cutAt / shoe.size) * 100}%`;
    (box.lastChild as HTMLElement).hidden = !shoe.cutAt || shoe.remaining <= shoe.cutAt;
    (tray.firstChild as HTMLElement).style.height = `${Math.min(100, (shoe.dealt / shoe.size) * 100)}%`;
    label.textContent = `${(shoe.remaining / 52).toFixed(1)} decks left`;
  };
  update();
  return { el, update };
}

let arcSeq = 0;

/** Lettering printed in an arc across the felt (like "BLACKJACK PAYS 3 TO 2"). */
export function feltArc(lines: { text: string; size?: number; cls?: string }[]): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const H = 22 + lines.length * 20;
  svg.setAttribute('viewBox', `0 0 420 ${H}`);
  svg.setAttribute('class', 'felt-arc');
  lines.forEach((ln, i) => {
    const id = `fa${++arcSeq}`;
    const y = 8 + i * 20;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('id', id);
    path.setAttribute('d', `M 10 ${y} Q 210 ${y + 36} 410 ${y}`);
    path.setAttribute('fill', 'none');
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('class', ln.cls ?? '');
    text.setAttribute('font-size', String(ln.size ?? 15));
    const tp = document.createElementNS(NS, 'textPath');
    tp.setAttribute('href', `#${id}`);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');
    tp.textContent = ln.text;
    text.appendChild(tp);
    svg.append(path, text);
  });
  return svg as unknown as HTMLElement;
}
