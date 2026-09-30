import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe } from '../../items/cards';
import { JOB_PAYTABLE, jacksOrBetter } from '../../items/rules';
import type { Card, Outcome } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, resultLine, setResult, sleep } from './common';

/**
 * Jacks or Better (9/6 full pay): deal five, hold any, draw once. Paytable per coin,
 * royal flush 800.
 */
export function openVideoPoker(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let bet = chips[0];
  let phase: 'bet' | 'hold' | 'busy' = 'bet';
  let deck = new Shoe(1);
  let hand: Card[] = [];
  let held = [false, false, false, false, false];
  const handEl = h('div', { class: 'vp-hand' });
  const pay = h('div', { class: 'vp-pay' });
  const result = resultLine();
  const betLabel = h('b', { text: formatMoney(bet) });
  const chipsEl = chipRow(chips, () => bet, (v) => {
    if (phase === 'bet') {
      bet = v;
      betLabel.textContent = formatMoney(bet);
      renderPay();
    }
  }, { min: s.min, bank: () => s.bank });
  const main = h('button', { class: 'btn gold tg-main', text: 'Deal' });

  const renderPay = (hit = '') => {
    pay.replaceChildren(...JOB_PAYTABLE.flatMap((l) => [
      h('span', { class: l.name === hit ? 'hit' : '', text: l.name }),
      h('span', { class: l.name === hit ? 'hit' : '', text: formatMoney(bet * l.pays) }),
    ]));
  };
  const renderHand = (fresh: boolean[] = []) => {
    handEl.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
      const c = hand[i] ?? null;
      const el = h('div', {
        class: 'vp-card',
        onClick: () => {
          if (phase !== 'hold') return;
          held[i] = !held[i];
          audio.play('click');
          renderHand();
        },
      }, h('span', { class: 'held', text: held[i] ? 'HELD' : '' }), cardEl(c, fresh[i] ? i * 90 : 0));
      if (!fresh[i]) (el.lastChild as HTMLElement).style.animation = 'none';
      return el;
    }));
  };

  main.addEventListener('click', async () => {
    if (s.closed) return;
    if (phase === 'bet') {
      if (!s.bet(bet)) return;
      deck = new Shoe(1);
      hand = [deck.draw(), deck.draw(), deck.draw(), deck.draw(), deck.draw()];
      held = [false, false, false, false, false];
      renderPay();
      setResult(result, jacksOrBetter(hand).pays ? `Dealt ${jacksOrBetter(hand).name}. Hold your cards` : 'Click cards to hold them, then draw');
      audio.play('cards');
      renderHand([true, true, true, true, true]);
      phase = 'hold';
      main.textContent = 'Draw';
      chipsEl.classList.add('disabled');
      return;
    }
    if (phase !== 'hold') return;
    phase = 'busy';
    const fresh = held.map((x) => !x);
    hand = hand.map((c, i) => (held[i] ? c : deck.draw()));
    audio.play('cards');
    renderHand(fresh);
    const r = jacksOrBetter(hand);
    const payout = bet * r.pays;
    const oc: Outcome = {
      bet, payout, label: r.name, tier: r.pays >= 800 ? 'jackpot' : r.pays >= 25 ? 'big' : r.pays ? 'win' : 'lose',
      visual: { kind: 'slot', symbols: r.pays ? [5, 5, 5] : [2, 3, 4] },
    };
    s.spinMachine(oc, 0.9);
    await sleep(700);
    s.settle(bet, payout);
    renderPay(r.pays ? r.name : '');
    setResult(result, r.pays ? `${r.name}! +${formatMoney(payout - bet)}` : `${r.name}  −${formatMoney(bet)}`, r.pays >= 800 ? 'jackpot' : r.pays >= 25 ? 'big' : r.pays > 1 ? 'win' : r.pays ? '' : 'lose');
    held = [false, false, false, false, false];
    phase = 'bet';
    main.textContent = 'Deal';
    chipsEl.classList.remove('disabled');
  });

  renderPay();
  renderHand();
  const body = h('div', { class: 'mg tg' },
    s.head,
    pay,
    h('div', { class: 'felt vp-felt' }, handEl, h('div', { class: 'felt-rule', text: 'JACKS OR BETTER · 9/6 FULL PAY · CLICK A CARD TO HOLD' })),
    result,
    h('div', { class: 'tg-betline' }, 'Bet ', betLabel),
    chipsEl,
    main,
  );
  ctx.modals.open('Video Poker', body, {
    cls: 'minigame table-game',
    onClose: () => {
      // Walking away mid-hand plays the cards as dealt.
      if (phase === 'hold' && !s.closed) s.settle(bet, bet * jacksOrBetter(hand).pays);
      s.dispose();
    },
  });
}
