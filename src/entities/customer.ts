import * as THREE from 'three';
import { Walker } from './walker';
import {
  type Appearance, cheaterAppearance, randomCustomerAppearance, touristAppearance, vipAppearance,
} from './appearance';
import type { PlacedItem, SeatRuntime, SeatUser } from '../items/placedItem';
import type { Outcome } from '../items/types';
import type { GameKind } from '../items/catalog';
import type { World } from '../game/world';
import { SIDEWALK_Z0, SIDEWALK_Z1, GRID_W, DOOR_TILES, CENTER_X } from '../world/grid';
import { chance, pick, pickWeighted, rand, randInt, randomName, skewed } from '../core/rng';
import { clamp, dist } from '../core/math';

export type CustomerType = 'regular' | 'vip' | 'cheater' | 'tourist';

type CState = 'decide' | 'toSeat' | 'seated' | 'wander' | 'idle' | 'toWatch' | 'watch' | 'leave' | 'busted' | 'react';

const GAMBLE_KINDS: GameKind[] = ['slot', 'claw', 'pachinko', 'roulette', 'blackjack', 'poker', 'craps', 'wheel', 'baccarat', 'threecard', 'sicbo', 'videopoker', 'keno'];
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const MOOD_EMOJI = (m: number) => (m > 82 ? '😍' : m > 66 ? '😀' : m > 48 ? '🙂' : m > 32 ? '😐' : m > 18 ? '😒' : '😡');

let nextUid = 1;

export class Customer extends Walker implements SeatUser {
  readonly uid = nextUid++;
  readonly name = randomName();
  wallet: number;
  bank: number;
  readonly startCash: number;
  mood: number;
  thirst = rand(0, 35);
  hunger = rand(0, 35);
  energy = rand(70, 100);
  readonly risk = Math.random();
  visitLeft: number;
  state: CState = 'decide';
  seatItem: PlacedItem | null = null;
  seat: SeatRuntime | null = null;
  roundsLeft = 0;
  lossStreak = 0;
  noOptions = 0;
  thought = 'Just arrived!';
  drinks = 0;
  /** A door guard has spotted this cheater and will stop them at the entrance. */
  turnAway = false;
  greeted = false;
  exposed = false;
  cheatRounds = 0;
  cheatWinnings = 0;
  comped = false;
  exited = false;
  gone = false;
  netResult = 0;
  roundsPlayed = 0;
  private timer = 0.2 + Math.random() * 0.4;
  private thinkT = 6 + Math.random() * 8;
  private waveT = 5;
  private pendingTrash = 0;
  private sparkleT = 0;
  private reactT = 0;
  private reactPose: 'cheer' | 'celebrate' | 'clap' | 'angry' | 'sad' | 'handsUp' | 'wave' | 'think' = 'cheer';
  private seatPose: 'sit' | 'sitPlay' | 'lever' | 'standPlay' | 'drink' | 'idle' = 'idle';
  private playPoseT = 0;
  private watchTarget: PlacedItem | null = null;
  private exitPoint: [number, number];
  private tries = 0;
  readonly prefs: Partial<Record<GameKind, number>> = {};

  constructor(readonly type: CustomerType, spawnX: number, spawnZ: number, look?: Appearance, wealth = 1) {
    super(
      look ?? (type === 'vip' ? vipAppearance() : type === 'cheater' ? cheaterAppearance() : type === 'tourist' ? touristAppearance() : randomCustomerAppearance()),
      spawnX,
      spawnZ,
    );
    const base = (type === 'vip' ? skewed(2600, 0.5) : type === 'tourist' ? skewed(220, 0.4) : skewed(340, 0.55)) * wealth;
    this.wallet = Math.round(clamp(base, 60, 80000));
    this.bank = Math.round(this.wallet * rand(0.2, 1.1));
    this.startCash = this.wallet + this.bank;
    this.mood = type === 'vip' ? rand(55, 70) : rand(55, 72);
    this.visitLeft = type === 'vip' ? rand(260, 480) : rand(170, 340);
    this.speed = rand(1.2, 1.55);
    for (const k of GAMBLE_KINDS) this.prefs[k] = rand(0.55, 1.45);
    if (type === 'vip') {
      this.prefs.roulette = (this.prefs.roulette ?? 1) * 1.6;
      this.prefs.poker = (this.prefs.poker ?? 1) * 1.8;
      this.prefs.blackjack = (this.prefs.blackjack ?? 1) * 1.5;
      this.prefs.baccarat = (this.prefs.baccarat ?? 1) * 2;
      this.prefs.claw = 0.2;
    }
    if (type === 'tourist') {
      this.prefs.slot = (this.prefs.slot ?? 1) * 1.4;
      this.prefs.wheel = (this.prefs.wheel ?? 1) * 1.5;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    this.exitPoint = [clamp(CENTER_X + side * rand(7, 15), 1, GRID_W - 1), SIDEWALK_Z1 + 0.45];
    this.model.root.scale.setScalar(0.01);
    if (type === 'vip') this.setBadge('vip');
  }

  get isCheater(): boolean {
    return this.type === 'cheater';
  }

  get satisfied(): number {
    return this.mood;
  }

  get inside(): boolean {
    return this.floor > 0 || this.z < DOOR_TILES[0][1];
  }

  get moodEmoji(): string {
    return MOOD_EMOJI(this.mood);
  }

  get statusLine(): string {
    switch (this.state) {
      case 'seated':
        return this.seatItem ? `At the ${this.seatItem.def.name}` : 'Sitting';
      case 'toSeat':
        return this.seatItem ? `Heading to the ${this.seatItem.def.name}` : 'Walking';
      case 'watch':
      case 'toWatch':
        return 'Watching the show';
      case 'leave':
        return 'Heading home';
      case 'busted':
        return 'Busted!';
      default:
        return 'Looking around';
    }
  }

  private bubble(w: World, content: string, life = 2.2): void {
    w.floaters.bubble(() => this.headPos, content, life);
  }

  react(pose: Customer['reactPose'], seconds: number): void {
    this.reactPose = pose;
    this.reactT = seconds;
  }

  // ------------------------------------------------------------------ SeatUser

  nextBet(item: PlacedItem): number | null {
    if (this.state !== 'seated' || this.seatItem !== item) return null;
    const kind = item.def.kind;
    if (kind === 'bench') {
      if (this.roundsLeft-- <= 0) {
        this.standUp();
        return null;
      }
      return 0;
    }
    if (kind === 'bar' || kind === 'snack') {
      const price = Math.round(rand(item.minBet, item.maxBet));
      if (this.roundsLeft-- <= 0 || this.wallet < price) {
        this.standUp();
        return null;
      }
      this.wallet -= price;
      return price;
    }
    if (kind === 'atm') {
      if (this.roundsLeft-- <= 0 || this.bank < 10) {
        this.standUp();
        return null;
      }
      const fee = item.minBet;
      this.bank -= fee;
      return fee;
    }
    if (this.roundsLeft <= 0 || this.wallet < item.minBet || this.visitLeft <= 0 || this.mood < 12) {
      this.standUp();
      return null;
    }
    const frac = this.type === 'vip' ? rand(0.05, 0.14) : 0.04 + this.risk * 0.08;
    // A few drinks in, caution goes out the window.
    let bet = this.wallet * frac * rand(0.7, 1.3) * (this.tipsy ? 1.35 : 1);
    bet = clamp(bet, item.minBet, item.maxBet);
    if (bet > 100) bet = Math.round(bet / 10) * 10;
    else if (bet > 20) bet = Math.round(bet / 5) * 5;
    else bet = Math.round(bet);
    bet = Math.max(item.minBet, Math.min(bet, this.wallet));
    if (bet < item.minBet) {
      this.standUp();
      return null;
    }
    this.wallet -= bet;
    this.roundsLeft--;
    return bet;
  }

  roundStarted(item: PlacedItem, _o: Outcome, duration: number): void {
    const k = item.def.kind;
    if (k === 'bar' || k === 'snack') this.seatPose = 'drink';
    else if (k === 'bench') this.seatPose = 'sit';
    else if (k === 'slot') this.seatPose = Math.random() < 0.3 ? 'lever' : 'sitPlay';
    else if (this.seat?.pose === 'sit') this.seatPose = 'sitPlay';
    else this.seatPose = 'standPlay';
    this.playPoseT = k === 'slot' && this.seatPose === 'lever' ? 1.0 : duration;
  }

  roundResult(item: PlacedItem, o: Outcome): void {
    const w = this.world;
    if (!w) return;
    const k = item.def.kind;
    this.seatPose = this.seat?.pose === 'sit' ? 'sit' : 'idle';
    if (k === 'bar') {
      this.thirst = 0;
      this.mood += 7;
      this.drinks++;
      this.pendingTrash += chance(0.6) ? 1 : 0;
      this.model.tipsy = clamp((this.drinks - 2) * 0.5, 0, 1);
      if (this.tipsy) {
        this.bubble(w, '🥴');
        this.thought = pick(['Woo! Best. Casino. EVER! *hic*', 'I feel lucky. REALLY lucky. *hic*', 'One more and I’m betting it all!']);
      } else {
        this.bubble(w, pick(['🍸', '🍹', '🍺', '🥂']));
        this.thought = 'Mmm, great cocktail.';
      }
      return;
    }
    if (k === 'snack') {
      this.hunger = 0;
      this.mood += 6;
      this.pendingTrash += chance(0.7) ? 1 : 0;
      this.bubble(w, pick(['🍔', '🌭', '🍟', '🌮']));
      this.thought = 'That hit the spot!';
      return;
    }
    if (k === 'atm') {
      const amt = Math.round(Math.min(this.bank, rand(80, 260) * (this.type === 'vip' ? 5 : 1)));
      this.bank -= amt;
      this.wallet += amt;
      this.bubble(w, '💵');
      this.thought = 'Reloaded. Let’s go again!';
      return;
    }
    if (k === 'bench') {
      this.energy = 100;
      this.mood += 3;
      this.bubble(w, '😌');
      return;
    }
    this.roundsPlayed++;
    this.wallet += o.payout;
    const net = o.payout - o.bet;
    this.netResult += net;
    if (this.isCheater) {
      this.cheatWinnings += net;
      this.cheatRounds++;
      if (this.cheatRounds >= 3 && !this.exposed) {
        this.exposed = true;
        this.setBadge('cheat');
        this.bubble(w, '😏');
        w.notify(`Suspicious activity at the ${item.def.name}!`, 'bad');
      }
    }
    switch (o.tier) {
      case 'jackpot':
        this.mood += 40;
        this.model.setExpression('excited', 5);
        this.react('celebrate', 3.2);
        this.bubble(w, '🤑', 3);
        this.thought = 'I CAN’T BELIEVE IT! JACKPOT!';
        w.witness(this.x, this.z, 7, 8, this, this.floor);
        this.lossStreak = 0;
        break;
      case 'big':
        this.mood += 22;
        this.model.setExpression('excited', 3);
        this.react('cheer', 2.4);
        this.bubble(w, pick(['🤩', '💰', '🔥']));
        this.thought = 'Huge win! I love this place!';
        w.witness(this.x, this.z, 4, 4, this, this.floor);
        this.lossStreak = 0;
        break;
      case 'win':
        this.mood += k === 'claw' ? 16 : 5;
        this.model.setExpression('happy', 1.6);
        if (k === 'claw') {
          this.bubble(w, '🧸');
          this.thought = 'I won a plushie!';
        } else if (chance(0.3)) this.bubble(w, pick(['😄', '🎉', '✨']), 1.5);
        this.lossStreak = 0;
        break;
      case 'push':
        this.mood += 0.5;
        break;
      default:
        this.mood -= 0.5 + (1 - this.risk) * 0.8;
        this.lossStreak++;
        if (this.lossStreak >= 6 && chance(0.5)) {
          this.model.setExpression('sad', 2);
          this.bubble(w, pick(['😩', '😤', '🙄']));
          this.thought = 'This machine is ice cold...';
          this.roundsLeft = Math.min(this.roundsLeft, 1);
        } else if (chance(0.12)) this.model.setExpression('sad', 1.2);
    }
    // Playing is the entertainment: good machines are fun even on a losing night.
    this.mood += 0.35 * item.fun;
    this.mood = clamp(this.mood, 0, 100);
    if (this.wallet < item.minBet && this.bank > 20 && w.items.items.some((i) => i.def.kind === 'atm' && i.freeSeat())) {
      this.roundsLeft = 0;
    }
  }

  forceLeave(reason: string, moodHit: number): void {
    this.mood = clamp(this.mood - moodHit, 0, 100);
    this.thought = reason;
    if (this.world && moodHit > 5) this.bubble(this.world, '😠');
    this.leaveSeatSilently();
    if (this.state !== 'leave' && this.state !== 'busted') {
      this.state = 'decide';
      this.timer = 0.6;
    }
  }

  // ------------------------------------------------------------------ behaviour

  private world: World | null = null;

  private standUp(): void {
    this.leaveSeatSilently();
    this.state = 'decide';
    this.timer = 0.4 + Math.random() * 0.8;
  }

  private leaveSeatSilently(): void {
    if (this.seatItem) {
      const item = this.seatItem;
      this.seatItem = null;
      item.release(this);
      if (this.seat) {
        // Step out of the machine footprint towards the approach side.
        this.stepOffSeat();
      }
    }
    this.seat = null;
    this.seatPose = 'idle';
  }

  private stepOffSeat(): void {
    const w = this.world;
    const s = this.seat;
    if (!w || !s) return;
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nx = s.tileX + dx;
      const nz = s.tileZ + dz;
      if (this.here(w).isWalkable(nx, nz)) {
        this.x = (this.x + nx + 0.5) / 2;
        this.z = (this.z + nz + 0.5) / 2;
        return;
      }
    }
  }

  leave(reason: string): void {
    const w = this.world;
    this.leaveSeatSilently();
    this.thought = reason;
    this.state = 'leave';
    if (!w) return;
    const [ex, ez] = this.exitPoint;
    if (!this.go(w, 0, Math.floor(ex), Math.floor(ez), [ex, ez])) {
      this.gone = true;
    }
  }

  bust(w: World): number {
    const loot = Math.max(0, Math.round(this.cheatWinnings)) + 150;
    this.leaveSeatSilently();
    this.state = 'busted';
    this.timer = 1.3;
    this.model.setExpression('surprised', 2);
    this.bubble(w, '😱');
    this.setBadge('');
    this.exposed = false;
    this.mood = 0;
    return loot;
  }

  get tipsy(): boolean {
    return this.drinks >= 3;
  }

  /** Sometimes guests say out loud what the casino is missing. */
  private wish(w: World): [string, string] | null {
    if (!chance(0.35)) return null;
    const has = (kind: GameKind) => w.items.items.some((i) => i.def.kind === kind);
    const wishes: [string, string][] = [];
    if (!has('bar')) wishes.push(['🍸', 'I’d kill for a cocktail bar in here.']);
    if (!has('snack') && this.hunger > 40) wishes.push(['🌭', 'No food? Not even a hot dog?']);
    if (!has('blackjack') && !has('roulette') && !has('poker') && !has('craps')) wishes.push(['🃏', 'Slots are fine, but where are the table games?']);
    if (!has('roulette') && this.risk > 0.6) wishes.push(['🎡', 'What I really want is a roulette wheel.']);
    if (!has('bench') && this.energy < 45) wishes.push(['🪑', 'A bench would be nice right about now.']);
    if (!has('stage') && w.rating >= 3) wishes.push(['🎤', 'This place needs some live music!']);
    if (!has('atm') && this.wallet < 60 && this.bank > 60) wishes.push(['🏧', 'Out of cash. Is there an ATM around?']);
    if (this.type === 'vip' && !has('poker') && !w.items.items.some((i) => i.def.jackpot)) wishes.push(['💎', 'Where are the high-stakes games?']);
    return wishes.length ? pick(wishes) : null;
  }

  greet(w: World): number {
    this.greeted = true;
    this.mood = clamp(this.mood + 20, 0, 100);
    this.model.setExpression('happy', 2);
    this.react('wave', 1.6);
    this.bubble(w, '💖');
    this.visitLeft += 90;
    this.thought = 'The manager greeted me personally!';
    return Math.round(clamp(this.wallet * 0.05, 40, 800));
  }

  comp(w: World): void {
    this.comped = true;
    this.mood = clamp(this.mood + 28, 0, 100);
    this.thirst = 0;
    this.model.setExpression('happy', 2);
    this.bubble(w, '🍾');
    this.thought = 'A free drink? What service!';
  }

  witnessed(amount: number): void {
    this.mood = clamp(this.mood + amount, 0, 100);
    if (this.state !== 'seated' && this.state !== 'leave' && chance(0.6)) this.react(chance(0.5) ? 'clap' : 'cheer', 1.6);
    else if (this.state === 'seated' && chance(0.4)) this.model.setExpression('surprised', 1.2);
  }

  private decide(w: World): void {
    if (this.visitLeft <= 0) return this.leave('What a night! Time to head home.');
    if (this.mood < 15) return this.leave('I’ve had enough of this place.');
    if (this.wallet < 2 && this.bank < 10) return this.leave('I’m broke! See you next time.');
    const items = w.items.items;
    const pickService = (kind: GameKind): PlacedItem | null => {
      const opts = items.filter((i) => i.def.kind === kind && !i.broken && i.freeSeat());
      if (!opts.length) return null;
      return opts.reduce((best, i) => (dist(i.cx, i.cz, this.x, this.z) < dist(best.cx, best.cz, this.x, this.z) ? i : best), opts[0]);
    };
    let target: PlacedItem | null = null;
    let rounds = 1;
    if (this.thirst > 60 && (target = pickService('bar'))) rounds = chance(0.3) ? 2 : 1;
    else if (this.hunger > 65 && (target = pickService('snack'))) rounds = 1;
    else if (this.energy < 25 && (target = pickService('bench'))) rounds = 1;
    else if (this.wallet < 30 && this.bank > 20 && (target = pickService('atm'))) rounds = 1;
    else {
      const stage = items.find((i) => i.def.kind === 'stage');
      if (stage && chance(0.12)) {
        this.watchTarget = stage;
        const spot = this.findWatchSpot(w, stage);
        if (spot && this.go(w, stage.floor, spot[0], spot[1])) {
          this.state = 'toWatch';
          this.thought = 'Ooh, a live show!';
          return;
        }
      }
      target = pickWeighted(
        items.filter((i) => i.isGambling && !i.broken && i.minBet <= this.wallet && i.freeSeat()),
        (i) => {
          const pref = this.prefs[i.def.kind] ?? 1;
          const d = dist(i.cx, i.cz, this.x, this.z);
          let s = i.fun * pref * (1 + w.items.appealAt(i.cx, i.cz, i.floor) * 0.08) / (1 + (d + Math.abs(i.floor - this.floor) * 28) * 0.04);
          if (this.type === 'vip') s *= 1 + i.maxBet / 150;
          if (i.minBet > this.wallet * 0.15) s *= 0.35;
          if (i === this.lastItem) s *= 0.35;
          return s * rand(0.6, 1.4);
        },
      );
      if (target) {
        rounds = target.def.shared ? randInt(4, 11) : target.def.kind === 'claw' ? randInt(1, 4) : randInt(7, 20);
        if (this.type === 'vip') rounds = Math.round(rounds * 1.4);
      }
    }
    if (!target) {
      this.noOptions++;
      if (this.noOptions >= 5) return this.leave('Every game was taken all night...');
      this.mood -= 1.5;
      const busy = w.items.items.filter((i) => i.isGambling && i.occupiedCount() > 0);
      if (busy.length && this.spectate(w, pick(busy))) {
        this.thought = 'Waiting for a free machine. Watching the action!';
        return;
      }
      this.thought = w.items.items.some((i) => i.isGambling) ? 'Everything’s taken. Hurry up!' : 'Where are all the games?';
      if (chance(0.5)) this.bubble(w, pick(['🤔', '😒', '⌛']));
      this.wander(w);
      return;
    }
    const seat = target.freeSeat();
    if (!seat) {
      this.wander(w);
      return;
    }
    target.reserve(seat, this);
    if (!this.go(w, target.floor, seat.tileX, seat.tileZ, [seat.x, seat.z])) {
      target.release(this);
      this.tries++;
      if (this.tries > 3) this.leave('I can’t get anywhere in here!');
      else this.wander(w);
      return;
    }
    this.tries = 0;
    this.noOptions = 0;
    this.seatItem = target;
    this.seat = seat;
    this.roundsLeft = rounds;
    this.lastItem = target;
    this.state = 'toSeat';
    this.lossStreak = 0;
  }

  private lastItem: PlacedItem | null = null;

  private findWatchSpot(w: World, stage: PlacedItem): [number, number] | null {
    for (let tries = 0; tries < 20; tries++) {
      const a = rand(-1.2, 1.2) + stage.root.rotation.y;
      const r = rand(2.2, 4.5);
      const x = Math.floor(stage.cx + Math.sin(a) * r);
      const z = Math.floor(stage.cz + Math.cos(a) * r);
      const g = w.gridAt(stage.floor);
      if (g.isWalkable(x, z) && g.isOwned(x, z)) return [x, z];
    }
    return null;
  }

  /** Stand near a busy machine and cheer the players on while waiting. */
  private spectate(w: World, item: PlacedItem): boolean {
    const b = item.bounds;
    for (let tries = 0; tries < 12; tries++) {
      const x = Math.floor(rand(b.x0 - 1.5, b.x1 + 1.5));
      const z = Math.floor(rand(b.z0 - 1.5, b.z1 + 1.5));
      const g = w.gridAt(item.floor);
      if (!g.isOwned(x, z) || !g.isWalkable(x, z)) continue;
      if (this.go(w, item.floor, x, z, [x + rand(0.25, 0.75), z + rand(0.25, 0.75)])) {
        this.watchTarget = item;
        this.state = 'toWatch';
        return true;
      }
    }
    return false;
  }

  private wander(w: World): void {
    // Mostly browse the current floor; now and then check out another one.
    const floor = w.floors > 1 && chance(0.15) ? randInt(0, w.floors - 1) : this.floor;
    const g = w.gridAt(floor);
    const r = g.rect;
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(rand(r.x0, r.x1 + 1));
      const z = Math.floor(rand(floor === 0 ? Math.max(r.z0, r.z1 - 8) : r.z0, r.z1 + 1));
      if (g.isWalkable(x, z) && g.isOwned(x, z) && this.go(w, floor, x, z, [x + rand(0.2, 0.8), z + rand(0.2, 0.8)])) {
        this.state = 'wander';
        return;
      }
    }
    this.state = 'idle';
    this.timer = 2;
  }

  private appear = 0;
  private baseScale = rand(0.93, 1.07);

  update(dt: number, w: World): void {
    this.world = w;
    // Pop in when arriving and shrink away once home
    if (this.state === 'leave' && this.exited && !this.walking) this.appear = Math.max(0, this.appear - dt * 3);
    else if (this.appear < 1) this.appear = Math.min(1, this.appear + dt * 2.5);
    this.model.root.scale.setScalar(Math.max(0.01, this.baseScale * (this.appear < 1 ? easeOut(this.appear) : 1)));
    const seated = this.state === 'seated';
    // Needs drift
    this.thirst += dt * 0.45;
    this.hunger += dt * 0.3;
    this.energy -= dt * (seated ? 0.08 : 0.22);
    if (this.inside) {
      this.visitLeft -= dt;
      // Mood drifts toward what the surroundings deserve: decor lifts it, litter drags it down.
      const appeal = Math.min(w.items.appealAt(this.x, this.z, this.floor), 6);
      const dirt = w.trash.countNear(this.x, this.z, 2.5, this.floor);
      const target = clamp(48 + appeal * 7 - dirt * 6, 5, 95);
      this.mood += (target - this.mood) * 0.012 * dt;
      this.mood += w.stageBoostAt(this.x, this.z, this.floor) * dt;
      if (this.thirst > 85) this.mood -= 0.25 * dt;
      if (this.hunger > 90) this.mood -= 0.2 * dt;
      if (this.energy < 10) this.mood -= 0.2 * dt;
    }
    this.mood = clamp(this.mood, 0, 100);

    // VIP sparkle
    if (this.type === 'vip' && !this.exited) {
      this.sparkleT -= dt;
      if (this.sparkleT <= 0) {
        this.sparkleT = 1.4;
        w.effects.sparkle(this.x, 1.2, this.z, 3, 0xffd24a, 0.8);
      }
    }

    // Littering while walking
    if (this.walking && this.inside) {
      const guard = w.items.litterGuardAt(this.x, this.z, this.floor);
      const p = (0.003 + this.pendingTrash * 0.09) * (1 - guard * 0.9);
      if (Math.random() < p * dt * 4) {
        const tx = Math.floor(this.x);
        const tz = Math.floor(this.z);
        const g = this.here(w);
        if (g.isOwned(tx, tz) && g.isWalkable(tx, tz)) {
          w.trash.add(this.x + rand(-0.2, 0.2), this.z + rand(-0.2, 0.2), this.floor);
          this.pendingTrash = Math.max(0, this.pendingTrash - 1);
        }
      }
    }

    // Happy guests wave when the manager walks by
    this.waveT -= dt;
    if (this.waveT <= 0 && this.inside && this.mood > 62 && (this.state === 'idle' || this.state === 'watch' || this.state === 'wander')) {
      const d = Math.hypot(w.playerPos.x - this.x, w.playerPos.z - this.z);
      if (d < 2.2) {
        this.waveT = rand(25, 45);
        this.faceTowards(w.playerPos.x, w.playerPos.z);
        this.react('wave', 1.4);
        this.bubble(w, pick(['👋', '😄', '🙌']), 1.6);
      }
    }

    // Periodic thought bubble
    this.thinkT -= dt;
    if (this.thinkT <= 0 && this.inside && this.state !== 'leave') {
      this.thinkT = rand(14, 26);
      const dirt = w.trash.countNear(this.x, this.z, 2.5, this.floor);
      let e = this.moodEmoji;
      let wish: [string, string] | null;
      if (dirt >= 2) {
        e = '🤢';
        this.thought = 'Ew, it’s so dirty around here.';
      } else if (this.thirst > 80) {
        e = '🥤';
        this.thought = 'I’m so thirsty...';
      } else if (this.hunger > 85) {
        e = '🍔';
        this.thought = 'I could eat a horse.';
      } else if (this.energy < 20) {
        e = '😴';
        this.thought = 'My feet hurt. Is there a bench?';
      } else if (this.tipsy && chance(0.5)) {
        e = '🥴';
        this.thought = pick(['*hic* ...I love this place.', 'Is the floor moving? *hic*', 'Heyyy, the manager! My best friend!']);
      } else if ((wish = this.wish(w))) {
        e = wish[0];
        this.thought = wish[1];
      } else if (w.items.appealAt(this.x, this.z, this.floor) > 3) {
        this.thought = 'This place looks amazing!';
      }
      if (chance(0.55)) this.bubble(w, e, 2);
    }

    if (this.reactT > 0) {
      this.reactT -= dt;
      this.model.setPose(this.reactPose);
      if (this.state === 'seated') this.syncSeated(dt, true);
      else this.syncModel(dt, this.reactPose);
      return;
    }

    switch (this.state) {
      case 'decide':
        this.timer -= dt;
        if (this.timer <= 0) this.decide(w);
        this.syncModel(dt);
        break;
      case 'toSeat': {
        const r = this.step(dt, w);
        if (r === 'arrived' && this.seatItem && this.seat) {
          if (this.seat.reserved !== this || this.seatItem.broken) {
            this.seatItem.release(this);
            this.seatItem = null;
            this.seat = null;
            this.state = 'decide';
            this.timer = 0.3;
          } else {
            this.x = this.seat.x;
            this.z = this.seat.z;
            this.yaw = this.seat.face;
            this.model.seatHeight = this.seat.seatY;
            this.seatItem.sitDown(this.seat.index, this);
            this.state = 'seated';
            this.seatPose = this.seat.pose === 'sit' ? 'sit' : 'idle';
          }
        } else if (r === 'blocked') {
          this.leaveSeatSilently();
          this.state = 'decide';
          this.timer = 0.5;
        }
        this.syncModel(dt);
        break;
      }
      case 'seated':
        this.syncSeated(dt, false);
        break;
      case 'wander': {
        const r = this.step(dt, w);
        if (r === 'arrived' || r === 'blocked') {
          this.state = 'idle';
          this.timer = rand(1.5, 3.5);
        }
        this.syncModel(dt);
        break;
      }
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'decide';
          this.timer = 0;
        }
        this.syncModel(dt, this.mood < 30 ? 'angry' : this.energy < 20 ? 'sad' : 'idle');
        break;
      case 'toWatch': {
        const r = this.step(dt, w);
        if (r === 'arrived') {
          this.state = 'watch';
          this.timer = this.watchTarget?.def.kind === 'stage' ? rand(12, 24) : rand(6, 12);
          if (this.watchTarget) this.faceTowards(this.watchTarget.cx, this.watchTarget.cz);
        } else if (r === 'blocked') {
          this.state = 'decide';
        }
        this.syncModel(dt);
        break;
      }
      case 'watch':
        this.timer -= dt;
        if (this.watchTarget?.def.kind === 'stage') this.mood += dt * 0.6;
        if (this.timer <= 0 || !this.watchTarget || !w.items.items.includes(this.watchTarget)) {
          this.state = 'decide';
          this.watchTarget = null;
        }
        if (this.watchTarget?.def.kind === 'stage') this.syncModel(dt, Math.floor(w.time / 3 + this.uid) % 3 === 0 ? 'clap' : 'dance');
        else this.syncModel(dt, Math.floor(w.time / 4 + this.uid) % 4 === 0 ? 'clap' : 'idle');
        break;
      case 'leave': {
        if (!this.exited && !this.inside) {
          this.exited = true;
          w.onCustomerExited(this);
        }
        const r = this.step(dt, w);
        if ((r === 'arrived' || r === 'blocked' || r === 'idle') && (this.appear <= 0.02 || !this.exited)) {
          if (!this.exited) {
            this.exited = true;
            w.onCustomerExited(this);
          }
          if (this.appear <= 0.02) {
            this.gone = true;
            w.onCustomerGone(this);
          }
        }
        this.syncModel(dt);
        break;
      }
      case 'busted':
        this.timer -= dt;
        this.syncModel(dt, 'handsUp');
        if (this.timer <= 0) {
          this.run = true;
          this.leave('Busted by the manager!');
        }
        break;
      case 'react':
        this.state = 'decide';
        break;
    }
  }

  private syncSeated(dt: number, reacting: boolean): void {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.yaw;
    if (!reacting) {
      if (this.playPoseT > 0) {
        this.playPoseT -= dt;
        if (this.playPoseT <= 0 && this.seatPose === 'lever') this.seatPose = 'sitPlay';
      }
      const sit = this.seat?.pose === 'sit';
      let pose: Parameters<typeof m.setPose>[0] = this.seatPose === 'idle' ? (sit ? 'sit' : 'idle') : this.seatPose;
      if (!sit && (pose === 'sit' || pose === 'sitPlay')) pose = 'standPlay';
      if (sit && pose === 'standPlay') pose = 'sitPlay';
      m.setPose(pose);
    } else if (this.seat?.pose === 'sit') {
      // Celebrate from the stool: stand up briefly.
      m.setPose(this.reactPose);
    }
    m.update(dt);
    this.headPos.set(this.x, m.height + 0.05, this.z);
  }

  /** World position used for DOM overlays. */
  get anchor(): THREE.Vector3 {
    return this.headPos;
  }
}

/** Guests step out of taxis at the curb a little way down the street. */
export function spawnPoint(): [number, number] {
  const side = Math.random() < 0.5 ? -1 : 1;
  return [clamp(CENTER_X + side * rand(4, 14), 1, GRID_W - 1), rand(SIDEWALK_Z0 + 1.6, SIDEWALK_Z1 + 0.45)];
}
