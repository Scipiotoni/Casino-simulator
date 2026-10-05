import type { Game } from '../game/game';
import type { StreetLot } from '../world/street';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { audio } from '../core/audio';
import { formatMoney } from '../core/math';
import { vaultTier } from '../game/house';
import { heistFines } from '../game/heist';
import { DOOR_TYPES, doorType, doorsInEncoded } from '../world/walls';
import {
  type Stage, NPC_REFILL_MS, cooldownMs, dialParams, drillParams, hackParams, lockoutMs, pickParams, timelockSeconds, vaultStages, waitText,
} from '../game/heistRules';

/** One minigame on screen: it reports a score (0..1) when beaten, or why it was lost. */
interface Game2 {
  el: HTMLElement;
  stop(): void;
}

type Win = (score: number) => void;
type Lose = (reason: string) => void;

const STAGE_INFO: Record<Stage['kind'], { name: string; icon: string; help: string }> = {
  pick: { name: 'Pick the lock', icon: '🗝️', help: 'Press Space (or tap) when the pick is in the green to set each pin. Three slips and the pick snaps.' },
  dial: { name: 'Crack the dial', icon: '🎛️', help: 'Turn with ← → (or A / D, or drag). The meter jumps when you’re close and the dial clicks on the number: press Space to set it.' },
  hack: { name: 'Hack the keypad', icon: '💻', help: 'Watch the lights, then repeat them (click, or keys 1–9). Get it wrong and the keypad resets.' },
  drill: { name: 'Thermal drill', icon: '🔥', help: 'Hold Space (or the button) to push the drill. Keep the heat in the green: too hot and the bit burns out.' },
};

/**
 * Keys for a minigame: presses are caught before the game's own controls (so A / D turn the
 * dial, not you). Releases still reach the game, so it never thinks a key is stuck down.
 */
function keys(on: (e: KeyboardEvent, down: boolean) => boolean): () => void {
  const kd = (e: KeyboardEvent) => {
    if (on(e, true)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const ku = (e: KeyboardEvent) => {
    on(e, false);
  };
  document.addEventListener('keydown', kd, true);
  document.addEventListener('keyup', ku, true);
  return () => {
    document.removeEventListener('keydown', kd, true);
    document.removeEventListener('keyup', ku, true);
  };
}

/** A canvas sized for crisp drawing, with its 2D context. */
function canvas(w: number, hh: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr;
  c.height = hh * dpr;
  c.className = 'hg-canvas';
  c.style.aspectRatio = `${w} / ${hh}`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return { c, ctx, w, h: hh };
}

function loop(f: (dt: number) => boolean | void): () => void {
  let raf = 0;
  let last = performance.now();
  let live = true;
  const tick = (now: number) => {
    if (!live) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (f(dt) === false) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    live = false;
    cancelAnimationFrame(raf);
  };
}

// ------------------------------------------------------------------ lock-pick

function pickGame(level: number, win: Win, lose: Lose): Game2 {
  const p = pickParams(level);
  const { c, ctx, w, h: H } = canvas(340, 130);
  const info = h('div', { class: 'hg-info' });
  const btn = h('button', { class: 'btn gold hg-act', text: 'Set the pin' });
  let m = 0;
  let dir = 1;
  let speed = p.speed;
  let center = 0.3 + Math.random() * 0.4;
  let set = 0;
  let misses = 0;
  let precision = 0;
  let flash = 0;
  let flashOk = true;
  let done = false;
  const press = () => {
    if (done) return;
    const off = Math.abs(m - center);
    if (off <= p.zone / 2) {
      set++;
      precision += 1 - off / (p.zone / 2);
      flash = 0.3;
      flashOk = true;
      audio.play('pinSet', { pitch: 0.9 + set * 0.06 });
      speed *= 1.06;
      center = 0.12 + Math.random() * 0.76;
      if (set >= p.pins) {
        done = true;
        audio.play('vaultClunk', { pitch: 1.5 });
        win(Math.max(0.3, Math.min(1, 0.55 * (precision / p.pins) + 0.45 * (1 - misses / p.picks))));
      }
    } else {
      misses++;
      flash = 0.35;
      flashOk = false;
      audio.play('keyError');
      if (misses >= p.picks) {
        done = true;
        lose('The pick snapped in the lock!');
      }
    }
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press();
  });
  c.addEventListener('pointerdown', press);
  const unkeys = keys((e, down) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return false;
    if (down && !e.repeat) press();
    return true;
  });
  const stopLoop = loop((dt) => {
    if (done) return false;
    m += dir * speed * dt;
    if (m > 1) {
      m = 2 - m;
      dir = -1;
    } else if (m < 0) {
      m = -m;
      dir = 1;
    }
    flash = Math.max(0, flash - dt);
    const x0 = 20;
    const bw = w - 40;
    ctx.clearRect(0, 0, w, H);
    // Pins
    for (let i = 0; i < p.pins; i++) {
      const px = x0 + (bw / p.pins) * (i + 0.5);
      const up = i < set;
      ctx.fillStyle = up ? '#ffc53d' : '#6f7480';
      ctx.fillRect(px - 6, up ? 6 : 18, 12, 30);
      ctx.fillStyle = '#2b2b35';
      ctx.fillRect(px - 8, 48, 16, 4);
    }
    // Bar and the sweet spot
    ctx.fillStyle = '#1b1726';
    ctx.fillRect(x0, 70, bw, 34);
    ctx.fillStyle = 'rgba(57,255,136,0.85)';
    ctx.fillRect(x0 + (center - p.zone / 2) * bw, 70, p.zone * bw, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x0 + center * bw - 1, 70, 2, 34);
    // The pick
    const mx = x0 + m * bw;
    ctx.fillStyle = flash > 0 ? (flashOk ? '#39ff88' : '#ff4d5e') : '#f7f0ff';
    ctx.beginPath();
    ctx.moveTo(mx, 66);
    ctx.lineTo(mx - 7, 56);
    ctx.lineTo(mx + 7, 56);
    ctx.fill();
    ctx.fillRect(mx - 1.5, 66, 3, 42);
    info.textContent = `Pins ${set}/${p.pins} · Picks left ${'🪛'.repeat(p.picks - misses)}`;
  });
  return { el: h('div', { class: 'hg' }, c, info, btn), stop: () => { stopLoop(); unkeys(); } };
}

// ------------------------------------------------------------------ safe dial

function dialGame(level: number, win: Win, lose: Lose): Game2 {
  const p = dialParams(level);
  const { c, ctx, w, h: H } = canvas(300, 240);
  const meter = h('div', { class: 'hg-meter' }, h('i'));
  const info = h('div', { class: 'hg-info' });
  const row = h('div', { class: 'btn-row center' });
  const N = p.size;
  const targets = Array.from({ length: p.numbers }, () => Math.floor(Math.random() * N));
  let k = 0;
  let v = Math.floor(Math.random() * N);
  let turn = 0;
  let mistakes = 0;
  let time = p.time;
  let lastTick = Math.round(v);
  let done = false;
  let drag: number | null = null;
  let wob = 0;
  const found: number[] = [];
  const setIt = () => {
    if (done) return;
    const at = ((Math.round(v) % N) + N) % N;
    if (at === targets[k]) {
      found.push(at);
      k++;
      audio.play('dialClick', { pitch: 1.2 });
      if (k >= targets.length) {
        done = true;
        audio.play('vaultClunk');
        win(Math.max(0.3, Math.min(1, 0.45 + 0.55 * (time / p.time) - mistakes * 0.15)));
      }
    } else {
      mistakes++;
      audio.play('keyError');
      if (mistakes >= p.tries) {
        done = true;
        lose('The dial jammed: wrong number one time too many.');
      }
    }
  };
  const left = h('button', { class: 'btn', text: '⟲' });
  const right = h('button', { class: 'btn', text: '⟳' });
  const ok = h('button', { class: 'btn gold', text: 'Set number' });
  const hold = (b: HTMLElement, d: number) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      turn = d;
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => (turn = 0));
  };
  hold(left, -1);
  hold(right, 1);
  ok.addEventListener('click', setIt);
  row.append(left, ok, right);
  // Drag the dial round.
  const angleAt = (e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height * (120 / H))));
  };
  c.addEventListener('pointerdown', (e) => {
    drag = angleAt(e);
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    const a = angleAt(e);
    let d = a - drag;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    v += (d / (Math.PI * 2)) * N;
    drag = a;
  });
  c.addEventListener('pointerup', () => (drag = null));
  const held = new Set<string>();
  const unkeys = keys((e, down) => {
    const turnKeys = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight'];
    if (turnKeys.includes(e.code)) {
      if (down) held.add(e.code);
      else held.delete(e.code);
      return true;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (down && !e.repeat) setIt();
      return true;
    }
    return false;
  });
  const stopLoop = loop((dt) => {
    if (done) return false;
    time -= dt;
    if (time <= 0) {
      done = true;
      lose('Out of time: the dial relocked.');
      return false;
    }
    const slow = held.has('ShiftLeft') || held.has('ShiftRight') ? 0.35 : 1;
    const kd = (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0) + turn;
    v += kd * 9 * slow * dt;
    v = ((v % N) + N) % N;
    const r = Math.round(v) % N;
    if (r !== lastTick) {
      lastTick = r;
      if (r === targets[k]) audio.play('dialClick', { volume: 0.7 });
      else audio.play('dialTick', { volume: 0.5 });
    }
    // The stethoscope: louder the closer you are (plus some noise on better safes).
    let dd = Math.abs(v - targets[k]);
    dd = Math.min(dd, N - dd);
    wob += dt * 9;
    const signal = Math.max(0, Math.min(1, 1 - dd / 6 + Math.sin(wob * 1.7) * p.noise * 0.5 + (Math.random() - 0.5) * p.noise));
    (meter.firstChild as HTMLElement).style.width = `${Math.round(signal * 100)}%`;
    meter.classList.toggle('hot', dd < 0.5);
    // Draw the dial
    const cx = w / 2;
    const cy = 120;
    const R = 92;
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = '#2b2b35';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(cx - 20, cy - 30, 10, cx, cy, R);
    grad.addColorStop(0, '#e6eaf0');
    grad.addColorStop(1, '#8c9099');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#17151f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px sans-serif';
    for (let i = 0; i < N; i++) {
      const a = ((i - v) / N) * Math.PI * 2;
      const x1 = cx + Math.sin(a) * (R - 4);
      const y1 = cy - Math.cos(a) * (R - 4);
      const x2 = cx + Math.sin(a) * (R - (i % 5 === 0 ? 16 : 10));
      const y2 = cy - Math.cos(a) * (R - (i % 5 === 0 ? 16 : 10));
      ctx.strokeStyle = '#17151f';
      ctx.lineWidth = i % 5 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (i % 5 === 0) ctx.fillText(String(i), cx + Math.sin(a) * (R - 28), cy - Math.cos(a) * (R - 28));
    }
    ctx.fillStyle = '#3a3c44';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    // Marker at the top
    ctx.fillStyle = '#ffc53d';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R - 4);
    ctx.lineTo(cx - 8, cy - R - 16);
    ctx.lineTo(cx + 8, cy - R - 16);
    ctx.fill();
    ctx.fillStyle = '#f7f0ff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(found.map((n) => String(n).padStart(2, '0')).concat(Array(targets.length - found.length).fill('··')).join(' – '), cx, H - 8);
    info.textContent = `Number ${Math.min(k + 1, targets.length)}/${targets.length} · ${Math.ceil(time)} s · Mistakes ${mistakes}/${p.tries}`;
  });
  return { el: h('div', { class: 'hg' }, c, meter, info, row), stop: () => { stopLoop(); unkeys(); } };
}

// ------------------------------------------------------------------ keypad hack

function hackGame(level: number, win: Win, lose: Lose, shock?: () => void): Game2 {
  const p = hackParams(level);
  const info = h('div', { class: 'hg-info' });
  const grid = h('div', { class: 'hg-grid' });
  const btns: HTMLButtonElement[] = [];
  let seq: number[] = [];
  let at = 0;
  let lives = p.lives;
  let mistakes = 0;
  let showing = true;
  let done = false;
  const timers: number[] = [];
  const lightUp = (i: number, ms: number, cls = 'lit') => {
    btns[i].classList.add(cls);
    timers.push(window.setTimeout(() => btns[i].classList.remove(cls), ms));
  };
  const show = () => {
    seq = Array.from({ length: p.length }, () => Math.floor(Math.random() * 9));
    at = 0;
    showing = true;
    info.textContent = `Watch… (${p.length} lights) · Lives ${'❤️'.repeat(lives)}`;
    const step = p.flash * 1000;
    seq.forEach((n, i) => timers.push(window.setTimeout(() => {
      lightUp(n, step * 0.75);
      audio.play('keyBeep', { pitch: 0.8 + n * 0.08 });
    }, 600 + i * step)));
    timers.push(window.setTimeout(() => {
      showing = false;
      info.textContent = `Your turn: repeat the ${p.length} lights · Lives ${'❤️'.repeat(lives)}`;
    }, 600 + seq.length * step));
  };
  const press = (i: number) => {
    if (done || showing) return;
    lightUp(i, 160);
    if (i === seq[at]) {
      audio.play('keyBeep', { pitch: 0.8 + i * 0.08 });
      at++;
      if (at >= seq.length) {
        done = true;
        audio.play('vaultClunk', { pitch: 1.3 });
        win(Math.max(0.3, 1 - mistakes * 0.3));
      }
    } else {
      mistakes++;
      lives--;
      lightUp(i, 400, 'bad');
      audio.play('keyError');
      if (shock) shock();
      if (lives <= 0) {
        done = true;
        lose('Wrong code: the keypad locked you out.');
        return;
      }
      showing = true;
      timers.push(window.setTimeout(show, 700));
    }
  };
  for (let i = 0; i < 9; i++) {
    const b = h('button', { class: 'hg-key', text: String(i + 1) });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(i);
    });
    btns.push(b);
    grid.appendChild(b);
  }
  const unkeys = keys((e, down) => {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!m) return false;
    if (down && !e.repeat) press(Number(m[1]) - 1);
    return true;
  });
  show();
  return {
    el: h('div', { class: 'hg' }, grid, info),
    stop: () => {
      done = true;
      timers.forEach((t) => window.clearTimeout(t));
      unkeys();
    },
  };
}

// ------------------------------------------------------------------ thermal drill

function drillGame(level: number, win: Win, lose: Lose): Game2 {
  const p = drillParams(level);
  const { c, ctx, w, h: H } = canvas(340, 120);
  const info = h('div', { class: 'hg-info' });
  const btn = h('button', { class: 'btn gold hg-act', text: 'Hold to drill' });
  let heat = 0.2;
  let work = 0;
  let total = 0;
  let inBand = 0;
  let bits = p.bits;
  let pushing = false;
  let btnHeld = false;
  let done = false;
  let jitter = 0;
  let sndT = 0;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btnHeld = true;
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => (btnHeld = false));
  const unkeys = keys((e, down) => {
    if (e.code !== 'Space') return false;
    pushing = down;
    return true;
  });
  const stopLoop = loop((dt) => {
    if (done) return false;
    const push = pushing || btnHeld;
    jitter += (Math.random() - 0.5) * dt * 3;
    jitter = Math.max(-0.4, Math.min(0.4, jitter));
    heat += (push ? p.heatUp * (1 + jitter) : -p.coolDown) * dt;
    heat = Math.max(0, heat);
    total += dt;
    const good = heat >= p.band[0] && heat <= p.band[1];
    if (good) inBand += dt;
    // Progress only comes in the green; a cold drill barely bites.
    work += dt * (good ? 1 : heat > p.band[1] ? 0.5 : heat > 0.25 ? 0.2 : 0);
    sndT -= dt;
    if (push && sndT <= 0) {
      sndT = 0.3;
      audio.play('drill', { pitch: 0.8 + heat * 0.6, volume: 0.6 });
    }
    if (heat >= 1) {
      bits--;
      heat = 0.15;
      audio.play('break');
      if (bits <= 0) {
        done = true;
        lose('The drill overheated and burned out!');
        return false;
      }
    }
    if (work >= p.work) {
      done = true;
      audio.play('vaultClunk');
      win(Math.max(0.3, Math.min(1, inBand / Math.max(1, total) + 0.15)));
      return false;
    }
    ctx.clearRect(0, 0, w, H);
    const x0 = 20;
    const bw = w - 40;
    // Heat gauge
    const g2 = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    g2.addColorStop(0, '#2fe6ff');
    g2.addColorStop(0.6, '#ffc53d');
    g2.addColorStop(1, '#ff4d5e');
    ctx.fillStyle = '#1b1726';
    ctx.fillRect(x0, 18, bw, 30);
    ctx.fillStyle = 'rgba(57,255,136,0.35)';
    ctx.fillRect(x0 + p.band[0] * bw, 14, (p.band[1] - p.band[0]) * bw, 38);
    ctx.fillStyle = g2;
    ctx.fillRect(x0, 24, Math.min(1, heat) * bw, 18);
    ctx.fillStyle = '#f7f0ff';
    ctx.fillRect(x0 + Math.min(1, heat) * bw - 2, 14, 4, 38);
    // Progress through the door
    ctx.fillStyle = '#1b1726';
    ctx.fillRect(x0, 72, bw, 18);
    ctx.fillStyle = '#ffc53d';
    ctx.fillRect(x0, 72, (work / p.work) * bw, 18);
    ctx.fillStyle = '#b9a7d8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('HEAT', x0, 11);
    ctx.fillText('THROUGH THE DOOR', x0, 104);
    info.textContent = `${Math.round((work / p.work) * 100)}% · Drill bits ${'🔩'.repeat(bits)}${heat > p.band[1] ? ' · 🔥 Too hot!' : heat < p.band[0] ? ' · ❄️ Push harder' : ' · ✅ Perfect'}`;
  });
  return { el: h('div', { class: 'hg' }, c, info, btn), stop: () => { stopLoop(); unkeys(); } };
}

// ------------------------------------------------------------------ running a set of stages

/**
 * Play the stages one after another in a docked panel (you can still see the guards coming).
 * `done` gets every stage's score, null with a reason if you lost, or null with no reason if
 * you walked away (closed the panel: no penalty).
 */
function runStages(g: Game, modals: Modals, title: string, stages: Stage[], done: (scores: number[] | null, reason?: string) => void, shock?: () => void): () => void {
  const heist = g.heist;
  if (!heist || !stages.length) {
    done([]);
    return () => undefined;
  }
  heist.busy = true;
  const scores: number[] = [];
  const body = h('div', { class: 'stack heist-game' });
  const dots = h('div', { class: 'hg-dots' });
  const head = h('div', { class: 'hg-head' });
  const help = h('p', { class: 'muted small' });
  const area = h('div', { class: 'hg-area' });
  body.append(dots, head, help, area);
  let current: Game2 | null = null;
  let finished = false;
  const finish = (s: number[] | null, reason?: string) => {
    if (finished) return;
    finished = true;
    current?.stop();
    current = null;
    if (g.heist) g.heist.busy = false;
    done(s, reason);
  };
  const next = () => {
    current?.stop();
    const i = scores.length;
    if (i >= stages.length) {
      // Record the result before the panel closes (closing on its own means "walked away").
      finish(scores);
      modals.close();
      return;
    }
    const st = stages[i];
    const meta = STAGE_INFO[st.kind];
    clear(dots);
    stages.forEach((s, k) => dots.appendChild(h('span', { class: `hg-dot${k < i ? ' done' : k === i ? ' on' : ''}`, text: STAGE_INFO[s.kind].icon })));
    head.textContent = `${meta.icon} ${meta.name} · difficulty ${'★'.repeat(st.level)}${st.shock ? ' · ⚡ mistakes shock you' : ''}`;
    help.textContent = meta.help;
    clear(area);
    const win = (score: number) => {
      scores.push(score);
      window.setTimeout(next, 450);
    };
    const lose = (reason: string) => {
      finish(null, reason);
      modals.close();
    };
    current = st.kind === 'pick' ? pickGame(st.level, win, lose) : st.kind === 'dial' ? dialGame(st.level, win, lose) : st.kind === 'hack' ? hackGame(st.level, win, lose, st.shock ? shock : undefined) : drillGame(st.level, win, lose);
    area.appendChild(current.el);
  };
  const giveUp = h('button', { class: 'btn small', text: 'Step away', title: 'Stop for now (no penalty): you can come back to it' });
  giveUp.addEventListener('click', () => modals.close());
  modals.open(title, body, { cls: 'minigame heist-modal', foot: giveUp, onClose: () => finish(null) });
  next();
  // Knocked out or the heist ended under you: the panel goes.
  const watch = window.setInterval(() => {
    if (finished) {
      window.clearInterval(watch);
      return;
    }
    if (!g.heist || g.heist.over || g.combat.ko > 0) {
      window.clearInterval(watch);
      modals.close();
    }
  }, 200);
  return () => {
    if (!finished) modals.close();
  };
}

// ------------------------------------------------------------------ before breaking in

function describeSecurity(g: Game, lot: StreetLot): HTMLElement {
  const pv = g.heistPreview(lot)!;
  const snap = pv.target.snap;
  const count = (id: string) => snap.items.filter((i) => i.id === id).length;
  const staff = (role: string) => snap.staff.filter((s) => s.role === role).length;
  const doors = (snap.walls ?? []).flatMap((w) => doorsInEncoded(w)).filter((t) => (DOOR_TYPES[t]?.lock ?? 0) > 0);
  const rows: [string, number, string][] = [
    ['💂', staff('security'), pv.target.npc ? 'night watchman' : 'bodyguard'],
    ['🚪', staff('doorman'), 'gate guard'],
    ['🐕', count('doghouse'), 'guard dog'],
    ['🔴', count('laser'), 'laser grid'],
    ['📷', count('cctv'), 'camera'],
    ['🔦', count('spotlight'), 'searchlight'],
    ['🚨', count('alarm'), 'alarm panel'],
    ['📟', count('panicbutton'), 'panic button'],
    ['🧲', count('metaldetector'), 'metal detector'],
    ['🧰', count('safe'), 'floor safe'],
    ['🔒', doors.length, 'locked door'],
  ];
  const list = h('div', { class: 'heist-sec' });
  for (const [ic, n, name] of rows) if (n > 0) list.appendChild(h('span', { class: 'chip', text: `${ic} ${n} ${name}${n === 1 ? '' : 's'}` }));
  if (!list.children.length) list.appendChild(h('span', { class: 'chip good', text: 'No security to speak of. Easy pickings?' }));
  return list;
}

function openHeistAsk(g: Game, modals: Modals, lot: StreetLot): void {
  const block = g.entryBlock(lot);
  if (block) {
    audio.play('error');
    g.notify(block, 'bad');
    return;
  }
  const pv = g.heistPreview(lot);
  if (!pv) return;
  const t = pv.target;
  const tier = vaultTier(t.tier);
  const fines = heistFines(t, g.money);
  const hasVault = !!tier && t.snap.items.some((i) => i.id === 'vault');
  const body = h('div', { class: 'stack heist-ask' });
  const parts: (HTMLElement | null)[] = [
    !hasVault || t.vault < 100
      ? h('p', { class: 'heist-empty', text: hasVault ? `${lot.owner}’s vault is empty right now: you can break in and look around, but there’s no cash to take.` : `${lot.owner}’s house has no vault yet: you can break in and look around, but there’s nothing to steal.` })
      : null,
    h('p', { class: 'lead', html: t.npc
      ? `<b>${lot.owner}</b> keeps a little cash at home. A perfect run takes <b>all of it</b>, and it’s back ${waitText(NPC_REFILL_MS)} after you rob him. His night watchman is no pushover, but he’s no bodyguard either.`
      : `<b>${lot.owner}</b> is ${t.online ? '<span class="pos">● online</span>: you can take up to <b>50%</b> of the vault, but they can come home and fight you' : '<span class="muted">○ offline</span>: you can take up to <b>10%</b> of the vault'}.` }),
    hasVault
      ? h('div', { class: 'card-stats' },
        h('div', { class: 'kv' }, h('span', { text: 'Vault' }), h('b', { text: `${tier?.name ?? 'Vault'} · ${formatMoney(t.vault)}` })),
        h('div', { class: 'kv' }, h('span', { text: 'A perfect run takes' }), h('b', { class: 'pos', text: formatMoney(pv.max) })),
        h('div', { class: 'kv' }, h('span', { text: 'Minigames to crack it' }), h('b', { text: vaultStages(t.tier).map((s) => STAGE_INFO[s.kind].icon).join(' ') })),
        h('div', { class: 'kv' }, h('span', { text: 'Time lock after that' }), h('b', { text: `${timelockSeconds(t.tier)} s` })),
      )
      : null,
    h('div', { class: 'field-label', text: 'What you’re up against' }),
    describeSecurity(g, lot),
    h('p', { class: 'muted small', text: t.npc
      ? `How well you play the minigames decides how much you take. Lose one and you pay ${formatMoney(fines.fail)} and get thrown out for ${waitText(lockoutMs(t.tier))}. If the watchman knocks you out he takes ${formatMoney(fines.ko)}. Get out the front door with the cash and it’s yours. A good place to practise before you rob a real player.`
      : `How well you play the minigames decides how much you take. Lose one and you pay ${formatMoney(fines.fail)} and get thrown out for ${waitText(lockoutMs(t.tier))}. The guards are very strong and shoot to kill: if they knock you out they take ${formatMoney(fines.ko)}. Get out the front door with the cash and it’s yours, and the house is off limits to everyone for ${waitText(cooldownMs(t.online))}.` }),
  ];
  body.append(...parts.filter((x): x is HTMLElement => !!x));
  const foot = h('div', { class: 'btn-row' },
    h('button', { class: 'btn', text: 'Not today', onClick: () => modals.close() }),
    h('button', {
      class: 'btn danger', text: '🦹 Break in',
      onClick: () => {
        modals.close();
        if (g.enterLot(lot, true)) audio.play('whoosh');
      },
    }),
  );
  modals.open(`Rob ${lot.owner}’s house?`, body, { foot, cls: 'small' });
}

// ------------------------------------------------------------------ wiring

/** The heist screens: ask before breaking in, the minigames, and the live panel while you're inside. */
export function initHeistUi(g: Game, modals: Modals, root: HTMLElement): { update(): void } {
  const panel = h('div', { class: 'heist-hud', hidden: true });
  root.appendChild(panel);
  let busy: (() => void) | null = null;

  g.events.on('heistAsk', (lot) => openHeistAsk(g, modals, lot));
  g.events.on('heistGame', (ev) => {
    const hs = g.heist;
    if (!hs || hs.over || busy) return;
    if (ev.kind === 'vault') {
      if (hs.phase !== 'locked') return;
      busy = runStages(g, modals, `Crack the ${hs.vaultTierName}`, hs.vaultStages, (scores, reason) => {
        busy = null;
        const now = g.heist;
        if (!now || now !== hs || now.over) return;
        if (scores) now.vaultCracked(scores);
        else if (reason) now.fail(reason);
      });
    } else {
      const dt = doorType(ev.type);
      busy = runStages(g, modals, `Crack the ${dt.name}`, hs.doorStagesAt(ev.type), (scores, reason) => {
        busy = null;
        const now = g.heist;
        if (!now || now !== hs || now.over) return;
        if (scores) now.doorCracked(ev.floor, ev.x, ev.z);
        else if (reason) now.fail(reason);
      }, () => {
        // Laser door: every slip is a jolt.
        audio.play('zap');
        g.combat.damage(18, 'trap', `${hs.target.owner}'s laser door`);
      });
    }
  });
  g.events.on('heist', () => {
    if (!g.heist && busy) {
      busy();
      busy = null;
    }
  });

  return {
    update() {
      const hs = g.heist;
      const defending = !hs && g.inHouse && g.intruders.length > 0;
      panel.hidden = !(hs && !hs.over) && !defending;
      if (panel.hidden) return;
      panel.classList.toggle('alarm', !!hs && hs.siren > 0);
      panel.classList.toggle('defend', defending);
      if (defending) {
        panel.innerHTML = `<b>🦹 Burglar${g.intruders.length > 1 ? 's' : ''} in your house!</b><span>Your guns work in here: defend your vault.</span>`;
        return;
      }
      const v = hs!;
      const vault = !v.vault ? '🚪 No vault in this house: nothing to take' : v.target.vault < 100 && v.phase === 'locked' ? `🔐 ${v.vaultTierName}: locked (it’s empty)` : v.phase === 'locked' ? `🔐 ${v.vaultTierName}: locked`
        : v.phase === 'timelock' ? `⏳ Time lock ${Math.ceil(v.timelock)} s` : v.phase === 'open' ? '💰 Vault open: grab the cash' : `💰 ${formatMoney(v.loot)}: get out the front door!`;
      const dogs = v.dogs.length ? ` · 🐕 ${v.dogs.filter((d) => d.ko <= 0).length}/${v.dogs.length}` : '';
      panel.innerHTML = `<b>🦹 Heist · ${v.target.owner}'s house ${v.target.npc ? '' : v.online ? '<i class="pos">● online</i>' : '<i>○ offline</i>'}</b>`
        + `<span>${v.siren > 0 ? '🚨 ALARM' : v.alarmed ? '🚨 Alarm raised' : '🤫 Quiet'} · 💂 ${v.guardsUp}/${v.guards.length}${dogs}</span>`
        + `<span>${vault}</span>`
        + (v.phase === 'timelock' ? `<span class="hh-bar"><i style="width:${Math.round(v.timelockProgress * 100)}%"></i></span>` : '')
        + (v.phase !== 'looted' && v.vault ? `<span class="muted">Up to ${formatMoney(v.maxTake)}</span>` : '');
    },
  };
}
