import { h, clear, icon, swatch } from './dom';
import {
  type Appearance, BODY_SHAPES, BOTTOM_STYLES, CLOTH_COLORS, EYE_STYLES, EYEWEAR, FACIAL_HAIR, FANTASY_SKINS, HAIR_COLORS,
  HAIR_STYLES, HAT_STYLES, NECKWEAR, PLAYER_PRESETS, PROPS, SKIN_TONES, TOP_STYLES, applyUniform, defaultAppearance,
  randomPlayerAppearance,
} from '../entities/appearance';
import type { WorkerRole } from '../entities/staff';
import { characterPreview } from './preview';
import { audio } from '../core/audio';

type Tab = 'body' | 'hair' | 'face' | 'outfit' | 'extras';

/** Full character editor with a live, spinning 3D preview. */
export class CharacterCreator {
  readonly el: HTMLElement;
  look: Appearance;
  name: string;
  private tab: Tab = 'outfit';
  private body!: HTMLElement;
  private tabBtns: HTMLButtonElement[] = [];
  private previewBox!: HTMLElement;
  private ro: ResizeObserver | null = null;

  constructor(start: Appearance, name: string, private opts: { role: WorkerRole | null; nameLabel?: string }) {
    this.look = { ...defaultAppearance(), ...start };
    this.name = name;
    if (opts.role) this.tab = 'body';
    this.el = this.build();
  }

  private get worker(): boolean {
    return this.opts.role !== null;
  }

  private preview(): Appearance {
    return this.opts.role ? applyUniform(this.look, this.opts.role) : this.look;
  }

  private build(): HTMLElement {
    const p = characterPreview();
    this.previewBox = h('div', { class: 'creator-preview' });
    const previewButtons = h('div', { class: 'creator-pbtns' },
      h('button', { class: 'btn small', html: `${icon('dice', 16)} Randomize`, onClick: () => this.randomize() }),
      h('button', { class: 'btn small', html: `${icon('wave', 16)} Say hi`, onClick: () => { p.react(); audio.play('pop'); } }),
    );
    const nameInput = h('input', { class: 'text-input', id: 'creator-name', type: 'text', value: this.name, maxLength: 18, placeholder: 'Name' });
    nameInput.addEventListener('input', () => (this.name = nameInput.value.trim()));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const list: [Tab, string][] = this.worker
      ? [['body', 'Body'], ['hair', 'Hair'], ['face', 'Face']]
      : [['outfit', 'Outfit'], ['body', 'Body'], ['hair', 'Hair'], ['face', 'Face'], ['extras', 'Extras']];
    for (const [id, label] of list) {
      const b = h('button', { class: 'tab', role: 'tab', text: label, onClick: () => { this.tab = id; this.renderTab(); audio.play('click'); } });
      b.dataset.tab = id;
      this.tabBtns.push(b);
      tabs.appendChild(b);
    }
    this.body = h('div', { class: 'creator-body' });
    const presets = this.worker
      ? null
      : h('div', { class: 'presets' },
        ...PLAYER_PRESETS.map((pr) => h('button', { class: 'chip-btn', text: pr.name, onClick: () => { this.look = { ...this.look, ...pr.look }; this.update(); characterPreview().react(); audio.play('pop'); } })),
      );
    const controls = h('div', { class: 'creator-controls' },
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: this.opts.nameLabel ?? (this.worker ? 'Name' : 'Manager name') }), nameInput),
      presets ? h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Quick looks' }), presets) : null,
      tabs,
      this.body,
    );
    const root = h('div', { class: 'creator' }, h('div', { class: 'creator-left' }, this.previewBox, previewButtons), controls);
    this.renderTab();
    return root;
  }

  /** Attach the shared preview canvas once the element is in the DOM. */
  mount(): void {
    const p = characterPreview();
    this.previewBox.appendChild(p.canvas);
    const fit = () => {
      const r = this.previewBox.getBoundingClientRect();
      p.resize(Math.max(120, r.width), Math.max(160, r.height));
    };
    fit();
    this.ro = new ResizeObserver(fit);
    this.ro.observe(this.previewBox);
    p.show(this.preview());
    p.start();
  }

  dispose(): void {
    characterPreview().stop();
    this.ro?.disconnect();
  }

  private update(): void {
    characterPreview().show(this.preview());
    this.renderTab();
  }

  private randomize(): void {
    const r = randomPlayerAppearance();
    this.look = this.worker ? { ...this.look, skin: r.skin, hair: r.hair, hairColor: r.hairColor, eyes: r.eyes, facialHair: r.facialHair, body: r.body, blush: r.blush } : r;
    this.update();
    characterPreview().react();
    audio.play('dice');
  }

  private chips<T extends string>(label: string, options: { id: T; label: string }[], get: () => T, set: (v: T) => void): HTMLElement {
    const row = h('div', { class: 'chips' });
    for (const o of options) {
      row.appendChild(h('button', {
        class: `chip-btn${get() === o.id ? ' on' : ''}`, text: o.label, 'aria-pressed': get() === o.id ? 'true' : 'false',
        onClick: () => { set(o.id); this.update(); audio.play('click'); },
      }));
    }
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row);
  }

  private colors(label: string, palette: number[], get: () => number, set: (v: number) => void): HTMLElement {
    const row = h('div', { class: 'swatch-row' });
    for (const c of palette) {
      row.appendChild(h('button', {
        class: `color-sw${get() === c ? ' on' : ''}`, style: `background:${swatch(c)}`, 'aria-label': `${label} ${swatch(c)}`,
        onClick: () => { set(c); this.update(); audio.play('click'); },
      }));
    }
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row);
  }

  private renderTab(): void {
    this.tabBtns.forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const scroll = this.body.scrollTop;
    clear(this.body);
    const a = this.look;
    const set = <K extends keyof Appearance>(k: K) => (v: Appearance[K]) => {
      this.look = { ...this.look, [k]: v };
    };
    switch (this.tab) {
      case 'body':
        this.body.append(
          this.colors('Skin tone', [...SKIN_TONES, ...FANTASY_SKINS], () => a.skin, set('skin')),
          this.chips('Build', BODY_SHAPES, () => a.body, set('body')),
          this.chips('Rosy cheeks', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], () => (a.blush ? 'yes' : 'no'), (v) => set('blush')(v === 'yes')),
        );
        break;
      case 'hair':
        this.body.append(
          this.chips('Hairstyle', HAIR_STYLES, () => a.hair, set('hair')),
          this.colors('Hair color', HAIR_COLORS, () => a.hairColor, set('hairColor')),
        );
        break;
      case 'face': {
        const parts = [
          this.chips('Eyes', EYE_STYLES, () => a.eyes, set('eyes')),
          this.chips('Facial hair', FACIAL_HAIR, () => a.facialHair, set('facialHair')),
        ];
        if (!this.worker) parts.push(this.chips('Eyewear', EYEWEAR, () => a.eyewear, set('eyewear')));
        this.body.append(...parts);
        break;
      }
      case 'outfit':
        this.body.append(
          this.chips('Top', TOP_STYLES, () => a.top, set('top')),
          this.colors('Top color', CLOTH_COLORS, () => a.topColor, set('topColor')),
          this.colors('Shirt / accent', CLOTH_COLORS, () => a.accentColor, set('accentColor')),
          this.chips('Bottom', BOTTOM_STYLES, () => a.bottom, set('bottom')),
          this.colors('Bottom color', CLOTH_COLORS, () => a.bottomColor, set('bottomColor')),
          this.colors('Shoes', CLOTH_COLORS, () => a.shoeColor, set('shoeColor')),
        );
        break;
      case 'extras':
        this.body.append(
          this.chips('Hat', HAT_STYLES, () => a.hat, set('hat')),
          this.colors('Hat color', CLOTH_COLORS, () => a.hatColor, set('hatColor')),
          this.chips('Neck', NECKWEAR, () => a.neck, set('neck')),
          this.colors('Neck color', CLOTH_COLORS, () => a.neckColor, set('neckColor')),
          this.chips('In hand', PROPS, () => a.prop, set('prop')),
        );
        break;
    }
    this.body.scrollTop = scroll;
  }
}
