import * as THREE from 'three';
import { Renderer, type Quality } from '../render/renderer';
import { Effects } from '../render/effects';
import { Input } from '../core/input';
import { audio, type SfxName } from '../core/audio';
import { Emitter } from '../core/events';
import { clamp, damp, distToRect, formatMoney } from '../core/math';
import { pick, rand, randInt } from '../core/rng';
import { Grid, EXPANSIONS, DOOR_TILES, CENTER_X, FACADE_Z } from '../world/grid';
import { FloorRenderer } from '../world/floor';
import { Building, type CasinoLook } from '../world/building';
import { CameraRig } from '../world/camera';
import { TrashManager } from '../world/trash';
import { ItemManager } from '../items/itemManager';
import { ITEMS, type ItemDef, itemDef } from '../items/catalog';
import type { PlacedItem, ItemHost, SeatUser } from '../items/placedItem';
import type { Outcome } from '../items/types';
import { Customer, type CustomerType, spawnPoint } from '../entities/customer';
import { Worker, ROLES, type WorkerRole } from '../entities/staff';
import { Player } from '../entities/player';
import { type Appearance, defaultAppearance } from '../entities/appearance';
import { Floaters } from '../ui/floaters';
import type { MoneyReason, World } from './world';
import { BuildController } from './build';
import { ACTIVE_OBJECTIVES, OBJECTIVES, type LifetimeStats, type ObjectiveView, emptyStats, xpForLevel } from './objectives';
import type { SavedItem } from '../items/placedItem';

export type ToastKind = 'info' | 'good' | 'bad' | 'money' | 'event';

export type Selection =
  | { kind: 'item'; item: PlacedItem }
  | { kind: 'customer'; c: Customer }
  | { kind: 'worker'; w: Worker };

export interface DayReport {
  day: number;
  revenue: number;
  payouts: number;
  sales: number;
  wages: number;
  upkeep: number;
  profit: number;
  visitors: number;
  bestMachine: string;
  rating: number;
}

export interface GameEvents {
  money: { money: number; delta: number };
  toast: { text: string; kind: ToastKind };
  level: { level: number; unlocked: ItemDef[] };
  select: Selection | null;
  mode: void;
  objectives: void;
  day: DayReport;
  look: void;
  staff: void;
  expansion: number;
  jackpot: { amount: number; machine: string };
  event: { title: string; text: string };
  interact: { label: string; hold: boolean } | null;
  minigame: PlacedItem;
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  musicOn: boolean;
  quality: Quality;
  showFps: boolean;
}

export interface SaveData {
  v: 1;
  name: string;
  look: CasinoLook;
  money: number;
  xp: number;
  level: number;
  day: number;
  dayMinutes: number;
  rating: number;
  satAvg: number;
  expansion: number;
  floor: string;
  items: SavedItem[];
  staff: { role: WorkerRole; name: string; look: Appearance }[];
  player: { look: Appearance; name: string; x: number; z: number };
  objectives: string[];
  stats: LifetimeStats;
  jackpotPot: number;
  trash: [number, number][];
  history: number[];
  floorPainted: number;
  lookEdited: boolean;
  renamed: boolean;
  speed: number;
  freeSpinDay?: number;
}

const DAY_SECONDS = 300;
const DAY_START = 10 * 60;
const START_MONEY = 3000;
const JACKPOT_SEED = 5000;

interface ActiveEvent {
  id: string;
  title: string;
  left: number;
  spawnMult: number;
}

export class Game implements World, ItemHost {
  readonly events = new Emitter<GameEvents>();
  readonly renderer: Renderer;
  readonly input: Input;
  readonly grid = new Grid(0);
  readonly floor: FloorRenderer;
  readonly building: Building;
  readonly cam: CameraRig;
  readonly effects = new Effects();
  readonly trash = new TrashManager();
  readonly items: ItemManager;
  readonly floaters: Floaters;
  readonly player: Player;
  readonly build: BuildController;
  customers: Customer[] = [];
  workers: Worker[] = [];

  state: 'title' | 'playing' = 'title';
  money = START_MONEY;
  xp = 0;
  level = 1;
  day = 1;
  dayMinutes = 0;
  rating = 2;
  private ratingTarget = 2;
  satAvg = 55;
  expansion = 0;
  jackpotPot = JACKPOT_SEED;
  freeSpinDay = 0;
  time = 0;
  speed = 1;
  paused = false;
  stats: LifetimeStats = emptyStats();
  doneObjectives = new Set<string>();
  floorPainted = 0;
  lookEdited = false;
  renamed = false;
  history: number[] = [];
  selection: Selection | null = null;
  private dayAcc = { revenue: 0, payouts: 0, sales: 0, visitors: 0, byItem: new Map<string, number>() };
  private spawnT = 3;
  private eventT = 60;
  private activeEvent: ActiveEvent | null = null;
  private buzz = 0;
  private autosaveT = 30;
  private objectiveT = 0;
  private collectT = new Map<number, number>();
  private interactTarget: { kind: string; label: string; anchor: () => THREE.Vector3; hold: boolean; act: () => void } | null = null;
  private holdT = 0;
  private lastInteractKey = '';
  private moneyHistoryT = 0;
  readonly moneyHistory: number[] = [];
  private netLog: [number, number][] = [];
  settings: Settings;
  actionHeld = false;
  actionPressed = false;
  modalOpen = false;
  private lastFrame = performance.now();
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 60;
  onSave: ((data: SaveData) => void) | null = null;
  readonly playerPos = new THREE.Vector3();
  /** Free camera focus used while building on touch screens (drag to pan). */
  private camFocus: THREE.Vector3 | null = null;
  private hoverT = 0;
  private hoverUid = -1;
  private nightT = 0;

  constructor(container: HTMLElement, settings: Settings) {
    this.settings = settings;
    this.renderer = new Renderer(container, settings.quality);
    this.input = new Input(this.renderer.renderer.domElement);
    const scene = this.renderer.scene;
    this.floor = new FloorRenderer(this.grid);
    this.building = new Building(this.grid, {
      name: 'Lucky Star Casino', signFont: 'bungee', signColor: 0xff3fa4, wallColor: 0x3a1d4d, trimColor: 0x2fe6ff,
    });
    this.items = new ItemManager(this.grid, this, this.effects);
    this.floaters = new Floaters(container);
    this.player = new Player(defaultAppearance(), CENTER_X, FACADE_Z - 3);
    this.cam = new CameraRig(this.renderer.camera);
    this.build = new BuildController(this);
    scene.add(this.floor.group, this.building.group, this.items.group, this.trash.group, this.effects.group, this.player.model.root);
    this.effects.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resetWorld();
  }

  // ------------------------------------------------------------------ setup

  private resetWorld(): void {
    for (const c of this.customers) c.dispose();
    for (const w of this.workers) w.dispose();
    this.customers = [];
    this.workers = [];
    this.items.clear();
    this.trash.clear();
    this.floaters.clear();
    this.selection = null;
    this.build.cancel(false);
    this.grid.setExpansion(this.expansion);
    this.building.rebuild();
    this.floor.rebuild();
    const r = this.grid.rect;
    this.renderer.fitShadow(r.x0, r.x1 + 1, r.z0, r.z1 + 1);
  }

  newGame(opts: { name: string; look: CasinoLook; player: Appearance; playerName: string }): void {
    this.state = 'playing';
    this.money = START_MONEY;
    this.xp = 0;
    this.level = 1;
    this.day = 1;
    this.dayMinutes = 0;
    this.rating = 2;
    this.ratingTarget = 2;
    this.satAvg = 55;
    this.expansion = 0;
    this.jackpotPot = JACKPOT_SEED;
    this.freeSpinDay = 0;
    this.stats = emptyStats();
    this.doneObjectives = new Set();
    this.floorPainted = 0;
    this.lookEdited = false;
    this.renamed = false;
    this.history = [];
    this.moneyHistory.length = 0;
    this.netLog = [];
    this.speed = 1;
    this.paused = false;
    this.grid.floor.fill(0);
    this.resetWorld();
    this.building.setLook(opts.look);
    this.player.setAppearance(opts.player);
    this.player.name = opts.playerName || 'Boss';
    this.player.x = CENTER_X;
    this.player.z = FACADE_Z - 3;
    this.player.yaw = Math.PI;
    this.cam.setOrbit(false);
    this.cam.distTarget = 15;
    this.cam.yawTarget = 0;
    this.cam.snap(this.player.x, this.player.z);
    this.spawnT = 2;
    this.eventT = 150;
    this.activeEvent = null;
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
    this.events.emit('staff', undefined);
    this.saveNow();
  }

  /** Decorated showroom for the title screen. */
  loadDemo(): void {
    this.state = 'title';
    this.expansion = 2;
    this.level = 10;
    this.rating = 4.2;
    this.money = 99999;
    this.grid.floor.fill(0);
    this.resetWorld();
    const r = this.grid.rect;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      if (x >= 21 && x <= 26) this.grid.setFloor(x, z, 5);
      else if (z < r.z0 + 7) this.grid.setFloor(x, z, 3);
    }
    this.floor.rebuild();
    const put = (id: string, tx: number, tz: number, rot = 0, color?: number) => {
      const def = itemDef(id);
      if (this.items.canPlace(def, tx, tz, rot).ok) this.items.add(def, tx, tz, rot, color);
    };
    for (let i = 0; i < 5; i++) put(i % 2 ? 'slot_fruit' : 'slot_lucky7', 13 + i, 26, 0, [0xc8102e, 0x1e7a46, 0x1f4fbf, 0x6a2cc2, 0xf2b632][i]);
    for (let i = 0; i < 5; i++) put('slot_diamond', 29 + i, 26, 0);
    put('roulette', 14, 30);
    put('blackjack', 30, 30);
    put('bar', 22, 22, 0);
    put('wheel', 18, 30);
    put('fountain', 23, 32);
    put('palm', 21, 36);
    put('palm', 26, 36);
    put('plant', 13, 36);
    put('plant', 34, 36);
    put('neon', 13, 24, 0, 0xff3fa4);
    put('neon', 34, 24, 0, 0x2fe6ff);
    put('craps', 15, 22);
    put('poker', 29, 22);
    put('statue', 20, 29);
    put('aquarium', 26, 29);
    put('bench', 17, 37);
    put('bench', 29, 37);
    put('rope', 22, 37);
    put('rope', 25, 37);
    this.building.setLook({ name: 'Jackpot Palace', signFont: 'bungee', signColor: 0xffc53d, wallColor: 0x3a1d4d, trimColor: 0xff3fa4 });
    for (let i = 0; i < 16; i++) {
      const [x, z] = [rand(r.x0 + 2, r.x1 - 2), rand(r.z1 - 6, r.z1)];
      this.spawnCustomer(i % 6 === 0 ? 'vip' : 'regular', x, z);
    }
    this.player.x = CENTER_X;
    this.player.z = 36;
    this.cam.setOrbit(true, CENTER_X, 30);
    this.cam.distTarget = 27;
    this.cam.snap(CENTER_X, 30);
  }

  // ------------------------------------------------------------------ World / ItemHost

  get playerPosition(): THREE.Vector3 {
    return this.playerPos;
  }

  addMoney(amount: number, reason: MoneyReason, pos?: THREE.Vector3): void {
    if (!amount) return;
    this.money += amount;
    if (amount > 0) {
      this.stats.earnedTotal += amount;
      if (reason === 'collect') this.stats.collected += amount;
    }
    if (pos && this.state === 'playing') this.floaters.money(pos, amount, Math.abs(amount) >= 500);
    this.events.emit('money', { money: this.money, delta: amount });
  }

  spend(amount: number, reason: MoneyReason): void {
    this.money -= amount;
    if (reason === 'purchase' || reason === 'upgrade') this.stats.purchases++;
    this.events.emit('money', { money: this.money, delta: -amount });
  }

  sfxAt(name: SfxName, x: number, z: number, volume = 1): void {
    if (this.state !== 'playing' && name !== 'jackpot') {
      audio.playAt(name, x, z, volume * 0.5);
      return;
    }
    audio.playAt(name, x, z, volume);
  }

  notify(text: string, kind: ToastKind = 'info'): void {
    if (this.state !== 'playing') return;
    this.events.emit('toast', { text, kind });
  }

  statueLook(): Appearance {
    return this.player.appearance;
  }

  staffCount(role: string): number {
    return this.workers.filter((w) => w.role === role).length;
  }

  stageBoostAt(x: number, z: number): number {
    let b = 0;
    for (const it of this.items.items) {
      if (it.def.kind !== 'stage') continue;
      const d = Math.hypot(it.cx - x, it.cz - z);
      if (d < it.def.appealRadius) b += 1.1 * (1 - d / it.def.appealRadius);
    }
    return b;
  }

  witness(x: number, z: number, radius: number, mood: number, except?: Customer): void {
    for (const c of this.customers) {
      if (c === except || !c.inside) continue;
      if (Math.hypot(c.x - x, c.z - z) <= radius) c.witnessed(mood);
    }
  }

  onCustomerExited(c: Customer): void {
    if (this.state !== 'playing') return;
    this.satAvg = this.satAvg * 0.93 + c.mood * 0.07;
  }

  onCustomerGone(c: Customer): void {
    c.dispose();
  }

  roundDone(item: PlacedItem, o: Outcome, user: SeatUser): void {
    const playing = this.state === 'playing';
    const k = item.def.kind;
    const pos = new THREE.Vector3(item.cx, item.model.height + 0.2, item.cz);
    const customer = this.customers.find((c) => c.uid === user.uid);
    const at = customer ? customer.headPos.clone() : pos;
    if (k === 'bar' || k === 'snack' || k === 'atm') {
      this.dayAcc.sales += o.bet;
      this.logNet(o.bet);
      if (k === 'bar' || k === 'snack') this.stats.drinksServed++;
      if (playing) this.sfxAt(k === 'atm' ? 'coin' : 'drink', item.cx, item.cz, 0.7);
      this.gainXp(1);
      return;
    }
    if (k === 'bench') return;
    this.stats.rounds++;
    this.logNet(o.bet - o.payout);
    this.dayAcc.revenue += o.bet;
    this.dayAcc.payouts += o.payout;
    this.dayAcc.byItem.set(item.def.name, (this.dayAcc.byItem.get(item.def.name) ?? 0) + (o.bet - o.payout));
    if (item.def.jackpot) this.jackpotPot += o.bet * 0.04;
    this.gainXp(1 + Math.min(20, o.bet / 40));
    if (k === 'claw' && o.tier === 'win') {
      if (playing) this.effects.sparkle(at.x, at.y, at.z, 10, 0xff9fcf);
      return;
    }
    if (o.tier === 'win') {
      if (playing) {
        this.floaters.money(at, o.payout);
        this.sfxAt('win', item.cx, item.cz, 0.55);
        this.effects.sparkle(pos.x, pos.y, pos.z, 6);
      }
    } else if (o.tier === 'big') {
      this.stats.bigWins++;
      this.stats.biggestWin = Math.max(this.stats.biggestWin, o.payout);
      if (playing) {
        this.floaters.text(at.clone().setY(at.y + 0.4), o.label, 'big');
        this.floaters.money(at, o.payout, true);
        this.sfxAt('bigwin', item.cx, item.cz, 0.9);
        this.effects.confetti(pos.x, pos.y, pos.z, 50, 0.8);
        this.cam.shake(0.05);
      }
    } else if (o.tier === 'jackpot') {
      this.stats.jackpots++;
      this.stats.bigWins++;
      this.stats.biggestWin = Math.max(this.stats.biggestWin, o.payout);
      if (item.def.jackpot && o.label.startsWith('MEGA')) this.jackpotPot = JACKPOT_SEED;
      this.buzz = Math.min(1, this.buzz + 0.5);
      if (playing) {
        this.floaters.text(at.clone().setY(at.y + 0.6), 'JACKPOT!', 'jackpot', 3, 1.4);
        this.floaters.money(at, o.payout, true);
        audio.play('jackpot');
        this.effects.confetti(pos.x, pos.y + 0.5, pos.z, 160, 1.2);
        this.effects.sparkle(pos.x, pos.y, pos.z, 30, 0xffd24a, 1.5);
        this.cam.shake(0.18);
        this.events.emit('jackpot', { amount: o.payout, machine: item.def.name });
        this.startEvent('buzz', 'Jackpot buzz!', `Word of the ${formatMoney(o.payout)} jackpot is spreading. More guests incoming!`, 45, 1.8);
      }
    } else if (o.tier === 'lose' && playing && item.def.shared && Math.random() < 0.3) {
      this.sfxAt('chips', item.cx, item.cz, 0.4);
    }
  }

  private logNet(amount: number): void {
    if (this.state !== 'playing') return;
    this.netLog.push([this.time, amount]);
    if (this.netLog.length > 4000) this.netLog.splice(0, 1000);
  }

  /** House net (bets minus payouts plus sales) over the last minute of game time. */
  get incomePerMin(): number {
    const since = this.time - 60;
    let sum = 0;
    for (let i = this.netLog.length - 1; i >= 0; i--) {
      const [t, a] = this.netLog[i];
      if (t < since) break;
      sum += a;
    }
    const span = Math.min(60, Math.max(10, this.time - (this.netLog[0]?.[0] ?? this.time)));
    return (sum / span) * 60;
  }

  roundStart(item: PlacedItem): void {
    if (this.state !== 'playing') return;
    const k = item.def.kind;
    const name: SfxName | null =
      k === 'slot' || k === 'pachinko' ? 'spin' : k === 'claw' ? 'claw' : k === 'roulette' || k === 'wheel' ? 'tick' : k === 'craps' ? 'dice' : k === 'blackjack' || k === 'poker' ? 'cards' : null;
    if (name) this.sfxAt(name, item.cx, item.cz, 0.45);
  }

  machineBroke(item: PlacedItem): void {
    this.sfxAt('break', item.cx, item.cz);
    this.effects.smoke(item.cx, item.model.height, item.cz, 6);
    const tech = this.staffCount('technician') > 0;
    this.notify(tech ? `${item.def.name} broke down. A technician is on the way.` : `${item.def.name} broke down! Stand next to it and hold Space to fix it.`, 'bad');
  }

  // ------------------------------------------------------------------ progression

  gainXp(amount: number): void {
    if (this.state !== 'playing') return;
    this.xp += amount;
    let leveled = false;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
      const unlocked = ITEMS.filter((d) => d.unlock === this.level);
      this.events.emit('level', { level: this.level, unlocked });
    }
    if (leveled) {
      audio.play('levelup');
      this.effects.confetti(this.player.x, 2, this.player.z, 90, 1);
    }
  }

  get xpNext(): number {
    return xpForLevel(this.level);
  }

  get freeSpinReady(): boolean {
    return this.freeSpinDay !== this.day;
  }

  useFreeSpin(): void {
    this.freeSpinDay = this.day;
    this.requestSave();
  }

  resetJackpot(): void {
    this.jackpotPot = JACKPOT_SEED;
  }

  objectiveView(): ObjectiveView {
    return {
      money: this.money,
      level: this.level,
      rating: this.rating,
      expansion: this.expansion,
      countItem: (id) => this.items.count(id),
      countCategory: (cat) => this.items.countKind((i) => i.def.category === cat),
      countKind: (kind) => this.items.countKind((i) => i.def.kind === kind),
      staffTotal: this.workers.length,
      customersNow: this.customers.filter((c) => c.inside && !c.exited).length,
      stats: this.stats,
      floorPainted: this.floorPainted,
      lookEdited: this.lookEdited,
      casinoRenamed: this.renamed,
    };
  }

  activeObjectives(): typeof OBJECTIVES {
    return OBJECTIVES.filter((o) => !this.doneObjectives.has(o.id)).slice(0, ACTIVE_OBJECTIVES);
  }

  private checkObjectives(): void {
    const v = this.objectiveView();
    let changed = false;
    for (const o of this.activeObjectives()) {
      if (o.progress(v) >= o.target) {
        this.doneObjectives.add(o.id);
        this.addMoney(o.reward, 'reward');
        this.gainXp(o.xp);
        audio.play('objective');
        this.events.emit('toast', { text: `Goal complete: ${o.text}  +${formatMoney(o.reward)}`, kind: 'good' });
        this.effects.confetti(this.player.x, 2.2, this.player.z, 60, 0.9);
        changed = true;
      }
    }
    if (changed) {
      this.events.emit('objectives', undefined);
      this.requestSave();
    }
  }

  /** Components of the star rating, each 0..1 (shown in the Casino panel). */
  ratingBreakdown(): { happiness: number; decor: number; variety: number; clean: number; working: number } {
    const r = this.grid.rect;
    const area = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1);
    const machines = this.items.items.filter((i) => i.isGambling);
    const kinds = new Set(machines.map((i) => i.def.kind));
    const broken = machines.length ? machines.filter((m) => m.broken).length / machines.length : 0;
    return {
      happiness: clamp(this.satAvg / 100, 0, 1),
      decor: clamp(this.items.totalAppeal / (area * 0.1), 0, 1),
      variety: clamp((kinds.size - 1) / 5, 0, 1),
      clean: 1 - clamp(this.trash.list.length / Math.max(12, area / 10), 0, 1),
      working: 1 - broken,
    };
  }

  private updateRating(dt: number): void {
    const b = this.ratingBreakdown();
    const noGames = this.items.items.some((i) => i.isGambling) ? 0 : 0.8;
    this.ratingTarget = clamp(
      0.6 + b.happiness * 2.5 + b.decor * 0.95 + b.variety * 0.7 - (1 - b.clean) * 0.9 - (1 - b.working) * 0.7 + this.buzz * 0.4 - noGames,
      0.5,
      5,
    );
    this.buzz = Math.max(0, this.buzz - dt * 0.004);
    this.rating = damp(this.rating, this.ratingTarget, 0.06, dt);
  }

  // ------------------------------------------------------------------ customers & events

  spawnCustomer(type: CustomerType, x?: number, z?: number): Customer {
    const [sx, sz] = x !== undefined && z !== undefined ? [x, z] : spawnPoint();
    const c = new Customer(type, sx, sz);
    this.customers.push(c);
    this.renderer.scene.add(c.model.root);
    if (this.state === 'playing') {
      this.stats.visitors++;
      this.dayAcc.visitors++;
      if (type === 'vip') {
        this.notify(`A VIP high roller just arrived! Greet ${c.name.split(' ')[0]} for a tip.`, 'event');
        audio.play('doorbell');
      }
    }
    return c;
  }

  private maxCustomers(): number {
    const q = this.settings.quality;
    return q === 'high' ? 80 : q === 'medium' ? 55 : 35;
  }

  private hourMult(): number {
    const clock = (DAY_START + this.dayMinutes) % 1440;
    const h = clock / 60;
    if (h >= 20 || h < 2) return 1.35;
    if (h >= 17) return 1.15;
    if (h >= 2 && h < 6) return 0.7;
    if (h >= 6 && h < 11) return 0.75;
    return 1;
  }

  private updateSpawner(dt: number): void {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const seats = this.items.gamblingSeats();
    const benchSeats = this.items.countKind((i) => i.def.kind === 'bench') * 2;
    const cap = Math.min(this.maxCustomers(), Math.round(3 + seats * 1.15 + benchSeats * 0.5));
    const inside = this.customers.filter((c) => !c.exited).length;
    const mult = this.activeEvent?.spawnMult ?? 1;
    if (seats > 0 && inside < cap) {
      let type: CustomerType = 'regular';
      const vipChance = this.rating >= 2.5 ? 0.025 + (this.rating - 2.5) * 0.035 : 0;
      const cheatChance = this.level >= 3 ? 0.045 : 0;
      const r = Math.random();
      if (r < vipChance) type = 'vip';
      else if (r < vipChance + cheatChance) type = 'cheater';
      else if (r < vipChance + cheatChance + 0.1) type = 'tourist';
      this.spawnCustomer(type);
    }
    const perMin = (3.5 + this.rating * 2.4 + Math.min(this.items.totalAppeal, 80) * 0.1 + seats * 0.2) * this.hourMult() * mult;
    this.spawnT = (60 / perMin) * rand(0.6, 1.4);
  }

  private startEvent(id: string, title: string, text: string, seconds: number, spawnMult: number): void {
    this.activeEvent = { id, title, left: seconds, spawnMult };
    this.events.emit('event', { title, text });
  }

  private updateEvents(dt: number): void {
    if (this.activeEvent) {
      this.activeEvent.left -= dt;
      if (this.activeEvent.left <= 0) this.activeEvent = null;
    }
    this.eventT -= dt;
    if (this.eventT > 0 || this.items.gamblingSeats() < 4) return;
    this.eventT = rand(140, 260);
    const options: (() => void)[] = [
      () => this.startEvent('happy', 'Happy hour!', 'Guests are pouring in for cheap drinks.', 60, 2),
      () => {
        this.events.emit('event', { title: 'Tour bus!', text: 'A bus full of tourists just pulled up outside.' });
        for (let i = 0; i < randInt(6, 10); i++) {
          const [x, z] = spawnPoint();
          this.spawnCustomer('tourist', x + rand(-1, 1), z);
        }
      },
    ];
    if (this.rating >= 2.5) {
      options.push(() => {
        this.events.emit('event', { title: 'High rollers!', text: 'A group of VIPs is in town. Greet them for big tips.' });
        for (let i = 0; i < randInt(2, 4); i++) this.spawnCustomer('vip');
      });
    }
    if (this.level >= 3 && this.items.items.filter((i) => i.isGambling && !i.def.shared).length >= 6) {
      options.push(() => {
        const machines = this.items.items.filter((i) => i.isGambling && !i.broken && !i.def.shared);
        const n = Math.min(machines.length, randInt(1, 3));
        for (let i = 0; i < n; i++) pick(machines).setBroken(true);
        this.events.emit('event', { title: 'Power surge!', text: 'A few machines shorted out. Get them fixed!' });
      });
    }
    pick(options)();
  }

  // ------------------------------------------------------------------ economy actions

  purchase(def: ItemDef, tx: number, tz: number, rot: number, color: number): PlacedItem | null {
    if (this.money < def.price) {
      audio.play('error');
      this.notify(`Not enough cash for ${def.name}`, 'bad');
      return null;
    }
    const check = this.items.canPlace(def, tx, tz, rot);
    if (!check.ok) {
      audio.play('error');
      this.notify(check.reason ?? 'Can’t place that here', 'bad');
      return null;
    }
    this.spend(def.price, 'purchase');
    const hadSeats = this.items.gamblingSeats() > 0;
    const item = this.items.add(def, tx, tz, rot, color);
    if (!hadSeats && item.isGambling) this.spawnT = Math.min(this.spawnT, 0.8);
    item.playDropIn();
    this.afterLayoutChange();
    audio.play('place');
    this.effects.dust(item.cx, item.cz, Math.max(def.size[0], def.size[1]) * 0.7);
    this.effects.sparkle(item.cx, 1, item.cz, 10);
    this.floaters.money(new THREE.Vector3(item.cx, 1.5, item.cz), -def.price);
    this.gainXp(Math.round(def.price / 60));
    this.requestSave();
    return item;
  }

  afterLayoutChange(): void {
    this.player.unstick(this.grid);
    for (const c of this.customers) {
      if (c.state === 'seated') continue;
      const tx = Math.floor(c.x);
      const tz = Math.floor(c.z);
      if (!this.grid.isWalkable(tx, tz)) {
        const n = this.grid.nearestWalkable(tx, tz);
        if (n) {
          c.x = n[0] + 0.5;
          c.z = n[1] + 0.5;
        }
      }
    }
    this.renderer.markShadowsDirty(30);
  }

  upgrade(item: PlacedItem): boolean {
    if (!item.upgradable || item.level >= 5) return false;
    const cost = item.upgradeCost;
    if (this.money < cost) {
      audio.play('error');
      this.notify(`Upgrade costs ${formatMoney(cost)}`, 'bad');
      return false;
    }
    this.spend(cost, 'upgrade');
    item.upgrade();
    audio.play('levelup');
    this.effects.sparkle(item.cx, 1.2, item.cz, 24, 0xffd24a, 1.2);
    this.floaters.text(new THREE.Vector3(item.cx, item.model.height + 0.3, item.cz), `Level ${item.level}!`, 'good');
    this.renderer.markShadowsDirty(4);
    this.gainXp(Math.round(cost / 50));
    this.requestSave();
    return true;
  }

  sell(item: PlacedItem): void {
    const value = item.sellValue + Math.max(0, Math.floor(item.cash));
    this.items.remove(item);
    this.addMoney(value, 'sell', new THREE.Vector3(item.cx, 1.5, item.cz));
    audio.play('sell');
    this.effects.dust(item.cx, item.cz, 1);
    if (this.selection?.kind === 'item' && this.selection.item === item) this.select(null);
    this.afterLayoutChange();
    this.requestSave();
  }

  repaint(item: PlacedItem, color: number): void {
    item.repaint(color);
    this.renderer.markShadowsDirty(3);
    audio.play('paint');
    this.lookEdited = true;
    this.requestSave();
  }

  hire(role: WorkerRole): boolean {
    const info = ROLES.find((r) => r.role === role)!;
    if (this.level < info.unlock) {
      this.notify(`${info.title}s unlock at level ${info.unlock}`, 'bad');
      return false;
    }
    const cost = info.wage;
    if (this.money < cost) {
      audio.play('error');
      this.notify(`Hiring costs a signing bonus of ${formatMoney(cost)}`, 'bad');
      return false;
    }
    this.spend(cost, 'wages');
    const [dx, dz] = DOOR_TILES[0];
    const w = new Worker(role, dx + 0.5, dz - 0.5);
    this.workers.push(w);
    this.renderer.scene.add(w.model.root);
    audio.play('purchase');
    this.notify(`${w.name} joined as your ${info.title.toLowerCase()}!`, 'good');
    this.events.emit('staff', undefined);
    this.requestSave();
    return true;
  }

  fire(w: Worker): void {
    w.release();
    w.dispose();
    this.workers = this.workers.filter((o) => o !== w);
    if (this.selection?.kind === 'worker' && this.selection.w === w) this.select(null);
    this.events.emit('staff', undefined);
    this.requestSave();
  }

  expand(): boolean {
    const next = EXPANSIONS[this.expansion + 1];
    if (!next) return false;
    if (this.level < next.level) {
      this.notify(`Reach level ${next.level} to expand`, 'bad');
      return false;
    }
    if (this.money < next.cost) {
      audio.play('error');
      this.notify(`Expansion costs ${formatMoney(next.cost)}`, 'bad');
      return false;
    }
    this.spend(next.cost, 'expand');
    this.expansion++;
    const prev = { ...this.grid.rect };
    this.grid.setExpansion(this.expansion);
    // New floor inherits the most used carpet
    const counts = new Map<number, number>();
    for (let z = prev.z0; z <= prev.z1; z++) for (let x = prev.x0; x <= prev.x1; x++) {
      const s = this.grid.getFloor(x, z);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const r = this.grid.rect;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      const inside = x >= prev.x0 && x <= prev.x1 && z >= prev.z0 && z <= prev.z1;
      if (!inside) this.grid.setFloor(x, z, main);
    }
    this.building.rebuild();
    this.floor.rebuild();
    this.renderer.fitShadow(r.x0, r.x1 + 1, r.z0, r.z1 + 1);
    this.items.recompute();
    audio.play('levelup');
    for (let i = 0; i < 8; i++) this.effects.dust(rand(r.x0, r.x1), rand(r.z0, r.z1), 1.5);
    this.effects.confetti(this.player.x, 2.5, this.player.z, 120, 1.1);
    this.notify(`Casino expanded to ${next.w}×${next.d}!`, 'good');
    this.events.emit('expansion', this.expansion);
    this.gainXp(Math.round(next.cost / 40));
    this.requestSave();
    return true;
  }

  setLook(look: Partial<CasinoLook>): void {
    if (look.name !== undefined && look.name !== this.building.look.name) this.renamed = true;
    this.building.setLook(look);
    this.lookEdited = true;
    this.events.emit('look', undefined);
    this.requestSave();
  }

  setPlayerLook(look: Appearance, name?: string): void {
    this.player.setAppearance(look);
    if (name !== undefined) this.player.name = name || 'Boss';
    for (const it of this.items.items) if (it.def.model === 'statue') it.rebuildModel();
    this.events.emit('look', undefined);
    this.requestSave();
  }

  // ------------------------------------------------------------------ selection & interaction

  select(sel: Selection | null): void {
    this.selection = sel;
    if (sel?.kind === 'item') {
      const b = sel.item.bounds;
      this.items.selection.show(b.x0, b.z0, b.x1, b.z1, 0x2fe6ff);
    } else if (!this.build.active) {
      this.items.selection.hide();
    }
    this.events.emit('select', sel);
  }

  emitMode(): void {
    if (this.build.active) this.select(null);
    this.events.emit('mode', undefined);
  }

  private pickCharacter(px: number, py: number): Customer | Worker | null {
    const { w, h } = this.renderer.size;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.renderer.camera);
    let best: Customer | Worker | null = null;
    let bestT = Infinity;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const onRay = new THREE.Vector3();
    const onSeg = new THREE.Vector3();
    for (const c of [...this.customers, ...this.workers]) {
      if ((c as Customer).gone) continue;
      a.set(c.x, 0.15, c.z);
      b.set(c.x, 1.25, c.z);
      const d2 = ray.ray.distanceSqToSegment(a, b, onRay, onSeg);
      if (d2 < 0.36 * 0.36) {
        const t = onRay.distanceTo(ray.ray.origin);
        if (t < bestT) {
          bestT = t;
          best = c;
        }
      }
    }
    return best;
  }

  private handleClicks(): void {
    if (this.build.active) return;
    for (const c of this.input.clicks) {
      const ch = this.pickCharacter(c.x, c.y);
      if (ch) {
        audio.play('click');
        this.select(ch instanceof Customer ? { kind: 'customer', c: ch } : { kind: 'worker', w: ch as Worker });
        continue;
      }
      const { w, h } = this.renderer.size;
      const item = this.items.pick(new THREE.Vector2((c.x / w) * 2 - 1, -(c.y / h) * 2 + 1), this.renderer.camera);
      if (item) {
        audio.play('click');
        this.select({ kind: 'item', item });
      } else if (this.selection) {
        this.select(null);
      }
    }
  }

  /** Desktop hover: outline the machine under the cursor and show a pointer. */
  private updateHover(dt: number): void {
    const input = this.input;
    const canvas = this.renderer.renderer.domElement;
    if (this.state !== 'playing' || this.build.active || input.isTouch || !input.pointer.over) {
      if (this.hoverUid !== -1) {
        this.hoverUid = -1;
        this.items.hover.hide();
        canvas.style.cursor = '';
      }
      return;
    }
    this.hoverT -= dt;
    if (this.hoverT > 0) return;
    this.hoverT = 0.08;
    const { w, h } = this.renderer.size;
    const ch = this.pickCharacter(input.pointer.x, input.pointer.y);
    const item = ch ? undefined : this.items.pick(new THREE.Vector2((input.pointer.x / w) * 2 - 1, -(input.pointer.y / h) * 2 + 1), this.renderer.camera);
    canvas.style.cursor = ch || item ? 'pointer' : '';
    const uid = item?.uid ?? -1;
    if (uid === this.hoverUid) return;
    this.hoverUid = uid;
    const selected = this.selection?.kind === 'item' ? this.selection.item : null;
    if (item && item !== selected) {
      const b = item.bounds;
      this.items.hover.show(b.x0, b.z0, b.x1, b.z1, 0xffc53d);
    } else this.items.hover.hide();
  }

  private updateInteraction(dt: number): void {
    const p = this.player;
    // Auto-collect cash from nearby machines
    for (const it of this.items.items) {
      if (it.cash < 5) continue;
      const b = it.bounds;
      if (distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1) > 1.35) continue;
      const last = this.collectT.get(it.uid) ?? -10;
      if (this.time - last < 0.5) continue;
      this.collectT.set(it.uid, this.time);
      const amount = Math.floor(it.cash);
      it.cash -= amount;
      const from = new THREE.Vector3(it.cx, it.model.height + 0.3, it.cz);
      const target = () => new THREE.Vector3(p.x, 1.0, p.z);
      this.effects.coinFlight(from, target, Math.max(2, Math.round(Math.log2(amount + 1) * 1.5)), () => audio.play('coin', { pitch: 0.9 + Math.random() * 0.3 }));
      this.addMoney(amount, 'collect', new THREE.Vector3(p.x, 1.6, p.z));
      if (amount >= 200) audio.play('cash');
      this.gainXp(Math.min(15, amount / 60));
    }
    // Pick up litter by walking over it
    for (const t of this.trash.near(p.x, p.z, 0.65)) {
      this.trash.remove(t);
      this.stats.trashCleaned++;
      this.effects.sparkle(t.x, 0.3, t.z, 6, 0xbfe9ff, 0.4);
      audio.play('pop', { volume: 0.5, pitch: 1.4 });
      this.gainXp(2);
    }

    // Context action
    let target: typeof this.interactTarget = null;
    let bestD = Infinity;
    for (const it of this.items.items) {
      if (!it.broken) continue;
      const b = it.bounds;
      const d = distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1);
      if (d < 1.3 && d < bestD) {
        bestD = d;
        target = {
          kind: 'repair', label: 'Hold to fix', hold: true, anchor: () => new THREE.Vector3(it.cx, it.model.height + 0.9, it.cz),
          act: () => {
            it.broken = false;
            this.stats.repairs++;
            this.effects.sparkle(it.cx, 1.2, it.cz, 18, 0x9fe8ff, 1);
            audio.play('fixed');
            this.floaters.text(new THREE.Vector3(it.cx, it.model.height + 0.4, it.cz), 'Fixed!', 'good');
            this.gainXp(25);
          },
        };
      }
    }
    for (const c of this.customers) {
      if (c.exited || c.gone) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d > 1.7 || d >= bestD) continue;
      if (c.exposed) {
        bestD = d;
        target = {
          kind: 'bust', label: 'Bust cheater!', hold: false, anchor: () => c.headPos.clone().setY(c.headPos.y + 0.35),
          act: () => {
            const loot = c.bust(this);
            this.stats.cheatersCaught++;
            this.addMoney(loot, 'bust', c.headPos.clone());
            audio.play('bust');
            this.player.playEmote('point', 1.2);
            this.floaters.text(c.headPos.clone().setY(c.headPos.y + 0.5), 'BUSTED!', 'bad', 2);
            this.notify(`Cheater busted! You recovered ${formatMoney(loot)}.`, 'good');
            this.buzz = Math.min(1, this.buzz + 0.05);
            this.gainXp(60);
          },
        };
      } else if (c.type === 'vip' && !c.greeted && c.inside) {
        bestD = d;
        target = {
          kind: 'greet', label: 'Greet VIP', hold: false, anchor: () => c.headPos.clone().setY(c.headPos.y + 0.35),
          act: () => {
            const tip = c.greet(this);
            this.stats.vipsGreeted++;
            this.addMoney(tip, 'tip', c.headPos.clone());
            audio.play('cash');
            this.player.playEmote('wave', 1.4);
            this.gainXp(30);
          },
        };
      } else if (c.mood < 38 && !c.comped && c.inside && c.state !== 'leave') {
        bestD = d;
        target = {
          kind: 'comp', label: 'Comp a drink ($20)', hold: false, anchor: () => c.headPos.clone().setY(c.headPos.y + 0.35),
          act: () => {
            if (this.money < 20) {
              audio.play('error');
              return;
            }
            this.spend(20, 'comp');
            c.comp(this);
            this.stats.comps++;
            audio.play('drink');
            this.player.playEmote('wave', 1);
            this.gainXp(8);
          },
        };
      }
    }
    if (!target) {
      let bestPlay = 1.25;
      for (const it of this.items.items) {
        if (it.def.kind !== 'slot' || it.broken) continue;
        const b = it.bounds;
        const d = distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1);
        if (d >= bestPlay || it.occupiedCount() >= it.seats.length) continue;
        bestPlay = d;
        target = {
          kind: `play${it.uid}`, label: this.freeSpinReady ? `Free spin on ${it.def.name}!` : `Play ${it.def.name}`, hold: false,
          anchor: () => new THREE.Vector3(it.cx, it.model.height + 0.7, it.cz),
          act: () => this.events.emit('minigame', it),
        };
      }
    }
    const key = target ? `${target.kind}:${target.label}:${bestD < Infinity}` : '';
    this.interactTarget = target;
    if (key !== this.lastInteractKey) {
      this.lastInteractKey = key;
      this.holdT = 0;
      this.events.emit('interact', target ? { label: target.label, hold: target.hold } : null);
      this.floaters.prompt(target ? target.anchor : null, target ? `<b>${this.input.isTouch ? '●' : 'Space'}</b> ${target.label}` : '');
    }
    const blocked = this.modalOpen;
    const pressing = !blocked && (this.input.down('Space') || this.input.down('KeyF') || this.actionHeld);
    const pressed = !blocked && (this.input.hit('Space') || this.input.hit('KeyF') || this.actionPressed);
    this.actionPressed = false;
    if (target) {
      if (target.hold) {
        if (pressing) {
          this.holdT += dt;
          if (Math.random() < dt * 6) audio.play('repair', { volume: 0.6 });
          this.player.playEmote('repair', 0.2);
          this.floaters.ring(target.anchor, Math.min(1, this.holdT / 1.6));
          if (this.holdT >= 1.6) {
            target.act();
            this.holdT = 0;
            this.floaters.ring(null, 0);
            this.lastInteractKey = '';
          }
        } else {
          this.holdT = Math.max(0, this.holdT - dt * 2);
          this.floaters.ring(this.holdT > 0 ? target.anchor : null, this.holdT / 1.6);
        }
      } else if (pressed) {
        target.act();
        this.lastInteractKey = '';
      }
    } else {
      this.floaters.ring(null, 0);
    }
  }

  // ------------------------------------------------------------------ loop

  private endOfDay(): void {
    const wages = this.workers.reduce((a, w) => a + w.info.wage, 0);
    const upkeep = this.items.items.reduce((a, i) => a + i.def.upkeep, 0);
    this.money -= wages + upkeep;
    const best = [...this.dayAcc.byItem.entries()].sort((a, b) => b[1] - a[1])[0];
    const report: DayReport = {
      day: this.day,
      revenue: Math.round(this.dayAcc.revenue),
      payouts: Math.round(this.dayAcc.payouts),
      sales: Math.round(this.dayAcc.sales),
      wages,
      upkeep,
      profit: Math.round(this.dayAcc.revenue - this.dayAcc.payouts + this.dayAcc.sales - wages - upkeep),
      visitors: this.dayAcc.visitors,
      bestMachine: best ? best[0] : '—',
      rating: this.rating,
    };
    this.history.push(report.profit);
    if (this.history.length > 30) this.history.shift();
    this.dayAcc = { revenue: 0, payouts: 0, sales: 0, visitors: 0, byItem: new Map() };
    this.day++;
    this.events.emit('money', { money: this.money, delta: -(wages + upkeep) });
    this.events.emit('day', report);
    this.saveNow();
  }

  get clockMinutes(): number {
    return (DAY_START + this.dayMinutes) % 1440;
  }

  get activeEventInfo(): ActiveEvent | null {
    return this.activeEvent;
  }

  frame(now: number): void {
    const raw = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.05, raw);
    this.lastFrame = now;
    this.fpsAcc += raw;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.step(dt, true);
  }

  /** Advance the game without rendering (used by tests and balance checks). */
  simulate(seconds: number, dt = 0.05): void {
    const steps = Math.ceil(seconds / dt);
    for (let i = 0; i < steps; i++) this.step(dt, false);
  }

  private step(dt: number, render: boolean): void {
    const sim = this.paused ? 0 : dt * this.speed;
    this.time += sim;
    const input = this.input;
    const playing = this.state === 'playing';

    // Camera controls
    if (input.wheel) this.cam.zoomBy(Math.exp(input.wheel * 0.0012));
    if (input.pinch !== 1) this.cam.zoomBy(input.pinch);
    if (playing && !this.paused) {
      if (input.hit('KeyQ')) this.cam.rotate(-1);
      if (input.hit('KeyE')) this.cam.rotate(1);
      if (input.hit('Minus') || input.hit('NumpadSubtract')) this.cam.zoomBy(1.15);
      if (input.hit('Equal') || input.hit('NumpadAdd')) this.cam.zoomBy(1 / 1.15);
      if (input.hit('Escape')) {
        if (this.build.active) this.build.cancel();
        else if (this.selection) this.select(null);
      }
      if (!this.build.active) {
        if (input.hit('Digit1')) this.player.playEmote('wave', 2);
        if (input.hit('Digit2')) this.player.playEmote('dance', 4);
        if (input.hit('Digit3')) this.player.playEmote('cheer', 2);
        if (input.hit('Digit4')) this.player.playEmote('clap', 2);
      }
    }

    // Player movement
    if (playing && !this.paused) {
      let ix = 0;
      let iz = 0;
      if (input.down('KeyW') || input.down('ArrowUp')) iz += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) iz -= 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) ix -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) ix += 1;
      if (input.joy.active) {
        ix += input.joy.x;
        iz -= input.joy.y;
      }
      const sprint = input.down('ShiftLeft') || input.down('ShiftRight') || Math.hypot(input.joy.x, input.joy.y) > 0.92;
      this.player.update(dt, ix, iz, sprint, this.cam.basis(), this.grid);
    } else {
      this.player.update(dt, 0, 0, false, this.cam.basis(), this.grid);
    }
    this.player.model.root.visible = playing;
    this.playerPos.set(this.player.x, 0, this.player.z);

    if (playing && !this.paused) {
      this.build.update();
      this.handleClicks();
    }
    if (render) this.updateHover(dt);
    // Touch building: joystick off, drag / two-finger drag pans the camera instead.
    const touchBuild = playing && this.build.active && input.isTouch;
    input.joystickEnabled = !touchBuild && !this.modalOpen;
    if (touchBuild) {
      this.camFocus ??= new THREE.Vector3(this.cam.focus.x, 0, this.cam.focus.z);
      let dx = input.panDX;
      let dy = input.panDY;
      if (this.build.mode.kind === 'place') {
        dx += input.dragDX;
        dy += input.dragDY;
      }
      if (dx || dy) {
        const k = (2 * this.cam.dist * Math.tan(THREE.MathUtils.degToRad(this.renderer.camera.fov / 2))) / Math.max(1, this.renderer.size.h);
        const b = this.cam.basis();
        this.camFocus.x += -b.rx * dx * k + b.fx * dy * k * 1.35;
        this.camFocus.z += -b.rz * dx * k + b.fz * dy * k * 1.35;
        const r = this.grid.rect;
        this.camFocus.x = clamp(this.camFocus.x, r.x0 - 2, r.x1 + 3);
        this.camFocus.z = clamp(this.camFocus.z, r.z0 - 2, r.z1 + 6);
      }
    } else if (!this.build.active) {
      this.camFocus = null;
    }

    // Simulation
    if (sim > 0) {
      if (playing) {
        this.dayMinutes += sim * (1440 / DAY_SECONDS);
        if (this.dayMinutes >= 1440) {
          this.dayMinutes -= 1440;
          this.endOfDay();
        }
        this.updateEvents(sim);
        this.updateRating(sim);
      }
      this.updateSpawner(sim);
      for (const c of this.customers) c.update(sim, this);
      if (this.customers.some((c) => c.gone)) {
        this.customers = this.customers.filter((c) => {
          if (c.gone) {
            if (this.selection?.kind === 'customer' && this.selection.c === c) this.select(null);
            return false;
          }
          return true;
        });
      }
      for (const w of this.workers) w.update(sim, this);
      this.items.update(sim, this.time);
      if (playing) {
        this.updateInteraction(sim);
        this.objectiveT -= sim;
        if (this.objectiveT <= 0) {
          this.objectiveT = 0.5;
          this.checkObjectives();
        }
        this.moneyHistoryT -= sim;
        if (this.moneyHistoryT <= 0) {
          this.moneyHistoryT = 5;
          this.moneyHistory.push(Math.round(this.money));
          if (this.moneyHistory.length > 120) this.moneyHistory.shift();
        }
      }
    }
    this.effects.update(this.paused ? 0 : dt);

    // Autosave
    if (playing) {
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) this.saveNow();
    }

    // Audio listener and ambience
    audio.listener.x = this.cam.focus.x;
    audio.listener.z = this.cam.focus.z;
    audio.listener.yaw = this.cam.yaw;
    audio.bustle = clamp(this.customers.length / 40, 0, 1) * (this.paused ? 0 : 1);

    const fx = this.camFocus?.x ?? this.player.x;
    const fz = this.camFocus?.z ?? this.player.z;
    this.cam.update(dt, fx, fz);
    this.building.update(dt, this.cam.yaw);
    // Neon pops a little more after dark
    const hour = this.clockMinutes / 60;
    const night = hour >= 20 || hour < 5 ? 1 : hour >= 17 ? (hour - 17) / 3 : hour < 8 ? 1 - (hour - 5) / 3 : 0;
    this.nightT = damp(this.nightT, this.state === 'playing' ? night : 0.6, 0.5, dt);
    this.renderer.setMood(this.nightT);
    if (!render) return;
    const { w, h } = this.renderer.size;
    this.floaters.update(dt, this.renderer.camera, w, h);
    this.renderer.render();
    input.endFrame();
  }

  // ------------------------------------------------------------------ persistence

  private saveRequested = false;

  requestSave(): void {
    if (this.saveRequested) return;
    this.saveRequested = true;
    window.setTimeout(() => {
      this.saveRequested = false;
      this.saveNow();
    }, 1500);
  }

  saveNow(): void {
    this.autosaveT = 30;
    if (this.state !== 'playing') return;
    this.onSave?.(this.serialize());
  }

  serialize(): SaveData {
    return {
      v: 1,
      name: this.building.look.name,
      look: { ...this.building.look },
      money: Math.round(this.money),
      xp: Math.round(this.xp),
      level: this.level,
      day: this.day,
      dayMinutes: this.dayMinutes,
      rating: this.rating,
      satAvg: this.satAvg,
      expansion: this.expansion,
      floor: encodeFloor(this.grid.floor),
      items: this.items.serialize(),
      staff: this.workers.map((w) => ({ role: w.role, name: w.name, look: w.look })),
      player: { look: this.player.appearance, name: this.player.name, x: this.player.x, z: this.player.z },
      objectives: [...this.doneObjectives],
      stats: { ...this.stats },
      jackpotPot: Math.round(this.jackpotPot),
      trash: this.trash.serialize(),
      history: [...this.history],
      floorPainted: this.floorPainted,
      lookEdited: this.lookEdited,
      renamed: this.renamed,
      speed: this.speed,
      freeSpinDay: this.freeSpinDay,
    };
  }

  load(s: SaveData): void {
    this.state = 'playing';
    this.money = s.money;
    this.xp = s.xp;
    this.level = s.level;
    this.day = s.day;
    this.dayMinutes = s.dayMinutes;
    this.rating = s.rating;
    this.ratingTarget = s.rating;
    this.satAvg = s.satAvg;
    this.expansion = clamp(s.expansion, 0, EXPANSIONS.length - 1);
    this.jackpotPot = s.jackpotPot || JACKPOT_SEED;
    this.stats = { ...emptyStats(), ...s.stats };
    this.doneObjectives = new Set(s.objectives);
    this.floorPainted = s.floorPainted ?? 0;
    this.lookEdited = !!s.lookEdited;
    this.renamed = !!s.renamed;
    this.history = s.history ?? [];
    this.netLog = [];
    this.freeSpinDay = s.freeSpinDay ?? 0;
    this.speed = s.speed || 1;
    this.paused = false;
    decodeFloor(s.floor, this.grid.floor);
    this.resetWorld();
    this.building.setLook(s.look);
    this.items.load(s.items);
    for (const [x, z] of s.trash ?? []) this.trash.add(x, z);
    for (const st of s.staff ?? []) {
      const [dx, dz] = DOOR_TILES[0];
      const w = new Worker(st.role, dx + 0.5, dz - 1.5, st.look, st.name);
      this.workers.push(w);
      this.renderer.scene.add(w.model.root);
    }
    this.player.setAppearance(s.player.look);
    this.player.name = s.player.name;
    this.player.x = s.player.x;
    this.player.z = s.player.z;
    this.player.unstick(this.grid);
    for (const it of this.items.items) if (it.def.model === 'statue') it.rebuildModel();
    this.cam.setOrbit(false);
    this.cam.distTarget = 15;
    this.cam.snap(this.player.x, this.player.z);
    this.spawnT = 1;
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
    this.events.emit('staff', undefined);
  }

  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.renderer.setQuality(q);
  }
}

function encodeFloor(arr: Uint8Array): string {
  // Run-length encoding: "value:count,value:count"
  const out: string[] = [];
  let cur = arr[0];
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === cur) n++;
    else {
      out.push(`${cur}:${n}`);
      cur = arr[i];
      n = 1;
    }
  }
  out.push(`${cur}:${n}`);
  return out.join(',');
}

function decodeFloor(s: string, into: Uint8Array): void {
  into.fill(0);
  if (!s) return;
  let i = 0;
  for (const part of s.split(',')) {
    const [v, n] = part.split(':').map(Number);
    for (let k = 0; k < n && i < into.length; k++) into[i++] = v;
  }
}
