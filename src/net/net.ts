import * as THREE from 'three';
import type { HotelInfo, MapPlayer } from '../game/game';
import { cleanChat } from '../game/game';
import { roman } from '../game/game';
import { PlayerFx } from '../cosmetics/playerFx';
import { cleanCosmetics, cosmetic, equipped } from '../cosmetics/catalog';
import type { Game } from '../game/game';
import type { Hud } from '../ui/hud';
import { CharacterModel } from '../entities/characterModel';
import { sanitizeAppearance } from '../entities/appearance';
import { migrateSave, sanitizeSnapshot, type CasinoSnapshot, type SaveData } from '../game/save';
import { SIGN_FONTS, type CasinoLook } from '../world/building';
import { CENTER_X, FACADE_Z, type Layout } from '../world/grid';
import type { StreetLot } from '../world/street';
import { h, icon, clear } from '../ui/dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { dampAngle } from '../core/math';
import { Relay } from './relay';
import { decodeGunMods, encodeGunMods, gunDef } from '../game/guns';
import { buildGun } from '../items/models/guns';
import { KO_MAX_LOSS, ROLL_TIME, bountyFor, type RemoteTarget } from '../game/combat';
import { remoteShotEnd } from '../game/gunplay';
import { buildCar, carDef, sanitizeMods } from '../world/vehicles';
import { type HeistRecord, cleanRecords } from '../game/heistRules';
import type { HouseTarget } from '../game/heist';

// Minimal shapes of the platform capabilities this game uses (db, room, user).
interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface QuerySnap {
  docs: DocSnap[];
}
interface DocRef {
  set(d: Record<string, unknown>): Promise<void>;
  get?(): Promise<DocSnap>;
}
interface CollRef {
  doc(id: string): DocRef;
  onSnapshot(next: (s: QuerySnap) => void, err?: (e: { code: string }) => void): () => void;
}
interface Db {
  collection(path: string): CollRef;
  doc?(path: string): DocRef;
}
interface Peer {
  peer: string;
  by: string | null;
  isMe: boolean;
  presence: Record<string, unknown>;
}
interface Room {
  presence(p: Record<string, unknown>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(fn: (c: { peers: readonly Peer[] }) => void, err?: (e: { code: string }) => void): () => void;
}
interface UserCap {
  id(): Promise<string | null>;
}
interface ClaudeUse {
  use(name: string): Promise<unknown>;
}

/**
 * Capabilities to declare when publishing the page as an artifact. Everyone reads every
 * lot and ledger; each player writes only their own `lots/<id>` and `ledger/<id>`.
 * `downloads` lets the Export button save a casino file from inside the viewer.
 */
export const ARTIFACT_CAPABILITIES = {
  db: {
    rules: [
      { path: 'lots', read: 'view', write: 'owner' },
      { path: 'lots/{self}', write: 'interact' },
      { path: 'ledger', read: 'view', write: 'owner' },
      { path: 'ledger/{self}', write: 'interact' },
    ],
  },
  room: {},
  user: {},
  downloads: true,
};

/** How long a blacklist lasts, and how long before you can blacklist that player again. */
export const BAN_MS = 10 * 60 * 1000;
export const BAN_COOLDOWN_MS = 30 * 60 * 1000;
/** Blacklist lengths to pick from (minutes), and the longest allowed. */
export const BAN_CHOICES = [5, 15, 30, 60, 240];
export const BAN_MAX_MIN = 24 * 60;

/** What security charges to keep someone out for `minutes` (longer bans get a discount). */
export function banPrice(minutes: number): number {
  const m = Math.max(1, Math.min(BAN_MAX_MIN, minutes));
  return Math.round(m * 500 * (m >= 60 ? 0.8 : 1));
}

const PID_KEY = 'jackpot-tycoon:pid';

interface LotDoc {
  owner: string;
  since: number;
  snap: CasinoSnapshot | null;
  bans: Record<string, number>;
  info: { look: CasinoLook; layout: Layout; floors: number; cos?: string[]; hotel?: HotelInfo[]; rb?: number; house?: HouseView | null };
  /** The owner's hotel floor plans by building, for walking around in them. */
  hotelSnap?: Record<string, CasinoSnapshot>;
  /** The owner's house floor plan (burglars walk into it). */
  houseSnap?: CasinoSnapshot | null;
  /** Houses this player robbed lately. */
  heists: HeistRecord[];
  /** When the owner last wrote this (epoch ms). */
  updated: number;
}

/** Another player's house as the street shows it, and what a burglar sizes up. */
interface HouseView {
  look: CasinoLook;
  width: number;
  depth: number;
  floors: number;
  /** Vault tier (0 = none) and what's in it. */
  vt: number;
  vm: number;
  /** The last robbery of this house (the owner publishes it so everyone shares the cooldown). */
  rb: HeistRecord | null;
}

interface Remote {
  key: string;
  pid: string;
  name: string;
  model: CharacterModel;
  lookKey: string;
  x: number;
  z: number;
  tx: number;
  tz: number;
  yaw: number;
  floor: number;
  lot: string;
  moving: boolean;
  /** Out on the roads and sidewalks (not inside any building). */
  out: boolean;
  /** Gun in their hand and how many shots they've fired (a change means a muzzle flash). */
  gun: string | null;
  /** Their gun's skin and attachments (encodeGunMods). */
  gm: string;
  shots: number;
  held: THREE.Group | null;
  label: HTMLElement;
  visible: boolean;
  bans: Record<string, number>;
  owes: Record<string, number>;
  /** Id of their running totals (NetState.ep). */
  oe?: string;
  casino: LotDoc['info'] | null;
  since: number;
  fx: PlayerFx;
  rb: number;
  /** Street fights: their health, knocked out, just woke up (can't be hit). */
  hp: number;
  ko: boolean;
  prot: boolean;
  /** Their running totals of damage dealt to you and cash owed to you (undefined = not seen yet). */
  seenHits?: number;
  seenLoot?: number;
  hpEl: HTMLElement;
  nameEl: HTMLElement;
  /** Wanted stars they publish. */
  wl: number;
  /** Chat lines of theirs already shown (by id); undefined until first seen. */
  chatSeen?: Set<string>;
  /** The car they're driving (key = model + colour). */
  carKey: string;
  car: THREE.Object3D | null;
  carOpen: boolean;
  /** Recent positions (their own lot frame, stamped with their clock) for smooth playback. */
  buf: Snap[];
  /** Which lot those positions are in (a change resets the buffer: they went through a door). */
  bufLot: string;
  /** Their clock minus ours, plus the quickest delivery seen (ms). */
  clockOff?: number;
  /** Typical gap between their updates (ms). */
  gap: number;
  /** Speed they're moving at (m/s, smoothed), for walk / run animation. */
  vel: number;
  /** Times they've rolled and reloaded (a change plays it). */
  rolls: number;
  reloading: boolean;
  rollT: number;
  reloadT: number;
  /** Their knockout streak (a bounty from 3), and feed lines / explosions already shown. */
  ks: number;
  feedSeen: Set<string>;
  /** Whose house they're robbing right now ('' = nobody's), whether the alarm went off, and their recent robberies. */
  hz: string;
  al: boolean;
  heists: HeistRecord[];
}

/** One position update from another player. */
interface Snap {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

/**
 * Where another player is at time `t` (their clock): between the two updates around it, a
 * short glide past the newest one if the next is late, never further.
 */
export function sampleSnaps(buf: readonly Snap[], t: number): Snap | null {
  if (!buf.length) return null;
  if (t <= buf[0].t) return buf[0];
  for (let i = 1; i < buf.length; i++) {
    const b = buf[i];
    if (t <= b.t) {
      const a = buf[i - 1];
      const u = (t - a.t) / Math.max(1, b.t - a.t);
      return { t, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: lerpAngle(a.yaw, b.yaw, u) };
    }
  }
  const last = buf[buf.length - 1];
  const prev = buf[buf.length - 2];
  if (!prev) return last;
  // Late: keep going the way they were for up to 250 ms, then wait.
  const over = Math.min(250, t - last.t);
  const dt = Math.max(1, last.t - prev.t);
  const vx = (last.x - prev.x) / dt;
  const vz = (last.z - prev.z) / dt;
  // A long silence (they stopped and nothing changed) is not movement.
  if (dt > 600) return last;
  return { t, x: last.x + vx * over, z: last.z + vz * over, yaw: last.yaw };
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

const tmp = new THREE.Vector3();

/**
 * Multiplayer through the page's shared database and live presence: your casino is
 * published for others to walk into, everyone on the street sees everyone else, money
 * lost at other players' tables is settled through a shared ledger, and owners can
 * blacklist players for a while. Without the platform (local dev, GitHub Pages) the game
 * simply stays single-player with the rival AI.
 */
export class Net {
  pid = '';
  online = false;
  private db: Db | null = null;
  private room: Room | null = null;
  private writable = true;
  private lots = new Map<string, LotDoc>();
  private ledgers = new Map<string, Record<string, number>>();
  /** Each ledger's running-total id (see NetState.ep). */
  private ledgerEps = new Map<string, string>();
  private remotes = new Map<string, Remote>();
  private labelRoot: HTMLElement;
  private presenceT = 0;
  private lastPresence = '';
  private publishT = 5;
  private lastLot = '';
  private ledgerT = 3;
  private lastLedger = '';
  private checkT = 1;
  private streetKey = '';
  /** Damage you've dealt to each player and cash they owe you from knockouts (running totals this session). */
  private hits: Record<string, number> = {};
  private loot: Record<string, number> = {};
  /** Your recent chat lines, sent along with your presence. */
  private chatOut: { i: string; t: string; at: number }[] = [];
  private chatN = 0;
  /** When you last hit each player (to credit you with the knockout). */
  private lastHitAt: Record<string, number> = {};
  /** Burglars whose alarm you've already been warned about. */
  private alarmWarned = new Set<string>();
  status = 'Offline: just you and the rival down the street.';

  constructor(private game: Game, private hud: Hud) {
    this.labelRoot = h('div', { class: 'net-labels' });
    game.floaters.root.appendChild(this.labelRoot);
    game.playerLot = (pid) => this.lotSnapshot(pid);
    game.playerHotel = (pid, bid) => this.lots.get(pid)?.hotelSnap?.[bid] ?? null;
    game.bannedBy = (pid) => this.bannedBy(pid);
    game.houseTarget = (pid) => this.houseTarget(pid);
    game.heistRecords = () => this.allRecords();
    hud.remoteCard = (pid, el) => this.renderCard(pid, el);
    hud.modals.openPlayers = () => this.openPlayers();
    game.combat.remoteTargets = () => this.targets();
    game.chatOut = (text) => {
      this.chatOut.push({ i: `${Date.now().toString(36)}${(this.chatN++).toString(36)}`, t: text, at: Date.now() });
      if (this.chatOut.length > 4) this.chatOut.shift();
      this.presenceT = 0;
      return this.online && this.remotes.size > 0;
    };
    game.combat.onHitRemote = (pid, dmg) => {
      this.hits[pid] = (this.hits[pid] ?? 0) + dmg;
      this.lastHitAt[pid] = Date.now();
      this.presenceT = 0;
    };
    game.combat.onLoot = (pid, amount) => {
      this.loot[pid] = (this.loot[pid] ?? 0) + amount;
      this.presenceT = 0;
    };
    hud.modals.netStatus = () => `${this.status}${this.online ? ` ${this.remotes.size} other ${this.remotes.size === 1 ? 'player is' : 'players are'} online.` : ''}`;
  }

  async start(): Promise<void> {
    const claude = (window as unknown as { claude?: ClaudeUse }).claude;
    if (!claude?.use) {
      // Stand-alone site (GitHub Pages, local dev): relay through a public MQTT broker.
      this.pid = localPid();
      this.game.pid = this.pid;
      this.status = 'Connecting to the street…';
      const relay = new Relay(this.pid);
      relay.onStatus = (up) => {
        this.status = up
          ? 'Connected: everyone playing this site shares one street. Anything you publish (casino, name, look) is public.'
          : 'Reconnecting to the street…';
      };
      await relay.start();
      this.db = relay.db as unknown as Db;
      this.room = relay.room as unknown as Room;
      this.online = true;
      this.db.collection('lots').onSnapshot((snap) => this.onLots(snap));
      this.db.collection('ledger').onSnapshot((snap) => this.onLedger(snap));
      this.room.onPeers(({ peers }) => this.onPeers(peers));
      return;
    }
    const [db, room, user] = await Promise.all([
      claude.use('db').catch(() => null) as Promise<Db | null>,
      claude.use('room').catch(() => null) as Promise<Room | null>,
      claude.use('user').catch(() => null) as Promise<UserCap | null>,
    ]);
    const id = user ? await user.id().catch(() => null) : null;
    this.pid = id ?? localPid();
    this.game.pid = this.pid;
    this.db = id ? db : null;
    this.room = room;
    if (id && db) void this.loadCloud(db, id);
    if (!this.db && !this.room) return;
    this.online = true;
    this.status = 'Connected: casinos from everyone playing this page line the street.';
    if (this.db) {
      this.db.collection('lots').onSnapshot((snap) => this.onLots(snap), () => (this.db = null));
      this.db.collection('ledger').onSnapshot((snap) => this.onLedger(snap), () => undefined);
    }
    if (this.room) {
      this.room.onPeers(({ peers }) => this.onPeers(peers), () => (this.room = null));
    }
  }

  // ------------------------------------------------------------------ incoming

  private onLots(snap: QuerySnap): void {
    this.lots.clear();
    for (const d of snap.docs) {
      if (d.id === this.pid || !d.exists) continue;
      const raw = d.data() ?? {};
      // Casinos nobody has opened in two weeks drop off the street.
      if (typeof raw.updated === 'number' && Date.now() - raw.updated > 14 * 86400_000) continue;
      const snapData = sanitizeSnapshot(raw.snap, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
      if (!snapData) continue;
      this.lots.set(d.id, {
        owner: typeof raw.owner === 'string' ? raw.owner.slice(0, 24) : 'Someone',
        since: typeof raw.since === 'number' ? raw.since : Date.now(),
        snap: snapData,
        bans: cleanNumbers(raw.bans),
        info: { look: snapData.look, layout: snapData.layout, floors: snapData.floors, cos: cleanCosmetics(raw.cos), hotel: hotelInfo(raw.hotel), rb: rebirthsOf(raw.rb), house: houseView(raw.house) },
        hotelSnap: hotelSnaps(raw.hotelSnap),
        houseSnap: raw.houseSnap ? sanitizeSnapshot(raw.houseSnap, SIGN_FONTS.map((f) => f.id), sanitizeAppearance) : null,
        heists: cleanRecords(raw.heists),
        updated: typeof raw.updated === 'number' && Number.isFinite(raw.updated) ? raw.updated : 0,
      });
    }
    this.syncStreet();
  }

  private onLedger(snap: QuerySnap): void {
    this.ledgers.clear();
    for (const d of snap.docs) {
      if (d.id === this.pid || !d.exists) continue;
      const raw = d.data() ?? {};
      this.ledgers.set(d.id, cleanNumbers(raw.owes));
      if (typeof raw.ep === 'string') this.ledgerEps.set(d.id, raw.ep.slice(0, 16));
    }
  }

  private onPeers(peers: readonly Peer[]): void {
    const seen = new Set<string>();
    for (const p of peers) {
      if (p.isMe) continue;
      const pr = p.presence ?? {};
      const pid = typeof pr.pid === 'string' ? pr.pid.slice(0, 80) : '';
      if (!pid || pid === this.pid) continue;
      seen.add(p.peer);
      let r = this.remotes.get(p.peer);
      const look = sanitizeAppearance(pr.look);
      const lookKey = JSON.stringify(look);
      if (!r) {
        const model = new CharacterModel(look);
        this.game.renderer.scene.add(model.root);
        const nameEl = h('span', { class: 'nl-name' });
        const hpEl = h('i', { class: 'nl-hp', hidden: true });
        const label = h('div', { class: 'net-label' }, nameEl, hpEl);
        this.labelRoot.appendChild(label);
        r = {
          key: p.peer, pid, name: 'Player', model, lookKey, x: 0, z: 0, tx: 0, tz: 0, yaw: 0, floor: 0, lot: '', moving: false, out: false, gun: null, gm: '', shots: 0, held: null, label, visible: false,
          bans: {}, owes: {}, casino: null, since: Date.now(), fx: new PlayerFx(model), rb: 0, hp: 100, ko: false, prot: false, hpEl, nameEl, carKey: '', car: null, carOpen: false, wl: 0,
          buf: [], bufLot: '', gap: 120, vel: 0, rolls: -1, reloading: false, rollT: 0, reloadT: 0, ks: 0, feedSeen: new Set(),
          hz: '', al: false, heists: [],
        };
        this.remotes.set(p.peer, r);
      } else if (r.lookKey !== lookKey) {
        r.model.setAppearance(look);
        r.lookKey = lookKey;
      }
      r.pid = pid;
      r.name = typeof pr.nm === 'string' && pr.nm.trim() ? pr.nm.slice(0, 20) : 'Player';
      r.rb = rebirthsOf(pr.rb);
      const lux = cleanCosmetics(pr.cos).map((id) => cosmetic(id)?.icon ?? '').join('');
      const wl = Math.max(0, Math.min(5, Math.round(num(pr.wl))));
      r.wl = wl;
      const ks = Math.max(0, Math.round(num(pr.ks)));
      r.nameEl.textContent = `${r.rb ? `⟳${roman(r.rb)} ` : ''}${r.name}${lux ? ` ${lux}` : ''}${wl ? ` ${'★'.repeat(wl)}` : ''}${ks >= 3 ? ` 💰${formatMoney(bountyFor(ks))}` : ''}`;
      this.readCombat(r, pr);
      this.readCar(r, pr);
      this.readChat(r, pr);
      r.tx = num(pr.x);
      r.tz = num(pr.z);
      r.yaw = num(pr.yaw);
      r.floor = Math.max(0, Math.min(40, Math.round(num(pr.fl))));
      r.lot = typeof pr.lot === 'string' ? pr.lot.slice(0, 80) : '';
      this.bufferSnap(r, num(pr.t));
      r.moving = pr.mv === 1;
      r.out = pr.out === 1 || (pr.out === undefined && r.tz >= FACADE_Z + 0.2);
      const gun = typeof pr.gun === 'string' && gunDef(pr.gun) ? pr.gun : null;
      // Their skin and attachments come along as a short code.
      const gm = gun && typeof pr.gm === 'string' ? pr.gm.slice(0, 24) : '';
      if (gun !== r.gun || gm !== r.gm) {
        r.held?.removeFromParent();
        r.held = null;
        r.gun = gun;
        r.gm = gm;
        const d = gunDef(gun);
        if (d) {
          const held = buildGun(d, decodeGunMods(d, gm), true).group;
          r.held = held;
          r.model.hand.add(held);
        }
        r.model.aim = d ? (d.twoHand ? 2 : 1) : 0;
      }
      const shots = Math.round(num(pr.sh));
      if (shots !== r.shots) {
        if (r.visible && r.gun && shots > r.shots && gunDef(r.gun)?.melee) {
          r.model.swing = 1;
          audio.playAt('whoosh', r.x, r.z, 0.5);
        } else if (r.visible && r.gun && shots > r.shots) {
          const d = gunDef(r.gun);
          const yaw = r.model.root.rotation.y;
          const mx = r.x + Math.sin(yaw) * 0.8;
          const mz = r.z + Math.cos(yaw) * 0.8;
          r.model.recoil = d?.kind === 'rocket' || d?.kind === 'cannon' || d?.kind === 'sniper' ? 1 : 0.6;
          if (d?.flame) {
            this.game.effects.jet(mx, 1.25, mz, Math.sin(yaw), -0.04, Math.cos(yaw), d.range);
            audio.playAt('flame', r.x, r.z, 0.7);
          } else {
            audio.playAt(d?.kind === 'railgun' ? 'rail' : d?.kind === 'launcher' ? 'launch' : d?.kind === 'rocket' ? 'cannon' : d?.kind === 'shotgun' ? 'shotgun' : d?.auto ? 'smg' : 'gunshot', r.x, r.z, 0.7);
            this.game.effects.sparkle(mx, 1.3, mz, 4, 0xffd27a, 0.15);
            // Their shot, as a tracer from their gun the way they face (grenades and rockets show as blasts).
            if (d && !d.projectile) {
              const g = this.game;
              const end = remoteShotEnd(mx, mz, yaw, Math.min(60, d.range), (x, z) => g.street.isOutdoors(x, z));
              g.gunplay.enemyTracer(new THREE.Vector3(mx, 1.3, mz), end, d.tracer);
            }
          }
        }
        r.shots = shots;
      }
      this.readAction(r, pr);
      r.bans = cleanNumbers(pr.bans);
      r.owes = cleanNumbers(pr.owes);
      r.oe = typeof pr.oe === 'string' ? pr.oe.slice(0, 16) : '';
      r.since = num(pr.since) || r.since;
      r.hz = typeof pr.hz === 'string' ? pr.hz.slice(0, 80) : '';
      r.al = pr.al === 1;
      r.heists = cleanRecords(pr.heists);
      const c = pr.casino as Record<string, unknown> | undefined;
      const snap = c ? sanitizeSnapshot({ ...c, items: [], staff: [] }, SIGN_FONTS.map((f) => f.id), sanitizeAppearance) : null;
      r.casino = snap ? { look: snap.look, layout: snap.layout, floors: snap.floors, cos: cleanCosmetics(c?.cos), hotel: hotelInfo(c?.hotel), rb: r.rb, house: houseView(c?.house) } : null;
      r.fx.set(cleanCosmetics(pr.cos));
    }
    for (const [k, r] of this.remotes) {
      if (seen.has(k)) continue;
      r.fx.dispose();
      r.car?.removeFromParent();
      r.model.root.removeFromParent();
      r.model.dispose();
      r.label.remove();
      this.remotes.delete(k);
    }
    this.syncStreet();
  }

  /** Keep their position update (stamped with their clock) for smooth playback. */
  private bufferSnap(r: Remote, sent: number): void {
    const now = Date.now();
    const lotKey = `${r.lot}|${r.floor}`;
    // Through a door or up the elevator: start over (no gliding through walls).
    if (lotKey !== r.bufLot) {
      r.buf = [];
      r.bufLot = lotKey;
    }
    const t = sent > 0 ? sent : now;
    const off = now - t;
    // The quickest delivery we've seen sets the offset; it slowly relaxes in case clocks drift.
    if (r.clockOff === undefined || off < r.clockOff) r.clockOff = off;
    else r.clockOff += (off - r.clockOff) * 0.02;
    const last = r.buf[r.buf.length - 1];
    if (last && t <= last.t) return;
    if (last) r.gap += (Math.min(1000, t - last.t) - r.gap) * 0.2;
    r.buf.push({ t, x: r.tx, z: r.tz, yaw: r.yaw });
    if (r.buf.length > 24) r.buf.shift();
  }

  /**
   * Street fights over presence: everyone publishes running totals of the damage they've
   * dealt to each player and the cash each knockout cost them. You read your own line in
   * everyone else's totals: new damage hurts you, new cash is yours.
   */
  private readCombat(r: Remote, pr: Record<string, unknown>): void {
    const g = this.game;
    const wasKo = r.ko;
    const hp = Math.max(0, Math.min(100, Math.round(num(pr.hp ?? 100))));
    if (hp < r.hp && r.visible) r.model.flinch = 1;
    r.hp = hp;
    r.ko = pr.ko === 1;
    r.prot = pr.pr === 1;
    if (r.ko && !wasKo && Date.now() - (this.lastHitAt[r.pid] ?? 0) < 4000) {
      g.stats.knockouts++;
      g.combat.landed(false, true, r.name);
      const bounty = bountyFor(r.ks);
      if (bounty > 0) {
        g.addMoney(bounty, 'reward', g.player.model.root.position.clone().setY(2));
        audio.play('jackpot');
        g.notify(`You ended ${r.name}'s ${r.ks}-knockout streak and claimed the ${formatMoney(bounty)} bounty!`, 'good');
      } else g.notify(`You knocked out ${r.name}!`, 'good');
    }
    const hits = cleanNumbers(pr.hits)[this.pid] ?? 0;
    if (r.seenHits === undefined || hits < r.seenHits) r.seenHits = hits;
    else if (hits > r.seenHits) {
      const dmg = Math.min(400, hits - r.seenHits);
      r.seenHits = hits;
      // Only shots fired out on the street, from close enough to reach you, count.
      if ((r.out || this.fighting(r)) && r.visible && Math.hypot(r.x - g.player.x, r.z - g.player.z) < 150) g.combat.damage(dmg, r.pid, r.name, r.x, r.z);
    }
    const loot = cleanNumbers(pr.loot)[this.pid] ?? 0;
    if (r.seenLoot === undefined || loot < r.seenLoot) r.seenLoot = loot;
    else if (loot > r.seenLoot) {
      const amount = Math.min(KO_MAX_LOSS, loot - r.seenLoot);
      r.seenLoot = loot;
      g.combat.loot(Math.round(amount), r.name);
    }
  }

  /**
   * Their action: dodge rolls and reloads (animated on their character), their knockout
   * streak (a bounty), their knockouts (into your kill feed) and the explosions they set off.
   */
  private readAction(r: Remote, pr: Record<string, unknown>): void {
    const g = this.game;
    const rolls = Math.round(num(pr.rl));
    if (r.rolls >= 0 && rolls > r.rolls && r.visible) {
      r.rollT = ROLL_TIME;
      audio.playAt('roll', r.x, r.z, 0.6);
    }
    r.rolls = rolls;
    r.reloading = pr.rld === 1;
    r.ks = Math.max(0, Math.min(99, Math.round(num(pr.ks))));
    const first = r.feedSeen.size === 0 && !r.feedSeen.has('#');
    r.feedSeen.add('#');
    const kos = Array.isArray(pr.kos) ? pr.kos.slice(-4) : [];
    for (const k of kos) {
      if (!k || typeof k !== 'object') continue;
      const o = k as Record<string, unknown>;
      const id = typeof o.i === 'string' ? `k${o.i.slice(0, 12)}` : '';
      if (!id || r.feedSeen.has(id)) continue;
      r.feedSeen.add(id);
      if (first) continue;
      const v = cleanChat(o.v).slice(0, 20) || 'someone';
      const w = cleanChat(o.w).slice(0, 24);
      // Your own knockout is already in the feed (from your side).
      if (v !== g.player.name) g.combat.addFeed(`${r.name} ➜ ${v}${w ? ` · ${w}` : ''}`, false);
    }
    const booms = Array.isArray(pr.bx) ? pr.bx.slice(-6) : [];
    for (const b of booms) {
      if (!b || typeof b !== 'object') continue;
      const o = b as Record<string, unknown>;
      const id = typeof o.i === 'string' ? `b${o.i.slice(0, 12)}` : '';
      if (!id || r.feedSeen.has(id)) continue;
      r.feedSeen.add(id);
      if (first) continue;
      const w = g.street.globalToWorld(num(o.x), num(o.z));
      if (Math.hypot(w.x - g.player.x, w.z - g.player.z) > 160) continue;
      g.effects.explosion(w.x, 0.6, w.z, Math.max(0.5, Math.min(1.6, num(o.r) / 5)));
      audio.playAt('explosion', w.x, w.z, 1.3);
    }
    if (r.feedSeen.size > 60) r.feedSeen = new Set(['#', ...[...r.feedSeen].slice(-30)]);
  }

  /** New chat lines from another player: into the chat box and over their head. */
  private readChat(r: Remote, pr: Record<string, unknown>): void {
    const list = Array.isArray(pr.chat) ? pr.chat.slice(-6) : [];
    const first = !r.chatSeen;
    r.chatSeen ??= new Set();
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const id = typeof (m as { i?: unknown }).i === 'string' ? (m as { i: string }).i.slice(0, 24) : '';
      const text = cleanChat((m as { t?: unknown }).t);
      if (!id || !text || r.chatSeen.has(id)) continue;
      r.chatSeen.add(id);
      // Lines that were already there when they came online are old news.
      if (first) continue;
      this.game.addChat({ from: r.name, text, t: Date.now(), me: false });
      if (r.visible) {
        const model = r.model;
        this.game.floaters.bubble(() => (r.visible ? model.root.position.clone().setY(model.root.position.y + model.height + 0.9) : null), text, 4);
      }
    }
    if (r.chatSeen.size > 50) r.chatSeen = new Set([...r.chatSeen].slice(-20));
  }

  /** Show the car another player is driving under them. */
  private readCar(r: Remote, pr: Record<string, unknown>): void {
    const c = pr.car as { k?: unknown; c?: unknown; m?: unknown } | null | undefined;
    const def = c && typeof c.k === 'string' ? carDef(c.k) : null;
    const key = c ? `${def?.id ?? 't'}|${typeof c.c === 'number' ? c.c : 0}|${JSON.stringify(c.m ?? null).slice(0, 400)}` : '';
    if (key === r.carKey) return;
    r.carKey = key;
    r.car?.removeFromParent();
    r.car = null;
    r.carOpen = false;
    if (!c) return;
    const color = typeof c.c === 'number' && Number.isFinite(c.c) ? Math.max(0, Math.min(0xffffff, c.c)) : 0x9aa0ab;
    const m = def ? buildCar(def, color, c.m ? { ...sanitizeMods(def, c.m), color } : undefined) : buildCar(carDef('hatch')!, 0x9aa0ab);
    r.car = m.root;
    r.carOpen = m.open;
    this.game.renderer.scene.add(m.root);
  }

  /** Other players you could shoot right now: out on the street, awake, not just woken up. */
  private targets(): RemoteTarget[] {
    const out: RemoteTarget[] = [];
    for (const r of this.remotes.values()) {
      if (!r.visible || r.ko || r.prot) continue;
      // Out on the street, or in the same house as you while a heist is going down there.
      if (!(r.out && r.floor === 0) && !this.fighting(r)) continue;
      out.push({ pid: r.pid, name: r.name, x: r.x, z: r.z, y: r.model.root.position.y, height: r.model.height });
    }
    return out;
  }

  // ------------------------------------------------------------------ cloud save

  /** Your whole save, kept in your private slot of the page's database (artifact viewer only). */
  private cloudRef: DocRef | null = null;
  /** The newest save found in the cloud when the game opened. */
  cloudSave: SaveData | null = null;
  /** Called once a cloud save has been read (so the title screen can offer Continue). */
  onCloud: ((s: SaveData) => void) | null = null;
  private cloudPending: SaveData | null = null;
  private cloudLast = '';
  private cloudT = 0;
  private cloudBusy = false;

  private async loadCloud(db: Db, id: string): Promise<void> {
    const ref = db.doc ? db.doc(`data/users/${id}/save`) : db.collection(`data/users/${id}`).doc('save');
    this.cloudRef = ref;
    try {
      const snap = await ref.get?.();
      const raw = snap?.exists ? snap.data() : undefined;
      if (raw && typeof raw.json === 'string') {
        const s = migrateSave(JSON.parse(raw.json));
        if (s) {
          this.cloudSave = s;
          this.cloudLast = raw.json;
          this.onCloud?.(s);
        }
      }
    } catch {
      /* no cloud copy yet (or unreadable): local storage still works */
    }
    if (this.cloudPending) this.cloudT = 0;
  }

  /** Queue a save for the cloud; it's written at most every 15 seconds. */
  pushCloud(s: SaveData, now = false): void {
    this.cloudPending = s;
    if (now) void this.flushCloud();
  }

  private async flushCloud(): Promise<void> {
    const s = this.cloudPending;
    if (!s || !this.cloudRef || this.cloudBusy) return;
    this.cloudPending = null;
    let json = JSON.stringify(s);
    if (json.length > 240_000) json = JSON.stringify({ ...s, trash: [], history: [] });
    if (json === this.cloudLast || json.length > 250_000) return;
    this.cloudBusy = true;
    try {
      await this.cloudRef.set({ json, t: s.savedAt ?? Date.now() });
      this.cloudLast = json;
      this.cloudSave = s;
    } catch {
      this.cloudPending ??= s;
    } finally {
      this.cloudBusy = false;
    }
  }

  /** Every published casino (and every online player's casino) joins the street. */
  private syncStreet(): void {
    const online = new Set([...this.remotes.values()].map((r) => r.pid));
    const lots: StreetLot[] = [];
    const hotels: StreetLot[] = [];
    const tag = (owner: string, rb: number | undefined) => `${rb ? `REBIRTH ${roman(rb)} · ` : ''}${owner.toUpperCase()}'S PLACE`;
    const addHotel = (pid: string, owner: string, hs: HotelInfo[] | undefined, on: boolean) => {
      (hs ?? []).forEach((h, i) => {
        hotels.push({
          id: `${pid}~hotel:${h.bid}`, kind: 'hotel', hotelOf: pid, owner, order: i, online: on,
          info: {
            look: h.look, width: h.width, depth: h.depth, floors: h.floors, style: h.kind === 'garden' ? 'garden' : 'hotel',
            tagline: h.kind === 'garden' ? 'POOL · CABANAS · TIKI BAR' : `${'★'.repeat(h.stars)} HOTEL`,
          },
        });
      });
    };
    const addHouse = (pid: string, owner: string, hv: HouseView | null | undefined, on: boolean) => {
      if (!hv) return;
      hotels.push({
        id: `${pid}~house`, kind: 'house', houseOf: pid, owner, order: 0, online: on,
        info: { look: hv.look, width: hv.width, depth: hv.depth, floors: hv.floors, style: 'house', tagline: '' },
      });
    };
    for (const [pid, l] of this.lots) {
      // Live presence beats the stored copy (cosmetics, hotel or rebirths changed since the last save).
      const live = [...this.remotes.values()].find((r) => r.pid === pid)?.casino;
      lots.push({
        id: pid, kind: 'player', owner: l.owner, order: l.since, online: online.has(pid),
        info: {
          look: l.info.look, width: l.info.layout.width, depth: l.info.layout.depth, floors: l.info.floors, tagline: tag(l.owner, live?.rb ?? l.info.rb),
          cos: live?.cos ?? l.info.cos ?? [],
        },
      });
      addHotel(pid, l.owner, live ? live.hotel : l.info.hotel, online.has(pid));
      addHouse(pid, l.owner, live ? live.house : l.info.house, online.has(pid));
    }
    // Players who can't publish still show their casino on the street while they're online.
    for (const r of this.remotes.values()) {
      if (this.lots.has(r.pid) || !r.casino || lots.some((l) => l.id === r.pid)) continue;
      lots.push({
        id: r.pid, kind: 'player', owner: r.name, order: r.since, online: true,
        info: { look: r.casino.look, width: r.casino.layout.width, depth: r.casino.layout.depth, floors: r.casino.floors, tagline: tag(r.name, r.rb), cos: r.casino.cos ?? [] },
      });
      addHotel(r.pid, r.name, r.casino.hotel, true);
      addHouse(r.pid, r.name, r.casino.house, true);
    }
    lots.push(...hotels);
    const key = JSON.stringify(lots);
    if (key === this.streetKey) return;
    this.streetKey = key;
    this.game.extraLots = lots;
    this.game.refreshStreet();
    // If the casino you're in vanished from the street, head home.
    const v = this.game.visit?.lot;
    if (v && (v.kind === 'player' || (v.kind === 'hotel' && v.hotelOf !== 'me')) && !this.game.street.get(v.id)) this.game.returnHome(true);
  }

  // ------------------------------------------------------------------ queries used by the game

  private lotSnapshot(pid: string): CasinoSnapshot | null {
    return this.lots.get(pid)?.snap ?? null;
  }

  /** Every robbery the street knows of: robbers' own records and victims' last robbery (deduplicated). */
  private allRecords(): HeistRecord[] {
    const out = new Map<string, HeistRecord>();
    const add = (r: HeistRecord | null | undefined) => {
      if (r && !out.has(r.i)) out.set(r.i, r);
    };
    for (const l of this.lots.values()) {
      l.heists.forEach(add);
      add(l.info.house?.rb);
    }
    for (const r of this.remotes.values()) {
      r.heists.forEach(add);
      add(r.casino?.house?.rb);
    }
    return [...out.values()];
  }

  /**
   * Another player's house as a heist target: its floor plan (from their lot), the vault
   * (live from their presence when they're online), and whether they're online. Robberies
   * published since the owner last wrote their copy haven't come out of it yet: count them off.
   */
  private houseTarget(pid: string): HouseTarget | null {
    const l = this.lots.get(pid);
    const r = [...this.remotes.values()].find((x) => x.pid === pid);
    const snap = l?.houseSnap;
    const hv = r?.casino?.house ?? l?.info.house;
    if (!snap || !hv) return null;
    const since = r?.casino?.house ? Date.now() - 15_000 : l?.updated ?? 0;
    let vault = hv.vm;
    const seen = new Set<string>();
    for (const rec of [...this.allRecords(), ...cleanRecords(this.game.net.heists ?? [])]) {
      if (rec.v !== pid || rec.t <= since || seen.has(rec.i)) continue;
      seen.add(rec.i);
      vault -= rec.a;
    }
    return { pid, owner: r?.name ?? l?.owner ?? 'Someone', snap, vault: Math.max(0, vault), tier: hv.vt, online: !!r };
  }

  /** Is this player in the same indoor fight as you: robbing your house, or the owner of the house you're robbing? */
  private fighting(r: Remote): boolean {
    const g = this.game;
    const lotId = this.localLot(r.lot);
    if (g.heist && !g.heist.over) return r.pid === g.heist.target.pid && lotId === g.street.activeId && r.floor === g.player.floor;
    return g.inHouse && r.hz === this.pid && lotId === 'house' && r.floor === g.player.floor;
  }

  /**
   * Your house's side of heists: robberies published by burglars come out of your vault, and
   * anyone breaking in right now is an intruder (the alarm warns you if you have one).
   */
  private watchHouse(): void {
    const g = this.game;
    const mine = this.allRecords().filter((r) => r.v === this.pid);
    if (mine.length) g.applyRobberies(mine);
    const intruders: string[] = [];
    for (const r of this.remotes.values()) {
      if (r.hz !== this.pid) {
        this.alarmWarned.delete(r.pid);
        continue;
      }
      if (this.localLot(r.lot) === 'house') intruders.push(r.pid);
      if (r.al && !this.alarmWarned.has(r.pid)) {
        this.alarmWarned.add(r.pid);
        audio.play('alarm');
        g.notify(`🚨 Your house alarm is going off: ${r.name} is breaking in! Get home (J) and stop them: while you're online they can take up to half your vault.`, 'bad');
      }
    }
    if (intruders.join() !== g.intruders.join()) {
      if (intruders.length && g.inHouse) g.notify(`🦹 ${intruders.length === 1 ? 'A burglar is' : 'Burglars are'} in your house! Your guns work in here: defend your vault.`, 'bad');
      g.intruders = intruders;
      g.events.emit('heist', undefined);
    }
  }

  /** Until when (epoch ms) this owner keeps you out; 0 if you're welcome. */
  bannedBy(owner: string): number {
    let until = this.lots.get(owner)?.bans[this.pid] ?? 0;
    for (const r of this.remotes.values()) if (r.pid === owner) until = Math.max(until, r.bans[this.pid] ?? 0);
    return until;
  }

  /**
   * Blacklist another player from your casino, hotel and house for a while. No reason
   * needed, no cooldown: pick a time, or blacklist them again to change it.
   */
  ban(pid: string, name: string, minutes = BAN_MS / 60000): boolean {
    const now = Date.now();
    const net = this.game.net;
    const price = banPrice(minutes);
    if (this.game.money < price) {
      audio.play('error');
      this.game.notify(`Blacklisting ${name} for that long costs ${formatMoney(price)}. You don't have enough.`, 'bad');
      return false;
    }
    this.game.spend(price, 'upkeep');
    net.bans[pid] = now + Math.max(1, Math.min(BAN_MAX_MIN, minutes)) * 60000;
    delete net.banCooldown[pid];
    audio.play('bust');
    this.game.notify(`${name} is blacklisted from your casino and hotel for ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`} (${formatMoney(price)} to security). They're walked out.`, 'good');
    this.publishT = 0;
    this.presenceT = 0;
    this.lastPresence = '';
    this.game.requestSave();
    return true;
  }

  /** Let a blacklisted player back in early. */
  unban(pid: string, name: string): void {
    const net = this.game.net;
    delete net.bans[pid];
    delete net.banCooldown[pid];
    audio.play('click');
    this.game.notify(`${name} is welcome again.`, 'info');
    this.publishT = 0;
    this.presenceT = 0;
    this.lastPresence = '';
    this.game.requestSave();
  }

  /** Everyone you could blacklist: players online now and owners of casinos on the street. */
  private knownPlayers(): { pid: string; name: string; online: boolean; where: string }[] {
    const out = new Map<string, { pid: string; name: string; online: boolean; where: string }>();
    for (const r of this.remotes.values()) out.set(r.pid, { pid: r.pid, name: r.name, online: true, where: this.whereOf(r) });
    for (const [pid, l] of this.lots) if (!out.has(pid)) out.set(pid, { pid, name: l.owner, online: false, where: 'Offline' });
    for (const pid of Object.keys(this.game.net.bans)) if (!out.has(pid)) out.set(pid, { pid, name: 'Player', online: false, where: 'Offline' });
    return [...out.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  private whereOf(r: Remote): string {
    const g = this.game;
    const lotId = this.localLot(r.lot);
    return r.out ? 'Out on the street' : lotId === 'me' ? 'In your casino' : lotId.startsWith('hotel:') ? 'In your hotel' : lotId === 'house' ? 'At your house' : lotId.endsWith('~house') ? 'At home' : `At ${g.street.get(lotId)?.info.look.name ?? 'another casino'}`;
  }

  /** Blacklist controls: pick how long. */
  private banControls(pid: string, name: string, onChange: () => void): HTMLElement {
    const g = this.game;
    const now = Date.now();
    const until = g.net.bans[pid] ?? 0;
    const row = h('div', { class: 'ban-row' });
    if (until > now) {
      row.append(
        h('span', { class: 'chip bad', text: `🚫 Blacklisted · ${Math.ceil((until - now) / 60000)} min left` }),
        h('button', { class: 'btn small', text: 'Lift ban', onClick: () => { this.unban(pid, name); onChange(); } }),
      );
    }
    for (const m of BAN_CHOICES) {
      row.appendChild(h('button', {
        class: 'btn small danger', text: `${m >= 60 ? `${m / 60} h` : `${m} min`} · ${formatMoney(banPrice(m))}`, title: `Blacklist ${name} for ${m} minutes (costs ${formatMoney(banPrice(m))})`,
        disabled: g.money < banPrice(m),
        onClick: () => { this.ban(pid, name, m); onChange(); },
      }));
    }
    return row;
  }

  /** Menu → Players: see who's around and blacklist anyone, any time. */
  openPlayers(): void {
    const body = h('div', { class: 'stack' });
    const render = () => {
      clear(body);
      body.appendChild(h('p', { class: 'muted small', text: 'Blacklist anyone, for any reason (or none). Your security charges for it: the longer the ban, the more it costs. They’re walked out of your casino, hotel and house and can’t come back in until the time runs out. Lifting it is free.' }));
      const list = this.knownPlayers();
      if (!list.length) {
        body.appendChild(h('p', { class: 'muted', text: this.online ? 'Nobody else is here right now.' : 'You’re offline: other players show up here when you’re connected.' }));
        return;
      }
      for (const p of list) {
        body.appendChild(h('div', { class: 'player-row' },
          h('div', {}, h('b', { text: p.name }), h('span', { class: `muted small${p.online ? ' pos' : ''}`, text: ` · ${p.online ? '● ' : ''}${p.where}` })),
          this.banControls(p.pid, p.name, render),
        ));
      }
    };
    render();
    const t = window.setInterval(render, 15000);
    this.hud.modals.open('Players & blacklist', body, { onClose: () => window.clearInterval(t) });
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const g = this.game;
    if (g.state !== 'playing') {
      for (const r of this.remotes.values()) {
        r.model.root.visible = false;
        r.label.hidden = true;
      }
      g.remotes = [];
      g.mapPlayers = [];
      return;
    }
    this.updateRemotes(dt);
    if (!this.online) return;
    this.presenceT -= dt;
    if (this.presenceT <= 0) {
      this.presenceT = 0.12;
      void this.sendPresence();
    }
    this.cloudT -= dt;
    if (this.cloudT <= 0 && this.cloudPending) {
      this.cloudT = 15;
      void this.flushCloud();
    }
    this.publishT -= dt;
    if (this.publishT <= 0) {
      this.publishT = 20;
      void this.publishLot();
    }
    this.ledgerT -= dt;
    if (this.ledgerT <= 0) {
      this.ledgerT = 4;
      void this.publishLedger();
    }
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1;
      this.creditVisitors();
      this.checkBanned();
      this.watchHouse();
      // Expired bans drop off.
      const now = Date.now();
      for (const [k, v] of Object.entries(g.net.bans)) if (v < now) delete g.net.bans[k];
    }
  }

  /** Where the manager stands, in the street's shared frame of reference. */
  private presenceData(): Record<string, unknown> {
    const g = this.game;
    const p = g.player;
    const act = g.street.activeId;
    const lot = act === 'me' ? this.pid : act.startsWith('hotel:') || act === 'house' ? `${this.pid}~${act}` : act;
    const bans: Record<string, number> = {};
    for (const [k, v] of Object.entries(g.net.bans)) if (v > Date.now()) bans[k] = v;
    const data: Record<string, unknown> = {
      pid: this.pid,
      nm: p.name.slice(0, 20),
      lot,
      fl: p.floor,
      x: Math.round((p.x - CENTER_X) * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      yaw: Math.round(p.yaw * 100) / 100,
      mv: p.moving ? 1 : 0,
      out: g.inside ? 0 : 1,
      gun: g.gunplay.drawn ? g.guns.equipped : null,
      gm: g.gunplay.drawn && g.gunplay.def ? encodeGunMods(g.gunplay.def.mods) : undefined,
      sh: g.gunplay.shots,
      rl: g.combat.rolls,
      rld: g.gunplay.reloading > 0 ? 1 : 0,
      ks: g.combat.streak,
      kos: g.combat.kos.map((k) => ({ i: k.i, v: k.v, w: k.w })),
      bx: g.gunplay.booms.map((b) => ({ i: b.i, x: b.x, z: b.z, r: b.r })),
      hp: Math.round(g.combat.hp),
      ko: g.combat.ko > 0 ? 1 : 0,
      pr: g.combat.protect > 0 ? 1 : 0,
      wl: g.street.police.stars,
      hz: g.heist && !g.heist.over ? g.heist.target.pid : undefined,
      al: g.heist?.alarmed ? 1 : undefined,
      heists: cleanRecords(g.net.heists ?? []),
      car: g.drive.driving ? { k: g.drive.driving.def?.id ?? 't', c: g.drive.driving.color, m: g.drive.driving.mods ? { ...g.drive.driving.mods, engine: 0, turbo: 0, tires: 0, nitro: 0 } : undefined } : null,
      chat: this.chatOut.filter((m) => Date.now() - m.at < 120_000).map((m) => ({ i: m.i, t: m.t })),
      hits: this.hits,
      loot: this.loot,
      look: p.appearance,
      bans,
      owes: g.net.owes,
      oe: g.net.ep,
      since: g.createdAt,
      cos: equipped(g.cosmetics, 'player'),
      rb: g.rebirths,
      casino: {
        cos: equipped(g.cosmetics, 'casino'),
        hotel: g.hotelInfo(),
        house: g.houseInfo(),
        look: g.homeLook,
        layout: g.homeLayout,
        floors: g.homeFloors,
      },
    };
    // Presence is small: shed the least important parts first so bans always get through.
    const casino = data.casino as Record<string, unknown>;
    if (JSON.stringify(data).length > 3800) delete data.owes;
    if (JSON.stringify(data).length > 3800) casino.hotel = (casino.hotel as unknown[]).slice(0, 2);
    if (JSON.stringify(data).length > 3800) delete casino.house;
    if (JSON.stringify(data).length > 3800) delete data.cos;
    if (JSON.stringify(data).length > 3800) data.hits = trimTop(this.hits, 8);
    if (JSON.stringify(data).length > 3800) data.chat = (data.chat as unknown[]).slice(-1);
    if (JSON.stringify(data).length > 3800) data.heists = (data.heists as unknown[]).slice(0, 2);
    return data;
  }

  private async sendPresence(): Promise<void> {
    if (!this.room) return;
    const data = this.presenceData();
    const key = JSON.stringify(data);
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    try {
      // Stamped with when it left, so others can play your moves back evenly.
      await this.room.presence({ ...data, t: Date.now() });
    } catch {
      /* dropped; the next change resends */
    }
  }

  private async publishLot(): Promise<void> {
    const g = this.game;
    if (!this.db || !this.writable) return;
    const snap = g.snapshot();
    const doc = {
      owner: g.player.name.slice(0, 24),
      since: g.createdAt,
      bans: { ...g.net.bans },
      snap: JSON.parse(JSON.stringify(snap)) as Record<string, unknown>,
      cos: equipped(g.cosmetics, 'casino'),
      hotel: g.hotelInfo(),
      house: g.houseInfo(),
      hotelSnap: g.hotelSnapshot(),
      houseSnap: g.houseSnapshot(),
      heists: cleanRecords(g.net.heists ?? []),
      rb: g.rebirths,
      updated: Date.now(),
    };
    const key = JSON.stringify({ ...doc, updated: 0 });
    if (key === this.lastLot) return;
    try {
      await this.db.collection('lots').doc(this.pid).set(doc);
      this.lastLot = key;
    } catch (e) {
      if ((e as { code?: string }).code === 'invalid_argument') {
        this.writable = false;
        this.status = 'Connected as a guest: you can visit everyone, but ask the owner for Editor access to put your casino on the street for good.';
      }
    }
  }

  private async publishLedger(): Promise<void> {
    const g = this.game;
    if (!this.db || !this.writable) return;
    const key = JSON.stringify(g.net.owes);
    if (key === this.lastLedger || key === '{}') return;
    try {
      await this.db.collection('ledger').doc(this.pid).set({ owes: { ...g.net.owes }, ep: g.net.ep ?? '', name: g.player.name.slice(0, 24), t: Date.now() });
      this.lastLedger = key;
    } catch {
      /* try again later */
    }
  }

  /**
   * Visitors' running totals at your tables arrive through the shared ledger (and their
   * presence while they're online); whatever changed since last time lands in your bank.
   */
  private creditVisitors(): void {
    const g = this.game;
    const totals = new Map<string, { owed: number; name: string; ep: string }>();
    for (const [pid, owes] of this.ledgers) {
      if (typeof owes[this.pid] === 'number') totals.set(pid, { owed: owes[this.pid], name: 'A visitor', ep: this.ledgerEps.get(pid) ?? '' });
    }
    for (const r of this.remotes.values()) {
      if (typeof r.owes[this.pid] === 'number') totals.set(r.pid, { owed: r.owes[this.pid], name: r.name, ep: r.oe ?? '' });
      else if (totals.has(r.pid)) totals.get(r.pid)!.name = r.name;
    }
    g.net.creditedEp ??= {};
    for (const [pid, { owed, name, ep }] of totals) {
      const prev = creditBase(g.net.credited[pid] ?? 0, g.net.creditedEp[pid], ep, owed);
      if (ep) g.net.creditedEp[pid] = ep;
      let delta = Math.round(owed - prev);
      g.net.credited[pid] = owed;
      if (Math.abs(delta) < 1 || Math.abs(delta) > 1e12) continue;
      // A visitor's winnings are paid from what's actually in the bank, never past zero.
      if (delta < 0) delta = -Math.min(-delta, Math.max(0, Math.round(g.money)));
      if (!delta) continue;
      g.addMoney(delta, delta > 0 ? 'collect' : 'payout');
      g.notify(delta > 0 ? `${name} lost ${formatMoney(delta)} at your tables!` : `${name} won ${formatMoney(-delta)} at your tables.`, delta > 0 ? 'money' : 'bad');
      g.requestSave();
    }
  }

  private checkBanned(): void {
    const g = this.game;
    const v = g.visit;
    const owner = v?.lot.kind === 'player' ? v.lot.id : v?.lot.kind === 'hotel' ? v.lot.hotelOf : undefined;
    if (!v || !owner) return;
    const until = this.bannedBy(owner);
    if (until > Date.now()) {
      g.events.emit('toast', { text: `${v.lot.owner} blacklisted you for ${Math.ceil((until - Date.now()) / 60000)} minutes. Security walks you out.`, kind: 'bad' });
      this.hud.modals.closeAll();
      g.returnHome(true);
    }
  }

  private updateRemotes(dt: number): void {
    const g = this.game;
    const views: { pid: string; name: string; x: number; z: number }[] = [];
    const map: MapPlayer[] = [];
    const cam = g.renderer.camera;
    const { w, h: hh } = g.renderer.size;
    for (const r of this.remotes.values()) {
      const lotId = this.localLot(r.lot);
      const known = !!g.street.get(lotId);
      const outside = r.out && r.floor === 0;
      const wp = known ? g.street.toActive(lotId, CENTER_X + r.tx, r.tz) : { x: 0, z: 0 };
      const wx = wp.x;
      const wz = wp.z;
      if (known) {
        // On the map: out on the street where they stand, inside a building at its door.
        const inside = !outside;
        const gp = inside ? g.street.toGlobal(lotId, CENTER_X, FACADE_Z + 1.2) : g.street.toGlobal(lotId, CENTER_X + r.tx, r.tz);
        const lot = g.street.get(lotId);
        const where = !inside ? '' : lotId === 'me' ? 'in your casino' : lot?.kind === 'house' ? (lot.houseOf === 'me' ? 'at your house' : `at ${lot.owner}'s house`) : `in ${lot?.info.look.name ?? 'a building'}`;
        map.push({ pid: r.pid, name: r.name, x: gp.x, z: gp.z, inside, where, driving: !!r.car, wanted: r.wl, ko: r.ko });
      }
      // Smooth playback: a little in the past, between the updates around that moment.
      const delay = Math.max(110, Math.min(320, r.gap * 1.7));
      const smp = sampleSnaps(r.buf, Date.now() - (r.clockOff ?? 0) - delay);
      const sp = known && smp ? g.street.toActive(lotId, CENTER_X + smp.x, smp.z) : { x: wx, z: wz };
      const yawNow = smp ? smp.yaw : r.yaw;
      let visible = known && (outside || (lotId === g.street.activeId && g.inside && r.floor === g.viewFloor));
      if (visible && Math.hypot(wx - g.player.x, wz - g.player.z) > 90) visible = false;
      if (visible && (!r.visible || Math.hypot(sp.x - r.x, sp.z - r.z) > 12)) {
        r.x = sp.x;
        r.z = sp.z;
      }
      r.visible = visible;
      r.model.root.visible = visible;
      if (r.car) r.car.visible = visible;
      r.label.hidden = !visible;
      if (!visible) {
        r.fx.update(0, false);
        continue;
      }
      // A light touch of smoothing on top, to hide any remaining step.
      const k = 1 - Math.exp(-dt * 25);
      const px = r.x;
      const pz = r.z;
      r.x += (sp.x - r.x) * k;
      r.z += (sp.z - r.z) * k;
      const inst = dt > 0 ? Math.hypot(r.x - px, r.z - pz) / dt : 0;
      r.vel += (Math.min(12, inst) - r.vel) * Math.min(1, dt * 8);
      const m = r.model;
      m.root.position.set(r.x, outside ? g.streetDrop : 0, r.z);
      r.fx.update(dt, true);
      m.root.rotation.y = dampAngle(m.root.rotation.y, yawNow + (known ? g.street.rotOf(lotId) : 0), 14, dt);
      if (r.car) {
        r.car.visible = true;
        r.car.position.set(r.x, m.root.position.y, r.z);
        r.car.rotation.y = m.root.rotation.y;
        m.root.visible = r.carOpen;
      }
      // Their dodge roll and reload, animated here.
      if (r.rollT > 0) {
        r.rollT = Math.max(0, r.rollT - dt);
        m.roll = 1 - r.rollT / ROLL_TIME;
      } else m.roll = 0;
      if (r.reloading && r.gun) {
        r.reloadT = (r.reloadT + dt / 1.6) % 1;
        m.reloadK = Math.max(0.01, r.reloadT);
      } else {
        r.reloadT = 0;
        m.reloadK = 0;
      }
      r.label.classList.toggle('bounty', r.ks >= 3);
      if (r.ko) m.setPose('ko');
      else if (r.car) m.setPose('sit');
      else if (r.vel > 0.35 || (r.moving && r.vel > 0.1)) {
        // Walk or run at the pace they're really going (no stepping in place, no sliding).
        m.moveSpeed = r.vel / 1.4;
        m.setPose(r.vel > (outside ? 6.6 : 4.4) ? 'run' : 'walk');
      } else m.setPose('idle');
      r.hpEl.hidden = !r.out || (r.hp >= 100 && !r.ko);
      if (!r.hpEl.hidden) r.hpEl.style.setProperty('--hp', `${r.ko ? 0 : r.hp}%`);
      r.label.classList.toggle('ko', r.ko);
      r.label.classList.toggle('prot', r.prot);
      m.update(dt);
      tmp.set(r.x, m.root.position.y + m.height + 0.45, r.z).project(cam);
      if (tmp.z > 1) r.label.hidden = true;
      else r.label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * hh}px) translate(-50%, -100%)`;
      views.push({ pid: r.pid, name: r.name, x: r.x, z: r.z });
    }
    g.remotes = views;
    g.mapPlayers = map;
  }

  // ------------------------------------------------------------------ UI

  /** Another player's lot id, as this street names it (your own lots are 'me' and 'hotel:…'). */
  private localLot(lot: string): string {
    if (lot === this.pid) return 'me';
    if (lot.startsWith(`${this.pid}~`)) return lot.slice(this.pid.length + 1);
    return lot;
  }

  private renderCard(pid: string, el: HTMLElement): void {
    const g = this.game;
    const r = [...this.remotes.values()].find((x) => x.pid === pid);
    const name = r?.name ?? 'Player';
    const lotId = r ? this.localLot(r.lot) : '';
    const where = !r ? 'Gone' : this.whereOf(r);
    void lotId;
    const owed = g.net.credited[pid] ?? 0;
    el.appendChild(h('div', { class: 'card-head' },
      h('div', { class: 'card-emoji', html: icon('you', 30) }),
      h('div', {},
        h('div', { class: 'card-title', text: name }),
        h('div', { class: 'chip-row' }, h('span', { class: 'chip good', text: 'Player' }), h('span', { class: 'chip', text: where })),
      ),
    ));
    el.appendChild(h('div', { class: 'card-stats' },
      h('div', { class: 'kv' }, h('span', { text: 'At your tables, all time' }), h('b', { class: owed >= 0 ? 'pos' : 'neg', text: owed >= 0 ? `lost ${formatMoney(owed)}` : `won ${formatMoney(-owed)}` })),
    ));
    el.appendChild(h('div', { class: 'field-label', text: '🚫 Blacklist' }));
    el.appendChild(this.banControls(pid, name, () => g.select({ kind: 'remote', pid })));
    el.appendChild(h('p', { class: 'muted small', text: 'No reason needed, but security charges by the minute. They’re walked out of your casino, hotel and house and can’t come back until it runs out.' }));
  }
}

/** The biggest few entries of a running-totals map. */
function trimTop(m: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function cleanNumbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    if (typeof x === 'number' && Number.isFinite(x) && k.length <= 80) out[k] = x;
  }
  return out;
}

function localPid(): string {
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id) {
      id = `p-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(PID_KEY, id);
    }
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Another player's hotel buildings as seen from the street (checked: presence and lots are untrusted). */
function hotelInfo(raw: unknown): HotelInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: HotelInfo[] = [];
  for (const it of raw.slice(0, 6)) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    if (typeof r.bid !== 'string' || !/^h\d{1,3}$/.test(r.bid)) continue;
    const snap = sanitizeSnapshot({ look: r.look, layout: { width: r.width, depth: r.depth }, floors: r.floors, items: [], staff: [] }, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
    if (!snap) continue;
    const stars = typeof r.stars === 'number' && Number.isFinite(r.stars) ? Math.max(1, Math.min(5, Math.round(r.stars))) : 1;
    out.push({ bid: r.bid, kind: r.kind === 'garden' ? 'garden' : 'tower', look: snap.look, width: snap.layout.width, depth: snap.layout.depth, floors: snap.floors, stars });
  }
  return out;
}

/** Another player's house from the street (untrusted: clamp it like a floor plan). */
function houseView(raw: unknown): HouseView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const snap = sanitizeSnapshot({ look: r.look, layout: { width: r.width, depth: r.depth }, floors: r.floors, items: [], staff: [] }, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
  if (!snap) return null;
  return {
    look: snap.look, width: snap.layout.width, depth: snap.layout.depth, floors: snap.floors,
    vt: Math.max(0, Math.min(5, Math.round(num(r.vt)))), vm: Math.max(0, Math.min(1e12, Math.floor(num(r.vm)))),
    rb: cleanRecords(r.rb ? [r.rb] : [])[0] ?? null,
  };
}

function hotelSnaps(raw: unknown): Record<string, CasinoSnapshot> {
  const out: Record<string, CasinoSnapshot> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [bid, v] of Object.entries(raw as Record<string, unknown>).slice(0, 6)) {
    if (!/^h\d{1,3}$/.test(bid)) continue;
    const snap = sanitizeSnapshot(v, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
    if (snap) out[bid] = snap;
  }
  return out;
}

function rebirthsOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(99, Math.round(v))) : 0;
}

/**
 * What a visitor's running total should be compared against. When it started again from
 * zero (new id, or an old game whose big total collapsed) count from 0 instead, so the drop
 * isn't read as the visitor winning everything back.
 */
export function creditBase(prev: number, seenEp: string | undefined, ep: string, owed: number): number {
  if (ep && seenEp && ep !== seenEp) return 0;
  if ((!ep || !seenEp) && prev > 20_000 && owed >= 0 && owed < prev * 0.5) return 0;
  return prev;
}
