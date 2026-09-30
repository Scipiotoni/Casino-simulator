import * as THREE from 'three';
import { Renderer, type Quality } from '../render/renderer';
import { Effects } from '../render/effects';
import { Input } from '../core/input';
import { audio, type SfxName } from '../core/audio';
import { Emitter } from '../core/events';
import { clamp, damp, distToRect, formatMoney } from '../core/math';
import { pick, rand, randInt } from '../core/rng';
import {
  Grid, CENTER_X, FACADE_Z, DOOR_TILES, WIDTHS, MAX_WIDTH, depthCost, depthLevel, floorCost, floorLevel, type Layout,
} from '../world/grid';
import { FloorRenderer } from '../world/floor';
import { Building, STORY_DROP, type CasinoLook } from '../world/building';
import { Street, type StreetLot } from '../world/street';
import { type CosmeticState, cosmetic, emptyCosmetics, equipped, sanitizeCosmetics } from '../cosmetics/catalog';
import { PlayerFx } from '../cosmetics/playerFx';
import {
  type HotelState, HOTEL_LAYOUT, HOTEL_LEVEL, HOTEL_MAX_FLOORS, HOTEL_PRICE, HOTEL_TIERS, generateHotel, hotelFloorCost, hotelGuestBoost,
  hotelLook, hotelNight, hotelRooms, newHotel, sanitizeHotel,
} from './hotel';
import { CameraRig, type CamMode } from '../world/camera';
import { TrashManager } from '../world/trash';
import { FLOOR_STYLES } from '../render/textures';
import { ItemManager } from '../items/itemManager';
import { ITEMS, type ItemDef, itemDef } from '../items/catalog';
import type { PlacedItem, ItemHost, SeatUser } from '../items/placedItem';
import type { Outcome } from '../items/types';
import { Customer, type CustomerType, spawnPoint } from '../entities/customer';
import { Worker, ROLES, DOOR_POSTS, MAX_DOOR_GUARDS, type WorkerRole } from '../entities/staff';
import { Player } from '../entities/player';
import { type Appearance, defaultAppearance } from '../entities/appearance';
import { Floaters } from '../ui/floaters';
import type { MoneyReason, World } from './world';
import { BuildController } from './build';
import { ACTIVE_OBJECTIVES, OBJECTIVES, type LifetimeStats, type ObjectiveView, emptyStats, xpForLevel } from './objectives';
import {
  type CasinoSnapshot, type NetState, type RivalState, type SaveData, emptyNet, newRival,
} from './save';
import { RIVAL_ID, RIVAL_NAME, generateRival, rivalLook, rivalLotInfo, tickRival } from './rival';

export type { SaveData } from './save';

export type ToastKind = 'info' | 'good' | 'bad' | 'money' | 'event';

export type Selection =
  | { kind: 'item'; item: PlacedItem }
  | { kind: 'customer'; c: Customer }
  | { kind: 'worker'; w: Worker }
  | { kind: 'remote'; pid: string };

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
  /** Hotel: room revenue minus housekeeping last night (absent without a hotel). */
  hotel?: number;
  hotelGuests?: number;
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
  cosmetics: void;
  hotel: void;
  hotelDesk: void;
  rebirth: number;
  expansion: number;
  jackpot: { amount: number; machine: string };
  event: { title: string; text: string };
  interact: { label: string; hold: boolean } | null;
  minigame: PlacedItem;
  visit: void;
  floor: number;
  camera: CamMode;
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  musicOn: boolean;
  quality: Quality;
  showFps: boolean;
  camera?: CamMode;
}

const DAY_SECONDS = 300;
const DAY_START = 10 * 60;
const START_MONEY = 3000;
const JACKPOT_SEED = 5000;
/** Win this much in one visit and the rival's security walks you out. */
const RIVAL_WIN_LIMIT = 100000;
const RIVAL_BAN_MS = 5 * 60 * 1000;

interface ActiveEvent {
  id: string;
  title: string;
  left: number;
  spawnMult: number;
}

/** One floor of the casino: its tile grid and carpet. */
class Level {
  readonly grid: Grid;
  readonly floor: FloorRenderer;

  constructor(readonly index: number, layout: Layout) {
    this.grid = new Grid(index, layout);
    this.floor = new FloorRenderer(this.grid);
  }
}

/** Where you are while away from your own casino. */
interface Visit {
  lot: StreetLot;
  home: SaveData;
  /** Game seconds spent away (your casino catches up when you return). */
  away: number;
  net: number;
  hands: number;
}

/** Remote player shown in the world (multiplayer); drawn by the net layer. */
export interface RemoteView {
  pid: string;
  name: string;
  x: number;
  z: number;
}

export class Game implements World, ItemHost {
  readonly events = new Emitter<GameEvents>();
  readonly renderer: Renderer;
  readonly input: Input;
  levels: Level[] = [];
  readonly building: Building;
  readonly street = new Street();
  readonly cam: CameraRig;
  readonly effects = new Effects();
  readonly trash = new TrashManager();
  readonly items: ItemManager;
  readonly floaters: Floaters;
  readonly player: Player;
  readonly build: BuildController;
  customers: Customer[] = [];
  workers: Worker[] = [];
  private floorGroup = new THREE.Group();

  state: 'title' | 'playing' = 'title';
  money = START_MONEY;
  xp = 0;
  level = 1;
  day = 1;
  dayMinutes = 0;
  rating = 2;
  private ratingTarget = 2;
  satAvg = 55;
  layout: Layout = { width: 0, depth: 0 };
  jackpotPot = JACKPOT_SEED;
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
  rival: RivalState = newRival();
  net: NetState = emptyNet();
  createdAt = Date.now();
  visit: Visit | null = null;
  /** Your multiplayer id (set by the net layer; 'me' offline). */
  pid = 'me';
  /** Supplies another player's casino when you walk into it (set by the net layer). */
  playerLot: ((pid: string) => CasinoSnapshot | null) | null = null;
  /** Is this player keeping you out right now? (set by the net layer) */
  bannedBy: ((pid: string) => number) | null = null;
  /** Other players standing in the loaded casino / on the street (set by the net layer). */
  remotes: RemoteView[] = [];
  private dayAcc = { revenue: 0, payouts: 0, sales: 0, visitors: 0, byItem: new Map<string, number>() };
  private spawnT = 3;
  private eventT = 60;
  private activeEvent: ActiveEvent | null = null;
  private buzz = 0;
  private autosaveT = 30;
  private objectiveT = 0;
  private interactTarget: { kind: string; label: string; anchor: () => THREE.Vector3; hold: boolean; act: () => void } | null = null;
  private holdT = 0;
  private lastInteractKey = '';
  private moneyHistoryT = 0;
  readonly moneyHistory: number[] = [];
  private netLog: [number, number][] = [];
  private floaterT = new Map<number, number>();
  settings: Settings;
  actionHeld = false;
  actionPressed = false;
  modalOpen = false;
  /** HUD hidden for screenshots: no prompts, hovers or click selection. */
  photoMode = false;
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
  /** Is the player inside the loaded casino (not out on the street)? */
  inside = true;
  private transitionT = 0;
  private doorCooldown = 0;

  constructor(container: HTMLElement, settings: Settings) {
    this.settings = settings;
    this.renderer = new Renderer(container, settings.quality);
    this.input = new Input(this.renderer.renderer.domElement);
    const scene = this.renderer.scene;
    this.levels = [new Level(0, this.layout)];
    this.building = new Building(this.levels[0].grid, {
      name: 'Lucky Star Casino', signFont: 'bungee', signColor: 0xff3fa4, wallColor: 0x3a1d4d, trimColor: 0x2fe6ff,
    });
    this.items = new ItemManager(() => this.levels.map((l) => l.grid), this, this.effects);
    this.floaters = new Floaters(container);
    this.player = new Player(defaultAppearance(), CENTER_X, FACADE_Z - 3);
    this.cam = new CameraRig(this.renderer.camera);
    this.cam.setMode(settings.camera ?? 'top');
    this.build = new BuildController(this);
    this.floorGroup.add(this.levels[0].floor.group);
    scene.add(this.floorGroup, this.building.group, this.street.group, this.items.group, this.trash.group, this.effects.group, this.player.model.root);
    this.effects.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.refreshStreet();
    this.resetWorld();
  }

  // ------------------------------------------------------------------ floors

  get grid(): Grid {
    return this.levels[0].grid;
  }

  get floors(): number {
    return this.levels.length;
  }

  gridAt(floor: number): Grid {
    return (this.levels[floor] ?? this.levels[0]).grid;
  }

  /** The floor being drawn: the one the player stands on. */
  get viewFloor(): number {
    return this.player.floor;
  }

  /** The floor renderer of the viewed floor (build mode paints and highlights there). */
  get floor(): FloorRenderer {
    return (this.levels[this.viewFloor] ?? this.levels[0]).floor;
  }

  private setFloorCount(n: number): void {
    n = Math.max(1, n);
    while (this.levels.length > n) {
      const l = this.levels.pop()!;
      l.floor.group.removeFromParent();
    }
    while (this.levels.length < n) {
      const l = new Level(this.levels.length, this.layout);
      this.levels.push(l);
      this.floorGroup.add(l.floor.group);
      l.floor.rebuild();
    }
    if (this.player.floor >= n) this.player.floor = 0;
  }

  private applyLayout(): void {
    for (const l of this.levels) l.grid.setLayout(this.layout);
    this.building.rebuild();
    for (const l of this.levels) l.floor.rebuild();
    const r = this.grid.rect;
    this.renderer.fitShadow(r.x0, r.x1 + 1, r.z0, r.z1 + 1);
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
    this.applyLayout();
    this.items.syncElevators();
  }

  newGame(opts: { name: string; look: CasinoLook; player: Appearance; playerName: string }): void {
    this.state = 'playing';
    this.visit = null;
    this.money = START_MONEY;
    this.xp = 0;
    this.level = 1;
    this.day = 1;
    this.dayMinutes = 0;
    this.rating = 2;
    this.ratingTarget = 2;
    this.satAvg = 55;
    this.layout = { width: 0, depth: 0 };
    this.jackpotPot = JACKPOT_SEED;
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
    this.rival = newRival();
    this.createdAt = Date.now();
    this.hotel = null;
    this.rebirths = 0;
    this.cosmetics = emptyCosmetics();
    this.applyCosmetics();
    this.setFloorCount(1);
    this.grid.floor.fill(0);
    this.resetWorld();
    this.building.setLook(opts.look);
    // A couple of plants by the door so day one isn't an empty box.
    for (const [x, z] of [[21, 38], [26, 38]]) {
      const plant = itemDef('plant');
      if (this.items.canPlace(plant, 0, x, z, 0).ok) this.items.add(plant, 0, x, z, 0, 0x2c2433);
    }
    this.player.setAppearance(opts.player);
    this.player.name = opts.playerName || 'Boss';
    this.player.x = CENTER_X;
    this.player.z = FACADE_Z - 3;
    this.player.floor = 0;
    this.player.yaw = Math.PI;
    this.cam.setOrbit(false);
    this.cam.distTarget = 15;
    this.cam.yawTarget = 0;
    this.cam.snap(this.player.x, this.player.z);
    this.spawnT = 2;
    this.eventT = 150;
    this.activeEvent = null;
    this.refreshStreet();
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
    this.events.emit('staff', undefined);
    this.events.emit('visit', undefined);
    this.saveNow();
  }

  /** Decorated showroom for the title screen. */
  loadDemo(): void {
    this.state = 'title';
    this.visit = null;
    this.layout = { width: 2, depth: 2 };
    this.level = 10;
    this.rating = 4.2;
    this.money = 99999;
    this.setFloorCount(1);
    this.player.floor = 0;
    this.grid.floor.fill(0);
    this.resetWorld();
    const r = this.grid.rect;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      if (x >= 21 && x <= 26) this.grid.setFloor(x, z, 5);
      else if (z < r.z0 + 7) this.grid.setFloor(x, z, 3);
    }
    this.levels[0].floor.rebuild();
    const put = (id: string, tx: number, tz: number, rot = 0, color?: number) => {
      const def = itemDef(id);
      if (this.items.canPlace(def, 0, tx, tz, rot).ok) this.items.add(def, 0, tx, tz, rot, color);
    };
    for (let i = 0; i < 5; i++) put(i % 2 ? 'slot_fruit' : 'slot_lucky7', 14 + i, 22, 0, [0xc8102e, 0x1e7a46, 0x1f4fbf, 0x6a2cc2, 0xf2b632][i]);
    for (let i = 0; i < 5; i++) put('slot_diamond', 29 + i, 22, 0);
    put('roulette', 14, 27);
    put('blackjack', 30, 27);
    put('bar', 22, 22, 0);
    put('wheel', 18, 28);
    put('fountain', 23, 31);
    put('palm', 21, 36);
    put('palm', 26, 36);
    put('plant', 13, 36);
    put('plant', 34, 36);
    put('neon', 13, 24, 0, 0xff3fa4);
    put('neon', 34, 24, 0, 0x2fe6ff);
    put('craps', 15, 32);
    put('poker', 29, 32);
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
    this.refreshStreet();
  }

  // ------------------------------------------------------------------ street

  /** Lots the net layer adds (other players); the street is rival + you + these. */
  extraLots: StreetLot[] = [];
  /** Bought and switched-on cosmetics (they follow you, not a casino). */
  cosmetics: CosmeticState = emptyCosmetics();
  /** Your hotel tower next door (null until you buy it). */
  hotel: HotelState | null = null;
  /** How many times you've been reborn: each one adds 25% to everything your businesses earn. */
  rebirths = 0;

  get incomeMult(): number {
    return 1 + this.rebirths * 0.25;
  }

  /** What the next rebirth asks for. */
  get rebirthReq(): { level: number; money: number } {
    return { level: 15 + this.rebirths * 5, money: 1_000_000 * (this.rebirths + 1) };
  }

  /** Why you can't be reborn yet (null = ready). */
  rebirthBlock(): string | null {
    const r = this.rebirthReq;
    if (this.visit) return 'Head home first.';
    if (this.level < r.level) return `Reach level ${r.level} (you're level ${this.level}).`;
    if (this.money < r.money) return `Have ${formatMoney(r.money)} in the bank.`;
    return null;
  }

  /**
   * Start over with a fresh casino, but keep your character, name, casino style and cosmetics,
   * and earn 25% more from everything, forever.
   */
  rebirth(): boolean {
    if (this.rebirthBlock()) return false;
    const n = this.rebirths + 1;
    const cos = { owned: [...this.cosmetics.owned], on: [...this.cosmetics.on] };
    const stats = { ...this.stats };
    this.newGame({ name: this.building.look.name, look: { ...this.building.look }, player: { ...this.player.appearance }, playerName: this.player.name });
    this.rebirths = n;
    this.stats = stats;
    this.cosmetics = cos;
    this.applyCosmetics();
    audio.play('jackpot');
    this.effects.confetti(this.player.x, 2, this.player.z, 160, 1.2);
    this.events.emit('rebirth', n);
    this.saveNow();
    return true;
  }

  // ------------------------------------------------------------------ hotel

  /** Why the hotel can't be bought yet (null = go ahead). */
  hotelBlock(): string | null {
    if (this.hotel) return 'You already own a hotel.';
    if (this.visit) return 'Head home first.';
    if (this.level < HOTEL_LEVEL) return `Unlocks at level ${HOTEL_LEVEL}.`;
    if (this.money < HOTEL_PRICE) return `Costs ${formatMoney(HOTEL_PRICE)}.`;
    return null;
  }

  buyHotel(): boolean {
    const block = this.hotelBlock();
    if (block) {
      audio.play('error');
      this.notify(block, 'bad');
      return false;
    }
    this.spend(HOTEL_PRICE, 'expand');
    this.hotel = newHotel();
    audio.play('levelup');
    this.notify(`${hotelLook(this.building.look).name} is open next door! Guests check in every night.`, 'good');
    this.afterHotelChange();
    return true;
  }

  addHotelFloor(): boolean {
    const h = this.hotel;
    if (!h || h.floors >= HOTEL_MAX_FLOORS) return false;
    const cost = hotelFloorCost(h);
    if (this.money < cost) {
      audio.play('error');
      this.notify(`The next storey costs ${formatMoney(cost)}.`, 'bad');
      return false;
    }
    this.spend(cost, 'expand');
    h.floors++;
    audio.play('purchase');
    this.notify(`Storey ${h.floors} built: ${hotelRooms(h)} rooms now.`, 'good');
    this.afterHotelChange();
    return true;
  }

  upgradeHotel(): boolean {
    const h = this.hotel;
    const next = h ? HOTEL_TIERS[h.tier + 1] : undefined;
    if (!h || !next) return false;
    if (this.level < next.level || this.money < next.cost) {
      audio.play('error');
      this.notify(this.level < next.level ? `${next.name} unlocks at level ${next.level}.` : `${next.name} costs ${formatMoney(next.cost)}.`, 'bad');
      return false;
    }
    this.spend(next.cost, 'upgrade');
    h.tier++;
    audio.play('levelup');
    this.notify(`Your hotel is now a ${'★'.repeat(next.stars)} ${next.name}!`, 'good');
    this.afterHotelChange();
    return true;
  }

  private afterHotelChange(): void {
    this.refreshStreet();
    // If you're standing in the hotel, rebuild it around you.
    if (this.visit?.lot.id === 'hotel' && this.hotel) {
      const f = this.player.floor;
      const x = this.player.x;
      const z = this.player.z;
      this.loadCasino(generateHotel(this.hotel, hotelLook(this.visit.home.look)), true);
      this.player.floor = Math.min(f, this.floors - 1);
      this.player.x = x;
      this.player.z = z;
      this.player.unstick(this.gridAt(this.player.floor));
    }
    this.events.emit('hotel', undefined);
    this.saveNow();
  }
  private playerFx: PlayerFx | null = null;

  /** Buy a cosmetic (it's switched on right away). */
  buyCosmetic(id: string): boolean {
    const c = cosmetic(id);
    if (!c || this.cosmetics.owned.includes(id)) return false;
    if (this.visit) {
      this.notify('Buy cosmetics at home.', 'bad');
      return false;
    }
    if (this.money < c.price) {
      audio.play('error');
      this.notify(`${c.name} costs ${formatMoney(c.price)}.`, 'bad');
      return false;
    }
    this.spend(c.price, 'cosmetic');
    this.cosmetics = { owned: [...this.cosmetics.owned, id], on: [...this.cosmetics.on, id] };
    audio.play('jackpot');
    this.effects.confetti(this.player.x, 1.5, this.player.z);
    this.notify(`${c.icon} ${c.name} is yours!`, 'good');
    this.applyCosmetics();
    this.saveNow();
    return true;
  }

  /** Switch an owned cosmetic on or off. */
  toggleCosmetic(id: string): void {
    if (!this.cosmetics.owned.includes(id)) return;
    const on = this.cosmetics.on.includes(id);
    this.cosmetics = { ...this.cosmetics, on: on ? this.cosmetics.on.filter((x) => x !== id) : [...this.cosmetics.on, id] };
    audio.play('click');
    this.applyCosmetics();
    this.requestSave();
  }

  /** Put the switched-on cosmetics on your character and your casino. */
  applyCosmetics(): void {
    this.playerFx ??= new PlayerFx(this.player.model);
    this.playerFx.set(equipped(this.cosmetics, 'player'));
    this.refreshStreet();
    this.events.emit('cosmetics', undefined);
  }

  refreshStreet(): void {
    const me: StreetLot = {
      id: 'me', kind: 'me', owner: this.player.name, order: this.createdAt, online: true,
      info: { look: this.visit ? this.visit.home.look : { ...this.building.look }, width: this.homeLayout.width, depth: this.homeLayout.depth, floors: this.homeFloors, tagline: this.rebirths ? `REBIRTH ${roman(this.rebirths)} · OPEN 24/7` : 'OPEN 24/7', cos: equipped(this.cosmetics, 'casino') },
    };
    const ri = rivalLotInfo(this.rival);
    const rival: StreetLot = {
      id: RIVAL_ID, kind: 'rival', owner: 'The Viper', order: 0, online: true,
      info: { look: rivalLook(), width: ri.layout.width, depth: ri.layout.depth, floors: ri.floors, tagline: 'HIGH LIMITS · NO MERCY' },
    };
    const lots = [rival, me, ...this.extraLots];
    if (this.hotel) {
      const t = HOTEL_TIERS[this.hotel.tier];
      lots.push({
        id: 'hotel', kind: 'hotel', hotelOf: 'me', owner: this.player.name, order: this.createdAt, online: true, hotel: { floors: this.hotel.floors, tier: this.hotel.tier },
        info: { look: hotelLook(me.info.look), width: HOTEL_LAYOUT.width, depth: HOTEL_LAYOUT.depth, floors: this.hotel.floors, tagline: `${'★'.repeat(t.stars)} ${t.name.toUpperCase()}`, style: 'hotel' },
      });
    }
    this.street.setLots(lots);
    if (!this.street.get(this.street.activeId)) this.street.activeId = 'me';
  }

  get homeLayout(): Layout {
    return this.visit ? this.visit.home.layout : this.layout;
  }

  get homeFloors(): number {
    return this.visit ? this.visit.home.floors : this.floors;
  }

  get visiting(): boolean {
    return this.visit !== null;
  }

  /** Name of the casino whose interior is loaded. */
  get hereName(): string {
    return this.visit ? this.visit.lot.info.look.name : this.building.look.name;
  }

  private lotSnapshot(lot: StreetLot): CasinoSnapshot | null {
    if (lot.kind === 'rival') return generateRival(this.rival);
    if (lot.kind === 'player') return this.playerLot?.(lot.id) ?? null;
    if (lot.kind === 'hotel' && lot.hotel) return generateHotel(lot.hotel, lot.info.look);
    return null;
  }

  /** Can the player go into this casino right now? Returns a reason when not. */
  entryBlock(lot: StreetLot): string | null {
    if (lot.kind === 'rival' && this.rival.banUntil > Date.now()) {
      return `${RIVAL_NAME}'s security won't let you back in for ${Math.ceil((this.rival.banUntil - Date.now()) / 60000)} min.`;
    }
    if (lot.kind === 'player') {
      const until = this.bannedBy?.(lot.id) ?? 0;
      if (until > Date.now()) return `${lot.owner} blacklisted you. Try again in ${Math.ceil((until - Date.now()) / 60000)} min.`;
      if (!this.playerLot?.(lot.id)) return `${lot.info.look.name} is closed right now.`;
    }
    return null;
  }

  /** Walk through another casino's door (or back through your own). */
  enterLot(lot: StreetLot): boolean {
    if (this.state !== 'playing' || lot.id === this.street.activeId) return false;
    if (lot.kind === 'me') {
      this.returnHome();
      return true;
    }
    const at = this.street.map(this.street.activeId, lot.id, this.player.x, this.player.z);
    const block = this.entryBlock(lot);
    if (block) {
      audio.play('error');
      this.notify(block, 'bad');
      return false;
    }
    const snap = this.lotSnapshot(lot);
    if (!snap) return false;
    const home = this.visit ? this.visit.home : this.serialize();
    const away = this.visit ? this.visit.away : 0;
    this.visit = { lot, home, away, net: 0, hands: 0 };
    this.build.cancel(false);
    this.select(null);
    this.loadCasino(snap, true);
    this.street.activeId = lot.id;
    this.shiftPlayer(at.x, FACADE_Z - 1.5);
    audio.play('doorbell');
    this.events.emit('toast', {
      text: lot.id === 'hotel' ? `Welcome to your hotel! Walk up to the front desk and press Space to run it.` : lot.kind === 'hotel' ? `Welcome to ${snap.name}!` : `Welcome to ${snap.name}! Walk up to any game and press Space to play.`,
      kind: 'event',
    });
    this.events.emit('visit', undefined);
    this.refreshStreet();
    return true;
  }

  /** Back to your own casino; it catches up on the time you were out. */
  returnHome(kicked = false): void {
    const v = this.visit;
    if (!v) return;
    this.standUp();
    const from = this.street.activeId;
    // Where you are (or the door you're thrown out of), seen from your own casino.
    const at = kicked ? this.street.map(from, 'me', CENTER_X, FACADE_Z + 2.4) : this.street.map(from, 'me', this.player.x, this.player.z);
    const turn = this.street.placeOf(from).side === this.street.placeOf('me').side ? 0 : Math.PI;
    const money = this.money;
    this.visit = null;
    this.street.activeId = 'me';
    this.loadCasino(v.home, false);
    this.restoreHomeProfile(v.home);
    this.money = money;
    if (kicked) {
      // Escorted out onto the sidewalk in front of the casino that threw you out.
      this.player.x = at.x;
      this.player.z = at.z;
      this.player.yaw = turn;
      this.player.floor = 0;
      this.cam.snap(this.player.x, this.player.z);
      this.doorCooldown = 2;
    } else this.shiftPlayer(at.x, FACADE_Z - 1.5);
    const earned = this.catchUp(v.away);
    if (Math.abs(earned) >= 1) {
      this.events.emit('toast', { text: `While you were out your casino made ${earned >= 0 ? '+' : ''}${formatMoney(earned)}.`, kind: earned >= 0 ? 'money' : 'bad' });
    }
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('visit', undefined);
    this.events.emit('staff', undefined);
    this.refreshStreet();
    this.saveNow();
  }

  private shiftPlayer(localX: number, z: number): void {
    // Line up with the doorway of the casino you're stepping into (or out of).
    this.player.x = CENTER_X + clamp(localX - CENTER_X, -0.8, 0.8);
    this.player.z = z;
    this.player.floor = 0;
    this.player.yaw = Math.PI;
    this.cam.snap(this.player.x, this.player.z);
    this.doorCooldown = 1;
    this.transitionT = 0.35;
  }

  /** Put a casino's floor plan into the world (yours or one you're visiting). */
  private loadCasino(s: CasinoSnapshot, visiting: boolean): void {
    this.layout = { ...s.layout };
    this.setFloorCount(s.floors || 1);
    for (const l of this.levels) l.grid.setLayout(this.layout);
    for (const l of this.levels) l.grid.floor.fill(0);
    this.resetWorld();
    s.paint?.forEach((p, f) => this.levels[f]?.grid.decodeFloor(p));
    for (const l of this.levels) l.floor.rebuild();
    this.building.setLook(s.look);
    this.items.load(s.items);
    for (const st of s.staff ?? []) this.addWorker(st.role, st.look, st.name, true);
    this.rating = s.rating || 2;
    this.ratingTarget = this.rating;
    this.jackpotPot = s.jackpotPot || JACKPOT_SEED;
    this.spawnT = 0.5;
    this.activeEvent = null;
    if (visiting) {
      // A lively floor to walk into.
      const cap = Math.min(this.maxCustomers(), Math.round(4 + this.items.gamblingSeats() * 0.55));
      for (let i = 0; i < cap; i++) {
        const g = this.gridAt(0);
        const spot = g.randomInsideWalkable();
        if (spot) this.spawnCustomer(Math.random() < 0.08 ? 'vip' : 'regular', spot[0] + 0.5, spot[1] + 0.5);
      }
    }
    this.items.setViewFloor(this.player.floor);
    this.trash.setViewFloor(this.player.floor);
  }

  private restoreHomeProfile(s: SaveData): void {
    this.day = s.day;
    this.dayMinutes = s.dayMinutes;
    this.satAvg = s.satAvg;
    this.jackpotPot = s.jackpotPot || JACKPOT_SEED;
    for (const [x, z, f] of s.trash ?? []) this.trash.add(x, z, f ?? 0);
  }

  /**
   * Fast-forward your casino after a visit: a short real simulation, then the rest estimated
   * from how the casino was doing, with wages paid at each day that went by.
   */
  private catchUp(seconds: number): number {
    const before = this.money;
    const rate = this.incomePerMin / 60;
    const real = Math.min(seconds, 60);
    const dt = 0.25;
    for (let t = 0; t < real; t += dt) this.simulateWorld(dt);
    let rest = seconds - real;
    while (rest > 0) {
      const step = Math.min(rest, 30);
      rest -= step;
      this.money += rate * step;
      this.dayMinutes += step * (1440 / DAY_SECONDS);
      if (this.dayMinutes >= 1440) {
        this.dayMinutes -= 1440;
        this.endOfDay();
      }
    }
    return Math.round(this.money - before);
  }

  // ------------------------------------------------------------------ World / ItemHost

  get playerPosition(): THREE.Vector3 {
    return this.playerPos;
  }

  addMoney(amount: number, reason: MoneyReason, pos?: THREE.Vector3): void {
    if (!amount) return;
    // Rebirth bonus: everything your businesses earn is worth more.
    if (amount > 0 && this.rebirths > 0 && (reason === 'collect' || reason === 'tip')) amount = Math.round(amount * this.incomeMult);
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

  onStaffBust(): void {
    this.stats.cheatersCaught++;
  }

  onStaffClean(): void {
    this.stats.trashCleaned++;
  }

  /** Sounds from floors you can't see (or from inside while you're out) are hushed. */
  private fxFloor = 0;
  sfxAt(name: SfxName, x: number, z: number, volume = 1): void {
    const hidden = this.fxFloor !== this.viewFloor || (!this.inside && z < FACADE_Z);
    const v = hidden ? volume * 0.25 : volume;
    if (this.state !== 'playing' && name !== 'jackpot') {
      audio.playAt(name, x, z, v * 0.5);
      return;
    }
    audio.playAt(name, x, z, v);
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

  stageBoostAt(x: number, z: number, floor = 0): number {
    let b = 0;
    for (const it of this.items.items) {
      if (it.def.kind !== 'stage' || it.floor !== floor) continue;
      const d = Math.hypot(it.cx - x, it.cz - z);
      if (d < it.def.appealRadius) b += 1.1 * (1 - d / it.def.appealRadius);
    }
    return b;
  }

  witness(x: number, z: number, radius: number, mood: number, except?: Customer, floor = 0): void {
    for (const c of this.customers) {
      if (c === except || !c.inside || c.floor !== floor) continue;
      if (Math.hypot(c.x - x, c.z - z) <= radius) c.witnessed(mood);
    }
  }

  onCustomerExited(c: Customer): void {
    if (this.state !== 'playing' || this.visit) return;
    this.satAvg = this.satAvg * 0.93 + c.mood * 0.07;
  }

  onCustomerGone(c: Customer): void {
    c.dispose();
  }

  /** Every round settles straight away: a guest's loss lands in your bank, their win comes out of it. */
  roundDone(item: PlacedItem, o: Outcome, user: SeatUser): void {
    const home = this.state === 'playing' && !this.visit;
    // Visuals only where the camera can see them; sounds from elsewhere are hushed.
    const playing = this.state === 'playing' && item.floor === this.viewFloor && this.inside;
    this.fxFloor = item.floor;
    const k = item.def.kind;
    const pos = new THREE.Vector3(item.cx, item.model.height + 0.2, item.cz);
    const customer = this.customers.find((c) => c.uid === user.uid);
    const at = customer ? customer.headPos.clone() : pos;
    const showMoney = (amount: number) => {
      // One popup per machine every so often keeps a busy floor readable.
      const last = this.floaterT.get(item.uid) ?? -9;
      if (Math.abs(amount) < 1 || (this.time - last < 1.6 && Math.abs(amount) < 200)) return;
      this.floaterT.set(item.uid, this.time);
      this.floaters.money(pos, amount, Math.abs(amount) >= 500);
    };
    if (k === 'bar' || k === 'snack' || k === 'atm') {
      if (k === 'bar' || k === 'snack') {
        if (home) this.stats.drinksServed++;
        this.sfxAt('drink', item.cx, item.cz, 0.7);
      } else this.sfxAt('coin', item.cx, item.cz, 0.7);
      if (!home) return;
      this.dayAcc.sales += o.bet;
      this.logNet(o.bet);
      this.addMoney(o.bet, 'collect');
      if (playing) showMoney(o.bet);
      this.gainXp(1);
      return;
    }
    if (k === 'bench') return;
    const net = o.bet - o.payout;
    if (home) {
      this.stats.rounds++;
      this.logNet(net);
      this.dayAcc.revenue += o.bet;
      this.dayAcc.payouts += o.payout;
      this.dayAcc.byItem.set(item.def.name, (this.dayAcc.byItem.get(item.def.name) ?? 0) + net);
      if (item.def.jackpot) this.jackpotPot += o.bet * 0.04;
      this.addMoney(net, net >= 0 ? 'collect' : 'payout');
      if (playing) showMoney(net);
      this.gainXp(1 + Math.min(20, o.bet / 40));
    }
    if (k === 'claw' && o.tier === 'win') {
      if (playing) this.effects.sparkle(at.x, at.y, at.z, 10, 0xff9fcf);
      return;
    }
    if (o.tier === 'win') {
      this.sfxAt('win', item.cx, item.cz, 0.55);
      if (playing) this.effects.sparkle(pos.x, pos.y, pos.z, 6);
    } else if (o.tier === 'big') {
      if (home) {
        this.stats.bigWins++;
        this.stats.biggestWin = Math.max(this.stats.biggestWin, o.payout);
      }
      if (playing) {
        this.floaters.text(at.clone().setY(at.y + 0.4), o.label, 'big');
        this.sfxAt('bigwin', item.cx, item.cz, 0.9);
        this.effects.confetti(pos.x, pos.y, pos.z, 50, 0.8);
        this.cam.shake(0.05);
      }
    } else if (o.tier === 'jackpot') {
      if (home) {
        this.stats.jackpots++;
        this.stats.bigWins++;
        this.stats.biggestWin = Math.max(this.stats.biggestWin, o.payout);
        this.buzz = Math.min(1, this.buzz + 0.5);
      }
      if (item.def.jackpot && o.label.startsWith('MEGA')) this.jackpotPot = JACKPOT_SEED;
      if (playing) {
        this.floaters.text(at.clone().setY(at.y + 0.6), 'JACKPOT!', 'jackpot', 3, 1.4);
        audio.play('jackpot');
        this.effects.confetti(pos.x, pos.y + 0.5, pos.z, 160, 1.2);
        this.effects.sparkle(pos.x, pos.y, pos.z, 30, 0xffd24a, 1.5);
        this.cam.shake(0.18);
      }
      if (home) {
        this.events.emit('jackpot', { amount: o.payout, machine: item.def.name });
        this.activeEvent = { id: 'buzz', title: 'Jackpot buzz!', left: 45, spawnMult: 1.8 };
      }
    } else if (o.tier === 'lose' && this.state === 'playing' && item.def.shared && Math.random() < 0.3) {
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
      k === 'slot' || k === 'pachinko' || k === 'videopoker' || k === 'keno' ? 'spin' : k === 'claw' ? 'claw' : k === 'roulette' || k === 'wheel' ? 'tick'
        : k === 'craps' || k === 'sicbo' ? 'dice' : k === 'blackjack' || k === 'poker' || k === 'baccarat' || k === 'threecard' ? 'cards' : null;
    if (name) this.sfxAt(name, item.cx, item.cz, 0.45);
  }

  machineBroke(item: PlacedItem): void {
    this.sfxAt('break', item.cx, item.cz);
    this.effects.smoke(item.cx, item.model.height, item.cz, 6);
    if (this.visit) return;
    const tech = this.staffCount('technician') > 0;
    const where = this.floors > 1 ? ` on ${floorName(item.floor)}` : '';
    this.notify(tech ? `${item.def.name}${where} broke down. A technician is on the way.` : `${item.def.name}${where} broke down! Stand next to it and hold Space to fix it.`, 'bad');
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

  resetJackpot(): void {
    this.jackpotPot = JACKPOT_SEED;
  }

  /** Width steps + depth steps bought (for goals). */
  get expansion(): number {
    return this.homeLayout.width + this.homeLayout.depth;
  }

  objectiveView(): ObjectiveView {
    return {
      money: this.money,
      level: this.level,
      rating: this.rating,
      expansion: this.expansion,
      floors: this.floors,
      widthStep: this.layout.width,
      countItem: (id) => this.items.count(id),
      countCategory: (cat) => this.items.countKind((i) => i.def.category === cat && !i.def.fixed),
      countKind: (kind) => this.items.countKind((i) => i.def.kind === kind),
      staffTotal: this.workers.length,
      doorGuards: this.staffCount('doorman'),
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

  /**
   * Pays the XP held back on items whose refund window is over. `closeAll` ends every
   * window first: finishing a goal does that, so goals can't be farmed with refunds.
   */
  private settleRefunds(closeAll = false): void {
    for (const it of this.items.items) {
      if (closeAll) it.placedAt = -999;
      if (it.pendingXp && !it.refundable) {
        this.gainXp(it.pendingXp);
        it.pendingXp = 0;
      }
    }
  }

  private checkObjectives(): void {
    const v = this.objectiveView();
    let changed = false;
    for (const o of this.activeObjectives()) {
      if (o.progress(v) >= o.target) {
        this.doneObjectives.add(o.id);
        this.settleRefunds(true);
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
    const area = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1) * this.floors;
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
    // A better reputation draws a wealthier crowd.
    const wealth = 0.9 + Math.max(0, this.rating - 1) * 0.4 + Math.min(0.8, this.level * 0.04);
    const c = new Customer(type, sx, sz, undefined, wealth);
    this.customers.push(c);
    this.renderer.scene.add(c.model.root);
    if (this.state === 'playing' && !this.visit) {
      this.stats.visitors++;
      this.dayAcc.visitors++;
      if (type === 'vip') {
        this.notify(`A VIP high roller just arrived! Greet ${c.name.split(' ')[0]} for a tip.`, 'event');
        audio.play('doorbell');
      }
      if (type === 'cheater') {
        // Door guards spot most cheaters before they get in.
        const guards = this.workers.filter((w) => w.role === 'doorman').length;
        c.turnAway = guards > 0 && Math.random() < 1 - Math.pow(0.28, guards);
      }
    }
    return c;
  }

  private maxCustomers(): number {
    const q = this.settings.quality;
    return q === 'high' ? 90 : q === 'medium' ? 60 : 38;
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
      const boost = this.visit ? { spawn: 1, vip: 0 } : hotelGuestBoost(this.hotel);
      const vipChance = (this.rating >= 2.5 ? 0.025 + (this.rating - 2.5) * 0.035 : 0) + boost.vip;
      const cheatChance = this.level >= 4 && !this.visit ? 0.012 : 0;
      const r = Math.random();
      if (r < vipChance) type = 'vip';
      else if (r < vipChance + cheatChance) type = 'cheater';
      else if (r < vipChance + cheatChance + 0.1) type = 'tourist';
      this.spawnCustomer(type);
    }
    const hotelMult = this.visit ? 1 : hotelGuestBoost(this.hotel).spawn;
    const perMin = (3.5 + this.rating * 2.4 + Math.min(this.items.totalAppeal, 80) * 0.1 + seats * 0.2) * this.hourMult() * mult * hotelMult;
    this.spawnT = (60 / perMin) * rand(0.6, 1.4);
  }

  /** Door guards stop flagged cheaters at the red carpet. */
  private updateDoor(): void {
    for (const c of this.customers) {
      if (!c.turnAway || c.state === 'leave' || c.inside) continue;
      const [dx, dz] = DOOR_TILES[0];
      if (Math.hypot(c.x - (dx + 1), c.z - dz) > 2.4) continue;
      c.turnAway = false;
      c.leave('The door guard wouldn’t let me in…');
      const guard = this.workers.filter((w) => w.role === 'doorman').sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
      guard?.turnAway();
      this.stats.turnedAway++;
      if (this.inside || this.player.z > FACADE_Z) {
        this.floaters.text(c.headPos.clone().setY(c.headPos.y + 0.5), 'Not tonight!', 'bad', 1.8);
      }
      if (this.stats.turnedAway <= 3 || this.stats.turnedAway % 10 === 0) this.notify(`Your door guard turned a cheater away (${this.stats.turnedAway} so far).`, 'good');
      this.gainXp(20);
    }
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
    if (this.visit) return null;
    if (this.money < def.price) {
      audio.play('error');
      this.notify(`Not enough cash for ${def.name}`, 'bad');
      return null;
    }
    const floor = this.viewFloor;
    const check = this.items.canPlace(def, floor, tx, tz, rot);
    if (!check.ok) {
      audio.play('error');
      this.notify(check.reason ?? 'Can’t place that here', 'bad');
      return null;
    }
    this.spend(def.price, 'purchase');
    const hadSeats = this.items.gamblingSeats() > 0;
    const item = this.items.add(def, floor, tx, tz, rot, color);
    item.placedAt = this.time;
    if (!hadSeats && item.isGambling) this.spawnT = Math.min(this.spawnT, 0.8);
    item.playDropIn();
    this.afterLayoutChange();
    audio.play('place');
    this.effects.dust(item.cx, item.cz, Math.max(def.size[0], def.size[1]) * 0.7);
    this.effects.sparkle(item.cx, 1, item.cz, 10);
    this.floaters.money(new THREE.Vector3(item.cx, 1.5, item.cz), -def.price);
    item.pendingXp = Math.round(def.price / 60);
    this.requestSave();
    return item;
  }

  afterLayoutChange(): void {
    this.player.unstick(this.gridAt(this.player.floor));
    for (const c of this.customers) {
      if (c.state === 'seated') continue;
      const g = this.gridAt(c.floor);
      const tx = Math.floor(c.x);
      const tz = Math.floor(c.z);
      if (!g.isWalkable(tx, tz)) {
        const n = g.nearestWalkable(tx, tz);
        if (n) {
          c.x = n[0] + 0.5;
          c.z = n[1] + 0.5;
        }
      }
    }
    this.renderer.markShadowsDirty(30);
  }

  upgrade(item: PlacedItem): boolean {
    if (!item.upgradable || item.level >= 5 || this.visit) return false;
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
    if (item.refundable) item.pendingXp += Math.round(cost / 50);
    else this.gainXp(Math.round(cost / 50));
    this.requestSave();
    return true;
  }

  sell(item: PlacedItem): void {
    if (item.def.fixed || this.visit) return;
    const refund = item.refundable;
    if (!refund && item.pendingXp) this.gainXp(item.pendingXp);
    const value = item.sellValueFor(refund);
    if (refund) this.notify(`Purchase undone: ${item.def.name} fully refunded`, 'money');
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

  private addWorker(role: WorkerRole, look?: Appearance, name?: string, atPost = false): Worker {
    const [dx, dz] = DOOR_TILES[0];
    const w = new Worker(role, dx + 0.5, dz - 1.5, look, name);
    if (role === 'doorman') {
      const used = new Set(this.workers.filter((o) => o.role === 'doorman').map((o) => o.post));
      w.post = used.has(0) ? 1 : 0;
      if (atPost) {
        const p = DOOR_POSTS[w.post];
        w.x = p[0];
        w.z = p[1];
      }
    }
    this.workers.push(w);
    this.renderer.scene.add(w.model.root);
    return w;
  }

  hire(role: WorkerRole): boolean {
    if (this.visit) return false;
    const info = ROLES.find((r) => r.role === role)!;
    if (this.level < info.unlock) {
      this.notify(`${info.title}s unlock at level ${info.unlock}`, 'bad');
      return false;
    }
    if (role === 'doorman' && this.staffCount('doorman') >= MAX_DOOR_GUARDS) {
      this.notify(`The entrance only has room for ${MAX_DOOR_GUARDS} door guards.`, 'bad');
      return false;
    }
    const cost = info.wage;
    if (this.money < cost) {
      audio.play('error');
      this.notify(`Hiring costs a signing bonus of ${formatMoney(cost)}`, 'bad');
      return false;
    }
    this.spend(cost, 'wages');
    const w = this.addWorker(role);
    audio.play('purchase');
    this.notify(role === 'doorman' ? `${w.name} is taking up a post at the front door!` : `${w.name} joined as your ${info.title.toLowerCase()}!`, 'good');
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

  // ------------------------------------------------------------------ growing the building

  get nextWidth(): { w: number; cost: number; level: number } | null {
    return WIDTHS[this.layout.width + 1] ?? null;
  }

  get nextDepthCost(): number {
    return depthCost(this.layout.depth);
  }

  get nextDepthLevel(): number {
    return depthLevel(this.layout.depth);
  }

  get nextFloorCost(): number {
    return floorCost(this.floors);
  }

  get nextFloorLevel(): number {
    return floorLevel(this.floors);
  }

  private afterExpand(prev: { x0: number; x1: number; z0: number; z1: number }, label: string, cost: number): void {
    // New floor space inherits each floor's most used carpet.
    for (const l of this.levels) {
      const counts = new Map<number, number>();
      for (let z = prev.z0; z <= prev.z1; z++) for (let x = prev.x0; x <= prev.x1; x++) {
        const s = l.grid.getFloor(x, z);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const r = l.grid.rect;
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
        const inside = x >= prev.x0 && x <= prev.x1 && z >= prev.z0 && z <= prev.z1;
        if (!inside) l.grid.setFloor(x, z, main);
      }
    }
    this.building.rebuild();
    for (const l of this.levels) l.floor.rebuild();
    const r = this.grid.rect;
    this.renderer.fitShadow(r.x0, r.x1 + 1, r.z0, r.z1 + 1);
    this.items.recompute();
    audio.play('levelup');
    for (let i = 0; i < 8; i++) this.effects.dust(rand(r.x0, r.x1), rand(r.z0, r.z1), 1.5);
    this.effects.confetti(this.player.x, 2.5, this.player.z, 120, 1.1);
    this.notify(label, 'good');
    this.events.emit('expansion', this.expansion);
    this.gainXp(Math.round(cost / 40));
    this.refreshStreet();
    this.requestSave();
  }

  private payFor(cost: number, level: number, what: string): boolean {
    if (this.visit) return false;
    if (this.level < level) {
      this.notify(`Reach level ${level} to ${what}`, 'bad');
      return false;
    }
    if (this.money < cost) {
      audio.play('error');
      this.notify(`That costs ${formatMoney(cost)}`, 'bad');
      return false;
    }
    this.spend(cost, 'expand');
    return true;
  }

  /** Widen the building (up to the street's width limit). */
  expandWidth(): boolean {
    const next = this.nextWidth;
    if (!next) {
      this.notify(`Every lot on the street is capped at ${MAX_WIDTH} tiles wide. Build deeper or add a floor!`, 'bad');
      return false;
    }
    if (!this.payFor(next.cost, next.level, 'widen the casino')) return false;
    const prev = { ...this.grid.rect };
    this.layout = { ...this.layout, width: this.layout.width + 1 };
    for (const l of this.levels) l.grid.setLayout(this.layout);
    this.afterExpand(prev, `Casino widened to ${next.w} tiles!`, next.cost);
    return true;
  }

  /** Push the back wall out; depth has no limit. */
  expandDepth(): boolean {
    const cost = this.nextDepthCost;
    if (!this.payFor(cost, this.nextDepthLevel, 'build deeper')) return false;
    const prev = { ...this.grid.rect };
    this.layout = { ...this.layout, depth: this.layout.depth + 1 };
    for (const l of this.levels) l.grid.setLayout(this.layout);
    const r = this.grid.rect;
    this.afterExpand(prev, `Casino extended to ${r.z1 - r.z0 + 1} tiles deep!`, cost);
    return true;
  }

  /** Build another storey on top; floors have no limit. The elevator links them all. */
  addFloor(): boolean {
    if (this.visit) return false;
    const blockers = this.floors === 1 ? this.items.elevatorBlockers(0) : [];
    if (blockers.length) {
      const b = blockers[0];
      const lp = this.gridAt(0).portal;
      this.items.selection.show(lp[0] - 2, lp[1] - 1, lp[0] + 1, lp[1] + 2, 0xff4d5e);
      this.notify(`Move the ${b.def.name} first: the elevator goes next to the entrance (marked in red).`, 'bad');
      audio.play('error');
      return false;
    }
    const cost = this.nextFloorCost;
    if (!this.payFor(cost, this.nextFloorLevel, 'add a floor')) return false;
    const prev = { ...this.grid.rect };
    this.setFloorCount(this.floors + 1);
    this.items.syncElevators();
    const top = this.levels[this.floors - 1];
    const base = this.levels[0].grid;
    const r = base.rect;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) top.grid.setFloor(x, z, base.getFloor(x, z));
    this.items.setViewFloor(this.viewFloor);
    this.afterExpand(prev, `${floorName(this.floors - 1)} is open! Take the elevator up.`, cost);
    return true;
  }

  /** Repaint every tile of the floor you're on; returns tiles changed (0 if unaffordable). */
  paintAll(style: number): number {
    if (this.visit) return 0;
    const price = FLOOR_STYLES[style]?.price ?? 0;
    const g = this.gridAt(this.viewFloor);
    const r = g.rect;
    let n = 0;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (g.getFloor(x, z) !== style) n++;
    if (!n) return 0;
    if (this.money < n * price) {
      audio.play('error');
      this.notify(`Painting ${n} tiles costs ${formatMoney(n * price)}`, 'bad');
      return 0;
    }
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) g.setFloor(x, z, style);
    this.spend(n * price, 'paint');
    this.floorPainted += n;
    this.floor.rebuild();
    audio.play('purchase');
    this.effects.confetti(this.player.x, 1.5, this.player.z, 40, 0.8);
    this.requestSave();
    return n;
  }

  setItemLabel(item: PlacedItem, label: string): void {
    const clean = label.trim().slice(0, 14).toUpperCase();
    item.label = clean || null;
    item.rebuildModel();
    this.renderer.markShadowsDirty(3);
    audio.play('paint');
    this.lookEdited = true;
    this.requestSave();
  }

  setLook(look: Partial<CasinoLook>): void {
    if (this.visit) return;
    if (look.name !== undefined && look.name !== this.building.look.name) this.renamed = true;
    this.building.setLook(look);
    this.lookEdited = true;
    this.refreshStreet();
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

  setCameraMode(mode: CamMode): void {
    this.cam.setMode(mode);
    this.settings.camera = mode;
    this.events.emit('camera', mode);
  }

  // ------------------------------------------------------------------ floors for the player

  /** Ride the elevator to a floor (instantly, with a little flourish). */
  goToFloor(f: number): void {
    if (f < 0 || f >= this.floors || f === this.player.floor) return;
    // Carrying something to another floor keeps the move going.
    if (this.build.active && !this.build.movingItem) this.build.cancel();
    if (!this.build.movingItem) this.select(null);
    const pt = this.gridAt(f).portal;
    this.player.floor = f;
    this.player.x = pt[0] + 0.5;
    this.player.z = pt[1] + 0.5;
    this.player.yaw = Math.PI / 2;
    this.player.unstick(this.gridAt(f));
    this.cam.snap(this.player.x, this.player.z);
    this.transitionT = 0.3;
    audio.play('doorbell', { volume: 0.5, pitch: 1.3 });
    this.events.emit('floor', f);
  }

  /** Relocate the elevator shaft (all floors at once). */
  moveLift(tx: number, tz: number): void {
    this.items.moveLift(tx, tz);
    this.layout.lift = [tx, tz];
    for (const l of this.levels) l.grid.setLift([tx, tz]);
    this.afterLayoutChange();
    this.notify('Elevator moved on every floor.', 'good');
  }

  /**
   * Minimap teleport to a point of the street (global frame). Only the sidewalks and the
   * road are allowed; you can never land inside a casino.
   */
  teleportTo(gx: number, gz: number): boolean {
    if (this.state !== 'playing' || this.photoMode) return false;
    const w = this.street.globalToWorld(gx, gz);
    const tx = Math.floor(w.x);
    const tz = Math.floor(w.z);
    if (!this.street.isStreetWalkable(tx, tz) || this.street.doorAt(tx, tz) || tz <= FACADE_Z) return false;
    const g = this.gridAt(0);
    if (g.inBounds(tx, tz) && g.occupant(tx, tz)) return false;
    this.standUp();
    if (this.build.active) this.build.cancel();
    this.select(null);
    const wasUp = this.player.floor;
    this.player.floor = 0;
    this.player.x = w.x;
    this.player.z = w.z;
    this.player.halt();
    this.cam.snap(w.x, w.z);
    this.doorCooldown = 1;
    this.transitionT = 0.3;
    audio.play('whoosh');
    if (wasUp) this.events.emit('floor', 0);
    return true;
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

  private pickCharacter(px: number, py: number): Customer | Worker | RemoteView | null {
    const { w, h } = this.renderer.size;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.renderer.camera);
    let best: Customer | Worker | RemoteView | null = null;
    let bestT = Infinity;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const onRay = new THREE.Vector3();
    const onSeg = new THREE.Vector3();
    const test = (c: Customer | Worker | RemoteView, x: number, z: number) => {
      a.set(x, 0.15, z);
      b.set(x, 1.25, z);
      const d2 = ray.ray.distanceSqToSegment(a, b, onRay, onSeg);
      if (d2 < 0.36 * 0.36) {
        const t = onRay.distanceTo(ray.ray.origin);
        if (t < bestT) {
          bestT = t;
          best = c;
        }
      }
    };
    for (const c of [...this.customers, ...this.workers]) {
      if ((c as Customer).gone || !c.model.root.visible) continue;
      test(c, c.x, c.z);
    }
    for (const r of this.remotes) test(r, r.x, r.z);
    return best;
  }

  private handleClicks(): void {
    if (this.build.active || this.photoMode) return;
    for (const c of this.input.clicks) {
      const ch = this.pickCharacter(c.x, c.y);
      if (ch) {
        audio.play('click');
        if (ch instanceof Customer) this.select({ kind: 'customer', c: ch });
        else if (ch instanceof Worker) this.select({ kind: 'worker', w: ch });
        else this.select({ kind: 'remote', pid: (ch as RemoteView).pid });
        continue;
      }
      if (!this.inside && !this.onHomeFront) {
        if (this.selection) this.select(null);
        continue;
      }
      const { w, h } = this.renderer.size;
      const item = this.items.pick(new THREE.Vector2((c.x / w) * 2 - 1, -(c.y / h) * 2 + 1), this.renderer.camera);
      if (item && !this.visit) {
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
    if (this.state !== 'playing' || this.build.active || this.photoMode || input.isTouch || !input.pointer.over || (!this.inside && !this.onHomeFront)) {
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
    const item = ch || this.visit ? undefined : this.items.pick(new THREE.Vector2((input.pointer.x / w) * 2 - 1, -(input.pointer.y / h) * 2 + 1), this.renderer.camera);
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

  /** Walkability for the manager: the floor they're on, plus the whole sidewalk outside. */
  private playerWalk = (tx: number, tz: number): boolean => {
    const g = this.gridAt(this.player.floor);
    if (this.player.floor > 0 || tz < FACADE_Z) return g.isWalkable(tx, tz);
    if (tz === FACADE_Z) return g.isDoor(tx, tz) || this.street.doorAt(tx, tz) !== null;
    // Decorations in the yard out front are solid.
    if (g.inBounds(tx, tz) && g.occupant(tx, tz)) return false;
    return this.street.isStreetWalkable(tx, tz);
  };

  /** Standing on the sidewalk in front of your own casino (you can decorate the yard from here). */
  get onHomeFront(): boolean {
    return !this.visit && this.player.floor === 0 && Math.abs(this.player.x - CENTER_X) < 16;
  }

  /** Can the build tools be used from where you're standing? */
  get canBuildHere(): boolean {
    return !this.visit && (this.inside || this.onHomeFront);
  }

  private updateInteraction(dt: number): void {
    const p = this.player;
    const pf = p.floor;
    // Pick up litter by walking over it (not in someone else's casino)
    if (!this.visit) {
      for (const t of this.trash.near(p.x, p.z, 0.65, pf)) {
        this.trash.remove(t);
        this.stats.trashCleaned++;
        this.effects.sparkle(t.x, 0.3, t.z, 6, 0xbfe9ff, 0.4);
        audio.play('pop', { volume: 0.5, pitch: 1.4 });
        this.gainXp(2);
      }
    }

    // Context action
    let target: typeof this.interactTarget = null;
    let bestD = Infinity;
    if (!this.visit) {
      for (const it of this.items.items) {
        if (!it.broken || it.floor !== pf) continue;
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
        if (c.exited || c.gone || c.floor !== pf || c.inElevator) continue;
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
    }
    // Somebody else's casino: every game is yours to play (never at your own).
    if (!target && this.visit) {
      let bestPlay = 1.35;
      for (const it of this.items.items) {
        if (!it.isGambling || it.broken || it.floor !== pf) continue;
        const b = it.bounds;
        const d = distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1);
        if (d >= bestPlay) continue;
        bestPlay = d;
        target = {
          kind: `play${it.uid}`, label: `Play ${it.def.name} · ${formatMoney(it.minBet)}–${formatMoney(it.maxBet)}`, hold: false,
          anchor: () => new THREE.Vector3(it.cx, it.model.height + 0.7, it.cz),
          act: () => this.events.emit('minigame', it),
        };
      }
    }
    // Your hotel's front desk
    if (!target && this.visit?.lot.kind === 'hotel') {
      const desk = this.items.items.find((i) => i.def.id === 'frontdesk' && i.floor === pf);
      if (desk) {
        const b = desk.bounds;
        if (distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1) < 1.4) {
          const mine = this.visit.lot.id === 'hotel';
          target = {
            kind: `desk${desk.uid}`, label: mine ? 'Run your hotel' : 'Ask about rooms', hold: false,
            anchor: () => new THREE.Vector3(desk.cx, 2.7, desk.cz),
            act: () => {
              if (mine) this.events.emit('hotelDesk', undefined);
              else this.notify(`${this.visit?.lot.info.look.name}: “Sorry, we're fully booked tonight!”`, 'info');
            },
          };
        }
      }
    }
    // The elevator
    const lp = this.gridAt(pf).portal;
    if (!target && this.floors > 1 && Math.hypot(p.x - (lp[0] + 0.5), p.z - (lp[1] + 0.5)) < 1.2) {
      const up = pf + 1 < this.floors;
      const to = up ? pf + 1 : 0;
      target = {
        kind: `lift${pf}`, label: `Elevator ${up ? '▲' : '▼'} ${floorName(to)}`, hold: false,
        anchor: () => new THREE.Vector3(lp[0] - 0.5, 2.6, lp[1] + 0.5),
        act: () => this.goToFloor(to),
      };
    }
    // Out on the street: the doors of the other casinos
    if (!target && !this.inside) {
      const lot = this.street.lotAt(p.x, p.z);
      if (lot && lot.id !== this.street.activeId) {
        const l = this.street.map(this.street.activeId, lot.id, p.x, p.z);
        if (Math.abs(l.x - CENTER_X) < 3 && l.z < FACADE_Z + 3.2) {
          const block = this.entryBlock(lot);
          const a = this.street.toActive(lot.id, CENTER_X, FACADE_Z + 0.8);
          target = {
            kind: `door${lot.id}`, label: block ? `🚫 ${lot.info.look.name}` : lot.kind === 'me' ? `Back to ${lot.info.look.name}` : `Enter ${lot.info.look.name}`, hold: false,
            anchor: () => new THREE.Vector3(a.x, 3.6, a.z),
            act: () => this.enterLot(lot),
          };
        }
      }
    }
    if (this.photoMode) target = null;
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
            this.lastInteractKey = '#acted';
          }
        } else {
          this.holdT = Math.max(0, this.holdT - dt * 2);
          this.floaters.ring(this.holdT > 0 ? target.anchor : null, this.holdT / 1.6);
        }
      } else if (pressed) {
        target.act();
        this.lastInteractKey = '#acted';
      }
    } else {
      this.floaters.ring(null, 0);
    }
  }

  /** Walking into a doorway on the street takes you inside that casino. */
  private checkDoors(dt: number): void {
    this.doorCooldown = Math.max(0, this.doorCooldown - dt);
    if (this.doorCooldown > 0 || this.player.floor !== 0) return;
    const tx = Math.floor(this.player.x);
    const tz = Math.floor(this.player.z);
    const lot = this.street.doorAt(tx, tz);
    if (lot) {
      if (!this.enterLot(lot)) {
        // Bounced: step back onto the sidewalk.
        this.player.z = FACADE_Z + 1.3;
        this.doorCooldown = 1.5;
      }
    }
  }

  // ------------------------------------------------------------------ gambling as a visitor

  private tableFocus: { item: PlacedItem; seat: number; dist: number; mode: CamMode } | null = null;

  /**
   * Take a seat to play: the manager sits (or stands) at the table, the camera closes in on
   * it and the house's own rounds there wait. Returns the seat index.
   */
  sitAt(item: PlacedItem): number {
    this.standUp();
    const seat = item.seats.find((s) => s.reachable && !s.occupant && !s.reserved) ?? item.seats.find((s) => s.reachable) ?? item.seats[0];
    if (!seat) return -1;
    const other = seat.occupant ?? seat.reserved;
    if (other && other !== VISITOR) other.forceLeave('Someone else wanted this seat', 2);
    item.release(VISITOR);
    seat.occupant = null;
    seat.reserved = VISITOR;
    item.visitorSeat = seat.index;
    this.player.seat = { x: seat.x, z: seat.z, yaw: seat.face, sit: seat.pose === 'sit', height: seat.seatY };
    this.tableFocus = { item, seat: seat.index, dist: this.cam.distTarget, mode: this.cam.mode };
    this.cam.setMode('top');
    this.cam.distTarget = item.def.size[0] * item.def.size[1] > 4 ? 9.5 : 7.5;
    return seat.index;
  }

  standUp(): void {
    const f = this.tableFocus;
    if (!f) return;
    this.tableFocus = null;
    const seat = f.item.seats[f.seat];
    if (seat && seat.reserved === VISITOR) seat.reserved = null;
    f.item.visitorSeat = null;
    this.player.seat = null;
    const g = this.gridAt(this.player.floor);
    const near = seat ? g.nearestWalkable(seat.tileX, seat.tileZ) : null;
    if (near) {
      this.player.x = near[0] + 0.5;
      this.player.z = near[1] + 0.5;
    }
    this.player.unstick(g);
    this.cam.distTarget = f.dist;
    this.cam.setMode(f.mode);
  }

  /** Money you bet at someone else's table (returns false if you can't cover it). */
  visitorBet(amount: number): boolean {
    if (!this.visit || amount <= 0 || this.money < amount) return false;
    this.money -= amount;
    this.events.emit('money', { money: this.money, delta: -amount });
    return true;
  }

  /**
   * Settle a round you played as a visitor: `payout` is what the table hands back (0 on a
   * loss). What you lose goes to the owner; what you win comes out of their bank.
   */
  visitorSettle(bet: number, payout: number, item: PlacedItem): void {
    const v = this.visit;
    if (!v) return;
    if (payout > 0) {
      this.money += payout;
      this.events.emit('money', { money: this.money, delta: payout });
    }
    const net = payout - bet;
    v.net += net;
    v.hands++;
    this.stats.awayNet += net;
    this.stats.awayHands++;
    if (net > 0) this.stats.earnedTotal += net;
    this.gainXp(1 + Math.min(10, bet / 60));
    const pos = new THREE.Vector3(item.cx, item.model.height + 0.3, item.cz);
    if (Math.abs(net) >= 1) this.floaters.money(pos, net, Math.abs(net) >= 500);
    if (v.lot.kind === 'rival') {
      this.rival.bank -= net;
      this.rival.net += net;
      if (tickRival(this.rival, 0)) this.refreshStreet();
    } else if (v.lot.kind === 'player') {
      this.net.owes[v.lot.id] = (this.net.owes[v.lot.id] ?? 0) - net;
    }
    this.requestSave();
  }

  /** The rival doesn't like big winners. Called by the mini-games after each round. */
  checkWinnerLimit(): boolean {
    const v = this.visit;
    if (!v || v.lot.kind !== 'rival' || v.net < RIVAL_WIN_LIMIT) return false;
    this.rival.banUntil = Date.now() + RIVAL_BAN_MS;
    this.events.emit('toast', { text: `${RIVAL_NAME}'s security escorts you out: "You're winning a little too much, pal." Banned for 5 minutes.`, kind: 'bad' });
    audio.play('bust');
    this.returnHome(true);
    return true;
  }

  // ------------------------------------------------------------------ loop

  private endOfDay(): void {
    const wages = this.workers.reduce((a, w) => a + w.info.wage, 0);
    const upkeep = this.items.items.reduce((a, i) => a + i.def.upkeep, 0);
    this.money -= wages + upkeep;
    const best = [...this.dayAcc.byItem.entries()].sort((a, b) => b[1] - a[1])[0];
    let hotelNet: number | undefined;
    let hotelGuests: number | undefined;
    if (this.hotel) {
      const n = hotelNight(this.hotel, this.rating);
      hotelGuests = n.guests;
      hotelNet = Math.round(n.revenue * this.incomeMult) - n.costs;
      this.money += hotelNet;
      if (hotelNet > 0) this.stats.earnedTotal += hotelNet;
    }
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
      hotel: hotelNet,
      hotelGuests,
    };
    if (hotelNet !== undefined) report.profit += hotelNet;
    this.history.push(report.profit);
    if (this.history.length > 30) this.history.shift();
    this.dayAcc = { revenue: 0, payouts: 0, sales: 0, visitors: 0, byItem: new Map() };
    this.day++;
    this.events.emit('money', { money: this.money, delta: (hotelNet ?? 0) - (wages + upkeep) });
    this.events.emit('day', report);
    if (this.hotel) this.events.emit('hotel', undefined);
    if (this.money < 0) this.notify('You are in the red! Wages and upkeep keep draining the bank until you earn it back.', 'bad');
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

  /** The simulation half of a step: guests, staff, machines, the clock. */
  private simulateWorld(sim: number): void {
    const playing = this.state === 'playing';
    if (playing) {
      if (this.visit) {
        this.visit.away += sim;
        if (tickRival(this.rival, sim)) this.refreshStreet();
      } else {
        this.dayMinutes += sim * (1440 / DAY_SECONDS);
        if (this.dayMinutes >= 1440) {
          this.dayMinutes -= 1440;
          this.endOfDay();
        }
        this.updateEvents(sim);
        this.updateRating(sim);
        if (tickRival(this.rival, sim)) this.refreshStreet();
      }
    }
    this.updateSpawner(sim);
    const vf = this.viewFloor;
    for (const c of this.customers) {
      const hidden = c.floor !== vf || (!this.inside && c.inside);
      this.fxFloor = c.floor;
      this.effects.muted = hidden;
      this.floaters.muted = hidden;
      c.update(sim, this);
    }
    if (this.customers.some((c) => c.gone)) {
      this.customers = this.customers.filter((c) => {
        if (c.gone) {
          if (this.selection?.kind === 'customer' && this.selection.c === c) this.select(null);
          return false;
        }
        return true;
      });
    }
    for (const w of this.workers) {
      const hidden = w.floor !== vf || (!this.inside && w.z < FACADE_Z);
      this.fxFloor = w.floor;
      this.effects.muted = hidden;
      this.floaters.muted = hidden;
      w.update(sim, this);
    }
    this.fxFloor = vf;
    this.items.hideAll = !this.inside;
    this.items.update(sim, this.time);
    this.effects.muted = false;
    this.floaters.muted = false;
    if (playing && !this.visit) this.updateDoor();
  }

  private step(dt: number, render: boolean): void {
    const sim = this.paused && !this.visit ? 0 : dt * (this.visit ? 1 : this.speed);
    this.time += sim;
    const input = this.input;
    const playing = this.state === 'playing';
    const third = this.cam.mode === 'third' && playing;

    // Camera controls
    if (input.wheel) this.cam.zoomBy(Math.exp(input.wheel * 0.0012));
    if (input.pinch !== 1) this.cam.zoomBy(input.pinch);
    if (playing && sim > 0) {
      if (!third) {
        if (input.hit('KeyQ')) this.cam.rotate(-1);
        if (input.hit('KeyE')) this.cam.rotate(1);
      }
      if (input.hit('KeyV')) this.setCameraMode(third ? 'top' : 'third');
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
    const canMove = playing && sim > 0 && this.transitionT <= 0;
    this.transitionT = Math.max(0, this.transitionT - dt);
    if (canMove) {
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
      this.player.update(dt, ix, iz, sprint, this.cam.basis(), this.playerWalk, third);
    } else {
      this.player.update(dt, 0, 0, false, this.cam.basis(), this.playerWalk, third);
    }
    this.cam.followYaw = this.player.yaw;
    this.player.model.root.visible = playing;
    this.playerFx?.update(dt, playing && !this.player.seat);
    this.playerPos.set(this.player.x, 0, this.player.z);
    const wasInside = this.inside;
    this.inside = this.player.floor > 0 || (this.player.z < FACADE_Z + 0.15 && Math.abs(this.player.x - CENTER_X) < 16);
    if (this.inside !== wasInside) {
      if (!this.inside && this.build.active && !this.onHomeFront) this.build.cancel();
      if (!this.inside && this.selection?.kind === 'item' && !this.selection.item.outdoor) this.select(null);
      this.renderer.markShadowsDirty(4);
    }
    if (this.build.active && !this.canBuildHere) this.build.cancel();
    if (playing) this.checkDoors(dt);

    if (playing && sim > 0) {
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
      this.simulateWorld(sim);
      if (playing) {
        this.updateInteraction(sim);
        if (!this.visit) {
          this.objectiveT -= sim;
          if (this.objectiveT <= 0) {
            this.objectiveT = 0.5;
            this.settleRefunds();
            this.checkObjectives();
          }
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

    this.updateVisibility();

    // Audio listener and ambience
    audio.listener.x = this.cam.focus.x;
    audio.listener.z = this.cam.focus.z;
    audio.listener.yaw = this.cam.yaw;
    audio.bustle = clamp(this.customers.filter((c) => c.floor === this.viewFloor).length / 40, 0, 1) * (this.paused ? 0 : 1) * (this.inside ? 1 : 0.35);

    const fx = this.tableFocus ? this.tableFocus.item.cx : this.camFocus?.x ?? this.player.x;
    const fz = this.tableFocus ? this.tableFocus.item.cz + 0.6 : this.camFocus?.z ?? this.player.z;
    this.cam.update(dt, fx, fz);
    this.building.update(dt, this.cam.yaw, this.cam.low);
    this.street.update(dt, this.player.x, this.player.z, this.inside);
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

  private itemsInside = true;
  /** How far the street is drawn below you (you're upstairs). */
  streetDrop = 0;

  /** Only the floor you're on is drawn, and the inside of the building only while you're in it. */
  private updateVisibility(): void {
    const vf = this.viewFloor;
    const inside = this.inside || this.state !== 'playing';
    this.levels.forEach((l, i) => (l.floor.group.visible = inside && i === vf));
    if (this.items.viewFloor !== vf || this.itemsInside !== inside) {
      this.itemsInside = inside;
      this.items.setViewFloor(vf, inside);
      const mv = this.build.movingItem;
      if (mv) mv.root.visible = false;
    }
    this.trash.setViewFloor(vf);
    this.trash.group.visible = inside;
    this.building.interior.visible = inside;
    const storey = inside && this.state === 'playing' ? vf : 0;
    if (-storey * STORY_DROP !== this.streetDrop) {
      this.streetDrop = -storey * STORY_DROP;
      this.building.setStorey(storey);
      this.street.group.position.y = this.streetDrop;
      this.renderer.markShadowsDirty(4);
    }
    for (const c of this.customers) {
      c.model.root.visible = !c.inElevator && c.floor === vf && (inside || !c.inside);
    }
    for (const w of this.workers) {
      w.model.root.visible = !w.inElevator && w.floor === vf && (inside || w.z >= FACADE_Z);
    }
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

  /** Your casino as a snapshot others can walk into. */
  snapshot(): CasinoSnapshot {
    const s = this.serialize();
    return { name: s.name, look: s.look, layout: s.layout, floors: s.floors, paint: s.paint, items: s.items, staff: s.staff, rating: s.rating, jackpotPot: s.jackpotPot };
  }

  serialize(): SaveData {
    // While visiting, your casino is the one saved when you left (with your current money).
    if (this.visit) {
      const home = this.visit.home;
      return {
        ...home,
        money: Math.round(this.money),
        xp: Math.round(this.xp),
        level: this.level,
        objectives: [...this.doneObjectives],
        stats: { ...this.stats },
        rival: { ...this.rival },
        player: { ...home.player, look: this.player.appearance, name: this.player.name },
        cosmetics: { owned: [...this.cosmetics.owned], on: [...this.cosmetics.on] },
        hotel: this.hotel ? { ...this.hotel } : null,
        rebirths: this.rebirths,
        savedAt: Date.now(),
      };
    }
    return {
      v: 2,
      name: this.building.look.name,
      look: { ...this.building.look },
      layout: { ...this.layout },
      floors: this.floors,
      paint: this.levels.map((l) => l.grid.encodeFloor()),
      items: this.items.serialize(),
      staff: this.workers.map((w) => ({ role: w.role, name: w.name, look: w.look })),
      rating: this.rating,
      jackpotPot: Math.round(this.jackpotPot),
      money: Math.round(this.money),
      xp: Math.round(this.xp),
      level: this.level,
      day: this.day,
      dayMinutes: this.dayMinutes,
      satAvg: this.satAvg,
      player: { look: this.player.appearance, name: this.player.name, x: this.player.x, z: this.player.z, floor: this.player.floor },
      objectives: [...this.doneObjectives],
      stats: { ...this.stats },
      trash: this.trash.serialize(),
      history: [...this.history],
      floorPainted: this.floorPainted,
      lookEdited: this.lookEdited,
      renamed: this.renamed,
      speed: this.speed,
      rival: { ...this.rival },
      createdAt: this.createdAt,
      cosmetics: { owned: [...this.cosmetics.owned], on: [...this.cosmetics.on] },
      hotel: this.hotel ? { ...this.hotel } : null,
      rebirths: this.rebirths,
      savedAt: Date.now(),
    };
  }

  load(s: SaveData): void {
    this.state = 'playing';
    this.visit = null;
    this.street.activeId = 'me';
    this.money = s.money;
    this.xp = s.xp;
    this.level = s.level;
    this.stats = { ...emptyStats(), ...s.stats };
    this.doneObjectives = new Set(s.objectives);
    this.floorPainted = s.floorPainted ?? 0;
    this.lookEdited = !!s.lookEdited;
    this.renamed = !!s.renamed;
    this.history = s.history ?? [];
    this.netLog = [];
    // Time always runs at normal speed (the fast-forward buttons were removed).
    this.speed = 1;
    this.paused = false;
    this.rival = { ...newRival(), ...s.rival };
    this.createdAt = s.createdAt || Date.now();
    this.cosmetics = sanitizeCosmetics(s.cosmetics);
    this.hotel = sanitizeHotel(s.hotel);
    this.rebirths = Math.max(0, Math.min(99, Math.round(Number(s.rebirths) || 0)));
    this.applyCosmetics();
    this.player.floor = 0;
    const before = s.items.length;
    this.loadCasino(s, false);
    this.restoreHomeProfile(s);
    // Anything that no longer fits the lot rules is sold back automatically.
    const dropped = before - this.items.items.filter((i) => !i.def.fixed).length;
    if (dropped > 0) {
      const kept = new Set(this.items.items.map((i) => `${i.floor}:${i.tx},${i.tz},${i.def.id}`));
      let refund = 0;
      for (const it of s.items) {
        if (kept.has(`${it.f ?? 0}:${it.tx},${it.tz},${it.id}`)) continue;
        try {
          refund += Math.round(itemDef(it.id).price * 0.8);
        } catch {
          /* unknown item */
        }
      }
      if (refund) {
        this.money += refund;
        window.setTimeout(() => this.notify(`${dropped} items didn't fit the new street rules (lots are now ${MAX_WIDTH} wide but can go deeper and taller). They were sold for ${formatMoney(refund)}.`, 'money'), 1500);
      }
    }
    // Old saves kept money in machine cash boxes; bank it.
    const boxed = s.items.reduce((a, i) => a + Math.max(0, Math.floor(i.cash ?? 0)), 0);
    if (boxed > 0) this.money += boxed;
    this.player.setAppearance(s.player.look);
    this.player.name = s.player.name;
    this.player.floor = clamp(s.player.floor ?? 0, 0, this.floors - 1);
    this.player.x = s.player.x;
    this.player.z = s.player.z;
    this.player.unstick(this.gridAt(this.player.floor));
    for (const it of this.items.items) if (it.def.model === 'statue') it.rebuildModel();
    this.cam.setOrbit(false);
    this.cam.distTarget = 15;
    this.cam.snap(this.player.x, this.player.z);
    this.spawnT = 1;
    this.refreshStreet();
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
    this.events.emit('staff', undefined);
    this.events.emit('visit', undefined);
  }

  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.renderer.setQuality(q);
  }
}

/** The visiting player, as far as a machine's seat bookkeeping is concerned. */
const VISITOR: SeatUser = {
  uid: -1, isCheater: false, risk: 0.5,
  nextBet: () => null, roundStarted: () => undefined, roundResult: () => undefined, forceLeave: () => undefined,
};

export function floorName(f: number): string {
  return f === 0 ? 'Ground floor' : `Floor ${f + 1}`;
}

/** 1 → I, 4 → IV … for the rebirth badge. */
export function roman(n: number): string {
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of t) while (n >= v) {
    out += r;
    n -= v;
  }
  return out;
}
