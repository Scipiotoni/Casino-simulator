import * as THREE from 'three';
import { Exterior, type LotLook } from './exterior';
import { CENTER_X, DOOR_TILES, FACADE_Z, LOT_STRIDE, SIDEWALK_Z0, SIDEWALK_Z1 } from './grid';

export type LotKind = 'me' | 'rival' | 'player';

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
}

/** How far either side of the player exteriors are built. */
const VIEW_LOTS = 3;

/**
 * The row of casinos along the street. The lot whose interior is loaded ("active") always
 * sits at CENTER_X; every other lot is drawn as an exterior at a multiple of LOT_STRIDE.
 */
export class Street {
  readonly group = new THREE.Group();
  lots: StreetLot[] = [];
  activeId = 'me';
  private built = new Map<string, { ext: Exterior; key: string }>();

  setLots(lots: StreetLot[]): void {
    this.lots = [...lots].sort((a, b) => (a.kind === 'rival' ? -1 : b.kind === 'rival' ? 1 : a.order - b.order));
  }

  get(id: string): StreetLot | undefined {
    return this.lots.find((l) => l.id === id);
  }

  slotOf(id: string): number {
    const i = this.lots.findIndex((l) => l.id === id);
    return i < 0 ? 0 : i;
  }

  /** World x offset of a lot relative to the active one. */
  offsetOf(id: string): number {
    return (this.slotOf(id) - this.slotOf(this.activeId)) * LOT_STRIDE;
  }

  /** Lot whose frontage covers world x (null past either end of the street). */
  lotAt(x: number): StreetLot | null {
    const slot = Math.round((x - CENTER_X) / LOT_STRIDE) + this.slotOf(this.activeId);
    return this.lots[slot] ?? null;
  }

  /** Is (tx,tz) the front door of a lot other than the active one? Returns that lot. */
  doorAt(tx: number, tz: number): StreetLot | null {
    if (tz !== FACADE_Z) return null;
    for (const l of this.lots) {
      if (l.id === this.activeId) continue;
      const o = this.offsetOf(l.id);
      if (DOOR_TILES.some(([dx]) => dx + o === tx)) return l;
    }
    return null;
  }

  /** The player may stroll the whole sidewalk and step into any lot's doorway. */
  isStreetWalkable(tx: number, tz: number): boolean {
    if (tz >= SIDEWALK_Z0 && tz <= SIDEWALK_Z1) {
      const first = -this.slotOf(this.activeId) * LOT_STRIDE + CENTER_X - LOT_STRIDE / 2;
      const last = (this.lots.length - 1 - this.slotOf(this.activeId)) * LOT_STRIDE + CENTER_X + LOT_STRIDE / 2;
      return tx >= first && tx <= last;
    }
    return this.doorAt(tx, tz) !== null;
  }

  /** Build/refresh exteriors near `focusX`; the active lot's shell hides while you're inside. */
  update(dt: number, focusX: number, inside: boolean): void {
    const activeSlot = this.slotOf(this.activeId);
    const focusSlot = Math.round((focusX - CENTER_X) / LOT_STRIDE) + activeSlot;
    const keep = new Set<string>();
    this.lots.forEach((l, slot) => {
      if (Math.abs(slot - focusSlot) > VIEW_LOTS && l.id !== this.activeId) return;
      keep.add(l.id);
      const key = JSON.stringify(l.info);
      let b = this.built.get(l.id);
      if (!b || b.key !== key) {
        b?.ext.dispose();
        b = { ext: new Exterior(l.info), key };
        this.built.set(l.id, b);
        this.group.add(b.ext.group);
      }
      b.ext.group.position.x = (slot - activeSlot) * LOT_STRIDE;
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
