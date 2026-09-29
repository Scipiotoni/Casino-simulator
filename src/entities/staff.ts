import { Walker } from './walker';
import { type Appearance, randomStaffAppearance, applyUniform } from './appearance';
import type { World } from '../game/world';
import type { PlacedItem } from '../items/placedItem';
import type { Trash } from '../world/trash';
import type { Customer } from './customer';
import { dist, formatMoney } from '../core/math';
import { chance, rand, randInt, randomName } from '../core/rng';
import { CENTER_X, FACADE_Z } from '../world/grid';

export type WorkerRole = 'janitor' | 'technician' | 'security' | 'doorman';

export interface RoleInfo {
  role: WorkerRole;
  title: string;
  wage: number;
  unlock: number;
  blurb: string;
}

export const ROLES: RoleInfo[] = [
  { role: 'janitor', title: 'Janitor', wage: 160, unlock: 2, blurb: 'Sweeps up litter so guests stay happy.' },
  { role: 'technician', title: 'Technician', wage: 240, unlock: 3, blurb: 'Fixes broken machines automatically.' },
  { role: 'doorman', title: 'Door Guard', wage: 200, unlock: 3, blurb: 'Posted at the entrance. Turns most cheaters away before they get in (max 2).' },
  { role: 'security', title: 'Security', wage: 300, unlock: 5, blurb: 'Spots and busts cheaters on the floor.' },
];

/** Where door guards stand: either side of the red carpet, facing the street. */
export const DOOR_POSTS: [number, number][] = [
  [CENTER_X - 1.55, FACADE_Z + 1.35],
  [CENTER_X + 1.55, FACADE_Z + 1.35],
];
export const MAX_DOOR_GUARDS = DOOR_POSTS.length;

type Task =
  | { kind: 'trash'; trash: Trash }
  | { kind: 'repair'; item: PlacedItem }
  | { kind: 'chase'; target: Customer }
  | null;

let nextUid = 1;

export class Worker extends Walker {
  readonly uid = nextUid++;
  name: string;
  look: Appearance;
  private task: Task = null;
  private workT = 0;
  private thinkT = 0;
  private working = false;
  private repathT = 0;
  jobsDone = 0;

  constructor(readonly role: WorkerRole, x: number, z: number, look?: Appearance, name?: string) {
    const base = look ?? randomStaffAppearance(role);
    super(applyUniform(base, role), x, z);
    this.look = base;
    this.name = name ?? randomName();
    this.speed = role === 'security' ? 1.7 : 1.55;
  }

  get info(): RoleInfo {
    return ROLES.find((r) => r.role === this.role)!;
  }

  get statusLine(): string {
    if (!this.task) return 'On patrol';
    switch (this.task.kind) {
      case 'trash':
        return 'Cleaning up litter';
      case 'repair':
        return `Repairing the ${this.task.item.def.name}`;
      case 'chase':
        return 'Chasing a cheater!';
    }
  }

  setLook(look: Appearance): void {
    this.look = look;
    this.model.setAppearance(applyUniform(look, this.role));
  }

  release(): void {
    const t = this.task;
    if (!t) return;
    if (t.kind === 'trash' && t.trash.claimedBy === this.uid) t.trash.claimedBy = null;
    if (t.kind === 'repair' && t.item.repairClaim === this.uid) t.item.repairClaim = null;
    this.task = null;
    this.working = false;
  }

  /** Door guards: which post (0/1) this guard holds, or -1. */
  post = -1;

  /** Nearest walkable tile beside a machine footprint. */
  private approach(w: World, item: PlacedItem): [number, number] | null {
    const g = w.gridAt(item.floor);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const b = item.bounds;
    for (let x = b.x0 - 1; x <= b.x1; x++) {
      for (let z = b.z0 - 1; z <= b.z1; z++) {
        const edge = x === b.x0 - 1 || x === b.x1 || z === b.z0 - 1 || z === b.z1;
        if (!edge) continue;
        const corner = (x === b.x0 - 1 || x === b.x1) && (z === b.z0 - 1 || z === b.z1);
        if (corner) continue;
        if (!g.isWalkable(x, z)) continue;
        const d = dist(x + 0.5, z + 0.5, this.x, this.z) + Math.abs(item.floor - this.floor) * 12;
        if (d < bestD) {
          bestD = d;
          best = [x, z];
        }
      }
    }
    return best;
  }

  private findTask(w: World): void {
    const r = this.role;
    if (r === 'janitor') {
      const free = w.trash.list.filter((t) => t.claimedBy === null);
      if (!free.length) return;
      const cost = (t: Trash) => dist(t.x, t.z, this.x, this.z) + Math.abs(t.floor - this.floor) * 12;
      const t = free.reduce((a, b) => (cost(a) < cost(b) ? a : b));
      if (this.go(w, t.floor, Math.floor(t.x), Math.floor(t.z), [t.x, t.z])) {
        t.claimedBy = this.uid;
        this.task = { kind: 'trash', trash: t };
      }
    } else if (r === 'technician') {
      const broken = w.items.items.filter((i) => i.broken && i.repairClaim === null);
      if (!broken.length) return;
      const cost = (i: PlacedItem) => dist(i.cx, i.cz, this.x, this.z) + Math.abs(i.floor - this.floor) * 12;
      const item = broken.reduce((a, b) => (cost(a) < cost(b) ? a : b));
      const ap = this.approach(w, item);
      if (ap && this.go(w, item.floor, ap[0], ap[1])) {
        item.repairClaim = this.uid;
        this.task = { kind: 'repair', item };
      }
    } else if (r === 'security') {
      const target = w.customers.find((c) => c.exposed && c.state !== 'busted' && c.state !== 'leave' && (c.floor !== this.floor || dist(c.x, c.z, this.x, this.z) < 18));
      if (target) {
        this.task = { kind: 'chase', target };
        this.run = true;
        this.repathT = 0;
      }
    }
  }

  private patrol(w: World): void {
    const floor = w.floors > 1 && chance(0.4) ? randInt(0, w.floors - 1) : this.floor;
    const spot = w.gridAt(floor).randomInsideWalkable();
    if (spot) this.go(w, floor, spot[0], spot[1], [spot[0] + rand(0.2, 0.8), spot[1] + rand(0.2, 0.8)]);
  }

  /** Door guards walk to their post and stand facing the street. */
  private guardDoor(dt: number, w: World): void {
    const post = DOOR_POSTS[Math.max(0, this.post)];
    const atPost = this.floor === 0 && dist(this.x, this.z, post[0], post[1]) < 0.2;
    if (!atPost && !this.walking) {
      this.go(w, 0, Math.floor(post[0]), Math.floor(post[1]), [post[0], post[1]]);
    }
    this.step(dt, w);
    if (atPost && !this.walking) this.yaw = 0;
    this.syncModel(dt, this.gesture > 0 ? 'point' : 'idle');
    this.gesture = Math.max(0, this.gesture - dt);
  }

  /** Brief "not tonight" gesture when a guard turns someone away. */
  private gesture = 0;
  turnAway(): void {
    this.gesture = 1.6;
  }

  update(dt: number, w: World): void {
    if (this.role === 'doorman') {
      this.guardDoor(dt, w);
      return;
    }
    this.thinkT -= dt;
    const t = this.task;
    if (!t) {
      if (this.thinkT <= 0) {
        this.thinkT = 0.5;
        this.findTask(w);
        if (!this.task && !this.walking && Math.random() < 0.25) this.patrol(w);
      }
      this.step(dt, w);
      this.syncModel(dt, 'idle');
      return;
    }
    if (t.kind === 'chase') {
      const c = t.target;
      if (!c.exposed || c.gone || c.state === 'busted' || c.state === 'leave') {
        this.task = null;
        this.run = false;
        this.syncModel(dt);
        return;
      }
      this.repathT -= dt;
      if (this.repathT <= 0) {
        this.repathT = 0.8;
        const tx = Math.floor(c.x);
        const tz = Math.floor(c.z);
        const g = w.gridAt(c.floor);
        const near = g.isWalkable(tx, tz) ? [tx, tz] : g.nearestWalkable(tx, tz);
        if (near && !this.inElevator) this.go(w, c.floor, near[0], near[1]);
      }
      this.step(dt, w);
      if (c.floor === this.floor && !this.inElevator && dist(c.x, c.z, this.x, this.z) < 1.3) {
        const loot = c.bust(w);
        w.onStaffBust();
        w.addMoney(loot, 'bust', c.headPos.clone());
        w.sfxAt('bust', c.x, c.z);
        w.notify(`${this.name} busted a cheater! +${formatMoney(loot)}`, 'good');
        this.jobsDone++;
        this.task = null;
        this.run = false;
      }
      this.syncModel(dt);
      return;
    }
    if (!this.working) {
      const r = this.step(dt, w);
      if (t.kind === 'trash' && !w.trash.list.includes(t.trash)) {
        this.release();
      } else if (t.kind === 'repair' && !t.item.broken) {
        this.release();
      } else if (t.kind === 'repair' && !w.items.items.includes(t.item)) {
        this.release();
      } else if (r === 'arrived') {
        this.working = true;
        this.workT = t.kind === 'repair' ? 3 : 1.1;
        if (t.kind !== 'trash') this.faceTowards(t.item.cx, t.item.cz);
      } else if (r === 'blocked' || r === 'idle') {
        this.release();
      }
      this.syncModel(dt);
      return;
    }
    this.workT -= dt;
    const pose = t.kind === 'repair' ? 'repair' : 'sweep';
    if (t.kind === 'repair' && Math.random() < dt * 3) w.sfxAt('repair', this.x, this.z, 0.6);
    if (this.workT <= 0) {
      if (t.kind === 'trash') {
        if (w.trash.list.includes(t.trash)) {
          w.trash.remove(t.trash);
          w.onStaffClean();
        }
        w.effects.sparkle(this.x, 0.4, this.z, 5, 0xbfe9ff, 0.5);
      } else if (t.kind === 'repair') {
        if (t.item.broken) {
          t.item.broken = false;
          w.effects.sparkle(t.item.cx, 1.2, t.item.cz, 14, 0x9fe8ff, 1);
          w.sfxAt('fixed', t.item.cx, t.item.cz);
          w.floaters.text(t.item.root.position.clone().setY(2.2), 'Fixed!', 'good');
        }
      }
      this.jobsDone++;
      this.release();
    }
    this.syncModel(dt, pose);
  }
}
