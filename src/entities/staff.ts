import { Walker } from './walker';
import { type Appearance, randomStaffAppearance, applyUniform } from './appearance';
import type { World } from '../game/world';
import type { PlacedItem } from '../items/placedItem';
import type { Trash } from '../world/trash';
import type { Customer } from './customer';
import { dist, formatMoney } from '../core/math';
import { rand, randomName } from '../core/rng';

export type WorkerRole = 'janitor' | 'technician' | 'security' | 'cashier';

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
  { role: 'cashier', title: 'Cashier', wage: 220, unlock: 4, blurb: 'Collects cash from machines for you.' },
  { role: 'security', title: 'Security', wage: 300, unlock: 5, blurb: 'Spots and busts cheaters on the floor.' },
];

type Task =
  | { kind: 'trash'; trash: Trash }
  | { kind: 'repair'; item: PlacedItem }
  | { kind: 'collect'; item: PlacedItem }
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
      case 'collect':
        return `Collecting cash from the ${this.task.item.def.name}`;
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
    if (t.kind === 'collect' && t.item.collectClaim === this.uid) t.item.collectClaim = null;
    this.task = null;
    this.working = false;
  }

  /** Nearest walkable tile beside a machine footprint. */
  private approach(w: World, item: PlacedItem): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const b = item.bounds;
    for (let x = b.x0 - 1; x <= b.x1; x++) {
      for (let z = b.z0 - 1; z <= b.z1; z++) {
        const edge = x === b.x0 - 1 || x === b.x1 || z === b.z0 - 1 || z === b.z1;
        if (!edge) continue;
        const corner = (x === b.x0 - 1 || x === b.x1) && (z === b.z0 - 1 || z === b.z1);
        if (corner) continue;
        if (!w.grid.isWalkable(x, z)) continue;
        const d = dist(x + 0.5, z + 0.5, this.x, this.z);
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
      const t = free.reduce((a, b) => (dist(a.x, a.z, this.x, this.z) < dist(b.x, b.z, this.x, this.z) ? a : b));
      if (this.walkTo(w.grid, Math.floor(t.x), Math.floor(t.z), [t.x, t.z])) {
        t.claimedBy = this.uid;
        this.task = { kind: 'trash', trash: t };
      }
    } else if (r === 'technician') {
      const broken = w.items.items.filter((i) => i.broken && i.repairClaim === null);
      if (!broken.length) return;
      const item = broken.reduce((a, b) => (dist(a.cx, a.cz, this.x, this.z) < dist(b.cx, b.cz, this.x, this.z) ? a : b));
      const ap = this.approach(w, item);
      if (ap && this.walkTo(w.grid, ap[0], ap[1])) {
        item.repairClaim = this.uid;
        this.task = { kind: 'repair', item };
      }
    } else if (r === 'cashier') {
      const ready = w.items.items.filter((i) => i.def.cashCap > 0 && i.collectClaim === null && i.cash >= Math.max(60, i.cashCap * 0.3));
      if (!ready.length) return;
      const item = ready.reduce((a, b) => (a.cash / a.cashCap > b.cash / b.cashCap ? a : b));
      const ap = this.approach(w, item);
      if (ap && this.walkTo(w.grid, ap[0], ap[1])) {
        item.collectClaim = this.uid;
        this.task = { kind: 'collect', item };
      }
    } else if (r === 'security') {
      const target = w.customers.find((c) => c.exposed && c.state !== 'busted' && c.state !== 'leave' && dist(c.x, c.z, this.x, this.z) < 18);
      if (target) {
        this.task = { kind: 'chase', target };
        this.run = true;
        this.repathT = 0;
      }
    }
  }

  private patrol(w: World): void {
    const spot = w.grid.randomInsideWalkable();
    if (spot) this.walkTo(w.grid, spot[0], spot[1], [spot[0] + rand(0.2, 0.8), spot[1] + rand(0.2, 0.8)]);
  }

  update(dt: number, w: World): void {
    this.thinkT -= dt;
    const t = this.task;
    if (!t) {
      if (this.thinkT <= 0) {
        this.thinkT = 0.5;
        this.findTask(w);
        if (!this.task && !this.walking && Math.random() < 0.25) this.patrol(w);
      }
      this.stepPath(dt, w.grid);
      this.syncModel(dt, this.role === 'security' ? 'idle' : 'idle');
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
        const near = w.grid.isWalkable(tx, tz) ? [tx, tz] : w.grid.nearestWalkable(tx, tz);
        if (near) this.walkTo(w.grid, near[0], near[1]);
      }
      this.stepPath(dt, w.grid);
      if (dist(c.x, c.z, this.x, this.z) < 1.3) {
        const loot = c.bust(w);
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
      const r = this.stepPath(dt, w.grid);
      if (t.kind === 'trash' && !w.trash.list.includes(t.trash)) {
        this.release();
      } else if (t.kind === 'repair' && !t.item.broken) {
        this.release();
      } else if ((t.kind === 'repair' || t.kind === 'collect') && !w.items.items.includes(t.item)) {
        this.release();
      } else if (r === 'arrived') {
        this.working = true;
        this.workT = t.kind === 'repair' ? 3 : t.kind === 'trash' ? 1.1 : 0.8;
        if (t.kind !== 'trash') this.faceTowards(t.item.cx, t.item.cz);
      } else if (r === 'blocked' || r === 'idle') {
        this.release();
      }
      this.syncModel(dt);
      return;
    }
    this.workT -= dt;
    const pose = t.kind === 'repair' ? 'repair' : t.kind === 'trash' ? 'sweep' : 'crouch';
    if (t.kind === 'repair' && Math.random() < dt * 3) w.sfxAt('repair', this.x, this.z, 0.6);
    if (this.workT <= 0) {
      if (t.kind === 'trash') {
        if (w.trash.list.includes(t.trash)) w.trash.remove(t.trash);
        w.effects.sparkle(this.x, 0.4, this.z, 5, 0xbfe9ff, 0.5);
      } else if (t.kind === 'repair') {
        if (t.item.broken) {
          t.item.broken = false;
          w.effects.sparkle(t.item.cx, 1.2, t.item.cz, 14, 0x9fe8ff, 1);
          w.sfxAt('fixed', t.item.cx, t.item.cz);
          w.floaters.text(t.item.root.position.clone().setY(2.2), 'Fixed!', 'good');
        }
      } else if (t.kind === 'collect') {
        const amt = Math.floor(t.item.cash);
        if (amt > 0) {
          t.item.cash -= amt;
          w.addMoney(amt, 'collect', t.item.root.position.clone().setY(2));
        }
      }
      this.jobsDone++;
      this.release();
    }
    this.syncModel(dt, pose);
  }
}
