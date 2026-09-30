import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { passOddsPays, dontPassOddsPays } from '../../items/rules';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function die(v: number): HTMLElement {
  const d = h('div', { class: 'die' });
  for (let i = 0; i < 9; i++) d.appendChild(h('i', { class: PIPS[v].includes(i) ? 'on' : '' }));
  return d;
}

type BetKey =
  | 'pass' | 'dontpass' | 'passodds' | 'dontodds' | 'field' | 'any7' | 'anycraps' | 'yo' | 'aces' | 'boxcars'
  | 'hard4' | 'hard6' | 'hard8' | 'hard10';

interface BetInfo {
  key: BetKey;
  label: string;
  pays: string;
  /** Only placeable with no point (true) / only with a point (false) / any time (undefined). */
  comeOut?: boolean;
  oneRoll?: boolean;
}

const BETS: BetInfo[] = [
  { key: 'pass', label: 'Pass Line', pays: '1:1', comeOut: true },
  { key: 'dontpass', label: "Don't Pass", pays: '1:1 (12 pushes)', comeOut: true },
  { key: 'passodds', label: 'Pass Odds', pays: 'true odds', comeOut: false },
  { key: 'dontodds', label: "Don't Odds", pays: 'true odds', comeOut: false },
  { key: 'field', label: 'Field', pays: '1:1 · 2 pays 2:1 · 12 pays 3:1', oneRoll: true },
  { key: 'any7', label: 'Any Seven', pays: '4:1', oneRoll: true },
  { key: 'anycraps', label: 'Any Craps', pays: '7:1', oneRoll: true },
  { key: 'yo', label: 'Yo-leven', pays: '15:1', oneRoll: true },
  { key: 'aces', label: 'Aces (2)', pays: '30:1', oneRoll: true },
  { key: 'boxcars', label: 'Boxcars (12)', pays: '30:1', oneRoll: true },
  { key: 'hard4', label: 'Hard 4', pays: '7:1' },
  { key: 'hard6', label: 'Hard 6', pays: '9:1' },
  { key: 'hard8', label: 'Hard 8', pays: '9:1' },
  { key: 'hard10', label: 'Hard 10', pays: '7:1' },
];

/**
 * Casino craps as dealt in Las Vegas: pass/don't pass with a point, free odds at true
 * odds, the field (2 pays double, 12 triple), hardways and the one-roll propositions.
 */
export function openCraps(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let point = 0;
  let busy = false;
  /** Bets on the layout; `live` ones have already been paid for. */
  const bets = new Map<BetKey, { amount: number; live: boolean }>();
  const dice = h('div', { class: 'dice' }, die(3), die(4));
  const puck = h('div', { class: 'puck', text: 'OFF' });
  const result = resultLine();
  const layout = h('div', { class: 'cr-layout' });
  const totalEl = h('b');

  const renderLayout = () => {
    layout.replaceChildren(...BETS.map((b) => {
      const allowed = b.comeOut === undefined || (b.comeOut ? point === 0 : point !== 0);
      const cur = bets.get(b.key);
      const locked = (b.key === 'pass' && point !== 0 && cur?.live) || busy;
      return h('button', {
        class: `cr-bet${cur ? ' on' : ''}${b.oneRoll ? ' prop' : ''}`, disabled: !allowed || !!locked,
        onClick: () => {
          const now = bets.get(b.key);
          if ((b.key === 'passodds' && !bets.get('pass')) || (b.key === 'dontodds' && !bets.get('dontpass'))) {
            audio.play('error');
            setResult(result, `Odds go behind a ${b.key === 'passodds' ? 'Pass Line' : "Don't Pass"} bet.`, 'lose');
            return;
          }
          bets.set(b.key, { amount: (now?.amount ?? 0) + chip, live: now?.live ?? false });
          if (now?.live) {
            // Adding to a working bet: pay for the extra chips now.
            if (!s.bet(chip)) bets.set(b.key, now);
          } else audio.play('chips', { volume: 0.5 });
          render();
        },
      },
      h('span', { class: 'cr-name', text: b.label }),
      h('small', { text: b.key === 'passodds' && point ? `${passOddsPays(point)}:1 on ${point}` : b.key === 'dontodds' && point ? `${Math.round(dontPassOddsPays(point) * 100) / 100}:1` : b.pays }),
      cur ? h('span', { class: 'rb-chip', text: cur.amount >= 1000 ? `${Math.round(cur.amount / 100) / 10}K` : String(cur.amount) }) : null);
    }));
  };
  const render = () => {
    puck.textContent = point ? `POINT ${point}` : 'OFF';
    puck.classList.toggle('on', !!point);
    let t = 0;
    bets.forEach((b) => (t += b.amount));
    totalEl.textContent = formatMoney(t);
    renderLayout();
  };

  const roll = async () => {
    if (busy || s.closed) return;
    if (!point && !bets.get('pass') && !bets.get('dontpass') && ![...bets.keys()].some((k) => BETS.find((b) => b.key === k)?.oneRoll || k.startsWith('hard'))) {
      audio.play('error');
      setResult(result, 'Put a bet down first (the Pass Line is the classic).', 'lose');
      return;
    }
    // Pay for everything newly placed.
    let fresh = 0;
    bets.forEach((b) => {
      if (!b.live) fresh += b.amount;
    });
    if (fresh > 0 && !s.bet(fresh)) return;
    bets.forEach((b) => (b.live = true));
    busy = true;
    render();
    setResult(result, '');
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    s.animate({ kind: 'craps', dice: [a, b] }, 2.2);
    audio.play('dice');
    dice.classList.add('rolling');
    for (let i = 0; i < 8; i++) {
      dice.replaceChildren(die(1 + Math.floor(Math.random() * 6)), die(1 + Math.floor(Math.random() * 6)));
      await sleep(95);
    }
    dice.classList.remove('rolling');
    dice.replaceChildren(die(a), die(b));
    const sum = a + b;
    const hard = a === b;
    let staked = 0;
    let paid = 0;
    const notes: string[] = [];
    const settleBet = (k: BetKey, returned: number, note?: string) => {
      const bt = bets.get(k);
      if (!bt) return;
      staked += bt.amount;
      paid += returned;
      bets.delete(k);
      if (note) notes.push(note);
    };
    const amt = (k: BetKey) => bets.get(k)?.amount ?? 0;
    // One-roll bets
    if (bets.has('field')) {
      const m = sum === 2 ? 3 : sum === 12 ? 4 : [3, 4, 9, 10, 11].includes(sum) ? 2 : 0;
      settleBet('field', amt('field') * m, m ? `Field wins${m > 2 ? ` ${m - 1}:1` : ''}` : 'Field loses');
    }
    if (bets.has('any7')) settleBet('any7', sum === 7 ? amt('any7') * 5 : 0, sum === 7 ? 'Any 7 pays 4:1' : undefined);
    if (bets.has('anycraps')) settleBet('anycraps', [2, 3, 12].includes(sum) ? amt('anycraps') * 8 : 0, [2, 3, 12].includes(sum) ? 'Any craps pays 7:1' : undefined);
    if (bets.has('yo')) settleBet('yo', sum === 11 ? amt('yo') * 16 : 0, sum === 11 ? 'YO! 15:1' : undefined);
    if (bets.has('aces')) settleBet('aces', sum === 2 ? amt('aces') * 31 : 0, sum === 2 ? 'Aces! 30:1' : undefined);
    if (bets.has('boxcars')) settleBet('boxcars', sum === 12 ? amt('boxcars') * 31 : 0, sum === 12 ? 'Boxcars! 30:1' : undefined);
    // Hardways stay up until they hit hard, roll easy, or a 7 shows.
    for (const [k, n, pays] of [['hard4', 4, 7], ['hard6', 6, 9], ['hard8', 8, 9], ['hard10', 10, 7]] as [BetKey, number, number][]) {
      if (!bets.has(k)) continue;
      if (sum === n && hard) settleBet(k, amt(k) * (pays + 1), `Hard ${n}! ${pays}:1`);
      else if (sum === n || sum === 7) settleBet(k, 0, `${k.replace('hard', 'Hard ')} loses`);
    }
    // Line bets
    if (!point) {
      if (sum === 7 || sum === 11) {
        settleBet('pass', amt('pass') * 2, `${sum}: natural, Pass wins`);
        settleBet('dontpass', 0);
      } else if (sum === 2 || sum === 3 || sum === 12) {
        settleBet('pass', 0, `${sum}: craps`);
        settleBet('dontpass', sum === 12 ? amt('dontpass') : amt('dontpass') * 2, sum === 12 ? "Don't Pass pushes on 12" : "Don't Pass wins");
      } else {
        point = sum;
        notes.unshift(`The point is ${sum}`);
      }
    } else if (sum === point) {
      settleBet('pass', amt('pass') * 2, `${sum}! Point made`);
      settleBet('passodds', amt('passodds') * (1 + passOddsPays(point)));
      settleBet('dontpass', 0);
      settleBet('dontodds', 0);
      point = 0;
    } else if (sum === 7) {
      settleBet('pass', 0, 'Seven out');
      settleBet('passodds', 0);
      settleBet('dontpass', amt('dontpass') * 2, bets.has('dontpass') ? "Don't Pass wins" : undefined);
      settleBet('dontodds', amt('dontodds') * (1 + dontPassOddsPays(point)));
      point = 0;
    } else if (!notes.length) notes.push(`Rolled ${sum}. Still looking for ${point}`);
    paid = Math.round(paid);
    if (staked > 0) s.settle(staked, paid);
    const net = paid - staked;
    setResult(result, `${a} + ${b} = ${sum} · ${notes.join(' · ') || 'No decision'}${staked ? `  ${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    render();
  };
  const clearBtn = h('button', {
    class: 'btn', text: 'Take down bets',
    onClick: () => {
      if (busy) return;
      // Contract bets on a point (Pass Line) must stay; everything else comes back.
      let refund = 0;
      for (const [k, b] of [...bets]) {
        if (k === 'pass' && point) continue;
        if (b.live) refund += b.amount;
        bets.delete(k);
      }
      if (refund) s.settle(refund, refund);
      render();
      audio.play('click');
    },
  });
  render();
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt craps-felt' }, puck, dice, h('div', { class: 'felt-rule', text: 'FREE ODDS AT TRUE ODDS · 4/10 PAY 2:1 · 5/9 PAY 3:2 · 6/8 PAY 6:5' })),
    result,
    layout,
    h('div', { class: 'tg-betline' }, 'On the layout ', totalEl, ' · click a bet to add a chip'),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' }, clearBtn, h('button', { class: 'btn gold tg-main', text: 'Roll the dice', onClick: () => void roll() })),
  );
  ctx.modals.open('Craps', body, {
    cls: 'minigame table-game wide-game',
    onClose: () => {
      // Walking away: the Pass Line on a point is lost, everything else is taken down.
      let staked = 0;
      let back = 0;
      for (const [k, b] of bets) {
        if (!b.live) continue;
        staked += b.amount;
        if (!(k === 'pass' && point)) back += b.amount;
      }
      if (staked && !s.closed) s.settle(staked, back);
      s.dispose();
    },
  });
}
