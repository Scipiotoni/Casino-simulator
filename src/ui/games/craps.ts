import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import {
  LAY_MULTIPLE, POINTS, betName, canPlace, crapsRoll, fmtPays, isContract, oddsMultiple, placePays,
} from '../../items/craps';
import { type GameCtx, Session, chipRow, chipStack, chipValues, resultLine, setResult, sleep } from './common';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function die(v: number): HTMLElement {
  const d = h('div', { class: 'die' });
  for (let i = 0; i < 9; i++) d.appendChild(h('i', { class: PIPS[v].includes(i) ? 'on' : '' }));
  return d;
}

/** Turn a die (from die()) to show `v`. */
export function setDie(d: HTMLElement, v: number): void {
  [...d.children].forEach((pip, i) => pip.classList.toggle('on', PIPS[v].includes(i)));
}

/**
 * Throw dice across the felt: they tumble (faces flicking) for `ms`, then land on `faces`.
 * One timer for the whole throw, so it lands on time even when the page is busy.
 */
export async function throwDice(box: HTMLElement, faces: number[], ms = 900): Promise<void> {
  const dice = [...box.children] as HTMLElement[];
  box.classList.remove('thrown');
  void box.offsetWidth;
  box.classList.add('thrown');
  const flick = window.setInterval(() => dice.forEach((d) => setDie(d, 1 + Math.floor(Math.random() * 6))), 90);
  await sleep(ms);
  window.clearInterval(flick);
  dice.forEach((d, i) => setDie(d, faces[i]));
}

const WORDS: Record<number, string> = { 4: 'FOUR', 5: 'FIVE', 6: 'SIX', 8: 'EIGHT', 9: 'NINE', 10: 'TEN' };

/** What the stickman calls out for a roll. */
function stickCall(d: [number, number], before: number, after: number): string {
  const sum = d[0] + d[1];
  const hard = d[0] === d[1] && sum >= 4 && sum <= 10 && sum !== 7;
  const way = sum >= 4 && sum <= 10 && sum % 2 === 0 ? (hard ? `hard ${sum}` : `easy ${sum}`) : '';
  if (!before) {
    if (sum === 7) return 'Seven, winner! Front line winner';
    if (sum === 11) return 'Yo-leven, winner on the line';
    if (sum === 2) return 'Craps! Aces, line away';
    if (sum === 3) return 'Craps! Ace-deuce, line away';
    if (sum === 12) return 'Craps! Boxcars, bar the twelve';
    return way ? `${way[0].toUpperCase()}${way.slice(1)}: the point is ${sum}. Mark it!` : `The point is ${sum}. Mark it!`;
  }
  if (sum === 7) return "Seven out! Line away, pay the don'ts";
  if (sum === before && !after) return `Winner ${sum}${hard ? ' the hard way' : ''}! Pay the line`;
  if (sum === 11) return 'Yo-leven!';
  if (sum === 2) return 'Aces, craps two';
  if (sum === 3) return 'Ace-deuce, craps three';
  if (sum === 12) return 'Twelve, boxcars';
  if (way) return `${way[0].toUpperCase()}${way.slice(1)}`;
  return sum === 5 ? 'Five, no field five' : sum === 9 ? 'Nine, centre field nine' : String(sum);
}

/**
 * Las Vegas craps on a real layout: the point boxes (place bets, come bets and don't come
 * bets on their numbers), Come and Don't Come, the Field, Big 6 / 8, Don't Pass and the
 * Pass Line with odds behind them (3-4-5x, lay up to 6x), and the centre propositions:
 * hardways, any seven, any craps, aces, ace-deuce, yo, twelve, C&E and the horn.
 */
export function openCraps(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let point = 0;
  let busy = false;
  /** Everything on the layout, and how much of it has already been paid for. */
  let bets = new Map<string, number>();
  let paid = new Map<string, number>();
  const rolls: [number, number][] = [];
  const hosts = new Map<string, HTMLElement>();
  const result = resultLine();
  const totalEl = h('b');
  const diceEl = h('div', { class: 'cr-dice' }, die(3), die(4));
  const rollsEl = h('div', { class: 'cr-rolls' });
  const rollBtn = h('button', { class: 'btn gold tg-main', text: 'Roll the dice' });

  const add = (id: string) => {
    if (busy || s.closed) return;
    const ok = canPlace(point, bets, id);
    if (!ok.ok) {
      audio.play('error');
      setResult(result, ok.reason ?? 'That bet isn’t open right now.', 'lose');
      return;
    }
    const cur = bets.get(id) ?? 0;
    let amt = chip;
    if (ok.max !== undefined && cur + amt > ok.max) {
      amt = ok.max - cur;
      if (amt < 1) {
        audio.play('error');
        setResult(result, `${betName(id)} is at the limit (${id.startsWith('dont') ? `lay up to ${LAY_MULTIPLE}x` : '3-4-5x odds'}).`, 'lose');
        return;
      }
    }
    bets.set(id, cur + amt);
    audio.play('chips', { volume: 0.5 });
    render();
  };
  /** A betting area on the felt that holds the chips for `id`. */
  const area = (id: string, cls: string, ...kids: (HTMLElement | string)[]) => {
    const el = h('button', { class: `cr-area ${cls}`, onClick: () => add(id) }, ...kids);
    hosts.set(id, el);
    return el;
  };
  const tag = (big: string, small?: string) => h('span', { class: 'cr-tag' }, h('b', { text: big }), small ? h('small', { text: small }) : null);

  // The point boxes: don't come strip on top, the number (place bet) and the come bets.
  const boxes = h('div', { class: 'cr-boxes' });
  const boxEls = new Map<number, { box: HTMLElement; come: HTMLElement; dc: HTMLElement }>();
  const comeBtn = (n: number, kind: 'come' | 'dontCome') => {
    const odds = kind === 'come' ? `comeOdds:${n}` : `dontComeOdds:${n}`;
    const el = h('button', { class: `cr-travel ${kind}`, title: kind === 'come' ? `Your come bet on ${n}: click to add odds (up to ${oddsMultiple(n)}x)` : `Your don't come bet on ${n}: click to lay odds (up to ${LAY_MULTIPLE}x)`, onClick: () => add(odds) });
    hosts.set(`${kind}:${n}`, el);
    return el;
  };
  for (const n of POINTS) {
    const dc = h('div', { class: 'cr-dc' }, comeBtn(n, 'dontCome'));
    const come = h('div', { class: 'cr-come' }, comeBtn(n, 'come'));
    const num = area(`place:${n}`, 'cr-num', h('span', { class: 'cr-big', text: n === 6 || n === 9 ? WORDS[n] : String(n) }), h('small', { text: `place ${fmtPays(placePays(n))}` }));
    const box = h('div', { class: 'cr-box' }, dc, num, come);
    boxEls.set(n, { box, come, dc });
    boxes.appendChild(box);
  }
  const dcBar = area('dontCome', 'cr-dcbar', tag("DON'T COME", 'BAR 12'));
  const puck = h('div', { class: 'cr-puck', text: 'OFF' });

  const comeArea = area('come', 'cr-comebox', tag('COME'));
  const field = area('field', 'cr-field', h('span', { class: 'cr-fieldnums', html: '<i>2</i>·3·4·9·10·11·<i>12</i>' }), h('small', { text: 'FIELD · 2 PAYS DOUBLE · 12 PAYS TRIPLE' }));
  const big68 = h('div', { class: 'cr-big68' }, area('big6', 'cr-b6', tag('6', 'BIG')), area('big8', 'cr-b8', tag('8', 'BIG')));
  const dontPass = h('div', { class: 'cr-linerow' }, area('dontPass', 'cr-dp', tag("DON'T PASS BAR", '12 PUSHES')), area('dontOdds', 'cr-odds dont', tag('LAY', 'odds')));
  const pass = h('div', { class: 'cr-linerow' }, area('pass', 'cr-pass', tag('PASS LINE')), area('passOdds', 'cr-odds', tag('ODDS', '3-4-5x')));
  const mainSide = h('div', { class: 'cr-main' },
    h('div', { class: 'cr-toprow' }, dcBar, boxes),
    comeArea,
    field,
    h('div', { class: 'cr-bottom' }, big68, h('div', { class: 'cr-lines' }, dontPass, pass)),
  );
  // Centre propositions.
  const prop = (id: string, label: string, pays: string, dice?: [number, number]) =>
    area(id, 'cr-prop', dice ? h('span', { class: 'cr-mini' }, die(dice[0]), die(dice[1])) : h('b', { text: label }), h('small', { text: pays }));
  const props = h('div', { class: 'cr-props' },
    prop('any7', 'SEVEN', '4 to 1'),
    h('div', { class: 'cr-hards' },
      prop('hard:6', 'Hard 6', '9 to 1', [3, 3]), prop('hard:10', 'Hard 10', '7 to 1', [5, 5]),
      prop('hard:8', 'Hard 8', '9 to 1', [4, 4]), prop('hard:4', 'Hard 4', '7 to 1', [2, 2])),
    h('div', { class: 'cr-hards four' },
      prop('aceDeuce', '', '15 to 1', [1, 2]), prop('aces', '', '30 to 1', [1, 1]), prop('twelve', '', '30 to 1', [6, 6]), prop('yo', '', '15 to 1', [5, 6])),
    prop('anyCraps', 'ANY CRAPS', '7 to 1'),
    h('div', { class: 'cr-hards' }, prop('ce', 'C & E', '3:1 / 7:1'), prop('horn', 'HORN', '2,3,11,12')),
  );

  const render = () => {
    let t = 0;
    bets.forEach((v) => (t += v));
    totalEl.textContent = formatMoney(t);
    // Chips on every area.
    for (const [id, el] of hosts) {
      el.querySelectorAll(':scope > .cstack').forEach((x) => x.remove());
      const a = bets.get(id) ?? 0;
      const odds = id.startsWith('come:') ? bets.get(`comeOdds:${id.slice(5)}`) ?? 0 : id.startsWith('dontCome:') ? bets.get(`dontComeOdds:${id.slice(9)}`) ?? 0 : 0;
      el.classList.toggle('on', a > 0);
      if (a) el.appendChild(chipStack(a));
      if (odds) el.appendChild(chipStack(odds, 'odds'));
      // Working or off: place bets, hardways and come odds rest on the come-out.
      const off = !point && a > 0 && (id.startsWith('place:') || id.startsWith('hard:'));
      el.classList.toggle('off', off);
    }
    for (const [n, b] of boxEls) {
      b.box.classList.toggle('point', point === n);
      b.come.hidden = !bets.get(`come:${n}`);
      b.dc.classList.toggle('has', !!bets.get(`dontCome:${n}`));
    }
    // The puck: OFF in the don't come bar, ON on the point box.
    puck.textContent = point ? 'ON' : 'OFF';
    puck.classList.toggle('on', !!point);
    (point ? boxEls.get(point)!.box : dcBar).appendChild(puck);
    hosts.get('passOdds')!.classList.toggle('closed', !point || !bets.get('pass'));
    hosts.get('dontOdds')!.classList.toggle('closed', !point || !bets.get('dontPass'));
    hosts.get('pass')!.classList.toggle('closed', !!point);
    hosts.get('dontPass')!.classList.toggle('closed', !!point);
    hosts.get('come')!.classList.toggle('closed', !point);
    hosts.get('dontCome')!.classList.toggle('closed', !point);
    rollsEl.replaceChildren(h('small', { text: 'ROLLS' }), ...rolls.slice(-14).reverse().map(([a, b]) => h('span', { class: `cr-r${a + b === 7 ? ' seven' : ''}`, text: String(a + b), title: `${a}-${b}` })));
    rollBtn.textContent = point ? `Roll · point is ${point}` : 'Roll · come-out';
  };

  const roll = async () => {
    if (busy || s.closed) return;
    if (!bets.size) {
      audio.play('error');
      setResult(result, 'Put a bet down first. The Pass Line is the classic.', 'lose');
      return;
    }
    let fresh = 0;
    bets.forEach((v, id) => (fresh += v - (paid.get(id) ?? 0)));
    if (fresh > 0 && !s.bet(fresh)) return;
    paid = new Map(bets);
    busy = true;
    rollBtn.disabled = true;
    setResult(result, '');
    const d: [number, number] = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    s.animate({ kind: 'craps', dice: d }, 2.2);
    audio.play('dice');
    // The shooter's throw: the dice tumble down the felt and off the back wall.
    await throwDice(diceEl, d, 950);
    const before = point;
    const r = crapsRoll(point, bets, d);
    rolls.push(d);
    let staked = 0;
    let back = 0;
    for (const x of r.decisions) {
      staked += x.stake;
      back += x.back;
      const el = hosts.get(x.id) ?? (x.id.includes('Odds:') ? hosts.get(x.id.replace('Odds', '')) : undefined);
      el?.classList.add(x.back > x.stake ? 'won' : x.back === 0 && x.stake ? 'lost' : 'push');
    }
    point = r.point;
    bets = r.bets;
    paid = new Map(bets);
    if (staked || back) s.settle(staked, back);
    const net = back - staked;
    const notes = r.decisions.map((x) => x.note).filter(Boolean);
    for (const m of r.moved) notes.push(`${betName(m.from)} goes to the ${m.to.split(':')[1]}`);
    setResult(result, `${d[0]}-${d[1]} · ${stickCall(d, before, point)}${notes.length ? ` · ${notes.join(' · ')}` : ''}${staked || back ? `  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : 'even'}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : '');
    render();
    window.setTimeout(() => document.querySelectorAll('.cr .won, .cr .lost, .cr .push').forEach((e) => e.classList.remove('won', 'lost', 'push')), 1400);
    busy = false;
    rollBtn.disabled = false;
  };
  rollBtn.addEventListener('click', () => void roll().catch((e) => console.error('craps roll', e)));

  const downBtn = h('button', {
    class: 'btn', text: 'Take down bets',
    onClick: () => {
      if (busy) return;
      // Contract bets (the Pass Line on a point, come bets on their numbers) must stay.
      let refund = 0;
      for (const [id] of [...bets]) {
        if (isContract(point, id)) continue;
        refund += paid.get(id) ?? 0;
        bets.delete(id);
        paid.delete(id);
      }
      if (refund) s.settle(refund, refund);
      audio.play('click');
      setResult(result, refund ? `Bets down: ${formatMoney(refund)} back. Contract bets stay.` : 'Bets down.');
      render();
    },
  });

  render();
  setResult(result, 'Coming out! Bets on the Pass Line.');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt craps-felt cr-throw' }, diceEl, rollsEl, h('div', { class: 'felt-rule', text: '3-4-5X ODDS · PLACE 6 & 8 PAY 7 TO 6 · HARDWAYS & PLACE BETS OFF ON THE COME-OUT' })),
    result,
    h('div', { class: 'cr' }, mainSide, props),
    h('div', { class: 'tg-betline' }, 'On the layout ', totalEl, ' · click the felt to bet, click your come bets for odds'),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' }, downBtn, rollBtn),
  );
  ctx.modals.open('Craps', body, {
    cls: 'minigame table-game wide-game',
    onClose: () => {
      // Walking away: contract bets are lost, everything else paid for comes back.
      let staked = 0;
      let back = 0;
      for (const [id] of bets) {
        const p = paid.get(id) ?? 0;
        staked += p;
        if (!isContract(point, id)) back += p;
      }
      if (staked && !s.closed) s.settle(staked, back);
      s.dispose();
    },
  });
}
