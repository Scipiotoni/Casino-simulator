import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import type { PlacedItem } from '../../items/placedItem';
import {
  CALL_BETS, RED_NUMBERS, WHEEL_ORDER, neighbours, numberAt, rouletteReturn, spotById, spotFor, spotPays,
  type RouletteSpot, type SpotKind,
} from '../../items/roulette';
import { type GameCtx, Session, chipRow, chipStack, chipValues, resultLine, setResult, sleep } from './common';
import { RouletteWheelView, SPIN_SECONDS } from './rouletteWheel';

/** Each table remembers its last hundred numbers (the marquee board). */
const histories = new WeakMap<PlacedItem, number[]>();
const colorOf = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

// Column widths of the felt: zero, twelve number columns, the 2-to-1 boxes.
const ZW = 1.2;
const TOTAL = ZW + 12 + ZW;
const colLeft = (c: number) => ((ZW + c) / TOTAL) * 100;
const colMid = (c: number) => ((ZW + c + 0.5) / TOTAL) * 100;
const rowTop = (r: number) => (r / 3) * 100;
const rowMid = (r: number) => ((r + 0.5) / 3) * 100;

const KIND_NAMES: Record<SpotKind, string> = {
  straight: 'Straight up', split: 'Split', street: 'Street', trio: 'Trio', corner: 'Corner', firstFour: 'First four', line: 'Six line',
  column: 'Column', dozen: 'Dozen', red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: 'Low', high: 'High',
};

/**
 * European single-zero roulette with la partage: the full felt (straight ups, splits,
 * streets, corners, six lines, trios and first four on the lines between the numbers),
 * the outside bets, the French racetrack for call bets and neighbours, a wheel where the
 * ball really runs round the track and drops, and the marquee of recent numbers.
 */
export function openRoulette(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  let pending: { n: number; total: number } | null = null;
  const bets = new Map<string, number>();
  let undo: [string, number][][] = [];
  let lastRound: Map<string, number> | null = null;
  const history = histories.get(ctx.item) ?? [];
  histories.set(ctx.item, history);
  const hosts = new Map<string, HTMLElement>();
  const numCells = new Map<number, HTMLElement>();
  const result = resultLine();
  const totalEl = h('b', { text: formatMoney(0) });
  const wheel = new RouletteWheelView(window.innerWidth < 520 ? 190 : 230);
  let dolly: HTMLElement | null = null;

  const cover = (spot: RouletteSpot | null) => {
    numCells.forEach((el, n) => el.classList.toggle('cover', !!spot && spot.numbers.includes(n)));
  };
  const clearMarks = () => {
    dolly?.remove();
    dolly = null;
    document.querySelectorAll('.rl .hit, .rl .swept').forEach((e) => e.classList.remove('hit', 'swept'));
  };
  const renderChips = () => {
    let t = 0;
    for (const [id, host] of hosts) {
      host.querySelector(':scope > .cstack')?.remove();
      const a = bets.get(id) ?? 0;
      t += a;
      host.classList.toggle('on', a > 0);
      if (a) host.appendChild(chipStack(a));
    }
    totalEl.textContent = formatMoney(t);
  };
  const place = (items: [string, number][]) => {
    if (busy || s.closed) return;
    clearMarks();
    for (const [id, a] of items) bets.set(id, (bets.get(id) ?? 0) + a);
    undo.push(items);
    audio.play('chips', { volume: 0.5 });
    renderChips();
  };
  const host = (spot: RouletteSpot, el: HTMLElement) => {
    hosts.set(spot.id, el);
    el.title = `${KIND_NAMES[spot.kind]} ${spot.kind === 'straight' ? spot.label : spot.numbers.length <= 6 ? spot.numbers.join('-') : spot.label} · pays ${spotPays(spot)} to 1`;
    el.addEventListener('mouseenter', () => cover(spot));
    el.addEventListener('mouseleave', () => cover(null));
    el.addEventListener('click', () => place([[spot.id, chip]]));
    el.addEventListener('contextmenu', (e) => {
      // Right-click takes a chip back off this spot.
      e.preventDefault();
      if (busy || !bets.get(spot.id)) return;
      const left = Math.max(0, bets.get(spot.id)! - chip);
      if (left) bets.set(spot.id, left);
      else bets.delete(spot.id);
      audio.play('click');
      renderChips();
    });
    return el;
  };

  // ------------------------------------------------------------------ the felt
  const nums = h('div', { class: 'rl-nums' });
  const zero = host(spotFor('straight', [0])!, h('button', { class: 'rl-cell green zero', 'aria-label': 'Bet 0' }, h('span', { text: '0' })));
  numCells.set(0, zero);
  nums.appendChild(zero);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 12; c++) {
      const n = numberAt(c, r);
      const el = host(spotFor('straight', [n])!, h('button', { class: `rl-cell ${colorOf(n)}`, style: `grid-row:${r + 1};grid-column:${c + 2}`, 'aria-label': `Bet ${n}` }, h('span', { text: String(n) })));
      numCells.set(n, el);
      nums.appendChild(el);
    }
    const col = spotById(`column:${3 - r}`)!;
    nums.appendChild(host(col, h('button', { class: 'rl-cell out col', style: `grid-row:${r + 1};grid-column:14`, 'aria-label': `Column ${3 - r}` }, h('span', { text: '2 to 1' }))));
  }
  // Hotspots on the lines between numbers.
  const hot = (kind: SpotKind, numbers: number[], x: number, y: number) => {
    const sp = spotFor(kind, numbers);
    if (!sp) return;
    nums.appendChild(host(sp, h('button', { class: `rl-hot ${kind}`, style: `left:${x}%;top:${y}%`, 'aria-label': `${KIND_NAMES[kind]} ${numbers.join('-')}` })));
  };
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 2; r++) hot('split', [numberAt(c, r), numberAt(c, r + 1)], colMid(c), rowTop(r + 1));
    hot('street', [3 * c + 1, 3 * c + 2, 3 * c + 3], colMid(c), 100);
    if (c < 11) {
      for (let r = 0; r < 3; r++) hot('split', [numberAt(c, r), numberAt(c + 1, r)], colLeft(c + 1), rowMid(r));
      for (let r = 0; r < 2; r++) hot('corner', [numberAt(c, r), numberAt(c + 1, r), numberAt(c, r + 1), numberAt(c + 1, r + 1)], colLeft(c + 1), rowTop(r + 1));
      hot('line', [1, 2, 3, 4, 5, 6].map((k) => 3 * c + k), colLeft(c + 1), 100);
    }
  }
  for (let r = 0; r < 3; r++) hot('split', [0, numberAt(0, r)], colLeft(0), rowMid(r));
  hot('trio', [0, 2, 3], colLeft(0), rowTop(1));
  hot('trio', [0, 1, 2], colLeft(0), rowTop(2));
  hot('firstFour', [0, 1, 2, 3], colLeft(0), 100);

  const outside = (id: string, label: string, cls = '') => host(spotById(id)!, h('button', { class: `rl-cell out ${cls}` }, h('span', { text: label })));
  const dozens = h('div', { class: 'rl-row dozens' }, h('i'), outside('dozen:1', '1st 12'), outside('dozen:2', '2nd 12'), outside('dozen:3', '3rd 12'), h('i'));
  const evens = h('div', { class: 'rl-row evens' }, h('i'),
    outside('low', '1 to 18'), outside('even', 'EVEN'), outside('red', '', 'diamond red'), outside('black', '', 'diamond black'), outside('odd', 'ODD'), outside('high', '19 to 36'), h('i'));
  const felt = h('div', { class: 'rl' }, nums, dozens, evens);

  // ------------------------------------------------------------------ racetrack
  const track = racetrack({
    onNumber: (n) => place(neighbours(n, 2).map((x) => [spotFor('straight', [x])!.id, chip])),
    onCall: (id) => {
      const cb = CALL_BETS.find((b) => b.id === id)!;
      place(cb.chips.map(([k, ns, units]) => [spotFor(k, ns)!.id, chip * units]));
    },
  });

  // ------------------------------------------------------------------ marquee and stats
  const marquee = h('div', { class: 'rl-marquee' });
  const stats = h('div', { class: 'rl-stats' });
  const renderBoard = () => {
    marquee.replaceChildren(...history.slice(0, 11).map((n, i) => h('span', { class: `rl-mq ${colorOf(n)}${i === 0 ? ' last' : ''}`, text: String(n) })));
    if (!history.length) marquee.appendChild(h('span', { class: 'rl-mq empty', text: 'No spins yet' }));
    const last = history.slice(0, 100);
    const pct = (f: (n: number) => boolean) => (last.length ? Math.round((last.filter(f).length / last.length) * 100) : 0);
    const counts = new Map<number, number>();
    for (const n of last) counts.set(n, (counts.get(n) ?? 0) + 1);
    const ranked = WHEEL_ORDER.map((n) => [n, counts.get(n) ?? 0] as [number, number]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const pill = (n: number) => h('span', { class: `rl-h ${colorOf(n)}`, text: String(n) });
    stats.replaceChildren(...[
      h('div', { class: 'rl-bar' },
        ...(['red', 'green', 'black'] as const).map((k) => {
          const p = pct((n) => colorOf(n) === k);
          return h('span', { class: k, style: `flex:${Math.max(k === 'green' ? 6 : 1, p)}`, text: p >= 14 ? `${p}%` : '' });
        })),
      // Hot and cold numbers only mean something after a few spins.
      last.length >= 10 ? h('div', { class: 'rl-hc' }, h('small', { text: 'HOT' }), ...ranked.slice(0, 4).map(([n]) => pill(n))) : null,
      last.length >= 10 ? h('div', { class: 'rl-hc' }, h('small', { text: 'COLD' }), ...ranked.slice(-4).reverse().map(([n]) => pill(n))) : null,
      h('small', { class: 'rl-count', text: `Last ${last.length} spins` }),
    ].filter((x): x is HTMLDivElement => !!x));
  };

  // ------------------------------------------------------------------ the spin
  const spinBtn = h('button', { class: 'btn gold tg-main', text: 'Spin' });
  const sumBets = () => {
    let t = 0;
    bets.forEach((v) => (t += v));
    return t;
  };
  const settleSpin = (n: number, total: number) => {
    let payout = 0;
    for (const [id, amt] of bets) {
      const back = rouletteReturn(spotById(id)!, amt, n, true);
      payout += back;
      hosts.get(id)?.classList.add(back >= amt * 2 ? 'hit' : 'swept');
    }
    payout = Math.round(payout);
    s.settle(total, payout);
    return { payout };
  };
  spinBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    const total = sumBets();
    if (total < s.min) {
      audio.play('error');
      setResult(result, total ? `The table minimum is ${formatMoney(s.min)} a spin.` : 'Put some chips on the felt first.', 'lose');
      return;
    }
    if (!s.bet(total)) return;
    busy = true;
    clearMarks();
    spinBtn.disabled = true;
    const n = Math.floor(Math.random() * 37);
    pending = { n, total };
    s.animate({ kind: 'roulette', number: n }, SPIN_SECONDS);
    setResult(result, 'The ball is in play…');
    audio.play('spin', { volume: 0.5 });
    let saidNoMore = false;
    await wheel.spinTo(n, (kind) => {
      if (kind === 'track' && !saidNoMore && Math.random() < 0.5) {
        saidNoMore = true;
        setResult(result, 'No more bets!');
      }
      audio.play('tick', { volume: kind === 'track' ? 0.18 : kind === 'drop' ? 0.5 : 0.32, pitch: kind === 'pocket' ? 1.4 + Math.random() * 0.3 : 0.8 });
    });
    if (s.closed || !pending) return;
    pending = null;
    const { payout } = settleSpin(n, total);
    history.unshift(n);
    history.length = Math.min(history.length, 100);
    renderBoard();
    dolly = h('i', { class: 'rl-dolly' });
    numCells.get(n)?.appendChild(dolly);
    const col = colorOf(n);
    const desc = n === 0 ? '0 green' : `${n} ${col}, ${n % 2 ? 'odd' : 'even'}, ${n <= 18 ? 'low' : 'high'}`;
    const net = payout - total;
    const partage = n === 0 && [...bets.keys()].some((id) => ['red', 'black', 'odd', 'even', 'low', 'high'].includes(id));
    setResult(result, `${desc}${partage ? ' · la partage: half back on even-money bets' : ''}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : 'even'}`, net > total * 5 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    lastRound = new Map(bets);
    await sleep(1600);
    bets.clear();
    undo = [];
    renderChips();
    busy = false;
    spinBtn.disabled = false;
  });

  const undoBtn = h('button', {
    class: 'btn', text: 'Undo',
    onClick: () => {
      if (busy) return;
      const last = undo.pop();
      if (!last) return;
      for (const [id, a] of last) {
        const left = (bets.get(id) ?? 0) - a;
        if (left > 0) bets.set(id, left);
        else bets.delete(id);
      }
      audio.play('click');
      renderChips();
    },
  });
  const clearBtn = h('button', { class: 'btn', text: 'Clear', onClick: () => { if (!busy) { bets.clear(); undo = []; renderChips(); audio.play('click'); } } });
  const rebetBtn = h('button', {
    class: 'btn', text: 'Rebet',
    onClick: () => {
      if (busy || !lastRound) return;
      place([...lastRound]);
    },
  });
  const doubleBtn = h('button', { class: 'btn', text: 'Double', onClick: () => { if (!busy && bets.size) place([...bets]); } });

  renderChips();
  renderBoard();
  setResult(result, 'Place your bets');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'rl-top' }, h('div', { class: 'rl-wheelbox' }, wheel.el), h('div', { class: 'rl-board' }, h('div', { class: 'rl-board-title', text: 'LAST NUMBERS' }), marquee, stats)),
    result,
    h('div', { class: 'rl-table' }, felt, h('div', { class: 'felt-rule', text: 'SINGLE ZERO · LA PARTAGE · CLICK THE LINES FOR SPLITS, CORNERS, STREETS & SIX LINES · RIGHT-CLICK TAKES A CHIP BACK' })),
    track,
    h('div', { class: 'tg-betline' }, 'On the felt ', totalEl),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' }, undoBtn, clearBtn, rebetBtn, doubleBtn),
    spinBtn,
  );
  ctx.modals.open('Roulette', body, {
    cls: 'minigame table-game wide-game',
    onClose: () => {
      // Walking off mid-spin: the ball still lands and the bets are settled.
      if (pending && !s.closed) settleSpin(pending.n, pending.total);
      pending = null;
      wheel.dispose();
      s.dispose();
    },
  });
}

/** The French racetrack: the numbers in wheel order round an oval, with the call bets inside. */
function racetrack(on: { onNumber: (n: number) => void; onCall: (id: string) => void }): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 600;
  const H = 118;
  const r = 38;
  const x0 = 24 + r;
  const x1 = W - 24 - r;
  const cy = H / 2;
  const straight = x1 - x0;
  const arc = Math.PI * r;
  const per = 2 * straight + 2 * arc;
  // Clockwise from the right-hand end, where the zero sits.
  const at = (d: number): [number, number] => {
    d = ((d % per) + per) % per;
    if (d < arc / 2) {
      const a = d / r;
      return [x1 + Math.cos(a) * r, cy + Math.sin(a) * r];
    }
    d -= arc / 2;
    if (d < straight) return [x1 - d, cy + r];
    d -= straight;
    if (d < arc) {
      const a = Math.PI / 2 + d / r;
      return [x0 + Math.cos(a) * r, cy + Math.sin(a) * r];
    }
    d -= arc;
    if (d < straight) return [x0 + d, cy - r];
    d -= straight;
    const a = -Math.PI / 2 + d / r;
    return [x1 + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'rl-track');
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  el('rect', { x: 4, y: 4, width: W - 8, height: H - 8, rx: (H - 8) / 2, class: 'rt-band' });
  el('rect', { x: x0 - r + 18, y: cy - r + 18, width: straight + 2 * r - 36, height: 2 * r - 36, rx: r - 18, class: 'rt-inner' });
  const zones: [string, string, number, number][] = [['tiers', 'TIER', x0 - r + 18, 150], ['orphelins', 'ORPHELINS', 150, 300], ['voisins', 'VOISINS', 300, 470], ['jeu0', 'ZÉRO', 470, x1 + r - 18]];
  for (const [id, label, a, b] of zones) {
    const g = el('g', { class: 'rt-zone', role: 'button', tabindex: 0, 'aria-label': CALL_BETS.find((c) => c.id === id)!.name });
    const rect = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: a, y: cy - r + 18, width: b - a, height: 2 * r - 36 })) rect.setAttribute(k, String(v));
    const t = document.createElementNS(NS, 'text');
    for (const [k, v] of Object.entries({ x: (a + b) / 2, y: cy + 5, 'text-anchor': 'middle' })) t.setAttribute(k, String(v));
    t.textContent = label;
    g.append(rect, t);
    g.addEventListener('click', () => on.onCall(id));
  }
  const step = per / WHEEL_ORDER.length;
  WHEEL_ORDER.forEach((n, i) => {
    const [x, y] = at(i * step);
    const g = el('g', { class: `rt-num ${colorOf(n)}`, role: 'button', tabindex: 0, 'aria-label': `${n} and the neighbours` });
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ cx: x, cy: y, r: 12 })) c.setAttribute(k, String(v));
    const t = document.createElementNS(NS, 'text');
    for (const [k, v] of Object.entries({ x, y: y + 4, 'text-anchor': 'middle' })) t.setAttribute(k, String(v));
    t.textContent = String(n);
    g.append(c, t);
    g.addEventListener('click', () => on.onNumber(n));
  });
  const box = h('details', { class: 'rl-racetrack' },
    h('summary', { text: 'Racetrack · click a number for it and two neighbours each side (5 chips), or a section for its call bet' }),
    svg as unknown as HTMLElement);
  box.open = true;
  return box;
}
