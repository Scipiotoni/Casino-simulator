import type { Game } from '../game/game';
import { h } from './dom';
import { formatMoney } from '../core/math';
import { MAX_HP } from '../game/combat';

/**
 * Everything on screen for street fights and first person: the crosshair (it opens up as you
 * move and fire), hit markers, your health, the red flash and arrow when you're hit, the
 * knockout screen, the sniper scope and the "click to look around" hint.
 */
export class CombatHud {
  readonly el: HTMLElement;
  private cross = h('div', { class: 'xhair' }, h('i', { class: 'xh-t' }), h('i', { class: 'xh-b' }), h('i', { class: 'xh-l' }), h('i', { class: 'xh-r' }), h('b', { class: 'xh-dot' }));
  private marker = h('div', { class: 'hitmark' });
  private hpWrap: HTMLElement;
  private hpFill = h('i');
  private hpText = h('span');
  private vignette = h('div', { class: 'hurt-vig' });
  private arrow = h('div', { class: 'hurt-arrow' });
  private koEl = h('div', { class: 'ko-screen', hidden: true });
  private koKey = '';
  private scope = h('div', { class: 'scope', hidden: true });
  private lockHint = h('button', { class: 'lock-hint', hidden: true });
  private markT = -1;

  constructor(private game: Game) {
    this.hpWrap = h('div', { class: 'hpbar', hidden: true, 'aria-label': 'Health' }, h('span', { class: 'hp-ico', text: '❤' }), h('div', { class: 'hp-track' }, this.hpFill), this.hpText);
    this.lockHint.innerHTML = '<b>Click to look around</b><span>Mouse aims · click shoots · right-click aims down the sights · Esc frees the mouse · V switches camera</span>';
    this.lockHint.addEventListener('click', () => game.input.requestLock());
    this.el = h('div', { class: 'combat-hud' }, this.vignette, this.scope, this.cross, this.marker, this.arrow, this.hpWrap, this.koEl, this.lockHint);
  }

  update(dt: number): void {
    const g = this.game;
    const c = g.combat;
    const gp = g.gunplay;
    const playing = g.state === 'playing' && !g.photoMode;
    const fp = playing && g.cam.mode === 'first';
    const armed = playing && gp.drawn;
    // Crosshair: first person always; other views only with a gun out.
    const showCross = fp && !gp.scoped && c.ko <= 0;
    this.cross.hidden = !showCross;
    if (showCross) {
      const gap = 5 + (armed ? (gp.aiming ? 0 : 6) + gp.spreadK * 18 : 2);
      this.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
      this.cross.classList.toggle('armed', armed);
      this.cross.classList.toggle('ads', gp.aiming);
    }
    // Hit marker: a quick X (gold for headshots, red for a knockout).
    if (c.mark && c.mark.t !== this.markT) {
      this.markT = c.mark.t;
      this.marker.className = `hitmark show${c.mark.head ? ' head' : ''}${c.mark.ko ? ' ko' : ''}`;
      void this.marker.offsetWidth;
    }
    if (c.mark && performance.now() - c.mark.t > 260) this.marker.classList.remove('show');
    // Health: shown out on the street, or whenever you're hurt.
    const showHp = playing && (c.hp < MAX_HP || c.ko > 0 || (!g.inside && armed));
    this.hpWrap.hidden = !showHp;
    if (showHp) {
      const pct = Math.max(0, c.hp) / MAX_HP;
      this.hpFill.style.width = `${(pct * 100).toFixed(1)}%`;
      this.hpWrap.classList.toggle('low', pct < 0.35);
      this.hpWrap.classList.toggle('prot', c.protect > 0);
      this.hpText.textContent = c.protect > 0 ? 'Safe' : `${Math.ceil(c.hp)}`;
    }
    this.vignette.style.opacity = String(Math.min(0.85, c.flash + (c.hp < 35 && c.ko <= 0 ? 0.25 + Math.sin(performance.now() / 160) * 0.08 : 0)));
    if (c.hitFrom !== null && c.flash > 0.05) {
      this.arrow.hidden = false;
      // Arrow around the crosshair pointing where the shot came from.
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${(-c.hitFrom + Math.PI) * (180 / Math.PI)}deg) translateY(-90px)`;
      this.arrow.style.opacity = String(Math.min(1, c.flash * 1.5));
    } else this.arrow.hidden = true;
    // Knocked out
    const ko = playing && c.ko > 0;
    this.koEl.hidden = !ko;
    if (ko) {
      const key = `${c.lastKo?.by}|${c.lastKo?.lost}|${Math.ceil(c.ko)}`;
      if (key !== this.koKey) {
        this.koKey = key;
        this.koEl.innerHTML = '';
        this.koEl.append(
          h('div', { class: 'ko-title', text: 'KNOCKED OUT' }),
          h('div', { class: 'ko-by', text: c.lastKo ? `by ${c.lastKo.by}` : '' }),
          h('div', { class: 'ko-lost', text: c.lastKo && c.lastKo.lost > 0 ? `−${formatMoney(c.lastKo.lost)} taken from your pockets` : 'Your pockets were empty' }),
          h('div', { class: 'ko-tip', text: 'Money in your vault at home is always safe.' }),
          h('div', { class: 'ko-timer', text: `Back on your feet in ${Math.ceil(c.ko)}…` }),
        );
      }
    }
    this.scope.hidden = !(fp && gp.scoped);
    // Desktop first person with the mouse free: invite a click.
    this.lockHint.hidden = !(fp && !g.input.isTouch && !g.input.locked && !g.modalOpen && !g.build.active && c.ko <= 0);
    void dt;
  }
}
