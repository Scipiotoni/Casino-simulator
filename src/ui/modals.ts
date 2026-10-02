import { type Game, type DayReport, roman } from '../game/game';
import { HOTEL_PRICE, HOTEL_START_CASH, buildingCost, buildingName, hotelGuestBoost, hotelName, snapChecklist } from '../game/hotel';
import { BEDS, ROOM_CLASS_NAMES, ROOM_EXTRAS, ROOM_FLOORS, ROOM_THEMES, ROOM_WALLS, type RoomSetup, changeCost, fitsClass, roomRate, roomStars, sameSetup, setupValue, themeFor } from '../hotel/rooms';
import type { PlacedItem } from '../items/placedItem';
import { exportFileName, exportSave, parseImport } from '../game/transfer';
import { COSMETICS } from '../cosmetics/catalog';
import type { Hud } from './hud';
import { openDealer } from './cars';
import { openGarage } from './homeGarage';
import { RETICLE_COLORS, RETICLE_STYLES, drawReticle } from './reticle';
import { h, clear, icon, swatch, stars } from './dom';
import { formatMoney, formatNumber } from '../core/math';
import { audio } from '../core/audio';
import { NEON_COLORS, SIGN_FONTS, WALL_COLORS } from '../world/building';
import { DEPTH_STEP, MAX_WIDTH } from '../world/grid';
import { MAX_DEPTH, MAX_DEPTH_STEPS } from '../world/city';
import { MAX_DOOR_GUARDS, roleFor, rolesAt } from '../entities/staff';
import { HOUSE_LEVEL, HOUSE_PRICE, VAULT_TIERS, vaultTier } from '../game/house';
import { FACADE_Z, SIDEWALK_Z0, CENTER_X } from '../world/grid';
import { STREET_NAMES } from '../world/city';
import type { Worker } from '../entities/staff';
import { CharacterCreator } from './creator';

interface Frame {
  layer: HTMLElement;
  onClose?: () => void;
}

/** Dialogs and full panels (casino, staff, stats, menu, settings, creator). */
export class Modals {
  private stack: Frame[] = [];
  onMainMenu: (() => void) | null = null;
  onNewCasino: (() => void) | null = null;
  onSettingsChanged: (() => void) | null = null;
  /** The players list with blacklist controls (set by the net layer). */
  openPlayers: (() => void) | null = null;
  /** One line about multiplayer (set by the net layer). */
  netStatus: (() => string) | null = null;

  constructor(private parent: HTMLElement, private game: Game, private hud: Hud) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.stack.length) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(title: string, body: HTMLElement, opts: { wide?: boolean; foot?: HTMLElement; onClose?: () => void; cls?: string } = {}): HTMLElement {
    const closeBtn = h('button', { class: 'icon-btn', html: icon('close', 18), 'aria-label': 'Close', onClick: () => this.close() });
    const modal = h('div', { class: `modal${opts.wide ? ' wide' : ''} ${opts.cls ?? ''}`, role: 'dialog', 'aria-label': title },
      h('header', { class: 'modal-head' }, h('h2', { text: title }), closeBtn),
      h('div', { class: 'modal-body' }, body),
      opts.foot ? h('footer', { class: 'modal-foot' }, opts.foot) : null,
    );
    // Game screens dock to the side so the table stays in view.
    const docked = /table-game|minigame|room-modal/.test(opts.cls ?? '');
    const layer = h('div', { class: `modal-layer${docked ? ' docked' : ''}` }, modal);
    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer) this.close();
    });
    this.parent.appendChild(layer);
    this.stack.push({ layer, onClose: opts.onClose });
    this.game.modalOpen = true;
    audio.play('pop');
    return modal;
  }

  close(): void {
    const f = this.stack.pop();
    if (!f) return;
    f.layer.classList.add('closing');
    window.setTimeout(() => f.layer.remove(), 160);
    f.onClose?.();
    if (!this.stack.length) this.game.modalOpen = false;
  }

  closeAll(): void {
    while (this.stack.length) this.close();
  }

  confirm(title: string, text: string, okLabel: string, onOk: () => void, danger = true): void {
    const foot = h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: 'Cancel', onClick: () => this.close() }),
      h('button', { class: `btn ${danger ? 'danger' : 'gold'}`, text: okLabel, onClick: () => { this.close(); onOk(); } }),
    );
    this.open(title, h('p', { class: 'lead', text }), { foot, cls: 'small' });
  }

  // ------------------------------------------------------------------ casino

  openCasino(): void {
    const g = this.game;
    const look = g.building.look;
    const body = h('div', { class: 'stack' });
    const nameInput = h('input', { class: 'text-input', id: 'casino-name', type: 'text', value: look.name, maxLength: 26, placeholder: 'Name your casino' });
    let t = 0;
    nameInput.addEventListener('input', () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => g.setLook({ name: nameInput.value.trim() || 'My Casino' }), 250);
    });
    body.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: g.inHotel ? 'Hotel name' : g.inHouse ? 'House name' : 'Casino name' }), nameInput));

    const fonts = h('div', { class: 'chips' });
    const renderFonts = () => {
      clear(fonts);
      for (const f of SIGN_FONTS) {
        fonts.appendChild(h('button', {
          class: `chip-btn${g.building.look.signFont === f.id ? ' on' : ''}`, style: `font-family:${f.css};font-weight:${f.weight}`, text: f.label,
          onClick: () => { g.setLook({ signFont: f.id }); renderFonts(); audio.play('click'); },
        }));
      }
    };
    renderFonts();
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Sign lettering' }), fonts));
    body.appendChild(this.colorField('Sign color', NEON_COLORS, () => g.building.look.signColor, (c) => g.setLook({ signColor: c })));
    body.appendChild(this.colorField('Wall color', WALL_COLORS, () => g.building.look.wallColor, (c) => g.setLook({ wallColor: c })));
    body.appendChild(this.colorField('Neon trim', NEON_COLORS, () => g.building.look.trimColor, (c) => g.setLook({ trimColor: c })));
    body.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field-label', text: g.floors > 1 ? `Carpet (${g.player.floor === 0 ? 'ground floor' : `floor ${g.player.floor + 1}`})` : 'Carpet' }),
      h('button', {
        class: 'btn paint-open', html: `${icon('paint', 16)} Paint the floor`,
        onClick: () => { this.close(); this.hud.togglePaint(); },
      }),
      h('button', {
        class: 'btn paint-open', html: '🧱 Build walls',
        onClick: () => { this.close(); this.hud.toggleWalls(); },
      }),
    ));

    // Rating breakdown (a house has a security rating instead)
    const rb = g.ratingBreakdown();
    if (g.inHouse) {
      body.appendChild(h('div', { class: 'field' },
        h('span', { class: 'field-label', html: `Security <b>${g.houseSecurity}/100</b>` }),
        h('div', { class: 'meter wide' }, h('i', { style: `width:${g.houseSecurity}%` })),
        h('p', { class: 'muted small', text: 'Raise it with a bigger vault, bodyguards (Staff), gate guards and security gadgets (Build → Security).' }),
      ));
    }
    const bar = (label: string, v: number, tip: string) =>
      h('div', { class: 'rb-row', title: tip }, h('span', { text: label }), h('span', { class: 'meter' }, h('i', { style: `width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(0)}%` })));
    if (!g.inHouse) body.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field-label', html: `Rating ${stars(g.rating)} <b>${g.rating.toFixed(1)}</b>` }),
      h('div', { class: 'rb' },
        bar('Guest happiness', rb.happiness, 'Average mood of guests when they leave'),
        bar('Decor', rb.decor, 'Decorations per square of floor'),
        bar('Variety', rb.variety, 'Different kinds of games'),
        bar('Cleanliness', rb.clean, 'Pick up litter or hire janitors'),
        bar('Working machines', rb.working, 'Fix broken machines quickly'),
      ),
    ));

    // Growing the building: width is capped for every lot on the street; depth and floors are not.
    const r = g.grid.rect;
    const w = r.x1 - r.x0 + 1;
    const d = r.z1 - r.z0 + 1;
    const nw = g.nextWidth;
    const growRow = (title: string, value: string, note: string, btn: HTMLElement | null) =>
      h('div', { class: 'expand-box' }, h('div', { class: 'expand-info' }, h('div', { class: 'field-label', text: title }), h('div', { class: 'big-num', text: value }), h('div', { class: 'muted', text: note })), btn);
    const exp = h('div', { class: 'stack grow' },
      growRow('Width', `${w} tiles`, nw ? `Next: ${nw.w} wide · needs level ${nw.level}` : `Street limit (${MAX_WIDTH}) reached`,
        nw ? h('button', { class: 'btn gold', html: `${icon('expand', 16)} Widen <b>${formatMoney(nw.cost)}</b>`, disabled: g.level < nw.level, onClick: () => { if (g.expandWidth()) this.close(); } }) : null),
      growRow('Depth', `${d} tiles`, g.layout.depth >= MAX_DEPTH_STEPS ? `Block limit reached (${d} tiles): the next street's lots start behind you` : `+${DEPTH_STEP} rows · needs level ${g.nextDepthLevel} · up to ${MAX_DEPTH} deep`,
        g.layout.depth >= MAX_DEPTH_STEPS ? null : h('button', { class: 'btn gold', html: `${icon('expand', 16)} Build deeper <b>${formatMoney(g.nextDepthCost)}</b>`, disabled: g.level < g.nextDepthLevel, onClick: () => { if (g.expandDepth()) this.close(); } })),
      growRow('Floors', `${g.floors}`, `${g.floors === 1 ? 'An elevator appears by the entrance' : 'Every floor is as big as the ground floor'} · needs level ${g.nextFloorLevel} · no limit`,
        h('button', { class: 'btn gold', html: `${icon('upgrade', 16)} Add a floor <b>${formatMoney(g.nextFloorCost)}</b>`, disabled: g.level < g.nextFloorLevel, onClick: () => { if (g.addFloor()) this.close(); } })),
    );
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Grow your casino' }), exp));
    this.open(g.inHotel ? 'Your hotel' : g.inHouse ? 'Your house' : 'Your casino', body, { wide: false });
  }

  private colorField(label: string, colors: number[], get: () => number, set: (c: number) => void): HTMLElement {
    const row = h('div', { class: 'swatch-row' });
    const render = () => {
      clear(row);
      for (const c of colors) {
        row.appendChild(h('button', {
          class: `color-sw${get() === c ? ' on' : ''}`, style: `background:${swatch(c)}`, 'aria-label': `${label} ${swatch(c)}`,
          onClick: () => { set(c); render(); audio.play('click'); },
        }));
      }
    };
    render();
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row);
  }

  // ------------------------------------------------------------------ staff

  openStaff(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      const roles = h('div', { class: 'role-grid' });
      for (const r of rolesAt(g.site)) {
        const count = g.workers.filter((w) => w.role === r.role).length;
        const locked = g.level < r.unlock;
        roles.appendChild(h('div', { class: `role-card${locked ? ' locked' : ''}` },
          h('div', { class: 'role-title', text: r.title }),
          h('div', { class: 'muted', text: r.blurb }),
          h('div', { class: 'role-meta' }, h('span', { text: `${formatMoney(r.wage)}/day` }), h('span', { text: `Hired: ${count}` })),
          h('button', {
            class: 'btn gold small', text: locked ? `Level ${r.unlock}` : `Hire · ${formatMoney(r.wage)}`, disabled: locked,
            onClick: () => { if (g.hire(r.role)) render(); },
          }),
        ));
      }
      body.appendChild(roles);
      if (g.workers.length) {
        const list = h('div', { class: 'staff-list' });
        for (const w of g.workers) {
          list.appendChild(h('div', { class: 'staff-row' },
            h('div', {}, h('b', { text: w.name }), h('span', { class: 'muted', text: ` · ${roleFor(w.role, g.site).title}` })),
            h('div', { class: 'muted small', text: w.statusLine }),
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn small', text: 'Find', onClick: () => { this.close(); g.select({ kind: 'worker', w }); g.cam.focus.set(w.x, 0, w.z); } }),
              h('button', { class: 'btn small', text: 'Style', onClick: () => this.openCreator('worker', w) }),
              h('button', { class: 'btn small danger', text: 'Fire', onClick: () => this.confirm(`Fire ${w.name}?`, 'They leave right away.', 'Fire', () => { g.fire(w); render(); }) }),
            ),
          ));
        }
        body.appendChild(h('div', { class: 'field-label', text: 'Your team' }));
        body.appendChild(list);
      } else {
        body.appendChild(h('p', { class: 'muted', text: 'No staff yet. Wages are paid at the end of each day.' }));
      }
    };
    render();
    const off = g.events.on('staff', render);
    this.open('Staff', body, { onClose: off });
  }

  // ------------------------------------------------------------------ stats

  /** Save your casino to a file (or text) and load one back, yours or a friend's. */
  openTransfer(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const save = g.serialize();
    const text = exportSave(save);
    const status = h('p', { class: 'muted small' });
    // Export
    body.appendChild(h('h3', { class: 'cos-head', text: 'Export' }));
    body.appendChild(h('p', { class: 'muted small', text: 'Your casino, money, level and cosmetics in one file. Keep it as a backup or send it to a friend.' }));
    body.appendChild(h('div', { class: 'btn-row wrap' },
      h('button', {
        class: 'btn gold', html: `${icon('save', 16)} Download file`,
        onClick: async () => {
          const name = exportFileName(save);
          // Inside the Claude artifact viewer, files go through its downloads capability.
          const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
          if (claude?.use) {
            const dl = (await claude.use('downloads').catch(() => null)) as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
            if (!dl) {
              status.textContent = 'Downloads aren’t available here: use Copy as text instead.';
              return;
            }
            try {
              await dl.save({ filename: name, data: text });
              status.textContent = `Saved ${name}.`;
            } catch (e) {
              const code = (e as { code?: string }).code;
              status.textContent = code === 'declined' ? 'Download cancelled.' : 'Couldn’t save the file here: use Copy as text instead.';
            }
            return;
          }
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 2000);
          status.textContent = `Saved ${name}.`;
        },
      }),
      h('button', {
        class: 'btn', text: 'Copy as text',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(text);
            status.textContent = 'Copied! Paste it anywhere to keep it.';
          } catch {
            area.value = text;
            area.select();
            status.textContent = 'Couldn’t reach the clipboard, so the save is in the box below: copy it from there.';
          }
        },
      }),
    ));
    // Import
    body.appendChild(h('h3', { class: 'cos-head', text: 'Import' }));
    body.appendChild(h('p', { class: 'muted small', text: 'Load a casino file, or paste the text. It replaces the casino you have now (export it first if you want to keep it).' }));
    const file = h('input', { type: 'file', class: 'text-input' }) as HTMLInputElement;
    file.accept = '.json,application/json,text/plain';
    const area = h('textarea', { class: 'text-input transfer-area', placeholder: 'Paste an exported casino here…', 'aria-label': 'Casino save text' }) as HTMLTextAreaElement;
    area.addEventListener('keydown', (e) => e.stopPropagation());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 8_000_000) {
        status.textContent = 'That file is too big to be a casino save.';
        return;
      }
      area.value = await f.text();
      status.textContent = `Loaded ${f.name}. Press Import to use it.`;
    });
    const doImport = () => {
      const r = parseImport(area.value);
      if ('error' in r) {
        audio.play('error');
        status.textContent = r.error;
        return;
      }
      const s = r.save;
      this.confirm(
        'Replace your casino?',
        `Load “${s.name}” (level ${s.level}, ${formatMoney(s.money)}, ${s.items.length} items on ${s.floors} ${s.floors === 1 ? 'floor' : 'floors'})? Your current casino will be replaced.`,
        'Import',
        () => {
          g.load(s);
          g.saveNow();
          this.closeAll();
          g.notify(`Welcome to ${s.name}!`, 'good');
        },
      );
    };
    body.append(file, area, h('button', { class: 'btn gold', text: 'Import', onClick: doImport }), status);
    this.open('Export / import casino', body, { wide: true });
  }

  /** Your house on Palm Avenue: buy it, find it, and see the bank and security at a glance. */
  openHouse(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      const hs = g.house;
      const kv = (k: string, v: string, cls = '') => h('div', { class: 'kv' }, h('span', { text: k }), h('b', { class: cls, text: v }));
      if (!hs) {
        const block = g.houseBlock();
        body.append(
          h('p', { text: `Buy a house on ${STREET_NAMES[1]}, one street behind the Strip. It's your home and your bank: put a vault in it, pick your own code, and move money between the vault, the casino and the hotel. Hire bodyguards, add cameras and laser grids, and furnish every room.` }),
          kv('Price (from the casino bank)', formatMoney(HOUSE_PRICE)),
          kv('Unlocks at', `casino level ${HOUSE_LEVEL}`),
          h('button', { class: 'btn gold', disabled: !!block, html: `${icon('home', 16)} Buy the house <b>${formatMoney(HOUSE_PRICE)}</b>`, onClick: () => { if (g.buyHouse()) render(); } }),
        );
        if (block) body.appendChild(h('p', { class: 'muted small', text: block }));
        return;
      }
      const t = vaultTier(hs.tier);
      body.append(
        h('div', { class: 'hotel-head' },
          h('div', { class: 'hotel-stars', text: '🏠' }),
          h('b', { text: hs.snap.name }),
          h('span', { class: 'muted small', text: `On ${STREET_NAMES[1]}. Your cash comes with you; the casino keeps running while you're home.` }),
        ),
        kv('Vault', t ? `${t.name} · ${formatMoney(hs.vault)} of ${formatMoney(t.cap)}` : 'None yet: Build → Security → Vault'),
        kv('Interest', t ? `${(t.interest * 100).toFixed(2)}% a day` : '—'),
        kv('Security', `${g.houseSecurity}/100`),
        kv('Daily costs (guards and gadgets)', formatMoney(g.houseDailyCosts())),
      );
      const row = h('div', { class: 'btn-row wrap' });
      if (!g.inHouse) {
        row.appendChild(h('button', {
          class: 'btn gold', html: `${icon('home', 16)} Go home`,
          onClick: () => {
            const lot = g.street.get('house');
            if (!lot) return;
            if (g.travelBlock(lot)) {
              // Not at one of your buildings: point the way instead.
              const d = g.street.toGlobal('house', CENTER_X + 0.1, SIDEWALK_Z0 + 1.6);
              g.setWaypoint(d.x, d.z, 'your house');
              g.notify('Waypoint set to your house. Fast travel only works from your casino or hotel.', 'info');
              this.close();
            } else if (g.teleportToLot(lot)) this.close();
          },
        }));
      } else {
        row.appendChild(h('button', {
          class: 'btn gold', html: `${icon('casino', 16)} Back to the casino`,
          onClick: () => {
            const me = g.street.get('me');
            if (me && g.enterLot(me)) this.close();
          },
        }));
      }
      row.appendChild(h('button', {
        class: 'btn', text: hs.garage ? `🅿 Garage · ${hs.parked.length} car${hs.parked.length === 1 ? '' : 's'}` : '🅿 Build a garage',
        onClick: () => {
          this.close();
          openGarage(g, this);
        },
      }));
      body.appendChild(row);
      body.appendChild(h('div', { class: 'field-label', text: 'Vault tiers' }));
      const tiers = h('div', { class: 'tier-list' });
      for (const v of VAULT_TIERS) {
        tiers.appendChild(h('div', { class: `tier${hs.tier === v.tier ? ' on' : hs.tier > v.tier ? ' done' : ''}` },
          h('b', { text: v.name }),
          h('span', { class: 'muted small', text: `${formatMoney(v.price)} · holds ${formatMoney(v.cap, true)} · ${v.digits} digits · ${v.bolts} bolts` }),
        ));
      }
      body.appendChild(tiers);
      body.appendChild(h('p', { class: 'muted small', text: `In the house: walk up to the vault and press Space to type your code. Up to ${MAX_DOOR_GUARDS} gate guards can stand at the door.` }));
    };
    render();
    const off = g.events.on('house', render);
    this.open('Home', body, { onClose: off });
    void FACADE_Z;
  }

  /** Your hotel tower: buy it, add storeys, upgrade the stars, see last night. */
  openHotel(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      const hs = g.hotel;
      if (!hs) {
        const block = g.hotelBlock();
        fill(body,
          h('p', { text: 'Open a second business: a hotel right next to your casino, with its own bank. It starts as one empty tower: give it a reception desk, a breakfast buffet, rooms and a housekeeper to open, then decorate every room, add penthouses, more towers and open-air Pool Gardens. Its guests also come over to gamble.' }),
          h('div', { class: 'kv' }, h('span', { text: 'Price (from the casino bank)' }), h('b', { text: formatMoney(HOTEL_PRICE) })),
          h('div', { class: 'kv' }, h('span', { text: 'Hotel starting cash' }), h('b', { text: formatMoney(HOTEL_START_CASH) })),
          h('button', { class: 'btn gold', disabled: !!block, html: `${icon('home', 16)} Build the hotel <b>${formatMoney(HOTEL_PRICE)}</b>`, onClick: () => { if (g.buyHotel()) render(); } }),
          block ? h('p', { class: 'muted small', text: block }) : null,
        );
        return;
      }
      const inside = g.inHotel;
      const bank = g.hotelMoney;
      const level = g.hotelLevel;
      const live = g.currentBuilding;
      const rating = inside ? g.rating : hs.buildings[0].snap.rating;
      const boost = hotelGuestBoost(hs);
      const kv = (k: string, v: string, cls = '') => h('div', { class: 'kv' }, h('span', { text: k }), h('b', { class: cls, text: v }));
      const r = Math.max(1, Math.min(5, Math.round(rating)));
      const awayRate = hs.buildings.reduce((a, x) => a + (x.id === g.hotelBid && inside ? 0 : x.rate), 0);
      fill(body,
        h('div', { class: 'hotel-head' },
          h('div', { class: 'hotel-stars', text: '★'.repeat(r) + '☆'.repeat(5 - r) }),
          h('b', { text: hotelName(g.homeLook.name) }),
          h('span', { class: 'muted small', text: `A separate business: its own bank, level ${level}, goals and ${hs.buildings.length} ${hs.buildings.length === 1 ? 'building' : 'buildings'}.` }),
        ),
        kv('Hotel bank', formatMoney(bank), bank >= 0 ? 'pos' : 'neg'),
        kv('Earning from buildings you’re not in', awayRate > 0 ? `about ${formatMoney(awayRate * 60 * g.incomeMult)} a minute` : 'Nothing yet: open a tower first'),
        kv('Guests sent over to your casino', hs.staying ? `+${Math.round((boost.spawn - 1) * 100)}% visitors` : '—'),
      );
      // This tower's opening checklist
      if (live && live.kind === 'tower') {
        const list = g.hotelChecklist();
        const open = list.every((c) => c.done);
        body.appendChild(h('div', { class: `hotel-check${open ? ' open' : ''}` },
          h('b', { text: open ? '✅ This tower is open for guests' : '🚧 This tower opens once it has:' }),
          ...(open ? [] : list.map((c) => h('div', { class: `chk${c.done ? ' done' : ''}`, text: `${c.done ? '✔' : '○'} ${c.label}` }))),
        ));
      }
      // Buildings
      const bl = h('div', { class: 'hotel-buildings' });
      hs.buildings.forEach((b, i) => {
        const here = inside && b.id === g.hotelBid;
        const open = b.kind === 'tower' ? snapChecklist(here ? { ...b.snap, items: g.items.serialize(), staff: g.workers.map((w) => ({ role: w.role, name: w.name, look: w.look })) } : b.snap).every((c) => c.done) : null;
        const rooms = b.snap.items.filter((it) => it.id === 'room' || it.id === 'suite' || it.id === 'penthouse').length;
        bl.appendChild(h('div', { class: `hb-card${here ? ' here' : ''}` },
          h('span', { class: 'hb-ic', text: b.kind === 'garden' ? '🏝️' : '🏨' }),
          h('div', {},
            h('b', { text: buildingName(hotelName(g.homeLook.name), b, i, hs.buildings) }),
            h('div', { class: 'muted small', text: b.kind === 'garden'
              ? `${b.snap.items.filter((it) => ['pool', 'waterslide', 'hottub'].includes(it.id)).length} pools & tubs · ${b.snap.items.length} things`
              : `${here ? 'You are here · ' : ''}${rooms} rooms · ${b.snap.floors} ${b.snap.floors === 1 ? 'floor' : 'floors'} · ${open ? 'open' : 'not open yet'}` }),
          ),
        ));
      });
      body.appendChild(h('div', { class: 'field-label', text: 'Buildings' }));
      body.appendChild(bl);
      const buyRow = h('div', { class: 'btn-row wrap' });
      for (const kind of ['tower', 'garden'] as const) {
        const block = g.buildingBlock(kind);
        const c = buildingCost(kind, hs.buildings.filter((b) => b.kind === kind).length);
        buyRow.appendChild(h('button', {
          class: `btn${kind === 'garden' ? ' gold' : ''}`, disabled: !!block, title: block ?? '',
          html: `${kind === 'garden' ? '🏝️ Add a Pool Garden' : '🏨 Add a tower'} <b>${formatMoney(c.price)}</b>${g.hotelLevel < c.level ? ` <small>Lv ${c.level}</small>` : ''}`,
          onClick: () => { if (g.buyBuilding(kind)) render(); },
        }));
      }
      body.appendChild(buyRow);
      body.appendChild(h('p', { class: 'muted small', text: 'New buildings go on the lots next to your hotel. Towers hold rooms and indoor services; pools, hot tubs, cabanas and the tiki bar only go in open-air Pool Gardens, which make every tower easier to fill.' }));
      // Reviews
      if (hs.reviews.length) {
        const avg = g.reviewAverage;
        body.appendChild(h('div', { class: 'field-label', text: `Guest reviews · ${avg.toFixed(1)}★ average` }));
        const rv = h('div', { class: 'reviews' });
        for (const x of hs.reviews.slice(0, 6)) {
          rv.appendChild(h('div', { class: 'review' },
            h('div', {}, h('span', { class: 'hotel-stars small', text: '★'.repeat(x.stars) + '☆'.repeat(5 - x.stars) }), h('b', { text: ` ${x.name}${x.vip ? ' 💎' : ''}` }), h('span', { class: 'muted small', text: ` · day ${x.day}` })),
            h('div', { class: 'muted small', text: `“${x.text}”` }),
          ));
        }
        body.appendChild(rv);
      }
    };
    render();
    const off = g.events.on('hotel', () => render());
    this.open('Hotel', body, { onClose: () => off() });
  }

  /**
   * Decorate one hotel room. Changes show on the room itself while you choose; nothing is
   * paid until you apply (to this room, or to every room like it on the floor).
   */
  openRoom(item: PlacedItem): void {
    const g = this.game;
    if (!item.setup) return;
    const cls = item.roomClass;
    const kind = ROOM_CLASS_NAMES[cls];
    const plural = cls === 0 ? 'rooms' : cls === 1 ? 'suites' : 'penthouses';
    const original: RoomSetup = { ...item.setup, extras: [...item.setup.extras] };
    let draft: RoomSetup = { ...original, extras: [...original.extras] };
    let applied = false;
    const body = h('div', { class: 'stack room-editor' });
    const others = () => g.items.items.filter((i) => i.def.id === item.def.id && i.floor === item.floor && i !== item && i.setup);
    // Show the design on the room itself; guests and saves still see the paid setup.
    const preview = () => {
      item.previewOf ??= original;
      item.setup = { ...draft, extras: [...draft.extras] };
      item.rebuildModel();
    };
    const unpreview = () => {
      item.setup = original;
      item.previewOf = null;
    };
    const choice = (label: string, sub: string, on: boolean, click: () => void, extra: Partial<{ disabled: boolean; swatch: number; icon: string }> = {}) =>
      h('button', {
        class: `room-opt${on ? ' on' : ''}`, disabled: !!extra.disabled,
        onClick: () => { click(); audio.play('click'); preview(); render(); },
      },
      extra.swatch !== undefined ? h('i', { class: 'room-sw', style: `background:#${extra.swatch.toString(16).padStart(6, '0')}` }) : extra.icon ? h('span', { class: 'room-ic', text: extra.icon }) : null,
      h('b', { text: label }), h('small', { text: sub }));
    const price = (p: number) => (p ? formatMoney(p) : 'Free');
    const render = () => {
      clear(body);
      const stars = roomStars(draft, cls);
      const rate = roomRate(draft, cls);
      const cost = changeCost(original, draft);
      const floorRooms = others();
      const floorCost = cost + floorRooms.reduce((a, r) => a + changeCost(r.setup!, draft), 0);
      body.appendChild(h('div', { class: 'room-sum' },
        h('div', { class: 'hotel-stars', text: '★'.repeat(stars) + '☆'.repeat(5 - stars) }),
        h('div', {}, h('b', { text: `${formatMoney(rate)} a night` }), h('span', { class: 'muted small', text: ` · decor worth ${formatMoney(setupValue(draft))}` })),
      ));
      body.appendChild(h('div', { class: 'room-themes' },
        h('span', { class: 'field-label', text: 'Quick themes' }),
        ...ROOM_THEMES.map((t) => {
          const set = themeFor(t.setup, cls);
          return h('button', {
            class: `chip-btn${sameSetup(set, draft) ? ' on' : ''}`, html: `${t.icon} ${t.name} <small>${formatMoney(roomRate(set, cls))}</small>`,
            onClick: () => { draft = { ...set, extras: [...set.extras] }; audio.play('click'); preview(); render(); },
          });
        }),
      ));
      if (cls === 2) body.appendChild(h('p', { class: 'muted small', text: '💎 Only VIP high rollers book penthouses, and they always take the most luxurious one free.' }));
      const sect = (title: string, ...kids: HTMLElement[]) => body.appendChild(h('div', { class: 'room-sect' }, h('div', { class: 'field-label', text: title }), h('div', { class: 'room-opts' }, ...kids)));
      sect('Bed', ...BEDS.map((b, i) => choice(b.name, price(b.price), draft.bed === i, () => (draft.bed = i))));
      sect('Walls', ...ROOM_WALLS.map((w, i) => choice(w.name, price(w.price), draft.wall === i, () => (draft.wall = i), { swatch: w.color })));
      sect('Floor', ...ROOM_FLOORS.map((f, i) => choice(f.name, price(f.price), draft.floor === i, () => (draft.floor = i), { swatch: f.color })));
      sect('Extras', ...ROOM_EXTRAS.map((e) => choice(e.name, !fitsClass(e, cls) ? (e.min === 2 ? 'Penthouse only' : 'Suites & up') : price(e.price), draft.extras.includes(e.id), () => {
        draft.extras = draft.extras.includes(e.id) ? draft.extras.filter((x) => x !== e.id) : [...draft.extras, e.id];
      }, { icon: e.icon, disabled: !fitsClass(e, cls) })));
      const changed = !sameSetup(original, draft);
      const money = (n: number) => (n > 0 ? `pay ${formatMoney(n)}` : n < 0 ? `get ${formatMoney(-n)} back` : 'no charge');
      body.appendChild(h('p', { class: 'muted small', text: 'What you spend decides the stars and the nightly price. Rich guests hunt for stars; budget guests just want something they can afford. Removing things gives half their price back.' }));
      body.appendChild(h('div', { class: 'btn-row wrap' },
        h('button', {
          class: 'btn gold', disabled: !changed || (cost > 0 && g.money < cost), text: changed ? `Apply to this room (${money(cost)})` : 'No changes yet',
          onClick: () => {
            unpreview();
            if (g.decorateRoom(item, draft)) {
              applied = true;
              audio.play('purchase');
              g.notify(`Room decorated: ${stars}★, ${formatMoney(rate)} a night.`, 'good');
              this.close();
            } else preview();
          },
        }),
        floorRooms.length
          ? h('button', {
            class: 'btn', disabled: floorCost > 0 && g.money < floorCost, text: `Apply to all ${floorRooms.length + 1} ${plural} on this floor (${money(floorCost)})`,
            onClick: () => {
              unpreview();
              const ok = sameSetup(original, draft) || g.decorateRoom(item, draft);
              const r = ok ? g.applySetupToFloor(item, draft) : null;
              if (!r) {
                preview();
                return;
              }
              applied = true;
              audio.play('purchase');
              g.notify(`${r.rooms + 1} ${plural} now match: ${stars}★, ${formatMoney(rate)} a night.`, 'good');
              this.close();
            },
          })
          : null,
      ));
    };
    render();
    this.open(`Decorate ${kind}`, body, {
      cls: 'room-modal',
      onClose: () => {
        if (applied) return;
        unpreview();
        if (g.items.items.includes(item)) item.rebuildModel();
      },
    });
  }

  /** Start over for a permanent bonus. */
  openRebirth(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const req = g.rebirthReq;
    const block = g.rebirthBlock();
    const nextMult = 1 + (g.rebirths + 1) * 0.25;
    fill(body, 
      h('div', { class: 'hotel-head' },
        h('div', { class: 'rebirth-badge big', text: g.rebirths ? `⟳ ${roman(g.rebirths)}` : '⟳' }),
        h('b', { text: g.rebirths ? `Reborn ${g.rebirths} ${g.rebirths === 1 ? 'time' : 'times'} · ${Math.round(g.incomeMult * 100)}% income` : 'Not reborn yet' }),
      ),
      h('p', { text: `Sell up and start again from scratch, but richer in spirit: everything your casino and hotel earn is worth ${Math.round(nextMult * 100)}% after this rebirth (+25% each time), for good.` }),
      h('div', { class: 'kv' }, h('span', { text: 'Needs' }), h('b', { text: `Level ${req.level} and ${formatMoney(req.money)}` })),
      h('div', { class: 'kv' }, h('span', { text: 'You keep' }), h('b', { text: 'Your character, name, casino style, luxury items and lifetime stats' })),
      h('div', { class: 'kv' }, h('span', { text: 'Resets' }), h('b', { class: 'neg', text: 'Money, level, goals, the casino, its staff and the hotel' })),
      h('button', {
        class: 'btn gold', disabled: !!block, text: `Rebirth ${roman(g.rebirths + 1)}`,
        onClick: () => this.confirm('Rebirth?', `Your casino, hotel, money (${formatMoney(g.money)}), level and goals reset. You keep your character and luxury items, and earn ${Math.round(nextMult * 100)}% from now on.`, 'Rebirth', () => {
          if (g.rebirth()) this.closeAll();
        }),
      }),
      block ? h('p', { class: 'muted small', text: block }) : null,
    );
    this.open('Rebirth', body);
  }

  /** Luxury shop: very expensive, purely for show. */
  openCosmetics(): void {
    const g = this.game;
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      body.appendChild(h('p', { class: 'muted small', text: 'Nothing here makes money. It just makes everyone on the street jealous. Character items show on you, casino items on your building, and other players see both.' }));
      for (const target of ['player', 'casino'] as const) {
        body.appendChild(h('h3', { class: 'cos-head', text: target === 'player' ? 'For you' : 'For your casino' }));
        const grid = h('div', { class: 'cos-grid' });
        for (const c of COSMETICS.filter((x) => x.target === target)) {
          const owned = g.cosmetics.owned.includes(c.id);
          const on = g.cosmetics.on.includes(c.id);
          const btn = owned
            ? h('button', { class: `btn small${on ? ' gold' : ''}`, text: on ? 'On' : 'Off', onClick: () => { g.toggleCosmetic(c.id); render(); } })
            : h('button', { class: 'btn small gold', disabled: g.money < c.price, html: `Buy <b>${formatMoney(c.price, true)}</b>`, onClick: () => { if (g.buyCosmetic(c.id)) render(); } });
          grid.appendChild(h('div', { class: `cos-card${owned ? ' owned' : ''}` },
            h('div', { class: 'cos-icon', text: c.icon }),
            h('b', { text: c.name }),
            h('span', { class: 'muted small', text: c.description }),
            btn));
        }
        body.appendChild(grid);
      }
    };
    render();
    this.open('Luxury Shop', body, { wide: true });
  }

  openStats(): void {
    const g = this.game;
    const s = g.stats;
    const tiles: [string, string][] = [
      ['Total earned', formatMoney(s.earnedTotal, true)],
      ['Guests welcomed', formatNumber(s.visitors)],
      ['Rounds played', formatNumber(s.rounds)],
      ['Jackpots', formatNumber(s.jackpots)],
      ['Biggest win', formatMoney(s.biggestWin, true)],
      ['Cheaters caught', formatNumber(s.cheatersCaught)],
      ['Drinks & snacks', formatNumber(s.drinksServed)],
      ['Litter cleaned', formatNumber(s.trashCleaned)],
    ];
    const grid = h('div', { class: 'stat-grid' });
    for (const [k, v] of tiles) grid.appendChild(h('div', { class: 'stat-tile' }, h('div', { class: 'stat-v', text: v }), h('div', { class: 'stat-k', text: k })));
    const chart = h('canvas', { class: 'chart' });
    const top = [...g.items.items].filter((i) => i.isGambling || ['bar', 'snack', 'atm'].includes(i.def.kind)).sort((a, b) => b.profit - a.profit).slice(0, 6);
    const table = h('div', { class: 'top-list' },
      ...top.map((i) => h('div', { class: 'kv' }, h('span', { text: `${i.def.name} (Lv ${i.level})` }), h('b', { class: i.profit >= 0 ? 'pos' : 'neg', text: formatMoney(i.profit) }))),
    );
    const thoughts = new Map<string, number>();
    for (const c of g.customers) {
      if (!c.inside || c.exited) continue;
      thoughts.set(c.thought, (thoughts.get(c.thought) ?? 0) + 1);
    }
    const topThoughts = [...thoughts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const worth = g.money + g.items.items.reduce((a, i) => a + i.sellValue, 0);
    grid.prepend(h('div', { class: 'stat-tile' }, h('div', { class: 'stat-v', text: formatMoney(worth, true) }), h('div', { class: 'stat-k', text: 'Casino value' })));
    const body = h('div', { class: 'stack' },
      grid,
      h('div', { class: 'field-label', text: 'What guests are saying right now' }),
      topThoughts.length
        ? h('div', { class: 'top-list' }, ...topThoughts.map(([t, n]) => h('div', { class: 'kv' }, h('span', { text: `“${t}”` }), h('b', { text: `${n}×` }))))
        : h('p', { class: 'muted', text: 'No guests inside yet.' }),
      h('div', { class: 'field-label', text: 'Bank balance (last 10 minutes)' }),
      chart,
      h('div', { class: 'field-label', text: 'Top earners' }),
      top.length ? table : h('p', { class: 'muted', text: 'Buy some machines to see who earns the most.' }),
      h('div', { class: 'field-label', text: `Goals complete: ${g.doneObjectives.size}/${g.objectiveList.length}` }),
    );
    this.open(g.inHotel ? 'Hotel stats' : 'Casino stats', body, { wide: true });
    requestAnimationFrame(() => drawLine(chart, g.moneyHistory));
  }

  // ------------------------------------------------------------------ menu & settings

  openMenu(): void {
    const g = this.game;
    const st = g.settings;
    const body = h('div', { class: 'stack' });
    const slider = (label: string, val: number, on: (v: number) => void) => {
      const input = h('input', { type: 'range', class: 'range', value: String(Math.round(val * 100)) }) as HTMLInputElement;
      input.min = '0';
      input.max = '100';
      input.addEventListener('input', () => on(Number(input.value) / 100));
      return h('label', { class: 'field row' }, h('span', { class: 'field-label', text: label }), input);
    };
    body.appendChild(h('div', { class: 'btn-row wrap' },
      h('button', { class: 'btn gold', html: `${icon('play', 16)} Resume`, onClick: () => this.close() }),
      h('button', { class: 'btn', html: `${icon('save', 16)} Save now`, onClick: () => { g.saveNow(); g.notify('Game saved', 'good'); } }),
      h('button', { class: 'btn', html: `${icon('help', 16)} How to play`, onClick: () => this.openHelp() }),
      h('button', { class: 'btn', html: `${icon('save', 16)} Export / import`, onClick: () => this.openTransfer() }),
      h('button', { class: 'btn', text: `⟳ Rebirth${g.rebirths ? ` (${roman(g.rebirths)})` : ''}`, onClick: () => this.openRebirth() }),
      h('button', { class: 'btn', text: '🚗 My cars', onClick: () => { this.close(); openDealer(g, this, true); } }),
      h('button', { class: 'btn', text: '👥 Players & blacklist', onClick: () => (this.openPlayers ? this.openPlayers() : g.notify('Multiplayer isn’t connected here.', 'bad')) }),
    ));
    body.appendChild(slider('Master volume', st.master, (v) => { st.master = v; this.onSettingsChanged?.(); }));
    body.appendChild(slider('Sound effects', st.sfx, (v) => { st.sfx = v; this.onSettingsChanged?.(); }));
    body.appendChild(slider('Music', st.music, (v) => { st.music = v; this.onSettingsChanged?.(); }));
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: `switch${get() ? ' on' : ''}`, role: 'switch', 'aria-label': label, onClick: () => { set(!get()); b.classList.toggle('on', get()); b.setAttribute('aria-checked', String(get())); this.onSettingsChanged?.(); } });
      b.setAttribute('aria-checked', String(get()));
      return h('div', { class: 'field row' }, h('span', { class: 'field-label', text: label }), b);
    };
    body.appendChild(toggle('Lounge music', () => st.musicOn, (v) => (st.musicOn = v)));
    body.appendChild(toggle('Show FPS', () => st.showFps, (v) => (st.showFps = v)));
    const q = h('div', { class: 'seg' });
    for (const [id, label] of [['ult', 'Ult (AFK)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const) {
      q.appendChild(h('button', {
        class: `seg-btn${st.quality === id ? ' on' : ''}`, text: label,
        onClick: () => { g.setQuality(id); q.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.textContent === label)); this.onSettingsChanged?.(); },
      }));
    }
    body.appendChild(h('div', { class: 'field row' }, h('span', { class: 'field-label', text: 'Graphics' }), q));
    body.appendChild(h('p', { class: 'muted small', text: 'Ult (AFK) is for leaving the game running: up to 600 guests (3× as many arrive, and far more than you have seats), everyone drawn as simple blocks, half resolution and no shadows or glow.' }));
    const cam = h('div', { class: 'seg' });
    for (const [id, label] of [['top', 'Top-down'], ['third', 'Third person'], ['first', 'First person']] as const) {
      cam.appendChild(h('button', {
        class: `seg-btn${g.cam.mode === id ? ' on' : ''}`, text: label,
        onClick: () => { g.setCameraMode(id); cam.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.textContent === label)); },
      }));
    }
    body.appendChild(h('div', { class: 'field row' }, h('span', { class: 'field-label', text: 'Camera' }), cam));
    const sens = h('input', { type: 'range', 'aria-label': 'Look speed' }) as HTMLInputElement;
    sens.min = '0.3';
    sens.max = '2.5';
    sens.step = '0.05';
    sens.value = String(st.lookSens ?? 1);
    sens.addEventListener('input', () => {
      st.lookSens = Number(sens.value);
      this.onSettingsChanged?.();
    });
    body.appendChild(h('div', { class: 'field row' }, h('span', { class: 'field-label', text: 'First-person look speed' }), sens));
    // Crosshair: style, colour, size and thickness (screen, scope glass and full-screen scope).
    const ret = g.reticle;
    const prev = h('canvas', { class: 'reticle-preview' }) as HTMLCanvasElement;
    prev.width = prev.height = 192;
    const drawPrev = () => {
      const ctx = prev.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 192, 192);
      drawReticle(ctx, 192, ret);
    };
    const changed = () => {
      drawPrev();
      g.gunplay.refreshModels();
      this.onSettingsChanged?.();
    };
    const styles = h('div', { class: 'seg wrap' });
    for (const st2 of RETICLE_STYLES) {
      styles.appendChild(h('button', {
        class: `seg-btn${ret.style === st2.id ? ' on' : ''}`, text: st2.name,
        onClick: (e: Event) => {
          ret.style = st2.id;
          styles.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          changed();
        },
      }));
    }
    const colors = h('div', { class: 'cg-colors' });
    for (const c of RETICLE_COLORS) {
      colors.appendChild(h('button', {
        class: `car-sw${ret.color === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Crosshair colour ${c}`,
        onClick: (e: Event) => {
          ret.color = c;
          colors.querySelectorAll('.car-sw').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          changed();
        },
      }));
    }
    const range = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const r = h('input', { type: 'range', 'aria-label': label }) as HTMLInputElement;
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = String(get());
      r.addEventListener('input', () => {
        set(Number(r.value));
        changed();
      });
      return h('div', { class: 'field row' }, h('span', { class: 'field-label', text: label }), r);
    };
    body.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Crosshair (screen and scopes)' }),
      h('div', { class: 'reticle-edit' }, prev, h('div', { class: 'stack' }, styles, colors)),
      range('Crosshair size', 0.5, 2, 0.1, () => ret.size, (v) => (ret.size = v)),
      range('Line thickness', 1, 4, 1, () => ret.thick, (v) => (ret.thick = v))));
    drawPrev();
    if (this.netStatus) body.appendChild(h('div', { class: 'net-status' }, h('span', { class: 'field-label', text: 'Multiplayer' }), h('p', { class: 'muted small', text: this.netStatus() })));
    body.appendChild(h('div', { class: 'btn-row wrap sep' },
      h('button', { class: 'btn', html: `${icon('home', 16)} Title screen`, onClick: () => { g.saveNow(); this.closeAll(); this.onMainMenu?.(); } }),
      h('button', { class: 'btn danger', text: 'Start a new casino', onClick: () => this.confirm('Start over?', 'This replaces your current casino and its save.', 'Start over', () => { this.closeAll(); this.onNewCasino?.(); }) }),
    ));
    this.open('Menu', body);
  }

  openHelp(): void {
    const tips: [string, string][] = [
      ['Move', 'WASD or arrow keys (Shift to run). On touch, drag the left side of the screen.'],
      ['Build', 'Open Build, pick an item and click the floor to place it. R rotates. Green means it fits.'],
      ['Act', 'Space or F: hold to fix broken machines, bust cheaters (red ?), greet VIPs (gold star), comp grumpy guests.'],
      ['View', 'Q / E rotates, mouse wheel or pinch zooms. H (or the camera button) hides the HUD for screenshots.'],
      ['Edit', 'Click any machine to upgrade, move, rotate, recolor, rename its sign or sell it. Changed your mind? Selling within 15 seconds of buying refunds everything. Casino → Paint the floor for carpets.'],
      ['Rating', 'Happy guests, decorations, game variety and a clean floor raise your stars. More stars bring more guests and VIPs.'],
      ['Staff', 'Janitors sweep, technicians repair, door guards screen the entrance, security catches cheaters inside. Wages are paid daily.'],
      ['Emotes', 'Press 1–4 to wave, dance, cheer or clap.'],
      ['Money', 'Every bet settles the moment a round ends: when a guest loses, the chips land in your bank; when a guest wins, you pay them. The house edge wins over time.'],
      ['The street', 'Walk out the front door. The Golden Viper, a rival AI casino, is next door, and every other player’s casino lines the street too. You can’t gamble in your own casino, so go play theirs: blackjack, Casino Hold’em, roulette, craps, the big wheel and slots.'],
      ['Floors', 'Your lot has a width limit like every lot on the street, but you can build deeper and add as many floors as you can afford. The elevator links them.'],
      ['Yard', 'Decorations can also go in the two rows of sidewalk in front of your casino (build mode shows the grid). The red carpet stays clear.'],
      ['Door guards', 'Hire a Door Guard (Staff) to stand at the entrance and turn most cheaters away.'],
      ['Blacklist', 'Click another player in your casino to blacklist them for 10 minutes (then a 30-minute cooldown).'],
      ['Camera', 'V switches between the top-down view and a third-person camera behind you (A/D turn, W/S walk).'],
    ];
    const body = h('div', { class: 'help' }, ...tips.map(([k, v]) => h('div', { class: 'help-row' }, h('b', { text: k }), h('span', { text: v }))));
    this.open('How to play', body, { wide: true });
  }

  // ------------------------------------------------------------------ creator

  openCreator(target: 'player' | 'worker', worker?: Worker): void {
    const g = this.game;
    const isPlayer = target === 'player';
    const creator = new CharacterCreator(
      isPlayer ? g.player.appearance : worker!.look,
      isPlayer ? g.player.name : worker!.name,
      { role: isPlayer ? null : worker!.role },
    );
    const foot = h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: 'Cancel', onClick: () => this.close() }),
      h('button', {
        class: 'btn gold', html: `${icon('check', 16)} Looks great`,
        onClick: () => {
          if (isPlayer) g.setPlayerLook(creator.look, creator.name);
          else {
            worker!.setLook(creator.look);
            worker!.name = creator.name || worker!.name;
            g.events.emit('staff', undefined);
          }
          audio.play('purchase');
          this.close();
        },
      }),
    );
    this.open(isPlayer ? 'Your manager' : `Style ${worker!.name}`, creator.el, { wide: true, foot, cls: 'creator-modal', onClose: () => creator.dispose() });
    creator.mount();
  }

  // ------------------------------------------------------------------ day report

  dayReport(r: DayReport): void {
    const hotel = r.site === 'hotel';
    const lines: [string, number][] = hotel
      ? [['Room nights', r.revenue], ['Bar, pool-side & restaurant', r.sales], ['Staff wages', -r.wages], ['Upkeep', -r.upkeep]]
      : [['Bets taken', r.revenue], ['Payouts to guests', -r.payouts], ['Bar, snacks & ATM', r.sales], ['Staff wages', -r.wages], ['Upkeep', -r.upkeep]];
    if (r.hotel !== undefined) lines.push(['Hotel (its own bank)', r.hotel]);
    const card = h('div', { class: 'day-card' },
      h('div', { class: 'day-title', text: `${hotel ? 'Hotel · ' : ''}Day ${r.day} closed` }),
      h('div', { class: `day-profit ${r.profit >= 0 ? 'pos' : 'neg'}`, text: `${r.profit >= 0 ? '+' : ''}${formatMoney(r.profit)}` }),
      ...lines.map(([k, v]) => h('div', { class: 'kv' }, h('span', { text: k }), h('b', { class: v >= 0 ? 'pos' : 'neg', text: `${v >= 0 ? '+' : ''}${formatMoney(v)}` }))),
      h('div', { class: 'kv' }, h('span', { text: 'Guests' }), h('b', { text: formatNumber(r.visitors) })),
      h('div', { class: 'kv' }, h('span', { text: 'Star machine' }), h('b', { text: r.bestMachine })),
      h('button', { class: 'btn small', text: 'Nice!', onClick: () => card.remove() }),
    );
    this.parent.appendChild(card);
    audio.play('objective');
    window.setTimeout(() => {
      card.classList.add('out');
      window.setTimeout(() => card.remove(), 500);
    }, 9000);
    void this.hud;
  }
}

function drawLine(canvas: HTMLCanvasElement, data: number[]): void {
  const w = canvas.clientWidth || 600;
  const hgt = canvas.clientHeight || 160;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  const css = getComputedStyle(document.documentElement);
  const gold = css.getPropertyValue('--gold').trim() || '#ffc53d';
  const grid = 'rgba(255,255,255,0.08)';
  const text = css.getPropertyValue('--muted').trim() || '#b8a6d6';
  const pts = data.length ? data : [0];
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 1);
  const pad = { l: 56, r: 10, t: 10, b: 20 };
  const x = (i: number) => pad.l + (i / Math.max(1, pts.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (hgt - pad.t - pad.b);
  ctx.strokeStyle = grid;
  ctx.fillStyle = text;
  ctx.font = '11px Nunito, sans-serif';
  ctx.textAlign = 'right';
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y(v));
    ctx.lineTo(w - pad.r, y(v));
    ctx.stroke();
    ctx.fillText(formatMoney(v, true), pad.l - 6, y(v) + 4);
  }
  if (pts.length < 2) {
    ctx.textAlign = 'center';
    ctx.fillText('Collecting data…', w / 2, hgt / 2);
    return;
  }
  const grad = ctx.createLinearGradient(0, pad.t, 0, hgt);
  grad.addColorStop(0, 'rgba(255, 197, 61, 0.35)');
  grad.addColorStop(1, 'rgba(255, 197, 61, 0)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(pts[0]));
  pts.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(pts.length - 1), hgt - pad.b);
  ctx.lineTo(x(0), hgt - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(x(pts.length - 1), y(pts[pts.length - 1]), 4, 0, Math.PI * 2);
  ctx.fill();
}

/** Append children, skipping the optional ones that are null. */
function fill(el: HTMLElement, ...kids: (Node | null)[]): void {
  for (const k of kids) if (k) el.appendChild(k);
}
