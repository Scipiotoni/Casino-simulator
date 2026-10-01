import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear, icon } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { VAULT_TIERS, vaultTier } from '../game/house';

const STEEL = ['#9aa0ab', '#6f7480', '#7d93ad', '#e6f0fb', '#f2c14e'];

/** Typing pad shared by "open" and "pick a code". Calls `done` with the digits. */
function keypad(digits: number, onEnter: (code: string) => void, opts: { title: string; sub: string; hideDigits?: boolean } ): { el: HTMLElement; shake: (msg: string) => void; reset: () => void } {
  let code = '';
  let sent = false;
  const submit = () => {
    if (sent || code.length !== digits) return;
    sent = true;
    onEnter(code);
  };
  const display = h('div', { class: 'kp-display' });
  const msg = h('div', { class: 'kp-msg', text: opts.sub });
  const render = () => {
    clear(display);
    for (let i = 0; i < digits; i++) {
      const filled = i < code.length;
      display.appendChild(h('span', { class: `kp-slot${filled ? ' on' : ''}`, text: filled ? (opts.hideDigits ? '●' : code[i]) : '' }));
    }
  };
  const press = (k: string) => {
    if (k === 'C') {
      code = '';
      sent = false;
    } else if (k === '⏎') {
      if (code.length === digits) submit();
      else audio.play('keyError');
      return;
    } else if (code.length < digits) code += k;
    audio.play('keyBeep', { pitch: 0.9 + Number(k || 0) * 0.03 });
    render();
    if (code.length === digits && k !== 'C') window.setTimeout(submit, 220);
  };
  const pad = h('div', { class: 'kp-keys' });
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⏎']) {
    pad.appendChild(h('button', { class: `kp-key${k === 'C' ? ' clr' : k === '⏎' ? ' ok' : ''}`, text: k, onClick: () => press(k) }));
  }
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') {
      code = code.slice(0, -1);
      sent = false;
      render();
    } else if (e.key === 'Enter') press('⏎');
    else return;
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  const el = h('div', { class: 'keypad' }, h('div', { class: 'kp-title', text: opts.title }), display, msg, pad);
  render();
  return {
    el,
    shake: (m: string) => {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      msg.textContent = m;
      msg.classList.add('bad');
      code = '';
      sent = false;
      render();
    },
    reset: () => {
      code = '';
      sent = false;
      render();
    },
  };
}

/**
 * The vault, start to finish: pick a code the first time, type it to open the door (with
 * the unlock animation), then move money between the vault, the casino and the hotel.
 */
export function openVault(game: Game, modals: Modals): void {
  const g = game;
  const hs = g.house;
  if (!hs || !hs.tier) return;
  if (g.vaultOpen) {
    openBank(g, modals);
    return;
  }
  const t = vaultTier(hs.tier)!;
  if (!hs.code) {
    pickCode(g, modals, t.digits, `Pick a ${t.digits}-digit code for your ${t.name}`, (code) => {
      g.setVaultCode(code);
      modals.close();
      openVault(g, modals);
    });
    return;
  }
  const locked = () => Math.ceil((g.vaultLockUntil - Date.now()) / 1000);
  const kp = keypad(t.digits, (code) => {
    const r = g.tryVaultCode(code);
    if (r === 'open') {
      modals.close();
      playUnlock(g, code, () => {
        g.openVault();
        openBank(g, modals);
      });
    } else if (r === 'locked') {
      audio.play('keyError');
      kp.shake(`LOCKED · try again in ${locked()}s`);
    } else {
      audio.play('keyError');
      kp.shake('WRONG CODE');
    }
  }, { title: t.name.toUpperCase(), sub: g.vaultLockUntil > Date.now() ? `LOCKED · ${locked()}s` : `ENTER ${t.digits}-DIGIT CODE`, hideDigits: true });
  modals.open('Vault', h('div', { class: 'stack vault-pad', style: `--steel:${STEEL[hs.tier - 1]}` }, kp.el), { cls: 'small vault-modal' });
}

/** Choose a new code (typed twice so a slip of the finger can't lock you out). */
function pickCode(g: Game, modals: Modals, digits: number, title: string, done: (code: string) => void): void {
  let first = '';
  const body = h('div', { class: 'stack vault-pad' });
  const step = () => {
    clear(body);
    const kp = keypad(digits, (code) => {
      if (!first) {
        first = code;
        audio.play('keyBeep', { pitch: 1.4 });
        step();
        return;
      }
      if (code !== first) {
        first = '';
        audio.play('keyError');
        step();
        g.notify('The two codes didn’t match. Try again.', 'bad');
        return;
      }
      done(code);
    }, { title: first ? 'TYPE IT AGAIN' : 'NEW CODE', sub: first ? 'To be sure' : title });
    body.appendChild(kp.el);
    body.appendChild(h('p', { class: 'muted small', text: 'Only you know it. Forget it and you’ll have to guess (three wrong tries lock the vault for 30 seconds).' }));
  };
  step();
  modals.open('Vault code', body, { cls: 'small vault-modal' });
}

/** Where the unlock animation is at time `t` (ms). Pure, so it's easy to reason about. */
interface UnlockState {
  digits: number;
  dial: number;
  bolts: number;
  wheel: number;
  steam: number;
  door: number;
  glow: number;
}

function unlockPlan(code: string, bolts: number) {
  const step = 240;
  const digitsEnd = 150 + code.length * step;
  const granted = digitsEnd + 150;
  const boltsAt = granted + 350;
  const boltsEnd = boltsAt + bolts * 70 + 200;
  const wheelAt = boltsEnd + 120;
  const wheelEnd = wheelAt + 950;
  const steamAt = wheelEnd;
  const doorAt = steamAt + 450;
  const doorEnd = doorAt + 1300;
  const end = doorEnd + 600;
  return { step, digitsEnd, granted, boltsAt, boltsEnd, wheelAt, wheelEnd, steamAt, doorAt, doorEnd, end };
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function unlockState(t: number, code: string, bolts: number): UnlockState {
  const p = unlockPlan(code, bolts);
  const digits = Math.max(0, Math.min(code.length, Math.floor((t - 150) / p.step) + 1));
  // The dial spins to each digit, alternating direction, like a real combination lock.
  let dial = 0;
  for (let i = 0; i < code.length; i++) {
    const t0 = 150 + i * p.step;
    const k = ease((t - t0) / (p.step * 0.8));
    dial += (i % 2 ? -1 : 1) * (Math.PI * 2 + (Number(code[i]) / 10) * Math.PI * 2) * k;
  }
  const boltK = Math.max(0, Math.min(1, (t - p.boltsAt) / (bolts * 70 + 200)));
  return {
    digits: t < 150 ? 0 : digits,
    dial,
    bolts: boltK,
    wheel: -ease((t - p.wheelAt) / (p.wheelEnd - p.wheelAt)) * Math.PI * 5,
    steam: t < p.steamAt ? 0 : Math.min(1, (t - p.steamAt) / 1100),
    door: ease((t - p.doorAt) / (p.doorEnd - p.doorAt)) * (Math.PI * 0.6),
    glow: Math.max(0, Math.min(1, (t - p.doorAt) / 900)),
  };
}

/** Draw the vault face-on: steel frame, the round door on its hinge, bolts, wheel, dial and readout. */
function drawVault(ctx: CanvasRenderingContext2D, W: number, H: number, st: UnlockState, code: string, nBolts: number, steel: string, cash: string, t: number): void {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.36;
  // Frame plate with rivets and hazard stripes
  const plate = Math.min(W, H) * 0.47;
  const pg = ctx.createLinearGradient(cx - plate, cy - plate, cx + plate, cy + plate);
  pg.addColorStop(0, '#4c4f58');
  pg.addColorStop(1, '#232429');
  ctx.fillStyle = pg;
  roundRectPath(ctx, cx - plate, cy - plate, plate * 2, plate * 2, plate * 0.08);
  ctx.fill();
  ctx.strokeStyle = '#5d606a';
  ctx.lineWidth = 3;
  ctx.stroke();
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#7d828d';
      ctx.beginPath();
      ctx.arc(cx + sx * (plate * 0.88) - sx * i * plate * 0.07, cy + sy * plate * 0.88, plate * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const stripeY = cy + plate * 0.95;
  for (let i = -6; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#ffd23f' : '#17151f';
    ctx.fillRect(cx + i * plate * 0.12, stripeY - plate * 0.03, plate * 0.12, plate * 0.03);
  }
  // Recess ring
  const ring = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.2, cx, cy, R * 1.12);
  ring.addColorStop(0, '#e7ebf1');
  ring.addColorStop(0.6, steel);
  ring.addColorStop(1, '#4c515c');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
  ctx.fill();
  // Inside: gold, cash and light
  const inside = ctx.createRadialGradient(cx, cy + R * 0.2, R * 0.05, cx, cy, R);
  inside.addColorStop(0, `rgba(255, 236, 170, ${0.4 + st.glow * 0.6})`);
  inside.addColorStop(0.45, '#c9861a');
  inside.addColorStop(1, '#1c1204');
  ctx.fillStyle = inside;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  // Stacked gold bars
  const bw = R * 0.34;
  const bh = R * 0.12;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 5 - row; i++) {
      const x = cx - ((5 - row) * bw) / 2 + i * bw;
      const y = cy + R * 0.62 - row * bh;
      const g = ctx.createLinearGradient(x, y - bh, x, y);
      g.addColorStop(0, '#fff1b0');
      g.addColorStop(1, '#c8901f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.08, y - bh);
      ctx.lineTo(x + bw * 0.92, y - bh);
      ctx.lineTo(x + bw, y);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 10, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (st.glow > 0) {
    ctx.globalAlpha = st.glow;
    ctx.fillStyle = '#fff4d6';
    ctx.font = `400 ${Math.round(R * 0.2)}px Bungee, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillText(cash, cx, cy - R * 0.25);
    ctx.shadowBlur = 0;
    // Sparkles on the gold
    for (let i = 0; i < 10; i++) {
      const a = (t / 400 + i * 1.7) % 1;
      const sx = cx + Math.sin(i * 12.9) * R * 0.6;
      const sy = cy + R * 0.3 + Math.cos(i * 7.3) * R * 0.25;
      ctx.globalAlpha = st.glow * Math.sin(a * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, R * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // The door swings on its left hinge: squeeze it towards the hinge and show its thick edge.
  const hingeX = cx - R;
  const k = Math.cos(st.door);
  const thick = R * 0.22 * Math.sin(st.door);
  ctx.save();
  ctx.translate(hingeX, cy);
  ctx.scale(Math.max(0.02, k), 1);
  ctx.translate(-hingeX, -cy);
  // Edge (drawn first, it shows on the far side as the door turns)
  if (thick > 0.5) {
    ctx.fillStyle = '#5a5f6b';
    ctx.beginPath();
    ctx.ellipse(cx + thick / Math.max(0.02, k), cy, R, R, 0, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(cx, cy + R);
    ctx.ellipse(cx, cy, R, R, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  // Bolts stick out of the rim until they're drawn back
  for (let i = 0; i < nBolts; i++) {
    const a = (i / nBolts) * Math.PI * 2;
    const out = R * (1.08 - 0.22 * Math.min(1, Math.max(0, st.bolts * nBolts - i)));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const bg = ctx.createLinearGradient(0, -R * 0.05, 0, R * 0.05);
    bg.addColorStop(0, '#f6f7f9');
    bg.addColorStop(1, '#8a909c');
    ctx.fillStyle = bg;
    roundRectPath(ctx, out - R * 0.2, -R * 0.045, R * 0.2, R * 0.09, R * 0.02);
    ctx.fill();
    ctx.restore();
  }
  // Door body
  const dg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  dg.addColorStop(0, '#f4f6f9');
  dg.addColorStop(0.55, steel);
  dg.addColorStop(1, '#6d7380');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = R * 0.04;
  ctx.stroke();
  // Brushed rings
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let r = R * 0.3; r < R * 0.95; r += R * 0.05) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Inner face
  const fg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  fg.addColorStop(0, '#41444d');
  fg.addColorStop(1, '#1f2025');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.74, 0, Math.PI * 2);
  ctx.fill();
  // Dial with ticks
  const dx = cx;
  const dy = cy - R * 0.5;
  const dr = R * 0.17;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(st.dial);
  ctx.fillStyle = '#121317';
  ctx.beginPath();
  ctx.arc(0, 0, dr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9ced8';
  ctx.lineWidth = R * 0.015;
  ctx.stroke();
  for (let i = 0; i < 40; i++) {
    ctx.rotate(Math.PI / 20);
    ctx.fillStyle = i % 4 === 0 ? '#ffffff' : '#9aa0ab';
    ctx.fillRect(-1, -dr * 0.92, 2, i % 4 === 0 ? dr * 0.22 : dr * 0.12);
  }
  ctx.fillStyle = '#c9ced8';
  ctx.beginPath();
  ctx.arc(0, 0, dr * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.moveTo(dx, dy - dr - R * 0.06);
  ctx.lineTo(dx - R * 0.03, dy - dr - R * 0.11);
  ctx.lineTo(dx + R * 0.03, dy - dr - R * 0.11);
  ctx.fill();
  // Spoked wheel
  ctx.save();
  ctx.translate(cx, cy + R * 0.05);
  ctx.rotate(st.wheel);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i / 4) * Math.PI);
    const sg = ctx.createLinearGradient(0, -R * 0.03, 0, R * 0.03);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(1, '#8a909c');
    ctx.fillStyle = sg;
    roundRectPath(ctx, -R * 0.42, -R * 0.03, R * 0.84, R * 0.06, R * 0.03);
    ctx.fill();
    for (const s of [-1, 1]) {
      const kg = ctx.createRadialGradient(s * R * 0.42 - R * 0.02, -R * 0.02, 1, s * R * 0.42, 0, R * 0.075);
      kg.addColorStop(0, '#ffffff');
      kg.addColorStop(1, '#7f8591');
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(s * R * 0.42, 0, R * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  const hg = ctx.createRadialGradient(-R * 0.04, -R * 0.04, 2, 0, 0, R * 0.14);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(1, '#6d7380');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Readout
  const rw = R * (0.12 + code.length * 0.11);
  const ry = cy + R * 0.52;
  ctx.fillStyle = '#07140b';
  roundRectPath(ctx, cx - rw / 2, ry - R * 0.09, rw, R * 0.18, R * 0.04);
  ctx.fill();
  ctx.font = `700 ${Math.round(R * 0.13)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < code.length; i++) {
    const on = i < st.digits;
    ctx.fillStyle = on ? '#39ff88' : 'rgba(57,255,136,0.25)';
    ctx.shadowColor = '#39ff88';
    ctx.shadowBlur = on ? 10 : 0;
    ctx.fillText(on ? code[i] : '·', cx - rw / 2 + R * 0.11 + i * R * 0.11, ry + 1);
  }
  ctx.shadowBlur = 0;
  // Shade the door as it turns away from the light
  if (st.door > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.55, st.door * 0.5)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Light spilling out once the door moves
  if (st.glow > 0) {
    const lg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
    lg.addColorStop(0, `rgba(255, 220, 140, ${0.35 * st.glow})`);
    lg.addColorStop(1, 'rgba(255, 220, 140, 0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
  }
  // Steam bursting from the seal
  if (st.steam > 0 && st.steam < 1) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + i;
      const d = R * (1.0 + st.steam * 0.5);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d - st.steam * R * 0.3;
      const r = R * (0.08 + st.steam * 0.25);
      const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, `rgba(255,255,255,${0.75 * (1 - st.steam)})`);
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** One frame of the unlock at `t` ms (used by the overlay, and handy for previews). */
export function drawUnlockFrame(canvas: HTMLCanvasElement, code: string, tier: number, cash: string, t: number): number {
  const tt = vaultTier(tier) ?? VAULT_TIERS[0];
  drawVault(canvas.getContext('2d')!, canvas.width, canvas.height, unlockState(t, code, tt.bolts), code, tt.bolts, STEEL[tt.tier - 1], cash, t);
  return unlockPlan(code, tt.bolts).end;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The unlock: the code lights up digit by digit while the dial spins, the bolts pull back,
 * the wheel turns, pressure hisses out and the door swings open on the gold. Drawn on a
 * canvas so it looks the same everywhere; tap to skip.
 */
export function playUnlock(g: Game, code: string, done: () => void): void {
  const hs = g.house!;
  const t = vaultTier(hs.tier)!;
  const root = document.getElementById('ui') ?? document.body;
  const canvas = h('canvas', { class: 'va-canvas' }) as HTMLCanvasElement;
  const status = h('div', { class: 'va-status', text: 'VERIFYING…' });
  const skip = h('div', { class: 'va-skip', text: 'tap to skip' });
  const overlay = h('div', { class: 'vault-anim' }, canvas, status, skip);
  root.appendChild(overlay);
  const ctx = canvas.getContext('2d')!;
  const steel = STEEL[hs.tier - 1];
  const cash = formatMoney(hs.vault);
  const plan = unlockPlan(code, t.bolts);
  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.72, 560);
    canvas.style.width = canvas.style.height = `${css}px`;
    canvas.width = canvas.height = Math.round(css * dpr);
  };
  size();
  const start = performance.now();
  const fired = new Set<string>();
  let finished = false;
  let raf = 0;
  const once = (key: string, at: number, now: number, f: () => void) => {
    if (now >= at && !fired.has(key)) {
      fired.add(key);
      f();
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(safety);
    overlay.classList.add('out');
    window.setTimeout(() => overlay.remove(), 380);
    done();
  };
  const tick = () => {
    if (finished) return;
    const now = performance.now() - start;
    for (let i = 0; i < code.length; i++) {
      once(`d${i}`, 150 + i * plan.step, now, () => {
        audio.play('keyBeep', { pitch: 0.9 + Number(code[i]) * 0.05 });
        audio.play('tick', { volume: 0.7 });
      });
    }
    once('granted', plan.granted, now, () => {
      status.textContent = 'ACCESS GRANTED';
      status.classList.add('ok');
      overlay.classList.add('granted');
      audio.play('fixed');
    });
    for (let i = 0; i < t.bolts; i += 2) once(`b${i}`, plan.boltsAt + i * 70, now, () => audio.play('tick', { volume: 0.8, pitch: 0.6 }));
    once('clunk', plan.boltsEnd, now, () => audio.play('vaultClunk'));
    once('wheel', plan.wheelAt, now, () => {
      status.textContent = 'RELEASING LOCKS';
      audio.play('vaultWheel');
    });
    once('hiss', plan.steamAt, now, () => {
      audio.play('vaultHiss');
      audio.play('vaultClunk', { pitch: 0.8 });
    });
    once('door', plan.doorAt, now, () => {
      status.textContent = 'VAULT OPEN';
      audio.play('jackpot', { volume: 0.5 });
    });
    drawVault(ctx, canvas.width, canvas.height, unlockState(now, code, t.bolts), code, t.bolts, steel, cash, now);
    if (now >= plan.end) {
      finish();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  // Even if frames stall (a background tab), the vault still opens.
  const safety = window.setTimeout(finish, plan.end + 2500);
  overlay.addEventListener('pointerdown', finish);
  tick();
}

/** Inside the open vault: balances and transfers, upgrades and the code. */
export function openBank(game: Game, modals: Modals): void {
  const g = game;
  const body = h('div', { class: 'stack bank' });
  let amount = 1000;
  const render = () => {
    const hs = g.house;
    if (!hs) return;
    clear(body);
    const t = vaultTier(hs.tier)!;
    const fill = Math.min(1, hs.vault / t.cap);
    body.append(
      h('div', { class: 'bank-head', style: `--steel:${STEEL[hs.tier - 1]}` },
        h('div', { class: 'bank-icon', text: '🔐' }),
        h('div', {},
          h('div', { class: 'bank-title', text: t.name }),
          h('div', { class: 'muted small', text: `Holds up to ${formatMoney(t.cap)} · ${(t.interest * 100).toFixed(2)}% interest a day · ${t.digits}-digit code` }),
        ),
      ),
      h('div', { class: 'bank-balance' },
        h('div', { class: 'muted small', text: 'IN THE VAULT' }),
        h('div', { class: 'bank-big', text: formatMoney(hs.vault) }),
        h('div', { class: 'meter wide' }, h('i', { style: `width:${(fill * 100).toFixed(1)}%` })),
      ),
      h('div', { class: 'bank-accts' },
        h('div', { class: 'acct' }, h('span', { text: '🎰 Casino cash' }), h('b', { text: formatMoney(g.money) })),
        h('div', { class: 'acct' }, h('span', { text: '🏨 Hotel bank' }), h('b', { text: g.hotel ? formatMoney(g.hotel.bank) : 'No hotel yet' })),
      ),
    );
    // Amount
    const input = h('input', { class: 'text-input', type: 'number', value: String(amount), 'aria-label': 'Amount' }) as HTMLInputElement;
    input.min = '1';
    input.step = '100';
    input.addEventListener('input', () => (amount = Math.max(0, Math.round(Number(input.value) || 0))));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    const chips = h('div', { class: 'chips' });
    for (const v of [1000, 10000, 100000, 1000000]) {
      chips.appendChild(h('button', { class: `chip-btn${amount === v ? ' on' : ''}`, text: formatMoney(v, true), onClick: () => { amount = v; render(); } }));
    }
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Amount' }), input, chips));
    const move = (target: 'casino' | 'hotel', sign: 1 | -1, all = false) => {
      const hsx = g.house!;
      const src = target === 'casino' ? g.money : g.hotel?.bank ?? 0;
      const a = all ? (sign > 0 ? Math.max(0, src) : hsx.vault) : amount;
      const moved = g.vaultTransfer(target, sign * a);
      if (moved) g.notify(`${moved > 0 ? 'Deposited' : 'Sent'} ${formatMoney(Math.abs(moved))} ${moved > 0 ? `from the ${target}` : `to the ${target}`}.`, 'money');
      render();
    };
    body.appendChild(h('div', { class: 'bank-actions' },
      h('button', { class: 'btn gold', html: `⬇ Deposit from casino`, onClick: () => move('casino', 1) }),
      h('button', { class: 'btn', html: `⬆ Send to casino`, onClick: () => move('casino', -1) }),
      h('button', { class: 'btn gold', disabled: !g.hotel, html: `⬇ Deposit from hotel`, onClick: () => move('hotel', 1) }),
      h('button', { class: 'btn', disabled: !g.hotel, html: `⬆ Send to hotel`, onClick: () => move('hotel', -1) }),
      h('button', { class: 'btn small', text: 'Deposit all casino cash', onClick: () => move('casino', 1, true) }),
      h('button', { class: 'btn small', text: 'Empty vault to casino', onClick: () => move('casino', -1, true) }),
    ));
    // Upgrade and code
    const next = VAULT_TIERS[hs.tier];
    const sec = h('div', { class: 'bank-sec' },
      h('div', { class: 'kv' }, h('span', { text: 'House security' }), h('b', { text: `${g.houseSecurity}/100` })),
      h('p', { class: 'muted small', text: 'Bodyguards, gate guards, cameras, lasers and a bigger vault all raise it.' }),
    );
    body.appendChild(sec);
    const btns = h('div', { class: 'btn-row wrap' });
    if (next) {
      btns.appendChild(h('button', {
        class: 'btn gold', html: `${icon('upgrade', 16)} ${next.name} <b>${formatMoney(next.price)}</b>`,
        title: `${next.blurb} Holds ${formatMoney(next.cap)}.`,
        onClick: () => {
          if (g.money < next.price) {
            audio.play('error');
            g.notify(`${next.name} costs ${formatMoney(next.price)} (from your casino cash).`, 'bad');
            return;
          }
          pickCode(g, modals, next.digits, `${next.name}: pick a ${next.digits}-digit code`, (code) => {
            if (g.upgradeVault(code)) modals.close();
            render();
          });
        },
      }));
    }
    btns.appendChild(h('button', {
      class: 'btn', html: `🔑 Change code`,
      onClick: () => pickCode(g, modals, t.digits, `A new ${t.digits}-digit code`, (code) => {
        g.setVaultCode(code);
        modals.close();
      }),
    }));
    body.appendChild(btns);
    if (next) body.appendChild(h('p', { class: 'muted small', text: `Next: ${next.name}, holds ${formatMoney(next.cap)}, ${next.digits}-digit code, ${next.bolts} bolts, ${(next.interest * 100).toFixed(2)}% a day.` }));
    if (hs.log.length) {
      body.appendChild(h('div', { class: 'field-label', text: 'Recent' }));
      const log = h('div', { class: 'bank-log' });
      for (const l of hs.log.slice(0, 8)) {
        log.appendChild(h('div', { class: 'kv' }, h('span', { text: `Day ${l.day} · ${l.text}` }), h('b', { class: l.amount >= 0 ? 'pos' : 'neg', text: `${l.amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(l.amount))}` })));
      }
      body.appendChild(log);
    }
  };
  render();
  const off = g.events.on('house', render);
  const off2 = g.events.on('money', () => {
    const acct = body.querySelector('.acct b');
    if (acct) acct.textContent = formatMoney(g.money);
  });
  modals.open('Your vault', body, {
    cls: 'vault-bank',
    onClose: () => {
      off();
      off2();
      g.closeVault();
    },
  });
}
