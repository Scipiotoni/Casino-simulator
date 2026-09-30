import * as THREE from 'three';
import { Exterior, type LotLook } from './exterior';
import { CENTER_X, DOOR_TILES, FACADE_Z, LOT_STRIDE, ROAD_MID, SIDEWALK_Z0 } from './grid';
export { ROAD_MID } from './grid';

export type LotKind = 'me' | 'rival' | 'player' | 'hotel';

/** One casino on the street. */
export interface StreetLot {
  /** 'me', 'rival' or another player's id. */
  id: string;
  kind: LotKind;
  info: LotLook;
  /** Owner's display name. */
  owner: string;
  /** Sort key: when the casino opened (the rival is always first). */
  order: number;
  /** Is the owner playing right now? */
  online: boolean;
  /** For a hotel: the id of the casino it belongs to (it stands right next to it). */
  hotelOf?: string;
  /** For a hotel: its size and star tier (the interior is generated from these). */
  hotel?: { floors: number; tier: number };
}

/** How many columns either side of the player exteriors are built. */
const VIEW_COLS = 3;

/** Tile rows of the whole street: north sidewalk, road, south sidewalk. */
export const STREET_Z0 = SIDEWALK_Z0;
export const STREET_Z1 = 2 * ROAD_MID - 1 - SIDEWALK_Z0;

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * The casinos on both sides of one road. Lots alternate north / south and fill columns
 * LOT_STRIDE apart, so neighbours face each other across the street.
 *
 * Every lot has its own local frame (the one its floor plan is built in: facade at
 * FACADE_Z, facing +z, door at CENTER_X). The global frame is the street itself; the
 * world is always drawn in the frame of the lot whose interior is loaded ("active").
 */
export class Street {
  readonly group = new THREE.Group();
  lots: StreetLot[] = [];
  activeId = 'me';
  private built = new Map<string, { ext: Exterior; key: string }>();
  /** Slot of each lot (col * 2 + side); hotels can leave gaps. */
  private slots = new Map<string, number>();
  private bySlot: (StreetLot | undefined)[] = [];

  /**
   * Casinos fill slots in opening order, alternating sides. A hotel takes the slot right
   * beside its casino on the same side of the road (two slots on), and later casinos skip it.
   */
  setLots(lots: StreetLot[]): void {
    const casinos = lots.filter((l) => l.kind !== 'hotel').sort((a, b) => (a.kind === 'rival' ? -1 : b.kind === 'rival' ? 1 : a.order - b.order));
    const hotels = new Map(lots.filter((l) => l.kind === 'hotel' && l.hotelOf).map((l) => [l.hotelOf!, l]));
    this.slots.clear();
    this.bySlot = [];
    let next = 0;
    const take = (l: StreetLot, i: number) => {
      this.slots.set(l.id, i);
      this.bySlot[i] = l;
    };
    for (const c of casinos) {
      while (this.bySlot[next]) next++;
      take(c, next);
      const h = hotels.get(c.id);
      if (h) {
        let i = next + 2;
        while (this.bySlot[i]) i += 2;
        take(h, i);
      }
    }
    this.lots = [...casinos, ...[...hotels.values()].filter((h) => this.slots.has(h.id))];
  }

  get(id: string): StreetLot | undefined {
    return this.lots.find((l) => l.id === id);
  }

  slotOf(id: string): number {
    return this.slots.get(id) ?? 0;
  }

  /** Column along the road and side (0 = north, 1 = south) of a lot. */
  placeOf(id: string): { col: number; side: 0 | 1 } {
    const i = this.slotOf(id);
    return { col: Math.floor(i / 2), side: (i % 2) as 0 | 1 };
  }

  get columns(): number {
    return Math.max(1, Math.ceil(this.bySlot.length / 2));
  }

  /** Lot-local point → street (global) frame. */
  toGlobal(id: string, x: number, z: number): Vec2 {
    const { col, side } = this.placeOf(id);
    return side === 0 ? { x: x + col * LOT_STRIDE, z } : { x: 2 * CENTER_X + col * LOT_STRIDE - x, z: 2 * ROAD_MID - z };
  }

  /** Street (global) point → a lot's local frame (the transform is its own inverse per side). */
  fromGlobal(id: string, x: number, z: number): Vec2 {
    const { col, side } = this.placeOf(id);
    return side === 0 ? { x: x - col * LOT_STRIDE, z } : { x: 2 * CENTER_X + col * LOT_STRIDE - x, z: 2 * ROAD_MID - z };
  }

  /** A point in one lot's frame expressed in another's. */
  map(from: string, to: string, x: number, z: number): Vec2 {
    const g = this.toGlobal(from, x, z);
    return this.fromGlobal(to, g.x, g.z);
  }

  /** Lot-local point → the world as drawn now. */
  toActive(id: string, x: number, z: number): Vec2 {
    return this.map(id, this.activeId, x, z);
  }

  /** Extra yaw of a lot's frame in the world as drawn now (0 or π). */
  rotOf(id: string): number {
    return this.placeOf(id).side === this.placeOf(this.activeId).side ? 0 : Math.PI;
  }

  /** The world as drawn now → global frame. */
  worldToGlobal(x: number, z: number): Vec2 {
    return this.toGlobal(this.activeId, x, z);
  }

  globalToWorld(x: number, z: number): Vec2 {
    return this.fromGlobal(this.activeId, x, z);
  }

  /** Global x range of the street (a little past the first and last column). */
  get extent(): [number, number] {
    return [CENTER_X - LOT_STRIDE / 2, (this.columns - 1) * LOT_STRIDE + CENTER_X + LOT_STRIDE / 2];
  }

  /** The lot whose frontage is nearest a world point (on the side of the road it's on). */
  lotAt(x: number, z: number): StreetLot | null {
    const g = this.worldToGlobal(x, z);
    const col = Math.round((g.x - CENTER_X) / LOT_STRIDE);
    if (col < 0) return null;
    return this.bySlot[col * 2 + (g.z < ROAD_MID ? 0 : 1)] ?? null;
  }

  private tileTo(id: string, tx: number, tz: number): [number, number] {
    const p = this.toGlobal(this.activeId, tx + 0.5, tz + 0.5);
    const l = this.fromGlobal(id, p.x, p.z);
    return [Math.floor(l.x), Math.floor(l.z)];
  }

  /** Is world tile (tx,tz) the front door of a lot other than the active one? Returns that lot. */
  doorAt(tx: number, tz: number): StreetLot | null {
    const lot = this.lotAt(tx + 0.5, tz + 0.5);
    if (!lot || lot.id === this.activeId) return null;
    const [lx, lz] = this.tileTo(lot.id, tx, tz);
    return lz === FACADE_Z && DOOR_TILES.some(([dx]) => dx === lx) ? lot : null;
  }

  /** The player may stroll both sidewalks, cross the road and step into any lot's doorway. */
  isStreetWalkable(tx: number, tz: number): boolean {
    const g = this.worldToGlobal(tx + 0.5, tz + 0.5);
    const [x0, x1] = this.extent;
    if (g.z > STREET_Z0 && g.z < STREET_Z1 + 1 && g.x >= x0 && g.x <= x1) return true;
    return this.doorAt(tx, tz) !== null;
  }

  /** Build/refresh exteriors near the focus point; the active lot's shell hides while you're inside. */
  update(dt: number, focusX: number, focusZ: number, inside: boolean): void {
    const f = this.worldToGlobal(focusX, focusZ);
    const focusCol = Math.round((f.x - CENTER_X) / LOT_STRIDE);
    const keep = new Set<string>();
    this.lots.forEach((l) => {
      const slot = this.slotOf(l.id);
      if (Math.abs(Math.floor(slot / 2) - focusCol) > VIEW_COLS && l.id !== this.activeId) return;
      keep.add(l.id);
      const key = JSON.stringify(l.info);
      let b = this.built.get(l.id);
      if (!b || b.key !== key) {
        b?.ext.dispose();
        b = { ext: new Exterior(l.info), key };
        this.built.set(l.id, b);
        this.group.add(b.ext.group);
      }
      const o = this.toActive(l.id, 0, 0);
      b.ext.group.position.set(o.x, 0, o.z);
      b.ext.group.rotation.y = this.rotOf(l.id);
      b.ext.shell.visible = !(inside && l.id === this.activeId);
      b.ext.update(dt);
    });
    for (const [id, b] of this.built) {
      if (!keep.has(id)) {
        b.ext.dispose();
        this.built.delete(id);
      }
    }
  }

  /** Throw away every exterior (e.g. after a look change) so they rebuild next frame. */
  refresh(id?: string): void {
    for (const [k, b] of this.built) {
      if (id && k !== id) continue;
      b.ext.dispose();
      this.built.delete(k);
    }
  }
}
