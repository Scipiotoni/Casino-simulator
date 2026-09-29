import type { Game } from '../game/game';
import type { Hud } from './hud';
import { h, clear, icon } from './dom';
import { CATEGORIES, ITEMS, type Category, type ItemDef, describeItem } from '../items/catalog';
import { itemThumb } from './preview';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';

/** Bottom sheet with every buyable machine, table, service and decoration. */
export class ShopDrawer {
  private el: HTMLElement;
  private grid: HTMLElement;
  private tabs: HTMLButtonElement[] = [];
  private cat: Category = 'slots';
  open = false;

  constructor(parent: HTMLElement, private game: Game, private hud: Hud) {
    this.grid = h('div', { class: 'shop-grid' });
    const tabRow = h('div', { class: 'tabs', role: 'tablist' });
    for (const c of CATEGORIES) {
      const b = h('button', { class: 'tab', role: 'tab', text: c.label, onClick: () => this.setCat(c.id) });
      b.dataset.cat = c.id;
      this.tabs.push(b);
      tabRow.appendChild(b);
    }
    this.el = h('section', { class: 'drawer shop', hidden: true, 'aria-label': 'Build menu' },
      h('div', { class: 'drawer-head' },
        h('div', { class: 'drawer-title', html: `${icon('shop', 20)} <span>Build</span>` }),
        tabRow,
        h('button', { class: 'icon-btn', html: icon('close', 18), 'aria-label': 'Close', onClick: () => this.close() }),
      ),
      this.grid,
    );
    parent.appendChild(this.el);
    this.game.events.on('money', () => {
      if (this.open) this.updateAffordability();
    });
    void this.hud;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(cat?: Category): void {
    if (this.game.visiting) {
      this.game.notify('You can only build in your own casino.', 'bad');
      return;
    }
    if (!this.game.canBuildHere) {
      this.game.notify('Head back to your casino to build.', 'bad');
      return;
    }
    this.game.build.cancel();
    this.game.select(null);
    this.open = true;
    this.el.hidden = false;
    this.el.parentElement?.classList.add('drawer-open');
    this.setCat(cat ?? this.cat);
    audio.play('whoosh');
  }

  close(): void {
    this.open = false;
    this.el.hidden = true;
    this.el.parentElement?.classList.remove('drawer-open');
  }

  refresh(): void {
    if (this.open) this.render();
  }

  private setCat(c: Category): void {
    this.cat = c;
    this.tabs.forEach((t) => {
      const on = t.dataset.cat === c;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.render();
  }

  private render(): void {
    clear(this.grid);
    const g = this.game;
    const list = ITEMS.filter((d) => d.category === this.cat && !d.fixed);
    for (const def of list) {
      const locked = def.unlock > g.level;
      const card = h('button', {
        class: `shop-card${locked ? ' locked' : ''}`,
        dataset: { id: def.id },
        onClick: () => this.buy(def),
        'aria-label': `${def.name}, ${formatMoney(def.price)}`,
      },
        h('div', { class: 'sc-thumb' }, h('img', { src: itemThumb(def, undefined, g.player.appearance), alt: '', loading: 'lazy' })),
        h('div', { class: 'sc-name', text: def.name }),
        h('div', { class: 'sc-tag', text: describeItem(def) }),
        h('div', { class: 'sc-price', text: locked ? `Level ${def.unlock}` : formatMoney(def.price) }),
      );
      card.title = def.description;
      this.grid.appendChild(card);
    }
    this.updateAffordability();
  }

  private updateAffordability(): void {
    const g = this.game;
    this.grid.querySelectorAll<HTMLButtonElement>('.shop-card').forEach((c) => {
      const def = ITEMS.find((d) => d.id === c.dataset.id);
      if (!def) return;
      c.classList.toggle('poor', def.unlock <= g.level && g.money < def.price);
    });
  }

  private buy(def: ItemDef): void {
    const g = this.game;
    if (def.unlock > g.level) {
      audio.play('error');
      g.notify(`${def.name} unlocks at casino level ${def.unlock}`, 'bad');
      return;
    }
    if (g.money < def.price) {
      audio.play('error');
      g.notify(`You need ${formatMoney(def.price)} for ${def.name}`, 'bad');
      return;
    }
    this.close();
    g.build.startPlace(def);
  }
}
