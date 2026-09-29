import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { WHEEL_SEGMENTS, bigWheelTexture } from '../../render/textures';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

let url: string | null = null;

/** Big Six wheel: bet on a symbol, it pays its number to one (the star pays 20:1). */
export function openWheel(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let pickOn = 1;
  let busy = false;
  let rot = 0;
  url ??= (bigWheelTexture().image as HTMLCanvasElement).toDataURL();
  const img = h('img', { class: 'rw-img', src: url, alt: 'Big wheel' });
  const result = resultLine();
  const opts = [1, 2, 5, 10, 20, 40];
  const pays = (m: number) => (m === 40 ? 20 : m);
  const row = h('div', { class: 'bw-opts' });
  const render = () => {
    row.replaceChildren(...opts.map((m) => {
      const seg = WHEEL_SEGMENTS.find((x) => x.mult === m)!;
      const count = WHEEL_SEGMENTS.filter((x) => x.mult === m).length;
      return h('button', {
        class: `bw-opt${m === pickOn ? ' on' : ''}`, style: `--c:${seg.color}`,
        onClick: () => {
          if (!busy) {
            pickOn = m;
            render();
            audio.play('click');
          }
        },
      }, h('b', { text: seg.label }), h('small', { text: `${pays(m)}:1 · ${count}/${WHEEL_SEGMENTS.length}` }));
    }));
  };
  render();
  const spin = h('button', { class: 'btn gold tg-main', text: 'Spin the wheel' });
  spin.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!s.bet(chip)) return;
    busy = true;
    setResult(result, '');
    const seg = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    rot = Math.floor(rot / 360) * 360 - (4 * 360 + (seg / WHEEL_SEGMENTS.length) * 360);
    img.style.transition = 'transform 3.2s cubic-bezier(0.15, 0.7, 0.2, 1)';
    img.style.transform = `rotate(${rot}deg)`;
    for (let i = 0; i < 12; i++) {
      await sleep(i < 8 ? 160 : 260);
      audio.play('tick', { volume: 0.5 });
    }
    await sleep(300);
    const landed = WHEEL_SEGMENTS[seg];
    const win = landed.mult === pickOn;
    const payout = win ? chip * (pays(pickOn) + 1) : 0;
    s.settle(chip, payout);
    setResult(result, win ? `${landed.label}! +${formatMoney(payout - chip)}` : `Landed on ${landed.label}  −${formatMoney(chip)}`, win ? (pickOn >= 10 ? 'big' : 'win') : 'lose');
    busy = false;
  });
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'rw big' }, h('div', { class: 'rw-pointer' }), img),
    result,
    row,
    h('div', { class: 'tg-betline', text: 'Bet' }),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    spin,
  );
  ctx.modals.open('Big Wheel', body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
