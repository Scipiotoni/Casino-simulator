import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bestHand } from '../../items/cards';
import { TCP_NAMES, pairPlusPays, sixCardBonus, tcpDealerQualifies, threeCardReturn, threeCardScore } from '../../items/rules';
import type { Card } from '../../items/types';
import { type GameCtx, Session, betCircle, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

/**
 * Three Card Poker: Ante (with the Pair Plus and 6-Card Bonus side bets if you like), see
 * three cards, then Play (equal to the ante) or fold. The dealer qualifies with queen
 * high; the ante bonus pays on a straight or better whatever the dealer has.
 */
export function openThreeCard(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const placed = { ante: 0, pp: 0, six: 0 };
  let last: typeof placed | null = null;
  let me: Card[] = [];
  let dealer: Card[] = [];
  let dealerEls: HTMLElement[] = [];
  /** Settled if you walk away; payout −1 = not decided yet (counts as a fold). */
  let pending: { stake: number; payout: number } | null = null;
  const dRow = h('div', { class: 'pc-row' });
  const pRow = h('div', { class: 'pc-row' });
  const dName = h('span', { class: 'bj-total' });
  const pName = h('span', { class: 'bj-total' });
  const result = resultLine();
  const circles = {
    pp: betCircle('PAIR', 'PLUS', 'side'),
    ante: betCircle('ANTE', '', 'main'),
    play: betCircle('PLAY', '', 'side call'),
    six: betCircle('6-CARD', 'BONUS', 'side'),
  };
  circles.play.el.disabled = true;
  const chipsEl = chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const playBtn = h('button', { class: 'btn gold', text: 'Play' });
  const foldBtn = h('button', { class: 'btn danger', text: 'Fold' });
  const actions = h('div', { class: 'tg-actions' }, foldBtn, playBtn);
  const show = () => {
    circles.pp.set(placed.pp);
    circles.ante.set(placed.ante);
    circles.six.set(placed.six);
  };
  const betRow = h('div', { class: 'tg-actions' },
    h('button', { class: 'btn', text: 'Clear', onClick: () => { if (!busy) { placed.ante = placed.pp = placed.six = 0; show(); } } }),
    h('button', { class: 'btn', text: 'Rebet', onClick: () => { if (!busy && last) { Object.assign(placed, last); audio.play('chips', { volume: 0.5 }); show(); } } }));
  for (const k of ['pp', 'ante', 'six'] as const) {
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
    circles.pp.el.disabled = circles.ante.el.disabled = circles.six.el.disabled = m !== 'bet';
    playBtn.textContent = `Play ${formatMoney(placed.ante)}`;
  };

  /** The whole hand's result (the dealer's cards are already dealt). */
  const outcome = (played: boolean) => {
    const ante = placed.ante;
    const ms = threeCardScore(me);
    const ds = threeCardScore(dealer);
    const r = threeCardReturn(ante, played, ms, ds);
    const ppPays = pairPlusPays(ms);
    const pp = placed.pp && ppPays ? placed.pp * (ppPays + 1) : 0;
    const six = sixCardBonus([...me, ...dealer]);
    const sixBack = placed.six && six.pays ? placed.six * (six.pays + 1) : 0;
    const stake = ante + (played ? ante : 0) + placed.pp + placed.six;
    const notes = [r.note];
    if (placed.pp) notes.push(pp ? `Pair Plus pays ${ppPays}:1` : 'Pair Plus loses');
    if (placed.six) notes.push(sixBack ? `6-Card Bonus: ${six.name.toLowerCase()} pays ${six.pays}:1` : '6-Card Bonus loses');
    return { ms, ds, stake, payout: Math.round(r.total + pp + sixBack), notes };
  };

  const showdown = async (played: boolean) => {
    setMode('wait');
    const o = outcome(played);
    pending = { stake: o.stake, payout: o.payout };
    s.animate({ kind: 'poker', board: [...dealer, me[0], me[1]], dealer3: dealer }, 2.0, { bet: o.stake, payout: o.payout, label: '', tier: o.payout > o.stake ? 'win' : 'lose', visual: { kind: 'poker', hole: me.slice(0, 2), board: [], hand: TCP_NAMES[o.ms[0]] } });
    dealerEls.forEach((el, i) => reveal(el, dealer[i]));
    audio.play('cards');
    dName.textContent = `${TCP_NAMES[o.ds[0]]}${tcpDealerQualifies(o.ds) ? '' : ' (doesn’t qualify)'}`;
    await sleep(700);
    if (s.closed) return;
    pending = null;
    // The 6-card hand, lit up across both rows.
    if (placed.six) {
      const best = bestHand([...me, ...dealer]).cards;
      [...pRow.children, ...dRow.children].forEach((el, i) => el.classList.toggle('win', best.includes([...me, ...dealer][i])));
    }
    s.settle(o.stake, o.payout);
    const net = o.payout - o.stake;
    setResult(result, `${o.notes.join(' · ')}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`, o.ms[0] >= 4 && net > 0 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    circles.play.set(0);
    placed.ante = placed.pp = placed.six = 0;
    show();
    busy = false;
    setMode('bet');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!placed.ante && !placed.pp) placed.ante = last?.ante ?? chip;
    if (placed.ante && placed.ante < s.min) {
      audio.play('error');
      setResult(result, `The minimum ante is ${formatMoney(s.min)}.`, 'lose');
      return;
    }
    if (placed.six && !placed.ante) {
      audio.play('error');
      setResult(result, 'The 6-Card Bonus needs an ante.', 'lose');
      return;
    }
    const need = placed.ante * 2 + placed.pp + placed.six;
    if (s.bank < need) {
      audio.play('error');
      setResult(result, `You need ${formatMoney(need)} to cover the ante, play and side bets.`, 'lose');
      return;
    }
    if (!s.bet(placed.ante + placed.pp + placed.six)) return;
    busy = true;
    last = { ...placed };
    show();
    pending = { stake: placed.ante + placed.pp + placed.six, payout: -1 };
    setMode('wait');
    setResult(result, '');
    const shoe = new Shoe(1);
    me = [shoe.draw(), shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw(), shoe.draw()];
    pRow.replaceChildren(...me.map((c, i) => cardEl(c, i * 220)));
    dealerEls = dealer.map((_, i) => cardEl(null, 110 + i * 220));
    dRow.replaceChildren(...dealerEls);
    dName.textContent = '';
    pName.textContent = TCP_NAMES[threeCardScore(me)[0]];
    audio.play('cards');
    await sleep(900);
    if (!placed.ante) {
      // Pair Plus only: nothing to decide, the hand is settled on its own.
      pending = null;
      return showdown(false);
    }
    setMode('decide');
  });
  playBtn.addEventListener('click', () => {
    if (!busy || actions.hidden) return;
    if (!s.bet(placed.ante)) return;
    circles.play.set(placed.ante);
    audio.play('chips', { volume: 0.5 });
    void showdown(true);
  });
  foldBtn.addEventListener('click', () => {
    if (busy && !actions.hidden) void showdown(false);
  });

  setMode('bet');
  show();
  setResult(result, 'Ante up (and Pair Plus or the 6-Card Bonus if you like), then Deal.');
  const payInfo = h('details', { class: 'mg-pay' },
    h('summary', { text: 'Paytables' }),
    h('div', { class: 'mg-pay-grid' },
      ...[['Pair Plus', ''], ['Straight flush', '40:1'], ['Three of a kind', '30:1'], ['Straight', '6:1'], ['Flush', '4:1'], ['Pair', '1:1'],
        ['Ante bonus', ''], ['Straight flush', '5:1'], ['Three of a kind', '4:1'], ['Straight', '1:1'],
        ['6-Card Bonus (your 3 + the dealer’s 3)', ''], ['Royal flush', '1000:1'], ['Straight flush', '200:1'], ['Four of a kind', '100:1'], ['Full house', '20:1'], ['Flush', '15:1'], ['Straight', '10:1'], ['Three of a kind', '5:1']].map(([a, b]) =>
        h('div', { class: 'mg-pay-row' }, b ? h('span', { text: a }) : h('b', { text: a }), h('b', { text: b }))),
    ),
    h('p', { class: 'muted small', text: 'Dealer needs queen high. If they don’t qualify the ante pays 1:1 and play pushes. Beat a qualifying dealer and ante and play both pay 1:1. In three-card poker a straight beats a flush.' }),
  );
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt poker-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dName),
      dRow,
      h('div', { class: 'felt-rule', text: 'DEALER PLAYS WITH QUEEN HIGH OR BETTER' }),
      pRow,
      h('div', { class: 'bj-label' }, 'You ', pName),
      h('div', { class: 'bj-circles' }, circles.pp.el, circles.ante.el, circles.play.el, circles.six.el),
    ),
    result,
    dealBtn,
    actions,
    chipsEl,
    betRow,
    payInfo,
  );
  ctx.modals.open('Three Card Poker', body, {
    cls: 'minigame table-game',
    onClose: () => {
      // Leaving before deciding counts as a fold (the side bets still play); after, the hand plays out.
      if (pending && !s.closed) {
        const o = pending.payout < 0 ? outcome(false) : pending;
        s.settle(o.stake, o.payout);
      }
      pending = null;
      s.dispose();
    },
  });
}
