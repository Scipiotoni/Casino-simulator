import { type Game, type Selection, type DayReport, floorName } from '../game/game';
import { h, icon, stars, clear, swatch } from './dom';
import { formatClock, formatMoney, formatNumber } from '../core/math';
import { audio } from '../core/audio';
import { OBJECTIVES } from '../game/objectives';
import { itemThumb } from './preview';
import { MAX_LEVEL, type PlacedItem } from '../items/placedItem';
import type { Customer } from '../entities/customer';
import type { Worker } from '../entities/staff';
import { FLOOR_STYLES } from '../render/textures';
import { ShopDrawer } from './shop';
import { Modals } from './modals';
import { escapeHtml } from './floaters';
import { openTableGame } from './games';
import { Minimap } from './minimap';

/** Heads-up display: top bar, goals, toolbar, selection card, toasts, touch controls. */
export class Hud {
  readonly root: HTMLElement;
  private moneyEl!: HTMLElement;
  private rateEl!: HTMLElement;
  private starsEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private lvlEl!: HTMLElement;
  private xpFill!: HTMLElement;
  private timeEl!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private goalsEl!: HTMLElement;
  private goalsList!: HTMLElement;
  private toastsEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private cardEl!: HTMLElement;
  private placeBar!: HTMLElement;
  private paintBar!: HTMLElement;
  private actionBtn!: HTMLButtonElement;
  private joyEl!: HTMLElement;
  private knobEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private eventChip!: HTMLElement;
  private toolbar!: HTMLElement;
  private shownMoney = 0;
  private refreshT = 0;
  readonly shop: ShopDrawer;
  readonly modals: Modals;
  readonly minimap: Minimap;
  private bannerQueue: { title: string; text: string; kind: string }[] = [];
  private bannerBusy = false;
  private goalsCollapsed = false;
  private visitBar!: HTMLElement;
  private floorBar!: HTMLElement;
  private camBtn!: HTMLButtonElement;
  private floorTag = h('div', { class: 'floor-tag', hidden: true });
  /** Extra card for another player you clicked (filled in by the multiplayer layer). */
  remoteCard: ((pid: string, el: HTMLElement) => void) | null = null;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = h('div', { class: 'ui', id: 'ui' });
    parent.appendChild(this.root);
    this.modals = new Modals(this.root, game, this);
    this.shop = new ShopDrawer(this.root, game, this);
    this.minimap = new Minimap(game);
    this.build();
    this.bind();
    this.goalsCollapsed = window.innerWidth < 700;
    this.renderGoals();
  }

  private build(): void {
    const g = this.game;
    // Top bar
    this.nameEl = h('div', { class: 'brand-name', text: g.building.look.name });
    this.lvlEl = h('span', { class: 'lvl-badge', text: 'LV 1' });
    this.xpFill = h('i');
    const brand = h('button', { class: 'pill brand', 'aria-label': 'Casino settings', onClick: () => this.modals.openCasino() },
      this.nameEl,
      h('div', { class: 'lvl' }, this.lvlEl, h('div', { class: 'xpbar' }, this.xpFill)),
    );
    this.moneyEl = h('div', { class: 'money', text: formatMoney(g.money) });
    this.starsEl = h('span', { class: 'stars' });
    this.rateEl = h('span', { class: 'rate' });
    const bank = h('div', { class: 'pill bank' }, this.moneyEl, h('div', { class: 'sub' }, this.starsEl, this.rateEl));
    this.timeEl = h('div', { class: 'time' });
    const speeds: [number, string, string][] = [[0, 'pause', 'Pause'], [1, 'play', 'Normal speed'], [2, 'ff', 'Fast'], [3, 'fff', 'Fastest']];
    const speedRow = h('div', { class: 'speed', role: 'group', 'aria-label': 'Game speed' });
    for (const [s, ic, label] of speeds) {
      const b = h('button', { class: 'spd', html: icon(ic, 16), title: label, 'aria-label': label, onClick: () => this.setSpeed(s) });
      this.speedBtns.push(b);
      speedRow.appendChild(b);
    }
    const clock = h('div', { class: 'pill clock' }, this.timeEl, speedRow);
    const menuBtn = h('button', { class: 'pill icon-btn', html: icon('menu'), 'aria-label': 'Menu', onClick: () => this.modals.openMenu() });
    const top = h('header', { class: 'topbar' }, brand, bank, h('div', { class: 'top-right' }, clock, menuBtn));
    this.eventChip = h('div', { class: 'event-chip', hidden: true });

    // Goals
    this.goalsList = h('div', { class: 'goals-list' });
    this.goalsEl = h('aside', { class: 'goals' },
      h('button', { class: 'goals-head', onClick: () => { this.goalsCollapsed = !this.goalsCollapsed; this.renderGoals(); audio.play('click'); } },
        h('span', { html: icon('goal', 18) }), h('span', { class: 'goals-title', text: 'Goals' }), h('span', { class: 'goals-count' })),
      this.goalsList,
    );

    this.toastsEl = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.bannerEl = h('div', { class: 'banner', hidden: true });

    // Toolbar
    const tools: [string, string, () => void][] = [
      ['shop', 'Build', () => this.shop.toggle()],
      ['staff', 'Staff', () => this.modals.openStaff()],
      ['casino', 'Casino', () => this.modals.openCasino()],
      ['you', 'You', () => this.modals.openCreator('player')],
      ['upgrade', 'Luxe', () => this.modals.openCosmetics()],
      ['stats', 'Stats', () => this.modals.openStats()],
    ];
    this.toolbar = h('nav', { class: 'toolbar', 'aria-label': 'Tools' });
    for (const [ic, label, fn] of tools) {
      this.toolbar.appendChild(h('button', { class: `tool tool-${ic}`, onClick: () => { audio.play('click'); fn(); } },
        h('span', { class: 'tool-ico', html: icon(ic, 24) }), h('span', { class: 'tool-label', text: label })));
    }

    // Placement bar
    this.placeBar = h('div', { class: 'placebar', hidden: true });
    this.paintBar = h('div', { class: 'paintbar', hidden: true });
    this.cardEl = h('section', { class: 'card selcard', hidden: true });

    // Touch controls
    this.actionBtn = h('button', { class: 'action-btn', hidden: true, 'aria-label': 'Action' });
    this.actionBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.actionHeld = true;
      g.actionPressed = true;
    });
    const release = () => (g.actionHeld = false);
    this.actionBtn.addEventListener('pointerup', release);
    this.actionBtn.addEventListener('pointercancel', release);
    this.actionBtn.addEventListener('pointerleave', release);
    this.knobEl = h('div', { class: 'knob' });
    this.joyEl = h('div', { class: 'joystick', hidden: true }, this.knobEl);
    const camBtns = h('div', { class: 'cam-btns' },
      (this.camBtn = h('button', { class: 'cam-btn cam-mode', html: icon('you', 18), 'aria-label': 'Third-person camera (V)', title: 'Third-person camera (V)', onClick: () => { g.setCameraMode(g.cam.mode === 'third' ? 'top' : 'third'); audio.play('click'); } }) as HTMLButtonElement),
      h('button', { class: 'cam-btn', html: icon('camera', 18), 'aria-label': 'Photo mode (H)', title: 'Photo mode (H)', onClick: () => this.togglePhoto(true) }),
      h('button', { class: 'cam-btn', html: icon('rotate', 18), 'aria-label': 'Rotate camera', onClick: () => g.cam.rotate(1) }),
      h('button', { class: 'cam-btn', html: icon('zoomIn', 18), 'aria-label': 'Zoom in', onClick: () => g.cam.zoomBy(0.8) }),
      h('button', { class: 'cam-btn', html: icon('zoomOut', 18), 'aria-label': 'Zoom out', onClick: () => g.cam.zoomBy(1.25) }),
    );
    const hint = h('div', { class: 'keyhint', html: '<b>WASD</b> move · <b>Shift</b> run · <b>Space</b> act · <b>Q/E</b> turn · <b>Wheel</b> zoom · <b>1-4</b> emotes · <b>V</b> camera · <b>H</b> photo' });
    this.fpsEl = h('div', { class: 'fps', hidden: true });

    // Visiting another casino
    this.visitBar = h('div', { class: 'visitbar', hidden: true });
    // Floor picker (several floors)
    this.floorBar = h('div', { class: 'floorbar', hidden: true, role: 'group', 'aria-label': 'Floors' });

    const photoExit = h('button', { class: 'photo-exit', html: `${icon('close', 16)} <span>Exit photo mode${g.input.isTouch ? '' : ' (H)'}</span>`, onClick: () => this.togglePhoto(false) });

    this.root.append(top, this.eventChip, this.goalsEl, this.visitBar, this.floorBar, this.floorTag, this.toastsEl, this.bannerEl, this.minimap.el, this.cardEl, this.placeBar, this.paintBar, this.toolbar, this.actionBtn, this.joyEl, camBtns, hint, this.fpsEl, photoExit);
  }

  private bind(): void {
    const g = this.game;
    g.events.on('money', ({ money, delta }) => {
      if (delta === 0) this.shownMoney = money;
      if (delta > 0 && delta >= 5) {
        this.moneyEl.classList.remove('bump');
        void this.moneyEl.offsetWidth;
        this.moneyEl.classList.add('bump');
      }
    });
    g.events.on('toast', ({ text, kind }) => this.toast(text, kind));
    g.events.on('level', ({ level, unlocked }) => {
      const names = unlocked.map((d) => d.name).join(', ');
      this.banner(`Level ${level}!`, names ? `Unlocked: ${names}` : 'Your casino is growing.', 'level');
      this.shop.refresh();
    });
    g.events.on('jackpot', ({ amount, machine }) => this.banner('JACKPOT!', `A guest hit ${formatMoney(amount)} on ${machine}!`, 'jackpot'));
    g.events.on('event', ({ title, text }) => this.banner(title, text, 'event'));
    g.events.on('objectives', () => this.renderGoals());
    g.events.on('select', (s) => this.renderCard(s));
    g.events.on('mode', () => this.renderMode());
    g.events.on('look', () => (this.nameEl.textContent = g.building.look.name));
    g.events.on('day', (r) => this.dayReport(r));
    g.events.on('minigame', (item) => {
      if (!this.modals.isOpen && g.visiting) openTableGame({ game: g, modals: this.modals, item });
    });
    g.events.on('visit', () => this.renderVisit());
    g.events.on('floor', () => this.renderFloors());
    g.events.on('expansion', () => this.renderFloors());
    g.events.on('camera', () => this.renderCamBtn());
    g.events.on('interact', (i) => {
      if (i && g.input.isTouch) {
        this.actionBtn.hidden = false;
        this.actionBtn.innerHTML = `<span>${escapeHtml(i.label)}</span>`;
      } else this.actionBtn.hidden = true;
    });
  }

  setSpeed(s: number): void {
    const g = this.game;
    if (s === 0) g.paused = !g.paused;
    else {
      g.paused = false;
      g.speed = s;
    }
    audio.play('click');
  }

  toast(text: string, kind: string): void {
    const el = h('div', { class: `toast ${kind}`, text });
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild?.remove();
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 400);
    }, kind === 'bad' ? 4200 : 3400);
  }

  banner(title: string, text: string, kind: string): void {
    this.bannerQueue.push({ title, text, kind });
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner(): void {
    const b = this.bannerQueue.shift();
    if (!b) {
      this.bannerBusy = false;
      return;
    }
    this.bannerBusy = true;
    this.bannerEl.className = `banner ${b.kind}`;
    clear(this.bannerEl);
    this.bannerEl.append(h('div', { class: 'banner-title', text: b.title }), h('div', { class: 'banner-text', text: b.text }));
    this.bannerEl.hidden = false;
    window.setTimeout(() => {
      this.bannerEl.classList.add('out');
      window.setTimeout(() => {
        this.bannerEl.hidden = true;
        this.bannerEl.classList.remove('out');
        this.nextBanner();
      }, 450);
    }, b.kind === 'jackpot' ? 3600 : 2800);
  }

  renderGoals(): void {
    const g = this.game;
    const active = g.activeObjectives();
    const total = OBJECTIVES.length;
    const done = g.doneObjectives.size;
    (this.goalsEl.querySelector('.goals-count') as HTMLElement).textContent = `${done}/${total}`;
    this.goalsEl.classList.toggle('collapsed', this.goalsCollapsed);
    clear(this.goalsList);
    const v = g.objectiveView();
    for (const o of active) {
      const p = Math.min(1, o.progress(v) / o.target);
      this.goalsList.appendChild(
        h('div', { class: 'goal' },
          h('div', { class: 'goal-text', text: o.text }),
          h('div', { class: 'goal-hint', text: o.hint }),
          h('div', { class: 'goal-row' },
            h('div', { class: 'goal-bar' }, h('i', { style: `width:${(p * 100).toFixed(1)}%` })),
            h('span', { class: 'goal-reward', text: `+${formatMoney(o.reward, true)}` }),
          ),
        ),
      );
    }
    if (!active.length) this.goalsList.appendChild(h('div', { class: 'goal-text', text: 'Every goal complete. You are a legend!' }));
    this.toolbar?.querySelector('.tool-shop')?.classList.toggle('pulse', !g.doneObjectives.has('first_slot'));
  }

  private renderMode(): void {
    const g = this.game;
    const m = g.build.mode;
    this.placeBar.hidden = m.kind !== 'place';
    this.paintBar.hidden = m.kind !== 'paint';
    this.toolbar.classList.toggle('dim', m.kind !== 'play');
    if (m.kind === 'place') {
      clear(this.placeBar);
      const thumb = itemThumb(m.def, m.color, g.player.appearance);
      this.placeBar.append(
        h('img', { class: 'pb-thumb', src: thumb, alt: '' }),
        h('div', { class: 'pb-info' },
          h('div', { class: 'pb-name', text: m.moving ? `Moving ${m.def.name}` : m.def.name }),
          h('div', { class: 'pb-reason' }),
          h('div', { class: 'pb-help', text: g.input.isTouch ? 'Tap the floor to aim, tap the ghost or ✓ to place' : 'Click to place · R rotate · Esc cancel' }),
        ),
        h('div', { class: 'pb-price', text: m.moving ? 'Free' : formatMoney(m.def.price) }),
        h('button', { class: 'round-btn', html: icon('rotate'), 'aria-label': 'Rotate', onClick: () => g.build.rotate() }),
        h('button', { class: 'round-btn ok', html: icon('check'), 'aria-label': 'Place here', onClick: () => g.build.confirm() }),
        h('button', { class: 'round-btn no', html: icon('close'), 'aria-label': 'Cancel', onClick: () => { g.build.cancel(); audio.play('click'); } }),
      );
    }
    if (m.kind === 'paint') {
      clear(this.paintBar);
      const row = h('div', { class: 'swatches' });
      FLOOR_STYLES.forEach((s, i) => {
        const b = h('button', {
          class: `floor-sw${i === m.style ? ' on' : ''}`, title: `${s.name} · $${s.price}/tile`, 'aria-label': s.name,
          onClick: () => { g.build.setPaintStyle(i); audio.play('click'); },
        }, h('span', { class: 'sw-chip', style: `background-image:url(${floorSwatch(i)})` }), h('span', { class: 'sw-name', text: s.name }), h('span', { class: 'sw-price', text: `$${s.price}` }));
        row.appendChild(b);
      });
      const r = g.grid.rect;
      let tiles = 0;
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (g.grid.getFloor(x, z) !== m.style) tiles++;
      const style = m.style;
      const allBtn = h('button', {
        class: 'btn small', disabled: tiles === 0,
        html: tiles ? `Paint everything <b>${formatMoney(tiles * FLOOR_STYLES[style].price)}</b>` : 'All painted',
        onClick: () => {
          if (g.paintAll(style)) this.renderMode();
        },
      });
      this.paintBar.append(
        h('div', { class: 'paint-head' }, h('span', { html: icon('paint', 18) }), h('b', { text: 'Paint the floor' }), h('span', { class: 'muted', text: g.input.isTouch ? 'Drag on the floor' : 'Click or drag on the floor' }),
          allBtn,
          h('button', { class: 'btn small', text: 'Done', onClick: () => { g.build.cancel(); audio.play('click'); } })),
        row,
      );
    }
  }

  get photo(): boolean {
    return this.root.classList.contains('photo');
  }

  /** Hides the whole HUD so the casino can be admired (and screenshotted). */
  togglePhoto(on = !this.root.classList.contains('photo')): void {
    const g = this.game;
    if (on) {
      g.select(null);
      this.shop.close();
      if (g.build.mode.kind !== 'play') g.build.cancel();
    }
    g.photoMode = on;
    this.root.classList.toggle('photo', on);
    audio.play(on ? 'whoosh' : 'click');
  }

  togglePaint(): void {
    const g = this.game;
    if (g.build.mode.kind === 'paint') g.build.cancel();
    else if (g.visiting || !g.inside) g.notify('Step inside your own casino to paint the floor.', 'bad');
    else {
      this.shop.close();
      g.build.startPaint(0);
    }
  }

  // ------------------------------------------------------------------ selection card

  private renderCard(sel: Selection | null): void {
    clear(this.cardEl);
    this.cardEl.hidden = !sel;
    if (!sel) return;
    const close = h('button', { class: 'card-close', html: icon('close', 18), 'aria-label': 'Close', onClick: () => this.game.select(null) });
    this.cardEl.appendChild(close);
    if (sel.kind === 'item') this.itemCard(sel.item);
    else if (sel.kind === 'customer') this.customerCard(sel.c);
    else if (sel.kind === 'worker') this.workerCard(sel.w);
    else this.remoteCard?.(sel.pid, this.cardEl);
    this.refreshCard();
  }

  private itemCard(item: PlacedItem): void {
    const g = this.game;
    const def = item.def;
    const thumb = itemThumb(def, item.color, g.player.appearance);
    const head = h('div', { class: 'card-head' },
      h('img', { class: 'card-thumb', src: thumb, alt: '' }),
      h('div', {},
        h('div', { class: 'card-title', text: def.name }),
        h('div', { class: 'card-sub', html: item.upgradable ? `Level ${item.level} ${'<span class="lvl-dot on"></span>'.repeat(item.level)}${'<span class="lvl-dot"></span>'.repeat(MAX_LEVEL - item.level)}` : def.category === 'decor' ? `Appeal +${item.appeal.toFixed(1)}` : escapeHtml(def.description) }),
        h('div', { class: 'chip-row', dataset: { live: 'status' } }),
      ),
    );
    this.cardEl.appendChild(head);
    if (def.kind !== 'decor') {
      this.cardEl.appendChild(h('div', { class: 'card-stats', dataset: { live: 'itemstats' } }));
    }
    const actions = h('div', { class: 'card-actions' });
    if (def.fixed) {
      this.cardEl.appendChild(h('p', { class: 'muted small', text: g.floors > 1 ? `Walk to its door and press Space, or use the floor buttons, to ride between ${g.floors} floors.` : def.description }));
      if (def.id === 'elevator' && !g.visit) {
        actions.appendChild(h('button', { class: 'btn', html: `${icon('move', 16)} Move elevator`, title: 'The shaft moves on every floor at once', onClick: () => g.build.startMove(item) }));
        this.cardEl.appendChild(actions);
      }
      return;
    }
    if (item.upgradable && item.level < MAX_LEVEL) {
      actions.appendChild(h('button', { class: 'btn gold', html: `${icon('upgrade', 16)} Upgrade <b>${formatMoney(item.upgradeCost)}</b>`, onClick: () => { if (g.upgrade(item)) this.renderCard({ kind: 'item', item }); } }));
    }
    actions.appendChild(h('button', { class: 'btn', html: `${icon('move', 16)} Move`, onClick: () => { g.build.startMove(item); } }));
    actions.appendChild(h('button', { class: 'btn', html: `${icon('rotate', 16)} Rotate`, onClick: () => this.quickRotate(item) }));
    if (g.floors > 1 && !item.outdoor) {
      // Carry it to another floor: pick it up, ride the elevator, then drop it where you like.
      const floorsRow = h('div', { class: 'card-floors' }, h('span', { class: 'muted small', text: 'Move to floor' }));
      for (let f = 0; f < g.floors; f++) {
        if (f === item.floor) continue;
        floorsRow.appendChild(h('button', {
          class: 'btn small', text: f === 0 ? 'G' : String(f + 1), title: `Carry it to the ${floorName(f).toLowerCase()}`,
          onClick: () => {
            g.build.startMove(item);
            g.goToFloor(f);
            g.notify(`Now on the ${floorName(f).toLowerCase()}: click where it should go.`, 'info');
          },
        }));
      }
      this.cardEl.appendChild(floorsRow);
    }
    actions.appendChild(h('button', {
      class: 'btn danger', dataset: { live: 'sell' },
      // Right after buying, selling is an instant, no-questions-asked undo.
      onClick: () => (item.refundable ? g.sell(item) : this.confirmSell(item)),
    }));
    this.cardEl.appendChild(actions);
    if (item.signable) {
      const input = h('input', {
        class: 'text-input', type: 'text', maxLength: 14, value: item.label ?? '', placeholder: String(def.params?.topper ?? (def.jackpot ? 'MEGA JACKPOT' : def.kind === 'bar' ? 'COCKTAILS' : def.kind === 'snack' ? 'SNACKS' : def.kind === 'claw' ? 'CLAW' : 'SLOTS')),
        'aria-label': 'Sign text',
      }) as HTMLInputElement;
      const apply = () => {
        if ((item.label ?? '') !== input.value.trim().toUpperCase().slice(0, 14)) g.setItemLabel(item, input.value);
        input.value = item.label ?? '';
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
      });
      this.cardEl.appendChild(h('div', { class: 'sign-row' }, h('span', { class: 'muted', text: 'Sign' }), input));
    }
    if (def.colors.length > 1) {
      const colors = h('div', { class: 'color-row' }, h('span', { class: 'muted', text: 'Color' }));
      for (const c of def.colors) {
        colors.appendChild(h('button', {
          class: `color-sw${c === item.color ? ' on' : ''}`, style: `background:${swatch(c)}`, 'aria-label': `Color ${swatch(c)}`,
          onClick: () => { g.repaint(item, c); this.renderCard({ kind: 'item', item }); },
        }));
      }
      this.cardEl.appendChild(colors);
    }
  }

  private quickRotate(item: PlacedItem): void {
    const g = this.game;
    for (let k = 1; k <= 3; k++) {
      const rot = (item.rot + k) % 4;
      if (g.items.canPlace(item.def, item.floor, item.tx, item.tz, rot, item).ok) {
        g.items.move(item, item.tx, item.tz, rot);
        g.afterLayoutChange();
        audio.play('rotate');
        g.select({ kind: 'item', item });
        return;
      }
    }
    audio.play('error');
    g.notify('No room to rotate here. Try Move.', 'bad');
  }

  private confirmSell(item: PlacedItem): void {
    this.modals.confirm(`Sell ${item.def.name}?`, `You get ${formatMoney(item.sellValue)} back.`, 'Sell', () => this.game.sell(item));
  }

  private customerCard(c: Customer): void {
    const typeLabel = c.type === 'vip' ? 'VIP' : c.type === 'tourist' ? 'Tourist' : c.exposed ? 'Suspicious' : 'Guest';
    this.cardEl.appendChild(h('div', { class: 'card-head' },
      h('div', { class: 'card-emoji', dataset: { live: 'emoji' } }),
      h('div', {},
        h('div', { class: 'card-title', text: c.name }),
        h('div', { class: 'chip-row' }, h('span', { class: `chip ${c.type === 'vip' ? 'gold' : c.exposed ? 'bad' : ''}`, text: typeLabel })),
      ),
    ));
    this.cardEl.appendChild(h('div', { class: 'card-stats', dataset: { live: 'cust' } }));
    this.cardEl.appendChild(h('div', { class: 'thought', dataset: { live: 'thought' } }));
  }

  private workerCard(w: Worker): void {
    const g = this.game;
    this.cardEl.appendChild(h('div', { class: 'card-head' },
      h('div', { class: 'card-emoji', html: icon('staff', 30) }),
      h('div', {},
        h('div', { class: 'card-title', text: w.name }),
        h('div', { class: 'chip-row' }, h('span', { class: 'chip', text: w.info.title }), h('span', { class: 'chip', text: `${formatMoney(w.info.wage)}/day` })),
      ),
    ));
    this.cardEl.appendChild(h('div', { class: 'card-stats', dataset: { live: 'worker' } }));
    this.cardEl.appendChild(h('div', { class: 'card-actions' },
      h('button', { class: 'btn', html: `${icon('you', 16)} Customize`, onClick: () => this.modals.openCreator('worker', w) }),
      h('button', { class: 'btn danger', html: `${icon('close', 16)} Fire`, onClick: () => this.modals.confirm(`Fire ${w.name}?`, 'They leave right away. No refunds on the signing bonus.', 'Fire', () => g.fire(w)) }),
    ));
  }

  private refreshCard(): void {
    const sel = this.game.selection;
    if (!sel || this.cardEl.hidden) return;
    const q = (k: string) => this.cardEl.querySelector(`[data-live="${k}"]`) as HTMLElement | null;
    if (sel.kind === 'item') {
      const it = sel.item;
      const st = q('status');
      if (st) {
        const busy = it.occupiedCount();
        st.innerHTML = it.broken
          ? '<span class="chip bad">Broken</span>'
          : it.seats.length
              ? `<span class="chip good">${busy}/${it.seats.length} in use</span>${it.seats.some((s) => !s.reachable) ? '<span class="chip warn">Some seats blocked</span>' : ''}`
              : '<span class="chip">Decoration</span>';
      }
      const sell = q('sell');
      if (sell) {
        const full = it.refundable;
        const html = full
          ? `${icon('undo', 16)} Undo purchase <b>+${formatMoney(it.sellValue)}</b> <small>${Math.ceil(it.refundLeft)}s</small>`
          : `${icon('sell', 16)} Sell <b>+${formatMoney(it.sellValue)}</b>`;
        if (sell.innerHTML !== html) sell.innerHTML = html;
        sell.classList.toggle('refund', full);
      }
      const s = q('itemstats');
      if (s) {
        const rows: [string, string][] = [];
        if (it.isGambling) {
          rows.push(['Bets', `${formatMoney(it.minBet)}–${formatMoney(it.maxBet)}`]);
          rows.push(['Rounds played', formatNumber(it.stats.plays)]);
          rows.push(['House profit', formatMoney(it.profit)]);
        } else if (it.def.kind === 'bar' || it.def.kind === 'snack' || it.def.kind === 'atm') {
          rows.push(['Sales', formatMoney(it.stats.wagered)]);
        }
        if (it.def.upkeep) rows.push(['Upkeep', `${formatMoney(it.def.upkeep)}/day`]);
        s.innerHTML = rows.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join('');
      }
    } else if (sel.kind === 'customer') {
      const c = sel.c;
      const e = q('emoji');
      if (e) e.textContent = c.moodEmoji;
      const s = q('cust');
      if (s) {
        s.innerHTML = [
          ['Mood', `<span class="meter"><i style="width:${c.mood.toFixed(0)}%;background:${c.mood > 60 ? 'var(--green)' : c.mood > 35 ? 'var(--gold)' : 'var(--red)'}"></i></span>`],
          ['Wallet', formatMoney(c.wallet)],
          ['Tonight', `<span class="${c.netResult >= 0 ? 'pos' : 'neg'}">${c.netResult >= 0 ? '+' : ''}${formatMoney(c.netResult)}</span>`],
          ['Doing', escapeHtml(c.statusLine)],
        ].map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join('');
      }
      const t = q('thought');
      if (t) t.textContent = `“${c.thought}”`;
    } else if (sel.kind === 'worker') {
      const w = sel.w;
      const s = q('worker');
      if (s) s.innerHTML = [['Status', escapeHtml(w.statusLine)], ['Jobs done', formatNumber(w.jobsDone)]].map(([a, b]) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`).join('');
    }
  }

  private dayReport(r: DayReport): void {
    this.modals.dayReport(r);
  }

  // ------------------------------------------------------------------ per-frame

  /** Banner shown while you're a guest in someone else's casino. */
  renderVisit(): void {
    const g = this.game;
    const v = g.visit;
    this.visitBar.hidden = !v;
    this.root.classList.toggle('visiting', !!v);
    this.toolbar.querySelectorAll('.tool-shop, .tool-staff, .tool-casino').forEach((b) => ((b as HTMLElement).hidden = !!v));
    this.shop.close();
    this.nameEl.textContent = v ? v.lot.info.look.name : g.building.look.name;
    if (v) {
      clear(this.visitBar);
      const home = g.street.get('me');
      this.visitBar.append(
        h('div', { class: 'vb-text' },
          h('b', { text: v.lot.kind === 'rival' ? `Rival casino · ${v.lot.info.look.name}` : `${v.lot.owner}'s ${v.lot.info.look.name}` }),
          h('span', { class: 'vb-net', dataset: { live: 'vnet' } }),
        ),
        h('button', {
          class: 'btn small gold', html: `${icon('casino', 14)} Head home`,
          onClick: () => { g.returnHome(); audio.play('whoosh'); },
          title: home ? `Back to ${home.info.look.name}` : 'Back home',
        }),
      );
    }
    this.renderFloors();
  }

  /** Floor buttons (only with more than one floor). */
  renderFloors(): void {
    const g = this.game;
    this.floorBar.hidden = g.floors < 2 || !g.inside;
    if (g.floors < 2) return;
    clear(this.floorBar);
    for (let f = g.floors - 1; f >= 0; f--) {
      this.floorBar.appendChild(h('button', {
        class: `fl-btn${f === g.player.floor ? ' on' : ''}`, text: f === 0 ? 'G' : String(f + 1), title: floorName(f), 'aria-label': floorName(f),
        onClick: () => { g.goToFloor(f); this.renderFloors(); },
      }));
    }
  }

  private renderCamBtn(): void {
    const third = this.game.cam.mode === 'third';
    this.camBtn.classList.toggle('on', third);
    this.camBtn.title = third ? 'Top-down camera (V)' : 'Third-person camera (V)';
  }

  update(dt: number): void {
    const g = this.game;
    this.floorBar.hidden = g.floors < 2 || !g.inside;
    this.minimap.update(dt);
    const up = g.inside && g.player.floor > 0;
    this.floorTag.hidden = !up;
    if (up) {
      const t = `▲ ${floorName(g.player.floor).toUpperCase()} · ${g.player.floor * 3} m above the street`;
      if (this.floorTag.textContent !== t) this.floorTag.textContent = t;
    }
    // Animated money counter
    const diff = g.money - this.shownMoney;
    this.shownMoney += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    this.moneyEl.textContent = formatMoney(this.shownMoney);
    this.moneyEl.classList.toggle('neg', g.money < 0);
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.25;
      this.starsEl.innerHTML = stars(g.rating);
      this.starsEl.title = `${g.rating.toFixed(1)} stars`;
      const rate = g.incomePerMin;
      this.rateEl.textContent = `${rate >= 0 ? '+' : ''}${formatMoney(rate, true)}/min`;
      this.rateEl.className = `rate ${rate >= 0 ? 'pos' : 'neg'}`;
      this.lvlEl.textContent = `LV ${g.level}`;
      this.xpFill.style.width = `${Math.min(100, (g.xp / g.xpNext) * 100).toFixed(1)}%`;
      this.timeEl.textContent = `Day ${g.day} · ${formatClock(g.clockMinutes)}`;
      this.speedBtns.forEach((b, i) => {
        const on = i === 0 ? g.paused : !g.paused && g.speed === i;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const ev = g.activeEventInfo;
      this.eventChip.hidden = !ev;
      if (ev) this.eventChip.textContent = `${ev.title} ${Math.ceil(ev.left)}s`;
      this.refreshCard();
      if (g.visit) {
        const vn = this.visitBar.querySelector('[data-live="vnet"]') as HTMLElement | null;
        if (vn) {
          const n = g.visit.net;
          vn.textContent = g.visit.hands ? `Tonight here: ${n >= 0 ? '+' : ''}${formatMoney(n)} over ${g.visit.hands} ${g.visit.hands === 1 ? 'round' : 'rounds'}` : 'Walk up to a game and press Space';
          vn.className = `vb-net ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}`;
        }
      }
      if (!this.goalsCollapsed) this.updateGoalBars();
      this.fpsEl.hidden = !g.settings.showFps;
      if (g.settings.showFps) this.fpsEl.textContent = `${g.fps.toFixed(0)} fps · ${g.customers.length} guests`;
      const pb = this.placeBar.querySelector('.pb-reason') as HTMLElement | null;
      if (pb) {
        pb.textContent = g.build.valid ? 'Looks good!' : g.build.reason;
        pb.className = `pb-reason ${g.build.valid ? 'ok' : 'bad'}`;
      }
    }
    // Joystick visual
    const j = g.input.joy;
    this.joyEl.hidden = !j.active;
    if (j.active) {
      this.joyEl.style.transform = `translate(${j.originX}px, ${j.originY}px)`;
      this.knobEl.style.transform = `translate(${j.curX - j.originX}px, ${j.curY - j.originY}px)`;
    }
    this.root.classList.toggle('touch', g.input.isTouch);
  }

  private updateGoalBars(): void {
    const g = this.game;
    const v = g.objectiveView();
    const bars = this.goalsList.querySelectorAll('.goal-bar i');
    g.activeObjectives().forEach((o, i) => {
      const el = bars[i] as HTMLElement | undefined;
      if (el) el.style.width = `${(Math.min(1, o.progress(v) / o.target) * 100).toFixed(1)}%`;
    });
  }
}

const swatchCache = new Map<number, string>();
export function floorSwatch(i: number): string {
  const c = swatchCache.get(i);
  if (c) return c;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  FLOOR_STYLES[i].draw(ctx, 96);
  const url = canvas.toDataURL();
  swatchCache.set(i, url);
  return url;
}
