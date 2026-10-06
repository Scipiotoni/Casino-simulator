import { h, icon } from '../dom';
import { REEL_SYMBOLS, drawSymbol } from '../../render/textures';
import { resolveSlot, SLOT_TABLE, SLOT_TABLE_LOW } from '../../items/games';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { type GameCtx, Session, chipRow, chipValues, sleep } from './common';

const CELL = 72;
const STRIP_LOOPS = 7;

/**
 * Each reel's strip (symbol indices: 0 seven, 1 cherry, 2 bar, 3 lemon, 4 bell, 5 grape,
 * 6 diamond, 7 star). Like a real machine every reel has its own order, the common
 * symbols come round more often, and you see the stops above and below the payline, so a
 * seven sitting just off the line is a genuine near miss.
 */
export const REEL_STRIPS: number[][] = [
  [3, 1, 5, 2, 4, 3, 0, 5, 1, 6, 3, 4, 2, 5, 7, 3, 1, 4, 5, 2, 3, 4],
  [5, 3, 2, 4, 1, 5, 3, 7, 4, 2, 5, 0, 3, 4, 1, 6, 5, 3, 2, 4, 5, 1],
  [4, 2, 3, 5, 1, 4, 6, 3, 5, 2, 4, 1, 3, 0, 5, 4, 2, 7, 3, 5, 1, 4],
];

let symbolUrls: string[] | null = null;
function symbols(): string[] {
  if (symbolUrls) return symbolUrls;
  symbolUrls = REEL_SYMBOLS.map((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.translate(64, 64);
    drawSymbol(ctx, s, 110);
    return c.toDataURL();
  });
  return symbolUrls;
}

const SYMBOL_NAMES = ['7', 'Cherry', 'BAR', 'Lemon', 'Bell', 'Grapes', 'Diamond', 'Star'];

/** Spin any slot machine with your own money (or practice chips). */
export function openSlots(ctx: GameCtx): void {
  const { game: g, item } = ctx;
  const s = new Session(ctx);
  const urls = symbols();
  const low = item.def.params?.volatility === 'low';
  const table = low ? SLOT_TABLE_LOW : SLOT_TABLE;
  const reels: { strip: HTMLElement; pos: number; box: HTMLElement }[] = [];
  const windowEl = h('div', { class: 'sl-window' });
  REEL_STRIPS.forEach((reelStrip) => {
    const L = reelStrip.length;
    const strip = h('div', { class: 'sl-strip' });
    for (let i = 0; i < L * STRIP_LOOPS; i++) {
      const sym = reelStrip[i % L];
      strip.appendChild(h('div', { class: 'sl-cell' }, h('img', { src: urls[sym], alt: SYMBOL_NAMES[sym] })));
    }
    const start = L + Math.floor(Math.random() * L);
    strip.style.transform = `translateY(${-((start - 1) * CELL)}px)`;
    const box = h('div', { class: 'sl-reel' }, strip);
    windowEl.appendChild(box);
    reels.push({ strip, pos: start, box });
  });
  windowEl.append(h('div', { class: 'sl-payline' }), h('i', { class: 'sl-arrow l' }), h('i', { class: 'sl-arrow r' }));

  const bets = chipValues(item.minBet);
  let bet = bets[Math.min(1, bets.length - 1)];
  let spinning = false;
  /** A spin in progress is settled even if you walk away before the reels stop. */
  let owed: { bet: number; payout: number } | null = null;
  const msg = h('div', { class: 'sl-msg', text: 'PLAY TO WIN' });
  const credits = h('b');
  const betM = h('b');
  const winM = h('b', { text: '0' });
  const meters = h('div', { class: 'sl-meters' }, h('span', {}, 'CREDIT ', credits), h('span', {}, 'BET ', betM), h('span', {}, 'WIN ', winM));
  const refreshMeters = () => {
    credits.textContent = formatMoney(Math.floor(s.bank));
    betM.textContent = formatMoney(bet);
    spinBtn.innerHTML = `${icon('dice', 20)} SPIN`;
  };
  const betRow = chipRow(bets, () => bet, (v) => {
    if (spinning) return;
    bet = v;
    refreshMeters();
  }, { min: item.minBet, bank: () => s.bank });
  const spinBtn = h('button', { class: 'btn gold mg-spin', onClick: () => void spin() });
  const lever = h('button', { class: 'sl-lever', 'aria-label': 'Pull the handle', onClick: () => void spin() }, h('i', { class: 'sl-knob' }));

  const spin = async () => {
    if (spinning || s.closed) return;
    if (!s.bet(bet)) {
      msg.textContent = 'INSERT MORE CREDIT';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    lever.classList.remove('pull');
    void lever.offsetWidth;
    lever.classList.add('pull');
    winM.textContent = '0';
    refreshMeters();
    const o = resolveSlot(bet, item.def.rtp, false, item.def.jackpot ? g.jackpotPot : 0, low ? 'low' : 'normal');
    if (o.visual.kind !== 'slot') return;
    owed = { bet, payout: o.payout };
    const target = o.visual.symbols;
    // Two big symbols on the line: the last reel spins on a little longer.
    const tease = target[0] === target[1] && (target[0] === 0 || target[0] === 6);
    const durations = [1.0, 1.45, tease ? 3.0 : 1.9];
    s.spinMachine(o, durations[2]);
    audio.play('spin');
    msg.textContent = 'GOOD LUCK!';
    msg.className = 'sl-msg';
    await Promise.all(reels.map((reel, i) => new Promise<void>((resolve) => {
      const strip = REEL_STRIPS[i];
      const L = strip.length;
      const stops = strip.map((sym, k) => (sym === target[i] ? k : -1)).filter((k) => k >= 0);
      const k = stops[Math.floor(Math.random() * stops.length)];
      const loops = 3 + i + (i === 2 && tease ? 3 : 0);
      const dest = (Math.floor(reel.pos / L) + loops) * L + k;
      const el = reel.strip;
      el.classList.add('spinning');
      el.style.transition = `transform ${durations[i]}s cubic-bezier(0.3, 0.1, 0.2, 1.04)`;
      el.style.transform = `translateY(${-((dest - 1) * CELL)}px)`;
      if (i === 2 && tease) window.setTimeout(() => {
        reel.box.classList.add('tease');
        msg.textContent = '★ ★ ★';
        audio.play('tick', { pitch: 1.6, volume: 0.5 });
      }, durations[1] * 1000);
      window.setTimeout(() => el.classList.remove('spinning'), durations[i] * 1000 - 250);
      window.setTimeout(() => {
        audio.play('tick', { pitch: 0.8 + i * 0.15 });
        reel.box.classList.remove('tease');
        // Snap back to the same stop near the top so the strip never runs out.
        el.style.transition = 'none';
        reel.pos = k + L;
        el.style.transform = `translateY(${-((reel.pos - 1) * CELL)}px)`;
        resolve();
      }, durations[i] * 1000 + 40);
    })));
    if (s.closed) return;
    if (o.label === 'MEGA JACKPOT!') g.resetJackpot();
    const pos = item.root.position.clone().setY(item.model.height + 0.3);
    windowEl.classList.toggle('won', o.payout > 0);
    if (o.tier === 'jackpot') {
      audio.play('jackpot');
      g.effects.confetti(pos.x, pos.y, pos.z, 180, 1.2);
      g.cam.shake(0.15);
      msg.className = 'sl-msg jackpot';
    } else if (o.tier === 'big') {
      g.effects.confetti(pos.x, pos.y, pos.z, 60, 0.9);
      msg.className = 'sl-msg big';
    } else if (o.tier === 'win' || o.tier === 'push') {
      g.effects.sparkle(pos.x, pos.y, pos.z, 10);
      msg.className = 'sl-msg win';
    }
    msg.textContent = o.payout > 0 ? o.label.toUpperCase() : 'PLAY AGAIN';
    owed = null;
    s.settle(bet, o.payout);
    // The win meter counts up.
    if (o.payout > 0) {
      const steps = Math.min(24, Math.max(4, Math.round(o.payout / bet) * 3));
      for (let k = 1; k <= steps; k++) {
        winM.textContent = formatMoney(Math.round((o.payout * k) / steps));
        audio.play('coin', { volume: 0.2, pitch: 0.9 + k / steps });
        await sleep(45);
      }
    }
    refreshMeters();
    spinning = false;
    spinBtn.disabled = false;
  };
  const payRows = table.map((l) => {
    const icons = l.kind === 'three' ? [l.sym, l.sym, l.sym] : l.kind === 'two' ? [l.sym, l.sym] : [l.sym];
    return h('div', { class: 'mg-pay-row' },
      h('span', { class: 'mg-pay-icons' }, ...icons.map((sy) => h('img', { src: urls[sy], alt: SYMBOL_NAMES[sy] }))),
      h('b', { text: l.sym === 0 && l.kind === 'three' && item.def.jackpot ? `Jackpot ${formatMoney(g.jackpotPot, true)}` : `×${l.mult}` }),
    );
  });
  const top = table.filter((l) => l.kind === 'three').slice(0, 4);
  const glass = h('div', { class: 'sl-glass' },
    ...top.map((l) => h('span', { class: 'sl-pay' },
      ...[0, 1, 2].map(() => h('img', { src: urls[l.sym], alt: SYMBOL_NAMES[l.sym] })),
      h('b', { text: l.sym === 0 && item.def.jackpot ? 'JACKPOT' : `${l.mult}×` }))));
  const body = h('div', { class: 'mg' },
    s.head,
    h('div', { class: `sl-machine${low ? ' low' : ''}` },
      h('div', { class: 'sl-top' },
        h('span', { class: 'sl-name', text: item.def.name.toUpperCase() }),
        item.def.jackpot ? h('span', { class: 'sl-jackpot', text: `JACKPOT ${formatMoney(g.jackpotPot, true)}` }) : null),
      glass,
      h('div', { class: 'sl-mid' }, windowEl, lever),
      msg,
      meters,
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Bet per spin' }), betRow),
    spinBtn,
    h('details', { class: 'mg-pay' }, h('summary', { text: 'Full paytable' }), h('div', { class: 'mg-pay-grid' }, ...payRows),
      h('p', { class: 'muted small', text: 'Wins pay on the middle line, as a multiple of your bet. A cherry on the left reel pays even on its own.' })),
  );
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      void spin();
    }
  };
  window.addEventListener('keydown', onKey);
  refreshMeters();
  ctx.modals.open(item.def.name, body, {
    cls: 'minigame',
    onClose: () => {
      window.removeEventListener('keydown', onKey);
      if (owed && !s.closed) s.settle(owed.bet, owed.payout);
      owed = null;
      s.dispose();
    },
  });
}
