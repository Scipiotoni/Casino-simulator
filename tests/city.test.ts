import { describe, expect, it } from 'vitest';
import { Street, type StreetLot } from '../src/world/street';
import { CENTER_X, FACADE_Z, SIDEWALK_Z0 } from '../src/world/grid';
import {
  AVE_W, BLOCK_COLS, MAX_DEPTH, MIN_COLS, ROW_GAP, STREET_ROWS, avenueMid, colX, fillerFor, globalToSlot, onRoadNetwork, slotAt, slotToGlobal, streetZ,
} from '../src/world/city';

const look = { name: 'X', signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 };
const lot = (id: string, kind: StreetLot['kind'], order: number, extra: Partial<StreetLot> = {}): StreetLot => ({
  id, kind, owner: id, order, online: true, info: { look, width: 0, depth: 0, floors: 1 }, ...extra,
});

describe('city plan', () => {
  it('leaves room for the deepest lot between two streets', () => {
    // North lots of the next street start behind the south lots of this one.
    const southBack = slotToGlobal({ row: 0, col: 0, side: 1 }, CENTER_X, FACADE_Z - MAX_DEPTH).z;
    const northBack = slotToGlobal({ row: 1, col: 0, side: 0 }, CENTER_X, FACADE_Z - MAX_DEPTH).z;
    expect(northBack).toBeGreaterThan(southBack);
    expect(ROW_GAP).toBeGreaterThan(2 * MAX_DEPTH);
  });

  it('puts an avenue between blocks and round-trips every frame', () => {
    expect(colX(BLOCK_COLS) - colX(BLOCK_COLS - 1)).toBeGreaterThan(colX(1) - colX(0) + AVE_W - 1);
    for (const s of [{ row: 0, col: 0, side: 0 }, { row: 2, col: 7, side: 1 }, { row: 1, col: 4, side: 0 }] as const) {
      const g = slotToGlobal(s, 17.2, 31.4);
      const l = globalToSlot(s, g.x, g.z);
      expect(l.x).toBeCloseTo(17.2);
      expect(l.z).toBeCloseTo(31.4);
      // The sidewalk in front of a lot belongs to it, and is walkable.
      const front = slotToGlobal(s, CENTER_X, SIDEWALK_Z0 + 1.5);
      expect(slotAt(front.x, front.z, MIN_COLS)).toEqual(s);
      expect(onRoadNetwork(front.x, front.z, MIN_COLS)).toBe(true);
    }
  });

  it('only the roads and sidewalks are walkable', () => {
    for (let r = 0; r < STREET_ROWS; r++) expect(onRoadNetwork(colX(2) + CENTER_X, streetZ(r), MIN_COLS)).toBe(true);
    // Down an avenue, halfway between two streets
    expect(onRoadNetwork(avenueMid(1), (streetZ(0) + streetZ(1)) / 2, MIN_COLS)).toBe(true);
    // Inside a lot, behind its facade
    const inside = slotToGlobal({ row: 0, col: 2, side: 0 }, CENTER_X, FACADE_Z - 5);
    expect(onRoadNetwork(inside.x, inside.z, MIN_COLS)).toBe(false);
  });

  it('fillers are deterministic and fit their lot', () => {
    const a = fillerFor({ row: 2, col: 5, side: 1 });
    expect(fillerFor({ row: 2, col: 5, side: 1 })).toEqual(a);
    for (let c = 0; c < MIN_COLS; c++) {
      for (let r = 0; r < STREET_ROWS; r++) {
        const f = fillerFor({ row: r, col: c, side: 0 });
        expect(f.w).toBeLessThanOrEqual(32);
        expect(f.d).toBeLessThanOrEqual(MAX_DEPTH);
      }
    }
  });
});

describe('the city street', () => {
  const st = new Street();
  st.setLots([
    lot('rival', 'rival', 0), lot('me', 'me', 1), lot('p1', 'player', 2),
    lot('hotel:h0', 'hotel', 0, { hotelOf: 'me' }), lot('house', 'house', 0, { houseOf: 'me' }), lot('p1~house', 'house', 0, { houseOf: 'p1' }),
  ]);

  it('fills every unused slot with a filler and keeps slots unique', () => {
    const keys = new Set(st.lots.map((l) => JSON.stringify(st.placeOf(l.id))));
    expect(keys.size).toBe(st.lots.length);
    expect(st.lots.length).toBe(STREET_ROWS * st.cols * 2);
    expect(st.lots.filter((l) => l.kind === 'filler').length).toBe(st.lots.length - 7);
  });

  it('puts houses on Palm Avenue behind their casinos', () => {
    const me = st.placeOf('me');
    const house = st.placeOf('house');
    expect(house.row).toBe(1);
    expect(house.col).toBe(me.col);
    expect(st.placeOf('p1~house').row).toBe(1);
  });

  it('a player building replaces the filler that stood there', () => {
    const before = new Street();
    before.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1)]);
    const spot = st.placeOf('house');
    const was = before.lots.find((l) => JSON.stringify(before.placeOf(l.id)) === JSON.stringify(spot));
    expect(was?.kind).toBe('filler');
  });

  it('doors are not on fillers or the gun shop, and filler fronts are walkable', () => {
    st.activeId = 'me';
    for (const l of st.lots) {
      const w = st.toActive(l.id, CENTER_X - 0.5, FACADE_Z + 0.5);
      const door = st.doorAt(Math.floor(w.x), Math.floor(w.z));
      if (l.kind === 'filler' || l.kind === 'shop' || l.id === 'me') expect(door).toBeNull();
      else expect(door?.id).toBe(l.id);
    }
    const f = st.lots.find((l) => l.kind === 'filler')!;
    const front = st.toActive(f.id, CENTER_X + 3, FACADE_Z + 3);
    expect(st.isStreetWalkable(Math.floor(front.x), Math.floor(front.z))).toBe(true);
    expect(st.isOutdoors(front.x, front.z)).toBe(true);
  });
});
