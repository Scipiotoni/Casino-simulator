import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bjTotal, dealerShouldHit, isBlackjack } from '../../items/cards';
import type { Card } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

const shoe = new Shoe(6);

/** Blackjack: 6 decks, dealer stands on 17, blackjack pays 3:2, double on any first two cards. */
export function openBlackjack(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min, s.max);
  let bet = chips[Math.min(1, chips.length - 1)];
  let busy = false;
  const dealerRow = h('div', { class: 'pc-row' });
  const playerRow = h('div', { class: 'pc-row' });
  const dealerTotal = h('span', { class: 'bj-total' });
  const playerTotal = h('span', { class: 'bj-total' });
  const result = resultLine();
  const betLabel = h('b', { text: formatMoney(bet) });
  const chipsEl = chipRow(chips, () => bet, (v) => {
    if (!busy) {
      bet = v;
      betLabel.textContent = formatMoney(bet);
    }
  });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const hitBtn = h('button', { class: 'btn', text: 'Hit' });
  const standBtn = h('button', { class: 'btn', text: 'Stand' });
  const dblBtn = h('button', { class: 'btn', text: 'Double' });
  const actions = h('div', { class: 'tg-actions' }, hitBtn, standBtn, dblBtn);
  let player: Card[] = [];
  let dealer: Card[] = [];
  let stake = 0;
  let holeEl: HTMLElement | null = null;

  const setMode = (m: 'bet' | 'play' | 'wait') => {
    dealBtn.hidden = m !== 'bet';
    actions.hidden = m !== 'play';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    dblBtn.disabled = !(m === 'play' && player.length === 2 && s.bank >= stake);
  };
  const showTotals = (hideHole: boolean) => {
    const p = bjTotal(player);
    playerTotal.textContent = `${p.soft && p.total < 21 ? 'Soft ' : ''}${p.total}`;
    dealerTotal.textContent = hideHole ? String(bjTotal([dealer[0]]).total) : String(bjTotal(dealer).total);
  };
  const addCard = (row: HTMLElement, c: Card | null, delay = 0) => {
    const el = cardEl(c, delay);
    row.appendChild(el);
    audio.play('cards', { volume: 0.6 });
    return el;
  };

  const finish = async (outcome: 'win' | 'bj' | 'push' | 'lose', text: string) => {
    const payout = outcome === 'bj' ? Math.floor(stake * 2.5) : outcome === 'win' ? stake * 2 : outcome === 'push' ? stake : 0;
    s.settle(stake, payout);
    setResult(result, payout > stake ? `${text}  +${formatMoney(payout - stake)}` : payout === stake ? text : `${text}  −${formatMoney(stake)}`, outcome === 'bj' ? 'big' : outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : '');
    busy = false;
    setMode('bet');
  };

  const dealerPlay = async () => {
    setMode('wait');
    if (holeEl) reveal(holeEl, dealer[1]);
    holeEl = null;
    showTotals(false);
    await sleep(500);
    while (dealerShouldHit(dealer)) {
      dealer.push(shoe.draw());
      addCard(dealerRow, dealer[dealer.length - 1]);
      showTotals(false);
      await sleep(550);
    }
    const p = bjTotal(player).total;
    const d = bjTotal(dealer).total;
    if (d > 21) return finish('win', 'Dealer busts! You win');
    if (p > d) return finish('win', `${p} beats ${d}. You win`);
    if (p === d) return finish('push', `Push at ${p}`);
    return finish('lose', `Dealer's ${d} beats ${p}`);
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!s.bet(bet)) return;
    busy = true;
    stake = bet;
    setMode('wait');
    setResult(result, '');
    dealerRow.replaceChildren();
    playerRow.replaceChildren();
    player = [shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw()];
    addCard(playerRow, player[0]);
    await sleep(250);
    addCard(dealerRow, dealer[0]);
    await sleep(250);
    addCard(playerRow, player[1]);
    await sleep(250);
    holeEl = addCard(dealerRow, null);
    showTotals(true);
    await sleep(300);
    const pBJ = isBlackjack(player);
    const dBJ = isBlackjack(dealer);
    if (pBJ || dBJ) {
      if (holeEl) reveal(holeEl, dealer[1]);
      holeEl = null;
      showTotals(false);
      await sleep(400);
      if (pBJ && dBJ) return finish('push', 'Both have blackjack: push');
      if (pBJ) return finish('bj', 'BLACKJACK! Pays 3 to 2');
      return finish('lose', 'Dealer has blackjack');
    }
    setMode('play');
  });
  hitBtn.addEventListener('click', async () => {
    if (!busy) return;
    player.push(shoe.draw());
    addCard(playerRow, player[player.length - 1]);
    showTotals(true);
    dblBtn.disabled = true;
    const t = bjTotal(player).total;
    if (t > 21) {
      setMode('wait');
      await sleep(400);
      if (holeEl) reveal(holeEl, dealer[1]);
      holeEl = null;
      showTotals(false);
      return finish('lose', `Bust with ${t}`);
    }
    if (t === 21) void dealerPlay();
  });
  standBtn.addEventListener('click', () => {
    if (busy) void dealerPlay();
  });
  dblBtn.addEventListener('click', async () => {
    if (!busy || player.length !== 2) return;
    if (!s.bet(stake)) return;
    stake *= 2;
    player.push(shoe.draw());
    addCard(playerRow, player[2]);
    showTotals(true);
    setMode('wait');
    await sleep(500);
    if (bjTotal(player).total > 21) {
      if (holeEl) reveal(holeEl, dealer[1]);
      holeEl = null;
      showTotals(false);
      return finish('lose', `Doubled and bust`);
    }
    void dealerPlay();
  });

  setMode('bet');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt bj-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dealerTotal),
      dealerRow,
      h('div', { class: 'felt-rule', text: 'BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17' }),
      playerRow,
      h('div', { class: 'bj-label' }, 'You ', playerTotal),
    ),
    result,
    h('div', { class: 'tg-betline' }, 'Bet ', betLabel),
    chipsEl,
    dealBtn,
    actions,
  );
  ctx.modals.open(`${ctx.item.def.name}`, body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
