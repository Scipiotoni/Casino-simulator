import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { SICBO_TOTAL_PAYS, type SicBoBet, rollThree, sicBoReturn } from '../../items/rules';
import { sicBoLabel } from '../../items/games';
import { type GameCtx, Session, betSpot, chipRow, chipValues, resultLine, setResult, sleep, sumBets } from './common';
import { die } from './craps';

const key = (b: SicBoBet) => JSON.stringify(b);

const LAYOUT: { bet: SicBoBet; pays: string; cls?: string }[] = [
  { bet: { kind: 'small' }, pays: '4–10 · 1:1', cls: 'big' },
  { bet: { kind: 'anyTriple' }, pays: '30:1', cls: 'big' },
  { bet: { kind: 'big' }, pays: '11–17 · 1:1', cls: 'big' },
  ...Array.from({ length: 14 }, (_, i) => ({ bet: { kind: 'total', n: i + 4 } as SicBoBet, pays: `${SICBO_TOTAL_PAYS[i + 4]}:1` })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ bet: { kind: 'double', n } as SicBoBet, pays: '10:1' })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ bet: { kind: 'triple', n } as SicBoBet, pays: '180:1' })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ bet: { kind: 'single', n } as SicBoBet, pays: '1:1 / 2:1 / 3:1' })),
];

/** Sic bo: three dice under the shaker, Macau layout (small/big lose on any triple). */
export function openSicBo(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const bets = new Map<string, number>();
  const dice = h('div', { class: 'dice three' }, die(1), die(3), die(5));
  const board = h('div', { class: 'bet-board sb' });
  const result = resultLine();
  const totalEl = h('b');
  const render = () => {
    board.replaceChildren(...LAYOUT.map((l) => betSpot(sicBoLabel(l.bet), l.pays, bets.get(key(l.bet)) ?? 0, () => {
      if (busy) return;
      bets.set(key(l.bet), (bets.get(key(l.bet)) ?? 0) + chip);
      audio.play('chips', { volume: 0.5 });
      render();
    }, l.cls ?? '', busy)));
    totalEl.textContent = formatMoney(sumBets(bets));
  };
  const roll = async () => {
    if (busy || s.closed) return;
    const stake = sumBets(bets);
    if (!stake) {
      audio.play('error');
      setResult(result, 'Put chips on the layout first.', 'lose');
      return;
    }
    if (!s.bet(stake)) return;
    busy = true;
    render();
    setResult(result, '');
    const r = rollThree();
    s.animate({ kind: 'craps', dice: r }, 2.2);
    audio.play('dice');
    dice.classList.add('rolling');
    for (let i = 0; i < 9; i++) {
      dice.replaceChildren(...[0, 1, 2].map(() => die(1 + Math.floor(Math.random() * 6))));
      await sleep(95);
    }
    dice.classList.remove('rolling');
    dice.replaceChildren(...r.map((v) => die(v)));
    let paid = 0;
    const wins: string[] = [];
    for (const [k, amt] of bets) {
      const b = JSON.parse(k) as SicBoBet;
      const back = sicBoReturn(b, amt, r);
      if (back) wins.push(sicBoLabel(b));
      paid += back;
    }
    paid = Math.round(paid);
    s.settle(stake, paid);
    const sum = r[0] + r[1] + r[2];
    const net = paid - stake;
    setResult(result, `${r.join(' · ')} = ${sum}${r[0] === r[1] && r[1] === r[2] ? ' TRIPLE!' : ''} · ${wins.length ? `wins: ${wins.join(', ')}` : 'no winners'}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`, net > stake * 5 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    render();
  };
  render();
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt sicbo-felt' }, dice, h('div', { class: 'felt-rule', text: 'SIC BO · SMALL & BIG LOSE ON ANY TRIPLE' })),
    result,
    board,
    h('div', { class: 'tg-betline' }, 'On the layout ', totalEl),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Clear bets', onClick: () => { if (!busy) { bets.clear(); render(); } } }),
      h('button', { class: 'btn gold tg-main', text: 'Shake the dice', onClick: () => void roll() })),
  );
  ctx.modals.open('Sic Bo', body, { cls: 'minigame table-game wide-game', onClose: () => s.dispose() });
}
