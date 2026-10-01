import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { CHARMS, GUN_SKINS, LASER_PRICE, MAGS, MUZZLES, SIGHTS, gunDef, gunModsOf, gunTakes, tunedGun } from '../game/guns';
import { buildGun } from '../items/models/guns';
import { CarPreview } from './carGarage';

/**
 * The workbench at Bullseye Guns: skins, sights, muzzle devices, bigger magazines, a laser
 * and a charm for a weapon you own. Each change shows on the turning gun and is paid for
 * as you pick it; the stats underneath show what the attachments do.
 */
export function openGunCustomize(game: Game, modals: Modals, id: string, back?: () => void): void {
  const g = game;
  const def = gunDef(id);
  if (!def || !g.guns.owned.includes(id)) return;
  const m = gunModsOf(g.guns, id);
  const takes = gunTakes(def);
  const preview = new CarPreview();
  const statsEl = h('div', { class: 'cg-stats' });
  const panel = h('div', { class: 'cg-panel' });
  const body = h('div', { class: 'stack car-garage gun-bench' }, preview.canvas, statsEl, panel);

  const stat = (label: string, value: string, k: number) =>
    h('div', { class: 'cg-stat' }, h('span', { text: label }), h('div', { class: 'cg-bar' }, h('i', { style: `width:${Math.min(100, Math.max(4, k * 100)).toFixed(0)}%` })), h('b', { text: value }));

  const refresh = () => {
    const b = buildGun(def, m);
    b.group.scale.setScalar(def.melee ? 3.2 : 5.5);
    b.group.position.set(0, 1.1, 0);
    b.group.rotation.y = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(b.group);
    preview.show(holder, 3.2);
    const t = tunedGun(def, m);
    statsEl.replaceChildren(
      ...(def.melee
        ? [stat('Damage', String(t.dmg), t.dmg / 80), stat('Reach', `${t.range} m`, t.range / 3)]
        : [
          stat('Magazine', `${t.mag} rounds`, t.mag / Math.max(60, def.mag * 2)),
          stat('Aimed accuracy', `${Math.round((1 - t.spread * t.adsAcc * 4) * 100)}%`, 1 - t.spread * t.adsAcc * 4),
          stat('Hip accuracy', `${Math.round((1 - t.spread * t.hipAcc * 4) * 100)}%`, 1 - t.spread * t.hipAcc * 4),
          stat('Zoom', `${(72 / t.adsFov).toFixed(1)}×`, 72 / t.adsFov / 5),
          stat('Recoil', t.kickMul < 1 ? 'Low' : 'Normal', 1 - t.kickMul + 0.3),
          stat('Noise', t.quiet ? 'Suppressed' : 'Loud', t.quiet ? 0.2 : 1),
        ]),
    );
  };

  /** Pay for a change and apply it (free if it's already fitted). */
  const buy = (price: number, apply: () => void, same: boolean) => {
    if (same) return;
    if (price > 0 && g.money < price) {
      audio.play('error');
      g.notify(`That costs ${formatMoney(price)}.`, 'bad');
      return;
    }
    if (price > 0) g.spend(price, 'purchase');
    apply();
    audio.play(price > 0 ? 'reload' : 'click');
    g.gunplay.refreshModels();
    g.events.emit('guns', undefined);
    g.requestSave();
    refresh();
    render();
  };

  const chips = <T,>(label: string, list: { id: T; name: string; price: number; blurb?: string }[], cur: T, set: (v: T) => void) => {
    const row = h('div', { class: 'cg-chips' });
    for (const o of list) {
      row.appendChild(h('button', {
        class: `chip-btn${o.id === cur ? ' on' : ''}`, title: o.blurb ?? '',
        html: `${o.name}${o.price && o.id !== cur ? ` <small>${formatMoney(o.price)}</small>` : ''}`,
        onClick: () => buy(o.price, () => set(o.id), o.id === cur),
      }));
    }
    const note = list.find((o) => o.id === cur)?.blurb;
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row, note ? h('span', { class: 'muted small', text: note }) : null);
  };

  const render = () => {
    clear(panel);
    // Skins
    const sw = h('div', { class: 'gun-skins' });
    for (const s of GUN_SKINS) {
      sw.appendChild(h('button', {
        class: `gun-skin${m.skin === s.id ? ' on' : ''}`, title: `${s.name}${s.price ? ` · ${formatMoney(s.price)}` : ''}`,
        onClick: () => buy(s.price, () => (m.skin = s.id), m.skin === s.id),
      }, h('i', { style: `background:${s.swatch}` }), h('span', { text: s.name }), s.price && m.skin !== s.id ? h('small', { text: formatMoney(s.price) }) : null));
    }
    panel.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Skin' }), sw));
    if (takes.sight) panel.appendChild(chips('Sight', SIGHTS, m.sight, (v) => (m.sight = v)));
    if (takes.muzzle) panel.appendChild(chips('Muzzle', MUZZLES, m.muzzle, (v) => (m.muzzle = v)));
    if (takes.mag) panel.appendChild(chips('Magazine', MAGS, m.mag, (v) => (m.mag = v)));
    if (takes.laser) {
      panel.appendChild(chips('Laser sight', [
        { id: false, name: 'None', price: 0 },
        { id: true, name: 'Red laser', price: LASER_PRICE, blurb: 'Hip-fire spread −30%, and everyone sees where you point.' },
      ], m.laser, (v) => (m.laser = v)));
    }
    panel.appendChild(chips('Charm', CHARMS, m.charm, (v) => (m.charm = v)));
    panel.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: '↺ Back to factory (free)', onClick: () => buy(0, () => Object.assign(m, { skin: 'stock', sight: 'iron', muzzle: 'none', mag: 'standard', laser: false, charm: 'none' }), false) }),
      back ? h('button', { class: 'btn gold', text: '← Gun shop', onClick: () => { modals.close(); back(); } }) : null));
  };
  refresh();
  render();
  const off = g.events.on('money', () => render());
  audio.play('reload');
  modals.open(`Customize · ${def.name}`, body, {
    wide: true,
    onClose: () => {
      off();
      preview.dispose();
    },
  });
}
