import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe } from '../../items/cards';
import { TCP_NAMES, pairPlusPays, tcpDealerQualifies, threeCardReturn, threeCardScore } from '../../items/rules';
import type { Card } from '../../items/types';
import { type GameCtx, Session, cardEl, chipRow, chipValues, resultLine, reveal, setResult, sleep } from './common';

/**
 * Three Card Poker: Ante (and optional Pair Plus), see three cards, then Play (equal to
 * the ante) or fold. Dealer qualifies with queen high; ante bonus on straights or better.
 */
export function openThreeCard(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let ante = chips[0];
  let pairPlus = 0;
  let busy = false;
  let me: Card[] = [];
  let dealer: Card[] = [];
  let dealerEls: HTMLElement[] = [];
  const dRow = h('div', { class: 'pc-row' });
  const pRow = h('div', { class: 'pc-row' });
  const dName = h('span', { class: 'bj-total' });
  const pName = h('span', { class: 'bj-total' });
  const result = resultLine();
  const anteLabel = h('b', { text: formatMoney(ante) });
  const ppLabel = h('b', { text: formatMoney(0) });
  const chipsEl = chipRow(chips, () => ante, (v) => {
    if (!busy) {
      ante = v;
      anteLabel.textContent = formatMoney(ante);
      if (pairPlus) {
        pairPlus = ante;
        ppLabel.textContent = formatMoney(pairPlus);
      }
    }
  }, { min: s.min, bank: () => s.bank });
  const ppBtn = h('button', { class: 'btn', text: 'Pair Plus: off' });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const playBtn = h('button', { class: 'btn gold', text: 'Play' });
  const foldBtn = h('button', { class: 'btn danger', text: 'Fold' });
  const actions = h('div', { class: 'tg-actions' }, foldBtn, playBtn);
  const setMode = (m: 'bet' | 'decide' | 'wait') => {
    dealBtn.hidden = m !== 'bet';
    ppBtn.hidden = m !== 'bet';
    actions.hidden = m !== 'decide';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    playBtn.textContent = `Play ${formatMoney(ante)}`;
  };
  ppBtn.addEventListener('click', () => {
    if (busy) return;
    pairPlus = pairPlus ? 0 : ante;
    ppBtn.textContent = pairPlus ? 'Pair Plus: on' : 'Pair Plus: off';
    ppLabel.textContent = formatMoney(pairPlus);
    audio.play('click');
  });

  const showdown = async (played: boolean) => {
    setMode('wait');
    const ms = threeCardScore(me);
    const ds = threeCardScore(dealer);
    const shared = { kind: 'poker' as const, board: [...dealer, me[0], me[1]], dealer3: dealer };
    const stake = ante + (played ? ante : 0) + pairPlus;
    s.animate(shared, 2.0, { bet: stake, payout: 0, label: '', tier: 'lose', visual: { kind: 'poker', hole: me.slice(0, 2), board: [], hand: TCP_NAMES[ms[0]] } });
    dealerEls.forEach((el, i) => reveal(el, dealer[i]));
    audio.play('cards');
    dName.textContent = `${TCP_NAMES[ds[0]]}${tcpDealerQualifies(ds) ? '' : ' (no qualify)'}`;
    await sleep(600);
    const r = threeCardReturn(ante, played, ms, ds);
    const pp = pairPlus ? pairPlus * (pairPlusPays(ms) ? pairPlusPays(ms) + 1 : 0) : 0;
    const paid = Math.round(r.total + pp);
    s.settle(stake, paid);
    const net = paid - stake;
    const extra = pairPlus ? (pp ? ` · Pair Plus pays ${pairPlusPays(ms)}:1` : ' · Pair Plus loses') : '';
    setResult(result, `${r.note}${extra}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`, ms[0] >= 4 && net > 0 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    setMode('bet');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (s.bank < ante * 2 + pairPlus) {
      audio.play('error');
      setResult(result, `You need ${formatMoney(ante * 2 + pairPlus)} to cover the ante, play and side bet.`, 'lose');
      return;
    }
    if (!s.bet(ante + pairPlus)) return;
    busy = true;
    setMode('wait');
    setResult(result, '');
    const shoe = new Shoe(1);
    me = [shoe.draw(), shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw(), shoe.draw()];
    pRow.replaceChildren(...me.map((c, i) => cardEl(c, i * 120)));
    dealerEls = dealer.map((_, i) => cardEl(null, 360 + i * 120));
    dRow.replaceChildren(...dealerEls);
    dName.textContent = '';
    pName.textContent = TCP_NAMES[threeCardScore(me)[0]];
    audio.play('cards');
    await sleep(800);
    setMode('decide');
  });
  playBtn.addEventListener('click', () => {
    if (!busy || actions.hidden) return;
    if (!s.bet(ante)) return;
    void showdown(true);
  });
  foldBtn.addEventListener('click', () => {
    if (busy && !actions.hidden) void showdown(false);
  });

  setMode('bet');
  const payInfo = h('details', { class: 'mg-pay' },
    h('summary', { text: 'Paytables' }),
    h('div', { class: 'mg-pay-grid' },
      ...[['Pair Plus', ''], ['Straight flush', '40:1'], ['Three of a kind', '30:1'], ['Straight', '6:1'], ['Flush', '4:1'], ['Pair', '1:1'], ['Ante bonus', ''], ['Straight flush', '5:1'], ['Three of a kind', '4:1'], ['Straight', '1:1']].map(([a, b]) =>
        h('div', { class: 'mg-pay-row' }, b ? h('span', { text: a }) : h('b', { text: a }), h('b', { text: b }))),
    ),
    h('p', { class: 'muted small', text: 'Dealer needs queen high. If they don’t qualify the ante pays 1:1 and play pushes. Beat a qualifying dealer and ante and play both pay 1:1. In three-card poker a straight beats a flush.' }),
  );
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt poker-felt' },
      h('div', { class: 'bj-label' }, 'Dealer ', dName),
      dRow,
      h('div', { class: 'felt-rule', text: 'PAIR PLUS · ANTE · PLAY · DEALER QUALIFIES WITH QUEEN HIGH' }),
      pRow,
      h('div', { class: 'bj-label' }, 'You ', pName),
    ),
    result,
    h('div', { class: 'tg-betline' }, 'Ante ', anteLabel, ' · Pair Plus ', ppLabel),
    chipsEl,
    ppBtn,
    dealBtn,
    actions,
    payInfo,
  );
  ctx.modals.open('Three Card Poker', body, {
    cls: 'minigame table-game',
    onClose: () => {
      // Leaving before deciding counts as a fold.
      if (busy && !actions.hidden && !s.closed) s.settle(ante + pairPlus, 0);
      s.dispose();
    },
  });
}
