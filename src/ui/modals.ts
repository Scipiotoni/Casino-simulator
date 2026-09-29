import type { Game, DayReport } from '../game/game';
import type { Hud } from './hud';
import { h, clear, icon, swatch, stars } from './dom';
import { formatMoney, formatNumber } from '../core/math';
import { audio } from '../core/audio';
import { NEON_COLORS, SIGN_FONTS, WALL_COLORS } from '../world/building';
import { EXPANSIONS } from '../world/grid';
import { ROLES } from '../entities/staff';
import type { Worker } from '../entities/staff';
import { CharacterCreator } from './creator';
import { OBJECTIVES } from '../game/objectives';

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
    const layer = h('div', { class: 'modal-layer' }, modal);
    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer) this.close();
    });
    this.parent.appendChild(layer);
    this.stack.push({ layer, onClose: opts.onClose });
    this.game.input.joystickEnabled = false;
    audio.play('pop');
    return modal;
  }

  close(): void {
    const f = this.stack.pop();
    if (!f) return;
    f.layer.classList.add('closing');
    window.setTimeout(() => f.layer.remove(), 160);
    f.onClose?.();
    if (!this.stack.length) this.game.input.joystickEnabled = true;
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
    body.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Casino name' }), nameInput));

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

    // Rating breakdown
    const rb = g.ratingBreakdown();
    const bar = (label: string, v: number, tip: string) =>
      h('div', { class: 'rb-row', title: tip }, h('span', { text: label }), h('span', { class: 'meter' }, h('i', { style: `width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(0)}%` })));
    body.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field-label', html: `Rating ${stars(g.rating)} <b>${g.rating.toFixed(1)}</b>` }),
      h('div', { class: 'rb' },
        bar('Guest happiness', rb.happiness, 'Average mood of guests when they leave'),
        bar('Decor', rb.decor, 'Decorations per square of floor'),
        bar('Variety', rb.variety, 'Different kinds of games'),
        bar('Cleanliness', rb.clean, 'Pick up litter or hire janitors'),
        bar('Working machines', rb.working, 'Fix broken machines quickly'),
      ),
    ));

    // Expansion
    const cur = EXPANSIONS[g.expansion];
    const next = EXPANSIONS[g.expansion + 1];
    const exp = h('div', { class: 'expand-box' },
      h('div', { class: 'expand-info' },
        h('div', { class: 'field-label', text: 'Floor space' }),
        h('div', { class: 'big-num', text: `${cur.w} × ${cur.d}` }),
        next ? h('div', { class: 'muted', text: `Next: ${next.w} × ${next.d} · needs level ${next.level}` }) : h('div', { class: 'muted', text: 'Maximum size reached' }),
      ),
      next
        ? h('button', {
          class: 'btn gold', html: `${icon('expand', 16)} Expand <b>${formatMoney(next.cost)}</b>`, disabled: g.level < next.level,
          onClick: () => { if (g.expand()) { this.close(); } },
        })
        : null,
    );
    body.appendChild(exp);
    this.open('Your casino', body, { wide: false });
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
      for (const r of ROLES) {
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
            h('div', {}, h('b', { text: w.name }), h('span', { class: 'muted', text: ` · ${w.info.title}` })),
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
    const body = h('div', { class: 'stack' },
      grid,
      h('div', { class: 'field-label', text: 'Bank balance (last 10 minutes)' }),
      chart,
      h('div', { class: 'field-label', text: 'Top earners' }),
      top.length ? table : h('p', { class: 'muted', text: 'Buy some machines to see who earns the most.' }),
      h('div', { class: 'field-label', text: `Goals complete: ${g.doneObjectives.size}/${OBJECTIVES.length}` }),
    );
    this.open('Casino stats', body, { wide: true });
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
    for (const [id, label] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const) {
      q.appendChild(h('button', {
        class: `seg-btn${st.quality === id ? ' on' : ''}`, text: label,
        onClick: () => { g.setQuality(id); q.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.textContent === label)); this.onSettingsChanged?.(); },
      }));
    }
    body.appendChild(h('div', { class: 'field row' }, h('span', { class: 'field-label', text: 'Graphics' }), q));
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
      ['Collect', 'Machines fill up with cash (floating coin). Walk next to them to scoop it up. Full machines stop paying.'],
      ['Act', 'Space or F: hold to fix broken machines, bust cheaters (red ?), greet VIPs (gold star), comp grumpy guests.'],
      ['Camera', 'Q / E rotates, mouse wheel or pinch zooms.'],
      ['Edit', 'Click any machine to upgrade, move, rotate, recolor or sell it. Use Floor to paint carpets.'],
      ['Rating', 'Happy guests, decorations, game variety and a clean floor raise your stars. More stars bring more guests and VIPs.'],
      ['Staff', 'Janitors sweep, technicians repair, cashiers collect cash, security catches cheaters. Wages are paid daily.'],
      ['Emotes', 'Press 1–4 to wave, dance, cheer or clap.'],
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
    const lines: [string, number][] = [
      ['Bets taken', r.revenue],
      ['Payouts to guests', -r.payouts],
      ['Bar, snacks & ATM', r.sales],
      ['Staff wages', -r.wages],
      ['Upkeep', -r.upkeep],
    ];
    const card = h('div', { class: 'day-card' },
      h('div', { class: 'day-title', text: `Day ${r.day} closed` }),
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
