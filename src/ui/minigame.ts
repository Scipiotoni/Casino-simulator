import type { Game } from '../game/game';
import type { Modals } from './modals';
import type { PlacedItem } from '../items/placedItem';
import { h, icon } from './dom';
import { REEL_SYMBOLS, drawSymbol } from '../render/textures';
import { resolveSlot, SLOT_TABLE, SLOT_TABLE_LOW } from '../items/games';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';

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

/** The manager can take a spin on any slot machine with the casino's own money. */
export class SlotMiniGame {
  private spinning = false;
  private bet = 25;
  private net = 0;
  private spins = 0;

  constructor(private modals: Modals, private game: Game) {}

  open(item: PlacedItem): void {
    const g = this.game;
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
    const netEl = h('div', { class: 'mg-net' });
    const freeBadge = h('div', { class: 'mg-free', text: 'Daily free spin ready!' });
    const bets = [10, 25, 50, 100, 250, 500].filter((b) => b <= Math.max(50, item.maxBet * 5));
    if (!bets.includes(this.bet)) this.bet = bets[1] ?? bets[0];
    const betRow = h('div', { class: 'chips mg-bets' });
    const renderBets = () => {
      betRow.replaceChildren(
        ...bets.map((b) =>
          h('button', {
            class: `chip-btn${b === this.bet ? ' on' : ''}`, text: formatMoney(b),
            onClick: () => { if (!this.spinning) { this.bet = b; renderBets(); audio.play('chips'); } },
          }),
        ),
      );
    };
    renderBets();
    const refresh = () => {
      const free = g.freeSpinReady;
      freeBadge.hidden = !free;
      spinBtn.innerHTML = free ? `${icon('dice', 20)} FREE SPIN` : `${icon('dice', 20)} SPIN · ${formatMoney(this.bet)}`;
      netEl.innerHTML = this.spins ? `Session: <b class="${this.net >= 0 ? 'pos' : 'neg'}">${this.net >= 0 ? '+' : ''}${formatMoney(this.net)}</b> over ${this.spins} spins` : 'Your bank pays the bets. The house edge still applies… mostly.';
    };
    const spinBtn = h('button', { class: 'btn gold mg-spin', onClick: () => void spin() });
    const spin = async () => {
      if (this.spinning) return;
      const free = g.freeSpinReady;
      if (!free && g.money < this.bet) {
        audio.play('error');
        result.textContent = 'Not enough cash in the bank!';
        return;
      }
      this.spinning = true;
      spinBtn.disabled = true;
      if (free) g.useFreeSpin();
      else g.spend(this.bet, 'play');
      const o = resolveSlot(this.bet, item.def.rtp, false, item.def.jackpot ? g.jackpotPot : 0, low ? 'low' : 'normal');
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
      this.spins++;
      const cost = free ? 0 : this.bet;
      this.net += o.payout - cost;
      g.stats.managerSpins = (g.stats.managerSpins ?? 0) + 1;
      if (o.payout > 0) {
        g.addMoney(o.payout, 'play');
        if (o.label === 'MEGA JACKPOT!') g.resetJackpot();
      }
      const pos = item.root.position.clone().setY(item.model.height + 0.3);
      if (o.tier === 'jackpot') {
        audio.play('jackpot');
        g.effects.confetti(pos.x, pos.y, pos.z, 180, 1.2);
        g.cam.shake(0.15);
        result.className = 'mg-result jackpot';
      } else if (o.tier === 'big') {
        audio.play('bigwin');
        g.effects.confetti(pos.x, pos.y, pos.z, 60, 0.9);
        result.className = 'mg-result big';
      } else if (o.tier === 'win' || o.tier === 'push') {
        audio.play('win');
        g.effects.sparkle(pos.x, pos.y, pos.z, 10);
        result.className = 'mg-result win';
      }
      result.textContent = o.payout > 0 ? `${o.label}  +${formatMoney(o.payout)}` : o.label;
      this.spinning = false;
      spinBtn.disabled = false;
      refresh();
    };
    const pay = h('details', { class: 'mg-pay' },
      h('summary', { text: 'Paytable' }),
      h('div', { class: 'mg-pay-grid' },
        ...table.map((l) => {
          const icons = l.kind === 'three' ? [l.sym, l.sym, l.sym] : l.kind === 'two' ? [l.sym, l.sym] : [l.sym];
          return h('div', { class: 'mg-pay-row' },
            h('span', { class: 'mg-pay-icons' }, ...icons.map((s) => h('img', { src: urls[s], alt: SYMBOL_NAMES[s] }))),
            h('b', { text: l.sym === 0 && l.kind === 'three' && item.def.jackpot ? `Jackpot ${formatMoney(g.jackpotPot, true)}` : `×${l.mult}` }),
          );
        }),
      ),
    );
    const body = h('div', { class: 'mg' }, freeBadge, window_, result, h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Bet' }), betRow), spinBtn, netEl, pay);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        void spin();
      }
    };
    window.addEventListener('keydown', onKey);
    refresh();
    this.modals.open(`${item.def.name} · Manager’s spin`, body, { cls: 'minigame', onClose: () => window.removeEventListener('keydown', onKey) });
  }
}
