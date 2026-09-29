import { h, clear, icon, swatch } from './dom';
import type { Game, SaveData } from '../game/game';
import { NEON_COLORS, SIGN_FONTS, WALL_COLORS, type CasinoLook } from '../world/building';
import { drawNeonText, roundRect } from '../render/textures';
import { CharacterCreator } from './creator';
import { defaultAppearance } from '../entities/appearance';
import { audio } from '../core/audio';
import { formatMoney } from '../core/math';

const NAME_IDEAS = ['Lucky Star Casino', 'The Golden Ace', 'Neon Nights', 'Royal Flush Palace', 'Diamond Dunes', 'Club Jackpot', 'The High Roller', 'Starlight Casino'];

/** Title screen and the two-step "open your casino" wizard. */
export class TitleScreen {
  readonly el: HTMLElement;
  private card: HTMLElement;
  onStart: ((opts: { name: string; look: CasinoLook; player: ReturnType<typeof defaultAppearance>; playerName: string }) => void) | null = null;
  onContinue: (() => void) | null = null;
  onHelp: (() => void) | null = null;
  confirm: ((title: string, text: string, ok: string, fn: () => void) => void) | null = null;
  private creator: CharacterCreator | null = null;

  constructor(parent: HTMLElement, private game: Game, private save: () => SaveData | null) {
    this.card = h('div', { class: 'title-card' });
    this.el = h('div', { class: 'title-screen' }, this.card);
    parent.appendChild(this.el);
  }

  show(): void {
    this.el.hidden = false;
    this.renderHome();
  }

  hide(): void {
    this.creator?.dispose();
    this.creator = null;
    this.el.classList.add('leaving');
    window.setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove('leaving');
    }, 450);
  }

  private renderHome(): void {
    clear(this.card);
    this.card.className = 'title-card home';
    const save = this.save();
    const logo = h('h1', { class: 'logo', 'aria-label': 'Jackpot Tycoon' },
      h('span', { class: 'logo-top', text: 'JACKPOT' }),
      h('span', { class: 'logo-bottom', text: 'Tycoon' }),
    );
    const buttons = h('div', { class: 'title-buttons' });
    if (save) {
      buttons.appendChild(h('button', {
        class: 'btn gold big', onClick: () => { audio.unlock(); audio.play('purchase'); this.onContinue?.(); },
      }, h('span', { class: 'btn-main', text: 'Continue' }), h('span', { class: 'btn-sub', text: `${save.name} · Day ${save.day} · ${formatMoney(save.money)}` })));
    }
    const startNew = () => {
      audio.unlock();
      audio.play('pop');
      if (save && this.confirm) this.confirm('Start a new casino?', `This replaces ${save.name} and its save once you open the doors.`, 'Start fresh', () => this.renderStep1());
      else this.renderStep1();
    };
    buttons.appendChild(h('button', { class: `btn ${save ? '' : 'gold '}big`, onClick: startNew },
      h('span', { class: 'btn-main', text: save ? 'New casino' : 'Open your casino' }), h('span', { class: 'btn-sub', text: 'Name it, style it, build it' })));
    buttons.appendChild(h('button', { class: 'btn ghost', html: `${icon('help', 16)} How to play`, onClick: () => { audio.unlock(); this.onHelp?.(); } }));
    this.card.append(
      logo,
      h('p', { class: 'tagline', text: 'Buy machines, place them anywhere, keep your guests happy and build the flashiest casino on the Strip.' }),
      buttons,
      h('div', { class: 'title-foot', text: 'Desktop: WASD + mouse · Phone: drag to walk, tap to build · Sound on' }),
    );
  }

  private renderStep1(): void {
    clear(this.card);
    this.card.className = 'title-card wizard';
    const look: CasinoLook = { ...this.game.building.look };
    look.name = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];
    look.wallColor = WALL_COLORS[0];
    const canvas = h('canvas', { class: 'sign-preview' }) as HTMLCanvasElement;
    canvas.width = 720;
    canvas.height = 220;
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1c0b30');
      g.addColorStop(1, '#0b0414');
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, W, H, 26);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 210, 110, 0.6)';
      ctx.lineWidth = 5;
      roundRect(ctx, 10, 10, W - 20, H - 20, 20);
      ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const t = Date.now() / 120;
        ctx.fillStyle = (i + Math.floor(t)) % 3 === 0 ? '#6b5a3a' : '#fff1b8';
        ctx.beginPath();
        ctx.arc(24 + i * ((W - 48) / 25), 22, 5, 0, Math.PI * 2);
        ctx.arc(24 + i * ((W - 48) / 25), H - 22, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      const font = SIGN_FONTS.find((f) => f.id === look.signFont) ?? SIGN_FONTS[0];
      ctx.font = '400 24px Bungee, "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText('★  WELCOME TO  ★', W / 2, 62);
      drawNeonText(ctx, look.name || 'My Casino', W / 2, H * 0.6, W - 80, font.id === 'pacifico' ? 84 : 76, font.css, swatch(look.signColor), font.weight);
    };
    let raf = 0;
    const loop = () => {
      if (!canvas.isConnected) return;
      draw();
      raf = window.setTimeout(loop, 120);
    };
    const nameInput = h('input', { class: 'text-input big', id: 'wizard-name', type: 'text', value: look.name, maxLength: 26, placeholder: 'Casino name' });
    nameInput.addEventListener('input', () => {
      look.name = nameInput.value;
      draw();
    });
    const fonts = h('div', { class: 'chips' });
    const renderFonts = () => {
      clear(fonts);
      for (const f of SIGN_FONTS) {
        fonts.appendChild(h('button', {
          class: `chip-btn${look.signFont === f.id ? ' on' : ''}`, style: `font-family:${f.css};font-weight:${f.weight}`, text: f.label,
          onClick: () => { look.signFont = f.id; renderFonts(); draw(); audio.play('click'); },
        }));
      }
    };
    renderFonts();
    const colors = (label: string, list: number[], get: () => number, set: (c: number) => void) => {
      const row = h('div', { class: 'swatch-row' });
      const render = () => {
        clear(row);
        for (const c of list) row.appendChild(h('button', { class: `color-sw${get() === c ? ' on' : ''}`, style: `background:${swatch(c)}`, 'aria-label': `${label} ${swatch(c)}`, onClick: () => { set(c); render(); draw(); audio.play('click'); } }));
      };
      render();
      return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row);
    };
    this.card.append(
      h('div', { class: 'wizard-step', text: 'Step 1 of 2' }),
      h('h2', { class: 'wizard-title', text: 'Name your casino' }),
      canvas,
      h('div', { class: 'field' },
        h('div', { class: 'name-row' }, nameInput, h('button', { class: 'btn', html: icon('dice', 18), 'aria-label': 'Random name', onClick: () => { look.name = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]; nameInput.value = look.name; draw(); audio.play('dice'); } }))),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Sign lettering' }), fonts),
      colors('Sign color', NEON_COLORS, () => look.signColor, (c) => (look.signColor = c)),
      colors('Wall color', WALL_COLORS, () => look.wallColor, (c) => (look.wallColor = c)),
      colors('Neon trim', NEON_COLORS, () => look.trimColor, (c) => (look.trimColor = c)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: 'Back', onClick: () => { window.clearTimeout(raf); this.renderHome(); } }),
        h('button', { class: 'btn gold', html: `Next: your manager ${icon('play', 14)}`, onClick: () => { window.clearTimeout(raf); look.name = look.name.trim() || 'My Casino'; this.renderStep2(look); audio.play('pop'); } }),
      ),
    );
    loop();
  }

  private renderStep2(look: CasinoLook): void {
    clear(this.card);
    this.card.className = 'title-card wizard wide';
    const creator = new CharacterCreator(defaultAppearance(), 'Boss', { role: null });
    this.creator = creator;
    this.card.append(
      h('div', { class: 'wizard-step', text: 'Step 2 of 2' }),
      h('h2', { class: 'wizard-title', text: 'Create your manager' }),
      creator.el,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: 'Back', onClick: () => { creator.dispose(); this.creator = null; this.renderStep1(); } }),
        h('button', {
          class: 'btn gold big-ish', html: `${icon('casino', 18)} Open the doors!`,
          onClick: () => {
            creator.dispose();
            this.creator = null;
            audio.play('levelup');
            this.onStart?.({ name: look.name, look, player: creator.look, playerName: creator.name || 'Boss' });
          },
        }),
      ),
    );
    creator.mount();
  }
}
