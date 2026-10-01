import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { GUNS, gunDef } from '../game/guns';
import { gunThumb } from './preview';

/** The counter at Bullseye Guns: buy, draw or holster. */
export function openGunShop(game: Game, modals: Modals): void {
  const g = game;
  const body = h('div', { class: 'stack' });
  const level = () => (g.site === 'casino' && !g.visiting ? g.level : g.homeLevel);
  const render = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted small', text: 'Guns only fire out on the streets and sidewalks. Shoot tin cans, bottles and balloons; inside any building they stay holstered. Paid from the cash you have on you.' }));
    const grid = h('div', { class: 'gun-grid' });
    for (const d of GUNS) {
      const owned = g.guns.owned.includes(d.id);
      const on = g.guns.equipped === d.id;
      const locked = !owned && level() < d.unlock;
      const stats = `${d.auto ? 'Full auto' : 'Semi-auto'} · ${d.mag} rounds${d.pellets > 1 ? ` · ${d.pellets} pellets` : ''} · range ${d.range} m`;
      grid.appendChild(h('div', { class: `gun-card${on ? ' on' : ''}${locked ? ' locked' : ''}` },
        h('img', { class: 'gun-thumb', src: gunThumb(d), alt: '' }),
        h('div', { class: 'gun-name', text: d.name }),
        h('div', { class: 'muted small', text: d.blurb }),
        h('div', { class: 'gun-stats', text: stats }),
        owned
          ? h('button', { class: `btn small${on ? '' : ' gold'}`, text: on ? 'Holster' : 'Draw', onClick: () => { g.equipGun(on ? null : d.id); render(); } })
          : h('button', {
            class: 'btn small gold', disabled: locked,
            html: locked ? `Casino level ${d.unlock}` : `Buy <b>${formatMoney(d.price)}</b>`,
            onClick: () => { if (g.buyGun(d.id)) render(); },
          }),
      ));
    }
    body.appendChild(grid);
  };
  render();
  const off = g.events.on('money', () => render());
  audio.play('doorbell', { pitch: 0.8 });
  modals.open('Bullseye Guns', body, { wide: true, onClose: off });
}

/** Bottom-right gun bar: the gun in your hand, ammo, reload, holster and (on touch) a fire button. */
export class GunBar {
  readonly el: HTMLElement;
  private name = h('div', { class: 'gb-name' });
  private ammo = h('div', { class: 'gb-ammo' });
  private fire: HTMLButtonElement;
  private swap: HTMLButtonElement;
  private ads: HTMLButtonElement;
  private hint = h('div', { class: 'gb-hint' });
  private key = '';

  constructor(private game: Game) {
    const g = game;
    this.fire = h('button', { class: 'gb-fire', text: 'FIRE', 'aria-label': 'Fire' }) as HTMLButtonElement;
    this.fire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.gunplay.fireHeld = true;
      g.gunplay.firePressed = true;
    });
    const up = () => (g.gunplay.fireHeld = false);
    this.fire.addEventListener('pointerup', up);
    this.fire.addEventListener('pointercancel', up);
    this.fire.addEventListener('pointerleave', up);
    this.swap = h('button', {
      class: 'gb-btn', text: '⇄', title: 'Next gun', 'aria-label': 'Next gun',
      onClick: () => {
        const owned = g.guns.owned;
        if (!owned.length) return;
        const i = g.guns.equipped ? owned.indexOf(g.guns.equipped) : -1;
        g.equipGun(i + 1 >= owned.length ? null : owned[i + 1]);
      },
    }) as HTMLButtonElement;
    this.ads = h('button', {
      class: 'gb-ads', text: 'AIM', 'aria-label': 'Aim down the sights',
      onClick: () => { g.gunplay.adsTouch = !g.gunplay.adsTouch; this.key = ''; },
    }) as HTMLButtonElement;
    this.el = h('div', { class: 'gunbar', hidden: true },
      h('div', { class: 'gb-info' }, this.name, this.ammo, this.hint),
      h('button', { class: 'gb-btn', text: '⟳', title: 'Reload (R)', 'aria-label': 'Reload', onClick: () => g.gunplay.reload() }),
      this.swap,
      this.ads,
      this.fire,
    );
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyG' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.swap.click();
    });
  }

  update(): void {
    const g = this.game;
    const has = g.guns.owned.length > 0 && g.state === 'playing';
    const d = gunDef(g.guns.equipped);
    const gp = g.gunplay;
    const out = gp.canShoot;
    const fp = g.cam.mode === 'first';
    const key = `${has}|${d?.id}|${d ? gp.ammoOf(d.id) : 0}|${gp.reloading > 0}|${out}|${g.input.isTouch}|${fp}|${gp.adsTouch}`;
    if (key === this.key) return;
    this.key = key;
    this.el.hidden = !has;
    if (!has) return;
    this.el.classList.toggle('armed', !!d && out);
    this.name.textContent = d ? `🔫 ${d.name}` : '🔫 Holstered';
    this.ammo.textContent = d ? (gp.reloading > 0 ? 'Reloading…' : `${gp.ammoOf(d.id)} / ${d.mag}`) : 'G to draw';
    this.hint.textContent = !d ? '' : out
      ? (g.input.isTouch ? (fp ? 'Drag to look · Hold FIRE' : 'Hold FIRE') : fp ? 'Click shoot · Right-click aim · R reload' : 'Click to shoot · R reload · G switch · V first person')
      : 'Street only';
    this.fire.hidden = !g.input.isTouch || !d || !out;
    this.ads.hidden = !g.input.isTouch || !d || !out || !fp;
    this.ads.classList.toggle('on', gp.adsTouch);
  }
}
