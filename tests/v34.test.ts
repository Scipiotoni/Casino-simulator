import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Canvas textures need a DOM: hand the base and the models blank ones.
vi.mock('../src/render/textures', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  return {
    ...real,
    blobShadowTexture: () => new THREE.Texture(),
    makeCanvas: () => ({ canvas: {}, ctx }),
    canvasTexture: () => new THREE.Texture(),
    asphaltTexture: () => new THREE.Texture(),
  };
});

import { banPrice, BAN_CHOICES } from '../src/net/net';
import { punchPay } from '../src/game/activities';
import { Bricks, Flappy, Snake } from '../src/ui/games/arcade';
import { CARS, DEALER_CARS, MILITARY_CARS, buildCar, carHp, engineOf, repairCost } from '../src/world/vehicles';
import { conditionOf, crashDamage, sanitizeGarage, shotDamage } from '../src/game/driving';
import { BASE_HD, BASE_HW, MilitaryBase, baseSite, inBaseArea, type BaseHost } from '../src/world/militaryBase';
import { MIN_COLS, cityX, inWilds } from '../src/world/city';

describe('paying to blacklist', () => {
  it('costs more the longer the ban, with a discount for long ones', () => {
    const prices = BAN_CHOICES.map(banPrice);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    expect(banPrice(5)).toBe(2500);
    expect(banPrice(60)).toBeLessThan(60 * 500);
  });
});

describe('the punching bag pays', () => {
  it('pays per punch, more for a combo, nothing for mashing', () => {
    expect(punchPay(1, 1, 1)).toBeGreaterThan(0);
    expect(punchPay(1, 20, 0.5)).toBeGreaterThan(punchPay(1, 1, 0.5));
    expect(punchPay(10, 1, 1)).toBeGreaterThan(punchPay(1, 1, 1));
    expect(punchPay(5, 5, 0.1)).toBe(0);
    // The combo tops out at ×3.
    expect(punchPay(1, 999, 1)).toBe(punchPay(1, 21, 1));
  });
});

describe('games on the gaming monitor', () => {
  it('snake grows when it eats and dies at the wall', () => {
    const s = new Snake(() => 0.99);
    s.food = [9, 8];
    s.tick();
    expect(s.score).toBe(1);
    expect(s.body.length).toBe(4);
    // Can't turn straight back on yourself.
    s.turn(-1, 0);
    s.tick();
    expect(s.over).toBe(false);
    for (let i = 0; i < 20 && !s.over; i++) s.tick();
    expect(s.over).toBe(true);
  });

  it('flappy chip falls without flaps; bricks break', () => {
    const f = new Flappy(() => 0.5);
    f.flap();
    for (let i = 0; i < 200 && !f.over; i++) f.step(1 / 60);
    expect(f.over).toBe(true);
    const b = new Bricks();
    b.ball = { x: 30, y: 60, vx: 0, vy: -200 };
    for (let i = 0; i < 30; i++) b.step(1 / 60);
    expect(b.score).toBeGreaterThan(0);
  });
});

describe('more cars and the military vehicles', () => {
  it('the dealer sells more cars; military ones are base only', () => {
    expect(DEALER_CARS.length).toBeGreaterThanOrEqual(23);
    expect(MILITARY_CARS.map((c) => c.id).sort()).toEqual(['apc', 'jeep', 'stealth', 'tank']);
    expect(DEALER_CARS.some((c) => c.military)).toBe(false);
    expect(new Set(CARS.map((c) => c.id)).size).toBe(CARS.length);
  });

  it('the tank has a turret and a muzzle; the stealth racer is the fastest thing on wheels', () => {
    const tank = buildCar(CARS.find((c) => c.id === 'tank')!);
    expect(tank.turret).toBeTruthy();
    expect(tank.muzzle).toBeTruthy();
    const fastest = [...CARS].sort((a, b) => b.top - a.top)[0];
    expect(fastest.id).toBe('stealth');
  });

  it('engines sound like what they are', () => {
    expect(engineOf(CARS.find((c) => c.id === 'ev')!)).toBe('electric');
    expect(engineOf(CARS.find((c) => c.id === 'muscle')!)).toBe('v8');
    expect(engineOf(CARS.find((c) => c.id === 'tank')!)).toBe('tank');
    expect(engineOf(null)).toBe('four');
  });
});

describe('durability', () => {
  it('crashes and bullets wear cars down; armour soaks it up', () => {
    expect(crashDamage(3)).toBe(0);
    expect(crashDamage(20)).toBeGreaterThan(crashDamage(10));
    expect(crashDamage(20, 0.12)).toBeLessThan(crashDamage(20));
    const tank = CARS.find((c) => c.id === 'tank')!;
    const hatch = CARS.find((c) => c.id === 'hatch')!;
    expect(carHp(tank)).toBeGreaterThan(carHp(hatch) * 10);
    // A pistol needs a handful of shots on a hatchback, far more on a tank.
    const shotsHatch = Math.ceil(carHp(hatch) / shotDamage(24));
    const shotsTank = Math.ceil(carHp(tank) / shotDamage(24, tank.armor));
    expect(shotsHatch).toBeGreaterThanOrEqual(8);
    expect(shotsHatch).toBeLessThanOrEqual(15);
    expect(shotsTank).toBeGreaterThan(500);
    // Fixing a car costs 10% of what it cost (military ones by their value).
    expect(repairCost(hatch)).toBe(800);
    expect(repairCost(CARS.find((c) => c.id === 'hyper')!)).toBe(100_000);
    expect(repairCost(tank)).toBe(90_000);
    // Damage is remembered (saved) until it's repaired.
    const gs = sanitizeGarage({ owned: ['hatch', 'super'], hp: { hatch: 0.4, super: 0, bogus: 0.2, ev: 2 } });
    expect(conditionOf(gs, 'hatch')).toBe(0.4);
    expect(conditionOf(gs, 'super')).toBe(0);
    expect(conditionOf(gs, 'muscle')).toBe(1);
    expect(gs.hp?.bogus).toBeUndefined();
  });
});

type FakeHost = BaseHost & { pos: { x: number; z: number }; spawned: string[]; alarms: number };
function fakeHost(over: Partial<BaseHost> = {}): FakeHost {
  const h: FakeHost = {
    pos: { x: 0, z: 0 },
    spawned: [] as string[],
    alarms: 0,
    player() {
      return { x: h.pos.x, z: h.pos.z, exposed: true, height: 1.7, car: null };
    },
    lineOfSight: () => true,
    walkable: () => true,
    toWorld: (x: number, z: number) => ({ x, z }),
    shot: () => undefined,
    tracer: () => undefined,
    blast: () => undefined,
    spawnVehicle: (id: string) => {
      h.spawned.push(id);
      return h.spawned.length;
    },
    vehicleParked: () => true,
    alarm: () => {
      h.alarms++;
    },
    notify: () => undefined,
    ownsGun: () => false,
    ...over,
  };
  return h;
}

describe('Fort Mojave', () => {
  it('sits out in the western desert, clear of the city', () => {
    const s = baseSite(MIN_COLS);
    const [x0] = cityX(MIN_COLS);
    // Well past the ring road (it runs ~85-170 m out from the city's edge).
    expect(s.cx + BASE_HW).toBeLessThan(x0 - 250);
    expect(inWilds(s.cx + BASE_HW - 1, s.cz, MIN_COLS)).toBe(true);
    expect(inBaseArea(s.cx, s.cz, MIN_COLS)).toBe(true);
    expect(inBaseArea((s.roadX0 + s.roadX1) / 2, s.cz, MIN_COLS)).toBe(true);
    expect(inBaseArea(s.cx, s.cz + BASE_HD + 40, MIN_COLS)).toBe(false);
  });

  it('is fenced with an open gate, parks its vehicles and raises the alarm on trespassers', () => {
    const h = fakeHost();
    const base = new MilitaryBase(h);
    const s = baseSite(MIN_COLS);
    // Far away: vehicles get parked.
    h.pos = { x: s.cx + 400, z: s.cz };
    base.update(0.1, MIN_COLS, true);
    expect(h.spawned.sort()).toEqual(['apc', 'apc', 'jeep', 'jeep', 'jeep', 'stealth', 'tank']);
    // The fence blocks, the gate doesn't.
    expect(base.blocked(s.cx + BASE_HW, s.cz - 20)).toBe(true);
    expect(base.blocked(s.cx + BASE_HW, s.cz)).toBe(false);
    expect(base.blocked(s.cx, s.cz - BASE_HD)).toBe(true);
    // Walk in: a warning, then the alarm.
    h.pos = { x: s.cx, z: s.cz };
    for (let i = 0; i < 30; i++) base.update(0.1, MIN_COLS, true);
    expect(base.alarm).toBe(false);
    for (let i = 0; i < 80; i++) base.update(0.1, MIN_COLS, true);
    expect(base.alarm).toBe(true);
    expect(h.alarms).toBeGreaterThan(0);
  });

  it('soldiers can be shot down, and the alarm goes off', () => {
    const base = new MilitaryBase(fakeHost());
    base.build(MIN_COLS);
    const so = base.soldiers[0];
    const hits = base.raycast(so.x - 10, so.z, 1, 0, 30);
    expect(hits[0]?.soldier).toBe(so);
    expect(base.damage(so, 50)).toBe(false);
    expect(base.alarm).toBe(true);
    expect(base.damage(so, 100)).toBe(true);
    expect(so.ko).toBeGreaterThan(0);
  });
});

import { engineLoop } from '../src/core/audio';

describe('engine sound: real combustion pulses', () => {
  it('builds a clean loop that repeats at the firing rate', () => {
    const spec = { idle: 26, span: 190, res: 115, res2: 2.6, decay: 0.012, crack: 0.35, clatter: 0, jitter: 0.04, pattern: [1, 0.86, 0.97, 0.8], cut: 1, gain: 1 };
    const sr = 22050;
    const firing = 40;
    const d = engineLoop(spec, firing, sr);
    expect(d.every((x) => Number.isFinite(x))).toBe(true);
    const peak = d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeCloseTo(0.9, 2);
    // Autocorrelation is strongest one firing apart (not at some buzzy oscillator pitch).
    const period = Math.round(sr / firing);
    const ac = (lag: number) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[(i + lag) % d.length]; return s; };
    const atPeriod = ac(period);
    expect(atPeriod).toBeGreaterThan(ac(Math.round(period / 2)));
    expect(atPeriod).toBeGreaterThan(0);
  });
});

import { GUNS, falloff, gunDef, recoilStep, reloadPress, spreadMul } from '../src/game/guns';
import { hitDamage } from '../src/game/gunplay';
import { bountyFor, multiLabel, streakLabel } from '../src/game/combat';
import { buildGun } from '../src/items/models/guns';
import { sampleSnaps } from '../src/net/net';

describe('skill-based gunplay', () => {
  const rifle = gunDef('rifle')!;
  it('the first aimed shot is pinpoint; spraying and running bloom it open', () => {
    const first = spreadMul(rifle, 0, 0, true);
    const spray = spreadMul(rifle, 8, 0, true);
    const running = spreadMul(rifle, 0, 6, false);
    expect(first).toBeLessThan(0.2);
    expect(spray).toBeGreaterThan(first * 4);
    expect(running).toBeGreaterThan(spreadMul(rifle, 0, 0, false));
  });

  it('recoil climbs through a spray in a fixed, learnable pattern', () => {
    const a = recoilStep(rifle, 0);
    const b = recoilStep(rifle, 8);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(recoilStep(rifle, 5)).toEqual(recoilStep(rifle, 5));
  });

  it('damage falls off with distance; headshots hit harder; the sniper still one-shots heads', () => {
    expect(falloff(rifle, 5)).toBe(1);
    expect(falloff(rifle, rifle.range)).toBeCloseTo(0.55, 2);
    expect(falloff(gunDef('gl')!, 50)).toBe(1);
    expect(hitDamage(gunDef('deagle')!, true)).toBe(130);
    expect(hitDamage(gunDef('sniper')!, true)).toBe(999);
    // The marksman rifle is a sniper-type gun but not a one-shot.
    expect(hitDamage(gunDef('dmr')!, true)).toBeLessThan(999);
  });

  it('active reload: only the sweet spot is perfect', () => {
    expect(reloadPress(0.5)).toBe('perfect');
    expect(reloadPress(0.2)).toBe('fumble');
    expect(reloadPress(0.9)).toBe('fumble');
  });

  it('multi-KOs, streaks and bounties', () => {
    expect(multiLabel(1)).toBeNull();
    expect(multiLabel(2)).toBe('DOUBLE KO');
    expect(multiLabel(6)).toBe('RAMPAGE');
    expect(streakLabel(3)).toBe('KILLING SPREE');
    expect(bountyFor(2)).toBe(0);
    expect(bountyFor(4)).toBe(10_000);
  });
});

describe('more guns', () => {
  it('nine new weapons, each with a model and a muzzle', () => {
    for (const id of ['deagle', 'tommy', 'burst', 'dmr', 'lmg', 'gl', 'flamer', 'rpg', 'railgun']) {
      const d = gunDef(id)!;
      expect(d).toBeTruthy();
      const b = buildGun(d);
      expect(b.group.children.length).toBeGreaterThan(4);
      expect(b.muzzle.z).toBeGreaterThan(0.1);
    }
    expect(new Set(GUNS.map((g) => g.id)).size).toBe(GUNS.length);
    expect(gunDef('burst')!.burst).toBe(3);
    expect(gunDef('railgun')!.charge).toBeGreaterThan(0);
    expect(gunDef('rpg')!.explosive!.radius).toBeGreaterThan(gunDef('gl')!.explosive!.radius);
  });
});

describe('smooth movement of other players', () => {
  const buf = [
    { t: 1000, x: 0, z: 0, yaw: 0 },
    { t: 1100, x: 1, z: 0, yaw: 0 },
    { t: 1200, x: 2, z: 0, yaw: 0 },
  ];
  it('plays back between updates', () => {
    expect(sampleSnaps(buf, 1150)!.x).toBeCloseTo(1.5);
    expect(sampleSnaps(buf, 900)!.x).toBe(0);
  });
  it('glides a little past the last update, then waits', () => {
    expect(sampleSnaps(buf, 1250)!.x).toBeCloseTo(2.5);
    expect(sampleSnaps(buf, 5000)!.x).toBeCloseTo(4.5);
  });
  it('turns the short way round', () => {
    const b = [{ t: 0, x: 0, z: 0, yaw: 3.0 }, { t: 100, x: 0, z: 0, yaw: -3.0 }];
    expect(Math.abs(sampleSnaps(b, 50)!.yaw)).toBeGreaterThan(3);
  });
});
