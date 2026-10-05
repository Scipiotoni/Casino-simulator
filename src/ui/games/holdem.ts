import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bestHand, compareScores, dealerQualifies, holdemAntePays } from '../../items/cards';
import { aaBonus } from '../../items/rules';
import type { Card } from '../../items/types';
import { type GameCtx, Session, betCircle, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

const shoe = new Shoe(1);

/**
 * Casino Hold'em against the dealer: ante (and the optional AA Bonus), see your two cards
 * and the flop, then call (twice the ante) or fold. The dealer needs a pair of fours to
 * play. A fresh single deck is shuffled for every hand, as on a real table.
 */
export function openHoldem(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const placed = { ante: 0, aa: 0 };
  let last: typeof placed | null = null;
  const dealerRow = h('div', { class: 'pc-row' });
  const boardRow = h('div', { class: 'pc-row board' });
  const playerRow = h('div', { class: 'pc-row' });
  const dealerHand = h('span', { class: 'bj-total' });
  const playerHand = h('span', { class: 'bj-total' });
  const result = resultLine();
  const sideNote = h('div', { class: 'bj-side-note' });
  const circles = {
    aa: betCircle('AA', 'BONUS', 'side'),
    ante: betCircle('ANTE', '', 'main'),
    call: betCircle('CALL', '2× ante', 'side call'),
  };
  circles.call.el.disabled = true;
  const chipsEl = chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const callBtn = h('button', { class: 'btn gold', text: 'Call' });
  const foldBtn = h('button', { class: 'btn danger', text: 'Fold' });
  const actions = h('div', { class: 'tg-actions' }, foldBtn, callBtn);
  const betRow = h('div', { class: 'tg-actions' },
    h('button', { class: 'btn', text: 'Clear', onClick: () => { if (!busy) { placed.ante = placed.aa = 0; show(); } } }),
    h('button', { class: 'btn', text: 'Rebet', onClick: () => { if (!busy && last) { Object.assign(placed, last); audio.play('chips', { volume: 0.5 }); show(); } } }));
  let hole: Card[] = [];
  let dealer: Card[] = [];
  let board: Card[] = [];
  let els = new Map<Card, HTMLElement>();
  let dealerEls: HTMLElement[] = [];
  let boardEls: HTMLElement[] = [];
  /** Settled if you walk away: a fold before you call, the real result after. */
  let pending: { stake: number; payout: number } | null = null;

  const show = () => {
    circles.aa.set(placed.aa);
    circles.ante.set(placed.ante);
  };
  for (const k of ['aa', 'ante'] as const) {
    circles[k].el.addEventListener('click', () => {
      if (busy) return;
      placed[k] += chip;
      audio.play('chips', { volume: 0.5 });
      show();
    });
    circles[k].el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (busy) return;
      placed[k] = Math.max(0, placed[k] - chip);
      show();
    });
  }
  const setMode = (m: 'bet' | 'decide' | 'wait') => {
    dealBtn.hidden = m !== 'bet';
    betRow.hidden = m !== 'bet';
    actions.hidden = m !== 'decide';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    circles.aa.el.disabled = circles.ante.el.disabled = m !== 'bet';
    callBtn.textContent = `Call ${formatMoney(placed.ante * 2)}`;
  };
  const setSide = (text: string, kind: '' | 'win' | 'lose' = '') => {
    sideNote.textContent = text;
    sideNote.className = `bj-side-note ${kind}`;
  };
  /** Light up the five cards that make a hand. */
  const mark = (cards: Card[]) => {
    for (const [c, el] of els) el.classList.toggle('win', cards.includes(c));
  };

  /** What the hand comes to (all the cards are dealt already, just not shown). */
  const outcome = (called: boolean) => {
    const ante = placed.ante;
    const me = bestHand([...hole, ...board]);
    const dh = bestHand([...dealer, ...board]);
    const stake = called ? ante * 3 : ante;
    if (!called) return { me, dh, stake, payout: 0, show: dh.cards, text: `Folded. The dealer had ${dh.name.toLowerCase()}.`, kind: 'lose' as const };
    if (!dealerQualifies(dh)) {
      const pays = holdemAntePays(me.cat);
      const payout = ante * (1 + pays) + ante * 2;
      return { me, dh, stake, payout, show: me.cards, text: `Dealer doesn't qualify. Ante pays ${pays}:1, call pushes  +${formatMoney(payout - stake)}`, kind: pays >= 3 ? 'big' as const : 'win' as const };
    }
    const c = compareScores(me, dh);
    if (c > 0) {
      const pays = holdemAntePays(me.cat);
      const payout = ante * (1 + pays) + ante * 4;
      return { me, dh, stake, payout, show: me.cards, text: `${me.name} wins!  +${formatMoney(payout - stake)}`, kind: pays >= 3 ? 'big' as const : 'win' as const };
    }
    if (c === 0) return { me, dh, stake, payout: stake, show: me.cards, text: 'Same hand: push', kind: '' as const };
    return { me, dh, stake, payout: 0, show: dh.cards, text: `Dealer's ${dh.name.toLowerCase()} wins  −${formatMoney(stake)}`, kind: 'lose' as const };
  };

  const showdown = async (called: boolean) => {
    setMode('wait');
    const o = outcome(called);
    pending = { stake: o.stake, payout: o.payout };
    // Turn and river.
    for (let i = 3; i < 5; i++) {
      reveal(boardEls[i], board[i]);
      audio.play('cards', { volume: 0.6 });
      await sleep(500);
    }
    dealerEls.forEach((el, i) => reveal(el, dealer[i]));
    audio.play('cards');
    await sleep(300);
    // Fresh elements after the flips: find them again for highlighting.
    els = new Map();
    [...playerRow.children].forEach((el, i) => els.set(hole[i], el as HTMLElement));
    [...boardRow.children].forEach((el, i) => els.set(board[i], el as HTMLElement));
    [...dealerRow.children].forEach((el, i) => els.set(dealer[i], el as HTMLElement));
    playerHand.textContent = o.me.name;
    dealerHand.textContent = `${o.dh.name}${dealerQualifies(o.dh) ? '' : ' (doesn’t qualify)'}`;
    await sleep(400);
    if (s.closed) return;
    pending = null;
    s.animate({ kind: 'poker', board }, 2.4, { bet: o.stake, payout: o.payout, label: '', tier: o.payout > o.stake ? 'win' : 'lose', visual: { kind: 'poker', hole, board, hand: o.me.name } });
    mark(o.show);
    s.settle(o.stake, o.payout);
    setResult(result, o.text, o.kind);
    circles.call.set(0);
    placed.ante = placed.aa = 0;
    show();
    busy = false;
    setMode('bet');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!placed.ante) placed.ante = last?.ante ?? chip;
    const ante = placed.ante;
    if (ante < s.min) {
      audio.play('error');
      setResult(result, `The minimum ante is ${formatMoney(s.min)}.`, 'lose');
      return;
    }
    if (s.bank < ante * 3 + placed.aa) {
      audio.play('error');
      setResult(result, `You need ${formatMoney(ante * 3 + placed.aa)} to cover the ante, a call and the bonus.`, 'lose');
      return;
    }
    if (!s.bet(ante + placed.aa)) return;
    busy = true;
    last = { ...placed };
    pending = { stake: ante, payout: 0 };
    show();
    setMode('wait');
    setResult(result, '');
    setSide('');
    shoe.shuffle();
    hole = [shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw()];
    shoe.burn();
    board = [shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw()];
    const holeEls = hole.map((c, i) => cardEl(c, i * 260));
    playerRow.replaceChildren(...holeEls);
    dealerEls = dealer.map((_, i) => cardEl(null, 130 + i * 260));
    dealerRow.replaceChildren(...dealerEls);
    boardEls = board.map((c, i) => cardEl(i < 3 ? c : null, 700 + i * 140));
    boardRow.replaceChildren(...boardEls);
    els = new Map([...hole.map((c, i) => [c, holeEls[i]] as [Card, HTMLElement]), ...board.slice(0, 3).map((c, i) => [c, boardEls[i]] as [Card, HTMLElement])]);
    audio.play('cards');
    dealerHand.textContent = '';
    const now = bestHand([...hole, ...board.slice(0, 3)]);
    playerHand.textContent = now.name;
    await sleep(1400);
    // The AA Bonus is settled on your two cards and the flop.
    if (placed.aa) {
      const r = aaBonus([...hole, ...board.slice(0, 3)]);
      const back = r.pays ? placed.aa * (r.pays + 1) : 0;
      s.settle(placed.aa, back);
      setSide(r.pays ? `AA Bonus: ${r.name.toLowerCase()} pays ${r.pays}:1` : 'AA Bonus loses', r.pays ? 'win' : 'lose');
      if (r.pays) audio.play('win');
      placed.aa = 0;
      show();
    }
    setMode('decide');
  });
  callBtn.addEventListener('click', () => {
    if (!busy || actions.hidden) return;
    if (!s.bet(placed.ante * 2)) return;
    circles.call.set(placed.ante * 2);
    audio.play('chips', { volume: 0.5 });
    void showdown(true);
  });
  foldBtn.addEventListener('click', () => {
    if (busy && !actions.hidden) void showdown(false);
  });

  setMode('bet');
  show();
  setResult(result, 'Put your ante in the circle, then Deal.');
  const pay = h('details', { class: 'mg-pay' },
    h('summary', { text: 'Paytables' }),
    h('div', { class: 'mg-pay-grid' },
      ...[['Ante bonus', ''], ['Royal flush', '100:1'], ['Straight flush', '20:1'], ['Four of a kind', '10:1'], ['Full house', '3:1'], ['Flush', '2:1'], ['Straight or less', '1:1'],
        ['AA Bonus (your 2 cards + the flop)', ''], ['Royal flush', '100:1'], ['Straight flush', '50:1'], ['Four of a kind', '40:1'], ['Full house', '30:1'], ['Flush', '20:1'], ['Straight, trips, two pair or aces', '7:1']].map(([a, b]) =>
        h('div', { class: 'mg-pay-row' }, b ? h('span', { text: a }) : h('b', { text: a }), h('b', { text: b }))),
    ),
    h('p', { class: 'muted small', text: 'The call pays 1:1 when you beat a qualifying dealer, and pushes when the dealer doesn’t qualify (a pair of fours or better).' }),
  );
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt poker-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dealerHand),
      dealerRow,
      boardRow,
      playerRow,
      h('div', { class: 'bj-label' }, 'You ', playerHand),
      h('div', { class: 'bj-circles' }, circles.aa.el, circles.ante.el, circles.call.el),
      sideNote,
      h('div', { class: 'felt-rule', text: 'CASINO HOLD’EM · DEALER QUALIFIES WITH A PAIR OF FOURS' }),
    ),
    result,
    dealBtn,
    actions,
    chipsEl,
    betRow,
    pay,
  );
  ctx.modals.open(`Casino Hold'em`, body, {
    cls: 'minigame table-game',
    onClose: () => {
      if (pending && !s.closed) s.settle(pending.stake, pending.payout);
      pending = null;
      s.dispose();
    },
  });
}
