import { describe, expect, it } from 'vitest';
import { estimateHotelRate, hotelDailyCosts, hotelGuestBoost, newHotel, sanitizeHotel } from '../src/game/hotel';
import { BEDS, ROOM_EXTRAS, changeCost, defaultSetup, roomRate, roomStars, sanitizeSetup, sameSetup, setupValue } from '../src/hotel/rooms';
import { Street, type StreetLot } from '../src/world/street';
import { ITEMS, categoriesFor, itemDef, soldAt } from '../src/items/catalog';
import { sanitizeAppearance } from '../src/entities/appearance';
import type { SavedItem } from '../src/items/placedItem';

const look = { name: 'Lucky', signFont: 'bungee', signColor: 0, wallColor: 0x3a1d4d, trimColor: 0 };
const lot = (id: string, kind: StreetLot['kind'], order: number, hotelOf?: string): StreetLot => ({
  id, kind, owner: id, order, online: true, hotelOf, info: { look, width: 0, depth: 0, floors: 1 },
});
const saved = (id: string, setup?: SavedItem['setup']): SavedItem => ({
  id, tx: 20, tz: 30, rot: 0, level: 1, color: 0, broken: false, stats: { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 }, setup,
});

describe('hotel rooms', () => {
  it('spending buys stars and a higher nightly rate', () => {
    const bare = defaultSetup();
    const lux = { bed: 3, wall: 7, floor: 5, extras: ROOM_EXTRAS.filter((e) => !e.suite).map((e) => e.id) };
    expect(roomStars(bare)).toBe(1);
    expect(roomStars(lux)).toBe(5);
    expect(roomRate(lux)).toBeGreaterThan(roomRate(bare) * 10);
    expect(roomRate(bare, true)).toBeGreaterThan(roomRate(bare));
    expect(setupValue({ ...bare, bed: 2 })).toBe(BEDS[2].price);
  });

  it('upgrades cost the difference, removals refund half', () => {
    const a = defaultSetup();
    const b = { ...a, extras: ['tv'] };
    expect(changeCost(a, b)).toBe(1200);
    expect(changeCost(b, a)).toBe(-600);
    expect(sameSetup(b, { ...b, extras: ['tv'] })).toBe(true);
  });

  it('suite-only extras never end up in a standard room', () => {
    expect(sanitizeSetup({ bed: 9, extras: ['jacuzzi', 'tv', 'bogus'] }, false)).toEqual({ bed: 3, wall: 0, floor: 0, extras: ['tv'] });
    expect(sanitizeSetup({ extras: ['jacuzzi'] }, true).extras).toEqual(['jacuzzi']);
  });
});

describe('hotel business', () => {
  it('starts as an empty shell with its own cash', () => {
    const h = newHotel(look);
    expect(h.snap.items).toEqual([]);
    expect(h.bank).toBeGreaterThan(0);
    expect(h.snap.name).toBe('Lucky Hotel');
    expect(hotelGuestBoost(h)).toEqual({ spawn: 1, vip: 0 });
  });

  it('only earns while away with a reception, more with housekeepers and better rooms', () => {
    const h = newHotel(look);
    h.snap.items = [saved('room'), saved('room')];
    expect(estimateHotelRate(h.snap)).toBe(0);
    h.snap.items.push(saved('reception'));
    const noStaff = estimateHotelRate(h.snap);
    h.snap.staff = [{ role: 'janitor', name: 'A', look: sanitizeAppearance({}) }];
    const staffed = estimateHotelRate(h.snap);
    expect(noStaff).toBeGreaterThan(0);
    expect(staffed).toBeGreaterThan(noStaff);
    h.snap.items[0] = saved('room', { bed: 3, wall: 7, floor: 5, extras: ['tv', 'minibar', 'chandelier'] });
    expect(estimateHotelRate(h.snap)).toBeGreaterThan(staffed);
    expect(hotelDailyCosts(h.snap)).toBeGreaterThan(0);
  });

  it('turns an old-style hotel into a fresh one and keeps a saved one intact', () => {
    const fonts = ['bungee'];
    const old = sanitizeHotel({ floors: 5, tier: 2 }, look, fonts, sanitizeAppearance)!;
    expect(old.snap.items).toEqual([]);
    expect(old.bank).toBe(20000);
    const h = newHotel(look);
    h.bank = 1234;
    h.level = 3;
    h.snap.items = [saved('room', { bed: 1, wall: 2, floor: 3, extras: ['tv'] })];
    const back = sanitizeHotel(JSON.parse(JSON.stringify(h)), look, fonts, sanitizeAppearance)!;
    expect(back.bank).toBe(1234);
    expect(back.level).toBe(3);
    expect(back.snap.items[0].setup).toEqual({ bed: 1, wall: 2, floor: 3, extras: ['tv'] });
  });

  it('each business sells its own things', () => {
    expect(soldAt(itemDef('room'), 'hotel')).toBe(true);
    expect(soldAt(itemDef('room'), 'casino')).toBe(false);
    expect(soldAt(itemDef('slot_lucky7'), 'hotel')).toBe(false);
    expect(soldAt(itemDef('bar'), 'hotel')).toBe(true);
    expect(soldAt(itemDef('plant'), 'casino')).toBe(true);
    expect(categoriesFor('hotel').map((c) => c.id)).toEqual(['rooms', 'services', 'decor']);
    expect(ITEMS.filter((d) => soldAt(d, 'hotel') && d.kind === 'room').length).toBe(2);
  });

  it('stands right next to its casino, on the same side of the road', () => {
    const st = new Street();
    st.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1), lot('a', 'player', 2), lot('b', 'player', 3), lot('hotel', 'hotel', 0, 'me')]);
    const me = st.placeOf('me');
    const ho = st.placeOf('hotel');
    expect(ho.side).toBe(me.side);
    expect(ho.col).toBe(me.col + 1);
    const taken = new Set(st.lots.map((l) => `${st.placeOf(l.id).col},${st.placeOf(l.id).side}`));
    expect(taken.size).toBe(st.lots.length);
  });
});
