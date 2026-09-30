import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe } from '../../items/cards';
import { baccaratReturn, baccaratTotal, dealBaccarat } from '../../items/rules';
import type { Card, Outcome } from '../../items/types';
import { type GameCtx, Session, betSpot, cardEl, chipRow, chipValues, resultLine, setResult, sleep, sumBets } from './common';

const shoe = new Shoe(8);
type Spot = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair';
const SPOTS: { key: Spot; label: string; pays: string; cls: string }[] = [
  { key: 'playerPair', label: 'P Pair', pays: '11:1', cls: '' },
  { key: 'tie', label: 'TIE', pays: '8:1', cls: 'tie big' },
  { key: 'bankerPair', label: 'B Pair', pays: '11:1', cls: '' },
  { key: 'player', label: 'PLAYER', pays: '1:1', cls: 'player big' },
  { key: 'banker', label: 'BANKER', pays: '0.95:1 (5% commission)', cls: 'banker big' },
];

/** Punto banco from an 8-deck shoe with the standard third-card rules. */
export function openBaccarat(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const bets = new Map<Spot, number>();
  const pRow = h('div', { class: 'pc-row' });
  const bRow = h('div', { class: 'pc-row' });
  const pTot = h('span', { class: 'bj-total', text: '–' });
  const bTot = h('span', { class: 'bj-total', text: '–' });
  const pSide = h('div', { class: 'bac-side' }, h('div', { class: 'bj-label' }, 'Player ', pTot), pRow);
  const bSide = h('div', { class: 'bac-side' }, h('div', { class: 'bj-label' }, 'Banker ', bTot), bRow);
  const board = h('div', { class: 'bet-board' });
  const result = resultLine();
  const totalEl = h('b', { text: formatMoney(0) });
  const road = h('div', { class: 'bac-road' });
  const history: string[] = [];

  const render = () => {
    board.replaceChildren(...SPOTS.map((sp) => betSpot(sp.label, sp.pays, bets.get(sp.key) ?? 0, () => {
      if (busy) return;
      bets.set(sp.key, (bets.get(sp.key) ?? 0) + chip);
      audio.play('chips', { volume: 0.5 });
      render();
    }, sp.cls, busy)));
    totalEl.textContent = formatMoney(sumBets(bets));
    road.textContent = history.slice(-24).join(' ');
  };

  const deal = async () => {
    if (busy || s.closed) return;
    const stake = sumBets(bets);
    if (!stake) {
      audio.play('error');
      setResult(result, 'Put chips on Player, Banker or Tie first.', 'lose');
      return;
    }
    if (!s.bet(stake)) return;
    busy = true;
    render();
    setResult(result, '');
    pRow.replaceChildren();
    bRow.replaceChildren();
    pSide.classList.remove('win');
    bSide.classList.remove('win');
    const r = dealBaccarat(() => shoe.draw());
    const show = (row: HTMLElement, c: Card) => {
      row.appendChild(cardEl(c));
      audio.play('cards', { volume: 0.6 });
    };
    const oc: Outcome = { bet: stake, payout: 0, label: '', tier: 'lose', visual: { kind: 'blackjack', player: r.player, dealer: r.banker } };
    s.animate({ kind: 'blackjack', dealer: r.banker }, 3.2, oc);
    // Deal in real order: P, B, P, B, then any third cards.
    for (let i = 0; i < 2; i++) {
      show(pRow, r.player[i]);
      await sleep(320);
      show(bRow, r.banker[i]);
      await sleep(320);
    }
    pTot.textContent = String(baccaratTotal(r.player.slice(0, 2)));
    bTot.textContent = String(baccaratTotal(r.banker.slice(0, 2)));
    await sleep(400);
    if (r.player[2]) {
      show(pRow, r.player[2]);
      pTot.textContent = String(r.playerTotal);
      await sleep(500);
    }
    if (r.banker[2]) {
      show(bRow, r.banker[2]);
      await sleep(500);
    }
    pTot.textContent = String(r.playerTotal);
    bTot.textContent = String(r.bankerTotal);
    if (r.winner !== 'banker') pSide.classList.toggle('win', r.winner === 'player');
    if (r.winner === 'banker') bSide.classList.add('win');
    let paid = 0;
    bets.forEach((amt, k) => (paid += baccaratReturn(k, amt, r)));
    paid = Math.round(paid);
    s.settle(stake, paid);
    history.push(r.winner === 'player' ? 'P' : r.winner === 'banker' ? 'B' : 'T');
    const head = r.winner === 'tie' ? `Tie at ${r.playerTotal}` : `${r.winner === 'player' ? 'Player' : 'Banker'} wins ${Math.max(r.playerTotal, r.bankerTotal)} to ${Math.min(r.playerTotal, r.bankerTotal)}${r.natural ? ' (natural)' : ''}`;
    const net = paid - stake;
    setResult(result, `${head}${net ? `  ${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net))}` : '  push'}`, net > stake * 3 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    render();
  };

  render();
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt bac-felt' },
      h('div', { class: 'bac-row' }, pSide, bSide),
      h('div', { class: 'felt-rule', text: 'PUNTO BANCO · 8 DECKS · BANKER PAYS 19 TO 20 · TIE PAYS 8 TO 1' }),
      road,
    ),
    result,
    board,
    h('div', { class: 'tg-betline' }, 'On the table ', totalEl),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Clear bets', onClick: () => { if (!busy) { bets.clear(); render(); } } }),
      h('button', { class: 'btn gold tg-main', text: 'Deal', onClick: () => void deal() })),
  );
  ctx.modals.open('Baccarat', body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
