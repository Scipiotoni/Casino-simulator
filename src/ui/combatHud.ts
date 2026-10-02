import type { Game } from '../game/game';
import { h } from './dom';
import { formatMoney } from '../core/math';
import { MAX_HP } from '../game/combat';
import { drawReticle, reticleKey } from './reticle';

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
  private scopeCanvas = h('canvas') as HTMLCanvasElement;
  private scope = h('div', { class: 'scope', hidden: true }, this.scopeCanvas);
  private reticleKey = '';
  /** Red dot or holographic ring while aiming through an optic. */
  private optic = h('div', { class: 'optic-dot', hidden: true });
  private lockHint = h('button', { class: 'lock-hint', hidden: true });
  private markT = -1;
  private wanted = h('div', { class: 'wanted', hidden: true, 'aria-label': 'Wanted level' });
  private wantedKey = '';
  private speedo = h('div', { class: 'speedo', hidden: true });
  private speedoKey = '';
  private wp = h('button', { class: 'wp-hud', hidden: true, title: 'Clear the waypoint' });
  private wpKey = '';

  constructor(private game: Game) {
    this.hpWrap = h('div', { class: 'hpbar', hidden: true, 'aria-label': 'Health' }, h('span', { class: 'hp-ico', text: '❤' }), h('div', { class: 'hp-track' }, this.hpFill), this.hpText);
    this.lockHint.innerHTML = '<b>🖱 Move the mouse to look around</b><span>Click to lock the mouse in for smooth 360° turning · A/D strafe · right-click aims · Esc frees it</span>';
    this.lockHint.addEventListener('click', () => game.input.requestLock());
    this.el = h('div', { class: 'combat-hud' }, this.vignette, this.scope, this.optic, this.cross, this.marker, this.arrow, this.hpWrap, this.koEl, this.lockHint, this.wanted, this.speedo, this.wp);
    this.wp.addEventListener('click', () => game.clearWaypoint());
  }

  update(dt: number): void {
    const g = this.game;
    const c = g.combat;
    const gp = g.gunplay;
    const playing = g.state === 'playing' && !g.photoMode;
    const fp = playing && g.cam.mode === 'first';
    const armed = playing && gp.drawn;
    // Crosshair: first person always; other views only with a gun out.
    const optic = fp ? gp.opticSight : null;
    const showCross = fp && !gp.scoped && !optic && c.ko <= 0;
    this.optic.hidden = !(optic === 'reddot' || optic === 'holo');
    this.optic.classList.toggle('holo', optic === 'holo');
    this.cross.hidden = !showCross;
    // Mouse free: the crosshair rides on the cursor (which is hidden over the game).
    const ndc = fp ? g.cam.aimNdc : null;
    const canvas = g.renderer.renderer.domElement;
    // First person: the cursor is hidden over the game; the crosshair is your pointer.
    const cur = (fp && !g.input.isTouch && !g.build.active && !g.modalOpen) || ndc ? 'none' : '';
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
    if (ndc) {
      const { w, h: hh } = g.renderer.size;
      this.cross.style.left = `${((ndc.x + 1) / 2) * w}px`;
      this.cross.style.top = `${((1 - ndc.y) / 2) * hh}px`;
      this.marker.style.left = this.cross.style.left;
      this.marker.style.top = this.cross.style.top;
    } else if (this.cross.style.left) {
      this.cross.style.left = '';
      this.cross.style.top = '';
      this.marker.style.left = '';
      this.marker.style.top = '';
    }
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
    const showHp = playing && (c.hp < MAX_HP || c.ko > 0 || c.teleportLock > 0 || (!g.inside && armed));
    this.hpWrap.hidden = !showHp;
    if (showHp) {
      const pct = Math.max(0, c.hp) / MAX_HP;
      this.hpFill.style.width = `${(pct * 100).toFixed(1)}%`;
      this.hpWrap.classList.toggle('low', pct < 0.35);
      this.hpWrap.classList.toggle('prot', c.protect > 0);
      const lock = c.teleportLock;
      this.hpText.textContent = `${c.protect > 0 ? 'Safe' : Math.ceil(c.hp)}${lock > 0 ? ` · 📍✕ ${Math.ceil(lock)}s` : ''}`;
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
          h('div', { class: 'ko-title', text: c.lastKo?.busted ? 'BUSTED' : 'KNOCKED OUT' }),
          h('div', { class: 'ko-by', text: c.lastKo?.busted ? 'The police caught up with you' : c.lastKo ? `by ${c.lastKo.by}` : '' }),
          h('div', { class: 'ko-lost', text: c.lastKo && c.lastKo.lost > 0 ? `−${formatMoney(c.lastKo.lost)} ${c.lastKo.busted ? 'fine' : 'taken from your pockets'}` : 'Your pockets were empty' }),
          h('div', { class: 'ko-tip', text: g.house?.vault ? `Your vault is untouched: ${formatMoney(g.house.vault)} safe at home.` : 'Money in your vault at home is always safe.' }),
          h('div', { class: 'ko-timer', text: `Back on your feet in ${Math.ceil(c.ko)}…` }),
        );
      }
    }
    // Wanted stars, flashing red and blue while the police can see you.
    const pol = g.street.police;
    const stars = playing ? pol.stars : 0;
    const wkey = `${stars}|${pol.spotted}`;
    if (wkey !== this.wantedKey) {
      this.wantedKey = wkey;
      this.wanted.hidden = stars === 0;
      this.wanted.classList.toggle('spotted', pol.spotted);
      this.wanted.innerHTML = `<span class="w-label">${pol.spotted ? 'WANTED' : 'HIDING'}</span><span class="w-stars">${'<b>★</b>'.repeat(stars)}${'<i>★</i>'.repeat(5 - stars)}</span>`;
    }
    this.scope.hidden = !(fp && gp.scoped);
    // Your crosshair: full-screen scope reticle and the on-screen crosshair's colour and size.
    const ret = g.reticle;
    const rk = `${reticleKey(ret)}|${window.innerWidth}x${window.innerHeight}`;
    if (rk !== this.reticleKey) {
      this.reticleKey = rk;
      const px = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.72 * Math.min(2, window.devicePixelRatio || 1));
      this.scopeCanvas.width = this.scopeCanvas.height = Math.max(64, px);
      const ctx = this.scopeCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, px, px);
        drawReticle(ctx, px, ret);
      }
      // On screen a black crosshair would vanish against the night: default black means white there.
      this.cross.style.setProperty('--xh-color', ret.color === '#111111' ? '#ffffff' : ret.color);
      this.cross.style.setProperty('--xh-len', `${Math.round(8 * ret.size)}px`);
      this.cross.style.setProperty('--xh-w', `${ret.thick}px`);
      this.cross.classList.toggle('dot-only', ret.style === 'dot');
    }
    // Speedometer behind the wheel
    const car = playing ? g.drive.driving : null;
    const nitro = car?.mods?.nitro ? Math.round(g.drive.nitro * 20) : -1;
    const skey = car ? `${car.name}|${Math.round(Math.abs(car.speed) * 3.6)}|${nitro}` : '';
    if (skey !== this.speedoKey) {
      this.speedoKey = skey;
      this.speedo.hidden = !car;
      if (car) this.speedo.innerHTML = `<b>${Math.round(Math.abs(car.speed) * 3.6)}</b><span>km/h</span><i>${car.name}${car.stolen ? ' · stolen' : ''}</i>${nitro >= 0 ? `<em class="nitro"><u style="width:${nitro * 5}%"></u></em><span>NITRO · Shift</span>` : ''}`;
    }
    // Waypoint: what it is, how far, and which way (relative to where the camera looks).
    const wpt = playing ? g.waypoint : null;
    if (wpt) {
      const p = g.street.worldToGlobal(g.player.x, g.player.z);
      const dist = Math.hypot(wpt.x - p.x, wpt.z - p.z);
      const side = g.street.placeOf(g.street.activeId).side;
      const ca = g.cam.yaw + (side ? Math.PI : 0);
      // Camera forward is (-sin, -cos); angle of the waypoint from it, clockwise on screen.
      const ang = Math.atan2(wpt.x - p.x, wpt.z - p.z) - Math.atan2(-Math.sin(ca), -Math.cos(ca));
      const deg = Math.round((-ang * 180) / Math.PI / 5) * 5;
      const key = `${wpt.label}|${Math.round(dist / 5)}|${deg}`;
      if (key !== this.wpKey) {
        this.wpKey = key;
        this.wp.innerHTML = `<i style="transform:rotate(${deg}deg)">➤</i><b>${wpt.label === 'Waypoint' ? 'Waypoint' : wpt.label.replace(/[<>&]/g, '')}</b><span>${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}</span><u>✕</u>`;
      }
    } else this.wpKey = '';
    this.wp.hidden = !wpt;
    // Desktop first person with the mouse free: invite a click.
    this.lockHint.hidden = !(fp && !g.input.isTouch && !g.input.locked && !g.input.lockFailed && !g.modalOpen && !g.build.active && c.ko <= 0);
    void dt;
  }
}
