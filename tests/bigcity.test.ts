import { describe, expect, it } from 'vitest';
import { Street, type StreetLot } from '../src/world/street';
import { CENTER_X, FACADE_Z, SIDEWALK_Z0 } from '../src/world/grid';
import {
  BLOCK_COLS, MAX_DEPTH, MIN_COLS, PARK_BLOCKS, PARK_STREET, STREET_NAMES, STREET_ROWS, fillerFor, inParkSlot, parkRect, slotToGlobal, streetZ,
} from '../src/world/city';
import { lotHeight, lotSolids } from '../src/world/footprint';
import { NO_GARAGE_IDS, sanitizeParked } from '../src/game/house';
import { sanitizeGarage } from '../src/game/driving';
import { armoryPayroll, armoryRefillLeft, ARMORY_COOLDOWN_MS } from '../src/world/militaryBase';

const look = { name: 'X', signFont: 'bungee', signColor: 0, wallColor: 0, trimColor: 0 };
const lot = (id: string, kind: StreetLot['kind'], order: number, extra: Partial<StreetLot> = {}): StreetLot => ({
  id, kind, owner: id, order, online: true, info: { look, width: 0, depth: 0, floors: 1 }, ...extra,
});

describe('a much bigger city', () => {
  it('has a name for every street and fillers for every row', () => {
    expect(STREET_NAMES.length).toBe(STREET_ROWS);
    for (let r = 0; r < STREET_ROWS; r++) {
      for (let c = 0; c < MIN_COLS; c++) {
        const f = fillerFor({ row: r, col: c, side: 0 });
        expect(f.w).toBeLessThanOrEqual(32);
        expect(f.d).toBeLessThanOrEqual(MAX_DEPTH);
      }
    }
  });

  it('keeps Central Park free of buildings, three blocks wide between Park Lane and Lakeview Road', () => {
    const s = { row: PARK_STREET, col: PARK_BLOCKS[0] * BLOCK_COLS + 1, side: 1 as const };
    expect(inParkSlot(s)).toBe(true);
    expect(fillerFor(s).kind).toBe('centralpark');
    expect(inParkSlot({ row: PARK_STREET, col: s.col, side: 0 })).toBe(false);
    expect(inParkSlot({ row: PARK_STREET + 1, col: s.col, side: 0 })).toBe(true);
    const r = parkRect();
    expect(r.z0).toBeGreaterThan(streetZ(PARK_STREET));
    expect(r.z1).toBeLessThan(streetZ(PARK_STREET + 1));
    expect(r.x1 - r.x0).toBeGreaterThan(400);
  });
});

describe('walking round the back of the buildings', () => {
  const st = new Street();
  st.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1, { info: { look, width: 2, depth: 4, floors: 2 } }), lot('house', 'house', 0, { houseOf: 'me', info: { look, width: 0, depth: 1, floors: 1, style: 'house', ownGarage: true, garage: 9 } })]);
  st.activeId = 'rival';

  it('backyards and side gaps are open, the buildings themselves are not', () => {
    const me = st.placeOf('me');
    const inBuilding = slotToGlobal(me, CENTER_X, FACADE_Z - 5);
    expect(st.isOpen(inBuilding.x, inBuilding.z)).toBe(false);
    // Width step 2 is 22 tiles: 2 m past its side wall is open ground.
    const side = slotToGlobal(me, CENTER_X + 11 + 2, FACADE_Z - 5);
    expect(st.isOpen(side.x, side.z)).toBe(true);
    // Depth 4 steps = 28 m deep: behind it is the backyard.
    const back = slotToGlobal(me, CENTER_X, FACADE_Z - 28 - 3);
    expect(st.isOpen(back.x, back.z)).toBe(true);
    // The sidewalk out front still is.
    const front = slotToGlobal(me, CENTER_X, SIDEWALK_Z0 + 1);
    expect(st.isOpen(front.x, front.z)).toBe(true);
  });

  it('a building that grows covers ground that was open', () => {
    const me = st.placeOf('me');
    const p = slotToGlobal(me, CENTER_X, FACADE_Z - 28 - 3);
    expect(st.isOpen(p.x, p.z)).toBe(true);
    st.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1, { info: { look, width: 2, depth: 6, floors: 2 } })]);
    expect(st.isOpen(p.x, p.z)).toBe(false);
  });

  it('only your own garage’s walls are solid (you can drive in)', () => {
    const solids = lotSolids({ look, width: 0, depth: 1, floors: 1, style: 'house', ownGarage: true, garage: 9 });
    const inside = (x: number, z: number) => solids.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);
    const gx = CENTER_X + 7 + 3.6;
    expect(inside(gx, FACADE_Z - 4)).toBe(false);
    expect(inside(gx - 3.3, FACADE_Z - 4)).toBe(true);
    expect(inside(gx, FACADE_Z - 9)).toBe(true);
  });

  it('parks and parking lots are open; towers are tall for the skyline', () => {
    const park = fillerFor({ row: 0, col: 0, side: 0 });
    const parkSolids = lotSolids({ look, width: 0, depth: 0, floors: 0, style: 'filler', filler: { ...park, kind: 'park', w: 30, d: 40 } });
    expect(parkSolids.length).toBe(1);
    expect(lotSolids({ look, width: 0, depth: 0, floors: 0, style: 'filler', filler: { ...park, kind: 'centralpark' } })).toEqual([]);
    expect(lotHeight({ look, width: 0, depth: 0, floors: 20, style: 'filler', filler: { ...park, kind: 'tower', floors: 20 } })).toBeGreaterThan(60);
  });
});

describe('the tank and the armory', () => {
  it('the tank never goes in a garage, even from an old save', () => {
    expect(NO_GARAGE_IDS).toContain('tank');
    expect(sanitizeGarage({ owned: ['tank', 'hatch'] }).owned).toEqual(['hatch']);
    expect(sanitizeParked([{ id: 'tank' }, { id: 'jeep' }], 4)).toEqual([{ id: 'jeep' }]);
  });

  it('the armory payroll grows with your level and refills after half an hour', () => {
    expect(armoryPayroll(1)).toBe(40_000);
    expect(armoryPayroll(5)).toBeGreaterThan(armoryPayroll(2));
    expect(armoryPayroll(100)).toBe(250_000);
    const now = 1_000_000_000;
    expect(armoryRefillLeft(undefined, now)).toBe(0);
    expect(armoryRefillLeft(now - 10 * 60_000, now)).toBe(20 * 60_000);
    expect(armoryRefillLeft(now - ARMORY_COOLDOWN_MS - 1, now)).toBe(0);
  });
});

import { avenueName, cityX, cityZ, RESIDENTIAL_ROWS } from '../src/world/city';
import { VIEW_DISTANCES, viewScale } from '../src/world/viewDistance';

describe('the even bigger city', () => {
  it('is about 2.6 km by 2 km with twelve named streets, Central Park in the middle', () => {
    const [x0, x1] = cityX(MIN_COLS);
    const [z0, z1] = cityZ();
    expect(x1 - x0).toBeGreaterThan(2500);
    expect(z1 - z0).toBeGreaterThan(1900);
    expect(STREET_NAMES).toHaveLength(12);
    // The park sits between the middle two streets and the middle blocks.
    expect(PARK_STREET).toBe(Math.floor((STREET_ROWS - 1) / 2));
    const r = parkRect();
    expect(Math.abs((r.x0 + r.x1) / 2 - (x0 + x1) / 2)).toBeLessThan(200);
    for (const row of RESIDENTIAL_ROWS) expect(row).toBeLessThan(STREET_ROWS);
  });

  it('names every avenue with the right ordinal', () => {
    expect(avenueName(0)).toBe('1st Ave');
    expect(avenueName(1)).toBe('2nd Ave');
    expect(avenueName(2)).toBe('3rd Ave');
    expect(avenueName(10)).toBe('11th Ave');
    expect(avenueName(11)).toBe('12th Ave');
    expect(avenueName(20)).toBe('21st Ave');
  });

  it('has a view distance setting: Near draws less, Far more', () => {
    expect(VIEW_DISTANCES.map((v) => v.id)).toEqual(['near', 'normal', 'far']);
    expect(viewScale('near')).toBeLessThan(1);
    expect(viewScale('normal')).toBe(1);
    expect(viewScale('far')).toBeGreaterThan(1);
    expect(viewScale(undefined)).toBe(1);
  });
});
