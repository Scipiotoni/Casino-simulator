import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// No canvas here: textures and neon text are stand-ins.
vi.mock('../src/render/textures', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined), set: () => true });
  return {
    ...real,
    makeCanvas: () => ({ canvas: {}, ctx }),
    canvasTexture: () => new THREE.Texture(),
    asphaltTexture: () => new THREE.Texture(),
    lotTexture: () => new THREE.Texture(),
    drawNeonText: () => undefined,
    roundRect: () => undefined,
  };
});

import { MIN_COLS, STREET_ROWS, avenueMid, cityX, cityZ, inWilds, openGround, setRoadPlan, setWilds, slotAt, streetZ } from '../src/world/city';
import { type CityPlan, makePlan, onPlannedRoad, slotOpen } from '../src/world/plan';
import { Outskirts } from '../src/world/outskirts';
import { baseSite } from '../src/world/militaryBase';
import { CITY_GROUND, MAX_SLOPE, Terrain, groundAt, landform, setTerrain } from '../src/world/terrain';

describe('the land round the city', () => {
  const cols = MIN_COLS;
  let plan: CityPlan;
  let o: Outskirts;
  let t: Terrain;
  beforeAll(() => {
    plan = makePlan(cols, (s) => slotOpen(s, cols));
    setRoadPlan({ cols, on: (x, z) => onPlannedRoad(plan, x, z), lot: (x, z) => { const s = slotAt(x, z, cols); return !!s && plan.has(s); } });
    o = new Outskirts();
    o.build(plan);
    t = o.terrain!;
  });

  it('is flat under the whole city and rises into real landforms beyond', () => {
    const [x0, x1] = cityX(cols);
    const [z0, z1] = cityZ();
    for (let r = 0; r < STREET_ROWS; r++) {
      const st = plan.streets[r];
      if (st) expect(groundAt((st.xa + st.xb) / 2, streetZ(r))).toBe(0);
    }
    // Mountains up in the north-west, mesas east, the plain in between.
    let peak = 0;
    for (let i = 0; i < t.nx * t.nz; i++) peak = Math.max(peak, t.h[i]);
    expect(peak).toBeGreaterThan(250);
    expect(t.sample(x0 - 1800, z0 - 1800)).toBeGreaterThan(60);
    expect(Math.abs(t.sample((x0 + x1) / 2, (z0 + z1) / 2) - CITY_GROUND)).toBeLessThan(0.01);
    // Deterministic: everyone gets the same land.
    expect(landform(1234, -567, 900)).toBe(landform(1234, -567, 900));
  });

  it('can be walked where it is not too steep, and not in the river', () => {
    let walk = 0;
    let steep = 0;
    let n = 0;
    for (let j = 0; j < t.nz; j += 4) {
      for (let i = 0; i < t.nx; i += 4) {
        const x = t.x0 + i * t.step;
        const z = t.z0 + j * t.step;
        if (!t.inBounds(x, z)) continue;
        n++;
        if (t.walkable(x, z)) walk++;
        if (t.slopeAt(x, z) >= MAX_SLOPE) steep++;
      }
    }
    expect(walk / n).toBeGreaterThan(0.6);
    expect(steep).toBeGreaterThan(0);
    // Mid-river, in town: water.
    const mid = t.river.pointAt((t.sIn + t.sOut) / 2);
    expect(t.inRiverWater(mid.x, mid.z)).toBe(true);
    expect(t.walkable(mid.x, mid.z)).toBe(false);
  });

  it('has a ring road that never runs through a lot or a street', () => {
    const belt = o.belt!;
    expect(belt.length).toBeGreaterThan(6000);
    for (const p of belt.pts) {
      const s = slotAt(p.x, p.z, cols);
      expect(!!s && plan.has(s)).toBe(false);
      expect(t.cityDist(p.x, p.z)).toBeGreaterThan(12);
    }
    // Every street that ends at the edge of town has a road on out to it.
    expect(o.roads.length).toBeGreaterThan(20);
  });

  it('lays the highways in at gentle grades and you stand on them', () => {
    const names = o.highways.map((h) => h.name);
    expect(names).toEqual(expect.arrayContaining(['River Road', 'Mesa Drive', 'Interstate 15']));
    for (const h of o.highways) {
      const p = h.road.profile!;
      for (let i = 1; i < p.length; i++) {
        const ds = h.road.path.at[i] - h.road.path.at[i - 1];
        expect(Math.abs(p[i] - p[i - 1]) / ds).toBeLessThan((h.road.grade ?? 0.07) + 0.002);
      }
      const q = h.road.path.pointAt(h.road.path.length / 2);
      expect(t.walkable(q.x, q.z)).toBe(true);
      expect(Math.abs(groundAt(q.x, q.z) - t.roadY(h.road, h.road.path.length / 2))).toBeLessThan(0.1);
    }
    // River Road climbs up the canyon into the mountains; Mesa Drive ends up on the overlook.
    const river = o.highways.find((h) => h.name === 'River Road')!;
    expect(Math.max(...river.road.profile!)).toBeGreaterThan(40);
    const ov = o.overlook!;
    expect(groundAt(ov.x, ov.z)).toBeGreaterThan(15);
  });

  it('bridges the river where streets and roads cross it', () => {
    // Somewhere a street crosses the river: a bridge at street level.
    let bridges = 0;
    plan.streets.forEach((st, r) => {
      if (!st) return;
      for (let x = st.xa; x < st.xb; x += 2) {
        if (t.inRiverWater(x, streetZ(r))) {
          bridges++;
          expect(groundAt(x, streetZ(r))).toBe(0);
          expect(openGround(x, streetZ(r), cols)).toBe(true);
          break;
        }
      }
    });
    plan.avenues.forEach((av, k) => {
      if (!av) return;
      for (let z = av.za; z < av.zb; z += 2) {
        if (t.inRiverWater(avenueMid(k), z)) {
          bridges++;
          expect(openGround(avenueMid(k), z, cols)).toBe(true);
          break;
        }
      }
    });
    expect(bridges).toBeGreaterThan(4);
    // The riverside walk is level with the street, the water well below it.
    const s = (t.sIn + t.sOut) / 2;
    const p = t.river.pointAt(s);
    const off = t.riverHalf(s) + 6;
    const wx = p.x - p.dz * off;
    const wz = p.z + p.dx * off;
    if (!onPlannedRoad(plan, wx, wz)) expect(groundAt(wx, wz)).toBe(0);
    expect(t.riverLevel(s)).toBeLessThan(-1.5);
  });

  it('runs the river downhill all the way from the canyon to the lake', () => {
    let last = Infinity;
    for (let s = 0; s <= t.river.length; s += 50) {
      const y = t.riverLevel(s);
      expect(y).toBeLessThanOrEqual(last + 1e-4);
      last = y;
    }
    expect(t.riverLevel(0)).toBeGreaterThan(20);
  });

  it('keeps Fort Mojave and the lake on level ground you can reach', () => {
    const b = baseSite(cols);
    expect(groundAt(b.cx, b.cz)).toBe(0);
    expect(inWilds(b.roadX1 + 20, b.cz, cols)).toBe(true);
    const l = o.lake!;
    expect(o.inWater(l.x, l.z)).toBe(true);
    expect(o.groundAt(l.pierX, (l.pierZ0 + l.pierZ1) / 2)).toBeCloseTo(0.2, 5);
    expect(groundAt(l.x, l.z - l.rz - 30)).toBe(0);
  });

  it('draws the land in a few hundred tiles, coarser far away', () => {
    const [x0, x1] = cityX(cols);
    const [z0, z1] = cityZ();
    o.lod((x0 + x1) / 2, (z0 + z1) / 2);
    const near = o.terrainTriangles();
    expect(near).toBeGreaterThan(10_000);
    expect(near).toBeLessThan(150_000);
  });

  it('stops being in charge when unset', () => {
    setTerrain(null);
    setWilds(null);
    expect(groundAt(-5000, -5000)).toBe(0);
  });
});
