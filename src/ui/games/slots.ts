import { h, icon } from '../dom';
import { REEL_SYMBOLS, drawSymbol } from '../../render/textures';
import { resolveSlot, SLOT_TABLE, SLOT_TABLE_LOW } from '../../items/games';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { type GameCtx, Session, chipRow, chipValues } from './common';

const CELL = 92;
const LOOP = REEL_SYMBOLS.length;
const STRIP_LOOPS = 7;

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

/** Spin any slot machine in someone else's casino with your own money. */
export function openSlots(ctx: GameCtx): void {
  const { game: g, item } = ctx;
  const s = new Session(ctx);
  const urls = symbols();
  const low = item.def.params?.volatility === 'low';
  const table = low ? SLOT_TABLE_LOW : SLOT_TABLE;
  const reels: { strip: HTMLElement; pos: number }[] = [];
  const window_ = h('div', { class: 'mg-window' });
  for (let r = 0; r < 3; r++) {
    const strip = h('div', { class: 'mg-strip' });
    for (let i = 0; i < LOOP * STRIP_LOOPS; i++) {
      strip.appendChild(h('div', { class: 'mg-cell' }, h('img', { src: urls[i % LOOP], alt: SYMBOL_NAMES[i % LOOP] })));
    }
    const start = Math.floor(Math.random() * LOOP);
    strip.style.transform = `translateY(${-(start * CELL)}px)`;
    window_.appendChild(h('div', { class: 'mg-reel' }, strip));
    reels.push({ strip, pos: start });
  }
  window_.appendChild(h('div', { class: 'mg-payline' }));
  const result = h('div', { class: 'mg-result', text: 'Place your bet and pull!' });
  const bets = chipValues(item.minBet);
  let bet = bets[Math.min(1, bets.length - 1)];
  let spinning = false;
  const betRow = chipRow(bets, () => bet, (v) => {
    if (spinning) return;
    bet = v;
    refresh();
  }, { min: item.minBet, bank: () => s.bank });
  const spinBtn = h('button', { class: 'btn gold mg-spin', onClick: () => void spin() });
  const refresh = () => {
    spinBtn.innerHTML = `${icon('dice', 20)} SPIN · ${formatMoney(bet)}`;
  };
  const spin = async () => {
    if (spinning || s.closed) return;
    if (!s.bet(bet)) {
      result.textContent = 'Not enough cash in the bank!';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    const o = resolveSlot(bet, item.def.rtp, false, item.def.jackpot ? g.jackpotPot : 0, low ? 'low' : 'normal');
    s.spinMachine(o, 2.0);
    if (o.visual.kind !== 'slot') return;
    const target = o.visual.symbols;
    audio.play('spin');
    result.textContent = 'Spinning…';
    result.className = 'mg-result';
    const durations = [1.1, 1.55, 2.0];
    await Promise.all(reels.map((reel, i) => new Promise<void>((resolve) => {
      const loops = 3 + i;
      const from = reel.pos;
      const dest = (Math.floor(from / LOOP) + loops) * LOOP + target[i];
      const strip = reel.strip;
      strip.style.transition = `transform ${durations[i]}s cubic-bezier(0.18, 0.75, 0.25, 1.06)`;
      strip.style.transform = `translateY(${-(dest * CELL)}px)`;
      window.setTimeout(() => {
        audio.play('tick', { pitch: 0.8 + i * 0.15 });
        // Snap back to an equivalent cell near the top so the strip never runs out.
        strip.style.transition = 'none';
        reel.pos = target[i] + LOOP;
        strip.style.transform = `translateY(${-(reel.pos * CELL)}px)`;
        resolve();
      }, durations[i] * 1000 + 30);
    })));
    if (o.label === 'MEGA JACKPOT!') g.resetJackpot();
    const pos = item.root.position.clone().setY(item.model.height + 0.3);
    if (o.tier === 'jackpot') {
      audio.play('jackpot');
      g.effects.confetti(pos.x, pos.y, pos.z, 180, 1.2);
      g.cam.shake(0.15);
      result.className = 'mg-result jackpot';
    } else if (o.tier === 'big') {
      g.effects.confetti(pos.x, pos.y, pos.z, 60, 0.9);
      result.className = 'mg-result big';
    } else if (o.tier === 'win' || o.tier === 'push') {
      g.effects.sparkle(pos.x, pos.y, pos.z, 10);
      result.className = 'mg-result win';
    }
    result.textContent = o.payout > 0 ? `${o.label}  +${formatMoney(o.payout)}` : o.label;
    s.settle(bet, o.payout);
    spinning = false;
    spinBtn.disabled = false;
  };
  const pay = h('details', { class: 'mg-pay' },
    h('summary', { text: 'Paytable' }),
    h('div', { class: 'mg-pay-grid' },
      ...table.map((l) => {
        const icons = l.kind === 'three' ? [l.sym, l.sym, l.sym] : l.kind === 'two' ? [l.sym, l.sym] : [l.sym];
        return h('div', { class: 'mg-pay-row' },
          h('span', { class: 'mg-pay-icons' }, ...icons.map((sy) => h('img', { src: urls[sy], alt: SYMBOL_NAMES[sy] }))),
          h('b', { text: l.sym === 0 && l.kind === 'three' && item.def.jackpot ? `Jackpot ${formatMoney(g.jackpotPot, true)}` : `×${l.mult}` }),
        );
      }),
    ),
  );
  const body = h('div', { class: 'mg' }, s.head, window_, result, h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Bet' }), betRow), spinBtn, pay);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      void spin();
    }
  };
  window.addEventListener('keydown', onKey);
  refresh();
  ctx.modals.open(item.def.name, body, {
    cls: 'minigame',
    onClose: () => {
      window.removeEventListener('keydown', onKey);
      s.dispose();
    },
  });
}
