import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe } from '../../items/cards';
import { JOB_PAYTABLE, jacksOrBetter, vpPays } from '../../items/rules';
import type { Card, Outcome } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, sleep } from './common';

/**
 * A Jacks or Better (9/6 full pay) machine as it stands on the floor: pick the coin
 * denomination, bet one to five coins (the royal jumps from 1,000 to 4,000 coins on the
 * fifth), deal five, hold any, draw once. Credits, bet and win meters count in coins;
 * the paytable glass lights the column you're playing and the hand you made.
 */
export function openVideoPoker(ctx: GameCtx): void {
  const s = new Session(ctx);
  const denoms = chipValues(s.min);
  let denom = denoms[0];
  let coins = 5;
  let phase: 'bet' | 'hold' | 'busy' = 'bet';
  let deck = new Shoe(1);
  let hand: Card[] = [];
  let held = [false, false, false, false, false];
  let lastWin = 0;
  /** What you're owed if you walk away mid-hand (the cards play as they stand). */
  let owed: { stake: number; payout: number } | null = null;
  const handEl = h('div', { class: 'vp-hand' });
  const pay = h('div', { class: 'vp-paytable' });
  const msg = h('div', { class: 'vp-msg' });
  const credits = h('b');
  const betM = h('b');
  const winM = h('b');
  const meters = h('div', { class: 'vp-meters' },
    h('span', {}, 'WIN ', winM), h('span', {}, 'BET ', betM), h('span', {}, 'CREDITS ', credits));
  const denomEl = h('span', { class: 'vp-denom' });

  const renderMeters = (win = lastWin) => {
    credits.textContent = Math.floor(s.bank / denom).toLocaleString();
    betM.textContent = String(coins);
    winM.textContent = win ? win.toLocaleString() : '0';
    denomEl.textContent = formatMoney(denom);
  };
  const renderPay = (hit = '') => {
    pay.replaceChildren(
      ...JOB_PAYTABLE.map((l) => h('div', { class: `vp-row${l.name === hit ? ' hit' : ''}` },
        h('span', { class: 'vp-name', text: l.name.toUpperCase() }),
        ...[1, 2, 3, 4, 5].map((c) => h('span', { class: `vp-col${c === coins ? ' on' : ''}`, text: String(vpPays(l.name, c)) })))),
    );
  };
  const renderHand = (fresh: boolean[] = []) => {
    handEl.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
      const c = hand[i] ?? null;
      const card = cardEl(c, fresh[i] ? i * 110 : 0);
      if (!fresh[i]) card.style.animation = 'none';
      return h('div', {
        class: `vp-card${held[i] ? ' held' : ''}`,
        onClick: () => toggle(i),
      }, h('span', { class: 'vp-held', text: 'HELD' }), card, h('button', { class: 'vp-hold', text: 'HOLD', onClick: (e: MouseEvent) => { e.stopPropagation(); toggle(i); } }));
    }));
  };
  const toggle = (i: number) => {
    if (phase !== 'hold') return;
    held[i] = !held[i];
    audio.play('click');
    renderHand();
  };
  const setMsg = (t: string, cls = '') => {
    msg.textContent = t;
    msg.className = `vp-msg ${cls}`;
  };

  const deal = async () => {
    if (s.closed || phase === 'busy') return;
    if (phase === 'bet') {
      if (!s.bet(denom * coins)) return;
      phase = 'busy';
      lastWin = 0;
      deck = new Shoe(1);
      hand = [deck.draw(), deck.draw(), deck.draw(), deck.draw(), deck.draw()];
      held = [false, false, false, false, false];
      renderPay();
      renderMeters();
      audio.play('cards');
      renderHand([true, true, true, true, true]);
      owed = { stake: denom * coins, payout: denom * vpPays(jacksOrBetter(hand).name, coins) };
      await sleep(650);
      const r = jacksOrBetter(hand);
      setMsg(r.pays ? r.name.toUpperCase() : 'HOLD CARDS, THEN DRAW', r.pays ? 'hit' : '');
      if (r.pays) renderPay(r.name);
      phase = 'hold';
      dealBtn.textContent = 'DRAW';
      return;
    }
    phase = 'busy';
    const fresh = held.map((x) => !x);
    hand = hand.map((c, i) => (held[i] ? c : deck.draw()));
    audio.play('cards');
    renderHand(fresh);
    const r = jacksOrBetter(hand);
    const won = vpPays(r.name, coins);
    const payout = won * denom;
    owed = { stake: denom * coins, payout };
    const oc: Outcome = {
      bet: denom * coins, payout, label: r.name, tier: r.name === 'Royal Flush' ? 'jackpot' : won >= coins * 25 ? 'big' : won ? 'win' : 'lose',
      visual: { kind: 'slot', symbols: won ? [5, 5, 5] : [2, 3, 4] },
    };
    s.spinMachine(oc, 0.9);
    await sleep(700);
    renderPay(won ? r.name : '');
    if (won) {
      setMsg(`${r.name.toUpperCase()} · WIN ${won.toLocaleString()}`, 'hit');
      // The win meter counts up, coin by coin.
      const steps = Math.min(30, won);
      for (let k = 1; k <= steps; k++) {
        renderMeters(Math.round((won * k) / steps));
        audio.play('coin', { volume: 0.25, pitch: 1 + k / steps });
        await sleep(40);
      }
    } else setMsg('GAME OVER');
    if (s.closed) return;
    owed = null;
    s.settle(denom * coins, payout);
    lastWin = won;
    renderMeters();
    held = [false, false, false, false, false];
    phase = 'bet';
    dealBtn.textContent = 'DEAL';
  };

  const dealBtn = h('button', { class: 'vp-btn deal', text: 'DEAL', onClick: () => void deal() });
  const betOne = h('button', {
    class: 'vp-btn', text: 'BET ONE',
    onClick: () => {
      if (phase !== 'bet') return;
      coins = coins >= 5 ? 1 : coins + 1;
      audio.play('coin', { volume: 0.4 });
      renderPay();
      renderMeters();
    },
  });
  const betMax = h('button', {
    class: 'vp-btn', text: 'BET MAX',
    onClick: () => {
      if (phase !== 'bet') return;
      coins = 5;
      renderPay();
      renderMeters();
      void deal();
    },
  });
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = Number(e.key);
    if (k >= 1 && k <= 5) toggle(k - 1);
    else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      void deal();
    }
  };
  window.addEventListener('keydown', onKey);

  renderPay();
  renderHand();
  renderMeters();
  setMsg('PLAY 5 COINS FOR THE 4000-COIN ROYAL');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'vp-machine' },
      h('div', { class: 'vp-top' }, h('span', { class: 'vp-title', text: 'JACKS OR BETTER' }), denomEl),
      pay,
      h('div', { class: 'vp-screen' }, msg, handEl, meters),
      h('div', { class: 'vp-buttons' }, betOne, betMax, dealBtn),
    ),
    h('div', { class: 'tg-betline', text: 'Coin value (denomination)' }),
    chipRow(denoms, () => denom, (v) => {
      if (phase === 'bet') {
        denom = v;
        renderMeters();
      }
    }, { min: s.min, bank: () => s.bank }),
    h('p', { class: 'muted small', text: 'Click a card (or press 1–5) to hold it. Space deals and draws. 9/6 full pay: 99.5% return with perfect play.' }),
  );
  ctx.modals.open('Video Poker', body, {
    cls: 'minigame table-game',
    onClose: () => {
      window.removeEventListener('keydown', onKey);
      // Walking away mid-hand plays the cards as they stand.
      if (owed && !s.closed) s.settle(owed.stake, owed.payout);
      owed = null;
      s.dispose();
    },
  });
}
