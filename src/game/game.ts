import * as THREE from 'three';
import { Renderer, type Quality } from '../render/renderer';
import { Effects } from '../render/effects';
import { Input } from '../core/input';
import { audio, type SfxName } from '../core/audio';
import { Emitter } from '../core/events';
import { clamp, damp, distToRect, formatMoney } from '../core/math';
import { pick, rand, randInt } from '../core/rng';
import {
  Grid, CENTER_X, FACADE_Z, SIDEWALK_Z0, DOOR_TILES, WIDTHS, MAX_WIDTH, depthCost, depthLevel, floorCost, floorLevel, type Layout,
} from '../world/grid';
import { FloorRenderer } from '../world/floor';
import { Building, SIGN_FONTS, STORY_DROP, type CasinoLook } from '../world/building';
import { Street, type StreetLot } from '../world/street';
import { MAX_DEPTH_STEPS, openGround } from '../world/city';
import { MilitaryBase } from '../world/militaryBase';
import { buildCar, carDef } from '../world/vehicles';
import { HEAT as POLICE_HEAT } from '../world/police';
import { Sky } from '../world/sky';
import { CharacterModel } from '../entities/characterModel';
import { WaypointBeacon } from '../world/waypoint';
import { type ReticleOpts, sanitizeReticle } from '../ui/reticle';
import { WALL_CUT, syncWallCut } from '../world/walls';
import { type CosmeticState, cosmetic, emptyCosmetics, equipped, sanitizeCosmetics } from '../cosmetics/catalog';
import { PlayerFx } from '../cosmetics/playerFx';
import {
  type ChecklistItem, type HotelBuilding, type HotelBuildingKind, type HotelState, HOTEL_LEVEL, HOTEL_MAX_BUILDINGS, HOTEL_PRICE, MAX_REVIEWS,
  buildingCost, buildingName, emptyBuilding, estimateBuildingRate, hotelDailyCosts, hotelGuestBoost, hotelName, newHotel, sanitizeHotel, snapChecklist,
  towerChecklist,
} from './hotel';
import { CameraRig, type CamMode } from '../world/camera';
import { TrashManager } from '../world/trash';
import { DECK_STYLE, FLOOR_STYLES, LAWN_STYLE } from '../render/textures';
import { ItemManager } from '../items/itemManager';
import { ITEMS, ITEM_BY_ID, type ItemDef, type Site, itemDef, soldAt, zoneBlock } from '../items/catalog';
import type { PlacedItem, ItemHost, SeatUser } from '../items/placedItem';
import type { Outcome } from '../items/types';
import { Customer, type CustomerType, spawnPoint } from '../entities/customer';
import { Worker, roleFor, DOOR_POSTS, MAX_DOOR_GUARDS, type WorkerRole } from '../entities/staff';
import { Player } from '../entities/player';
import { type Appearance, defaultAppearance, sanitizeAppearance } from '../entities/appearance';
import { Floaters } from '../ui/floaters';
import type { MoneyReason, World } from './world';
import { BuildController } from './build';
import { ACTIVE_OBJECTIVES, HOTEL_OBJECTIVES, OBJECTIVES, type LifetimeStats, type Objective, type ObjectiveView, emptyStats, xpForLevel } from './objectives';
import { type RoomSetup, changeCost, sameSetup } from '../hotel/rooms';
import {
  type CasinoSnapshot, type NetState, type RivalState, type SaveData, emptyNet, newNetEpoch, newRival,
} from './save';
import { RIVAL_ID, RIVAL_NAME, generateRival, rivalLook, rivalLotInfo, tickRival } from './rival';
import {
  type HouseState, HOUSE_LEVEL, HOUSE_PRICE, VAULT_TIERS, addLog, clampTransfer, newHouse, sanitizeHouse, securityRating, validCode, vaultInterest, vaultTier,
  garageTier,
} from './house';
import { type GunState, emptyGuns, gunDef, sanitizeGuns } from './guns';
import { GunPlay } from './gunplay';
import { SLOTS, autoSlot } from './guns';
import { Combat } from './combat';
import { Driving, type GarageState, emptyGarage, sanitizeGarage, shotDamage } from './driving';
import { type Activity, activityFor, PRACTICE_LABEL, punchPay } from './activities';

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
  /** The hotel's own result for the day while you were at the casino (its separate bank). */
  hotel?: number;
  /** Which business this report is for. */
  site?: Site;
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
  /** The world is about to swap to another business: close panels that edit it. */
  siteLeaving: void;
  rebirth: number;
  expansion: number;
  jackpot: { amount: number; machine: string };
  event: { title: string; text: string };
  interact: { label: string; hold: boolean } | null;
  minigame: PlacedItem;
  visit: void;
  floor: number;
  camera: CamMode;
  /** Walked up to the gun shop counter. */
  gunshop: void;
  /** Walked up to your vault. */
  vault: PlacedItem;
  /** Guns bought, equipped or holstered; ammo changed. */
  guns: void;
  /** Your house or its vault changed. */
  house: void;
  /** The wall line being drawn changed (cost preview). */
  wallLine: void;
  /** Your health, a knockout or a hit you landed on someone. */
  combat: void;
  /** Practice chips changed. */
  chips: void;
  /** Practice play (pretend chips) at one of your own games, or the home slot machine. */
  practice: PlacedItem;
  /** Sat down at the gaming setup or the arcade cabinet: open its little games. */
  arcade: PlacedItem;
  /** Walked up to the wardrobe: open the character creator. */
  wardrobe: void;
  /** Camera flash (photo booth). */
  flash: void;
  /** Got into or out of a car. */
  driving: void;
  /** A chat line arrived (or you sent one). */
  chat: ChatLine;
  /** At the Velocity Motors counter. */
  dealer: void;
  /** At your garage door (on foot). */
  garage: void;
  /** A waypoint was set or cleared. */
  waypoint: void;
  /** The game has been running slowly for a while: suggest lower graphics. */
  perfHint: { fps: number };
  /** You started or stopped doing something (sitting, punching the bag…). */
  activity: void;
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  musicOn: boolean;
  quality: Quality;
  showFps: boolean;
  camera?: CamMode;
  /** First-person mouse / drag look speed (1 = normal). */
  lookSens?: number;
  /** Your crosshair (screen, scope glass and full-screen scope). */
  reticle?: ReticleOpts;
}

const DAY_SECONDS = 300;
/** Chat text: one line, no control characters, at most 120 characters. */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Practice chips you start with (and can refill to for free). */
export const START_CHIPS = 10_000;
const DAY_START = 10 * 60;
const START_MONEY = 3000;
/** Most a casino or hotel bank can hold; bank the rest in your house vault. */
export const MAX_BANK = 20_000_000;
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
  /** What the casino was earning per game second when you left. */
  rate: number;
  net: number;
  hands: number;
}

/** Lot id of one of your hotel buildings. */
export function hotelLotId(bid: string): string {
  return `hotel:${bid}`;
}

/** Your hotel buildings as other players see them from the street. */
export interface HotelInfo {
  bid: string;
  kind: HotelBuildingKind;
  look: CasinoLook;
  width: number;
  depth: number;
  floors: number;
  stars: number;
}

/** Remote player shown in the world (multiplayer); drawn by the net layer. */
export interface RemoteView {
  pid: string;
  name: string;
  x: number;
  z: number;
}

/** One line of the chat. */
export interface ChatLine {
  from: string;
  text: string;
  t: number;
  me: boolean;
  /** A note from the game (nobody's listening, slow down…). */
  system?: boolean;
}

/** Every online player for the city map, wherever they are (global frame). */
export interface MapPlayer {
  pid: string;
  name: string;
  x: number;
  z: number;
  /** Inside a building (shown at its door), and which one. */
  inside: boolean;
  where: string;
  driving: boolean;
  wanted: number;
  ko: boolean;
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
  /** Another player's hotel floor plan (set by the net layer). */
  playerHotel: ((pid: string, bid: string) => CasinoSnapshot | null) | null = null;
  /** Is this player keeping you out right now? (set by the net layer) */
  bannedBy: ((pid: string) => number) | null = null;
  /** Other players standing in the loaded casino / on the street (set by the net layer). */
  remotes: RemoteView[] = [];
  /** Everyone online, for the city map. */
  mapPlayers: MapPlayer[] = [];
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
  private indoorT = 1;
  /** The sky (and the light it casts), driven by the clock. */
  readonly sky = new Sky();
  /** Is the player inside the loaded casino (not out on the street)? */
  inside = true;
  private transitionT = 0;
  private doorCooldown = 0;
  /** Guns you own and the one in your hand. */
  guns: GunState = emptyGuns();
  /** Pretend chips for practice play. Never real money. */
  playChips = START_CHIPS;
  readonly gunplay: GunPlay;
  /** Health, knockouts and hit markers out on the street. */
  readonly combat: Combat;
  /** Cars: driving, stealing, your garage. */
  readonly drive: Driving;
  /** Fort Mojave, the military base out in the western desert. */
  readonly base: MilitaryBase;
  garage: GarageState = emptyGarage();

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
    this.gunplay = new GunPlay(this);
    this.combat = new Combat(this);
    this.drive = new Driving(this);
    this.street.city.group.add(this.drive.group, this.beacon.group);
    this.base = this.makeBase();
    this.street.city.group.add(this.base.group);
    this.street.outskirts.extraBlock = (x, z) => this.base.blocked(x, z);
    CharacterModel.crude = settings.quality === 'ult';
    this.street.crowd.target = settings.quality === 'high' ? 30 : settings.quality === 'medium' ? 22 : settings.quality === 'low' ? 14 : 8;
    scene.add(this.gunplay.group);
    this.street.city.onHonk = (c) => {
      const w = this.street.globalToWorld(c.x, c.z);
      audio.playAt('honk', w.x, w.z, 0.8);
    };
    this.floorGroup.add(this.levels[0].floor.group);
    scene.add(this.sky.group, this.floorGroup, this.building.group, this.street.group, this.items.group, this.trash.group, this.effects.group, this.player.model.root);
    this.effects.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.refreshStreet();
    this.resetWorld();
  }

  /** The military base, wired to the player, the police, cars and effects. */
  private makeBase(): MilitaryBase {
    const st = () => this.street;
    return new MilitaryBase({
      player: () => {
        const car = this.drive.driving;
        const pg = car ? { x: car.x, z: car.z } : st().worldToGlobal(this.player.x, this.player.z);
        return {
          x: pg.x, z: pg.z, exposed: this.combat.exposed && this.combat.ko <= 0, height: this.player.model.height,
          car: car ? { x: car.x, z: car.z, uid: car.uid, armor: car.armor } : null,
        };
      },
      lineOfSight: (ax, az, bx, bz) => st().police.lineOfSight(ax, az, bx, bz),
      walkable: (x, z) => openGround(x, z, st().cols),
      toWorld: (x, z) => st().globalToWorld(x, z),
      shot: (hit, dmg, fx, fz) => {
        const w = st().globalToWorld(fx, fz);
        const car = this.drive.driving;
        if (!hit) audio.play('whiz', { volume: 0.6 });
        else if (car) {
          this.drive.damage(car, shotDamage(22, car.armor), false);
          audio.play('metalHit', { volume: 0.5 });
        } else this.combat.damage(dmg, 'world', 'the Fort Mojave soldiers', w.x, w.z);
      },
      tracer: (ax, ay, az, bx, by, bz) => {
        const a = st().globalToWorld(ax, az);
        const b = st().globalToWorld(bx, bz);
        this.gunplay.enemyTracer(new THREE.Vector3(a.x, ay, a.z), new THREE.Vector3(b.x, by, b.z));
      },
      spawnVehicle: (id, x, z, yaw) => {
        const def = carDef(id);
        if (!def || this.drive.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 4)) return null;
        const v = this.drive.addVehicle(def, buildCar(def), def.colors[0], x, z, yaw, false, true);
        v.base = true;
        return v.uid;
      },
      vehicleParked: (uid) => this.drive.vehicles.some((v) => v.uid === uid && v.base && v.wreck < 0),
      alarm: (first) => st().police.crime(first ? POLICE_HEAT.base : 0.04),
      notify: (text, kind) => this.notify(text, kind),
    });
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
    this.site = 'casino';
    this.hotelBid = null;
    this.building.setGarden(false);
    this.parked = null;
    this.hotelAcc = 0;
    this.rebirths = 0;
    this.house = null;
    this.guns = emptyGuns();
    this.gunplay.reset();
    this.combat.reset();
    this.street.police.reset();
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
    if (this.visit || this.site !== 'casino') return 'Head home to your casino first.';
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
    const house = this.house;
    const guns = { owned: [...this.guns.owned], equipped: this.guns.equipped, slots: [...this.guns.slots], mods: { ...this.guns.mods } };
    this.newGame({ name: this.building.look.name, look: { ...this.building.look }, player: { ...this.player.appearance }, playerName: this.player.name });
    this.rebirths = n;
    this.stats = stats;
    this.cosmetics = cos;
    this.guns = guns;
    // Your house and its vault survive, but the vault starts empty again.
    if (house) {
      if (house.vault > 0) addLog(house, this.day, `Rebirth ${roman(n)}: vault emptied`, -house.vault);
      house.vault = 0;
      this.house = house;
    }
    this.refreshStreet();
    this.applyCosmetics();
    audio.play('jackpot');
    this.effects.confetti(this.player.x, 2, this.player.z, 160, 1.2);
    this.events.emit('rebirth', n);
    this.saveNow();
    return true;
  }

  // ------------------------------------------------------------------ hotel

  /** Which business is loaded into the world. */
  site: Site = 'casino';
  /** Which hotel building is loaded (while site is 'hotel'). */
  hotelBid: string | null = null;
  /** Your casino, parked while you run the hotel (it catches up when you come back). */
  private parked: { home: SaveData; away: number; rate: number; netLog: [number, number][] } | null = null;
  /** What the hotel earned while you were elsewhere today (for the day report). */
  private hotelAcc = 0;

  get inHotel(): boolean {
    return this.site === 'hotel';
  }

  /** The hotel building you're standing in. */
  get currentBuilding(): HotelBuilding | null {
    return this.site === 'hotel' && this.hotel ? this.hotel.buildings.find((b) => b.id === this.hotelBid) ?? null : null;
  }

  /** In an open-air Pool Garden. */
  get gardenSite(): boolean {
    return this.currentBuilding?.kind === 'garden';
  }

  /** The hotel's bank and level, wherever you are. */
  get hotelMoney(): number {
    return this.site === 'hotel' ? this.money : this.hotel?.bank ?? 0;
  }

  private spendHotel(amount: number): void {
    if (this.site === 'hotel') this.spend(amount, 'expand');
    else if (this.hotel) this.hotel.bank -= amount;
  }

  get hotelLevel(): number {
    return this.site === 'hotel' ? this.level : this.hotel?.level ?? 1;
  }

  /** Why the hotel can't be bought yet (null = go ahead). */
  hotelBlock(): string | null {
    if (this.hotel) return 'You already own a hotel.';
    if (this.visit || this.site !== 'casino') return 'Head home first.';
    if (this.level < HOTEL_LEVEL) return `Unlocks at casino level ${HOTEL_LEVEL}.`;
    if (this.money < HOTEL_PRICE) return `Costs ${formatMoney(HOTEL_PRICE)}.`;
    return null;
  }

  /** Build the (empty) hotel tower next door. From then on it's its own business. */
  buyHotel(): boolean {
    const block = this.hotelBlock();
    if (block) {
      audio.play('error');
      this.notify(block, 'bad');
      return false;
    }
    this.spend(HOTEL_PRICE, 'expand');
    this.hotel = newHotel(this.building.look);
    audio.play('levelup');
    this.notify(`${this.hotel.buildings[0].snap.name} is yours! It's empty for now: walk next door and start building.`, 'good');
    this.refreshStreet();
    this.events.emit('hotel', undefined);
    this.saveNow();
    return true;
  }

  /** Why another hotel building of this kind can't be bought yet (null = go ahead). */
  buildingBlock(kind: HotelBuildingKind): string | null {
    const h = this.hotel;
    if (!h) return 'Build the hotel first.';
    if (this.visit) return 'Head home first.';
    if (h.buildings.length >= HOTEL_MAX_BUILDINGS) return `The street only has room for ${HOTEL_MAX_BUILDINGS} hotel buildings.`;
    const c = buildingCost(kind, h.buildings.filter((b) => b.kind === kind).length);
    if (this.hotelLevel < c.level) return `Unlocks at hotel level ${c.level}.`;
    if (this.hotelMoney < c.price) return `Costs ${formatMoney(c.price)} from the hotel bank.`;
    return null;
  }

  /** Another tower or a Pool Garden on the next lot down the street (paid from the hotel bank). */
  buyBuilding(kind: HotelBuildingKind): boolean {
    const block = this.buildingBlock(kind);
    const h = this.hotel;
    if (block || !h) {
      audio.play('error');
      this.notify(block ?? 'No hotel', 'bad');
      return false;
    }
    const c = buildingCost(kind, h.buildings.filter((b) => b.kind === kind).length);
    this.spendHotel(c.price);
    let n = h.buildings.length;
    while (h.buildings.some((b) => b.id === `h${n}`)) n++;
    const look = this.site === 'hotel' && this.currentBuilding ? { ...this.building.look } : h.buildings[0].snap.look;
    const b = emptyBuilding(`h${n}`, kind, look);
    h.buildings.push(b);
    b.snap.name = buildingName(hotelName(this.homeLook.name), b, h.buildings.length - 1, h.buildings);
    b.snap.look = { ...b.snap.look, name: b.snap.name };
    audio.play('levelup');
    this.notify(kind === 'garden' ? `${b.snap.name} opened next door: put pools, loungers and a tiki bar in it.` : `${b.snap.name} is up: another tower to fill with rooms.`, 'good');
    this.refreshStreet();
    this.events.emit('hotel', undefined);
    this.saveNow();
    return true;
  }

  /** The world as it stands, as a floor plan. */
  private worldSnapshot(): CasinoSnapshot {
    return {
      name: this.building.look.name, look: { ...this.building.look }, layout: { ...this.layout }, floors: this.floors,
      paint: this.levels.map((l) => l.grid.encodeFloor()), walls: this.wallsSave(), items: this.items.serialize(),
      staff: this.workers.map((w) => ({ role: w.role, name: w.name, look: w.look })), rating: this.rating,
    };
  }

  /** Write the loaded hotel building, and the hotel's own books, back into its saved state. */
  private captureHotel(): void {
    const h = this.hotel;
    const b = this.currentBuilding;
    if (!h || !b) return;
    b.snap = this.worldSnapshot();
    h.bank = Math.round(this.money);
    h.xp = Math.round(this.xp);
    h.level = this.level;
    h.objectives = [...this.doneObjectives];
    h.stats = { ...this.stats };
    h.history = [...this.history];
    const measured = Math.max(0, this.incomePerMin / 60);
    const est = estimateBuildingRate(b, h);
    b.rate = measured > 0 && est > 0 ? (measured + est) / 2 : est;
    if (b.kind === 'tower') h.staying = this.customers.filter((c) => c.state === 'seated' && c.seatItem?.def.kind === 'room').length;
  }

  /** Walk into one of your hotel buildings: the hotel's own bank, level and goals take over. */
  private enterHotel(bid: string): void {
    const h = this.hotel!;
    const b = h.buildings.find((x) => x.id === bid);
    if (!b) return;
    const from = this.street.activeId;
    const at = this.street.map(from, hotelLotId(bid), this.player.x, this.player.z);
    this.standUp();
    this.events.emit('siteLeaving', undefined);
    if (this.site === 'hotel') {
      // From one hotel building to another: just swap the floor plan.
      this.captureHotel();
    } else {
      const fromHouse = this.site === 'house' ? this.closeHouse() : null;
      const parked = fromHouse
        ? { home: fromHouse.home, away: fromHouse.away, rate: fromHouse.rate, netLog: this.netLog }
        : this.visit
        ? { home: this.serialize(), away: this.visit.away, rate: this.visit.rate, netLog: this.netLog }
        : { home: this.serialize(), away: 0, rate: Math.max(0, this.incomePerMin / 60), netLog: this.netLog };
      this.visit = null;
      this.parked = parked;
      this.site = 'hotel';
      this.netLog = [];
      this.money = h.bank;
      this.xp = h.xp;
      this.level = h.level;
      this.doneObjectives = new Set(h.objectives);
      this.stats = { ...emptyStats(), ...h.stats };
      this.history = [...h.history];
    }
    this.hotelBid = bid;
    this.build.cancel(false);
    this.select(null);
    this.loadCasino(b.snap, false, this.hotelOpenSnap(b));
    this.building.setGarden(b.kind === 'garden');
    if (b.kind === 'garden' && !b.snap.paint.some((p) => p)) {
      // Fresh lawn, with a stone path up the middle.
      const g = this.grid;
      const r = g.rect;
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) g.setFloor(x, z, Math.abs(x + 0.5 - CENTER_X) < 1.2 ? DECK_STYLE : LAWN_STYLE);
      this.levels[0].floor.rebuild();
    }
    this.street.activeId = hotelLotId(bid);
    this.shiftPlayer(at.x, FACADE_Z - 1.5);
    audio.play('doorbell');
    const empty = !b.snap.items.length;
    this.events.emit('toast', {
      text: b.kind === 'garden'
        ? (empty ? `${b.snap.name}: open sky and fresh grass. Add a pool, loungers and a tiki bar.` : `Welcome to ${b.snap.name}.`)
        : empty ? `${b.snap.name}: an empty shell. It opens once it has a reception desk, a breakfast buffet, a room and a housekeeper.` : `Welcome back to ${b.snap.name}.`,
      kind: 'event',
    });
    this.afterSiteChange();
  }

  /** Leave the hotel: store it, and put the casino's own money, level and goals back. */
  private closeHotel(): { home: SaveData; away: number; rate: number } | null {
    if (this.site !== 'hotel' || !this.parked) return null;
    this.events.emit('siteLeaving', undefined);
    this.select(null);
    this.captureHotel();
    const p = this.parked;
    this.parked = null;
    this.site = 'casino';
    this.hotelBid = null;
    this.building.setGarden(false);
    this.money = p.home.money;
    this.xp = p.home.xp;
    this.level = p.home.level;
    this.doneObjectives = new Set(p.home.objectives);
    this.stats = { ...emptyStats(), ...p.home.stats };
    this.history = [...(p.home.history ?? [])];
    this.netLog = p.netLog;
    return p;
  }

  private afterSiteChange(): void {
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
    this.events.emit('staff', undefined);
    this.events.emit('visit', undefined);
    this.events.emit('hotel', undefined);
    this.refreshStreet();
  }

  /** Is this building taking guests (a garden counts once any tower is open)? */
  private hotelOpenSnap(b: HotelBuilding): boolean {
    const towers = this.hotel?.buildings.filter((x) => x.kind === 'tower') ?? [];
    return b.kind === 'tower' ? snapChecklist(b.snap).every((c) => c.done) : towers.some((t) => snapChecklist(t.snap).every((c) => c.done));
  }

  /** What the tower you're in still needs before guests can stay (empty outside a tower). */
  hotelChecklist(): ChecklistItem[] {
    if (!this.inHotel || this.gardenSite) return [];
    return towerChecklist(this.items.items.map((i) => ({ kind: i.def.kind })), this.staffCount('janitor'));
  }

  /** The tower you're in is open for guests (or, in a Pool Garden, some tower is). */
  get hotelOpen(): boolean {
    if (!this.inHotel) return false;
    if (this.gardenSite) return !!this.hotel?.buildings.some((b) => b.kind === 'tower' && snapChecklist(b.snap).every((c) => c.done));
    return this.hotelChecklist().every((c) => c.done);
  }

  /** A guest's review of their stay. */
  review(stars: number, text: string, name: string, type: string): void {
    const h = this.hotel;
    if (!h || !this.inHotel) return;
    h.reviews.unshift({ stars, text, name, vip: type === 'vip', day: this.day });
    if (h.reviews.length > MAX_REVIEWS) h.reviews.length = MAX_REVIEWS;
    if (stars >= 5 && type === 'vip') this.notify(`⭐ ${name.split(' ')[0]} (VIP) left a 5-star review: “${text.split('.')[0]}.”`, 'good');
    else if (stars <= 1 && Math.random() < 0.5) this.notify(`😠 A 1-star review: “${text.split('.')[0]}.”`, 'bad');
    this.events.emit('hotel', undefined);
  }

  /** Average of the latest reviews (0 = none yet). */
  get reviewAverage(): number {
    const r = this.hotel?.reviews.slice(0, 12) ?? [];
    return r.length ? r.reduce((a, x) => a + x.stars, 0) / r.length : 0;
  }

  /** How your hotel buildings look from the street (cheap: called with every presence update). */
  hotelInfo(): HotelInfo[] {
    const h = this.hotel;
    if (!h) return [];
    return h.buildings.map((b) => {
      const live = b.id === this.hotelBid && this.site === 'hotel';
      const s = b.snap;
      return {
        bid: b.id, kind: b.kind,
        look: live ? { ...this.building.look } : s.look, width: live ? this.layout.width : s.layout.width, depth: live ? this.layout.depth : s.layout.depth,
        floors: live ? this.floors : s.floors, stars: Math.max(1, Math.min(5, Math.round(live ? this.rating : s.rating))),
      };
    });
  }

  /** Your hotel's floor plans, for other players to walk around in. */
  hotelSnapshot(): Record<string, CasinoSnapshot> | null {
    this.captureHotel();
    if (!this.hotel) return null;
    const out: Record<string, CasinoSnapshot> = {};
    for (const b of this.hotel.buildings) out[b.id] = JSON.parse(JSON.stringify(b.snap)) as CasinoSnapshot;
    return out;
  }

  /** Objectives for the business you're in. */
  get objectiveList(): Objective[] {
    return this.site === 'hotel' ? HOTEL_OBJECTIVES : OBJECTIVES;
  }

  /** Decorate a room (pays the difference: upgrades cost, removals give half back). */
  decorateRoom(item: PlacedItem, setup: RoomSetup): boolean {
    if (!item.setup || this.visit || sameSetup(item.setup, setup)) return false;
    const cost = changeCost(item.setup, setup);
    if (cost > 0 && this.money < cost) {
      audio.play('error');
      this.notify(`That costs ${formatMoney(cost)}.`, 'bad');
      return false;
    }
    if (cost > 0) this.spend(cost, 'upgrade');
    else if (cost < 0) this.addMoney(-cost, 'sell');
    item.setup = { ...setup, extras: [...setup.extras] };
    item.rebuildModel();
    this.stats.roomsDecorated++;
    this.effects.sparkle(item.cx, 1.2, item.cz, 18, 0xffe08a, 1.4);
    this.gainXp(20 + Math.max(0, cost) / 100);
    this.requestSave();
    return true;
  }

  /** Copy one room's setup to every other room of the same size on its floor. */
  applySetupToFloor(from: PlacedItem, setup: RoomSetup): { rooms: number; cost: number } | null {
    const targets = this.items.items.filter((i) => i.def.id === from.def.id && i.floor === from.floor && i !== from && i.setup && !sameSetup(i.setup, setup));
    if (!targets.length) return { rooms: 0, cost: 0 };
    const cost = targets.reduce((a, i) => a + changeCost(i.setup!, setup), 0);
    if (cost > 0 && this.money < cost) {
      audio.play('error');
      this.notify(`Doing the whole floor costs ${formatMoney(cost)}.`, 'bad');
      return null;
    }
    if (cost > 0) this.spend(cost, 'upgrade');
    else if (cost < 0) this.addMoney(-cost, 'sell');
    for (const t of targets) {
      t.setup = { ...setup, extras: [...setup.extras] };
      t.rebuildModel();
      this.effects.sparkle(t.cx, 1.2, t.cz, 10, 0xffe08a, 1.2);
    }
    this.stats.floorSetups++;
    this.stats.roomsDecorated += targets.length;
    this.gainXp(40 + Math.max(0, cost) / 100);
    this.requestSave();
    return { rooms: targets.length, cost };
  }

  // ------------------------------------------------------------------ house & bank

  /** Your house on Palm Avenue (null until you buy one). It's also your bank. */
  house: HouseState | null = null;
  /** The vault door is open (you typed the right code this visit). */
  vaultOpen = false;
  private vaultTries = 0;
  /** Epoch ms until which the keypad is locked after too many wrong codes. */
  vaultLockUntil = 0;

  get inHouse(): boolean {
    return this.site === 'house';
  }

  /** Why the house can't be bought yet (null = go ahead). */
  houseBlock(): string | null {
    if (this.house) return 'You already own a house.';
    if (this.visit || this.site !== 'casino') return 'Head home to your casino first.';
    if (this.level < HOUSE_LEVEL) return `Unlocks at casino level ${HOUSE_LEVEL}.`;
    if (this.money < HOUSE_PRICE) return `Costs ${formatMoney(HOUSE_PRICE)}.`;
    return null;
  }

  /** Buy a house on Palm Avenue (it takes the place of whatever stood on that lot). */
  buyHouse(): boolean {
    const block = this.houseBlock();
    if (block) {
      audio.play('error');
      this.notify(block, 'bad');
      return false;
    }
    this.spend(HOUSE_PRICE, 'expand');
    this.house = newHouse(this.player.name, this.building.look);
    audio.play('levelup');
    this.refreshStreet();
    this.notify('Your house is ready on Palm Avenue, right behind the Strip. Open the map (M) and tap it to go there.', 'good');
    this.events.emit('house', undefined);
    this.saveNow();
    return true;
  }

  /** The house as it looks from the street. */
  houseInfo(): { look: CasinoLook; width: number; depth: number; floors: number } | null {
    const h = this.house;
    if (!h) return null;
    const live = this.site === 'house';
    return {
      look: live ? { ...this.building.look } : h.snap.look,
      width: live ? this.layout.width : h.snap.layout.width,
      depth: live ? this.layout.depth : h.snap.layout.depth,
      floors: live ? this.floors : h.snap.floors,
    };
  }

  /** Write the loaded house back into its saved state. */
  private captureHouse(): void {
    if (this.site !== 'house' || !this.house) return;
    this.house.snap = this.worldSnapshot();
  }

  /** Walk into your house. The casino waits (it keeps earning), your cash stays in your pocket. */
  private enterHouse(): void {
    const h = this.house!;
    const from = this.street.activeId;
    const at = this.street.map(from, 'house', this.player.x, this.player.z);
    this.standUp();
    this.events.emit('siteLeaving', undefined);
    let parked: { home: SaveData; away: number; rate: number; netLog: [number, number][] };
    if (this.site === 'hotel') {
      const p = this.closeHotel()!;
      parked = { home: p.home, away: p.away, rate: p.rate, netLog: this.netLog };
    } else if (this.visit) {
      const v = this.visit;
      parked = { home: v.home, away: v.away, rate: v.rate, netLog: this.netLog };
      this.visit = null;
    } else {
      parked = { home: this.serialize(), away: 0, rate: Math.max(0, this.incomePerMin / 60), netLog: this.netLog };
    }
    this.parked = parked;
    this.site = 'house';
    this.netLog = [];
    this.vaultOpen = false;
    this.build.cancel(false);
    this.select(null);
    this.loadCasino(h.snap, false);
    this.building.setGarden(false);
    if (!h.snap.paint.some((p) => p)) {
      // A new house comes with oak floors, not casino carpet.
      const oak = FLOOR_STYLES.findIndex((f) => f.id === 'parquet');
      for (const l of this.levels) {
        const r = l.grid.rect;
        for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) l.grid.setFloor(x, z, oak);
        l.floor.rebuild();
      }
    }
    this.street.activeId = 'house';
    this.syncVaultModel();
    this.shiftPlayer(at.x, FACADE_Z - 1.5);
    audio.play('doorbell');
    this.events.emit('toast', {
      text: h.tier ? 'Home sweet home. Walk up to your vault to bank some money.' : 'Home sweet home! Build → Security → Vault to turn it into your bank.',
      kind: 'event',
    });
    this.afterSiteChange();
  }

  /** Leave the house: store it; the casino's live cash, level and goals go back into its save. */
  private closeHouse(): { home: SaveData; away: number; rate: number } | null {
    if (this.site !== 'house' || !this.parked) return null;
    this.events.emit('siteLeaving', undefined);
    this.select(null);
    this.closeVault();
    this.captureHouse();
    const p = this.parked;
    this.parked = null;
    this.site = 'casino';
    p.home = {
      ...p.home, money: Math.round(this.money), xp: Math.round(this.xp), level: this.level,
      objectives: [...this.doneObjectives], stats: { ...this.stats }, history: [...this.history],
    };
    this.netLog = p.netLog;
    return p;
  }

  /** Leave whichever side business is loaded (hotel or house). */
  private closeSite(): { home: SaveData; away: number; rate: number } | null {
    return this.site === 'hotel' ? this.closeHotel() : this.site === 'house' ? this.closeHouse() : null;
  }

  /** Vault items in the loaded house take the vault's tier as their level (bigger, more bolts). */
  syncVaultModel(): void {
    if (!this.inHouse || !this.house) return;
    for (const it of this.items.items) {
      if (it.def.kind !== 'vault') continue;
      const lvl = Math.max(1, this.house.tier);
      if (it.level !== lvl) {
        it.level = lvl;
        it.rebuildModel();
      }
      it.model.event({ type: 'door', open: this.vaultOpen });
    }
  }

  get vaultInfo() {
    return vaultTier(this.house?.tier ?? 0);
  }

  /** Security rating of the house, 0..100. */
  get houseSecurity(): number {
    const h = this.house;
    if (!h) return 0;
    const live = this.inHouse;
    const staff = live ? this.workers.map((w) => w.role) : h.snap.staff.map((s) => s.role);
    const gadgets = live
      ? this.items.items.reduce((a, i) => a + (i.def.security ?? 0), 0)
      : h.snap.items.reduce((a, i) => a + (ITEM_BY_ID.get(i.id)?.security ?? 0), 0);
    return securityRating(h.tier, staff.filter((r) => r === 'security').length, staff.filter((r) => r === 'doorman').length, gadgets);
  }

  /** What the house costs a day: its guards' wages and its gadgets' upkeep. */
  houseDailyCosts(): number {
    const h = this.house;
    if (!h) return 0;
    const wages = h.snap.staff.reduce((a, st) => a + roleFor(st.role, 'house').wage, 0);
    const upkeep = h.snap.items.reduce((a, i) => a + (ITEM_BY_ID.get(i.id)?.upkeep ?? 0), 0);
    return wages + upkeep;
  }

  /**
   * Type a code on the vault keypad. Three wrong codes in a row set off the alarm and lock
   * the keypad for half a minute.
   */
  tryVaultCode(code: string): 'open' | 'wrong' | 'locked' | 'none' {
    const h = this.house;
    if (!h || !this.inHouse || !h.tier) return 'none';
    if (this.vaultLockUntil > Date.now()) return 'locked';
    if (code === h.code) {
      this.vaultTries = 0;
      return 'open';
    }
    this.vaultTries++;
    if (this.vaultTries >= 3) {
      this.vaultTries = 0;
      this.vaultLockUntil = Date.now() + 30_000;
      audio.play('alarm');
      this.notify('🚨 Wrong code three times! The vault locked itself for 30 seconds and your guards came running.', 'bad');
      const v = this.items.items.find((i) => i.def.kind === 'vault');
      if (v) for (const w of this.workers) if (w.role === 'security') w.x = v.cx + (Math.random() - 0.5) * 2, w.z = v.cz + 1.6;
      return 'locked';
    }
    return 'wrong';
  }

  /** The unlock animation finished: the vault door swings open. */
  openVault(): void {
    if (!this.house?.tier || !this.inHouse) return;
    this.vaultOpen = true;
    this.stats.vaultOpened++;
    this.syncVaultModel();
    this.events.emit('house', undefined);
  }

  closeVault(): void {
    if (!this.vaultOpen) return;
    this.vaultOpen = false;
    this.syncVaultModel();
    if (this.inHouse) audio.play('vaultClunk');
    this.events.emit('house', undefined);
  }

  /** Pick (or change) the vault code. It must have exactly as many digits as the vault's tier asks. */
  setVaultCode(code: string): boolean {
    const h = this.house;
    if (!h || !validCode(code, h.tier)) return false;
    h.code = code;
    audio.play('purchase');
    this.notify('New vault code saved. Don’t forget it!', 'good');
    this.events.emit('house', undefined);
    this.saveNow();
    return true;
  }

  /** Upgrade the vault to the next tier (paid from your cash). A new tier asks for a longer code. */
  upgradeVault(newCode: string): boolean {
    const h = this.house;
    const next = VAULT_TIERS[h?.tier ?? 0];
    if (!h || !h.tier || !next) return false;
    if (this.money < next.price) {
      audio.play('error');
      this.notify(`${next.name} costs ${formatMoney(next.price)}.`, 'bad');
      return false;
    }
    if (!validCode(newCode, next.tier)) {
      audio.play('error');
      this.notify(`Pick a ${next.digits}-digit code for the ${next.name}.`, 'bad');
      return false;
    }
    this.spend(next.price, 'upgrade');
    h.tier = next.tier;
    h.code = newCode;
    addLog(h, this.day, `Upgraded to ${next.name}`, -next.price);
    audio.play('levelup');
    this.syncVaultModel();
    const v = this.items.items.find((i) => i.def.kind === 'vault');
    if (v) this.effects.sparkle(v.cx, 1.5, v.cz, 40, 0xffd24a, 1.4);
    this.notify(`🔐 ${next.name}! Holds up to ${formatMoney(next.cap)} and pays ${(next.interest * 100).toFixed(2)}% interest a day.`, 'good');
    this.events.emit('house', undefined);
    this.saveNow();
    return true;
  }

  /** The hotel's bank, wherever the hotel is (it's parked while you're home). */
  private get hotelBank(): number {
    return this.hotel?.bank ?? 0;
  }

  /**
   * Move money between the open vault and a business. Positive `amount` deposits into the
   * vault from it, negative withdraws to it. Returns how much actually moved.
   */
  vaultTransfer(target: 'casino' | 'hotel', amount: number): number {
    const h = this.house;
    if (!h || !this.inHouse || !this.vaultOpen) return 0;
    if (target === 'hotel' && !this.hotel) return 0;
    const source = target === 'casino' ? this.money : this.hotelBank;
    // Withdrawals stop where the business's bank is full.
    if (amount < 0) amount = -Math.min(-amount, Math.max(0, MAX_BANK - source));
    const moved = clampTransfer(amount, h.vault, h.tier, Math.max(0, source));
    if (!moved) {
      audio.play('error');
      const t = vaultTier(h.tier);
      if (amount > 0 && t && h.vault >= t.cap) this.notify(`The ${t.name} is full (${formatMoney(t.cap)}). Upgrade it to store more.`, 'bad');
      else this.notify(amount > 0 ? `Not enough in the ${target} to deposit.` : 'The vault is empty.', 'bad');
      return 0;
    }
    h.vault += moved;
    if (target === 'casino') {
      this.money -= moved;
      this.events.emit('money', { money: this.money, delta: -moved });
    } else if (this.hotel) this.hotel.bank -= moved;
    if (moved > 0) this.stats.deposited += moved;
    addLog(h, this.day, moved > 0 ? `Deposit from the ${target}` : `Sent to the ${target}`, moved);
    audio.play(moved > 0 ? 'coin' : 'cash');
    const v = this.items.items.find((i) => i.def.kind === 'vault');
    if (v) this.effects.sparkle(v.cx, 1.2, v.cz, 14, 0xffd24a, 0.9);
    this.events.emit('house', undefined);
    this.events.emit('hotel', undefined);
    this.requestSave();
    return moved;
  }

  // ------------------------------------------------------------------ guns

  /** Buy a gun at the gun shop (from the cash you have on you). It goes straight into your hand. */
  /** Your casino's level, wherever you are (the hotel has its own). */
  get homeLevel(): number {
    return this.site === 'hotel' ? this.parked?.home.level ?? this.level : this.level;
  }

  buyGun(id: string): boolean {
    const d = gunDef(id);
    if (!d || this.guns.owned.includes(id)) return false;
    const lvl = this.homeLevel;
    if (lvl < d.unlock) {
      audio.play('error');
      this.notify(`${d.name} unlocks at casino level ${d.unlock}.`, 'bad');
      return false;
    }
    if (this.money < d.price) {
      audio.play('error');
      this.notify(`${d.name} costs ${formatMoney(d.price)}.`, 'bad');
      return false;
    }
    this.spend(d.price, 'purchase');
    const slots = [...this.guns.slots];
    const next = { owned: [...this.guns.owned, id], equipped: id, slots, mods: { ...this.guns.mods } };
    autoSlot(next, id);
    this.guns = next;
    audio.play('reload');
    const key = slots.indexOf(id);
    this.notify(`${d.melee ? '🏏' : '🔫'} ${d.name} is yours${key >= 0 ? ` (key ${key + 1})` : ''}. It only works out on the street: ${d.melee ? 'click to swing' : 'click (or hold) to shoot, R to reload'}.`, 'good');
    this.events.emit('guns', undefined);
    this.saveNow();
    return true;
  }

  /** Put a weapon on one of the 1–5 keys (null empties the slot). */
  assignSlot(slot: number, id: string | null): void {
    if (slot < 0 || slot >= SLOTS || (id && !this.guns.owned.includes(id))) return;
    const slots = this.guns.slots.map((x) => (x === id ? null : x));
    slots[slot] = id;
    this.guns = { ...this.guns, slots };
    audio.play('click');
    this.events.emit('guns', undefined);
    this.requestSave();
  }

  /** Key 1–5: draw what's on that slot (again to holster). */
  useSlot(slot: number): void {
    const id = this.guns.slots[slot] ?? null;
    if (!id) {
      this.notify(`Nothing on key ${slot + 1}. Assign a weapon in the gun shop or by clicking the slot bar.`, 'info');
      return;
    }
    this.equipGun(this.guns.equipped === id ? null : id);
  }

  /** Draw a gun you own, or holster (null). */
  equipGun(id: string | null): void {
    if (id && !this.guns.owned.includes(id)) return;
    this.guns = { ...this.guns, equipped: id };
    audio.play(id ? 'reload' : 'click');
    this.events.emit('guns', undefined);
    this.requestSave();
  }

  /** A target went down (goal progress shows up right away). */
  onTargetHit(): void {
    const n = this.stats.targetsHit;
    if (n === 1 || n % 25 === 0) this.notify(n === 1 ? '🎯 Nice shot! Targets come back after a while.' : `🎯 ${n} targets down!`, 'good');
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
      info: { look: this.homeLook, width: this.homeLayout.width, depth: this.homeLayout.depth, floors: this.homeFloors, tagline: this.rebirths ? `REBIRTH ${roman(this.rebirths)} · OPEN 24/7` : 'OPEN 24/7', cos: equipped(this.cosmetics, 'casino') },
    };
    const ri = rivalLotInfo(this.rival);
    const rival: StreetLot = {
      id: RIVAL_ID, kind: 'rival', owner: 'The Viper', order: 0, online: true,
      info: { look: rivalLook(), width: ri.layout.width, depth: ri.layout.depth, floors: ri.floors, tagline: 'HIGH LIMITS · NO MERCY' },
    };
    const lots = [rival, me, ...this.extraLots];
    for (const [i, b] of this.hotelInfo().entries()) {
      lots.push({
        id: hotelLotId(b.bid), kind: 'hotel', hotelOf: 'me', owner: this.player.name, order: i, online: true,
        info: {
          look: b.look, width: b.width, depth: b.depth, floors: b.floors,
          tagline: b.kind === 'garden' ? 'POOL · CABANAS · TIKI BAR' : `${'★'.repeat(b.stars)} HOTEL`, style: b.kind === 'garden' ? 'garden' : 'hotel',
        },
      });
    }
    const hi = this.houseInfo();
    if (hi) {
      lots.push({
        id: 'house', kind: 'house', houseOf: 'me', owner: this.player.name, order: 0, online: true,
        info: { look: hi.look, width: hi.width, depth: hi.depth, floors: hi.floors, style: 'house', tagline: '', ownGarage: true },
      });
    }
    this.street.setLots(lots);
    if (!this.street.get(this.street.activeId)) this.street.activeId = 'me';
  }

  /** Your casino's save while its interior isn't loaded (visiting, or in the hotel). */
  private get awayHome(): SaveData | null {
    return this.visit?.home ?? this.parked?.home ?? null;
  }

  get homeLayout(): Layout {
    return this.awayHome ? this.awayHome.layout : this.layout;
  }

  get homeFloors(): number {
    return this.awayHome ? this.awayHome.floors : this.floors;
  }

  get homeLook(): CasinoLook {
    return this.awayHome ? this.awayHome.look : { ...this.building.look };
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
    if (lot.kind === 'hotel' && lot.hotelOf) return this.playerHotel?.(lot.hotelOf, lot.id.split('hotel:')[1] ?? '') ?? null;
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
    if (lot.kind === 'house' && lot.houseOf !== 'me') return `${lot.owner}'s bodyguards won’t let you in: it’s a private home.`;
    if (lot.kind === 'filler' || lot.kind === 'shop') return 'You can’t go in there.';
    if (lot.kind === 'hotel' && lot.hotelOf && lot.hotelOf !== 'me') {
      const until = this.bannedBy?.(lot.hotelOf) ?? 0;
      if (until > Date.now()) return `${lot.owner} blacklisted you. Try again in ${Math.ceil((until - Date.now()) / 60000)} min.`;
      if (!this.lotSnapshot(lot)) return `${lot.info.look.name} isn't open to visitors yet.`;
    }
    return null;
  }

  /** Walk through another casino's door (or back through your own). */
  enterLot(lot: StreetLot): boolean {
    if (this.state !== 'playing' || lot.id === this.street.activeId) return false;
    if (lot.hotelOf === 'me' && this.hotel) {
      this.enterHotel(lot.id.slice('hotel:'.length));
      return true;
    }
    if (lot.id === 'house' && this.house) {
      this.enterHouse();
      return true;
    }
    if (lot.kind === 'me') {
      if (this.site !== 'casino') {
        const p = this.closeSite()!;
        this.visit = { lot, home: p.home, away: p.away, rate: p.rate, net: 0, hands: 0 };
      }
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
    let home: SaveData;
    let away: number;
    let rate: number;
    const fromHotel = this.closeSite();
    if (fromHotel) ({ home, away, rate } = fromHotel);
    else if (this.visit) ({ home, away, rate } = this.visit);
    else {
      home = this.serialize();
      away = 0;
      rate = Math.max(0, this.incomePerMin / 60);
    }
    this.visit = { lot, home, away, rate, net: 0, hands: 0 };
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
    this.loadCasino(v.home, false, true);
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
    const earned = this.catchUp(v.away, v.rate);
    if (Math.abs(earned) >= 1) {
      this.events.emit('toast', { text: `While you were out your casino made ${earned >= 0 ? '+' : ''}${formatMoney(earned)}.`, kind: earned >= 0 ? 'money' : 'bad' });
    }
    this.events.emit('money', { money: this.money, delta: 0 });
    this.events.emit('visit', undefined);
    this.events.emit('staff', undefined);
    this.events.emit('objectives', undefined);
    this.events.emit('look', undefined);
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
  /**
   * Put a casino's floor plan into the world (yours or one you're visiting). `crowd` fills it
   * with guests straight away: nobody walks into an empty building just because you weren't there.
   */
  private loadCasino(s: CasinoSnapshot, visiting: boolean, crowd = visiting): void {
    // Lots stop where the next street's buildings begin.
    this.layout = { ...s.layout, depth: Math.min(s.layout.depth, MAX_DEPTH_STEPS) };
    this.setFloorCount(s.floors || 1);
    for (const l of this.levels) l.grid.setLayout(this.layout);
    for (const l of this.levels) l.grid.floor.fill(0);
    for (const l of this.levels) l.grid.wall.fill(0);
    this.resetWorld();
    s.paint?.forEach((p, f) => this.levels[f]?.grid.decodeFloor(p));
    s.walls?.forEach((p, f) => this.levels[f]?.grid.decodeWalls(p));
    for (const l of this.levels) l.floor.rebuild();
    this.building.setLook(s.look);
    this.items.load(s.items);
    for (const st of s.staff ?? []) this.addWorker(st.role, st.look, st.name, true);
    this.rating = s.rating || 2;
    this.ratingTarget = this.rating;
    this.jackpotPot = s.jackpotPot || JACKPOT_SEED;
    this.spawnT = 0.5;
    this.activeEvent = null;
    if (crowd) {
      // A lively floor to walk into.
      const seats = this.items.gamblingSeats() + this.items.items.reduce((a, i) => a + (i.def.kind === 'room' || i.def.kind === 'bar' || i.def.kind === 'buffet' || i.def.kind === 'pool' ? i.seats.length : 0), 0);
      const cap = seats ? Math.min(this.maxCustomers(), Math.round(6 + seats * 0.8)) : 0;
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
  /** True while the casino replays time you were away (the hotel's time is already counted). */
  private catchingUp = false;

  private catchUp(seconds: number, rate = this.incomePerMin / 60): number {
    this.catchingUp = true;
    try {
      return this.replayAway(seconds, rate);
    } finally {
      this.catchingUp = false;
    }
  }

  private replayAway(seconds: number, rate: number): number {
    const before = Math.min(this.money, MAX_BANK);
    const real = Math.min(seconds, 60);
    const dt = 0.25;
    for (let t = 0; t < real; t += dt) this.simulateWorld(dt);
    let rest = seconds - real;
    while (rest > 0) {
      const step = Math.min(rest, 30);
      rest -= step;
      this.money = Math.min(MAX_BANK, this.money + rate * step);
      this.tickHotel(step);
      this.dayMinutes += step * (1440 / DAY_SECONDS);
      if (this.dayMinutes >= 1440) {
        this.dayMinutes -= 1440;
        this.endOfDay();
      }
    }
    this.capBanks();
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
    // The bank is full at MAX_BANK: income past that is lost.
    if (amount > 0) {
      amount = Math.min(amount, Math.max(0, MAX_BANK - this.money));
      if (amount <= 0) {
        this.bankFull();
        return;
      }
    }
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
    if (k === 'bar' || k === 'snack' || k === 'atm' || ((k === 'buffet' || k === 'restaurant' || k === 'giftshop' || k === 'vending' || k === 'spa' || k === 'lounger') && o.bet > 0)) {
      if (k !== 'atm') {
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
    if (k === 'bench' || k === 'desk' || k === 'pool') return;
    if (k === 'room') {
      if (!home) return;
      this.stats.rounds++;
      this.logNet(o.bet);
      this.dayAcc.revenue += o.bet;
      this.dayAcc.byItem.set(item.def.name, (this.dayAcc.byItem.get(item.def.name) ?? 0) + o.bet);
      this.addMoney(o.bet, 'collect');
      if (playing) showMoney(o.bet);
      this.sfxAt('coin', item.cx, item.cz, 0.5);
      this.gainXp(4 + Math.min(40, o.bet / 25));
      return;
    }
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
      const unlocked = ITEMS.filter((d) => d.unlock === this.level && soldAt(d, this.site));
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
      bestRoomStars: this.items.items.reduce((a, i) => Math.max(a, i.roomStars), 0),
      hotelTowers: this.hotel?.buildings.filter((b) => b.kind === 'tower').length ?? 0,
      hotelGardens: this.hotel?.buildings.filter((b) => b.kind === 'garden').length ?? 0,
      hotelOpen: this.hotelOpen,
      reviewAvg: this.reviewAverage,
      gardenItems: this.gardenSite ? this.items.items.length : Math.max(0, ...(this.hotel?.buildings.filter((b) => b.kind === 'garden').map((b) => b.snap.items.length) ?? [0])),
      gunsOwned: this.guns.owned.length,
      carsOwned: this.garage.owned.length,
      houseOwned: !!this.house,
      vaultTier: this.house?.tier ?? 0,
      vaultMoney: this.house?.vault ?? 0,
      houseGuards: this.inHouse ? this.staffCount('security') : this.house?.snap.staff.filter((st) => st.role === 'security').length ?? 0,
    };
  }

  activeObjectives(): Objective[] {
    return this.objectiveList.filter((o) => !this.doneObjectives.has(o.id)).slice(0, ACTIVE_OBJECTIVES);
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
    const hotel = this.site === 'hotel';
    const machines = this.items.items.filter((i) => (hotel ? i.def.kind === 'room' : i.isGambling));
    const kinds = new Set(machines.map((i) => i.def.kind));
    const broken = machines.length ? machines.filter((m) => m.broken || m.dirty).length / machines.length : 0;
    // A hotel's "variety" is how nice its rooms are plus what else there is to do.
    const extras = new Set(this.items.items.filter((i) => ['pool', 'bar', 'snack', 'stage', 'bench'].includes(i.def.kind)).map((i) => i.def.kind));
    const avgStars = machines.length ? machines.reduce((a, r) => a + r.roomStars, 0) / machines.length : 0;
    return {
      happiness: clamp(this.satAvg / 100, 0, 1),
      decor: clamp(this.items.totalAppeal / (area * 0.1), 0, 1),
      variety: hotel ? clamp((avgStars - 1) / 4, 0, 1) * 0.6 + clamp(extras.size / 3, 0, 1) * 0.4 : clamp((kinds.size - 1) / 5, 0, 1),
      clean: 1 - clamp(this.trash.list.length / Math.max(12, area / 10), 0, 1),
      working: 1 - broken,
    };
  }

  private updateRating(dt: number): void {
    const b = this.ratingBreakdown();
    const noGames = this.site === 'hotel'
      ? (this.items.items.some((i) => i.def.kind === 'room') && this.items.items.some((i) => i.def.kind === 'desk') ? 0 : 0.8)
      : this.items.items.some((i) => i.isGambling) ? 0 : 0.8;
    this.ratingTarget = clamp(
      0.6 + b.happiness * 2.5 + b.decor * 0.95 + b.variety * 0.7 - (1 - b.clean) * 0.9 - (1 - b.working) * 0.7 + this.buzz * 0.4 - noGames,
      0.5,
      5,
    );
    if (this.inHotel && this.reviewAverage) this.ratingTarget = clamp(this.ratingTarget + (this.reviewAverage - 3) * 0.2, 0.5, 5);
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
    return q === 'ult' ? 600 : q === 'high' ? 90 : q === 'medium' ? 60 : 38;
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
    if (this.site === 'house') {
      this.spawnT = 5;
      return;
    }
    if (this.site === 'hotel') {
      const inside = this.customers.filter((c) => !c.exited).length;
      const mult = this.activeEvent?.spawnMult ?? 1;
      if (this.gardenSite) {
        // Hotel guests wander over for a swim (only once some tower is open).
        const spots = this.items.items.reduce((a, i) => a + (i.def.zone === 'garden' || i.def.kind === 'bench' ? i.seats.length : 0), 0);
        const cap = Math.min(this.maxCustomers(), Math.round(2 + spots * 1.1));
        if (this.hotelOpen && spots > 0 && inside < cap) {
          const c = this.spawnCustomer(Math.random() < 0.06 + this.rating * 0.01 ? 'vip' : Math.random() < 0.3 ? 'tourist' : 'regular');
          c.outings = randInt(2, 5);
        }
        const perMin = (2 + this.rating * 1.4 + spots * 0.25) * this.hourMult() * mult;
        this.spawnT = (60 / perMin) * rand(0.6, 1.4);
        return;
      }
      // A tower only takes guests once it passes its opening checklist and has a clean room free.
      const rooms = this.items.items.filter((i) => i.def.kind === 'room');
      const free = rooms.filter((r) => !r.dirty && r.freeSeat()).length;
      const cap = Math.min(this.maxCustomers(), Math.round(3 + rooms.length * 1.4));
      if (this.hotelOpen && free > 0 && inside < cap) {
        const r = Math.random();
        // Luxury rooms and penthouses draw high rollers.
        const lux = rooms.filter((x) => x.roomClass >= 1 || x.roomStars >= 4).length;
        const vip = (this.rating >= 2.5 ? 0.03 + (this.rating - 2.5) * 0.05 : 0.01) + Math.min(0.2, lux * 0.025);
        this.spawnCustomer(r < vip ? 'vip' : r < vip + 0.2 ? 'tourist' : 'regular');
      }
      const perMin = (2 + this.rating * 1.6 + Math.min(this.items.totalAppeal, 80) * 0.06 + rooms.length * 0.6) * this.hourMult() * mult;
      this.spawnT = (60 / perMin) * rand(0.6, 1.4);
      return;
    }
    const seats = this.items.gamblingSeats();
    const benchSeats = this.items.countKind((i) => i.def.kind === 'bench') * 2;
    // Ult (AFK): far more guests than seats (the rest queue, watch and wander), arriving 3× as fast.
    const ult = this.settings.quality === 'ult';
    const cap = Math.min(this.maxCustomers(), Math.round(ult ? 10 + seats * 3 + benchSeats : 3 + seats * 1.15 + benchSeats * 0.5));
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
    const perMin = (3.5 + this.rating * 2.4 + Math.min(this.items.totalAppeal, 80) * 0.1 + seats * 0.2) * this.hourMult() * mult * hotelMult * (ult ? 3 : 1);
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

  /** Things that happen at the hotel: celebrities, tour groups, weddings, a critic… */
  private hotelEvent(): void {
    this.eventT = rand(150, 280);
    if (!this.hotelOpen) return;
    const rooms = this.items.items.filter((i) => i.def.kind === 'room');
    const spawn = (type: CustomerType, n: number) => {
      for (let i = 0; i < n; i++) {
        const [x, z] = spawnPoint();
        const c = this.spawnCustomer(type, x + rand(-1, 1), z);
        if (this.gardenSite) c.outings = randInt(2, 5);
      }
    };
    const options: (() => void)[] = [
      () => {
        this.events.emit('event', { title: 'Tour group!', text: 'A coach full of sightseers wants rooms for the night.' });
        spawn('tourist', randInt(4, 7));
      },
      () => this.startEvent('busy', 'Convention in town!', 'Every hotel on the Strip is filling up. More guests for a while.', 90, 2),
    ];
    if (!this.gardenSite && rooms.length >= 2) {
      options.push(() => {
        this.events.emit('event', { title: 'Wedding party!', text: 'A wedding party just arrived. They want the nicest rooms you have.' });
        spawn('regular', randInt(3, 5));
        spawn('vip', 1);
      });
    }
    if (!this.gardenSite && rooms.some((r) => r.roomClass >= 1 || r.roomStars >= 4)) {
      options.push(() => {
        this.events.emit('event', { title: 'Celebrity sighting!', text: 'A movie star is checking in. Their review could make your name.' });
        spawn('vip', 1);
        this.buzz = Math.min(1, this.buzz + 0.3);
      });
    }
    if (!this.gardenSite && rooms.length >= 3) {
      options.push(() => {
        // The hotel critic judges rooms, cleanliness and guest reviews.
        const avgStars = rooms.reduce((a, r) => a + r.roomStars, 0) / rooms.length;
        const dirty = rooms.filter((r) => r.dirty).length / rooms.length;
        const reviews = this.reviewAverage || 3;
        const score = Math.max(1, Math.min(5, Math.round(avgStars * 0.45 + reviews * 0.45 + (1 - dirty) * 1.1 - 0.2)));
        const prize = score * score * 400;
        this.addMoney(prize, 'reward');
        this.buzz = Math.min(1, this.buzz + score * 0.08);
        audio.play(score >= 4 ? 'jackpot' : 'pop');
        this.events.emit('event', { title: `Hotel critic: ${'★'.repeat(score)}${'☆'.repeat(5 - score)}`, text: score >= 4 ? `A glowing write-up! Bookings bonus +${formatMoney(prize)}.` : `“Room for improvement.” Decorate rooms and keep them clean. +${formatMoney(prize)}` });
      });
    }
    pick(options)();
  }

  private updateEvents(dt: number): void {
    if (this.activeEvent) {
      this.activeEvent.left -= dt;
      if (this.activeEvent.left <= 0) this.activeEvent = null;
    }
    this.eventT -= dt;
    if (this.eventT > 0) return;
    if (this.inHotel) {
      this.hotelEvent();
      return;
    }
    if (this.items.gamblingSeats() < 4) return;
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

  /** Why this item can't go in the building you're in (hotel indoor/outdoor rules). */
  placeBlock(def: ItemDef): string | null {
    // (Moving your one vault is fine; buying a second isn't.)
    if (def.kind === 'vault' && this.items.items.some((i) => i.def.kind === 'vault' && i !== this.build.movingItem)) return 'You already have a vault. Open it to upgrade it instead.';
    return this.inHotel ? zoneBlock(def, this.gardenSite) : null;
  }

  purchase(def: ItemDef, tx: number, tz: number, rot: number, color: number): PlacedItem | null {
    if (this.visit) return null;
    const zb = this.placeBlock(def);
    if (zb) {
      audio.play('error');
      this.notify(zb, 'bad');
      return null;
    }
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
    if (def.kind === 'vault' && this.house) {
      // A brand-new vault: tier 1, and it wants a code before it'll hold anything.
      if (!this.house.tier) this.house.tier = 1;
      item.pendingXp = 0;
      this.syncVaultModel();
      this.events.emit('vault', item);
    }
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
    if (item.def.kind === 'vault' && this.house) {
      if (this.house.vault > 0) {
        audio.play('error');
        this.notify('Empty the vault before you sell it.', 'bad');
        return;
      }
      this.house.tier = 0;
      this.house.code = '';
      this.vaultOpen = false;
    }
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
    const info = roleFor(role, this.site);
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

  /** Push the back wall out, up to the block's depth limit (the lots behind start there). */
  expandDepth(): boolean {
    if (this.layout.depth >= MAX_DEPTH_STEPS) {
      audio.play('error');
      this.notify('This is as deep as a lot goes: the buildings on the next street start right behind you. Add a floor instead!', 'bad');
      return false;
    }
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
    if (this.gardenSite) {
      audio.play('error');
      this.notify('A Pool Garden is open-air: build upwards in a hotel tower instead.', 'bad');
      return false;
    }
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

  setCameraMode(mode: CamMode, remember = true): void {
    // Behind the wheel the camera stays behind the car.
    if (this.drive?.driving && remember) return;
    this.cam.setMode(mode);
    if (remember) this.settings.camera = mode;
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

  // ------------------------------------------------------------------ waypoints & fast travel

  /** The spot you marked on the map (global frame), or null. */
  waypoint: { x: number; z: number; label: string } | null = null;
  private beacon = new WaypointBeacon();

  setWaypoint(x: number, z: number, label = 'Waypoint'): void {
    this.waypoint = { x, z, label };
    audio.play('pop', { pitch: 1.3 });
    this.events.emit('waypoint', undefined);
  }

  clearWaypoint(): void {
    if (!this.waypoint) return;
    this.waypoint = null;
    this.events.emit('waypoint', undefined);
  }

  /** Your casino, your hotel buildings and your house. */
  ownsLot(lot: StreetLot): boolean {
    return lot.kind === 'me' || lot.hotelOf === 'me' || (lot.id === 'house' && !!this.house);
  }

  /** In one of your own buildings, or standing right outside one (where fast travel works). */
  get atOwnBuilding(): boolean {
    if (this.inside) return !this.visit;
    const p = this.street.worldToGlobal(this.player.x, this.player.z);
    return this.street.lots.some((l) => {
      if (!this.ownsLot(l)) return false;
      const d = this.street.toGlobal(l.id, CENTER_X, SIDEWALK_Z0 + 1.6);
      return Math.hypot(d.x - p.x, d.z - p.z) < 14;
    });
  }

  /** Why you can't fast-travel to this building right now (null = go ahead). */
  travelBlock(lot: StreetLot): string | null {
    if (!this.ownsLot(lot)) return 'You can only teleport to your own buildings. Mark a waypoint and walk or drive there.';
    if (!this.atOwnBuilding) return 'Fast travel only works between your own buildings: get to your casino, hotel or house first.';
    return null;
  }

  /** Fast travel to the sidewalk outside one of your own buildings (from another one). */
  teleportToLot(lot: StreetLot): boolean {
    const block = this.travelBlock(lot);
    if (block) {
      audio.play('error');
      this.notify(block, 'bad');
      return false;
    }
    const d = this.street.toGlobal(lot.id, CENTER_X + 0.1, SIDEWALK_Z0 + 1.6);
    return this.teleportTo(d.x, d.z);
  }

  /**
   * Put the player on a point of the street (global frame). Only the sidewalks and the road
   * are allowed; you can never land inside a casino. Players get here through fast travel
   * between their own buildings (teleportToLot).
   */
  teleportTo(gx: number, gz: number): boolean {
    if (this.state !== 'playing' || this.photoMode) return false;
    if (this.drive.driving) {
      audio.play('error');
      this.notify('Get out of the car first.', 'bad');
      return false;
    }
    const lock = this.combat.teleportLock;
    if (lock > 0) {
      audio.play('error');
      this.notify(`You were just hurt: no teleporting for ${Math.ceil(lock)} more seconds.`, 'bad');
      return false;
    }
    const w = this.street.globalToWorld(gx, gz);
    const tx = Math.floor(w.x);
    const tz = Math.floor(w.z);
    if (!this.street.isOutdoors(w.x, w.z) || this.street.doorAt(tx, tz)) return false;
    const g = this.gridAt(0);
    if (g.isOwned(tx, tz) || (g.inBounds(tx, tz) && g.occupant(tx, tz))) return false;
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

  /** The police chase (global frame), fed with where you are and what they can hit. */
  private updatePolice(dt: number): void {
    const st = this.street;
    const pol = st.police;
    const pg = st.worldToGlobal(this.player.x, this.player.z);
    pol.update(dt, {
      px: pg.x,
      pz: pg.z,
      exposed: this.combat.exposed && this.combat.ko <= 0,
      speed: this.player.speed,
      height: this.player.model.height,
      toWorld: (x, z) => st.globalToWorld(x, z),
      onShot: (hit, dmg, gx, gz) => {
        const w = st.globalToWorld(gx, gz);
        if (hit) this.combat.damage(dmg, 'police', 'The police', w.x, w.z);
        else audio.play('whiz', { volume: 0.6 });
      },
      onTracer: (ax, ay, az, bx, by, bz) => {
        const a = st.globalToWorld(ax, az);
        const b = st.globalToWorld(bx, bz);
        this.gunplay.enemyTracer(new THREE.Vector3(a.x, ay, a.z), new THREE.Vector3(b.x, by, b.z));
      },
      car: this.drive.driving ? { x: this.drive.driving.x, z: this.drive.driving.z, yaw: this.drive.driving.yaw, speed: this.drive.driving.speed } : null,
      onRam: (dx, dz, mul, by) => this.drive.rammed(dx, dz, mul, by),
    }, true);
    if (pol.stars > (this.stats.maxWanted ?? 0)) this.stats.maxWanted = pol.stars;
    if (pol.stars !== this.lastStars) {
      if (pol.stars > this.lastStars && this.lastStars === 0) this.notify('The police are after you! Get out of sight to lose them.', 'bad');
      else if (pol.stars === 0 && this.lastStars > 0 && this.combat.ko <= 0) this.notify('You lost the police.', 'good');
      this.lastStars = pol.stars;
      this.events.emit('combat', undefined);
    }
  }

  private lastStars = 0;

  /** You knocked out a passer-by: their cash flies into your pockets. */
  onStreetKnockout(cash: number, at: THREE.Vector3): void {
    this.stats.knockouts++;
    audio.play('knockout', { volume: 0.7 });
    if (cash <= 0) return;
    this.effects.coinFlight(at.clone(), () => this.playerPos.clone().setY(1.1), Math.min(12, 3 + Math.round(cash / 60)), () => audio.play('coin', { volume: 0.4 }));
    this.addMoney(cash, 'loot', at.clone().setY(1.8));
    this.stats.looted += cash;
  }

  /** Walls went up or came down on the floor you're looking at. */
  onWallsChanged(n: number, erased: boolean): void {
    this.levels[this.viewFloor]?.floor.walls.rebuild();
    this.items.recompute();
    this.afterLayoutChange();
    if (!erased) this.stats.wallsBuilt = (this.stats.wallsBuilt ?? 0) + n;
    this.renderer.markShadowsDirty(10);
    this.requestSave();
  }

  /** Built walls per floor for saving (undefined when there are none). */
  private wallsSave(): string[] | undefined {
    const w = this.levels.map((l) => l.grid.encodeWalls());
    return w.some((x) => x) ? w : undefined;
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
    // With a gun drawn on the street, clicks are shots.
    if (this.gunplay.drawn && !this.input.isTouch) return;
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
    if (this.player.floor > 0 || g.isOwned(tx, tz)) return g.isWalkable(tx, tz);
    if (tz === FACADE_Z && g.isDoor(tx, tz)) return true;
    // Decorations in the yard out front are solid.
    if (g.inBounds(tx, tz) && tz > FACADE_Z && g.occupant(tx, tz)) return false;
    return this.street.isStreetWalkable(tx, tz);
  };

  /** Standing on the sidewalk in front of your own casino (you can decorate the yard from here). */
  get onHomeFront(): boolean {
    const p = this.player;
    return !this.visit && p.floor === 0 && Math.abs(p.x - CENTER_X) < 16 && p.z > FACADE_Z - 1 && p.z < FACADE_Z + 8;
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
    const car = this.drive.driving;
    if (car) {
      const anchor = () => new THREE.Vector3(this.player.x, 2.4, this.player.z);
      // On your driveway: drive into the garage instead of getting out.
      this.interactTarget = this.house?.garage && this.drive.atGarage(car.x, car.z)
        ? { kind: `carpark${car.uid}`, label: '🅿 Park in your garage', hold: false, anchor, act: () => this.drive.park() }
        : { kind: `carout${car.uid}`, label: 'Get out · W/S drive · A/D steer · Shift boost · C horn', hold: false, anchor, act: () => this.drive.exit() };
      this.handleTarget(dt, this.interactTarget);
      return;
    }
    if (!this.inside && this.player.floor === 0 && this.combat.ko <= 0) {
      const near = this.drive.nearest();
      if (near && near.d < 1.6) {
        const v = near.v;
        const tc = near.traffic;
        const anchor = () => new THREE.Vector3(this.player.x, 2.4, this.player.z);
        const label = v ? (v.owned ? `🚗 Drive your ${v.name}` : '🚗 Get in') : '🚗 Steal this car';
        bestD = near.d;
        target = { kind: `car${v ? v.uid : 't'}`, label, hold: false, anchor, act: () => (v ? this.drive.enter(v) : tc && this.drive.steal(tc)) };
      }
      // Your garage door
      if (!target && this.house && this.drive.playerAtGarage) {
        const h = this.house;
        const cap = garageTier(h.garage)?.cap ?? 0;
        bestD = 1.5;
        target = {
          kind: 'garage', hold: false, anchor: () => new THREE.Vector3(this.player.x, 2.6, this.player.z),
          label: h.garage ? `🅿 Your garage · ${h.parked.length}/${cap} cars` : '🅿 Build a garage here',
          act: () => this.events.emit('garage', undefined),
        };
      }
    }
    const act = this.activity;
    if (act) {
      const ac = act.act.action;
      const anchor = () => new THREE.Vector3(this.player.x, this.player.model.height + 1.1, this.player.z);
      this.interactTarget = ac
        ? { kind: `actdo${act.item.uid}`, label: `${ac.label} · move to stop`, hold: false, anchor, act: () => this.activityAction() }
        : { kind: `actstop${act.item.uid}`, label: 'Get up', hold: false, anchor, act: () => this.stopActivity() };
      this.handleTarget(dt, this.interactTarget);
      return;
    }
    if (!this.visit) {
      for (const it of this.items.items) {
        if (!it.dirty || it.floor !== pf || it.repairClaim !== null) continue;
        const b = it.bounds;
        const d = distToRect(p.x, p.z, b.x0, b.z0, b.x1, b.z1);
        if (d < 1.3 && d < bestD) {
          bestD = d;
          target = {
            kind: 'makeup', label: 'Hold to make up the room', hold: true, anchor: () => new THREE.Vector3(it.cx, it.model.height + 0.6, it.cz),
            act: () => {
              it.dirty = false;
              this.stats.trashCleaned++;
              this.effects.sparkle(it.cx, 1, it.cz, 18, 0xbfe9ff, 1.2);
              audio.play('fixed');
              this.floaters.text(new THREE.Vector3(it.cx, it.model.height + 0.4, it.cz), 'Room ready!', 'good');
              this.gainXp(10);
            },
          };
        }
      }
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
    // Your vault
    if (!target && this.inHouse && this.house) {
      for (const it of this.items.items) {
        if (it.def.kind !== 'vault' || it.floor !== pf) continue;
        const bb = it.bounds;
        if (distToRect(p.x, p.z, bb.x0, bb.z0, bb.x1, bb.z1) > 1.5) continue;
        const h = this.house;
        target = {
          kind: `vault${this.vaultOpen ? 'o' : 'c'}`, label: !h.code ? '🔐 Set your vault code' : this.vaultOpen ? '💰 Use the vault' : '🔐 Open the vault', hold: false,
          anchor: () => new THREE.Vector3(it.cx, it.model.height + 0.5, it.cz),
          act: () => this.events.emit('vault', it),
        };
      }
    }
    // Things to do: sit, nap, punch the bag, play the drums… and practice play at your own games.
    if (!target && !this.tableFocus) {
      let bestUse = 1.25;
      for (const it of this.items.items) {
        if (it.floor !== pf || it.broken) continue;
        const own = !this.visit;
        const a = activityFor((it.def.params?.kit as string | undefined) ?? it.def.id);
        const practice = !a && own && it.isGambling;
        if (!a && !practice) continue;
        if (a?.game === 'slots' && !own) continue;
        const bb = it.bounds;
        const d = distToRect(p.x, p.z, bb.x0, bb.z0, bb.x1, bb.z1);
        if (d >= bestUse) continue;
        bestUse = d;
        target = {
          kind: `use${it.uid}`, label: a ? `${a.label}` : `🎲 ${PRACTICE_LABEL}`, hold: false,
          anchor: () => new THREE.Vector3(it.cx, Math.min(2.4, it.model.height) + 0.6, it.cz),
          act: () => (a ? this.startActivity(it, a) : this.events.emit('practice', it)),
        };
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
      if (lot && lot.id !== this.street.activeId && lot.kind !== 'filler') {
        const l = this.street.map(this.street.activeId, lot.id, p.x, p.z);
        if (Math.abs(l.x - CENTER_X) < 3 && l.z < FACADE_Z + 3.2) {
          const a = this.street.toActive(lot.id, CENTER_X, FACADE_Z + 0.8);
          if (lot.kind === 'shop') {
            const cars = lot.info.style === 'dealer';
            target = {
              kind: `shop${lot.id}`, label: `${cars ? '🚗' : '🔫'} Shop at ${lot.info.look.name}`, hold: false,
              anchor: () => new THREE.Vector3(a.x, 3.6, a.z),
              act: () => (cars ? this.events.emit('dealer', undefined) : this.events.emit('gunshop', undefined)),
            };
          } else {
            const block = this.entryBlock(lot);
            const label = block ? `🚫 ${lot.kind === 'house' ? `${lot.owner}'s house` : lot.info.look.name}`
              : lot.kind === 'me' ? `Back to ${lot.info.look.name}` : lot.id === 'house' ? 'Go into your house' : `Enter ${lot.info.look.name}`;
            target = {
              kind: `door${lot.id}`, label, hold: false,
              anchor: () => new THREE.Vector3(a.x, 3.6, a.z),
              act: () => this.enterLot(lot),
            };
          }
        }
      }
    }
    if (this.photoMode) target = null;
    this.interactTarget = target;
    this.handleTarget(dt, target);
  }

  /** Show the prompt for the nearest thing to do and run it on Space (or hold Space). */
  private handleTarget(dt: number, target: typeof this.interactTarget): void {
    const key = target ? `${target.kind}:${target.label}` : '';
    if (key !== this.lastInteractKey) {
      this.lastInteractKey = key;
      this.holdT = 0;
      this.events.emit('interact', target ? { label: target.label, hold: target.hold } : null);
      this.floaters.prompt(target ? target.anchor : null, target ? `<b>${this.input.isTouch ? '●' : 'Space'}</b> ${target.label}` : '');
    }
    const blocked = this.modalOpen;
    // In a tank, F fires the main gun instead.
    const fKey = !this.drive.driving?.def?.cannon;
    const pressing = !blocked && (this.input.down('Space') || (fKey && this.input.down('KeyF')) || this.actionHeld);
    const pressed = !blocked && (this.input.hit('Space') || (fKey && this.input.hit('KeyF')) || this.actionPressed);
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
    if (this.doorCooldown > 0 || this.player.floor !== 0 || this.drive.driving) return;
    const tx = Math.floor(this.player.x);
    const tz = Math.floor(this.player.z);
    const lot = this.street.doorAt(tx, tz);
    if (lot) {
      if (!this.enterLot(lot)) {
        // Bounced: step back onto the sidewalk in front of that door.
        const l = this.street.map(this.street.activeId, lot.id, this.player.x, this.player.z);
        const back = this.street.toActive(lot.id, l.x, FACADE_Z + 1.3);
        this.player.x = back.x;
        this.player.z = back.z;
        this.player.halt();
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

  /** What you're doing right now (sitting on the sofa, hitting the bag…). */
  activity: { item: PlacedItem; act: Activity; t: number; amb: number; count: number; poseT: number; exit: { x: number; z: number }; swing: number; swingV: number; combo: number; lastHit: number; earned: number } | null = null;

  /** Go and do the thing this item is for. */
  startActivity(item: PlacedItem, act: Activity): void {
    if (act.game === 'slots') {
      this.events.emit('practice', item);
      return;
    }
    if (item.def.params?.kit === 'wardrobe') this.events.emit('wardrobe', undefined);
    this.stopActivity(false);
    this.standUp();
    if (this.build.active) this.build.cancel();
    const yaw = (item.rot * Math.PI) / 2;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const b = item.bounds;
    const half = Math.abs(fx) * ((b.x1 - b.x0) / 2) + Math.abs(fz) * ((b.z1 - b.z0) / 2);
    let x = item.cx;
    let z = item.cz;
    let face = yaw;
    const sit = act.pose === 'sit' || act.pose === 'sitPlay' || act.pose === 'drink';
    const front = { x: item.cx + fx * (half + 0.55), z: item.cz + fz * (half + 0.55) };
    switch (act.spot) {
      case 'sit':
        x -= fx * 0.12;
        z -= fz * 0.12;
        break;
      case 'lie':
        // The body lies back from the feet: start a little forward so it ends up centred.
        x += fx * 0.55;
        z += fz * 0.55;
        break;
      case 'edge':
        x += fx * (half + 0.12);
        z += fz * (half + 0.12);
        face = yaw + Math.PI;
        break;
      case 'front':
        x = front.x;
        z = front.z;
        face = yaw + Math.PI;
        break;
      case 'on':
        break;
    }
    this.select(null);
    this.player.seat = { x, z, yaw: face, sit, height: act.seatY ?? (act.spot === 'lie' ? 0.5 : 0) };
    this.player.playEmote(act.pose, 999);
    this.activity = { item, act, t: 0, amb: 0, count: 0, poseT: 0, exit: front, swing: 0, swingV: 0, combo: 0, lastHit: -9, earned: 0 };
    if (act.lines?.length) this.floaters.bubble(() => this.player.model.root.position.clone().setY(this.player.model.height + 0.9), act.lines[Math.floor(Math.random() * act.lines.length)]);
    audio.play('pop', { volume: 0.5 });
    this.events.emit('activity', undefined);
    if (act.game === 'arcade') this.events.emit('arcade', item);
  }

  /** Get up (or step off) and carry on. */
  stopActivity(emit = true): void {
    const a = this.activity;
    if (!a) return;
    this.activity = null;
    a.item.model.root.rotation.x = 0;
    this.player.seat = null;
    this.player.emote = null;
    const g = this.gridAt(this.player.floor);
    const tx = Math.floor(a.exit.x);
    const tz = Math.floor(a.exit.z);
    const near = g.isWalkable(tx, tz) ? [tx, tz] : g.nearestWalkable(tx, tz);
    if (near) {
      this.player.x = near[0] === tx && near[1] === tz ? a.exit.x : near[0] + 0.5;
      this.player.z = near[0] === tx && near[1] === tz ? a.exit.z : near[1] + 0.5;
    }
    this.player.unstick(g);
    this.player.halt();
    if (emit) this.events.emit('activity', undefined);
  }

  /** Space while you're at it: punch, strum, take a shot… */
  private activityAction(): void {
    const a = this.activity;
    if (!a?.act.action) {
      this.stopActivity();
      return;
    }
    const ac = a.act.action;
    const p = this.player;
    const head = new THREE.Vector3(p.x, p.model.height + 0.6, p.z);
    const it = a.item;
    const at = new THREE.Vector3(it.cx, Math.min(1.6, it.model.height * 0.8), it.cz);
    if (ac.sfx) audio.play(ac.sfx, { pitch: 0.92 + Math.random() * 0.16 });
    if (ac.pose) a.poseT = 1.1;
    a.count += ac.counter === 'points' ? 50 + Math.floor(Math.random() * 950) : 1;
    switch (ac.effect) {
      case 'punch':
        p.model.jab = 1;
        p.model.jabLeft = !p.model.jabLeft;
        a.swingV -= 2.6 + Math.random();
        this.effects.sparkle(at.x, 1.2, at.z, 4, 0xffffff, 0.3);
        this.cam.shake(0.03);
        {
          // The bag pays: a little per punch, more for a quick combo.
          const since = a.t - a.lastHit;
          a.combo = since < 1.2 ? a.combo + 1 : 1;
          const pay = punchPay(this.level, a.combo, since);
          if (pay > 0) {
            a.lastHit = a.t;
            a.earned += pay;
            this.addMoney(pay, 'reward', at.clone().setY(1.9));
            this.stats.earnedPunching = (this.stats.earnedPunching ?? 0) + pay;
          }
        }
        break;
      case 'sparkle':
        this.effects.sparkle(at.x, at.y, at.z, 12, 0xffe08a, 0.6);
        break;
      case 'smoke':
        this.effects.smoke(at.x, at.y + 0.2, at.z, 3);
        break;
      case 'confetti':
        this.effects.confetti(head.x, head.y, head.z, 40, 0.6);
        break;
      case 'bubbles':
        this.effects.sparkle(at.x, at.y, at.z, 16, 0xbfe9ff, 0.9);
        break;
      case 'flash':
        this.effects.sparkle(at.x, 1.4, at.z, 30, 0xffffff, 1.2);
        this.events.emit('flash', undefined);
        break;
      case 'notes':
        this.floaters.text(head, ['♪', '♫', '♬'][Math.floor(Math.random() * 3)], 'good', 1.2, 1.2);
        break;
      case 'hearts':
        this.floaters.text(head, '❤', 'bad', 1.2, 1.2);
        break;
    }
    if (ac.counter) this.floaters.text(head.clone().setY(head.y + 0.3), `${a.count.toLocaleString()} ${ac.counter}`, 'good', 1, 0.6);
    if (ac.lines?.length && Math.random() < 0.6) this.floaters.bubble(() => this.player.model.root.position.clone().setY(this.player.model.height + 0.9), ac.lines[Math.floor(Math.random() * ac.lines.length)]);
    if (ac.counter === 'punches' && a.count % 25 === 0) {
      audio.play('objective');
      this.notify(`${a.count} punches! You're a machine. ${formatMoney(a.earned)} earned on the bag so far.`, 'good');
    }
    if (ac.counter === 'drinks') this.player.model.tipsy = Math.min(1, this.player.model.tipsy + 0.2);
  }

  private updateActivity(dt: number): void {
    const a = this.activity;
    if (!a) return;
    // The thing was sold or moved away: stop.
    if (!this.items.items.includes(a.item) || a.item.floor !== this.player.floor) {
      this.stopActivity();
      return;
    }
    a.t += dt;
    a.poseT = Math.max(0, a.poseT - dt);
    const pose = a.poseT > 0 && a.act.action?.pose ? a.act.action.pose : a.act.pose;
    this.player.playEmote(pose, 999);
    if (a.act.pose === 'run') this.player.model.moveSpeed = 2.4;
    if (a.act.ambient) {
      a.amb -= dt;
      if (a.amb <= 0) {
        a.amb = a.act.ambient.every * (0.8 + Math.random() * 0.4);
        audio.play(a.act.ambient.sfx, { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 });
      }
    }
    // The punching bag swings back on its chain.
    if (a.swing || a.swingV) {
      a.swingV += (-a.swing * 60 - a.swingV * 4) * dt;
      a.swing += a.swingV * dt;
      a.swing = clamp(a.swing, -0.35, 0.35);
      a.item.model.root.rotation.x = a.swing;
      if (Math.abs(a.swing) < 0.001 && Math.abs(a.swingV) < 0.01) a.swing = a.swingV = 0;
    }
    if (a.act.pose === 'sleep' && Math.random() < dt * 0.6) this.floaters.text(new THREE.Vector3(this.player.x, 1.2, this.player.z), 'Z', 'good', 1.6, 1);
    if (a.act.once && a.t >= a.act.once) this.stopActivity();
  }

  /** Recent chat lines (newest last). */
  chat: ChatLine[] = [];
  /** Net hook: send a line to everyone (false when nobody can hear it). */
  chatOut: ((text: string) => boolean) | null = null;
  private lastChat = 0;

  /** Say something to everyone online (it also pops up over your head). */
  sendChat(raw: string): void {
    const text = cleanChat(raw);
    if (!text) return;
    const now = Date.now();
    if (now - this.lastChat < 900) {
      this.addChat({ from: '', text: 'Slow down a little.', t: now, me: false, system: true });
      return;
    }
    this.lastChat = now;
    this.addChat({ from: this.player.name, text, t: now, me: true });
    this.floaters.bubble(() => this.player.model.root.position.clone().setY(this.player.model.height + 0.9), text, 4);
    const heard = this.chatOut?.(text) ?? false;
    if (!heard && !this.chat.some((l) => l.system && now - l.t < 60_000)) {
      this.addChat({ from: '', text: 'Nobody else is online to hear you right now.', t: now, me: false, system: true });
    }
  }

  addChat(line: ChatLine): void {
    this.chat.push(line);
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
    this.events.emit('chat', line);
  }

  /** Practice play: put pretend chips down. */
  chipBet(amount: number): boolean {
    if (amount <= 0 || this.playChips < amount) return false;
    this.playChips -= amount;
    this.events.emit('chips', undefined);
    return true;
  }

  /** Practice play: a round is over (nothing real is won or lost). */
  chipSettle(bet: number, payout: number, item: PlacedItem): void {
    this.playChips += payout;
    const net = payout - bet;
    if (Math.abs(net) >= 1) this.floaters.text(new THREE.Vector3(item.cx, item.model.height + 0.3, item.cz), `${net >= 0 ? '+' : '−'}${Math.abs(Math.round(net)).toLocaleString()} chips`, net >= 0 ? 'good' : 'bad', 1.4);
    this.events.emit('chips', undefined);
    this.requestSave();
  }

  /** Free top-up of practice chips. */
  refillChips(): void {
    this.playChips = Math.max(this.playChips, START_CHIPS);
    this.events.emit('chips', undefined);
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
    let upkeep = this.items.items.reduce((a, i) => a + i.def.upkeep, 0);
    // In the hotel, the buildings you're not standing in still pay their staff and upkeep.
    if (this.hotel && this.site === 'hotel') upkeep += hotelDailyCosts(this.hotel.buildings.filter((b) => b.id !== this.hotelBid).map((b) => b.snap));
    this.money -= wages + upkeep;
    const best = [...this.dayAcc.byItem.entries()].sort((a, b) => b[1] - a[1])[0];
    // The hotel keeps its own books: while you're at the casino it pays its staff here.
    if (this.house && this.site === 'casino') {
      const hc = this.houseDailyCosts();
      upkeep += hc;
      this.money -= hc;
      const interest = vaultInterest(this.house);
      if (interest > 0) {
        this.house.vault += interest;
        addLog(this.house, this.day, 'Interest', interest);
      }
    }
    let hotelNet: number | undefined;
    if (this.hotel && this.site !== 'hotel') {
      const costs = hotelDailyCosts(this.hotel.buildings.map((b) => b.snap));
      this.hotel.bank -= costs;
      hotelNet = Math.round(this.hotelAcc - costs);
      this.hotelAcc = 0;
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
      site: this.site,
    };
    this.history.push(report.profit);
    if (this.history.length > 30) this.history.shift();
    this.dayAcc = { revenue: 0, payouts: 0, sales: 0, visitors: 0, byItem: new Map() };
    this.day++;
    this.events.emit('money', { money: this.money, delta: (hotelNet ?? 0) - (wages + upkeep) });
    this.events.emit('day', report);
    this.events.emit('hotel', undefined);
    if (this.money < 0) this.notify('You are in the red! Wages and upkeep keep draining the bank until you earn it back.', 'bad');
    this.saveNow();
  }

  /** Seconds in a row below 25 fps. */
  private slowFor = 0;
  /** Graphics levels we already suggested leaving this session (don't nag twice). */
  private hinted = new Set<string>();

  /** Running slowly for ~8 seconds in a row: suggest turning the graphics down. */
  private watchFps(span: number): void {
    if (this.state !== 'playing' || this.modalOpen || document.hidden || this.settings.quality === 'low' || this.settings.quality === 'ult') {
      this.slowFor = 0;
      return;
    }
    this.slowFor = this.fps < 25 ? this.slowFor + span : 0;
    if (this.slowFor < 8 || this.hinted.has(this.settings.quality)) return;
    this.slowFor = 0;
    this.hinted.add(this.settings.quality);
    this.events.emit('perfHint', { fps: this.fps });
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
      this.watchFps(this.fpsAcc);
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

  private bankFullT = 0;

  /** Tell the player (now and then) that the bank is full. */
  private bankFull(): void {
    if (this.bankFullT > 0 || this.state !== 'playing' || this.catchingUp) return;
    this.bankFullT = 90;
    this.notify(`${this.site === 'hotel' ? 'The hotel' : 'Your casino'}'s bank is full (${formatMoney(MAX_BANK)}). Move money into your house vault to keep earning.`, 'bad');
  }

  /** An older save over the cap: what doesn't fit goes into the house vault (as far as it holds). */
  private overflowToVault(): void {
    let moved = 0;
    for (const which of ['casino', 'hotel'] as const) {
      const bank = which === 'casino' ? this.money : this.hotel?.bank ?? 0;
      const extra = Math.max(0, Math.round(bank - MAX_BANK));
      if (!extra) continue;
      const h = this.house;
      const cap = vaultTier(h?.tier ?? 0)?.cap ?? 0;
      const fit = h ? Math.max(0, Math.min(extra, cap - h.vault)) : 0;
      if (h && fit > 0) {
        h.vault += fit;
        addLog(h, this.day, `Overflow from the ${which} (bank limit)`, fit);
        moved += fit;
      }
      if (which === 'casino') this.money = MAX_BANK;
      else if (this.hotel) this.hotel.bank = MAX_BANK;
    }
    if (moved > 0 && typeof window !== "undefined") window.setTimeout(() => this.notify(`Banks now hold at most ${formatMoney(MAX_BANK)}: ${formatMoney(moved)} was moved into your house vault.`, 'info'), 1500);
  }

  /** Keep the casino and hotel banks at most MAX_BANK (whatever path the money came in by). */
  private capBanks(): void {
    if (this.money > MAX_BANK) {
      this.money = MAX_BANK;
      this.bankFull();
    }
    if (this.hotel && this.hotel.bank > MAX_BANK) this.hotel.bank = MAX_BANK;
  }

  /** Hotel buildings you're not standing in earn on their estimate from last time. */
  private tickHotel(sim: number): void {
    if (!this.hotel || this.state !== 'playing' || this.catchingUp) return;
    let rate = 0;
    for (const b of this.hotel.buildings) if (!(this.site === 'hotel' && b.id === this.hotelBid)) rate += b.rate;
    const e = rate * sim * this.incomeMult;
    if (!e) return;
    if (this.site === 'hotel') {
      this.money += e;
      this.dayAcc.sales += e;
    } else {
      this.hotel.bank += e;
      this.hotelAcc += e;
    }
  }

  /** The simulation half of a step: guests, staff, machines, the clock. */
  private simulateWorld(sim: number): void {
    const playing = this.state === 'playing';
    if (playing) {
      if (this.parked) this.parked.away += sim;
      this.tickHotel(sim);
      if (this.visit) {
        this.visit.away += sim;
        if (tickRival(this.rival, sim)) this.refreshStreet();
      } else if (this.site === 'house') {
        // At home the casino's clock waits; it catches up (wages, interest) when you go back.
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
    if (playing && !this.visit && this.site !== 'house') this.updateDoor();
  }

  private step(dt: number, render: boolean): void {
    this.bankFullT = Math.max(0, this.bankFullT - dt);
    this.capBanks();
    const sim = this.paused && !this.visit ? 0 : dt * (this.visit ? 1 : this.speed);
    this.time += sim;
    const input = this.input;
    const playing = this.state === 'playing';
    const third = this.cam.mode === 'third' && playing;
    const first = this.cam.mode === 'first' && playing;

    // First person: the mouse is captured while you look around; menus and other views free it.
    if (!first) input.wantLock = false;
    if (input.locked && (!first || this.modalOpen || this.photoMode || this.tableFocus)) input.exitLock();
    if (input.locked) {
      input.pointer.x = this.renderer.size.w / 2;
      input.pointer.y = this.renderer.size.h / 2;
      input.pointer.over = true;
    }
    if (first && sim > 0) {
      const ads = this.cam.fovTarget < 60 ? this.cam.fovTarget / 72 : 1;
      const sens = 0.0024 * (this.settings.lookSens ?? 1) * ads;
      let dx = 0;
      let dy = 0;
      this.cam.aimNdc = null;
      input.wantLock = !input.isTouch && !this.build.active && !this.modalOpen && this.combat.ko <= 0;
      if (input.locked) {
        dx = input.lookDX;
        dy = input.lookDY;
      } else if (input.isTouch && !this.build.active) {
        // Drag anywhere off the joystick to look around.
        dx = input.dragDX * 1.6;
        dy = input.dragDY * 1.6;
      } else if (!input.isTouch && input.pointer.over && !this.build.active && !this.modalOpen && this.combat.ko <= 0) {
        // Mouse not captured: the crosshair stays in the middle and moving the mouse turns
        // the view, just like when it's captured. The (hidden) cursor can still bump into
        // the edge of the screen, so holding it there keeps turning you that way.
        dx = input.freeDX;
        dy = input.freeDY;
        const { w, h } = this.renderer.size;
        const ex = input.pointer.x < 24 ? -1 : input.pointer.x > w - 24 ? 1 : 0;
        const ey = input.pointer.y < 24 ? -1 : input.pointer.y > h - 24 ? 1 : 0;
        const k = (this.settings.lookSens ?? 1) * ads;
        if (ex && Math.abs(input.freeDX) < 2) this.cam.lookYaw -= ex * 2.6 * k * dt;
        if (ey && Math.abs(input.freeDY) < 2) this.cam.pitch = clamp(this.cam.pitch - ey * 1.4 * k * dt, -1.35, 1.35);
      }
      if (this.combat.ko <= 0) {
        this.cam.lookYaw -= dx * sens;
        this.cam.pitch = clamp(this.cam.pitch - dy * sens, -1.35, 1.35);
        if (!input.locked && !input.isTouch) {
          // Arrow keys still turn when the mouse is free.
          if (input.down('ArrowLeft')) this.cam.lookYaw += dt * 2.4;
          if (input.down('ArrowRight')) this.cam.lookYaw -= dt * 2.4;
        }
      }
      // Walk where you look this very frame.
      this.cam.yaw = this.cam.lookYaw + Math.PI;
    }

    // Camera controls
    if (input.wheel && !first) this.cam.zoomBy(Math.exp(input.wheel * 0.0012));
    if (input.pinch !== 1 && !first) this.cam.zoomBy(input.pinch);
    if (playing && sim > 0) {
      if (!third && !first && !this.drive.driving) {
        if (input.hit('KeyQ')) this.cam.rotate(-1);
        if (input.hit('KeyE')) this.cam.rotate(1);
      }
      if (input.hit('KeyV')) this.setCameraMode(this.cam.mode === 'top' ? 'third' : this.cam.mode === 'third' ? 'first' : 'top');
      if (input.hit('Minus') || input.hit('NumpadSubtract')) this.cam.zoomBy(1.15);
      if (input.hit('Equal') || input.hit('NumpadAdd')) this.cam.zoomBy(1 / 1.15);
      if (input.hit('Escape')) {
        if (this.build.active) this.build.cancel();
        else if (this.selection) this.select(null);
      }
      if (!this.build.active) {
        // 1–5: weapon slots. 6–9: emotes.
        for (let k = 0; k < SLOTS; k++) if (input.hit(`Digit${k + 1}`) || input.hit(`Numpad${k + 1}`)) this.useSlot(k);
        if (input.hit('Digit6')) this.player.playEmote('wave', 2);
        if (input.hit('Digit7')) this.player.playEmote('dance', 4);
        if (input.hit('Digit8')) this.player.playEmote('cheer', 2);
        if (input.hit('Digit9')) this.player.playEmote('clap', 2);
      }
    }

    // Driving (before the player, who sits in the car)
    if (playing && sim > 0) {
      this.drive.update(sim);
      this.base.update(sim, this.street.cols, !this.inside);
    } else audio.engine(null);
    // Waypoint: the beacon out in the world, cleared once you get there.
    {
      const wp = playing ? this.waypoint : null;
      const pg = this.street.worldToGlobal(this.player.x, this.player.z);
      const dist = wp ? Math.hypot(wp.x - pg.x, wp.z - pg.z) : 0;
      this.beacon.update(dt, wp, dist);
      if (wp && !this.inside && dist < 7) {
        this.clearWaypoint();
        audio.play('levelup', { volume: 0.5 });
        this.notify(`You've reached ${wp.label === 'Waypoint' ? 'your waypoint' : wp.label}.`, 'good');
      }
    }

    // Player movement
    const canMove = playing && sim > 0 && this.transitionT <= 0 && this.combat.ko <= 0;
    this.transitionT = Math.max(0, this.transitionT - dt);
    if (canMove) {
      let ix = 0;
      let iz = 0;
      if (input.down('KeyW') || input.down('ArrowUp')) iz += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) iz -= 1;
      if (input.down('KeyA') || (!first && input.down('ArrowLeft'))) ix -= 1;
      if (input.down('KeyD') || (!first && input.down('ArrowRight'))) ix += 1;
      if (input.joy.active) {
        ix += input.joy.x;
        iz -= input.joy.y;
      }
      const sprint = input.down('ShiftLeft') || input.down('ShiftRight') || Math.hypot(input.joy.x, input.joy.y) > 0.92;
      // The city is big: you stride out faster on the sidewalks.
      this.player.speedMult = this.inside ? 1 : 1.5;
      // Behind the wheel the keys drive the car, not you.
      if (this.drive.driving) ix = iz = 0;
      // Walking off gets you up from whatever you were doing.
      if (this.activity) {
        if (Math.hypot(ix, iz) > 0.1) this.stopActivity();
        else ix = iz = 0;
      }
      // Aiming down the sights slows you to a careful walk.
      if (first && this.gunplay.aiming) {
        ix *= 0.55;
        iz *= 0.55;
      }
      this.player.update(dt, ix, iz, sprint && !this.gunplay.aiming, this.cam.basis(), this.playerWalk, third, first ? this.cam.lookYaw : null);
    } else {
      this.player.update(dt, 0, 0, false, this.cam.basis(), this.playerWalk, third, first && !this.player.seat && this.combat.ko <= 0 ? this.cam.lookYaw : null);
    }
    if (playing) this.combat.update(dt);
    if (playing) this.updateActivity(dt);
    if (playing && sim > 0) this.updatePolice(sim);
    if (playing) this.gunplay.update(dt);
    if (this.cam.mode !== 'first') this.cam.lookYaw = this.player.yaw;
    this.cam.followYaw = this.player.yaw;
    // In first person you don't see your own head (you'd be looking out through it).
    const ownBody = playing && (!first || !!this.tableFocus);
    this.player.model.root.visible = (ownBody || (first && this.combat.ko > 0)) && !(this.drive.driving && !this.drive.driving.open);
    if (first) {
      const ko = this.combat.ko > 0;
      const st = this.player.seat;
      const eyeY = ko ? 0.35 : st && this.activity?.act.spot === 'lie' ? st.height + 0.35 : st?.sit ? st.height + 0.8 : this.player.model.height + 0.04;
      this.cam.eye.set(this.player.x, eyeY, this.player.z);
      this.cam.bobSpeed = this.player.seat || ko ? 0 : this.player.speed;
      if (ko) this.player.model.root.visible = false;
    }
    this.playerFx?.update(dt, playing && !this.player.seat && ownBody);
    this.playerPos.set(this.player.x, 0, this.player.z);
    const wasInside = this.inside;
    this.inside = this.player.floor > 0 || (this.player.z < FACADE_Z + 0.15 && this.player.z > this.grid.rect.z0 - 1 && Math.abs(this.player.x - CENTER_X) < 16);
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
        if (!this.visit && this.site !== 'house') {
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
    this.building.update(dt, this.cam.yaw, this.cam.low, this.cam.mode === 'first' && !this.tableFocus);
    // Built walls stand to the ceiling; the ones between the camera and what you're looking
    // at drop down (never through your own eyes). Building mode cuts them all down.
    const wallH = this.build.active ? 0.42 : 1;
    const camP = this.renderer.camera.position;
    WALL_CUT.on = this.cam.mode === 'first' && !this.tableFocus ? 0 : this.build.active ? 0 : 1;
    WALL_CUT.face = this.cam.mode === 'top' ? 1 : 0;
    WALL_CUT.focus.set(fx, fz);
    WALL_CUT.toCam.set(camP.x - fx, camP.z - fz);
    if (WALL_CUT.toCam.lengthSq() < 1e-4) WALL_CUT.toCam.set(Math.sin(this.cam.yaw), Math.cos(this.cam.yaw));
    WALL_CUT.toCam.normalize();
    syncWallCut();
    for (const l of this.levels) {
      l.floor.walls.heightTarget = wallH;
      l.floor.walls.update(dt);
    }
    const pg = this.street.worldToGlobal(this.player.x, this.player.z);
    this.street.city.player.x = this.inside ? -9999 : pg.x;
    this.street.city.player.z = pg.z;
    this.street.update(dt, this.player.x, this.player.z, this.inside, sim);
    // Neon pops a little more after dark
    // The sky follows the clock; indoors the casino keeps its own lighting.
    this.sky.set(this.state === 'playing' ? this.clockMinutes : 19.8 * 60, dt);
    this.sky.follow(this.renderer.camera);
    this.street.outskirts.update(dt, this.sky.light.night);
    const indoor = this.inside && this.cam.mode !== 'top' ? 1 : this.inside ? 0.7 : 0;
    this.indoorT = damp(this.indoorT, indoor, 3, dt);
    this.renderer.applySky(this.sky.light, this.indoorT);
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
    return { name: s.name, look: s.look, layout: s.layout, floors: s.floors, paint: s.paint, walls: s.walls, items: s.items, staff: s.staff, rating: s.rating, jackpotPot: s.jackpotPot };
  }

  /** A plain copy of the hotel for saving. */
  private hotelSave(): HotelState | null {
    this.captureHotel();
    return this.hotel ? (JSON.parse(JSON.stringify(this.hotel)) as HotelState) : null;
  }

  private houseSave(): HouseState | null {
    this.captureHouse();
    return this.house ? (JSON.parse(JSON.stringify(this.house)) as HouseState) : null;
  }

  serialize(): SaveData {
    // In the hotel: your casino as you left it, with the clock where it is now.
    if (this.parked) {
      const home = this.parked.home;
      // At home the casino's cash, level and goals stay live (only the hotel has its own).
      const live = this.site === 'house'
        ? { money: Math.round(this.money), xp: Math.round(this.xp), level: this.level, objectives: [...this.doneObjectives], stats: { ...this.stats } }
        : {};
      return {
        ...home,
        ...live,
        house: this.houseSave(),
        guns: { owned: [...this.guns.owned], equipped: this.guns.equipped, slots: [...this.guns.slots], mods: { ...this.guns.mods } },
        playChips: Math.round(this.playChips),
        garage: { owned: [...this.garage.owned], colors: { ...this.garage.colors }, mods: JSON.parse(JSON.stringify(this.garage.mods)) },
        day: this.day,
        dayMinutes: this.dayMinutes,
        player: { ...home.player, look: this.player.appearance, name: this.player.name },
        cosmetics: { owned: [...this.cosmetics.owned], on: [...this.cosmetics.on] },
        hotel: this.hotelSave(),
        rebirths: this.rebirths,
        net: JSON.parse(JSON.stringify(this.net)) as NetState,
        rival: { ...this.rival },
        savedAt: Date.now(),
      };
    }
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
        hotel: this.hotelSave(),
        house: this.houseSave(),
        guns: { owned: [...this.guns.owned], equipped: this.guns.equipped, slots: [...this.guns.slots], mods: { ...this.guns.mods } },
        playChips: Math.round(this.playChips),
        garage: { owned: [...this.garage.owned], colors: { ...this.garage.colors }, mods: JSON.parse(JSON.stringify(this.garage.mods)) },
        rebirths: this.rebirths,
        net: JSON.parse(JSON.stringify(this.net)) as NetState,
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
      walls: this.wallsSave(),
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
      hotel: this.hotelSave(),
      house: this.houseSave(),
      guns: { owned: [...this.guns.owned], equipped: this.guns.equipped, slots: [...this.guns.slots], mods: { ...this.guns.mods } },
        playChips: Math.round(this.playChips),
        garage: { owned: [...this.garage.owned], colors: { ...this.garage.colors }, mods: JSON.parse(JSON.stringify(this.garage.mods)) },
      rebirths: this.rebirths,
      net: JSON.parse(JSON.stringify(this.net)) as NetState,
      savedAt: Date.now(),
    };
  }

  load(s: SaveData): void {
    this.state = 'playing';
    this.visit = null;
    this.street.activeId = 'me';
    // Browser storage came back empty: take the multiplayer bookkeeping from the save.
    const blank = !Object.keys(this.net.owes).length && !Object.keys(this.net.credited).length;
    if (blank && s.net && typeof s.net === 'object') {
      this.net = { ...emptyNet(), ...s.net, creditedEp: { ...(s.net.creditedEp ?? {}) } };
      this.net.ep ||= newNetEpoch();
    }
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
    this.site = 'casino';
    this.hotelBid = null;
    this.building.setGarden(false);
    this.parked = null;
    this.hotelAcc = 0;
    this.hotel = sanitizeHotel(s.hotel, s.look, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
    this.house = sanitizeHouse(s.house, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
    this.overflowToVault();
    this.guns = sanitizeGuns(s.guns);
    this.garage = sanitizeGarage(s.garage);
    this.drive.reset();
    this.playChips = typeof s.playChips === 'number' && Number.isFinite(s.playChips) ? Math.max(0, Math.min(1e12, s.playChips)) : START_CHIPS;
    this.gunplay.reset();
    this.combat.reset();
    this.street.police.reset();
    this.vaultOpen = false;
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

  /** Your crosshair settings (checked). */
  get reticle(): ReticleOpts {
    return (this.settings.reticle = sanitizeReticle(this.settings.reticle));
  }

  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.renderer.setQuality(q);
    // Ult (AFK): crude block people, so hundreds of guests stay cheap to draw.
    CharacterModel.crude = q === 'ult';
    // Everyone already here switches too (square heads only in Ult).
    for (const c of this.customers) c.model.setCrude(CharacterModel.crude);
    for (const w of this.workers) w.model.setCrude(CharacterModel.crude);
    this.street.crowd.setCrude(CharacterModel.crude);
    this.street.crowd.target = q === 'high' ? 30 : q === 'medium' ? 22 : q === 'low' ? 14 : 8;
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
