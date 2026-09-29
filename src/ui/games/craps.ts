import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function die(v: number): HTMLElement {
  const d = h('div', { class: 'die' });
  for (let i = 0; i < 9; i++) d.appendChild(h('i', { class: PIPS[v].includes(i) ? 'on' : '' }));
  return d;
}

/** Craps: a pass line bet with a point, plus an optional one-roll field bet. */
export function openCraps(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min, s.max);
  let bet = chips[0];
  let field = false;
  let point = 0;
  let passStake = 0;
  let busy = false;
  const dice = h('div', { class: 'dice' }, die(3), die(4));
  const puck = h('div', { class: 'puck', text: 'OFF' });
  const result = resultLine();
  const betLabel = h('b', { text: formatMoney(bet) });
  const fieldBtn = h('button', { class: 'btn small', text: 'Field bet: off' });
  const rollBtn = h('button', { class: 'btn gold tg-main', text: 'Roll (pass line)' });
  const chipsEl = chipRow(chips, () => bet, (v) => {
    if (point) return;
    bet = v;
    betLabel.textContent = formatMoney(bet);
  });
  const refresh = () => {
    puck.textContent = point ? `POINT ${point}` : 'OFF';
    puck.classList.toggle('on', !!point);
    rollBtn.textContent = point ? `Roll for ${point}` : `Come out · ${formatMoney(bet)} on the pass line`;
    fieldBtn.textContent = `Field bet: ${field ? `on (${formatMoney(bet)} a roll)` : 'off'}`;
    chipsEl.classList.toggle('disabled', !!point);
  };
  fieldBtn.addEventListener('click', () => {
    field = !field;
    audio.play('click');
    refresh();
  });
  rollBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    let stake = 0;
    if (!point) {
      if (!s.bet(bet)) return;
      passStake = bet;
    }
    if (field) {
      if (s.bet(bet)) stake += bet;
    }
    busy = true;
    setResult(result, '');
    audio.play('dice');
    dice.classList.add('rolling');
    for (let i = 0; i < 7; i++) {
      dice.replaceChildren(die(1 + Math.floor(Math.random() * 6)), die(1 + Math.floor(Math.random() * 6)));
      await sleep(90);
    }
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    const sum = a + b;
    dice.classList.remove('rolling');
    dice.replaceChildren(die(a), die(b));
    const notes: string[] = [];
    let payout = 0;
    // Field (one roll)
    if (stake) {
      const fm = sum === 2 || sum === 12 ? 3 : [3, 4, 9, 10, 11].includes(sum) ? 2 : 0;
      payout += stake * fm;
      notes.push(fm ? `Field pays ${fm - 1}:1` : 'Field loses');
    }
    // Pass line
    let passDone = false;
    if (!point) {
      if (sum === 7 || sum === 11) {
        payout += passStake * 2;
        passDone = true;
        notes.unshift(`${sum}! Natural winner`);
      } else if (sum === 2 || sum === 3 || sum === 12) {
        passDone = true;
        notes.unshift(`${sum}: craps, pass line loses`);
      } else {
        point = sum;
        notes.unshift(`Point is ${sum}`);
      }
    } else if (sum === point) {
      payout += passStake * 2;
      passDone = true;
      notes.unshift(`${sum}! Point made`);
    } else if (sum === 7) {
      passDone = true;
      notes.unshift('Seven out');
    } else {
      notes.unshift(`Rolled ${sum}, keep rolling for ${point}`);
    }
    const settleStake = stake + (passDone ? passStake : 0);
    if (settleStake > 0) s.settle(settleStake, payout);
    if (passDone) {
      point = 0;
      passStake = 0;
    }
    const net = payout - settleStake;
    setResult(result, `${notes.join(' · ')}${settleStake ? `  ${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}` : ''}`, net > 0 ? 'win' : net < 0 ? 'lose' : '');
    busy = false;
    refresh();
  });
  refresh();
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt craps-felt' }, puck, dice, h('div', { class: 'felt-rule', text: 'PASS LINE PAYS 1:1 · FIELD 2, 3, 4, 9, 10, 11, 12 (2 & 12 PAY DOUBLE)' })),
    result,
    h('div', { class: 'tg-betline' }, 'Bet ', betLabel),
    chipsEl,
    fieldBtn,
    rollBtn,
  );
  ctx.modals.open('Craps', body, {
    cls: 'minigame table-game',
    onClose: () => {
      // Walking away mid-point forfeits the pass line bet, like at a real table.
      if (point && passStake && !s.closed) s.settle(passStake, 0);
      s.dispose();
    },
  });
}
