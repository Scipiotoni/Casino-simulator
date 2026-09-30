import { describe, expect, it } from 'vitest';
import { HOTEL_TIERS, ROOMS_PER_FLOOR, generateHotel, hotelFloorCost, hotelGuestBoost, hotelNight, hotelOccupancy, hotelRooms, newHotel, sanitizeHotel } from '../src/game/hotel';
import { Street, type StreetLot } from '../src/world/street';
import { itemDef } from '../src/items/catalog';

const look = { name: 'Lucky', signFont: 'bungee', signColor: 0, wallColor: 0x3a1d4d, trimColor: 0 };
const lot = (id: string, kind: StreetLot['kind'], order: number, hotelOf?: string): StreetLot => ({
  id, kind, owner: id, order, online: true, hotelOf, info: { look, width: 0, depth: 0, floors: 1 },
});

describe('hotel', () => {
  it('rooms, costs and nights add up', () => {
    const h = newHotel();
    expect(hotelRooms(h)).toBe(ROOMS_PER_FLOOR);
    expect(hotelFloorCost({ ...h, floors: 3 })).toBeGreaterThan(hotelFloorCost(h));
    const n = hotelNight(h, 4, 0.5);
    expect(n.guests).toBeGreaterThan(0);
    expect(n.guests).toBeLessThanOrEqual(hotelRooms(h));
    expect(n.revenue).toBe(n.guests * HOTEL_TIERS[0].rate);
    expect(h.staying).toBe(n.guests);
    expect(hotelGuestBoost(h).spawn).toBeGreaterThan(1);
    expect(hotelGuestBoost(null)).toEqual({ spawn: 1, vip: 0 });
  });

  it('a better casino fills more rooms; fancier rooms are harder to sell', () => {
    expect(hotelOccupancy(0, 5, 0.5)).toBeGreaterThan(hotelOccupancy(0, 1, 0.5));
    expect(hotelOccupancy(4, 3, 0.5)).toBeLessThan(hotelOccupancy(0, 3, 0.5));
  });

  it('the generated tower has a desk and every room', () => {
    const snap = generateHotel({ floors: 4, tier: 2 }, look);
    expect(snap.items.filter((i) => i.id === 'frontdesk').length).toBe(1);
    expect(snap.items.filter((i) => i.id === 'hotelbed').length).toBe(3 * ROOMS_PER_FLOOR);
    expect(itemDef('hotelbed').hidden).toBe(true);
  });

  it('sanitizes saved hotels', () => {
    expect(sanitizeHotel(null)).toBeNull();
    const h = sanitizeHotel({ floors: 999, tier: -3, staying: 1e9 })!;
    expect(h.floors).toBe(20);
    expect(h.tier).toBe(0);
    expect(h.staying).toBe(hotelRooms(h));
  });

  it('stands right next to its casino, on the same side of the road', () => {
    const st = new Street();
    st.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1), lot('a', 'player', 2), lot('b', 'player', 3), lot('hotel', 'hotel', 0, 'me')]);
    const me = st.placeOf('me');
    const ho = st.placeOf('hotel');
    expect(ho.side).toBe(me.side);
    expect(ho.col).toBe(me.col + 1);
    // Nobody else lands on the hotel's slot
    const taken = new Set(st.lots.map((l) => `${st.placeOf(l.id).col},${st.placeOf(l.id).side}`));
    expect(taken.size).toBe(st.lots.length);
  });
});
