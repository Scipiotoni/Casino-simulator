import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// No canvas here: textures and neon text are stand-ins.
vi.mock('../src/render/textures', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
  return {
    ...real,
    makeCanvas: () => ({ canvas: {}, ctx }),
    canvasTexture: () => new THREE.Texture(),
    asphaltTexture: () => new THREE.Texture(),
    sidewalkTexture: () => new THREE.Texture(),
    lotTexture: () => new THREE.Texture(),
    drawNeonText: () => undefined,
    roundRect: () => undefined,
  };
});

import { MIN_COLS, setRoadPlan, slotAt } from '../src/world/city';
import { type CityPlan, makePlan, onPlannedRoad, slotOpen } from '../src/world/plan';
import { Outskirts } from '../src/world/outskirts';
import { RoadNet } from '../src/world/roadNet';
import { CityView } from '../src/world/cityView';
import { groundAt } from '../src/world/terrain';

describe('traffic out of town', () => {
  const cols = MIN_COLS;
  let plan: CityPlan;
  let o: Outskirts;
  let net: RoadNet;
  beforeAll(() => {
    plan = makePlan(cols, (s) => slotOpen(s, cols));
    setRoadPlan({ cols, on: (x, z) => onPlannedRoad(plan, x, z), lot: (x, z) => { const s = slotAt(x, z, cols); return !!s && plan.has(s); } });
    o = new Outskirts();
    o.build(plan);
    const fast = new Set(o.highways.filter((h) => ['River Road', 'Mesa Drive', 'Interstate 15'].includes(h.name)).map((h) => h.road));
    net = new RoadNet(plan, o.roads, o.terrain, fast);
  });

  it('knows where every road goes', () => {
    const belt = net.roads[0];
    expect(belt.loop).toBe(true);
    // Roads from the streets out to the ring road (or on to another street): nothing leads nowhere.
    const exits = net.roads.filter((r) => r.ends.some((e) => e.kind === 'city' && e.edge >= 0));
    expect(exits.length).toBeGreaterThan(20);
    expect(exits.filter((r) => r.ends.some((e) => e.kind === 'road' && e.road === 0)).length).toBeGreaterThan(20);
    for (const r of exits) expect(r.ends.every((e) => e.kind !== 'dead'), JSON.stringify(r.ends)).toBe(true);
    // The highways leave from the ring road and end out in the country.
    for (const h of o.highways) {
      const r = net.roads[o.roads.indexOf(h.road)];
      expect(r.ends.some((e) => e.kind === 'road' && e.road === 0), h.name).toBe(true);
    }
    const i15 = net.roads[o.roads.indexOf(o.highways.find((h) => h.name === 'Interstate 15')!.road)];
    expect(i15.ends[1].kind).toBe('dead');
    expect(i15.speed).toBeGreaterThan(belt.speed);
    expect(belt.joins.length).toBeGreaterThan(exits.length);
    // Lanes sit on the road, on the right.
    const p = net.lane(0, 500, 1);
    const q = net.lane(0, 500, -1);
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(4);
    expect(Math.abs(p.y - groundAt(p.x, p.z))).toBeLessThan(0.3);
  });

  it('fills the highway round you with cars that drive on it', () => {
    const city = new CityView();
    city.build(plan);
    city.setRoads(net);
    const hw = o.highways.find((h) => h.name === 'Interstate 15')!.road;
    const me = hw.path.pointAt(hw.path.length * 0.55);
    city.player = { x: -9999, z: -9999 };
    for (let i = 0; i < 1200; i++) city.update(1 / 30, 1 / 30, me.x, me.z);
    const near = city.traffic.filter((c) => c.rd >= 0 && Math.hypot(c.x - me.x, c.z - me.z) < 330);
    expect(near.length).toBeGreaterThan(4);
    const onI15 = near.filter((c) => net.roads[c.rd].line === hw);
    expect(onI15.length).toBeGreaterThan(2);
    for (const c of near) {
      if (c.turn) continue;
      // On the road surface, not floating or buried.
      expect(Math.abs(c.root.position.y - groundAt(c.x, c.z))).toBeLessThan(0.5);
      expect(c.root.visible).toBe(true);
    }
    // Moving at highway speed (some are slowing behind others).
    expect(Math.max(...onI15.map((c) => c.speed))).toBeGreaterThan(15);
  });

  it('lets town traffic drive out onto the ring road and back', () => {
    const city = new CityView();
    city.build(plan);
    city.setRoads(net);
    // Stand by the edge of town, near the ring road.
    const belt = net.roads[0].path;
    const b = belt.pointAt(belt.length * 0.3);
    city.player = { x: -9999, z: -9999 };
    let out = 0;
    let back = 0;
    const was = new Map(city.traffic.map((c) => [c, c.rd >= 0]));
    for (let i = 0; i < 3000; i++) {
      city.update(1 / 30, 1 / 30, b.x, b.z);
      for (const c of city.traffic) {
        const now = c.rd >= 0;
        if (now && was.get(c) === false) out++;
        if (!now && was.get(c) === true) back++;
        was.set(c, now);
      }
    }
    expect(out).toBeGreaterThan(3);
    expect(back).toBeGreaterThan(3);
    // Nobody ends up somewhere silly.
    for (const c of city.traffic) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.root.position.y)).toBe(true);
    }
  });
});

describe('seats in a car', () => {
  it('fit the body: the driver first, the front passenger beside, then rows behind', async () => {
    const THREE = await import('three');
    const { seatSpots, seatsIn } = await import('../src/world/vehicles');
    expect(seatsIn('super')).toBe(2);
    expect(seatsIn('sedan')).toBe(4);
    expect(seatsIn('limo')).toBe(8);
    expect(seatsIn(null)).toBe(4);
    const driver = new THREE.Vector3(-0.38, 0.6, 0.3);
    const s = seatSpots('sedan', driver, 4.6);
    expect(s).toHaveLength(4);
    expect(s[0].equals(driver)).toBe(true);
    expect(s[1].x).toBeCloseTo(0.38);
    expect(s[1].z).toBeCloseTo(0.3);
    expect(s[2].x).toBeCloseTo(-0.38);
    expect(s[2].z).toBeLessThan(s[0].z - 0.7);
    expect(s[3].x).toBeCloseTo(0.38);
    // Everyone inside the car.
    for (const p of seatSpots('limo', driver, 7.5)) expect(Math.abs(p.z)).toBeLessThan(7.5 / 2);
  });
});
