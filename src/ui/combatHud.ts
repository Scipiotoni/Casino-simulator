import type { Game } from '../game/game';
import { h } from './dom';
import { formatMoney } from '../core/math';
import { MAX_HP } from '../game/combat';
import { MAX_STAMINA } from '../game/melee';
import { PERFECT_WINDOW } from '../game/guns';
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
  /** Fist fights: stamina, and your stance (blocking, combo, wind-up, counter ready, stunned). */
  private stFill = h('i');
  private stText = h('span', { class: 'st-text' });
  private stWrap = h('div', { class: 'stbar', hidden: true, 'aria-label': 'Stamina' }, h('span', { class: 'st-ico', text: '⚡' }), h('div', { class: 'st-track' }, this.stFill), this.stText);
  private vignette = h('div', { class: 'hurt-vig' });
  private arrow = h('div', { class: 'hurt-arrow' });
  private koEl = h('div', { class: 'ko-screen', hidden: true });
  private koKey = '';
  private scopeCanvas = h('canvas') as HTMLCanvasElement;
  private zoomEl = h('div', { class: 'scope-zoom' });
  private scope = h('div', { class: 'scope', hidden: true }, this.scopeCanvas, this.zoomEl);
  private reticleKey = '';
  /** Red dot or holographic ring while aiming through an optic. */
  private optic = h('canvas', { class: 'optic-dot', hidden: true }) as HTMLCanvasElement;
  private opticKey = '';
  private lockHint = h('button', { class: 'lock-hint', hidden: true });
  private markT = -1;
  private wanted = h('div', { class: 'wanted', hidden: true, 'aria-label': 'Wanted level' });
  private wantedKey = '';
  private speedo = h('div', { class: 'speedo', hidden: true });
  private speedoKey = '';
  private wp = h('button', { class: 'wp-hud', hidden: true, title: 'Clear the waypoint' });
  private wpKey = '';
  /** Active reload: a bar with the sweet spot; the marker runs across it. */
  private reloadFill = h('i', { class: 'ar-mark' });
  private reloadEl = h('div', { class: 'active-reload', hidden: true },
    h('span', { class: 'ar-label', text: 'R again in the gold zone' }),
    h('div', { class: 'ar-track' }, h('b', { class: 'ar-sweet', style: `left:${PERFECT_WINDOW[0] * 100}%;width:${(PERFECT_WINDOW[1] - PERFECT_WINDOW[0]) * 100}%` }), this.reloadFill));
  /** Railgun charge. */
  private chargeFill = h('i');
  private chargeEl = h('div', { class: 'charge-meter', hidden: true }, this.chargeFill);
  /** Kill feed (top right) and big call-outs (DOUBLE KO, KILLING SPREE…). */
  private feedEl = h('div', { class: 'kill-feed' });
  private feedKey = '';
  private bannerEl = h('div', { class: 'ko-banner', hidden: true });
  /** The drift going on (score, angle), and the one you just finished. */
  private driftEl = h('div', { class: 'drift-meter', hidden: true });
  private driftKey = '';
  private bannerT = -1;

  constructor(private game: Game) {
    this.hpWrap = h('div', { class: 'hpbar', hidden: true, 'aria-label': 'Health' }, h('span', { class: 'hp-ico', text: '❤' }), h('div', { class: 'hp-track' }, this.hpFill), this.hpText);
    this.lockHint.innerHTML = '<b>🖱 Move the mouse to look around</b><span>Click to lock the mouse in for smooth 360° turning · A/D strafe · right-click aims · Esc frees it</span>';
    this.lockHint.addEventListener('click', () => game.input.requestLock());
    this.el = h('div', { class: 'combat-hud' }, this.vignette, this.scope, this.optic, this.cross, this.marker, this.arrow, this.hpWrap, this.stWrap, this.koEl, this.lockHint, this.wanted, this.speedo, this.wp, this.reloadEl, this.chargeEl, this.feedEl, this.bannerEl, this.driftEl);
    this.wp.addEventListener('click', () => game.clearWaypoint());
    // The tank's fire button (redrawn with the speedo, so listen on the speedo itself).
    this.speedo.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.tank-fire')) {
        e.preventDefault();
        e.stopPropagation();
        game.drive.fireRequest = true;
      }
      // Touch: hold DRIFT for the handbrake.
      if ((e.target as HTMLElement).closest('.drift-btn')) {
        e.preventDefault();
        e.stopPropagation();
        game.drive.handbrake = true;
      }
    });
    const release = () => (game.drive.handbrake = false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
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
    // Red dot / holographic sight: your crosshair, seen through the glass in the middle.
    this.optic.hidden = !(optic === 'reddot' || optic === 'holo');
    if (!this.optic.hidden) {
      const r = g.reticle;
      // Black would vanish in a red dot: those glow red (holo: cyan) unless you picked a colour.
      const col = r.color === '#111111' ? (optic === 'holo' ? '#2fe6ff' : '#ff2a2a') : r.color;
      const key = `${reticleKey(r)}|${optic}|${col}`;
      if (key !== this.opticKey) {
        this.opticKey = key;
        const px = 220;
        this.optic.width = this.optic.height = px;
        const ctx = this.optic.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, px, px);
          ctx.shadowColor = col;
          ctx.shadowBlur = 6;
          drawReticle(ctx, px, { ...r, color: col }, px * 0.42);
        }
        this.optic.style.setProperty('--os', `${Math.round(90 * r.size)}px`);
      }
    }
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
    // Active reload bar (and how the last try went).
    const rp = playing ? gp.reloadProgress : -1;
    const rr = gp.reloadResult;
    const flashRes = rr && performance.now() - rr.at < 600 ? rr.kind : '';
    this.reloadEl.hidden = rp < 0 && !flashRes;
    if (!this.reloadEl.hidden) {
      this.reloadFill.style.left = `${Math.max(0, rp) * 100}%`;
      this.reloadEl.className = `active-reload${gp.reloadTried ? ' tried' : ''}${flashRes ? ` ${flashRes}` : ''}`;
    }
    // Railgun charge
    const d = gp.def;
    this.chargeEl.hidden = !(playing && d?.charge && gp.chargeT > 0);
    if (!this.chargeEl.hidden && d?.charge) {
      const k = gp.chargeT / d.charge;
      this.chargeFill.style.width = `${(k * 100).toFixed(0)}%`;
      this.chargeEl.classList.toggle('full', k >= 1);
    }
    // Kill feed
    const fk = c.feed.map((f) => `${f.t}`).join(',');
    if (fk !== this.feedKey) {
      this.feedKey = fk;
      this.feedEl.replaceChildren(...c.feed.map((f) => h('div', { class: `kf-line${f.mine ? ' mine' : ''}`, text: f.text })));
    }
    // Call-outs
    if (c.banner && c.banner.t !== this.bannerT) {
      this.bannerT = c.banner.t;
      this.bannerEl.replaceChildren(h('b', { text: c.banner.text }), c.banner.sub ? h('span', { text: c.banner.sub }) : '');
      this.bannerEl.hidden = false;
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('show');
    }
    if (c.banner && performance.now() - c.banner.t > 2200) this.bannerEl.hidden = true;
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
    // Stamina and stance while your fists (or a melee weapon) are up, or while you get your breath back.
    const br = c.brawl;
    const melee = armed && !!gp.def?.melee;
    const showSt = playing && !g.inside && c.ko <= 0 && (melee || br.stamina < MAX_STAMINA - 0.5 || br.stunned);
    this.stWrap.hidden = !showSt;
    if (showSt) {
      this.stFill.style.width = `${((br.stamina / MAX_STAMINA) * 100).toFixed(1)}%`;
      this.stWrap.classList.toggle('low', br.winded);
      const stance = br.stunned ? '💫 Stunned!' : br.riposte > 0 ? '⚔ Counter ready (×2)' : br.blocking ? (br.parryArmed && br.blockFor < 0.25 ? '🛡 Parry!' : '🛡 Blocking') : br.charge > 0 ? `💪 Heavy ${Math.round(br.charge * 100)}%` : br.combo > 0 ? `👊 Combo ${br.combo + 1}/3` : '';
      this.stText.textContent = stance;
      this.stText.hidden = !stance;
      this.stWrap.classList.toggle('alert', br.stunned || br.riposte > 0);
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
    if (!this.scope.hidden) {
      const z = `${gp.magnification.toFixed(1)}×  ·  wheel to zoom`;
      if (this.zoomEl.textContent !== z) this.zoomEl.textContent = z;
    }
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
    const dr = g.drive;
    const gearLabel = car ? (dr.gear === 0 ? 'R' : String(dr.gear)) : '';
    const hpPct = car ? Math.round((car.hp / car.maxHp) * 100) : 0;
    const cannon = car?.def?.cannon ? Math.ceil(car.cannonT ?? 0) : -1;
    const skey = car ? `${car.name}|${Math.round(Math.abs(car.speed) * 3.6)}|${nitro}|${gearLabel}|${dr.manual}|${Math.round(dr.rpm * 20)}|${hpPct}|${cannon}` : '';
    if (skey !== this.speedoKey) {
      this.speedoKey = skey;
      this.speedo.hidden = !car;
      if (car) this.speedo.innerHTML = `<b>${Math.round(Math.abs(car.speed) * 3.6)}</b><span>km/h</span><div class="gearbox"><strong class="${dr.rpm > 0.93 ? 'red' : ''}">${gearLabel}</strong><em class="rpm"><u style="width:${Math.min(100, Math.round(dr.rpm * 100))}%"></u></em><small>${dr.manual ? 'MANUAL · Q/R' : 'AUTO · Z'}</small></div><i>${car.name}${car.stolen ? ' · stolen' : ''}</i><em class="carhp${hpPct < 25 ? ' crit' : hpPct < 50 ? ' low' : ''}" title="Durability"><u style="width:${hpPct}%"></u></em><span>🛠 ${hpPct}%</span>${cannon >= 0 ? `<button class="tank-fire" type="button">${cannon > 0 ? `Reloading ${cannon}s` : '💥 FIRE · click / F'}</button>` : g.input.isTouch ? '<button class="drift-btn" type="button">💨 DRIFT</button>' : ''}${nitro >= 0 ? `<em class="nitro"><u style="width:${nitro * 5}%"></u></em><span>NITRO · Shift</span>` : ''}`;
    }
    // Drift score: live while you slide, then what you banked (or WIPED OUT).
    const dft = car && !car.def?.cannon ? dr.drift : null;
    const live = !!dft && dft.t > 0.35;
    const done = !!dft && !live && dft.doneT > 0;
    const dkey = live ? `l${Math.round(dft!.score / 10)}|${Math.round(dft!.angle * 57.3 / 5)}` : done ? `d${dft!.done}|${dft!.wiped}` : '';
    if (dkey !== this.driftKey) {
      this.driftKey = dkey;
      this.driftEl.hidden = !live && !done;
      this.driftEl.classList.toggle('done', done);
      this.driftEl.classList.toggle('wiped', done && dft!.wiped);
      if (live) {
        const mult = 1 + Math.min(2, dft!.t / 3);
        this.driftEl.innerHTML = `<small>DRIFT · ${Math.round(dft!.angle * 57.3)}°</small><b>${Math.round(dft!.score).toLocaleString('en-US')}</b><em>×${mult.toFixed(1)}</em>`;
      } else if (done) {
        this.driftEl.innerHTML = dft!.wiped ? '<small>DRIFT LOST</small><b>WIPED OUT</b>' : `<small>NICE DRIFT</small><b>+${dft!.done.toLocaleString('en-US')}</b>${(g.stats.bestDrift ?? 0) <= dft!.done ? '<em>BEST!</em>' : ''}`;
      }
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
