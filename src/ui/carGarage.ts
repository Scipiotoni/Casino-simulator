import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Game } from '../game/game';
import type { Modals } from './modals';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import {
  type CarMods, DECALS, FINISHES, GLOWS, GLOW_PRICE, PAINTS, PAINT_PRICE, PLATE_PRICE, RIMS, RIM_COLORS, RIM_COLOR_PRICE, SPOILERS, TINTS, TUNING,
  buildCar, carDef, tunedSpecs,
} from '../world/vehicles';
import { modsOf } from '../game/driving';

/** A slowly turning 3D view of the car you're working on. */
class CarPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 2, 0.1, 60);
  private car: THREE.Object3D | null = null;
  private turntable = new THREE.Group();
  private raf = 0;
  private yaw = 0.7;
  private drag: { x: number; yaw: number } | null = null;

  constructor() {
    this.canvas = h('canvas', { class: 'car-preview' }) as HTMLCanvasElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.35;
      pm.dispose();
    } catch {
      this.renderer = null;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a4a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshStandardMaterial({ color: 0x23202e, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    this.turntable.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.04, 6, 64), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
    ring.rotation.x = Math.PI / 2;
    this.turntable.add(ring);
    this.scene.add(this.turntable);
    this.camera.position.set(0, 2.4, 8.4);
    this.camera.lookAt(0, 0.6, 0);
    this.canvas.addEventListener('pointerdown', (e) => (this.drag = { x: e.clientX, yaw: this.yaw }));
    window.addEventListener('pointermove', (e) => {
      if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
    });
    window.addEventListener('pointerup', () => (this.drag = null));
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.drag) this.yaw += 0.006;
      this.turntable.rotation.y = this.yaw;
      this.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  show(obj: THREE.Object3D, length: number): void {
    if (this.car) {
      this.car.removeFromParent();
      this.car.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.car = obj;
    this.turntable.add(obj);
    this.camera.position.set(0, 1.6 + length * 0.18, 3.2 + length * 1.15);
    this.camera.lookAt(0, 0.6, 0);
  }

  private render(): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth || 420;
    const hgt = this.canvas.clientHeight || 220;
    if (this.canvas.width !== Math.round(w * r.getPixelRatio())) {
      r.setSize(w, hgt, false);
      this.camera.aspect = w / hgt;
      this.camera.updateProjectionMatrix();
    }
    r.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }
}

/**
 * The tuning garage for one of your cars: paint and finish, rims, window tint, underglow,
 * spoilers, decals and plates, plus engine, turbo, tires, brakes and nitro. Every change
 * shows up on the turning car right away and is paid for as you pick it.
 */
export function openCustomize(game: Game, modals: Modals, id: string): void {
  const g = game;
  const def = carDef(id);
  if (!def || !g.garage.owned.includes(id)) return;
  const m = modsOf(g.garage, id);
  const preview = new CarPreview();
  const statsEl = h('div', { class: 'cg-stats' });
  const body = h('div', { class: 'stack car-garage' });
  const panel = h('div', { class: 'cg-panel' });
  let tab: 'paint' | 'wheels' | 'body' | 'tuning' = 'paint';
  const tabs = h('div', { class: 'tabs' });

  const refreshCar = () => {
    const car = buildCar(def, undefined, m);
    preview.show(car.root, car.length);
    const sp = tunedSpecs(def, m);
    statsEl.replaceChildren(
      stat('Top speed', `${Math.round(sp.top * 3.6)} km/h`, sp.top / 60),
      stat('0–100', `${(27.8 / sp.accel).toFixed(1)} s`, sp.accel / 30),
      stat('Grip', `${sp.grip.toFixed(2)}`, sp.grip / 1.8),
      stat('Brakes', `${Math.round(sp.brake * 100)}%`, sp.brake / 2),
      stat('Nitro', sp.nitro ? `Stage ${sp.nitro}` : 'None', sp.nitro / 3),
    );
  };
  const stat = (label: string, value: string, k: number) =>
    h('div', { class: 'cg-stat' }, h('span', { text: label }), h('div', { class: 'cg-bar' }, h('i', { style: `width:${Math.min(100, Math.max(4, k * 100)).toFixed(0)}%` })), h('b', { text: value }));

  /** Pay for a change and apply it (free if it's what you already have). */
  const buy = (price: number, apply: () => void, same: boolean) => {
    if (same) return;
    if (price > 0 && g.money < price) {
      audio.play('error');
      g.notify(`That costs ${formatMoney(price)}.`, 'bad');
      return;
    }
    if (price > 0) g.spend(price, 'purchase');
    apply();
    audio.play(price > 0 ? 'cash' : 'click');
    g.drive.refresh(id);
    g.requestSave();
    refreshCar();
    render();
  };

  const chips = <T,>(label: string, list: { id: T; name: string; price: number }[], cur: T, set: (v: T) => void) => {
    const row = h('div', { class: 'cg-chips' });
    for (const o of list) {
      row.appendChild(h('button', {
        class: `chip-btn${o.id === cur ? ' on' : ''}`,
        html: `${o.name}${o.price && o.id !== cur ? ` <small>${formatMoney(o.price)}</small>` : ''}`,
        onClick: () => buy(o.price, () => set(o.id), o.id === cur),
      }));
    }
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), row);
  };
  const colors = (label: string, list: number[], cur: number, price: number, set: (c: number) => void, none = false) => {
    const row = h('div', { class: 'cg-colors' });
    for (const c of list) {
      row.appendChild(h('button', {
        class: `car-sw big${c === cur ? ' on' : ''}${c === 0 && none ? ' none' : ''}`,
        style: c === 0 && none ? '' : `background:#${c.toString(16).padStart(6, '0')}`,
        title: c === 0 && none ? 'None' : formatMoney(price), 'aria-label': 'Colour',
        onClick: () => buy(c === 0 && none ? 0 : price, () => set(c), c === cur),
      }));
    }
    return h('div', { class: 'field' }, h('span', { class: 'field-label', html: `${label} <small class="muted">${formatMoney(price)}</small>` }), row);
  };

  const render = () => {
    clear(panel);
    if (tab === 'paint') {
      panel.append(
        colors('Paint', PAINTS, m.color, PAINT_PRICE, (c) => (m.color = c)),
        chips('Finish', FINISHES, m.finish, (v) => (m.finish = v)),
        chips('Decals', DECALS, m.decal, (v) => (m.decal = v)),
        colors('Decal colour', [0xf4f1ea, 0x17151f, 0xc8102e, 0xffc53d, 0x2fe6ff, 0x39ff88, 0xff6fb5, 0x6a2cc2], m.decalColor, 300, (c) => (m.decalColor = c)),
      );
    } else if (tab === 'wheels') {
      panel.append(
        chips('Rims', RIMS, m.rims, (v) => (m.rims = v)),
        colors('Rim colour', RIM_COLORS, m.rimColor, RIM_COLOR_PRICE, (c) => (m.rimColor = c)),
      );
    } else if (tab === 'body') {
      const plate = h('input', { class: 'text-input', type: 'text', maxLength: 8, value: m.plate, 'aria-label': 'Plate text' }) as HTMLInputElement;
      plate.addEventListener('keydown', (e) => e.stopPropagation());
      panel.append(
        chips('Spoiler', SPOILERS, m.spoiler, (v) => (m.spoiler = v)),
        chips('Window tint', TINTS, m.tint, (v) => (m.tint = v)),
        colors('Underglow', GLOWS, m.glow, GLOW_PRICE, (c) => (m.glow = c), true),
        h('div', { class: 'field' }, h('span', { class: 'field-label', html: `Number plate <small class="muted">${formatMoney(PLATE_PRICE)}</small>` }),
          h('div', { class: 'cg-chips' }, plate, h('button', {
            class: 'btn small', text: 'Set plate',
            onClick: () => {
              const v = plate.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 8);
              buy(PLATE_PRICE, () => (m.plate = v), v === m.plate);
            },
          }))),
      );
    } else {
      for (const t of TUNING) {
        const cur = m[t.id];
        const row = h('div', { class: 'cg-tune' },
          h('div', {}, h('b', { text: t.name }), h('div', { class: 'muted small', text: t.blurb })),
          h('div', { class: 'cg-pips' }, ...Array.from({ length: t.levels }, (_, i) => h('i', { class: i < cur ? 'on' : '' }))),
          cur >= t.levels
            ? h('span', { class: 'chip good', text: 'Maxed' })
            : h('button', { class: 'btn small gold', html: `Stage ${cur + 1} <b>${formatMoney(t.prices[cur])}</b>`, onClick: () => buy(t.prices[cur], () => (m[t.id] = cur + 1), false) }),
        );
        panel.appendChild(row);
      }
      panel.appendChild(h('p', { class: 'muted small', text: 'Nitro: hold Shift while driving for a blue-flame boost. The tank refills by itself.' }));
    }
    tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === tab));
  };
  for (const [id2, label] of [['paint', '🎨 Paint'], ['wheels', '🛞 Wheels'], ['body', '🔧 Body'], ['tuning', '🏁 Tuning']] as const) {
    const b = h('button', { class: 'tab', text: label, onClick: () => { tab = id2; render(); audio.play('click'); } });
    b.dataset.tab = id2;
    tabs.appendChild(b);
  }
  body.append(preview.canvas, statsEl, tabs, panel,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn gold', text: '🚗 Bring it here', onClick: () => { if (g.drive.bring(id)) modals.closeAll(); } })));
  refreshCar();
  render();
  const off = g.events.on('money', () => render());
  modals.open(`${def.name} · Tuning garage`, body, { wide: true, onClose: () => { off(); preview.dispose(); } });
}

/** Mods as one line of text (for the car list). */
export function modsSummary(m: CarMods): string {
  const parts: string[] = [];
  const perf = m.engine + m.turbo + m.tires + m.brakes + m.nitro;
  if (perf) parts.push(`${perf} upgrades`);
  if (m.finish !== 'gloss') parts.push(m.finish);
  if (m.glow) parts.push('underglow');
  if (m.spoiler !== 'none') parts.push(m.spoiler);
  return parts.join(' · ');
}
