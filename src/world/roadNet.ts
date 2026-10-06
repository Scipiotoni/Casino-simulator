import { ROAD_HALF, avenueMid, avenueX, streetZ } from './city';
import type { CityPlan, Path } from './plan';
import type { RoadLine, Terrain } from './terrain';

/**
 * The roads out of town as something cars can drive: the ring road, the roads from the
 * streets out to it and the highways, each with its lanes, its speed and where its ends go
 * (onto another road, into a city street, or nowhere: turn round).
 */

export type Axis = 'x' | 'z';

/** Lane centre from the middle of a city street (drive on the right). */
export const CITY_LANE = 2.2;

/** Where the end of a road goes. */
export type NetEnd =
  | { kind: 'dead' }
  /** Onto road `road`, at distance `s` along it. */
  | { kind: 'road'; road: number; s: number }
  /** Into a city street (x) or avenue (z) at `pos` along it; `edge` = it's that road's lo (0) or hi (1) end. */
  | { kind: 'city'; axis: Axis; line: number; pos: number; edge: 0 | 1 | -1 };

/** Another road starting or ending on this one. */
export interface Junction {
  /** Where along this road. */
  s: number;
  road: number;
  /** Which end of that road (0 start, 1 end) is here. */
  end: 0 | 1;
  /** How far along that road it's clear of this one (cars turn in to here, and wait here to turn out). */
  clear: number;
}

export interface NetRoad {
  path: Path;
  line: RoadLine;
  /** Lane centre from the middle of the road. */
  lane: number;
  loop: boolean;
  /** Cruising speed (m/s) for an ordinary car. */
  speed: number;
  ends: [NetEnd, NetEnd];
  /** Roads joining this one, by distance along it. */
  joins: Junction[];
}

/** A point on a road: where, which way the road runs there, and its height. */
export interface LanePoint {
  x: number;
  z: number;
  y: number;
  /** Heading of travel (unit). */
  dx: number;
  dz: number;
  /** Rise per metre in the direction of travel. */
  grade: number;
}

export class RoadNet {
  readonly roads: NetRoad[] = [];
  /** City roads that carry on out of town: `${axis}${line}:${edge}` → the road and which way out. */
  private exits = new Map<string, { road: number; s: number; dir: 1 | -1 }>();
  /** Spawn spots every few metres along every road. */
  private spots: { road: number; s: number; x: number; z: number }[] = [];

  constructor(readonly plan: CityPlan, lines: RoadLine[], readonly terrain: Terrain | null, fast: Set<RoadLine> = new Set()) {
    lines.forEach((line, i) => {
      const p0 = line.path.pts[0];
      const p1 = line.path.pts[line.path.pts.length - 1];
      const loop = Math.hypot(p0.x - p1.x, p0.z - p1.z) < 1;
      const speed = i === 0 ? 17 : fast.has(line) ? 23 : line.half >= 5 ? 14 : 11;
      // Narrow roads keep the city's lanes (cars carry straight on between them).
      const lane = line.half <= ROAD_HALF ? CITY_LANE : Math.min(2.6, line.half * 0.45);
      this.roads.push({ path: line.path, line, lane, loop, speed, ends: [{ kind: 'dead' }, { kind: 'dead' }], joins: [] });
    });
    this.roads.forEach((r, i) => {
      if (r.loop) return;
      for (const end of [0, 1] as const) r.ends[end] = this.link(i, end);
    });
    for (const r of this.roads) r.joins.sort((a, b) => a.s - b.s);
    this.roads.forEach((r, i) => {
      for (let s = 10; s < r.path.length - 10; s += 20) {
        const p = r.path.pointAt(s);
        this.spots.push({ road: i, s, x: p.x, z: p.z });
      }
    });
  }

  /** What the end of road `i` runs into. */
  private link(i: number, end: 0 | 1): NetEnd {
    const r = this.roads[i];
    const pts = r.path.pts;
    const p = end === 0 ? pts[0] : pts[pts.length - 1];
    // A city street or avenue.
    const plan = this.plan;
    for (let k = 0; k < plan.streets.length; k++) {
      const st = plan.streets[k];
      // Within the street's width (a road can run into its side).
      if (!st || Math.abs(p.z - streetZ(k)) > 10 || p.x < st.xa - 3 || p.x > st.xb + 3) continue;
      const edge = Math.abs(p.x - st.xa) < 3 ? 0 : Math.abs(p.x - st.xb) < 3 ? 1 : -1;
      if (edge >= 0) this.exits.set(`x${k}:${edge}`, { road: i, s: end === 0 ? 0 : r.path.length, dir: end === 0 ? 1 : -1 });
      return { kind: 'city', axis: 'x', line: k, pos: Math.max(st.xa, Math.min(st.xb, p.x)), edge };
    }
    for (let k = 0; k < plan.avenues.length; k++) {
      const av = plan.avenues[k];
      const [xa, xb] = avenueX(k);
      if (!av || Math.abs(p.x - avenueMid(k)) > (xb - xa) / 2 + 1 || p.z < av.za - 3 || p.z > av.zb + 3) continue;
      const edge = Math.abs(p.z - av.za) < 3 ? 0 : Math.abs(p.z - av.zb) < 3 ? 1 : -1;
      if (edge >= 0) this.exits.set(`z${k}:${edge}`, { road: i, s: end === 0 ? 0 : r.path.length, dir: end === 0 ? 1 : -1 });
      return { kind: 'city', axis: 'z', line: k, pos: Math.max(av.za, Math.min(av.zb, p.z)), edge };
    }
    // Another road (the ring road first).
    for (let j = 0; j < this.roads.length; j++) {
      if (j === i) continue;
      const o = this.roads[j];
      const n = o.path.nearest(p.x, p.z, o.line.half + 4);
      if (!n) continue;
      // Drive in along this road until clear of the other one.
      let clear = -1;
      for (let d = 2; d < r.path.length - 2; d += 2) {
        const s = end === 0 ? d : r.path.length - d;
        const q = r.path.pointAt(s);
        if (!o.path.nearest(q.x, q.z, o.line.half + r.lane + 5)) {
          clear = s;
          break;
        }
      }
      if (clear < 0) continue;
      o.joins.push({ s: n.s, road: i, end, clear });
      return { kind: 'road', road: j, s: n.s };
    }
    return { kind: 'dead' };
  }

  /** The road that carries on out of town from the lo (0) or hi (1) end of a street or avenue. */
  exit(axis: Axis, line: number, edge: 0 | 1): { road: number; s: number; dir: 1 | -1 } | null {
    return this.exits.get(`${axis}${line}:${edge}`) ?? null;
  }

  /** Distance along a road, wrapped round if it's a loop (clamped otherwise). */
  wrap(road: number, s: number): number {
    const r = this.roads[road];
    const L = r.path.length;
    if (r.loop) return ((s % L) + L) % L;
    return Math.max(0, Math.min(L, s));
  }

  /** Signed distance from `a` to `b` along a road going `dir` (the short way round a loop). */
  ahead(road: number, a: number, b: number, dir: 1 | -1): number {
    const r = this.roads[road];
    let d = (b - a) * dir;
    if (r.loop) {
      const L = r.path.length;
      d = ((d % L) + L) % L;
      if (d > L / 2) d -= L;
    }
    return d;
  }

  /** Height of a road's surface. */
  y(road: number, s: number): number {
    const r = this.roads[road];
    return this.terrain ? this.terrain.roadY(r.line, this.wrap(road, s)) : 0;
  }

  /** The middle of the lane going `dir` at distance `s`. */
  lane(road: number, s: number, dir: 1 | -1): LanePoint {
    const r = this.roads[road];
    const at = this.wrap(road, s);
    const p = r.path.pointAt(at);
    const dx = p.dx * dir;
    const dz = p.dz * dir;
    // Drive on the right: right of the heading is (-dz, dx).
    const y = this.y(road, at);
    const ya = this.y(road, at + dir * 3);
    const yb = this.y(road, at - dir * 3);
    return { x: p.x - dz * r.lane, z: p.z + dx * r.lane, y, dx, dz, grade: (ya - yb) / 6 };
  }

  /** Spots on the roads between `r0` and `r1` metres from (x, z). */
  spotsNear(x: number, z: number, r0: number, r1: number): { road: number; s: number; x: number; z: number }[] {
    const out: { road: number; s: number; x: number; z: number }[] = [];
    const a = r0 * r0;
    const b = r1 * r1;
    for (const p of this.spots) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (Math.abs(dx) > r1 || Math.abs(dz) > r1) continue;
      const d = dx * dx + dz * dz;
      if (d >= a && d <= b) out.push(p);
    }
    return out;
  }
}
