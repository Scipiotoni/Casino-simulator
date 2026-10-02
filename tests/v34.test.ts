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
import { CARS, DEALER_CARS, MILITARY_CARS, buildCar, carHp, engineOf } from '../src/world/vehicles';
import { crashDamage, insuranceFee, shotDamage } from '../src/game/driving';
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
    expect(insuranceFee(hatch)).toBeGreaterThanOrEqual(500);
    expect(insuranceFee(tank)).toBe(25_000);
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
    spawnVehicle: (id: string) => {
      h.spawned.push(id);
      return h.spawned.length;
    },
    vehicleParked: () => true,
    alarm: () => {
      h.alarms++;
    },
    notify: () => undefined,
    ...over,
  };
  return h;
}

describe('Fort Mojave', () => {
  it('sits out in the western desert, clear of the city', () => {
    const s = baseSite(MIN_COLS);
    const [x0] = cityX(MIN_COLS);
    expect(s.cx + BASE_HW).toBeLessThan(x0 - 70);
    expect(inWilds(s.cx - BASE_HW + 1, s.cz, MIN_COLS)).toBe(true);
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
    expect(h.spawned.sort()).toEqual(['apc', 'jeep', 'jeep', 'stealth', 'tank']);
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
