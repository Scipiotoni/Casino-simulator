import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { ROULETTE_ORDER, rouletteColor, rouletteWheelTexture } from '../../render/textures';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

type Spot = { id: string; label: string; pays: number; wins: (n: number) => boolean; cls?: string };

const RED = (n: number) => rouletteColor(n) === 'red';

function spots(): Spot[] {
  const out: Spot[] = [{ id: 'n0', label: '0', pays: 35, wins: (n) => n === 0, cls: 'green' }];
  for (let n = 1; n <= 36; n++) out.push({ id: `n${n}`, label: String(n), pays: 35, wins: (x) => x === n, cls: RED(n) ? 'red' : 'black' });
  out.push(
    { id: 'd1', label: '1st 12', pays: 2, wins: (n) => n >= 1 && n <= 12 },
    { id: 'd2', label: '2nd 12', pays: 2, wins: (n) => n >= 13 && n <= 24 },
    { id: 'd3', label: '3rd 12', pays: 2, wins: (n) => n >= 25 },
    { id: 'lo', label: '1–18', pays: 1, wins: (n) => n >= 1 && n <= 18 },
    { id: 'ev', label: 'EVEN', pays: 1, wins: (n) => n > 0 && n % 2 === 0 },
    { id: 'rd', label: '◆', pays: 1, wins: (n) => n > 0 && RED(n), cls: 'red' },
    { id: 'bk', label: '◆', pays: 1, wins: (n) => n > 0 && !RED(n), cls: 'black' },
    { id: 'od', label: 'ODD', pays: 1, wins: (n) => n % 2 === 1 },
    { id: 'hi', label: '19–36', pays: 1, wins: (n) => n >= 19 },
    { id: 'c3', label: '2:1', pays: 2, wins: (n) => n > 0 && n % 3 === 0 },
    { id: 'c2', label: '2:1', pays: 2, wins: (n) => n > 0 && n % 3 === 2 },
    { id: 'c1', label: '2:1', pays: 2, wins: (n) => n > 0 && n % 3 === 1 },
  );
  return out;
}

let wheelUrl: string | null = null;

/** Single-zero roulette with a full betting layout. */
export function openRoulette(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min, s.max);
  let chip = chips[0];
  let busy = false;
  const all = spots();
  const bets = new Map<string, number>();
  const chipEls = new Map<string, HTMLElement>();
  const result = resultLine();
  const totalEl = h('b', { text: '$0' });
  wheelUrl ??= (rouletteWheelTexture().image as HTMLCanvasElement).toDataURL();
  const wheel = h('img', { class: 'rw-img', src: wheelUrl, alt: 'Roulette wheel' });
  const ballNum = h('div', { class: 'rw-num', text: '' });
  const history = h('div', { class: 'rw-hist' });
  let rot = 0;

  const refreshTotal = () => {
    let t = 0;
    bets.forEach((v) => (t += v));
    totalEl.textContent = formatMoney(t);
    for (const [id, el] of chipEls) {
      const v = bets.get(id) ?? 0;
      el.textContent = v ? (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v)) : '';
      el.hidden = !v;
    }
  };
  const place = (sp: Spot) => {
    if (busy) return;
    const cur = bets.get(sp.id) ?? 0;
    if (cur + chip > s.max) {
      audio.play('error');
      setResult(result, `Table limit is ${formatMoney(s.max)} per spot`, 'lose');
      return;
    }
    bets.set(sp.id, cur + chip);
    audio.play('chips', { volume: 0.5 });
    refreshTotal();
  };
  const cell = (sp: Spot, cls = '') => {
    const c = h('span', { class: 'rb-chip', hidden: true });
    chipEls.set(sp.id, c);
    return h('button', { class: `rb-cell ${sp.cls ?? ''} ${cls}`, 'aria-label': `Bet ${sp.label}`, onClick: () => place(sp) }, h('span', { text: sp.label }), c);
  };
  const byId = (id: string) => all.find((x) => x.id === id)!;
  const grid = h('div', { class: 'rb-grid' });
  grid.appendChild(cell(byId('n0'), 'zero'));
  for (const row of [3, 2, 1]) {
    for (let col = 0; col < 12; col++) grid.appendChild(cell(byId(`n${col * 3 + row}`)));
    grid.appendChild(cell(byId(`c${row}`), 'col'));
  }
  const dozens = h('div', { class: 'rb-row3' }, cell(byId('d1')), cell(byId('d2')), cell(byId('d3')));
  const outs = h('div', { class: 'rb-row6' }, cell(byId('lo')), cell(byId('ev')), cell(byId('rd')), cell(byId('bk')), cell(byId('od')), cell(byId('hi')));

  const spinBtn = h('button', { class: 'btn gold tg-main', text: 'Spin' });
  const clearBtn = h('button', { class: 'btn', text: 'Clear' });
  spinBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    let total = 0;
    bets.forEach((v) => (total += v));
    if (total < s.min) {
      audio.play('error');
      setResult(result, `Minimum bet here is ${formatMoney(s.min)}`, 'lose');
      return;
    }
    if (!s.bet(total)) return;
    busy = true;
    setResult(result, 'No more bets!');
    audio.play('tick');
    const n = Math.floor(Math.random() * 37);
    const idx = ROULETTE_ORDER.indexOf(n);
    const turns = 5 + Math.floor(Math.random() * 3);
    const target = -(turns * 360 + (idx / ROULETTE_ORDER.length) * 360);
    rot = Math.floor(rot / 360) * 360 + target;
    wheel.style.transition = 'transform 3.4s cubic-bezier(0.15, 0.7, 0.2, 1)';
    wheel.style.transform = `rotate(${rot}deg)`;
    ballNum.textContent = '';
    for (let i = 0; i < 6; i++) {
      await sleep(450);
      audio.play('tick', { volume: 0.4, pitch: 1 + i * 0.05 });
    }
    await sleep(700);
    const col = rouletteColor(n);
    ballNum.textContent = String(n);
    ballNum.className = `rw-num ${col}`;
    history.prepend(h('span', { class: `rw-h ${col}`, text: String(n) }));
    while (history.children.length > 10) history.lastChild?.remove();
    let payout = 0;
    const winners: string[] = [];
    for (const [id, amt] of bets) {
      const sp = byId(id);
      if (sp.wins(n)) {
        payout += amt * (sp.pays + 1);
        winners.push(sp.id);
      }
    }
    s.settle(total, payout);
    for (const id of winners) chipEls.get(id)?.parentElement?.classList.add('hit');
    window.setTimeout(() => grid.parentElement?.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit')), 1800);
    setResult(result, payout > 0 ? `${n} ${col}!  ${payout > total ? '+' : ''}${formatMoney(payout - total)}` : `${n} ${col}. House wins  −${formatMoney(total)}`, payout > total * 5 ? 'big' : payout > total ? 'win' : payout ? '' : 'lose');
    busy = false;
  });
  clearBtn.addEventListener('click', () => {
    if (busy) return;
    bets.clear();
    refreshTotal();
  });
  refreshTotal();
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'rw' }, h('div', { class: 'rw-pointer' }), wheel, ballNum),
    history,
    result,
    h('div', { class: 'rb' }, grid, dozens, outs),
    h('div', { class: 'tg-betline' }, 'On the table ', totalEl),
    chipRow(chips, () => chip, (v) => (chip = v)),
    h('div', { class: 'tg-actions' }, clearBtn, spinBtn),
  );
  ctx.modals.open('Roulette', body, { cls: 'minigame table-game wide-game', onClose: () => s.dispose() });
}
