import * as THREE from 'three';
import { CharacterModel } from '../entities/characterModel';
import { randomCustomerAppearance, touristAppearance, vipAppearance } from '../entities/appearance';
import { AVE_WALK, ROAD_HALF, STREET_ROWS, avenueX, blocksFor, streetZ } from './city';

/** A door on the street people walk in and out of (global frame). */
export interface DoorSpot {
  lotId: string;
  /** Just inside the doorway. */
  x: number;
  z: number;
  /** In front of it, on the middle of the sidewalk. */
  wx: number;
  wz: number;
  row: number;
  /** How busy it is (casinos and hotels draw crowds). */
  weight: number;
}

export interface Ped {
  model: CharacterModel;
  x: number;
  z: number;
  route: { x: number; z: number }[];
  i: number;
  speed: number;
  /** Walks into a door at the end of the route (vanishes there). */
  enters: boolean;
  panic: number;
  fade: number;
  /** Health (out of 60), and seconds left lying knocked out. */
  hp: number;
  ko: number;
  /** Cash in their pockets. */
  cash: number;
  /** Squaring up to you after you threw a punch at them. */
  fight?: Brawler;
}

/** A passer-by who fights back: winds up (your cue to parry), throws a punch, recovers. */
export interface Brawler {
  /** Seconds left winding up a punch (0 = not swinging). */
  wind: number;
  /** Seconds before they can swing again. */
  cool: number;
  /** Seconds left stunned (after you parry or stagger them). */
  stun: number;
  /** They give up after a while. */
  life: number;
}

/** How long a brawler winds up a punch: the window you have to block or parry it. */
export const BRAWL_WINDUP = 0.55;
export const BRAWL_REACH = 1.5;

/** Middle of the sidewalk on one side of a street. */
function walkZ(row: number, side: number): number {
  return streetZ(row) + (side ? 1 : -1) * (ROAD_HALF + 2.3);
}

/**
 * Passers-by on the city sidewalks: they come out of casinos, hotels and shops, stroll
 * along, cross at the crosswalks and walk into other buildings, so the whole city feels
 * busy wherever you are. People near gunfire run.
 */
export class Crowd {
  readonly group = new THREE.Group();
  private peds: Ped[] = [];

  /** Rebuild everyone on the sidewalks crude (Ult) or in full detail. */
  setCrude(on: boolean): void {
    for (const p of this.peds) p.model.setCrude(on);
  }
  private spawnT = 0;
  /** Where you are (global), for brawlers to come after; null when you're not out on the street. */
  foe: { x: number; z: number } | null = null;
  /** A brawler's punch reaches you: returns how you met it ('parry' stuns them). */
  onPunch: ((p: Ped, dmg: number) => string) | null = null;
  /** A brawler starts winding up, or squares up (for a little "!" over their head). */
  onTell: ((p: Ped, text: string) => void) | null = null;
  /** How many people to keep around the camera. */
  target = 20;
  cols = 12;

  private nearestRow(z: number): number {
    let best = 0;
    for (let r = 1; r < STREET_ROWS; r++) if (Math.abs(streetZ(r) - z) < Math.abs(streetZ(best) - z)) best = r;
    return best;
  }

  /** Crosswalk x positions (both sides of every avenue). */
  private crossings(): number[] {
    const out: number[] = [];
    for (let k = 0; k <= blocksFor(this.cols); k++) {
      const [a, b] = avenueX(k);
      out.push(a + AVE_WALK - 1.3 + 0.3, b - AVE_WALK + 1.3 - 0.3);
    }
    return out;
  }

  /** Sidewalk route from a point on a street's sidewalk to another sidewalk point (crossing if needed). */
  private routeTo(fromX: number, fromZ: number, toX: number, toZ: number, row: number): { x: number; z: number }[] {
    const fromSide = fromZ > streetZ(row) ? 1 : 0;
    const toSide = toZ > streetZ(row) ? 1 : 0;
    const za = walkZ(row, fromSide);
    const zb = walkZ(row, toSide);
    if (fromSide === toSide) return [{ x: toX, z: zb }];
    const xs = this.crossings();
    const mid = (fromX + toX) / 2;
    const cx = xs.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a), xs[0]);
    return [{ x: cx, z: za }, { x: cx, z: zb }, { x: toX, z: zb }];
  }

  private pickDoor(doors: DoorSpot[], row: number, fx: number, not?: string): DoorSpot | null {
    const near = doors.filter((d) => d.row === row && d.lotId !== not && Math.abs(d.wx - fx) < 85);
    const total = near.reduce((a, d) => a + d.weight, 0);
    let r = Math.random() * total;
    for (const d of near) {
      r -= d.weight;
      if (r <= 0) return d;
    }
    return null;
  }

  private spawn(doors: DoorSpot[], fx: number, fz: number): void {
    const row = this.nearestRow(fz);
    const look = Math.random() < 0.06 ? vipAppearance() : Math.random() < 0.18 ? touristAppearance() : randomCustomerAppearance();
    const model = new CharacterModel(look, { castShadow: false, crude: CharacterModel.crude });
    let x: number;
    let z: number;
    let route: { x: number; z: number }[];
    let enters = false;
    const out = Math.random() < 0.5 ? this.pickDoor(doors, row, fx) : null;
    if (out) {
      // Somebody walks out of a building…
      x = out.x;
      z = out.z;
      route = [{ x: out.wx, z: out.wz }];
      const next = Math.random() < 0.65 ? this.pickDoor(doors, row, fx, out.lotId) : null;
      if (next) {
        route.push(...this.routeTo(out.wx, out.wz, next.wx, next.wz, row), { x: next.x, z: next.z });
        enters = true;
      } else {
        const side = out.wz > streetZ(row) ? 1 : 0;
        route.push({ x: fx + (Math.random() < 0.5 ? -1 : 1) * 95, z: walkZ(row, side) });
      }
    } else {
      // …or strolls in from down the street, heading for a door.
      const side = Math.random() < 0.5 ? 1 : 0;
      x = fx + (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 45);
      z = walkZ(row, side) + (Math.random() - 0.5) * 1.6;
      const to = this.pickDoor(doors, row, fx);
      if (to) {
        route = [...this.routeTo(x, z, to.wx, to.wz, row), { x: to.x, z: to.z }];
        enters = true;
      } else route = [{ x: fx + (x < fx ? 95 : -95), z }];
    }
    // A little spread so people don't walk in single file.
    const off = (Math.random() - 0.5) * 1.4;
    route = route.map((p, i) => (i === route.length - 1 && enters ? p : { x: p.x, z: p.z + off }));
    model.root.position.set(x, 0, z);
    this.group.add(model.root);
    const rich = look.top === 'tux' || look.top === 'suit' || look.top === 'sequin';
    const cash = Math.round((20 + Math.random() * 180) * (rich ? 3 : 1) * (Math.random() < 0.05 ? 8 : 1));
    this.peds.push({ model, x, z, route, i: 0, speed: 1.2 + Math.random() * 0.5, enters, panic: 0, fade: 0, hp: 60, ko: 0, cash });
  }

  /** Gunfire at (gx, gz): everybody close by runs for it. */
  scare(gx: number, gz: number, radius: number): void {
    for (const p of this.peds) {
      if (Math.hypot(p.x - gx, p.z - gz) > radius || p.panic > 0) continue;
      p.panic = 8;
      const away = p.x >= gx ? 1 : -1;
      p.route = [{ x: p.x + away * 70, z: p.z }];
      p.i = 0;
      p.enters = false;
      p.model.setExpression('surprised', 3);
    }
  }

  /** People standing in the way of a bullet (global frame, unit direction), nearest first. */
  raycast(ox: number, oz: number, dx: number, dz: number, maxS: number): { ped: Ped; s: number }[] {
    const out: { ped: Ped; s: number }[] = [];
    for (const p of this.peds) {
      if (p.ko > 0 || p.fade > 0) continue;
      const px = p.x - ox;
      const pz = p.z - oz;
      const s = px * dx + pz * dz;
      if (s < 0.2 || s > maxS) continue;
      if (Math.hypot(px - dx * s, pz - dz * s) < 0.34) out.push({ ped: p, s });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /** They take a swing at you back. */
  provoke(p: Ped): void {
    if (p.ko > 0 || p.fight) return;
    p.fight = { wind: 0, cool: 0.7, stun: 0, life: 25 };
    p.panic = 0;
    p.enters = false;
    p.model.setExpression('angry', 25);
    this.onTell?.(p, ['Oh, it’s ON!', 'You wanna go?!', 'Big mistake, pal!', 'Put ’em up!'][Math.floor(Math.random() * 4)]);
  }

  /** Knocked off balance: their swing is interrupted and they reel for a moment. */
  stagger(p: Ped, seconds: number): void {
    if (!p.fight) return;
    p.fight.wind = 0;
    p.fight.stun = Math.max(p.fight.stun, seconds);
  }

  /** People squaring up to you right now. */
  get brawlers(): number {
    return this.peds.filter((p) => p.fight && p.ko <= 0).length;
  }

  /** A brawler's turn: close in, wind up, swing, recover; give up after a while or if you leave. */
  private updateBrawler(p: Ped, f: Brawler, dt: number): void {
    f.life -= dt;
    f.cool = Math.max(0, f.cool - dt);
    const t = this.foe;
    const d = t ? Math.hypot(t.x - p.x, t.z - p.z) : 99;
    if (!t || f.life <= 0 || d > 25) {
      // Lost interest: walk it off.
      p.fight = undefined;
      p.model.setExpression('neutral');
      p.route = [{ x: p.x + (Math.random() < 0.5 ? -60 : 60), z: p.z }];
      p.i = 0;
      return;
    }
    p.model.root.rotation.y = Math.atan2(t.x - p.x, t.z - p.z);
    if (f.stun > 0) {
      f.stun -= dt;
      p.model.setPose('idle');
      return;
    }
    if (f.wind > 0) {
      f.wind -= dt;
      p.model.setPose('point');
      if (f.wind <= 0) {
        f.cool = 1.1 + Math.random() * 0.8;
        p.model.swing = 1;
        if (d < BRAWL_REACH + 0.3) {
          const res = this.onPunch?.(p, Math.round(7 + Math.random() * 4));
          if (res === 'parry') {
            f.stun = 1.6;
            p.model.setExpression('surprised', 1.6);
          }
        }
      }
      return;
    }
    if (d > BRAWL_REACH - 0.3) {
      // Close in.
      const step = Math.min(d - (BRAWL_REACH - 0.4), 3.4 * dt);
      p.x += ((t.x - p.x) / d) * step;
      p.z += ((t.z - p.z) / d) * step;
      p.model.moveSpeed = 3.4 / 1.4;
      p.model.setPose('run');
    } else p.model.setPose('idle');
    if (d < BRAWL_REACH && f.cool <= 0) {
      f.wind = BRAWL_WINDUP;
      this.onTell?.(p, '!');
    }
  }

  /** People standing within `r` of a point (global), awake. */
  around(gx: number, gz: number, r: number): Ped[] {
    return this.peds.filter((p) => p.ko <= 0 && p.fade <= 0 && Math.hypot(p.x - gx, p.z - gz) < r);
  }

  /** A bullet landed: they stagger (and run), or go down and drop their cash. */
  damage(p: Ped, dmg: number, dx: number, dz: number): { ko: boolean; cash: number } {
    if (p.ko > 0) return { ko: false, cash: 0 };
    p.hp -= dmg;
    p.model.flinch = 1;
    p.model.setExpression('surprised', 2);
    if (p.hp > 0 && p.fight) {
      p.fight.wind = 0;
      p.fight.stun = Math.max(p.fight.stun, 0.25);
      return { ko: false, cash: 0 };
    }
    if (p.hp > 0) {
      // Hurt: run away from the shot.
      p.panic = 10;
      p.route = [{ x: p.x + Math.sign(dx || 1) * 60, z: p.z }];
      p.i = 0;
      p.enters = false;
      return { ko: false, cash: 0 };
    }
    p.ko = 9;
    p.fight = undefined;
    p.model.root.rotation.y = Math.atan2(-dx, -dz);
    p.model.setPose('ko');
    const cash = p.cash;
    p.cash = 0;
    return { ko: true, cash };
  }

  update(dt: number, fx: number, fz: number, doors: DoorSpot[], visible: boolean): void {
    this.group.visible = visible;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.peds.length < this.target) {
      this.spawnT = 0.35;
      this.spawn(doors, fx, fz);
    }
    for (let k = this.peds.length - 1; k >= 0; k--) {
      const p = this.peds[k];
      if (p.ko > 0) {
        // Out cold on the pavement, then they come to and slink away (fade out).
        p.ko -= dt;
        if (p.ko < 1.2) p.model.root.scale.setScalar(Math.max(0.01, p.ko / 1.2));
        if (p.ko <= 0) {
          p.model.dispose();
          this.peds.splice(k, 1);
          continue;
        }
        p.model.setPose('ko');
        if (visible) p.model.update(dt);
        continue;
      }
      if (p.fight) {
        this.updateBrawler(p, p.fight, dt);
        p.model.root.position.set(p.x, 0, p.z);
        if (visible) p.model.update(dt);
        continue;
      }
      p.panic = Math.max(0, p.panic - dt);
      const speed = p.panic > 0 ? 4.6 : p.speed;
      const t = p.route[p.i];
      let done = false;
      if (t) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const d = Math.hypot(dx, dz);
        const step = speed * dt;
        if (d <= step) {
          p.x = t.x;
          p.z = t.z;
          p.i++;
        } else {
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.model.root.rotation.y = Math.atan2(dx, dz);
        }
      } else done = true;
      const far = Math.hypot(p.x - fx, p.z - fz) > 110;
      if (done || far) {
        // Walked in through a door (or out of sight): gone.
        p.fade += dt * 4;
        p.model.root.scale.setScalar(Math.max(0.01, 1 - p.fade));
        if (p.fade >= 1 || far) {
          p.model.dispose();
          this.peds.splice(k, 1);
          continue;
        }
      }
      p.model.root.position.set(p.x, 0, p.z);
      p.model.moveSpeed = speed / 1.4;
      p.model.setPose(done ? 'idle' : p.panic > 0 ? 'run' : 'walk');
      if (visible) p.model.update(dt);
    }
  }

  /** People within `r` of a global point (for tests and effects). */
  near(gx: number, gz: number, r: number): number {
    return this.peds.filter((p) => Math.hypot(p.x - gx, p.z - gz) < r).length;
  }

  get count(): number {
    return this.peds.length;
  }
}
