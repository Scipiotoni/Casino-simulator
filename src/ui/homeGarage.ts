import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { carDef } from '../world/vehicles';
import { carThumb } from './preview';
import { conditionOf, modsOf } from '../game/driving';
import { repairRow } from './cars';
import { GARAGE_TIERS, garageTier } from '../game/house';
import { openCustomize } from './carGarage';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Your garage next to the house: build it (and make it bigger), drive parked cars out,
 * and have cars you own taken home by a valet.
 */
export function openGarage(game: Game, modals: Modals): void {
  const g = game;
  const body = h('div', { class: 'stack' });
  const render = () => {
    clear(body);
    const hs = g.house;
    if (!hs) {
      body.appendChild(h('p', { class: 'muted', text: 'You need a house first: the garage goes right next to it on Palm Avenue. Buy one from the Home panel.' }));
      return;
    }
    const t = garageTier(hs.garage);
    const next = garageTier(hs.garage + 1);
    const here = g.drive.playerAtGarage;
    if (!t) {
      body.appendChild(h('p', { class: 'muted small', text: 'Build a garage beside your house. Drive up to its door and press Space to park: your cars are kept safe inside, washed and with the nitro topped up. Hide a stolen car in it (once the police have lost you) and it’s yours to keep.' }));
    } else {
      body.appendChild(h('div', { class: 'garage-head' },
        h('b', { text: `🅿 ${t.name}` }),
        h('span', { class: 'muted small', text: `${hs.parked.length} / ${t.cap} cars parked` })));
    }
    // The tiers
    const tiers = h('div', { class: 'garage-tiers' });
    for (const gt of GARAGE_TIERS) {
      const have = hs.garage >= gt.tier;
      tiers.appendChild(h('div', { class: `garage-tier${have ? ' owned' : ''}${next?.tier === gt.tier ? ' next' : ''}` },
        h('b', { text: gt.name }),
        h('span', { class: 'muted small', text: `${gt.cap} cars` }),
        have ? h('span', { class: 'pos small', text: '✓ Built' })
          : next?.tier === gt.tier ? h('button', {
            class: 'btn small gold', html: `${hs.garage ? 'Upgrade' : 'Build'} <b>${formatMoney(gt.price)}</b>`, disabled: g.money < gt.price,
            onClick: () => {
              if (g.drive.buyGarage()) render();
            },
          }) : h('span', { class: 'muted small', text: formatMoney(gt.price) })));
    }
    body.appendChild(tiers);
    if (!t) return;
    // Parked cars
    body.appendChild(h('h4', { class: 'garage-sub', text: 'In the garage' }));
    const grid = h('div', { class: 'car-grid' });
    hs.parked.forEach((p, i) => {
      const def = p.id ? carDef(p.id) : null;
      const mods = def ? modsOf(g.garage, def.id) : null;
      const img = def && mods
        ? h('img', { class: 'car-thumb', src: carThumb(def, mods.color, mods), alt: '' })
        : h('div', { class: 'car-thumb kept', style: `background: radial-gradient(circle at 50% 60%, ${hex(p.color ?? 0x888888)} 0 30%, transparent 31%), #1b1726`, text: '🚘' });
      grid.appendChild(h('div', { class: 'car-card owned' },
        img,
        h('div', { class: 'car-name', text: def ? def.name : 'Kept car' }),
        h('div', { class: 'muted small', text: def ? def.blurb : 'Taken off the street. Yours now.' }),
        def && conditionOf(g.garage, def.id) < 1 ? repairRow(g, def.id, render) : null,
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn small gold', text: '🚗 Drive it out', disabled: !here,
            title: here ? '' : 'Stand at your garage door to drive a car out',
            onClick: () => {
              if (g.drive.takeOut(i)) modals.closeAll();
            },
          }),
          def ? h('button', { class: 'btn small', text: '🔧 Customize', onClick: () => { modals.close(); openCustomize(g, modals, def.id); } }) : null),
      ));
    });
    for (let i = hs.parked.length; i < t.cap; i++) grid.appendChild(h('div', { class: 'car-card garage-empty' }, h('span', { class: 'muted', text: 'Empty bay' })));
    body.appendChild(grid);
    if (!here) body.appendChild(h('p', { class: 'muted small', text: 'Stand at your garage door (next to your house on Palm Avenue) to drive a car out, or use “Bring it here” in My cars.' }));
    // Cars you own that aren't home
    const away = g.garage.owned.filter((id) => !hs.parked.some((p) => p.id === id));
    if (away.length) {
      body.appendChild(h('h4', { class: 'garage-sub', text: 'Your other cars' }));
      const list = h('div', { class: 'garage-away' });
      for (const id of away) {
        const d = carDef(id);
        if (!d) continue;
        list.appendChild(h('div', { class: 'garage-row' },
          h('span', { text: `🚗 ${d.name}` }),
          h('button', {
            class: 'btn small', text: '🅿 Send home', disabled: hs.parked.length >= t.cap,
            onClick: () => {
              if (g.drive.sendHome(id)) render();
            },
          })));
      }
      body.appendChild(list);
    }
  };
  render();
  const offM = g.events.on('money', () => render());
  const offH = g.events.on('house', () => render());
  const off = () => {
    offM();
    offH();
  };
  audio.play('doorbell', { pitch: 0.8 });
  modals.open('Your garage', body, { wide: true, onClose: off });
}
