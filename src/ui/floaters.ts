import * as THREE from 'three';
import { formatMoney } from '../core/math';

type Anchor = THREE.Vector3 | (() => THREE.Vector3 | null);

interface Floater {
  el: HTMLElement;
  anchor: Anchor;
  offsetY: number;
  rise: number;
  life: number;
  max: number;
  kind: string;
}

const tmp = new THREE.Vector3();

/**
 * World-anchored DOM labels: money popups, speech bubbles, prompts and progress rings.
 * They are projected every frame so text stays crisp at any zoom.
 */
export class Floaters {
  readonly root: HTMLElement;
  private list: Floater[] = [];
  private pool = new Map<string, HTMLElement[]>();
  private promptEl: HTMLElement;
  private promptAnchor: Anchor | null = null;
  private ringEl: HTMLElement;
  private ringAnchor: Anchor | null = null;
  private ringValue = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'floaters';
    parent.appendChild(this.root);
    this.promptEl = document.createElement('div');
    this.promptEl.className = 'fl-prompt';
    this.promptEl.hidden = true;
    this.root.appendChild(this.promptEl);
    this.ringEl = document.createElement('div');
    this.ringEl.className = 'fl-ring';
    this.ringEl.innerHTML = '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg"/></svg>';
    this.ringEl.hidden = true;
    this.root.appendChild(this.ringEl);
  }

  private take(kind: string): HTMLElement {
    const list = this.pool.get(kind);
    const el = list?.pop() ?? document.createElement('div');
    el.className = `fl fl-${kind}`;
    el.style.opacity = '1';
    this.root.appendChild(el);
    return el;
  }

  private add(kind: string, anchor: Anchor, html: string, life: number, rise: number, offsetY: number): HTMLElement {
    // Keep the overlay light: drop the oldest popups when too many pile up.
    if (this.list.length > 60) this.retire(0);
    const el = this.take(kind);
    el.innerHTML = html;
    this.list.push({ el, anchor, offsetY, rise, life: 0, max: life, kind });
    return el;
  }

  private retire(i: number): void {
    const f = this.list[i];
    f.el.remove();
    const arr = this.pool.get(f.kind) ?? [];
    arr.push(f.el);
    this.pool.set(f.kind, arr);
    this.list.splice(i, 1);
  }

  /** Set while simulating something the camera can't see (another floor, a hidden interior). */
  muted = false;

  money(pos: THREE.Vector3, amount: number, big = false): void {
    if (this.muted) return;
    const cls = amount >= 0 ? 'pos' : 'neg';
    const text = `${amount >= 0 ? '+' : ''}${formatMoney(amount)}`;
    const el = this.add('money', pos.clone(), `<span class="${cls}${big ? ' big' : ''}">${text}</span>`, big ? 2.2 : 1.4, big ? 1.6 : 1.1, 0);
    el.dataset.big = big ? '1' : '';
  }

  text(pos: Anchor, text: string, cls = '', life = 1.8, rise = 0.9): void {
    if (this.muted) return;
    const anchor = typeof pos === 'function' ? pos : pos.clone();
    this.add('text', anchor, `<span class="${cls}">${escapeHtml(text)}</span>`, life, rise, 0);
  }

  bubble(anchor: Anchor, content: string, life = 2.2): void {
    if (this.muted) return;
    this.add('bubble', anchor, `<span>${escapeHtml(content)}</span>`, life, 0.15, 0);
  }

  prompt(anchor: Anchor | null, label: string): void {
    this.promptAnchor = anchor;
    if (!anchor) {
      this.promptEl.hidden = true;
      return;
    }
    if (this.promptEl.dataset.label !== label) {
      this.promptEl.dataset.label = label;
      this.promptEl.innerHTML = label;
    }
    this.promptEl.hidden = false;
  }

  ring(anchor: Anchor | null, value: number): void {
    this.ringAnchor = anchor;
    this.ringValue = value;
    this.ringEl.hidden = !anchor;
  }

  clear(): void {
    while (this.list.length) this.retire(this.list.length - 1);
    this.prompt(null, '');
    this.ring(null, 0);
  }

  private project(anchor: Anchor, camera: THREE.Camera, w: number, h: number, dy = 0): { x: number; y: number; ok: boolean } {
    const v = typeof anchor === 'function' ? anchor() : anchor;
    if (!v) return { x: 0, y: 0, ok: false };
    tmp.copy(v);
    tmp.y += dy;
    tmp.project(camera);
    if (tmp.z > 1) return { x: 0, y: 0, ok: false };
    return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, ok: true };
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life += dt;
      if (f.life >= f.max) {
        this.retire(i);
        continue;
      }
      const u = f.life / f.max;
      const p = this.project(f.anchor, camera, w, h, f.offsetY + f.rise * (1 - Math.pow(1 - u, 2)));
      if (!p.ok) {
        f.el.style.opacity = '0';
        continue;
      }
      const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      const pop = u < 0.12 ? 0.6 + (u / 0.12) * 0.5 : u < 0.2 ? 1.1 - ((u - 0.12) / 0.08) * 0.1 : 1;
      f.el.style.opacity = fade.toFixed(3);
      f.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) scale(${pop.toFixed(3)})`;
    }
    if (this.promptAnchor) {
      const p = this.project(this.promptAnchor, camera, w, h);
      this.promptEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      this.promptEl.hidden = !p.ok;
    }
    if (this.ringAnchor) {
      const p = this.project(this.ringAnchor, camera, w, h);
      this.ringEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      const fg = this.ringEl.querySelector('.fg') as SVGCircleElement;
      const c = 2 * Math.PI * 15;
      fg.style.strokeDasharray = `${c}`;
      fg.style.strokeDashoffset = `${c * (1 - this.ringValue)}`;
      this.ringEl.hidden = !p.ok;
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
