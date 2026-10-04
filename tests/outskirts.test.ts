import { describe, expect, it } from 'vitest';
import { MIN_COLS, STREET_ROWS, WILDS, cityX, cityZ, inWilds, onRoadNetwork, openGround, setWildsObstacles } from '../src/world/city';
import { sunDirection } from '../src/world/sky';

describe('a bigger city with open desert around it', () => {
  it('has twelve streets and at least sixteen blocks', () => {
    expect(STREET_ROWS).toBe(12);
    expect(MIN_COLS).toBeGreaterThanOrEqual(64);
  });

  it('lets you walk past the city edge into the desert, up to the mountains', () => {
    const [x0, x1] = cityX(MIN_COLS);
    const [z0, z1] = cityZ();
    const mz = (z0 + z1) / 2;
    expect(onRoadNetwork(x0 - 20, mz, MIN_COLS)).toBe(false);
    expect(openGround(x0 - 20, mz, MIN_COLS)).toBe(true);
    expect(openGround(x1 + WILDS - 5, mz, MIN_COLS)).toBe(true);
    expect(openGround(x1 + WILDS + 5, mz, MIN_COLS)).toBe(false);
    expect(inWilds((x0 + x1) / 2, z0 - 100, MIN_COLS)).toBe(true);
    // Inside the city it's the streets only (no walking through buildings).
    expect(inWilds((x0 + x1) / 2, mz, MIN_COLS)).toBe(false);
  });

  it('keeps you out of rocks and landmarks', () => {
    const [x0] = cityX(MIN_COLS);
    setWildsObstacles((x, z) => Math.hypot(x - (x0 - 50), z) < 2);
    expect(openGround(x0 - 50, 0, MIN_COLS)).toBe(false);
    expect(openGround(x0 - 55, 0, MIN_COLS)).toBe(true);
    setWildsObstacles(null);
    expect(openGround(x0 - 50, 0, MIN_COLS)).toBe(true);
  });
});

describe('the sun follows the clock', () => {
  it('rises in the east around 6:00, is high at noon and sets in the west around 20:00', () => {
    const dawn = sunDirection(6 * 60 + 5);
    const noon = sunDirection(13 * 60);
    const dusk = sunDirection(19 * 60 + 55);
    const night = sunDirection(1 * 60);
    expect(dawn.x).toBeGreaterThan(0.9);
    expect(Math.abs(dawn.y)).toBeLessThan(0.05);
    expect(noon.y).toBeGreaterThan(0.75);
    expect(dusk.x).toBeLessThan(-0.9);
    expect(night.y).toBeLessThan(-0.5);
  });
});

import { GARAGE_TIERS, garageTier, sanitizeParked } from '../src/game/house';

describe('the home garage', () => {
  it('has three sizes that hold more cars and cost more', () => {
    expect(GARAGE_TIERS.map((t) => t.cap)).toEqual([2, 4, 6]);
    for (let i = 1; i < GARAGE_TIERS.length; i++) expect(GARAGE_TIERS[i].price).toBeGreaterThan(GARAGE_TIERS[i - 1].price);
    expect(garageTier(0)).toBeNull();
    expect(garageTier(2)?.name).toBe('Four-Car Garage');
  });

  it('keeps parked cars sane when loading a save', () => {
    const raw = [{ id: 'super' }, { id: 'super' }, { kind: 2, color: 0xff0000 }, { kind: 99, color: -5 }, 'junk', { id: 'x'.repeat(40) }, { id: 'hatch' }];
    const out = sanitizeParked(raw, 4, (id) => id === 'super' || id === 'hatch');
    expect(out).toEqual([{ id: 'super' }, { kind: 2, color: 0xff0000 }, { kind: 4, color: 0 }, { id: 'hatch' }]);
    expect(sanitizeParked(raw, 1)).toHaveLength(1);
    expect(sanitizeParked(undefined, 4)).toEqual([]);
  });
});

import { GUN_SKINS, gunDef as gd, sanitizeGunMods, tunedGun, gunTakes, gunModsSummary, sanitizeGuns as sg } from '../src/game/guns';

describe('gun customization', () => {
  it('attachments change the stats the way the workbench says', () => {
    const rifle = gd('rifle')!;
    const stock = tunedGun(rifle, null);
    expect(stock.mag).toBe(rifle.mag);
    const t = tunedGun(rifle, { skin: 'gold', sight: 'scope', muzzle: 'suppressor', mag: 'drum', laser: true, charm: 'dice' });
    expect(t.mag).toBe(rifle.mag * 2);
    expect(t.reload).toBeGreaterThan(rifle.reload);
    expect(t.quiet).toBe(true);
    expect(t.adsFov).toBeLessThanOrEqual(24);
    expect(t.adsAcc).toBeLessThan(1);
    expect(t.range).toBeLessThan(rifle.range);
    expect(tunedGun(rifle, { ...t.mods, muzzle: 'compensator' }).kickMul).toBeLessThan(1);
    expect(gunModsSummary(t.mods)).toContain('24K Gold');
  });

  it('melee weapons only take skins and charms; bad saves are cleaned', () => {
    const bat = gd('bat')!;
    expect(gunTakes(bat)).toEqual({ sight: false, muzzle: false, mag: false, laser: false });
    expect(sanitizeGunMods(bat, { skin: 'galaxy', sight: 'scope', mag: 'drum', laser: true, charm: 'skull' })).toEqual({ skin: 'galaxy', sight: 'iron', muzzle: 'none', mag: 'standard', laser: false, charm: 'skull' });
    expect(sanitizeGunMods(gd('pistol')!, { skin: 'nope', sight: 'x', laser: 'yes' }).skin).toBe('stock');
    expect(GUN_SKINS[0].price).toBe(0);
    // Mods survive a save only for guns you own.
    const st = sg({ owned: ['pistol'], mods: { pistol: { skin: 'chrome' }, rifle: { skin: 'gold' } } });
    expect(st.mods.pistol.skin).toBe('chrome');
    expect(st.mods.rifle).toBeUndefined();
  });
});

import { decodeGunMods, encodeGunMods } from '../src/game/guns';

describe('gun mods over the network', () => {
  it('round-trip in a few characters, and junk decodes to stock', () => {
    const rifle = gd('rifle')!;
    const m = { skin: 'galaxy', sight: 'holo', muzzle: 'compensator', mag: 'extended', laser: true, charm: 'cherry' } as const;
    const code = encodeGunMods({ ...m });
    expect(code.length).toBeLessThan(16);
    expect(decodeGunMods(rifle, code)).toEqual(m);
    expect(decodeGunMods(rifle, 'x.y')).toEqual(decodeGunMods(rifle, ''));
    expect(decodeGunMods(rifle, 42).skin).toBe('stock');
    // A bat can't carry a scope even if a peer says so.
    expect(decodeGunMods(gd('bat')!, code).sight).toBe('iron');
  });
});

import { creditBase } from '../src/net/net';
import { MAX_BANK } from '../src/game/game';

describe('visitor ledgers never wipe your bank', () => {
  it('a visitor whose running total restarted is counted from zero, not as a huge win', () => {
    // Same running total: normal difference.
    expect(creditBase(5_000_000, 'a1', 'a1', 5_000_400)).toBe(5_000_000);
    // They lost their browser storage (new id): rebase.
    expect(creditBase(5_000_000, 'a1', 'b2', 300)).toBe(0);
    // First time we see an id, or an old game without one, and the total collapsed: rebase.
    expect(creditBase(5_000_000, undefined, 'b2', 300)).toBe(0);
    expect(creditBase(5_000_000, undefined, '', 300)).toBe(0);
    // A visitor really winning a bit back is still paid out.
    expect(creditBase(100_000, 'a1', 'a1', 80_000)).toBe(100_000);
  });

  it('banks top out at 20 million', () => {
    expect(MAX_BANK).toBe(20_000_000);
  });
});

import { vi } from 'vitest';
import * as THREE from 'three';
vi.mock('../src/render/textures', async (orig) => ({ ...(await orig<object>()), blobShadowTexture: () => new THREE.Texture() }));
import { CharacterModel } from '../src/entities/characterModel';
import { defaultAppearance } from '../src/entities/appearance';

describe('square heads only in Ult', () => {
  it('a crude NPC goes back to the full model (and back again)', () => {
    const count = (m: CharacterModel) => { let n = 0; m.root.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh && o.visible) n++; }); return n; };
    const m = new CharacterModel(defaultAppearance(), { crude: true });
    const crude = count(m);
    expect(m.crudeBody).toBe(true);
    m.setCrude(false);
    expect(m.crudeBody).toBe(false);
    expect(count(m)).toBeGreaterThan(crude);
    m.setCrude(true);
    expect(count(m)).toBe(crude);
  });
});

import { hitDamage } from '../src/game/gunplay';
import { LESSONS } from '../src/ui/games/lessons';

describe('shotgun, sniper and lessons', () => {
  it('the sniper is exact and one headshot knocks anyone out; the shotgun hits harder and wider', () => {
    const sn = gd('sniper')!;
    const sg = gd('shotgun')!;
    expect(sn.spread).toBe(0);
    expect(hitDamage(sn, true)).toBeGreaterThanOrEqual(999);
    expect(hitDamage(sn, false)).toBe(sn.dmg);
    expect(sg.pellets * sg.dmg).toBeGreaterThanOrEqual(200);
    expect(sg.spread).toBeGreaterThanOrEqual(0.2);
    expect(hitDamage(gd('pistol')!, true)).toBe(gd('pistol')!.dmg * 2);
  });

  it('every casino game has a lesson', () => {
    for (const k of ['slot', 'blackjack', 'poker', 'roulette', 'craps', 'wheel', 'baccarat', 'videopoker', 'threecard', 'sicbo', 'keno']) {
      expect(LESSONS[k]?.steps.length).toBeGreaterThan(1);
      expect(LESSONS[k]?.pays.length).toBeGreaterThan(0);
    }
  });
});

import { GEARS, autoGear, drive, gearTop, rpmOf } from '../src/game/gearbox';
import { Police } from '../src/world/police';
import { streetZ } from '../src/world/city';

describe('gearbox', () => {
  it('low gears pull harder but top out early; the automatic shifts up and down', () => {
    const top = 40;
    expect(GEARS).toBe(5);
    expect(gearTop(top, 1)).toBeLessThan(gearTop(top, 5));
    expect(gearTop(top, 5)).toBe(top);
    expect(drive(5, top, 1)).toBeGreaterThan(drive(5, top, 4));
    expect(drive(gearTop(top, 2), top, 2)).toBe(0); // limiter
    expect(rpmOf(gearTop(top, 3), top, 3)).toBeCloseTo(1);
    expect(autoGear(1, gearTop(top, 1) * 0.97, top)).toBe(2);
    expect(autoGear(4, 3, top)).toBe(3);
    expect(autoGear(5, top * 0.9, top)).toBe(5);
  });
});

describe('police pursuit', () => {
  it('cruisers chase your car, and the stars climb the longer they see you', () => {
    const pol = new Police();
    pol.cols = 20;
    pol.heat = 1.2;
    pol.sinceCrime = 0;
    const car = { x: 200, z: streetZ(0), yaw: Math.PI / 2, speed: 12 };
    const view = {
      px: car.x, pz: car.z, exposed: true, speed: 12, height: 1.7,
      toWorld: (x: number, z: number) => ({ x, z }), onShot: () => undefined, onTracer: () => undefined,
      car, onRam: () => undefined,
    };
    let closest = Infinity;
    for (let i = 0; i < 1800; i++) {
      car.x += Math.sin(car.yaw) * car.speed / 30;
      if (car.x > 700) car.yaw = -Math.PI / 2;
      if (car.x < 100) car.yaw = Math.PI / 2;
      view.px = car.x;
      pol.update(1 / 30, view, true);
      for (const d of pol.dots) if (d.car) closest = Math.min(closest, Math.hypot(d.x - car.x, d.z - car.z));
    }
    expect(closest).toBeLessThan(25);
    expect(pol.seenTime).toBeGreaterThan(5);
    expect(pol.stars).toBeGreaterThanOrEqual(2);
  });
});

import { CARS, buildCar } from '../src/world/vehicles';
import { carsTouch } from '../src/game/driving';

describe('more cars, smaller hitboxes', () => {
  it('every car on sale builds, with a unique id', () => {
    expect(CARS.length).toBeGreaterThanOrEqual(17);
    expect(new Set(CARS.map((c) => c.id)).size).toBe(CARS.length);
    for (const c of CARS) {
      const m = buildCar(c);
      expect(m.wheels.length).toBeGreaterThanOrEqual(4);
      expect(m.length).toBeGreaterThan(3);
    }
  });

  it('cars in the next lane pass; bumpers touch', () => {
    const v = { x: 0, z: 0, yaw: Math.PI / 2, length: 4.5, width: 1.95 };
    expect(carsTouch(v, 0, 3, 4.5)).toBe(false); // side by side, one lane over
    expect(carsTouch(v, 3.5, 0, 4.5)).toBe(true); // nose to tail
    expect(carsTouch(v, 4.6, 0, 4.5)).toBe(false); // a car length ahead
  });
});
