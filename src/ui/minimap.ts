import type { Game } from '../game/game';
import { h } from './dom';
import { audio } from '../core/audio';
import { CENTER_X, DEPTH_STEP, DOOR_TILES, FACADE_Z, ROAD_MID, SIDEWALK_Z0, START_DEPTH, WIDTHS } from '../world/grid';
import type { StreetLot } from '../world/street';
import { AVE_WALK, ROAD_HALF, STREET_BLURBS, STREET_NAMES, STREET_ROWS, avenueX, blocksFor, streetZ } from '../world/city';

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
    this.el = h('div', { class: 'minimap' }, h('div', { class: 'mm-head' }, h('span', { text: 'CITY MAP' }), toggle), this.canvas);
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
    let w = WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, lot.info.width))].w;
    let d = START_DEPTH + Math.max(0, lot.info.depth) * DEPTH_STEP;
    if (lot.info.filler) {
      w = lot.info.filler.w;
      d = lot.info.filler.d;
    } else if (lot.kind === 'shop') {
      w = 18;
      d = 14;
    }
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
    // A building: land on the sidewalk right outside its door.
    const lot = g.street.lots.find((l) => {
      const b = this.lotRect(l);
      return gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1;
    });
    let ok: boolean;
    if (lot) {
      const d = g.street.toGlobal(lot.id, CENTER_X + 0.1, SIDEWALK_Z0 + 1.6);
      ok = g.teleportTo(d.x, d.z);
    } else ok = g.teleportTo(gx, gz);
    if (!ok && g.combat.teleportLock <= 0) {
      audio.play('error');
      g.notify('You can only teleport onto a sidewalk or a road, never inside a building.', 'bad');
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
    // Scale: the whole city when big, about a block around you when small.
    const bd = st.bounds;
    const s = this.big ? Math.min(W / (bd.x1 - bd.x0 + 8), H / (bd.z1 - bd.z0 + 8)) : Math.max(W / 110, H / 80);
    const viewW = W / s;
    const viewH = H / s;
    const x0 = this.big ? (bd.x0 + bd.x1) / 2 - viewW / 2 : me.x - viewW / 2;
    const z0 = this.big ? (bd.z0 + bd.z1) / 2 - viewH / 2 : me.z - viewH / 2;
    this.view = { x0, z0, s };
    const X = (x: number) => (x - x0) * s;
    const Z = (z: number) => (z - z0) * s;

    c.fillStyle = '#1b1726';
    c.fillRect(0, 0, W, H);
    // Sidewalks, then roads, of every street and avenue.
    const blocks = blocksFor(st.cols);
    for (const pass of [0, 1]) {
      c.fillStyle = pass ? '#34313d' : '#6d6878';
      for (let r = 0; r < STREET_ROWS; r++) {
        const zc = streetZ(r);
        const half = pass ? ROAD_HALF : ROAD_MID - FACADE_Z;
        c.fillRect(X(bd.x0), Z(zc - half), (bd.x1 - bd.x0) * s, half * 2 * s);
      }
      for (let k = 0; k <= blocks; k++) {
        const [a, b] = avenueX(k);
        const pad = pass ? AVE_WALK : 0;
        c.fillRect(X(a + pad), Z(bd.z0), (b - a - pad * 2) * s, (bd.z1 - bd.z0) * s);
      }
    }
    c.strokeStyle = '#ffd23f';
    c.lineWidth = Math.max(1, s * 0.15);
    c.setLineDash([s * 1.4, s * 1.6]);
    c.beginPath();
    for (let r = 0; r < STREET_ROWS; r++) {
      c.moveTo(X(bd.x0), Z(streetZ(r)));
      c.lineTo(X(bd.x1), Z(streetZ(r)));
    }
    c.stroke();
    c.setLineDash([]);

    // Buildings
    const font = this.big ? 10 : Math.max(9, Math.min(13, s * 1.6));
    c.font = `800 ${font}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const lot of st.lots) {
      const b = this.lotRect(lot);
      if (X(b.x1) < 0 || X(b.x0) > W || Z(b.z1) < 0 || Z(b.z0) > H) continue;
      const filler = lot.kind === 'filler';
      const mine = lot.id === 'me' || lot.id === 'house' || lot.hotelOf === 'me';
      c.fillStyle = filler ? (lot.info.filler?.kind === 'park' ? '#2c5a33' : '#3b3747') : lot.kind === 'shop' ? '#7a2a2a' : hex(lot.info.look.wallColor ?? 0x6a2cc2);
      c.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
      if (filler) continue;
      c.strokeStyle = mine ? '#ffc53d' : lot.kind === 'rival' ? '#ff4d6d' : lot.kind === 'shop' ? '#ff8a8a' : 'rgba(255,255,255,0.5)';
      c.lineWidth = mine ? 3 : 1.5;
      c.strokeRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
      const d = st.toGlobal(lot.id, DOOR_TILES[0][0] + 1, FACADE_Z + 0.5);
      c.fillStyle = '#ffe9b0';
      c.fillRect(X(d.x) - Math.max(1.5, s), Z(d.z) - Math.max(1, s * 0.5), Math.max(3, s * 2), Math.max(2, s));
      if (this.big && !mine && lot.kind !== 'shop') continue;
      const north = st.placeOf(lot.id).side === 0;
      const ty = north ? Z(b.z1) - font * 0.9 : Z(b.z0) + font * 0.9;
      const icon = lot.kind === 'shop' ? (lot.info.style === 'dealer' ? '🚗 ' : '🔫 ') : lot.kind === 'house' ? '🏠 ' : lot.kind === 'hotel' ? '🏨 ' : lot.id === 'me' ? '★ ' : '';
      const name = `${icon}${lot.kind === 'house' && lot.houseOf !== 'me' ? `${lot.owner}'s house` : lot.info.look.name}`;
      c.fillStyle = '#fff';
      c.shadowColor = 'rgba(0,0,0,0.8)';
      c.shadowBlur = 3;
      const maxW = Math.max(40, (b.x1 - b.x0) * s - 4);
      let label = name;
      while (label.length > 3 && c.measureText(label).width > maxW) label = label.slice(0, -2);
      if (label !== name) label += '…';
      c.fillText(label, X((b.x0 + b.x1) / 2), ty);
      if ((lot.kind === 'player') && lot.online) {
        c.fillStyle = '#35e08a';
        c.beginPath();
        c.arc(X(b.x1) - 6, north ? Z(b.z0) + 6 : Z(b.z1) - 6, 3.5, 0, Math.PI * 2);
        c.fill();
      }
      c.shadowBlur = 0;
    }
    // Street names on the big map
    if (this.big) {
      c.font = '800 11px system-ui, sans-serif';
      c.fillStyle = '#ffe9b0';
      c.shadowColor = 'rgba(0,0,0,0.9)';
      c.shadowBlur = 3;
      for (let r = 0; r < STREET_ROWS; r++) c.fillText(`${STREET_NAMES[r]} · ${STREET_BLURBS[r]}`, X(bd.x0) + 110, Z(streetZ(r)));
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
    // The police: flashing red and blue
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const d of st.police.dots) {
      c.fillStyle = (d.car ? blink : !blink) ? '#ff3b4d' : '#3b7bff';
      c.beginPath();
      if (d.car) c.rect(X(d.x) - 4, Z(d.z) - 4, 8, 8);
      else c.arc(X(d.x), Z(d.z), Math.max(3, s * 0.5), 0, Math.PI * 2);
      c.fill();
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
