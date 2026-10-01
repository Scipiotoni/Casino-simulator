import { describe, expect, it } from 'vitest';
import { buildingCost, emptyBuilding, estimateBuildingRate, gardenBoost, hotelDailyCosts, hotelGuestBoost, newHotel, sanitizeHotel, snapChecklist } from '../src/game/hotel';
import { BEDS, ROOM_EXTRAS, ROOM_THEMES, changeCost, defaultSetup, fitsClass, roomRate, roomStars, sanitizeSetup, sameSetup, setupValue, themeFor } from '../src/hotel/rooms';
import { Street, type StreetLot } from '../src/world/street';
import { ITEMS, categoriesFor, itemDef, soldAt, zoneBlock } from '../src/items/catalog';
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
    const lux = { bed: 3, wall: 7, floor: 5, extras: ROOM_EXTRAS.filter((e) => fitsClass(e, 0)).map((e) => e.id) };
    expect(roomStars(bare)).toBe(1);
    expect(roomStars(lux)).toBe(5);
    expect(roomRate(lux)).toBeGreaterThan(roomRate(bare) * 10);
    expect(roomRate(bare, 1)).toBeGreaterThan(roomRate(bare));
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
    expect(sanitizeSetup({ bed: 9, extras: ['jacuzzi', 'tv', 'bogus'] }, 0)).toEqual({ bed: 4, wall: 0, floor: 0, extras: ['tv'] });
    expect(sanitizeSetup({ extras: ['jacuzzi'] }, 1).extras).toEqual(['jacuzzi']);
  });
});

describe('hotel business', () => {
  it('starts as one empty tower with its own cash', () => {
    const h = newHotel(look);
    expect(h.buildings.length).toBe(1);
    expect(h.buildings[0].kind).toBe('tower');
    expect(h.buildings[0].snap.items).toEqual([]);
    expect(h.bank).toBeGreaterThan(0);
    expect(h.buildings[0].snap.name).toBe('Lucky Hotel');
    expect(hotelGuestBoost(h)).toEqual({ spawn: 1, vip: 0 });
  });

  it('a tower only opens with reception, buffet, a room and a housekeeper', () => {
    const h = newHotel(look);
    const t = h.buildings[0];
    t.snap.items = [saved('reception'), saved('room')];
    expect(snapChecklist(t.snap).filter((c) => !c.done).map((c) => c.id)).toEqual(['buffet', 'staff']);
    expect(estimateBuildingRate(t, h)).toBe(0);
    t.snap.items.push(saved('buffet'));
    t.snap.staff = [{ role: 'janitor', name: 'A', look: sanitizeAppearance({}) }];
    expect(snapChecklist(t.snap).every((c) => c.done)).toBe(true);
    const open = estimateBuildingRate(t, h);
    expect(open).toBeGreaterThan(0);
    t.snap.items[1] = saved('room', { bed: 3, wall: 7, floor: 5, extras: ['tv', 'minibar', 'chandelier'] });
    expect(estimateBuildingRate(t, h)).toBeGreaterThan(open);
    // A pool garden next door makes the tower easier to fill
    const before = estimateBuildingRate(t, h);
    const g = emptyBuilding('h1', 'garden', look);
    g.snap.items = [saved('pool'), saved('waterslide')];
    h.buildings.push(g);
    expect(gardenBoost(h)).toBeGreaterThan(1);
    expect(estimateBuildingRate(t, h)).toBeGreaterThan(before);
    expect(hotelDailyCosts(h.buildings.map((b) => b.snap))).toBeGreaterThan(0);
  });

  it('more buildings cost more and unlock later', () => {
    expect(buildingCost('tower', 2).price).toBeGreaterThan(buildingCost('tower', 1).price);
    expect(buildingCost('garden', 1).level).toBeGreaterThan(buildingCost('garden', 0).level);
  });

  it('pools only go in a Pool Garden, rooms only in towers', () => {
    expect(zoneBlock(itemDef('pool'), false)).toMatch(/Pool Garden/);
    expect(zoneBlock(itemDef('pool'), true)).toBeNull();
    expect(zoneBlock(itemDef('room'), true)).toMatch(/tower/);
    expect(zoneBlock(itemDef('plant'), true)).toBeNull();
    expect(zoneBlock(itemDef('buffet'), false)).toBeNull();
  });

  it('penthouses are VIP-only and the grandest rooms', () => {
    const lux = { bed: 4, wall: 8, floor: 6, extras: ['bar', 'cinema', 'statue', 'piano'] };
    expect(itemDef('penthouse').vipOnly).toBe(true);
    expect(roomRate(lux, 2)).toBeGreaterThan(roomRate(lux, 1));
    expect(sanitizeSetup(lux, 1).extras).toEqual(['piano']);
    expect(themeFor(ROOM_THEMES[ROOM_THEMES.length - 1].setup, 0).extras.every((id) => !['jacuzzi', 'bar'].includes(id))).toBe(true);
  });

  it('migrates older hotels and keeps saved buildings intact', () => {
    const fonts = ['bungee'];
    const old = sanitizeHotel({ floors: 5, tier: 2 }, look, fonts, sanitizeAppearance)!;
    expect(old.buildings[0].snap.items).toEqual([]);
    expect(old.bank).toBe(20000);
    // A one-building hotel from the previous version
    const one = sanitizeHotel({ bank: 500, level: 2, snap: { name: 'X', look, layout: { width: 0, depth: 0 }, floors: 2, items: [saved('room')], staff: [] } }, look, fonts, sanitizeAppearance)!;
    expect(one.buildings.length).toBe(1);
    expect(one.buildings[0].snap.items.length).toBe(1);
    const h = newHotel(look);
    h.bank = 1234;
    h.buildings.push(emptyBuilding('h1', 'garden', look));
    h.buildings[0].snap.items = [saved('room', { bed: 1, wall: 2, floor: 3, extras: ['tv'] })];
    h.reviews = [{ stars: 5, text: 'Great', name: 'Ann', vip: true, day: 2 }];
    const back = sanitizeHotel(JSON.parse(JSON.stringify(h)), look, fonts, sanitizeAppearance)!;
    expect(back.bank).toBe(1234);
    expect(back.buildings.map((b) => b.kind)).toEqual(['tower', 'garden']);
    expect(back.buildings[0].snap.items[0].setup).toEqual({ bed: 1, wall: 2, floor: 3, extras: ['tv'] });
    expect(back.reviews[0].stars).toBe(5);
  });

  it('each business sells its own things', () => {
    expect(soldAt(itemDef('room'), 'hotel')).toBe(true);
    expect(soldAt(itemDef('room'), 'casino')).toBe(false);
    expect(soldAt(itemDef('slot_lucky7'), 'hotel')).toBe(false);
    expect(soldAt(itemDef('bar'), 'hotel')).toBe(true);
    expect(soldAt(itemDef('plant'), 'casino')).toBe(true);
    expect(categoriesFor('hotel').map((c) => c.id)).toEqual(['rooms', 'services', 'decor']);
    expect(ITEMS.filter((d) => soldAt(d, 'hotel') && d.kind === 'room').length).toBe(3);
  });

  it('stands right next to its casino, on the same side of the road', () => {
    const st = new Street();
    st.setLots([lot('rival', 'rival', 0), lot('me', 'me', 1), lot('a', 'player', 2), lot('b', 'player', 3), lot('hotel:h0', 'hotel', 0, 'me'), lot('hotel:h1', 'hotel', 1, 'me')]);
    const me = st.placeOf('me');
    const ho = st.placeOf('hotel:h0');
    const ho2 = st.placeOf('hotel:h1');
    expect(ho2.side).toBe(me.side);
    expect(ho2.col).toBe(me.col + 2);
    expect(ho.side).toBe(me.side);
    expect(ho.col).toBe(me.col + 1);
    const taken = new Set(st.lots.map((l) => `${st.placeOf(l.id).col},${st.placeOf(l.id).side}`));
    expect(taken.size).toBe(st.lots.length);
  });
});
