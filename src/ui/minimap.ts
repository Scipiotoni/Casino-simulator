import type { Game } from '../game/game';
import { h } from './dom';
import { audio } from '../core/audio';
import { CENTER_X, DEPTH_STEP, DOOR_TILES, FACADE_Z, LOT_STRIDE, ROAD_MID, SIDEWALK_Z0, START_DEPTH, WIDTHS } from '../world/grid';
import type { StreetLot } from '../world/street';
import { AVE_WALK, BLOCK_COLS, PARK_BLOCKS, ROAD_HALF, STREET_BLURBS, STREET_NAMES, STREET_ROWS, WILDS, avenueX, blockX0, blocksFor, parkRect, streetZ } from '../world/city';
import { RING } from '../world/outskirts';
import { BASE_HD, BASE_HW, baseSite } from '../world/militaryBase';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Live map of the street (both sides of the road). Shows every casino, you and the other
 * players; click anywhere to mark a waypoint, or one of your own buildings to fast-travel
 * there (only from another of your buildings). The map turns with the camera.
 */
export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private big = false;
  private t = 0;
  /** Current view: global x/z of the canvas's left/top edge and pixels per tile. */
  private view = { x0: 0, z0: 0, s: 1 };
  /** Zoom on top of the normal scale (separately for the small and big map). */
  private zoomSmall = 1;
  private zoomBig = 1;
  /** Where the big map looks (global); null = the whole city / you. */
  private center: { x: number; z: number } | null = null;
  /** Follow a player on the map (pid), or yourself when null. */
  private follow: string | null = null;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private list: HTMLElement;
  private listKey = '';
  /** Turn the map so the way the camera faces is up (false = north up). */
  private headingUp = true;
  /** Current rotation of the map (radians, canvas clockwise). */
  private rot = 0;
  private compassBtn: HTMLElement;

  constructor(private game: Game) {
    this.canvas = h('canvas', { class: 'mm-canvas', 'aria-label': 'City map: click to set a waypoint' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const toggle = h('button', {
      class: 'mm-toggle', text: '⤢', title: 'Bigger map (M)', 'aria-label': 'Toggle big map',
      onClick: (e: Event) => {
        e.stopPropagation();
        this.setBig(!this.big);
      },
    });
    const zoomBtn = (label: string, f: number, title: string) => h('button', {
      class: 'mm-toggle', text: label, title, 'aria-label': title,
      onClick: (e: Event) => {
        e.stopPropagation();
        this.zoomAt(f);
      },
    });
    const meBtn = h('button', {
      class: 'mm-toggle', text: '◎', title: 'Back to you', 'aria-label': 'Center on you',
      onClick: (e: Event) => {
        e.stopPropagation();
        this.follow = null;
        this.center = null;
        this.t = 0;
        audio.play('click');
      },
    });
    try {
      this.headingUp = localStorage.getItem('jackpot-tycoon:mapNorthUp') !== '1';
    } catch {
      /* storage blocked: keep the default */
    }
    this.compassBtn = h('button', {
      class: 'mm-toggle mm-compass', text: '🧭', title: 'Map turns with the camera (click for north up)', 'aria-label': 'Toggle map rotation',
      onClick: (e: Event) => {
        e.stopPropagation();
        this.headingUp = !this.headingUp;
        try {
          localStorage.setItem('jackpot-tycoon:mapNorthUp', this.headingUp ? '0' : '1');
        } catch {
          /* ignore */
        }
        this.compassBtn.title = this.headingUp ? 'Map turns with the camera (click for north up)' : 'North up (click to turn the map with the camera)';
        this.compassBtn.classList.toggle('on', this.headingUp);
        audio.play('click');
        this.t = 0;
      },
    });
    this.compassBtn.classList.toggle('on', this.headingUp);
    this.list = h('div', { class: 'mm-players' });
    this.el = h('div', { class: 'minimap' },
      h('div', { class: 'mm-head' }, h('span', { text: 'CITY MAP' }), h('span', { class: 'mm-btns' }, zoomBtn('−', 1 / 1.5, 'Zoom out'), zoomBtn('+', 1.5, 'Zoom in'), this.compassBtn, meBtn, toggle)),
      this.canvas, this.list);
    this.canvas.addEventListener('click', (e) => this.click(e));
    // Wheel zooms around the cursor; dragging pans the big map.
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.canvas.getBoundingClientRect();
      const u = this.unrot(((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height);
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), u.x, u.y);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      const c = this.viewCenter();
      this.drag = { x: e.clientX, y: e.clientY, cx: c.x, cz: c.z, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      const r = this.canvas.getBoundingClientRect();
      const k = this.canvas.width / r.width / this.view.s;
      // Turn the drag back into map directions.
      const cs = Math.cos(-this.rot);
      const sn = Math.sin(-this.rot);
      const ux = dx * cs - dy * sn;
      const uy = dx * sn + dy * cs;
      this.center = { x: d.cx - ux * k, z: d.cz - uy * k };
      this.follow = '';
      this.t = 0;
    });
    window.addEventListener('pointerup', () => {
      if (this.drag?.moved) this.dragged = performance.now();
      this.drag = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) this.setBig(!this.big);
    });
  }

  private dragged = 0;

  /** A point on the (rotated) canvas → where it is on the map before rotation. */
  private unrot(px: number, py: number): { x: number; y: number } {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cs = Math.cos(-this.rot);
    const sn = Math.sin(-this.rot);
    const dx = px - W / 2;
    const dy = py - H / 2;
    return { x: W / 2 + dx * cs - dy * sn, y: H / 2 + dx * sn + dy * cs };
  }

  /** The global point in the middle of the map right now. */
  private viewCenter(): { x: number; z: number } {
    const v = this.view;
    return { x: v.x0 + this.canvas.width / v.s / 2, z: v.z0 + this.canvas.height / v.s / 2 };
  }

  /** Zoom by `f`, keeping the point under (px, py) in place (canvas pixels; default the middle). */
  private zoomAt(f: number, px?: number, py?: number): void {
    const v = this.view;
    const before = px !== undefined && py !== undefined ? { x: v.x0 + px / v.s, z: v.z0 + py / v.s } : null;
    if (this.big) this.zoomBig = Math.max(0.45, Math.min(14, this.zoomBig * f));
    else this.zoomSmall = Math.max(0.35, Math.min(5, this.zoomSmall * f));
    if (this.big && before && px !== undefined && py !== undefined) {
      // Work out the new scale and shift the centre so `before` stays under the cursor.
      const c = this.viewCenter();
      const s2 = v.s * f;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const nx = before.x - (px - W / 2) / s2;
      const nz = before.z - (py - H / 2) / s2;
      void c;
      this.center = { x: nx, z: nz };
      this.follow = '';
    }
    this.t = 0;
  }

  setBig(on: boolean): void {
    this.big = on;
    this.center = null;
    this.follow = null;
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
    // The end of a drag isn't a click.
    if (performance.now() - this.dragged < 250) return;
    const g = this.game;
    const r = this.canvas.getBoundingClientRect();
    const u = this.unrot(((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height);
    const px = u.x;
    const pz = u.y;
    const gx = this.view.x0 + px / this.view.s;
    const gz = this.view.z0 + pz / this.view.s;
    // Tap the waypoint again to clear it.
    const wp = g.waypoint;
    if (wp && Math.hypot(wp.x - gx, wp.z - gz) * this.view.s < 14 * Math.min(2, window.devicePixelRatio || 1)) {
      g.clearWaypoint();
      audio.play('click');
      this.t = 0;
      return;
    }
    const lot = g.street.lots.find((l) => {
      const b = this.lotRect(l);
      return gx >= b.x0 && gx <= b.x1 && gz >= b.z0 && gz <= b.z1;
    });
    // Your own buildings: fast travel there (only from another of your buildings).
    if (lot && g.ownsLot(lot)) {
      g.fastTravel(lot.kind === 'me' ? 'casino' : lot.id === 'house' ? 'house' : 'hotel');
      return;
    }
    // Anywhere else: mark a waypoint (a building's is at its door).
    if (lot) {
      const d = g.street.toGlobal(lot.id, CENTER_X + 0.1, SIDEWALK_Z0 + 1.6);
      const name = lot.kind === 'house' ? (lot.houseOf === 'me' ? 'your house' : `${lot.owner}'s house`) : lot.info.look.name;
      g.setWaypoint(d.x, d.z, name);
      if (g.ownsLot(lot)) g.notify(`Waypoint set to ${name}. Fast travel only works from one of your own buildings.`, 'info');
    } else g.setWaypoint(gx, gz);
    this.t = 0;
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
    // Scale: the whole city when big, about a block around you when small (then zoomed).
    const bd = st.bounds;
    // Heading up: turn the map so the way the camera looks points up.
    const side = st.placeOf(st.activeId).side;
    const ca = g.cam.yaw + (side ? Math.PI : 0);
    const want = this.headingUp ? -Math.PI / 2 - Math.atan2(-Math.cos(ca), -Math.sin(ca)) : 0;
    this.rot = want;
    const rot = want;
    const fitW = this.headingUp ? Math.hypot(bd.x1 - bd.x0, bd.z1 - bd.z0) + 8 : bd.x1 - bd.x0 + 8;
    const fitH = this.headingUp ? fitW : bd.z1 - bd.z0 + 8;
    const s = this.big ? Math.min(W / fitW, H / fitH) * this.zoomBig : Math.max(W / 110, H / 80) * this.zoomSmall;
    const viewW = W / s;
    const viewH = H / s;
    // Centre: a followed player, a dragged-to spot, you (small map) or the whole city (big map).
    const followed = this.follow ? g.mapPlayers.find((p) => p.pid === this.follow) : null;
    let cx: number;
    let cz: number;
    if (followed) {
      cx = followed.x;
      cz = followed.z;
    } else if (this.center && this.follow !== null) {
      cx = this.center.x;
      cz = this.center.z;
    } else if (this.big && this.zoomBig <= 1.01) {
      cx = (bd.x0 + bd.x1) / 2;
      cz = (bd.z0 + bd.z1) / 2;
    } else {
      cx = me.x;
      cz = me.z;
    }
    const x0 = cx - viewW / 2;
    const z0 = cz - viewH / 2;
    this.view = { x0, z0, s };
    const X = (x: number) => (x - x0) * s;
    const Z = (z: number) => (z - z0) * s;

    // Mountains, the open desert around town (rounded at the corners), then the city.
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#3b2a22';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    c.rotate(rot);
    c.translate(-W / 2, -H / 2);
    // Everything within this radius of the middle can end up on screen once turned.
    const R = Math.hypot(W, H) / 2;
    const out = (x: number, y: number, m = 0) => Math.hypot(x - W / 2, y - H / 2) > R + m;
    const txt = (t: string, x: number, y: number, dy = 0) => {
      c.save();
      c.translate(x, y);
      c.rotate(-rot);
      c.fillText(t, 0, dy);
      c.restore();
    };
    c.fillStyle = '#7a5e3c';
    c.beginPath();
    c.roundRect(X(bd.x0 - WILDS), Z(bd.z0 - WILDS), (bd.x1 - bd.x0 + WILDS * 2) * s, (bd.z1 - bd.z0 + WILDS * 2) * s, WILDS * s);
    c.fill();
    // Ring road, the roads out of town and the highway to the overlook
    c.fillStyle = '#34313d';
    const RW = 11;
    const rx0 = bd.x0 - RING;
    const rx1 = bd.x1 + RING;
    const rz0 = bd.z0 - RING;
    const rz1 = bd.z1 + RING;
    c.fillRect(X(rx0 - RW / 2), Z(rz0 - RW / 2), (rx1 - rx0 + RW) * s, RW * s);
    c.fillRect(X(rx0 - RW / 2), Z(rz1 - RW / 2), (rx1 - rx0 + RW) * s, RW * s);
    c.fillRect(X(rx0 - RW / 2), Z(rz0), RW * s, (rz1 - rz0) * s);
    c.fillRect(X(rx1 - RW / 2), Z(rz0), RW * s, (rz1 - rz0) * s);
    for (let r = 0; r < STREET_ROWS; r++) c.fillRect(X(rx0), Z(streetZ(r) - ROAD_HALF), (rx1 - rx0) * s, ROAD_HALF * 2 * s);
    for (let k = 0; k <= blocksFor(st.cols); k++) {
      const [a, b] = avenueX(k);
      c.fillRect(X((a + b) / 2 - 4.5), Z(rz0), 9 * s, (rz1 - rz0) * s);
    }
    const mz = (bd.z0 + bd.z1) / 2;
    c.fillRect(X(rx1), Z(mz - RW / 2), (bd.x1 + WILDS - 32 - rx1) * s, RW * s);
    c.beginPath();
    c.arc(X(bd.x1 + WILDS - 32), Z(mz), 28 * s, 0, Math.PI * 2);
    c.fill();
    // Lake Mojave with its beach, Pinewood Forest and its pond.
    const ok = st.outskirts;
    const labelFont = `800 ${Math.max(9, Math.min(13, s * 3))}px system-ui, sans-serif`;
    if (ok.lake) {
      const l = ok.lake;
      c.fillStyle = '#e8d39c';
      c.beginPath();
      c.ellipse(X(l.x), Z(l.z), (l.rx + 24) * s, (l.rz + 24) * s, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2a8fc4';
      c.beginPath();
      c.ellipse(X(l.x), Z(l.z), l.rx * s, l.rz * s, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#34313d';
      c.fillRect(X(l.x - 4.5), Z(bd.z1 + RING), 9 * s, (l.z - l.rz - 30 - bd.z1 - RING) * s);
    }
    if (ok.forest) {
      const f = ok.forest;
      c.fillStyle = '#2f5a2e';
      c.beginPath();
      c.roundRect(X(f.x0), Z(f.z0), (f.x1 - f.x0) * s, (f.z1 - f.z0) * s, 30 * s);
      c.fill();
      if (ok.pond) {
        c.fillStyle = '#2a6f7a';
        c.beginPath();
        c.ellipse(X(ok.pond.x), Z(ok.pond.z), ok.pond.rx * s, ok.pond.rz * s, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#34313d';
      c.fillRect(X((f.x0 + f.x1) / 2 - 4), Z(f.z1), 8 * s, (bd.z0 - RING - f.z1) * s);
    }
    c.font = labelFont;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    if (ok.lake) txt('🏖 LAKE MOJAVE', X(ok.lake.x), Z(ok.lake.z));
    if (ok.forest) txt('🌲 PINEWOOD FOREST', X((ok.forest.x0 + ok.forest.x1) / 2), Z((ok.forest.z0 + ok.forest.z1) / 2));
    // The oasis
    c.fillStyle = '#2aa6c4';
    c.beginPath();
    c.arc(X((bd.x0 + bd.x1) / 2 - 60), Z(bd.z0 - RING - 120), 22 * s, 0, Math.PI * 2);
    c.fill();
    // Fort Mojave, the military base out west, and its road to the ring.
    {
      const b = baseSite(st.cols);
      c.fillStyle = '#34313d';
      c.fillRect(X(b.roadX0), Z(b.cz - 5), (b.roadX1 - b.roadX0) * s, 10 * s);
      c.fillStyle = '#4b5320';
      c.fillRect(X(b.cx - BASE_HW), Z(b.cz - BASE_HD), BASE_HW * 2 * s, BASE_HD * 2 * s);
      c.strokeStyle = g.base.alarm ? '#ff3a3a' : '#c8c2a8';
      c.lineWidth = Math.max(1, s * 0.6);
      c.strokeRect(X(b.cx - BASE_HW), Z(b.cz - BASE_HD), BASE_HW * 2 * s, BASE_HD * 2 * s);
      c.fillStyle = '#e8e0c8';
      c.font = `800 ${Math.max(9, Math.min(13, s * 3))}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      txt('⭐ FORT MOJAVE', X(b.cx), Z(b.cz));
      if (g.base.alarm) {
        c.fillStyle = '#ff6a3a';
        for (const d of g.base.dots) {
          c.beginPath();
          c.arc(X(d.x), Z(d.z), Math.max(2, s * 0.5), 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    c.fillStyle = '#1b1726';
    c.fillRect(X(bd.x0), Z(bd.z0), (bd.x1 - bd.x0) * s, (bd.z1 - bd.z0) * s);
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

    // Central Park: lawns, the lake (the avenues still cross it).
    {
      const pr = parkRect();
      c.fillStyle = '#3f7f3a';
      for (let k = PARK_BLOCKS[0]; k <= PARK_BLOCKS[1]; k++) {
        const x0 = blockX0(k);
        c.fillRect(X(x0), Z(pr.z0), BLOCK_COLS * LOT_STRIDE * s, (pr.z1 - pr.z0) * s);
      }
      const lk = st.park.lake;
      if (lk) {
        c.fillStyle = '#2a8fc4';
        c.beginPath();
        c.ellipse(X(lk.x), Z(lk.z), lk.rx * s, lk.rz * s, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.font = labelFont;
      c.fillStyle = '#ffffff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      txt('🌳 CENTRAL PARK', X((pr.x0 + pr.x1) / 2), Z(pr.z0 + 14));
    }
    // Buildings
    const font = this.big ? 10 : Math.max(9, Math.min(13, s * 1.6));
    c.font = `800 ${font}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const lot of st.lots) {
      const b = this.lotRect(lot);
      if (out((X(b.x0) + X(b.x1)) / 2, (Z(b.z0) + Z(b.z1)) / 2, Math.hypot(X(b.x1) - X(b.x0), Z(b.z1) - Z(b.z0)) / 2)) continue;
      const filler = lot.kind === 'filler';
      const mine = lot.id === 'me' || lot.id === 'house' || lot.hotelOf === 'me';
      const fk = lot.info.filler?.kind;
      if (fk === 'centralpark') continue;
      c.fillStyle = filler ? (fk === 'park' ? '#2c5a33' : '#3b3747') : lot.kind === 'shop' ? '#7a2a2a' : hex(lot.info.look.wallColor ?? 0x6a2cc2);
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
      txt(label, X((b.x0 + b.x1) / 2), ty);
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
      for (let r = 0; r < STREET_ROWS; r++) txt(`${STREET_NAMES[r]} · ${STREET_BLURBS[r]}`, X(bd.x0) + 110, Z(streetZ(r)));
      c.shadowBlur = 0;
    }

    // Other players: a dot with their name (inside a building: a ring at its door)
    const labels = this.big || s > 3;
    c.font = `800 ${Math.max(10, Math.min(14, font))}px system-ui, sans-serif`;
    for (const p of g.mapPlayers) {
      const px = X(p.x);
      const pz = Z(p.z);
      if (out(px, pz, 40)) continue;
      const rr = Math.max(4.5, Math.min(10, s * 0.7));
      const followedNow = this.follow === p.pid;
      c.lineWidth = 2.5;
      c.strokeStyle = '#0b0714';
      c.fillStyle = p.ko ? '#ff4d5e' : p.inside ? 'rgba(47,230,255,0.25)' : '#2fe6ff';
      c.beginPath();
      if (p.driving) c.rect(px - rr, pz - rr * 0.7, rr * 2, rr * 1.4);
      else c.arc(px, pz, rr, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      if (p.inside) {
        c.strokeStyle = '#2fe6ff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, pz, rr, 0, Math.PI * 2);
        c.stroke();
      }
      if (followedNow) {
        c.strokeStyle = '#ffc53d';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, pz, rr + 4, 0, Math.PI * 2);
        c.stroke();
      }
      if (labels || followedNow) {
        const tag = `${p.driving ? '🚗 ' : ''}${p.name}${p.wanted ? ` ${'★'.repeat(p.wanted)}` : ''}${p.ko ? ' 💫' : ''}`;
        c.shadowColor = 'rgba(0,0,0,0.95)';
        c.shadowBlur = 4;
        c.fillStyle = p.wanted ? '#ffc53d' : '#bff6ff';
        txt(tag, px, pz, -rr - 8);
        if (p.inside && (this.big || s > 5)) {
          c.font = `700 ${Math.max(9, Math.min(12, font - 1))}px system-ui, sans-serif`;
          c.fillStyle = 'rgba(191,246,255,0.75)';
          txt(p.where, px, pz, rr + 9);
          c.font = `800 ${Math.max(10, Math.min(14, font))}px system-ui, sans-serif`;
        }
        c.shadowBlur = 0;
      }
    }
    this.renderList();
    // The police: flashing red and blue
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const d of st.police.dots) {
      c.fillStyle = (d.car ? blink : !blink) ? '#ff3b4d' : '#3b7bff';
      c.beginPath();
      if (d.car) c.rect(X(d.x) - 4, Z(d.z) - 4, 8, 8);
      else c.arc(X(d.x), Z(d.z), Math.max(3, s * 0.5), 0, Math.PI * 2);
      c.fill();
    }
    // Your waypoint: a dashed route line and a pin.
    const wpt = g.waypoint;
    if (wpt) {
      c.strokeStyle = 'rgba(255,197,61,0.9)';
      c.lineWidth = Math.max(2, s * 0.25);
      c.setLineDash([8, 6]);
      c.beginPath();
      c.moveTo(X(me.x), Z(me.z));
      c.lineTo(X(wpt.x), Z(wpt.z));
      c.stroke();
      c.setLineDash([]);
      const px = X(wpt.x);
      const pz = Z(wpt.z);
      const pr = 8 * Math.min(2, window.devicePixelRatio || 1);
      c.save();
      c.translate(px, pz);
      c.rotate(-rot);
      c.fillStyle = '#ffc53d';
      c.strokeStyle = '#17151f';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.bezierCurveTo(-pr, -pr, -pr, -pr * 2.2, 0, -pr * 2.2);
      c.bezierCurveTo(pr, -pr * 2.2, pr, -pr, 0, 0);
      c.fill();
      c.stroke();
      c.fillStyle = '#17151f';
      c.beginPath();
      c.arc(0, -pr * 1.45, pr * 0.32, 0, Math.PI * 2);
      c.fill();
      c.restore();
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
    // A compass needle on the rim pointing north when the map turns.
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (Math.abs(rot) > 1e-3) {
      const nx = Math.sin(rot);
      const ny = -Math.cos(rot);
      const k = Math.min(Math.abs((W / 2 - 12) / (nx || 1e-6)), Math.abs((H / 2 - 12) / (ny || 1e-6)));
      const ax = W / 2 + nx * k;
      const ay = H / 2 + ny * k;
      c.fillStyle = 'rgba(11,7,20,0.75)';
      c.beginPath();
      c.arc(ax, ay, 9 * Math.min(2, window.devicePixelRatio || 1), 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ff5a5a';
      c.font = `900 ${11 * Math.min(2, window.devicePixelRatio || 1)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('N', ax, ay + 0.5);
    }
  }

  /** Big map: everyone online, click a name to find them on the map. */
  private renderList(): void {
    const g = this.game;
    const players = this.big ? g.mapPlayers : [];
    const key = players.map((p) => `${p.pid}|${p.name}|${p.inside}|${p.where}|${p.wanted}|${p.driving}`).join(';') + `|${this.follow}`;
    if (key === this.listKey) return;
    this.listKey = key;
    this.list.replaceChildren();
    this.list.hidden = !this.big;
    if (!this.big) return;
    this.list.appendChild(h('span', { class: 'mm-ptitle', text: players.length ? `Players online (${players.length}):` : 'No other players online right now.' }));
    for (const p of players) {
      this.list.appendChild(h('button', {
        class: `mm-pbtn${this.follow === p.pid ? ' on' : ''}`,
        text: `${p.driving ? '🚗' : p.inside ? '🏠' : '●'} ${p.name}${p.wanted ? ` ${'★'.repeat(p.wanted)}` : ''}`,
        title: p.inside ? `${p.name} is ${p.where}` : `${p.name} is out on the street`,
        onClick: (e: Event) => {
          e.stopPropagation();
          // Find them: follow and zoom in close.
          this.follow = this.follow === p.pid ? null : p.pid;
          if (this.follow) this.zoomBig = Math.max(this.zoomBig, 5);
          this.listKey = '';
          this.t = 0;
          audio.play('click');
        },
      }));
    }
  }
}
