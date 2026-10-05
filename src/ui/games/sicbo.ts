import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { SICBO_TOTAL_PAYS, type SicBoBet, rollThree, sicBoReturn } from '../../items/rules';
import { sicBoLabel } from '../../items/games';
import { type GameCtx, Session, chipRow, chipStack, chipValues, resultLine, setResult, sleep } from './common';
import { die, setDie } from './craps';

const key = (b: SicBoBet) => JSON.stringify(b);
const mini = (...faces: number[]) => h('span', { class: 'sb-mini' }, ...faces.map((f) => die(f)));

/**
 * Sic bo on the Macau layout: Small and Big (lose on any triple), specific doubles and
 * triples round Any Triple, the fourteen totals, the fifteen two-dice combinations and
 * the single numbers. Three dice are shaken under a glass dome.
 */
export function openSicBo(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const bets = new Map<string, number>();
  let last: Map<string, number> | null = null;
  const hosts = new Map<string, HTMLElement>();
  const result = resultLine();
  const totalEl = h('b');
  const diceBox = h('div', { class: 'sb-dice' }, die(1), die(3), die(5));
  const dome = h('div', { class: 'sb-dome' }, diceBox, h('i', { class: 'sb-glass' }));
  const history = h('div', { class: 'cr-rolls' });
  const rolls: [number, number, number][] = [];
  /** A roll in progress is settled even if you walk away before the dome lifts. */
  let owed: { stake: number; paid: number } | null = null;

  const spot = (bet: SicBoBet, cls: string, ...kids: (HTMLElement | string | null)[]) => {
    const k = key(bet);
    const el = h('button', {
      class: `sb-spot ${cls}`, title: sicBoLabel(bet),
      onClick: () => {
        if (busy) return;
        bets.set(k, (bets.get(k) ?? 0) + chip);
        audio.play('chips', { volume: 0.5 });
        render();
      },
    }, ...kids);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (busy || !bets.get(k)) return;
      const left = bets.get(k)! - chip;
      if (left > 0) bets.set(k, left);
      else bets.delete(k);
      render();
    });
    hosts.set(k, el);
    return el;
  };
  const pays = (t: string) => h('small', { text: t });

  // Top band: Small · doubles 1–3 · triples round Any Triple · doubles 4–6 · Big.
  const top = h('div', { class: 'sb-top' },
    spot({ kind: 'small' }, 'sb-sb', h('b', { text: 'SMALL' }), h('span', { text: '4 – 10' }), pays('1 to 1 · loses on any triple')),
    h('div', { class: 'sb-col' }, ...[1, 2, 3].map((n) => spot({ kind: 'double', n }, 'sb-dbl', mini(n, n), pays('10 to 1')))),
    h('div', { class: 'sb-trip' },
      h('div', { class: 'sb-trips' }, ...[1, 2, 3].map((n) => spot({ kind: 'triple', n }, 'sb-tr', mini(n, n, n), pays('180 to 1')))),
      spot({ kind: 'anyTriple' }, 'sb-any', h('b', { text: 'ANY TRIPLE' }), mini(1, 1, 1), pays('30 to 1')),
      h('div', { class: 'sb-trips' }, ...[4, 5, 6].map((n) => spot({ kind: 'triple', n }, 'sb-tr', mini(n, n, n), pays('180 to 1'))))),
    h('div', { class: 'sb-col' }, ...[4, 5, 6].map((n) => spot({ kind: 'double', n }, 'sb-dbl', mini(n, n), pays('10 to 1')))),
    spot({ kind: 'big' }, 'sb-sb', h('b', { text: 'BIG' }), h('span', { text: '11 – 17' }), pays('1 to 1 · loses on any triple')),
  );
  const totals = h('div', { class: 'sb-totals' }, ...Array.from({ length: 14 }, (_, i) => i + 4).map((n) =>
    spot({ kind: 'total', n }, 'sb-tot', h('b', { text: String(n) }), pays(`${SICBO_TOTAL_PAYS[n]} to 1`))));
  const combos: [number, number][] = [];
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) combos.push([a, b]);
  const comboRow = h('div', { class: 'sb-combos' }, ...combos.map(([a, b]) =>
    spot({ kind: 'combo', n: a, m: b }, 'sb-combo', mini(a, b), pays('5:1'))));
  const singles = h('div', { class: 'sb-singles' }, ...[1, 2, 3, 4, 5, 6].map((n) =>
    spot({ kind: 'single', n }, 'sb-single', mini(n), h('b', { text: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'][n - 1] }), pays('1:1 · 2:1 · 3:1'))));

  const render = () => {
    let t = 0;
    for (const [k, el] of hosts) {
      el.querySelector(':scope > .cstack')?.remove();
      const a = bets.get(k) ?? 0;
      t += a;
      el.classList.toggle('on', a > 0);
      if (a) el.appendChild(chipStack(a));
    }
    totalEl.textContent = formatMoney(t);
    history.replaceChildren(h('small', { text: 'RESULTS' }), ...rolls.slice(-12).reverse().map((r) => {
      const sum = r[0] + r[1] + r[2];
      const trip = r[0] === r[1] && r[1] === r[2];
      return h('span', { class: `cr-r ${trip ? 'seven' : sum <= 10 ? 'sb-s' : 'sb-b'}`, text: trip ? `${r[0]}${r[0]}${r[0]}` : String(sum), title: r.join('-') });
    }));
  };

  const roll = async () => {
    if (busy || s.closed) return;
    if (!bets.size && last) for (const [k, v] of last) bets.set(k, v);
    let stake = 0;
    bets.forEach((v) => (stake += v));
    if (!stake) {
      audio.play('error');
      setResult(result, 'Put chips on the layout first.', 'lose');
      return;
    }
    if (!s.bet(stake)) return;
    busy = true;
    last = new Map(bets);
    render();
    setResult(result, 'The dealer shakes the dice…');
    const r = rollThree();
    let paid = 0;
    const wins: string[] = [];
    for (const [k, amt] of bets) {
      const b = JSON.parse(k) as SicBoBet;
      const back = sicBoReturn(b, amt, r);
      if (back) wins.push(sicBoLabel(b));
      paid += back;
      hosts.get(k)?.classList.add(back ? 'won' : 'lost');
    }
    paid = Math.round(paid);
    owed = { stake, paid };
    s.animate({ kind: 'craps', dice: r }, 2.2);
    audio.play('dice');
    dome.classList.remove('lift');
    dome.classList.add('shake');
    const flick = window.setInterval(() => [...diceBox.children].forEach((d) => setDie(d as HTMLElement, 1 + Math.floor(Math.random() * 6))), 90);
    await sleep(1200);
    window.clearInterval(flick);
    [...diceBox.children].forEach((d, i) => setDie(d as HTMLElement, r[i]));
    dome.classList.remove('shake');
    dome.classList.add('lift');
    audio.play('click');
    await sleep(500);
    if (s.closed) return;
    owed = null;
    s.settle(stake, paid);
    rolls.push(r);
    const sum = r[0] + r[1] + r[2];
    const net = paid - stake;
    setResult(result, `${r.join(' · ')} = ${sum}${r[0] === r[1] && r[1] === r[2] ? ' · TRIPLE!' : sum <= 10 ? ' · small' : ' · big'}${wins.length ? ` · ${wins.join(', ')}` : ''}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`, net > stake * 5 ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    await sleep(1300);
    bets.clear();
    document.querySelectorAll('.sb .won, .sb .lost').forEach((e) => e.classList.remove('won', 'lost'));
    busy = false;
    render();
  };
  render();
  setResult(result, 'Place your bets on the layout.');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt sicbo-felt' }, dome, history),
    result,
    h('div', { class: 'sb' }, top, totals, comboRow, singles),
    h('div', { class: 'tg-betline' }, 'On the layout ', totalEl, ' · right-click takes a chip back'),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Clear bets', onClick: () => { if (!busy) { bets.clear(); render(); } } }),
      h('button', { class: 'btn', text: 'Rebet', onClick: () => { if (!busy && last) { bets.clear(); for (const [k, v] of last) bets.set(k, v); render(); } } }),
      h('button', { class: 'btn gold tg-main', text: 'Shake the dice', onClick: () => void roll() })),
  );
  ctx.modals.open('Sic Bo', body, {
    cls: 'minigame table-game wide-game',
    onClose: () => {
      if (owed && !s.closed) s.settle(owed.stake, owed.paid);
      owed = null;
      s.dispose();
    },
  });
}
