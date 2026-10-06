import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe } from '../../items/cards';
import { type CoupMark, baccaratReturn, baccaratTotal, baccaratValue, beadPlate, bigRoad, dealBaccarat } from '../../items/rules';
import type { Card, Outcome } from '../../items/types';
import type { PlacedItem } from '../../items/placedItem';
import {
  type GameCtx, Session, betSpot, cardEl, chipRow, chipValues, resultLine, setResult, shoeView, sleep, sumBets,
} from './common';

/** Eight decks; the cut card goes in 14 cards from the back. */
const shoe = new Shoe(8, Math.random, 14);
let needsBurn = true;
/** Each table's scoreboard, for the current shoe. */
const boards = new WeakMap<PlacedItem, CoupMark[]>();

type Spot = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair';
const SPOTS: { key: Spot; label: string; pays: string; cls: string }[] = [
  { key: 'playerPair', label: 'P PAIR', pays: '11 to 1', cls: 'pair p' },
  { key: 'tie', label: 'TIE', pays: '8 to 1', cls: 'tie big' },
  { key: 'bankerPair', label: 'B PAIR', pays: '11 to 1', cls: 'pair b' },
  { key: 'player', label: 'PLAYER', pays: '1 to 1', cls: 'player big' },
  { key: 'banker', label: 'BANKER', pays: '19 to 20 (5% commission)', cls: 'banker big' },
];

/**
 * Punto banco from an 8-deck shoe: burn cards at the start of each shoe, the standard
 * third-card tableau, the pair side bets, and the Asian scoreboards every baccarat pit
 * shows: the bead plate (every coup in order) and the big road (streaks).
 */
export function openBaccarat(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const bets = new Map<Spot, number>();
  let last: Map<Spot, number> | null = null;
  /** Settled if you walk away mid-coup: the cards are already decided. */
  let pending: { stake: number; paid: number } | null = null;
  const coups = boards.get(ctx.item) ?? [];
  boards.set(ctx.item, coups);
  const pRow = h('div', { class: 'pc-row' });
  const bRow = h('div', { class: 'pc-row' });
  const pTot = h('span', { class: 'bac-score', text: '–' });
  const bTot = h('span', { class: 'bac-score', text: '–' });
  const pSide = h('div', { class: 'bac-side p' }, h('div', { class: 'bac-head' }, h('b', { text: 'PLAYER' }), pTot), pRow);
  const bSide = h('div', { class: 'bac-side b' }, h('div', { class: 'bac-head' }, h('b', { text: 'BANKER' }), bTot), bRow);
  const board = h('div', { class: 'bet-board bac-board' });
  const result = resultLine();
  const totalEl = h('b', { text: formatMoney(0) });
  const sv = shoeView(shoe);
  const bead = h('div', { class: 'road bead' });
  const big = h('div', { class: 'road big' });
  const tally = h('div', { class: 'road-tally' });

  const renderRoads = () => {
    const ROWS = 6;
    const beads = beadPlate(coups, ROWS);
    const firstBead = Math.max(0, (beads.at(-1)?.col ?? 0) - 9);
    bead.replaceChildren(...beads.filter((c) => c.col >= firstBead).map((c) => h('i', {
      class: `rd ${c.winner}${c.pp ? ' pp' : ''}${c.bp ? ' bp' : ''}`, style: `grid-column:${c.col - firstBead + 1};grid-row:${c.row + 1}`,
      text: c.winner === 'P' ? 'P' : c.winner === 'B' ? 'B' : 'T',
    })));
    const road = bigRoad(coups, ROWS);
    const maxCol = road.reduce((a, c) => Math.max(a, c.col), 0);
    const firstCol = Math.max(0, maxCol - 15);
    big.replaceChildren(...road.filter((c) => c.col >= firstCol).map((c) => h('i', {
      class: `rr ${c.winner}${c.ties ? ' tie' : ''}`, style: `grid-column:${c.col - firstCol + 1};grid-row:${c.row + 1}`,
      text: c.ties > 1 ? String(c.ties) : '',
    })));
    const n = (w: string) => coups.filter((c) => c.winner === w).length;
    tally.replaceChildren(
      h('span', { class: 'B', text: `B ${n('B')}` }), h('span', { class: 'P', text: `P ${n('P')}` }), h('span', { class: 'T', text: `T ${n('T')}` }),
      h('span', { text: `Coup ${coups.length + 1}` }));
  };

  const render = () => {
    board.replaceChildren(...SPOTS.map((sp) => betSpot(sp.label, sp.pays, bets.get(sp.key) ?? 0, () => {
      if (busy) return;
      bets.set(sp.key, (bets.get(sp.key) ?? 0) + chip);
      audio.play('chips', { volume: 0.5 });
      render();
    }, sp.cls, busy)));
    totalEl.textContent = formatMoney(sumBets(bets));
  };

  const deal = async () => {
    if (busy || s.closed) return;
    if (!sumBets(bets) && last) for (const [k, v] of last) bets.set(k, v);
    const stake = sumBets(bets);
    if (!stake) {
      audio.play('error');
      setResult(result, 'Put chips on Player, Banker or Tie first.', 'lose');
      return;
    }
    if (!s.bet(stake)) return;
    busy = true;
    pending = { stake, paid: stake };
    last = new Map(bets);
    render();
    setResult(result, '');
    pRow.replaceChildren();
    bRow.replaceChildren();
    pSide.classList.remove('win');
    bSide.classList.remove('win');
    pTot.textContent = bTot.textContent = '–';
    if (shoe.cutCardOut || needsBurn) {
      // A new shoe: shuffle, then turn the first card and burn that many.
      if (shoe.cutCardOut) {
        setResult(result, 'The cut card is out. Shuffling a new shoe…');
        sv.el.classList.add('shuffling');
        await sleep(1100);
        sv.el.classList.remove('shuffling');
        shoe.shuffle();
        coups.length = 0;
        renderRoads();
      }
      const first = shoe.draw();
      const n = baccaratValue(first) || 10;
      for (let i = 0; i < n; i++) shoe.burn();
      needsBurn = false;
      sv.update();
      pRow.appendChild(cardEl(first));
      setResult(result, `Burn card: ${first.rank >= 9 ? 'a ten-value' : 'a'} ${['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'][first.rank]}, burning ${n}.`);
      await sleep(1100);
      pRow.replaceChildren();
      setResult(result, '');
    }
    const r = dealBaccarat(() => shoe.draw());
    let paid = 0;
    bets.forEach((amt, k) => (paid += baccaratReturn(k, amt, r)));
    paid = Math.round(paid);
    if (pending) pending.paid = paid;
    const show = (row: HTMLElement, c: Card, sideways = false) => {
      const el = cardEl(c);
      if (sideways) el.classList.add('sideways');
      row.appendChild(el);
      audio.play('cards', { volume: 0.6 });
      sv.update();
    };
    const oc: Outcome = { bet: stake, payout: 0, label: '', tier: 'lose', visual: { kind: 'blackjack', player: r.player, dealer: r.banker } };
    s.animate({ kind: 'blackjack', dealer: r.banker }, 3.2, oc);
    // Dealt in order: player, banker, player, banker, then any third cards (sideways).
    for (let i = 0; i < 2; i++) {
      show(pRow, r.player[i]);
      await sleep(340);
      show(bRow, r.banker[i]);
      await sleep(340);
    }
    pTot.textContent = String(baccaratTotal(r.player.slice(0, 2)));
    bTot.textContent = String(baccaratTotal(r.banker.slice(0, 2)));
    await sleep(450);
    if (r.natural) setResult(result, `Natural ${Math.max(r.playerTotal, r.bankerTotal)}!`);
    if (r.player[2]) {
      setResult(result, 'Player draws');
      await sleep(350);
      show(pRow, r.player[2], true);
      pTot.textContent = String(r.playerTotal);
      await sleep(550);
    }
    if (r.banker[2]) {
      setResult(result, 'Banker draws');
      await sleep(350);
      show(bRow, r.banker[2], true);
      await sleep(550);
    }
    pTot.textContent = String(r.playerTotal);
    bTot.textContent = String(r.bankerTotal);
    pSide.classList.toggle('win', r.winner === 'player');
    bSide.classList.toggle('win', r.winner === 'banker');
    if (s.closed) return;
    pending = null;
    s.settle(stake, paid);
    coups.push({ winner: r.winner === 'player' ? 'P' : r.winner === 'banker' ? 'B' : 'T', pp: r.playerPair, bp: r.bankerPair, natural: r.natural });
    renderRoads();
    const head = r.winner === 'tie' ? `Tie at ${r.playerTotal}` : `${r.winner === 'player' ? 'Player' : 'Banker'} wins ${Math.max(r.playerTotal, r.bankerTotal)} to ${Math.min(r.playerTotal, r.bankerTotal)}${r.natural ? ' (natural)' : ''}`;
    const pairs = [r.playerPair ? 'player pair' : '', r.bankerPair ? 'banker pair' : ''].filter(Boolean).join(', ');
    const net = paid - stake;
    setResult(result, `${head}${pairs ? ` · ${pairs}` : ''}${net ? `  ${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net))}` : '  push'}`, net > stake * 3 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    bets.clear();
    busy = false;
    render();
    if (shoe.cutCardOut) setResult(result, `${result.textContent} · Cut card: last coup of the shoe`);
  };

  render();
  renderRoads();
  setResult(result, 'Bet on Player, Banker or Tie.');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'bac-scores' },
      h('div', { class: 'road-box' }, h('small', { text: 'BEAD PLATE' }), bead),
      h('div', { class: 'road-box' }, h('small', { text: 'BIG ROAD' }), big),
      tally),
    h('div', { class: 'felt bac-felt' },
      h('div', { class: 'bj-dealer' }, h('span', { class: 'felt-rule', text: 'PUNTO BANCO · 8 DECKS' }), sv.el),
      h('div', { class: 'bac-row' }, pSide, bSide),
      h('div', { class: 'felt-rule', text: 'BANKER PAYS 19 TO 20 · TIE PAYS 8 TO 1 · PAIRS PAY 11 TO 1' }),
    ),
    result,
    board,
    h('div', { class: 'tg-betline' }, 'On the table ', totalEl),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Clear bets', onClick: () => { if (!busy) { bets.clear(); render(); } } }),
      h('button', { class: 'btn gold tg-main', text: 'Deal', onClick: () => void deal() })),
  );
  ctx.modals.open('Baccarat', body, {
    cls: 'minigame table-game',
    onClose: () => {
      if (pending && !s.closed) s.settle(pending.stake, pending.paid);
      pending = null;
      s.dispose();
    },
  });
}
