import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bjTotal, dealerShouldHit, isBlackjack } from '../../items/cards';
import type { Card, Outcome } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

const shoe = new Shoe(6);

interface Hand {
  cards: Card[];
  stake: number;
  done: boolean;
  surrendered: boolean;
  /** Split aces get exactly one card each. */
  splitAces: boolean;
  box: HTMLElement;
  row: HTMLElement;
  total: HTMLElement;
}

/** Ten-value cards split with each other only when the ranks match (like real tables). */
const MAX_HANDS = 4;

/**
 * Las Vegas blackjack: 6 decks, dealer peeks for blackjack and stands on all 17s,
 * blackjack pays 3:2, insurance 2:1, double on any two cards (also after a split),
 * split up to four hands (aces once, one card each) and late surrender.
 */
export function openBlackjack(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let bet = chips[Math.min(1, chips.length - 1)];
  let busy = false;
  const dealerRow = h('div', { class: 'pc-row' });
  const handsEl = h('div', { class: 'bj-hands' });
  const dealerTotal = h('span', { class: 'bj-total' });
  const result = resultLine();
  const betLabel = h('b', { text: formatMoney(bet) });
  const chipsEl = chipRow(chips, () => bet, (v) => {
    if (!busy) {
      bet = v;
      betLabel.textContent = formatMoney(bet);
    }
  }, { min: s.min, bank: () => s.bank });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const hitBtn = h('button', { class: 'btn', text: 'Hit' });
  const standBtn = h('button', { class: 'btn', text: 'Stand' });
  const dblBtn = h('button', { class: 'btn', text: 'Double' });
  const splitBtn = h('button', { class: 'btn', text: 'Split' });
  const surBtn = h('button', { class: 'btn', text: 'Surrender' });
  const actions = h('div', { class: 'tg-actions' }, hitBtn, standBtn, dblBtn, splitBtn, surBtn);
  const insBtn = h('button', { class: 'btn gold', text: 'Take insurance' });
  const noInsBtn = h('button', { class: 'btn', text: 'No insurance' });
  const insRow = h('div', { class: 'tg-actions' }, insBtn, noInsBtn);
  let hands: Hand[] = [];
  let active = 0;
  let dealer: Card[] = [];
  let holeEl: HTMLElement | null = null;
  let insurance = 0;
  let insResolve: ((take: boolean) => void) | null = null;

  const hand = () => hands[active];
  const setMode = (m: 'bet' | 'play' | 'wait' | 'insurance') => {
    dealBtn.hidden = m !== 'bet';
    actions.hidden = m !== 'play';
    insRow.hidden = m !== 'insurance';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    if (m === 'play') {
      const hd = hand();
      const two = hd.cards.length === 2;
      dblBtn.disabled = !(two && !hd.splitAces && s.bank >= hd.stake);
      splitBtn.disabled = !(two && hands.length < MAX_HANDS && hd.cards[0].rank === hd.cards[1].rank && !hd.splitAces && s.bank >= hd.stake);
      surBtn.disabled = !(two && hands.length === 1);
      hitBtn.disabled = hd.splitAces;
    }
    hands.forEach((hd, i) => hd.box.classList.toggle('active', m === 'play' && i === active && hands.length > 1));
  };
  const showTotals = (hideHole: boolean) => {
    for (const hd of hands) {
      const p = bjTotal(hd.cards);
      hd.total.textContent = hd.surrendered ? 'Surrendered' : `${p.soft && p.total < 21 ? 'Soft ' : ''}${p.total}${hd.stake > 0 ? ` · ${formatMoney(hd.stake)}` : ''}`;
    }
    dealerTotal.textContent = hideHole ? String(bjTotal([dealer[0]]).total) : String(bjTotal(dealer).total);
  };
  const addCard = (row: HTMLElement, c: Card | null, delay = 0) => {
    const el = cardEl(c, delay);
    row.appendChild(el);
    audio.play('cards', { volume: 0.6 });
    return el;
  };
  const newHand = (cards: Card[], stake: number, splitAces = false): Hand => {
    const row = h('div', { class: 'pc-row' });
    const total = h('span', { class: 'bj-total' });
    const box = h('div', { class: 'bj-hand' }, row, h('div', { class: 'bj-label' }, hands.length ? `Hand ${hands.length + 1} ` : 'You ', total));
    const hd: Hand = { cards, stake, done: false, surrendered: false, splitAces, box, row, total };
    for (const c of cards) addCard(row, c);
    return hd;
  };
  const flipHole = () => {
    if (holeEl) reveal(holeEl, dealer[1]);
    holeEl = null;
    showTotals(false);
  };

  /** Show the finished round on the real table and pay everything out. */
  const finish = (lines: string[], staked: number, paid: number) => {
    const main = hands[0];
    const oc: Outcome = { bet: staked, payout: paid, label: '', tier: paid > staked ? 'win' : paid === staked ? 'push' : 'lose', visual: { kind: 'blackjack', player: main.cards, dealer } };
    s.animate({ kind: 'blackjack', dealer }, 2.2, oc);
    s.settle(staked, paid);
    const net = paid - staked;
    const big = hands.length === 1 && isBlackjack(main.cards) && net > 0;
    setResult(result, `${lines.join(' · ')}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`.trim(), big ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    setMode('bet');
  };

  const settleAll = async () => {
    setMode('wait');
    flipHole();
    const live = hands.filter((hd) => !hd.surrendered && bjTotal(hd.cards).total <= 21);
    if (live.length) {
      await sleep(500);
      while (dealerShouldHit(dealer)) {
        dealer.push(shoe.draw());
        addCard(dealerRow, dealer[dealer.length - 1]);
        showTotals(false);
        await sleep(550);
      }
    }
    const d = bjTotal(dealer).total;
    let staked = insurance;
    let paid = 0;
    const lines: string[] = [];
    hands.forEach((hd, i) => {
      const tag = hands.length > 1 ? `H${i + 1}: ` : '';
      const p = bjTotal(hd.cards).total;
      staked += hd.stake;
      if (hd.surrendered) {
        paid += Math.floor(hd.stake / 2);
        lines.push(`${tag}surrendered, half back`);
      } else if (p > 21) lines.push(`${tag}bust`);
      else if (d > 21) {
        paid += hd.stake * 2;
        lines.push(`${tag}dealer busts, win`);
      } else if (p > d) {
        paid += hd.stake * 2;
        lines.push(`${tag}your ${p} beats ${d}`);
      } else if (p === d) {
        paid += hd.stake;
        lines.push(`${tag}push at ${p}`);
      } else lines.push(`${tag}dealer's ${d} beats your ${p}`);
    });
    if (insurance) lines.push('insurance lost');
    finish(lines, staked, paid);
  };

  /** Move on to the next unfinished hand, or let the dealer play. */
  const advance = async () => {
    while (active < hands.length && hands[active].done) active++;
    if (active >= hands.length) return settleAll();
    const hd = hand();
    if (hd.cards.length === 1) {
      // Second card for a freshly split hand.
      await sleep(300);
      hd.cards.push(shoe.draw());
      addCard(hd.row, hd.cards[1]);
      showTotals(true);
      if (hd.splitAces || bjTotal(hd.cards).total === 21) {
        hd.done = true;
        await sleep(350);
        return advance();
      }
    }
    setMode('play');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!s.bet(bet)) return;
    busy = true;
    insurance = 0;
    setMode('wait');
    setResult(result, '');
    dealerRow.replaceChildren();
    handsEl.replaceChildren();
    hands = [];
    active = 0;
    const p = [shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw()];
    const first = newHand([], bet);
    hands.push(first);
    handsEl.appendChild(first.box);
    first.cards.push(p[0]);
    addCard(first.row, p[0]);
    await sleep(250);
    addCard(dealerRow, dealer[0]);
    await sleep(250);
    first.cards.push(p[1]);
    addCard(first.row, p[1]);
    await sleep(250);
    holeEl = addCard(dealerRow, null);
    showTotals(true);
    await sleep(300);
    const pBJ = isBlackjack(first.cards);
    // Insurance is offered when the dealer shows an ace.
    if (dealer[0].rank === 0 && !pBJ && s.bank >= Math.floor(bet / 2) && Math.floor(bet / 2) > 0) {
      setResult(result, 'Dealer shows an ace. Insurance pays 2 to 1.');
      setMode('insurance');
      const take = await new Promise<boolean>((r) => (insResolve = r));
      insResolve = null;
      if (take && s.bet(Math.floor(bet / 2))) insurance = Math.floor(bet / 2);
      setMode('wait');
      setResult(result, '');
    }
    // The dealer peeks under an ace or a ten.
    const dBJ = isBlackjack(dealer);
    if (pBJ || dBJ) {
      flipHole();
      await sleep(400);
      const insPaid = dBJ ? insurance * 3 : 0;
      const insLine = insurance ? (dBJ ? 'insurance pays 2:1' : 'insurance lost') : '';
      if (pBJ && dBJ) return finish(['Both have blackjack: push', insLine].filter(Boolean), bet + insurance, bet + insPaid);
      if (pBJ) return finish(['BLACKJACK! Pays 3 to 2'], bet, Math.floor(bet * 2.5));
      return finish(['Dealer has blackjack', insLine].filter(Boolean), bet + insurance, insPaid);
    }
    if (insurance) {
      setResult(result, 'Dealer doesn’t have blackjack: insurance lost.', 'lose');
      // Insurance settles immediately when the dealer checks.
      s.settle(insurance, 0);
      insurance = 0;
    }
    setMode('play');
  });
  insBtn.addEventListener('click', () => insResolve?.(true));
  noInsBtn.addEventListener('click', () => insResolve?.(false));
  hitBtn.addEventListener('click', async () => {
    if (!busy || actions.hidden) return;
    const hd = hand();
    hd.cards.push(shoe.draw());
    addCard(hd.row, hd.cards[hd.cards.length - 1]);
    showTotals(true);
    const t = bjTotal(hd.cards).total;
    if (t >= 21) {
      hd.done = true;
      setMode('wait');
      await sleep(400);
      return advance();
    }
    setMode('play');
  });
  standBtn.addEventListener('click', () => {
    if (!busy || actions.hidden) return;
    hand().done = true;
    setMode('wait');
    void advance();
  });
  dblBtn.addEventListener('click', async () => {
    const hd = hand();
    if (!busy || actions.hidden || hd.cards.length !== 2) return;
    if (!s.bet(hd.stake)) return;
    hd.stake *= 2;
    hd.cards.push(shoe.draw());
    addCard(hd.row, hd.cards[2]);
    showTotals(true);
    hd.done = true;
    setMode('wait');
    await sleep(500);
    void advance();
  });
  splitBtn.addEventListener('click', async () => {
    const hd = hand();
    if (!busy || actions.hidden || hd.cards.length !== 2 || hd.cards[0].rank !== hd.cards[1].rank) return;
    if (!s.bet(hd.stake)) return;
    const aces = hd.cards[0].rank === 0;
    const moved = hd.cards.pop()!;
    hd.row.lastChild?.remove();
    hd.splitAces = aces;
    const other = newHand([moved], hd.stake, aces);
    hands.splice(active + 1, 0, other);
    hd.box.after(other.box);
    hands.forEach((x, i) => {
      const lbl = x.box.querySelector('.bj-label');
      if (lbl?.firstChild) lbl.firstChild.textContent = `Hand ${i + 1} `;
    });
    setMode('wait');
    await sleep(250);
    // Deal the second card to the current hand, then keep playing it.
    hd.cards.push(shoe.draw());
    addCard(hd.row, hd.cards[1]);
    showTotals(true);
    if (aces || bjTotal(hd.cards).total === 21) hd.done = true;
    void advance();
  });
  surBtn.addEventListener('click', () => {
    const hd = hand();
    if (!busy || actions.hidden || hands.length !== 1 || hd.cards.length !== 2) return;
    hd.surrendered = true;
    hd.done = true;
    void settleAll();
  });

  setMode('bet');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt bj-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dealerTotal),
      dealerRow,
      h('div', { class: 'felt-rule', text: 'BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON ALL 17s · INSURANCE PAYS 2 TO 1' }),
      handsEl,
    ),
    result,
    h('div', { class: 'tg-betline' }, 'Bet ', betLabel),
    chipsEl,
    dealBtn,
    insRow,
    actions,
  );
  ctx.modals.open(`${ctx.item.def.name}`, body, {
    cls: 'minigame table-game',
    onClose: () => {
      insResolve?.(false);
      // Leaving mid-hand forfeits whatever is on the table.
      if (busy && !s.closed) {
        const staked = hands.reduce((a, hd) => a + hd.stake, 0) + insurance;
        if (staked) s.settle(staked, 0);
      }
      s.dispose();
    },
  });
}
