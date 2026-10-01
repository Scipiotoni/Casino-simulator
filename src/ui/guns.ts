import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { GUNS, SLOTS, gunDef, gunModsOf, gunModsSummary, tunedGun } from '../game/guns';
import { openGunCustomize } from './gunCustomize';
import { gunThumb } from './preview';

/** The counter at Bullseye Guns: buy, draw or holster. */
export function openGunShop(game: Game, modals: Modals): void {
  const g = game;
  const body = h('div', { class: 'stack' });
  const level = () => (g.site === 'casino' && !g.visiting ? g.level : g.homeLevel);
  const render = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted small', text: 'Guns and melee weapons only work out on the streets and sidewalks; inside any building they stay put away. Put what you own on keys 1–5 with the number buttons under each one. Paid from the cash you have on you.' }));
    const grid = h('div', { class: 'gun-grid' });
    const guns = GUNS.filter((d) => !d.melee);
    const melee = GUNS.filter((d) => d.melee);
    for (const d of [...guns, ...melee]) {
      if (d === melee[0]) grid.appendChild(h('div', { class: 'gun-sep', text: '🏏 Melee' }));
      const owned = g.guns.owned.includes(d.id);
      const on = g.guns.equipped === d.id;
      const locked = !owned && level() < d.unlock;
      const mods = owned ? gunModsOf(g.guns, d.id) : null;
      const t = tunedGun(d, mods);
      const stats = d.melee ? `Melee · ${d.dmg} damage · reach ${d.range} m` : `${d.auto ? 'Full auto' : 'Semi-auto'} · ${t.mag} rounds${d.pellets > 1 ? ` · ${d.pellets} pellets` : ''} · ${d.dmg} damage · range ${Math.round(t.range)} m`;
      const fitted = mods ? gunModsSummary(mods) : '';
      const slotRow = h('div', { class: 'slot-row' });
      if (owned) {
        slotRow.appendChild(h('span', { class: 'muted small', text: 'Key' }));
        for (let k = 0; k < SLOTS; k++) {
          const on = g.guns.slots[k] === d.id;
          slotRow.appendChild(h('button', {
            class: `slot-btn${on ? ' on' : ''}${!on && g.guns.slots[k] ? ' used' : ''}`, text: String(k + 1),
            title: on ? `On key ${k + 1} (click to clear)` : g.guns.slots[k] ? `Replace ${gunDef(g.guns.slots[k])?.name} on key ${k + 1}` : `Put on key ${k + 1}`,
            onClick: () => { g.assignSlot(k, on ? null : d.id); render(); },
          }));
        }
      }
      grid.appendChild(h('div', { class: `gun-card${on ? ' on' : ''}${locked ? ' locked' : ''}` },
        h('img', { class: 'gun-thumb', src: gunThumb(d, mods), alt: '' }),
        h('div', { class: 'gun-name', text: d.name }),
        h('div', { class: 'muted small', text: d.blurb }),
        h('div', { class: 'gun-stats', text: stats }),
        fitted ? h('div', { class: 'gun-stats pos', text: `🎨 ${fitted}` }) : null,
        slotRow,
        owned
          ? h('div', { class: 'btn-row' },
            h('button', { class: `btn small${on ? '' : ' gold'}`, text: on ? 'Holster' : 'Draw', onClick: () => { g.equipGun(on ? null : d.id); render(); } }),
            h('button', { class: 'btn small', text: '🎨 Customize', onClick: () => { modals.close(); openGunCustomize(g, modals, d.id, () => openGunShop(g, modals)); } }))
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
  private slotsEl = h('div', { class: 'gb-slots' });
  private reloadBtn!: HTMLButtonElement;
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
        // Cycle through what's on the keys (then holster).
        const list = g.guns.slots.filter((x): x is string => !!x);
        const owned = list.length ? list : g.guns.owned;
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
      this.slotsEl,
      h('div', { class: 'gb-info' }, this.name, this.ammo, this.hint),
      (this.reloadBtn = h('button', { class: 'gb-btn', text: '⟳', title: 'Reload (R)', 'aria-label': 'Reload', onClick: () => g.gunplay.reload() }) as HTMLButtonElement),
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
    const key = `${has}|${d?.id}|${gp.def ? JSON.stringify(gp.def.mods) : ''}|${d ? gp.ammoOf(d.id) : 0}|${gp.reloading > 0}|${out}|${g.input.isTouch}|${fp}|${gp.adsTouch}|${g.guns.slots.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.el.hidden = !has;
    if (!has) return;
    this.el.classList.toggle('armed', !!d && out);
    this.name.textContent = d ? `${d.melee ? '🏏' : '🔫'} ${d.name}` : '🔫 Holstered';
    this.ammo.textContent = d ? (d.melee ? 'Melee' : gp.reloading > 0 ? 'Reloading…' : `${gp.ammoOf(d.id)} / ${gp.def?.mag ?? d.mag}`) : '1–5 to draw';
    // The five slots: click to draw, the number key does the same.
    this.slotsEl.replaceChildren(...g.guns.slots.map((id, k) => {
      const sd = gunDef(id);
      const sm = id ? g.guns.mods?.[id] : null;
      return h('button', {
        class: `gb-slot${id && id === g.guns.equipped ? ' on' : ''}${id ? '' : ' empty'}`,
        title: sd ? `${k + 1}: ${sd.name}` : `${k + 1}: empty (assign in the gun shop)`,
        onClick: () => { if (id) g.useSlot(k); else g.notify('Assign weapons to keys at Bullseye Guns (the number buttons under each one).', 'info'); },
      }, h('b', { text: String(k + 1) }), h('img', { src: sd ? gunThumb(sd, sm) : '', alt: '', hidden: !sd }));
    }));
    this.hint.textContent = !d ? '' : out
      ? (d.melee ? (g.input.isTouch ? 'Tap FIRE to swing' : 'Click to swing') : g.input.isTouch ? (fp ? 'Drag to look · Hold FIRE' : 'Hold FIRE') : fp ? 'Click shoot · Right-click aim · R reload' : 'Click to shoot · R reload · V first person')
      : 'Street only';
    this.fire.hidden = !g.input.isTouch || !d || !out;
    this.ads.hidden = !g.input.isTouch || !d || !out || !fp;
    this.ads.classList.toggle('on', gp.adsTouch);
    this.reloadBtn.hidden = !d || !!d.melee;
  }
}
