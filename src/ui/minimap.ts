import type { Game } from '../game/game';
import { h } from './dom';
import { audio } from '../core/audio';
import { CENTER_X, DEPTH_STEP, DOOR_TILES, FACADE_Z, ROAD_MID, SIDEWALK_Z0, START_DEPTH, WIDTHS } from '../world/grid';
import { STREET_Z0, STREET_Z1, type StreetLot } from '../world/street';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Live map of the street (both sides of the road). Shows every casino, you and the other
 * players; click the sidewalk or road to teleport there, or a casino to land at its door.
 */
export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private big = false;
  private t = 0;
  /** Current view: global x/z of the canvas's left/top edge and pixels per tile. */
  private view = { x0: 0, z0: 0, s: 1 };

  constructor(private game: Game) {
    this.canvas = h('canvas', { class: 'mm-canvas', 'aria-label': 'Street map: click to teleport' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const toggle = h('button', {
      class: 'mm-toggle', text: '⤢', title: 'Bigger map (M)', 'aria-label': 'Toggle big map',
      onClick: (e: Event) => {
        e.stopPropagation();
        this.setBig(!this.big);
      },
    });
    this.el = h('div', { class: 'minimap' }, h('div', { class: 'mm-head' }, h('span', { text: 'STREET MAP' }), toggle), this.canvas);
    this.canvas.addEventListener('click', (e) => this.click(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) this.setBig(!this.big);
    });
  }

  setBig(on: boolean): void {
    this.big = on;
    this.el.classList.toggle('big', on);
    audio.play('click');
    this.t = 0;
  }

  private lotRect(lot: StreetLot): { x0: number; z0: number; x1: number; z1: number } {
    const st = this.game.street;
    const w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, lot.info.width))].w;
    const d = START_DEPTH + Math.max(0, lot.info.depth) * DEPTH_STEP;
    const a = st.toGlobal(lot.id, CENTER_X - w / 2, FACADE_Z - d);
    const b = st.toGlobal(lot.id, CENTER_X + w / 2, FACADE_Z);
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
  }

  private click(e: MouseEvent): void {
    const g = this.game;
    const r = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * this.canvas.width;
    const pz = ((e.clientY - r.top) / r.height) * this.canvas.height;
    const gx = this.view.x0 + px / this.view.s;
    const gz = this.view.z0 + pz / this.view.s;
    // A casino: land on the sidewalk right outside its door.
    const lot = g.street.lots.find((l) => {
      const b = this.lotRect(l);
      return gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1;
    });
    let ok: boolean;
    if (lot) {
      const d = g.street.toGlobal(lot.id, CENTER_X + 0.1, SIDEWALK_Z0 + 1.6);
      ok = g.teleportTo(d.x, d.z);
    } else ok = g.teleportTo(gx, gz);
    if (!ok) {
      audio.play('error');
      g.notify('You can only teleport onto the sidewalk or the road, never inside a casino.', 'bad');
    }
  }

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0 || this.el.hidden) return;
    this.t = 1 / 15;
    this.draw();
  }

  private draw(): void {
    const g = this.game;
    const st = g.street;
    const cv = this.canvas;
    const cssW = this.big ? Math.min(window.innerWidth - 32, 760) : 210;
    const cssH = this.big ? Math.min(window.innerHeight * 0.6, 420) : 150;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      cv.style.width = `${cssW}px`;
      cv.style.height = `${cssH}px`;
    }
    const c = this.ctx;
    const W = cv.width;
    const H = cv.height;
    const me = st.worldToGlobal(g.player.x, g.player.z);
    // Scale: the whole street when big (if it fits), about two lots either side when small.
    const [ex0, ex1] = st.extent;
    const span = this.big ? Math.max(ex1 - ex0 + 8, 60) : 100;
    const s = Math.max(W / span, H / 110);
    const viewW = W / s;
    let x0 = me.x - viewW / 2;
    if (ex1 - ex0 + 8 <= viewW) x0 = (ex0 + ex1) / 2 - viewW / 2;
    else x0 = Math.max(ex0 - 4, Math.min(ex1 + 4 - viewW, x0));
    const z0 = ROAD_MID - H / s / 2;
    this.view = { x0, z0, s };
    const X = (x: number) => (x - x0) * s;
    const Z = (z: number) => (z - z0) * s;

    c.fillStyle = '#1b1726';
    c.fillRect(0, 0, W, H);
    // Sidewalks and road
    c.fillStyle = '#6d6878';
    c.fillRect(X(ex0), Z(STREET_Z0), (ex1 - ex0) * s, (STREET_Z1 + 1 - STREET_Z0) * s);
    c.fillStyle = '#34313d';
    c.fillRect(X(ex0), Z(SIDEWALK_Z0 + 4.1), (ex1 - ex0) * s, (2 * ROAD_MID - 2 * (SIDEWALK_Z0 + 4.1)) * s);
    c.strokeStyle = '#ffd23f';
    c.lineWidth = Math.max(1, s * 0.15);
    c.setLineDash([s * 1.4, s * 1.6]);
    c.beginPath();
    c.moveTo(X(ex0), Z(ROAD_MID));
    c.lineTo(X(ex1), Z(ROAD_MID));
    c.stroke();
    c.setLineDash([]);

    // Casinos
    const font = Math.max(9, Math.min(15, s * 1.6));
    c.font = `800 ${font}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const lot of st.lots) {
      const b = this.lotRect(lot);
      if (X(b.x1) < 0 || X(b.x0) > W) continue;
      c.fillStyle = hex(lot.info.look.wallColor ?? 0x6a2cc2);
      c.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
      c.strokeStyle = lot.id === 'me' ? '#ffc53d' : lot.kind === 'rival' ? '#ff4d6d' : 'rgba(255,255,255,0.5)';
      c.lineWidth = lot.id === 'me' ? 3 : 1.5;
      c.strokeRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
      // Door
      const d = st.toGlobal(lot.id, DOOR_TILES[0][0] + 1, FACADE_Z + 0.5);
      c.fillStyle = '#ffe9b0';
      c.fillRect(X(d.x) - s, Z(d.z) - s * 0.5, s * 2, s);
      // Name (inside the building, near the facade)
      const north = st.placeOf(lot.id).side === 0;
      const ty = north ? Z(b.z1) - font * 0.9 : Z(b.z0) + font * 0.9;
      const name = `${lot.id === 'me' ? '★ ' : ''}${lot.info.look.name}`;
      c.fillStyle = '#fff';
      c.shadowColor = 'rgba(0,0,0,0.8)';
      c.shadowBlur = 3;
      const maxW = (b.x1 - b.x0) * s - 4;
      let label = name;
      while (label.length > 3 && c.measureText(label).width > maxW) label = label.slice(0, -2);
      if (label !== name) label += '…';
      c.fillText(label, X((b.x0 + b.x1) / 2), ty);
      if (lot.kind === 'player' && lot.online) {
        c.fillStyle = '#35e08a';
        c.beginPath();
        c.arc(X(b.x1) - 6, north ? Z(b.z0) + 6 : Z(b.z1) - 6, 3.5, 0, Math.PI * 2);
        c.fill();
      }
      c.shadowBlur = 0;
    }

    // Other players
    c.font = `700 ${Math.max(9, font - 2)}px system-ui, sans-serif`;
    for (const r of g.remotes) {
      const p = st.worldToGlobal(r.x, r.z);
      c.fillStyle = '#2fe6ff';
      c.beginPath();
      c.arc(X(p.x), Z(p.z), Math.max(3.5, s * 0.6), 0, Math.PI * 2);
      c.fill();
      if (this.big) {
        c.fillStyle = '#bff6ff';
        c.fillText(r.name, X(p.x), Z(p.z) - 10);
      }
    }
    // You: an arrow showing which way you face
    const yaw = g.player.yaw + (st.placeOf(st.activeId).side ? Math.PI : 0);
    const r = Math.max(6, s * 1.1);
    c.save();
    c.translate(X(me.x), Z(me.z));
    c.rotate(-yaw + Math.PI);
    c.fillStyle = '#ffc53d';
    c.strokeStyle = '#17151f';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -r);
    c.lineTo(r * 0.7, r * 0.7);
    c.lineTo(0, r * 0.3);
    c.lineTo(-r * 0.7, r * 0.7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
  }
}
