import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { KENO_PAYS, kenoDraw, kenoReturn } from '../../items/rules';
import type { Outcome } from '../../items/types';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

/** Keno: mark 1–10 spots out of 80; twenty balls are drawn. */
export function openKeno(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let bet = chips[0];
  let busy = false;
  let picks: number[] = [];
  let drawn: number[] = [];
  const grid = h('div', { class: 'keno-board' });
  const ball = h('div', { class: 'kn-ball', text: '?' });
  const ballCount = h('div', { class: 'kn-count', text: 'Ball 0 of 20' });
  const ballRow = h('div', { class: 'kn-balls' });
  const payEl = h('div', { class: 'mg-pay-grid' });
  const result = resultLine();
  const betLabel = h('b', { text: formatMoney(bet) });
  const cells: HTMLElement[] = [];
  for (let n = 1; n <= 80; n++) {
    const el = h('button', {
      class: 'keno-n', text: String(n),
      onClick: () => {
        if (busy) return;
        if (drawn.length) {
          drawn = [];
          paint();
        }
        if (picks.includes(n)) picks = picks.filter((p) => p !== n);
        else if (picks.length < 10) picks.push(n);
        else {
          audio.play('error');
          return;
        }
        audio.play('click');
        paint();
      },
    });
    cells.push(el);
    grid.appendChild(el);
    // The board is printed in two halves, 1–40 over 41–80.
    if (n === 40) grid.appendChild(h('i', { class: 'kn-split' }));
  }
  const paint = () => {
    const d = new Set(drawn);
    cells.forEach((el, i) => {
      el.classList.toggle('pick', picks.includes(i + 1));
      el.classList.toggle('drawn', d.has(i + 1));
    });
    if (!drawn.length) {
      ballRow.replaceChildren();
      ball.textContent = '?';
      ball.classList.remove('hit');
      ballCount.textContent = `Ball 0 of 20 · ${picks.length} spot${picks.length === 1 ? '' : 's'} marked`;
    }
    const table = KENO_PAYS[picks.length] ?? {};
    payEl.replaceChildren(
      h('div', { class: 'mg-pay-row' }, h('b', { text: `${picks.length} spot${picks.length === 1 ? '' : 's'} picked` }), h('b', { text: 'pays' })),
      ...Object.entries(table).reverse().map(([hits, m]) =>
        h('div', { class: 'mg-pay-row' }, h('span', { text: `Catch ${hits}` }), h('b', { text: formatMoney(bet * m) }))),
    );
  };
  const quick = () => {
    if (busy) return;
    const n = picks.length || 6;
    picks = [];
    while (picks.length < n) {
      const x = 1 + Math.floor(Math.random() * 80);
      if (!picks.includes(x)) picks.push(x);
    }
    drawn = [];
    paint();
  };
  const play = async () => {
    if (busy || s.closed) return;
    if (!picks.length) {
      audio.play('error');
      setResult(result, 'Mark 1 to 10 numbers first.', 'lose');
      return;
    }
    if (!s.bet(bet)) return;
    busy = true;
    setResult(result, '');
    const all = kenoDraw();
    const r = kenoReturn(picks, all, bet);
    const oc: Outcome = { bet, payout: r.total, label: '', tier: r.total > bet ? 'win' : 'lose', visual: { kind: 'slot', symbols: r.total ? [5, 5, 5] : [2, 3, 4] } };
    s.spinMachine(oc, 2.4);
    drawn = [];
    paint();
    // The balls come up out of the blower one at a time.
    for (const n of all) {
      drawn.push(n);
      paint();
      const hit = picks.includes(n);
      ball.textContent = String(n);
      ball.classList.toggle('hit', hit);
      ball.classList.remove('pop');
      void ball.offsetWidth;
      ball.classList.add('pop');
      ballCount.textContent = `Ball ${drawn.length} of 20 · ${drawn.filter((x) => picks.includes(x)).length} caught`;
      ballRow.appendChild(h('span', { class: `kn-b${hit ? ' hit' : ''}`, text: String(n) }));
      audio.play(hit ? 'coin' : 'tick', { volume: 0.5 });
      await sleep(160);
    }
    s.settle(bet, r.total);
    const net = r.total - bet;
    setResult(result, `Caught ${r.hits} of ${picks.length}${r.total ? `  +${formatMoney(net)}` : `  −${formatMoney(bet)}`}`, r.total >= bet * 100 ? 'jackpot' : r.total >= bet * 10 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
  };
  paint();
  const payBox = h('details', { class: 'mg-pay' }, h('summary', { text: 'Paytable' }), payEl) as HTMLDetailsElement;
  payBox.open = true;
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'kn-draw' }, ball, h('div', { class: 'kn-side' }, ballCount, ballRow)),
    grid,
    result,
    payBox,
    h('div', { class: 'tg-betline' }, 'Bet ', betLabel),
    chipRow(chips, () => bet, (v) => {
      if (!busy) {
        bet = v;
        betLabel.textContent = formatMoney(bet);
        paint();
      }
    }, { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Quick pick', onClick: quick }),
      h('button', { class: 'btn', text: 'Clear', onClick: () => { if (!busy) { picks = []; drawn = []; paint(); } } }),
      h('button', { class: 'btn gold tg-main', text: 'Draw', onClick: () => void play() })),
  );
  ctx.modals.open('Keno', body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
