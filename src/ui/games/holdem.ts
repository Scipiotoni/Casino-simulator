import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bestHand, compareScores, dealerQualifies, holdemAntePays } from '../../items/cards';
import type { Card } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

const shoe = new Shoe(1);

/**
 * Casino Hold'em against the dealer: ante, see your two cards and the flop, then call
 * (twice the ante) or fold. The dealer needs a pair of fours to play.
 */
export function openHoldem(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let ante = chips[0];
  let busy = false;
  const dealerRow = h('div', { class: 'pc-row' });
  const boardRow = h('div', { class: 'pc-row board' });
  const playerRow = h('div', { class: 'pc-row' });
  const dealerHand = h('span', { class: 'bj-total' });
  const playerHand = h('span', { class: 'bj-total' });
  const result = resultLine();
  const anteLabel = h('b', { text: formatMoney(ante) });
  const chipsEl = chipRow(chips, () => ante, (v) => {
    if (!busy) {
      ante = v;
      anteLabel.textContent = formatMoney(ante);
    }
  }, { min: s.min, bank: () => s.bank });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const callBtn = h('button', { class: 'btn gold', text: 'Call' });
  const foldBtn = h('button', { class: 'btn danger', text: 'Fold' });
  const actions = h('div', { class: 'tg-actions' }, foldBtn, callBtn);
  let hole: Card[] = [];
  let dealer: Card[] = [];
  let board: Card[] = [];
  let dealerEls: HTMLElement[] = [];
  let boardEls: HTMLElement[] = [];

  const setMode = (m: 'bet' | 'decide' | 'wait') => {
    dealBtn.hidden = m !== 'bet';
    actions.hidden = m !== 'decide';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    callBtn.textContent = `Call ${formatMoney(ante * 2)}`;
  };

  const showdown = async (called: boolean) => {
    setMode('wait');
    // Turn and river
    for (let i = 3; i < 5; i++) {
      reveal(boardEls[i], board[i]);
      audio.play('cards', { volume: 0.6 });
      await sleep(450);
    }
    dealerEls.forEach((el, i) => reveal(el, dealer[i]));
    audio.play('cards');
    const me = bestHand([...hole, ...board]);
    const dh = bestHand([...dealer, ...board]);
    playerHand.textContent = me.name;
    dealerHand.textContent = dh.name;
    await sleep(500);
    const stake = called ? ante * 3 : ante;
    if (!called) {
      s.settle(stake, 0);
      setResult(result, `Folded. Dealer had ${dh.name.toLowerCase()}.`, 'lose');
    } else if (!dealerQualifies(dh)) {
      const pays = holdemAntePays(me.cat);
      const payout = ante * (1 + pays) + ante * 2;
      s.settle(stake, payout);
      setResult(result, `Dealer doesn't qualify. Ante pays ${pays}:1  +${formatMoney(payout - stake)}`, pays >= 3 ? 'big' : 'win');
    } else {
      const c = compareScores(me, dh);
      if (c > 0) {
        const pays = holdemAntePays(me.cat);
        const payout = ante * (1 + pays) + ante * 4;
        s.settle(stake, payout);
        setResult(result, `${me.name} wins!  +${formatMoney(payout - stake)}`, pays >= 3 ? 'big' : 'win');
      } else if (c === 0) {
        s.settle(stake, stake);
        setResult(result, 'Split pot: push');
      } else {
        s.settle(stake, 0);
        setResult(result, `Dealer's ${dh.name.toLowerCase()} wins  −${formatMoney(stake)}`, 'lose');
      }
    }
    busy = false;
    setMode('bet');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (s.bank < ante * 3) {
      audio.play('error');
      setResult(result, `You need ${formatMoney(ante * 3)} to cover the ante and a call.`, 'lose');
      return;
    }
    if (!s.bet(ante)) return;
    busy = true;
    setMode('wait');
    setResult(result, '');
    shoe.shuffle();
    hole = [shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw()];
    board = [shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw()];
    playerRow.replaceChildren(...hole.map((c, i) => cardEl(c, i * 120)));
    dealerEls = dealer.map((_, i) => cardEl(null, 200 + i * 120));
    dealerRow.replaceChildren(...dealerEls);
    boardEls = board.map((c, i) => cardEl(i < 3 ? c : null, 400 + i * 120));
    boardRow.replaceChildren(...boardEls);
    audio.play('cards');
    dealerHand.textContent = '';
    playerHand.textContent = bestHand([...hole, ...board.slice(0, 3)]).name;
    await sleep(900);
    setMode('decide');
  });
  callBtn.addEventListener('click', () => {
    if (!busy) return;
    if (!s.bet(ante * 2)) return;
    void showdown(true);
  });
  foldBtn.addEventListener('click', () => {
    if (busy) void showdown(false);
  });

  setMode('bet');
  const pay = h('details', { class: 'mg-pay' },
    h('summary', { text: 'Ante paytable' }),
    h('div', { class: 'mg-pay-grid' },
      ...[['Royal flush', '100:1'], ['Straight flush', '20:1'], ['Four of a kind', '10:1'], ['Full house', '3:1'], ['Flush', '2:1'], ['Straight or less', '1:1']].map(([a, b]) =>
        h('div', { class: 'mg-pay-row' }, h('span', { text: a }), h('b', { text: b }))),
    ),
    h('p', { class: 'muted small', text: 'The call pays 1:1 when you beat a qualifying dealer, and pushes when the dealer doesn’t qualify.' }),
  );
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt poker-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dealerHand),
      dealerRow,
      boardRow,
      playerRow,
      h('div', { class: 'bj-label' }, 'You ', playerHand),
    ),
    result,
    h('div', { class: 'tg-betline' }, 'Ante ', anteLabel),
    chipsEl,
    dealBtn,
    actions,
    pay,
  );
  ctx.modals.open(`Casino Hold'em`, body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
