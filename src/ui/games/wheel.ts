import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { WHEEL_SEGMENTS } from '../../render/textures';
import { bigSixPays } from '../../items/rules';
import { type GameCtx, Session, chipRow, chipStack, chipValues, resultLine, setResult } from './common';

const N = WHEEL_SEGMENTS.length;
const TAU = Math.PI * 2;
const SEG = TAU / N;
const SPIN_S = 5.2;
const SYMBOLS = [1, 2, 5, 10, 20, 40, 41];
/** Banknote colours for the bill segments, then the Joker and the casino logo. */
const BILL: Record<number, [string, string]> = {
  1: ['#cfe3c4', '#2f6b3a'], 2: ['#cfe0e8', '#2a5a7a'], 5: ['#e8d8f2', '#5a2f7a'], 10: ['#f2e6c4', '#7a5a1a'],
  20: ['#f2d4c4', '#7a3a1a'], 40: ['#17151f', '#ffd24a'], 41: ['#c8102e', '#ffe46b'],
};
const NAME = (m: number) => (m === 40 ? 'Joker' : m === 41 ? 'Logo' : `$${m}`);

/**
 * The Big Six (money wheel): 54 stops of $1, $2, $5, $10 and $20 bills plus a Joker and
 * the casino logo. Bet on as many symbols as you like; the wheel is spun by hand, the
 * pegs clack past the leather flapper and it stops where it stops. Each symbol pays the
 * number on it; the Joker and the logo pay 40 to 1.
 */
export function openWheel(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[0];
  let busy = false;
  const bets = new Map<number, number>();
  let last: Map<number, number> | null = null;
  let owed: { stake: number; paid: number } | null = null;
  const result = resultLine();
  const totalEl = h('b');
  const hosts = new Map<number, HTMLElement>();
  const history: number[] = [];
  const histEl = h('div', { class: 'cr-rolls' });

  // ------------------------------------------------------------------ the wheel
  const css = window.innerWidth < 520 ? 210 : 250;
  const canvas = h('canvas', { class: 'bw-canvas' });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const S = Math.round(css * dpr);
  canvas.width = canvas.height = S;
  canvas.style.width = canvas.style.height = `${css}px`;
  const g = canvas.getContext('2d')!;
  const face = paintFace(S);
  let rot = -Math.floor(Math.random() * N) * SEG;
  let flap = 0;
  let raf = 0;
  const draw = () => {
    const R = S / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(R, R);
    g.rotate(rot);
    g.drawImage(face, -R, -R);
    g.restore();
    // The leather flapper at the top, bent by the last peg.
    g.save();
    g.translate(R, R * 0.02);
    g.rotate(flap);
    g.fillStyle = '#5a2e14';
    g.strokeStyle = '#2a1408';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-R * 0.05, 0);
    g.lineTo(R * 0.05, 0);
    g.lineTo(R * 0.012, R * 0.15);
    g.lineTo(-R * 0.012, R * 0.15);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#d9b25a';
    g.beginPath();
    g.arc(0, R * 0.02, R * 0.025, 0, TAU);
    g.fill();
    g.restore();
  };
  draw();

  const spinTo = (seg: number) => new Promise<void>((resolve) => {
    const from = rot;
    // Segment `seg` ends up under the flapper, a little off-centre like a real stop.
    const want = -seg * SEG + (Math.random() - 0.5) * SEG * 0.6;
    const delta = ((want - from) % TAU + TAU) % TAU;
    const to = from + 4 * TAU + delta;
    const t0 = performance.now();
    let lastPeg = Math.floor(from / SEG + 0.5);
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / (SPIN_S * 1000));
      const e = 1 - (1 - t) ** 4;
      rot = from + (to - from) * e;
      const pos = rot / SEG + 0.5;
      const peg = Math.floor(pos);
      if (peg !== lastPeg) {
        lastPeg = peg;
        audio.play('tick', { volume: 0.35, pitch: 1.1 + Math.random() * 0.2 });
      }
      // The flapper is pushed over as a peg comes by, then springs back.
      flap = -Math.max(0, 0.45 - (pos - peg) * 1.4);
      draw();
      if (t < 1) raf = requestAnimationFrame(frame);
      else {
        flap = 0;
        draw();
        resolve();
      }
    };
    raf = requestAnimationFrame(frame);
  });

  // ------------------------------------------------------------------ the layout
  const layout = h('div', { class: 'bw-layout' }, ...SYMBOLS.map((m) => {
    const count = WHEEL_SEGMENTS.filter((x) => x.mult === m).length;
    const [bg, ink] = BILL[m];
    const el = h('button', {
      class: `bw-bill${m >= 40 ? ' special' : ''}`, style: `--bg:${bg};--ink:${ink}`,
      onClick: () => {
        if (busy) return;
        bets.set(m, (bets.get(m) ?? 0) + chip);
        audio.play('chips', { volume: 0.5 });
        render();
      },
    }, h('b', { text: m === 40 ? '★ JOKER' : m === 41 ? '♛ LOGO' : `$${m}` }), h('small', { text: `${bigSixPays(m)} to 1 · ${count} of ${N}` }));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (busy || !bets.get(m)) return;
      const left = bets.get(m)! - chip;
      if (left > 0) bets.set(m, left);
      else bets.delete(m);
      render();
    });
    hosts.set(m, el);
    return el;
  }));
  const render = () => {
    let t = 0;
    for (const [m, el] of hosts) {
      el.querySelector(':scope > .cstack')?.remove();
      const a = bets.get(m) ?? 0;
      t += a;
      el.classList.toggle('on', a > 0);
      if (a) el.appendChild(chipStack(a));
    }
    totalEl.textContent = formatMoney(t);
    histEl.replaceChildren(h('small', { text: 'LAST' }), ...history.slice(-12).reverse().map((m) => h('span', { class: 'cr-r', style: `background:${WHEEL_SEGMENTS.find((x) => x.mult === m)!.color}`, text: m >= 40 ? (m === 40 ? '★' : '♛') : `$${m}` })));
  };

  const spin = h('button', { class: 'btn gold tg-main', text: 'Spin the wheel' });
  spin.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!bets.size && last) for (const [k, v] of last) bets.set(k, v);
    let stake = 0;
    bets.forEach((v) => (stake += v));
    if (!stake) {
      audio.play('error');
      setResult(result, 'Put chips on a symbol first.', 'lose');
      return;
    }
    if (!s.bet(stake)) return;
    busy = true;
    last = new Map(bets);
    spin.disabled = true;
    render();
    setResult(result, 'Round she goes…');
    const seg = Math.floor(Math.random() * N);
    const landed = WHEEL_SEGMENTS[seg];
    let paid = 0;
    bets.forEach((amt, m) => (paid += m === landed.mult ? amt * (bigSixPays(m) + 1) : 0));
    owed = { stake, paid };
    s.animate({ kind: 'wheel', segment: seg }, SPIN_S);
    await spinTo(seg);
    if (s.closed) return;
    owed = null;
    s.settle(stake, paid);
    history.push(landed.mult);
    hosts.get(landed.mult)?.classList.add('hit');
    const net = paid - stake;
    setResult(result, `${NAME(landed.mult)}!  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : 'even'}`, net > 0 ? (landed.mult >= 10 ? 'big' : 'win') : net < 0 ? 'lose' : '');
    window.setTimeout(() => hosts.get(landed.mult)?.classList.remove('hit'), 1800);
    bets.clear();
    busy = false;
    spin.disabled = false;
    render();
  });
  render();
  setResult(result, 'Bet on the bills, the Joker or the logo.');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'bw-stand' }, canvas),
    histEl,
    result,
    layout,
    h('div', { class: 'tg-betline' }, 'On the layout ', totalEl, ' · right-click takes a chip back'),
    chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank }),
    h('div', { class: 'tg-actions' },
      h('button', { class: 'btn', text: 'Clear', onClick: () => { if (!busy) { bets.clear(); render(); } } }),
      spin),
  );
  ctx.modals.open('Big Six Wheel', body, {
    cls: 'minigame table-game',
    onClose: () => {
      cancelAnimationFrame(raf);
      if (owed && !s.closed) s.settle(owed.stake, owed.paid);
      owed = null;
      s.dispose();
    },
  });
}

/** The wheel's face: banknote panels between brass pegs, on a lit rim. */
function paintFace(S: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = S / 2;
  g.translate(R, R);
  // Rim.
  const rim = g.createRadialGradient(0, 0, R * 0.85, 0, 0, R);
  rim.addColorStop(0, '#6b3a1c');
  rim.addColorStop(0.5, '#b8862e');
  rim.addColorStop(1, '#4a2410');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  for (let i = 0; i < N; i++) {
    const m = WHEEL_SEGMENTS[i].mult;
    const a0 = i * SEG - Math.PI / 2 - SEG / 2;
    const a1 = a0 + SEG;
    const [bg, ink] = BILL[m];
    // Panel.
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(Math.cos(a0) * R * 0.3, Math.sin(a0) * R * 0.3);
    g.arc(0, 0, R * 0.86, a0, a1);
    g.arc(0, 0, R * 0.3, a1, a0, true);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.stroke();
    // A coloured band like the edge of a bill, then the value.
    g.fillStyle = WHEEL_SEGMENTS[i].color;
    g.beginPath();
    g.arc(0, 0, R * 0.86, a0, a1);
    g.arc(0, 0, R * 0.79, a1, a0, true);
    g.closePath();
    g.fill();
    const am = (a0 + a1) / 2;
    g.save();
    g.rotate(am + Math.PI / 2);
    g.translate(0, -R * 0.62);
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(R * (m >= 10 && m < 40 ? 0.07 : 0.085))}px Nunito, Arial, sans-serif`;
    g.fillText(m === 40 ? '★' : m === 41 ? '♛' : String(m), 0, 0);
    g.font = `800 ${Math.round(R * 0.04)}px Nunito, Arial, sans-serif`;
    g.fillText(m >= 40 ? (m === 40 ? 'JKR' : 'LOGO') : '$', 0, R * 0.12);
    g.restore();
  }
  // Brass pegs between the stops.
  for (let i = 0; i < N; i++) {
    const a = i * SEG - Math.PI / 2 - SEG / 2;
    const x = Math.cos(a) * R * 0.92;
    const y = Math.sin(a) * R * 0.92;
    const pg = g.createRadialGradient(x - 1, y - 1, 0, x, y, R * 0.022);
    pg.addColorStop(0, '#fff6d8');
    pg.addColorStop(1, '#a8782a');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(x, y, R * 0.02, 0, TAU);
    g.fill();
  }
  // Hub.
  const hub = g.createRadialGradient(-R * 0.05, -R * 0.05, 2, 0, 0, R * 0.3);
  hub.addColorStop(0, '#fff2a8');
  hub.addColorStop(0.6, '#d9a400');
  hub.addColorStop(1, '#7a5a00');
  g.fillStyle = hub;
  g.beginPath();
  g.arc(0, 0, R * 0.29, 0, TAU);
  g.fill();
  g.fillStyle = '#5a0412';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `400 ${Math.round(R * 0.09)}px Bungee, "Arial Black", sans-serif`;
  g.fillText('BIG 6', 0, 0);
  return c;
}
