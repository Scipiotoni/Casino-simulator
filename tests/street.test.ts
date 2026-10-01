import { describe, expect, it } from 'vitest';
import { Street, type StreetLot } from '../src/world/street';
import { CENTER_X, FACADE_Z } from '../src/world/grid';

const lot = (id: string, order: number): StreetLot => ({
  id, kind: id === 'rival' ? 'rival' : id === 'me' ? 'me' : 'player', owner: id, order, online: true,
  info: { look: { name: id, signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 }, width: 0, depth: 0, floors: 1 },
});

describe('street with casinos on both sides', () => {
  const st = new Street();
  st.setLots([lot('rival', 0), lot('me', 1), lot('a', 2), lot('b', 3)]);

  it('alternates sides and fills columns of the Strip (around the gun shop)', () => {
    expect(st.placeOf('rival')).toEqual({ row: 0, col: 0, side: 0 });
    expect(st.placeOf('me')).toEqual({ row: 0, col: 0, side: 1 });
    expect(st.placeOf('shop:guns')).toEqual({ row: 0, col: 1, side: 0 });
    expect(st.placeOf('a')).toEqual({ row: 0, col: 1, side: 1 });
    expect(st.placeOf('b')).toEqual({ row: 0, col: 2, side: 0 });
  });

  it('frames round-trip and facing doors line up across the road', () => {
    for (const id of ['rival', 'me', 'a', 'b']) {
      const g = st.toGlobal(id, 20.3, 38.7);
      const l = st.fromGlobal(id, g.x, g.z);
      expect(l.x).toBeCloseTo(20.3);
      expect(l.z).toBeCloseTo(38.7);
    }
    expect(st.toGlobal('rival', CENTER_X, 0).x).toBeCloseTo(st.toGlobal('me', CENTER_X, 0).x);
  });

  it('finds doors of other lots from any active lot', () => {
    for (const active of ['me', 'rival', 'b']) {
      st.activeId = active;
      for (const other of ['rival', 'me', 'a', 'b']) {
        if (other === active) continue;
        const w = st.toActive(other, CENTER_X - 0.5, FACADE_Z + 0.5);
        expect(st.doorAt(Math.floor(w.x), Math.floor(w.z))?.id).toBe(other);
        const out = st.toActive(other, CENTER_X, FACADE_Z + 2.5);
        expect(st.isStreetWalkable(Math.floor(out.x), Math.floor(out.z))).toBe(true);
      }
    }
    st.activeId = 'me';
  });
});
