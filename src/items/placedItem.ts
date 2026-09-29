import * as THREE from 'three';
import { type ItemDef, footprintCenter, footprintTiles, localPosToWorld, localTileToWorld, rotatedSize } from './catalog';
import { buildModel } from './models';
import type { Card, ItemModel, ModelCtx, Outcome, SharedVisual } from './types';
import * as G from './games';
import { CharacterModel } from '../entities/characterModel';
import { type Appearance, randomStaffAppearance } from '../entities/appearance';
import { badgeTexture } from '../render/textures';
import { easeOutBack } from '../core/math';

export interface SeatUser {
  readonly uid: number;
  readonly isCheater: boolean;
  readonly risk: number;
  /** Amount to wager / pay for the next round, or null to stand up. */
  nextBet(item: PlacedItem, seat: number): number | null;
  roundStarted(item: PlacedItem, outcome: Outcome, duration: number): void;
  roundResult(item: PlacedItem, outcome: Outcome): void;
  forceLeave(reason: string, moodHit: number): void;
}

export interface ItemHost {
  readonly time: number;
  jackpotPot: number;
  roundDone(item: PlacedItem, outcome: Outcome, user: SeatUser): void;
  roundStart(item: PlacedItem): void;
  machineBroke(item: PlacedItem): void;
  statueLook(): Appearance;
}

export interface SeatRuntime {
  index: number;
  tileX: number;
  tileZ: number;
  x: number;
  z: number;
  face: number;
  pose: 'sit' | 'stand';
  seatY: number;
  occupant: SeatUser | null;
  reserved: SeatUser | null;
  reachable: boolean;
  state: 'idle' | 'playing' | 'result';
  timer: number;
  outcome: Outcome | null;
}

export interface ItemStats {
  plays: number;
  wagered: number;
  paid: number;
  income: number;
  bigWins: number;
}

interface TableState {
  phase: 'idle' | 'betting' | 'playing' | 'payout';
  timer: number;
  bets: Map<number, { amount: number; user: SeatUser; choice: unknown }>;
  outcomes: Map<number, Outcome>;
  shared: SharedVisual;
}

const GAMBLING = new Set(['slot', 'claw', 'pachinko', 'roulette', 'blackjack', 'poker', 'craps', 'wheel']);
export const MAX_LEVEL = 5;

export class PlacedItem {
  readonly root = new THREE.Group();
  model!: ItemModel;
  seats: SeatRuntime[] = [];
  cash = 0;
  broken = false;
  level = 1;
  color: number;
  stats: ItemStats = { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 };
  staff: CharacterModel | null = null;
  private staffBaseX = 0;
  private staffTargetX = 0;
  private table: TableState | null = null;
  private spawnT = 0;
  private smokeT = 0;
  private status: THREE.Sprite | null = null;
  private statusKind = '';
  /** Claimed by a staff member so two workers don't chase the same job. */
  repairClaim: number | null = null;
  collectClaim: number | null = null;
  tiles: [number, number][] = [];
  cx = 0;
  cz = 0;

  constructor(
    readonly uid: number,
    readonly def: ItemDef,
    public tx: number,
    public tz: number,
    public rot: number,
    private host: ItemHost,
    color?: number,
  ) {
    this.color = color ?? def.colors[0] ?? 0xffffff;
    if (def.shared) {
      this.table = { phase: 'idle', timer: 0, bets: new Map(), outcomes: new Map(), shared: { kind: 'none' } };
    }
    this.rebuildModel();
    this.setPosition(tx, tz, rot);
    if (def.staff) this.createStaff();
  }

  get isGambling(): boolean {
    return GAMBLING.has(this.def.kind);
  }

  get upgradable(): boolean {
    return this.def.kind !== 'decor' && this.def.kind !== 'bench' && this.def.kind !== 'stage';
  }

  get minBet(): number {
    return Math.round(this.def.minBet * (1 + 0.25 * (this.level - 1)));
  }

  get maxBet(): number {
    return Math.round(this.def.maxBet * (1 + 0.45 * (this.level - 1)));
  }

  get cashCap(): number {
    return Math.round(this.def.cashCap * (1 + 0.7 * (this.level - 1)));
  }

  get appeal(): number {
    return this.def.appeal * (1 + 0.25 * (this.level - 1));
  }

  get fun(): number {
    return this.def.fun * (1 + 0.12 * (this.level - 1));
  }

  get upgradeCost(): number {
    return Math.round(this.def.price * 0.6 * this.level);
  }

  get sellValue(): number {
    let invested = this.def.price;
    for (let l = 1; l < this.level; l++) invested += Math.round(this.def.price * 0.6 * l);
    return Math.round(invested * 0.55);
  }

  get isFull(): boolean {
    return this.def.cashCap > 0 && this.cash >= this.cashCap;
  }

  get profit(): number {
    return this.stats.wagered - this.stats.paid + this.stats.income;
  }

  rebuildModel(): void {
    if (this.model) {
      this.model.root.removeFromParent();
      this.model.dispose();
    }
    this.model = buildModel(this.def.model, {
      color: this.color,
      level: this.level,
      params: this.def.params ?? {},
      statueLook: this.def.model === 'statue' ? this.host.statueLook() : undefined,
    });
    this.root.add(this.model.root);
  }

  private createStaff(): void {
    const s = this.def.staff!;
    const role = s.role === 'chef' ? 'bartender' : s.role;
    const look = randomStaffAppearance(role);
    if (s.role === 'chef') {
      look.hat = 'chef';
      look.hatColor = 0xffffff;
      look.top = 'vest';
      look.topColor = 0xf4f1ea;
      look.accentColor = 0xf4f1ea;
      look.prop = 'none';
    }
    this.staff = new CharacterModel(look);
    this.staff.root.position.set(s.pos[0], s.role === 'performer' ? 0.35 : 0, s.pos[1]);
    this.staff.root.rotation.y = s.face;
    this.staffBaseX = s.pos[0];
    this.staffTargetX = s.pos[0];
    this.staff.setPose(s.role === 'performer' ? 'sing' : 'idle');
    this.root.add(this.staff.root);
  }

  setPosition(tx: number, tz: number, rot: number): void {
    this.tx = tx;
    this.tz = tz;
    this.rot = ((rot % 4) + 4) % 4;
    const [cx, cz] = footprintCenter(this.def, tx, tz, this.rot);
    this.cx = cx;
    this.cz = cz;
    this.root.position.set(cx, 0, cz);
    this.root.rotation.y = (this.rot * Math.PI) / 2;
    this.tiles = footprintTiles(this.def, tx, tz, this.rot);
    const prev = this.seats;
    this.seats = this.def.seats.map((sd, i) => {
      const [tileX, tileZ] = localTileToWorld(this.def, tx, tz, this.rot, sd.tile[0], sd.tile[1]);
      const [x, z] = localPosToWorld(this.def, tx, tz, this.rot, sd.pos[0], sd.pos[1]);
      return {
        index: i, tileX, tileZ, x, z, face: sd.face + (this.rot * Math.PI) / 2, pose: sd.pose, seatY: sd.seatY ?? 0.5,
        occupant: prev[i]?.occupant ?? null, reserved: prev[i]?.reserved ?? null, reachable: true,
        state: 'idle', timer: 0.5 + Math.random(), outcome: null,
      };
    });
  }

  /** Bounds of the footprint in world units. */
  get bounds(): { x0: number; z0: number; x1: number; z1: number } {
    const [w, d] = rotatedSize(this.def, this.rot);
    return { x0: this.tx, z0: this.tz, x1: this.tx + w, z1: this.tz + d };
  }

  playDropIn(): void {
    this.spawnT = 0.0001;
    this.root.scale.setScalar(0.01);
  }

  freeSeat(): SeatRuntime | null {
    if (this.broken || this.isFull) return null;
    const free = this.seats.filter((s) => s.reachable && !s.occupant && !s.reserved);
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  freeSeatCount(): number {
    return this.seats.filter((s) => s.reachable && !s.occupant && !s.reserved).length;
  }

  occupiedCount(): number {
    return this.seats.filter((s) => s.occupant).length;
  }

  reserve(seat: SeatRuntime, user: SeatUser): void {
    seat.reserved = user;
  }

  sitDown(seatIdx: number, user: SeatUser): void {
    const s = this.seats[seatIdx];
    if (!s) return;
    s.reserved = null;
    s.occupant = user;
    s.state = 'idle';
    s.timer = 0.35 + Math.random() * 0.4;
  }

  release(user: SeatUser): void {
    for (const s of this.seats) {
      if (s.occupant === user) {
        s.occupant = null;
        s.state = 'idle';
        s.outcome = null;
        this.model.event({ type: 'clear', seat: s.index });
      }
      if (s.reserved === user) s.reserved = null;
    }
    this.table?.bets.forEach((b, k) => {
      if (b.user === user) this.table!.bets.delete(k);
    });
  }

  /** Everyone gets up (machine broke, sold or moved). */
  evict(reason: string, moodHit: number): void {
    for (const s of this.seats) {
      const u = s.occupant ?? s.reserved;
      s.occupant = null;
      s.reserved = null;
      s.state = 'idle';
      if (u) u.forceLeave(reason, moodHit);
    }
    if (this.table) {
      this.table.phase = 'idle';
      this.table.bets.clear();
    }
  }

  setBroken(b: boolean): void {
    this.broken = b;
    if (b) {
      this.evict('This machine just broke!', 12);
      this.host.machineBroke(this);
    }
  }

  private takeBet(amount: number): void {
    this.cash += amount;
    this.stats.wagered += amount;
  }

  /** Wins are paid from the machine's cash box, which may dip below zero and refill from later bets. */
  private payOut(amount: number): void {
    if (amount <= 0) return;
    this.stats.paid += amount;
    this.cash -= amount;
  }

  private resolveIndividual(bet: number, user: SeatUser): Outcome {
    const d = this.def;
    switch (d.kind) {
      case 'slot': {
        const pot = d.jackpot ? this.host.jackpotPot : 0;
        return G.resolveSlot(bet, d.rtp, user.isCheater, pot);
      }
      case 'claw':
        return G.resolveClaw(bet, user.isCheater);
      case 'pachinko':
        return G.resolvePachinko(bet, d.rtp, user.isCheater);
      case 'bar':
        return { bet, payout: 0, label: pickOf(['Cosmopolitan', 'Martini', 'Mojito', 'Margarita', 'Old Fashioned', 'Cold beer']), tier: 'push', visual: { kind: 'service' } };
      case 'snack':
        return { bet, payout: 0, label: pickOf(['Cheeseburger', 'Hot dog', 'Fries', 'Nachos', 'Club sandwich']), tier: 'push', visual: { kind: 'service' } };
      case 'atm':
        return { bet, payout: 0, label: 'Cash withdrawal', tier: 'push', visual: { kind: 'service' } };
      default:
        return { bet, payout: 0, label: 'Resting', tier: 'push', visual: { kind: 'none' } };
    }
  }

  private isService(): boolean {
    return ['bar', 'snack', 'atm', 'bench'].includes(this.def.kind);
  }

  update(dt: number, ctxT: number): void {
    // Drop-in bounce after placement
    if (this.spawnT > 0) {
      this.spawnT += dt / 0.45;
      const u = Math.min(1, this.spawnT);
      this.root.scale.setScalar(Math.max(0.01, easeOutBack(u)));
      if (u >= 1) {
        this.spawnT = 0;
        this.root.scale.setScalar(1);
      }
    }
    const busy = this.seats.some((s) => s.occupant);
    const ctx: ModelCtx = { t: ctxT, broken: this.broken, level: this.level, busy, jackpotPot: this.host.jackpotPot };
    this.model.update(dt, ctx);
    if (this.staff) this.updateStaff(dt);
    if (!this.broken) {
      if (this.table) this.updateTable(dt);
      else this.updateSeats(dt);
    }
    this.updateStatus();
  }

  private updateSeats(dt: number): void {
    for (const s of this.seats) {
      const u = s.occupant;
      if (!u) continue;
      s.timer -= dt;
      if (s.timer > 0) continue;
      if (s.state === 'idle') {
        if (this.isFull && !this.isService()) {
          u.forceLeave('This machine is full of cash!', 4);
          continue;
        }
        const bet = u.nextBet(this, s.index);
        if (bet === null) continue; // user stands up on their own
        const outcome = this.resolveIndividual(bet, u);
        this.takeBet(bet);
        s.outcome = outcome;
        s.state = 'playing';
        s.timer = this.def.roundTime * (0.9 + Math.random() * 0.2);
        this.model.event({ type: 'start', seat: s.index, outcome, duration: s.timer });
        u.roundStarted(this, outcome, s.timer);
        this.host.roundStart(this);
      } else if (s.state === 'playing') {
        const oc = s.outcome!;
        this.payOut(oc.payout);
        this.stats.plays++;
        if (oc.tier === 'big' || oc.tier === 'jackpot') this.stats.bigWins++;
        this.model.event({ type: 'result', seat: s.index, outcome: oc });
        u.roundResult(this, oc);
        this.host.roundDone(this, oc, u);
        s.state = 'result';
        s.timer = oc.tier === 'lose' ? 0.4 : oc.tier === 'push' ? 0.6 : 1.6;
        if (this.isGambling && this.def.breakChance > 0 && Math.random() < this.def.breakChance * (1 - 0.15 * (this.level - 1))) {
          this.setBroken(true);
          return;
        }
      } else {
        s.state = 'idle';
        s.timer = 0.15 + Math.random() * 0.3;
      }
    }
  }

  private updateTable(dt: number): void {
    const t = this.table!;
    t.timer -= dt;
    const seated = this.seats.filter((s) => s.occupant);
    switch (t.phase) {
      case 'idle':
        if (seated.length) {
          t.phase = 'betting';
          t.timer = 1.6;
        }
        break;
      case 'betting': {
        if (t.timer > 0) break;
        t.bets.clear();
        if (this.isFull) {
          seated.forEach((s) => s.occupant!.forceLeave('This table is out of chips!', 4));
          t.phase = 'idle';
          break;
        }
        for (const s of seated) {
          const u = s.occupant!;
          const amount = u.nextBet(this, s.index);
          if (amount === null || s.occupant !== u) continue;
          let choice: unknown = null;
          if (this.def.kind === 'roulette') choice = G.pickRouletteBet(u.risk);
          else if (this.def.kind === 'wheel') choice = G.pickWheelBet(u.risk);
          else if (this.def.kind === 'craps') choice = G.pickCrapsBet(u.risk);
          t.bets.set(s.index, { amount, user: u, choice });
          this.takeBet(amount);
          this.model.event({ type: 'bet', seat: s.index, amount });
        }
        if (!t.bets.size) {
          t.phase = 'idle';
          break;
        }
        // Resolve everything up front so the animation can land on the real result.
        t.outcomes = new Map();
        let shared: SharedVisual;
        if (this.def.kind === 'roulette') shared = { kind: 'roulette', number: G.spinRoulette(this.def.rtp) };
        else shared = G.sharedFor(this.def.kind);
        t.shared = shared;
        for (const [idx, b] of t.bets) {
          let oc: Outcome;
          switch (this.def.kind) {
            case 'roulette':
              oc = G.resolveRouletteBet(b.amount, b.choice as G.RouletteBet, (shared as { number: number }).number, b.user.isCheater);
              break;
            case 'wheel':
              oc = G.resolveWheelBet(b.amount, b.choice as number, (shared as { segment: number }).segment, b.user.isCheater);
              break;
            case 'craps':
              oc = G.resolveCrapsBet(b.amount, b.choice as G.CrapsBet, (shared as { dice: [number, number] }).dice, b.user.isCheater);
              break;
            case 'blackjack':
              oc = G.resolveBlackjackSeat(b.amount, (shared as { dealer: Card[] }).dealer, b.user.isCheater);
              break;
            case 'poker':
              oc = G.resolvePokerSeat(b.amount, this.def.rtp, b.user.isCheater);
              if (oc.visual.kind === 'poker') oc.visual.board = (shared as { board: Card[] }).board;
              break;
            default:
              oc = { bet: b.amount, payout: 0, label: '', tier: 'lose', visual: { kind: 'none' } };
          }
          t.outcomes.set(idx, oc);
        }
        const duration = this.def.roundTime * (0.9 + Math.random() * 0.2);
        this.model.event({ type: 'tableStart', seats: [...t.bets.keys()], outcomes: t.outcomes, shared, duration });
        for (const [idx, b] of t.bets) b.user.roundStarted(this, t.outcomes.get(idx)!, duration);
        this.host.roundStart(this);
        t.phase = 'playing';
        t.timer = duration;
        break;
      }
      case 'playing':
        if (t.timer > 0) break;
        for (const [idx, b] of t.bets) {
          const oc = t.outcomes.get(idx)!;
          this.payOut(oc.payout);
          this.stats.plays++;
          if (oc.tier === 'big' || oc.tier === 'jackpot') this.stats.bigWins++;
          if (this.seats[idx].occupant === b.user) {
            b.user.roundResult(this, oc);
          }
          this.host.roundDone(this, oc, b.user);
        }
        this.model.event({ type: 'tableResult', seats: [...t.bets.keys()], outcomes: t.outcomes, shared: t.shared });
        t.phase = 'payout';
        t.timer = 2.3;
        if (this.def.breakChance > 0 && Math.random() < this.def.breakChance) this.setBroken(true);
        break;
      case 'payout':
        if (t.timer <= 0) {
          t.phase = 'idle';
          t.bets.clear();
        }
        break;
    }
  }

  get tablePhase(): string {
    return this.table?.phase ?? 'none';
  }

  private updateStaff(dt: number): void {
    const st = this.staff!;
    const role = this.def.staff!.role;
    if (role === 'performer') {
      const cycle = (this.host.time * 0.1) % 1;
      st.setPose(cycle < 0.08 ? 'wave' : cycle < 0.55 ? 'sing' : 'dance');
    } else if (role === 'dealer') {
      const phase = this.table?.phase;
      st.setPose(phase === 'playing' ? 'deal' : phase === 'betting' ? 'point' : 'idle');
    } else {
      const serving = this.seats.find((s) => s.occupant && s.state === 'playing');
      if (serving) {
        const sd = this.def.seats[serving.index];
        this.staffTargetX = sd.pos[0];
      } else {
        this.staffTargetX = this.staffBaseX;
      }
      const dx = this.staffTargetX - st.root.position.x;
      if (Math.abs(dx) > 0.05) {
        st.root.position.x += Math.sign(dx) * Math.min(Math.abs(dx), dt * 1.6);
        st.moveSpeed = 1.6;
        st.setPose('walk');
        st.root.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        st.root.rotation.y = 0;
        st.setPose(serving ? 'bartend' : 'idle');
      }
    }
    st.update(dt);
  }

  private updateStatus(): void {
    const kind = this.broken ? 'broken' : this.isFull ? 'full' : '';
    if (kind === this.statusKind) {
      if (this.status) this.status.position.y = this.model.height + 0.45 + Math.sin(this.host.time * 4) * 0.08;
      return;
    }
    this.statusKind = kind;
    if (!kind) {
      if (this.status) this.status.visible = false;
      return;
    }
    if (!this.status) {
      this.status = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      this.status.scale.set(0.7, 0.7, 0.7);
      this.status.renderOrder = 10;
      this.root.add(this.status);
    }
    (this.status.material as THREE.SpriteMaterial).map = badgeTexture(kind as 'broken' | 'full');
    (this.status.material as THREE.SpriteMaterial).needsUpdate = true;
    this.status.visible = true;
    this.status.position.set(0, this.model.height + 0.45, 0);
  }

  /** Tick smoke on broken machines (called from the manager with effects access). */
  wantsSmoke(dt: number): boolean {
    if (!this.broken) return false;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      return true;
    }
    return false;
  }

  upgrade(): void {
    if (this.level >= MAX_LEVEL) return;
    this.level++;
    this.rebuildModel();
  }

  repaint(color: number): void {
    this.color = color;
    this.rebuildModel();
  }

  dispose(): void {
    this.model.dispose();
    this.staff?.dispose();
    if (this.status) (this.status.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }

  serialize(): SavedItem {
    return {
      id: this.def.id, tx: this.tx, tz: this.tz, rot: this.rot, level: this.level, color: this.color,
      cash: Math.round(this.cash), broken: this.broken, stats: { ...this.stats },
    };
  }
}

export interface SavedItem {
  id: string;
  tx: number;
  tz: number;
  rot: number;
  level: number;
  color: number;
  cash: number;
  broken: boolean;
  stats: ItemStats;
}

function pickOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
