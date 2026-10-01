import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { CARS } from '../world/vehicles';
import { carThumb } from './preview';

/**
 * Velocity Motors: buy cars (with your casino cash), pick a colour, and have any car you
 * own brought to the curb next to you. Also opened from the menu as "My cars".
 */
export function openDealer(game: Game, modals: Modals, mine = false): void {
  const g = game;
  const body = h('div', { class: 'stack' });
  const pick: Record<string, number> = {};
  const render = () => {
    clear(body);
    body.appendChild(h('p', { class: 'muted small', text: mine
      ? 'Your garage. Bring any car to the curb next to you (out on the street), then walk up and press Space. Velocity Motors is on Downtown Boulevard (🚗 on the map).'
      : 'Paid from your casino cash. Bought cars live in your garage: call one to the curb from here or from Menu → My cars. You can also steal any car from the traffic… but the police will come.' }));
    const grid = h('div', { class: 'car-grid' });
    for (const d of CARS) {
      const owned = g.garage.owned.includes(d.id);
      if (mine && !owned) continue;
      const locked = !owned && g.homeLevel < d.unlock;
      const color = pick[d.id] ?? g.garage.colors[d.id] ?? d.colors[0];
      const img = h('img', { class: 'car-thumb', src: carThumb(d, color), alt: '' }) as HTMLImageElement;
      const swatches = h('div', { class: 'car-colors' });
      if (d.colors.length > 1) {
        for (const c of d.colors) {
          swatches.appendChild(h('button', {
            class: `car-sw${c === color ? ' on' : ''}`, style: `background:#${c.toString(16).padStart(6, '0')}`, 'aria-label': 'Colour',
            onClick: () => {
              pick[d.id] = c;
              if (owned) {
                g.garage.colors[d.id] = c;
                g.requestSave();
              }
              audio.play('click');
              render();
            },
          }));
        }
      }
      const stats = `Top speed ${Math.round(d.top * 3.6)} km/h · 0–100 in ${(27.8 / d.accel).toFixed(1)} s`;
      grid.appendChild(h('div', { class: `car-card${owned ? ' owned' : ''}${locked ? ' locked' : ''}` },
        img,
        h('div', { class: 'car-name', text: d.name }),
        h('div', { class: 'muted small', text: d.blurb }),
        h('div', { class: 'car-stats', text: stats }),
        swatches,
        owned
          ? h('button', { class: 'btn small gold', text: '🚗 Bring it here', onClick: () => { if (g.drive.bring(d.id)) modals.closeAll(); } })
          : h('button', {
            class: 'btn small gold', disabled: locked,
            html: locked ? `Casino level ${d.unlock}` : `Buy <b>${formatMoney(d.price)}</b>`,
            onClick: () => {
              if (g.drive.buy(d.id, color)) render();
            },
          }),
      ));
    }
    if (mine && !g.garage.owned.length) grid.appendChild(h('p', { class: 'muted', text: 'No cars yet. Visit Velocity Motors on Downtown Boulevard.' }));
    body.appendChild(grid);
    if (mine) {
      body.appendChild(h('button', { class: 'btn', text: '🏁 Visit the dealership', onClick: () => { modals.close(); openDealer(g, modals, false); } }));
    }
  };
  render();
  const off = g.events.on('money', () => render());
  audio.play('doorbell', { pitch: 1.2 });
  modals.open(mine ? 'My cars' : 'Velocity Motors', body, { wide: true, onClose: off });
}
