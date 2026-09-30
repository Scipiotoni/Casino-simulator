import * as THREE from 'three';
import type { HotelInfo } from '../game/game';
import { roman } from '../game/game';
import { PlayerFx } from '../cosmetics/playerFx';
import { cleanCosmetics, equipped } from '../cosmetics/catalog';
import type { Game } from '../game/game';
import type { Hud } from '../ui/hud';
import { CharacterModel } from '../entities/characterModel';
import { sanitizeAppearance } from '../entities/appearance';
import { migrateSave, sanitizeSnapshot, type CasinoSnapshot, type SaveData } from '../game/save';
import { SIGN_FONTS, type CasinoLook } from '../world/building';
import { CENTER_X, FACADE_Z, type Layout } from '../world/grid';
import type { StreetLot } from '../world/street';
import { h, icon } from '../ui/dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';
import { dampAngle } from '../core/math';
import { Relay } from './relay';

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

const PID_KEY = 'jackpot-tycoon:pid';

interface LotDoc {
  owner: string;
  since: number;
  snap: CasinoSnapshot | null;
  bans: Record<string, number>;
  info: { look: CasinoLook; layout: Layout; floors: number; cos?: string[]; hotel?: HotelInfo | null; rb?: number };
  /** The owner's hotel floor plan, for walking around in it. */
  hotelSnap?: CasinoSnapshot | null;
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
  label: HTMLElement;
  visible: boolean;
  bans: Record<string, number>;
  owes: Record<string, number>;
  casino: LotDoc['info'] | null;
  since: number;
  fx: PlayerFx;
  rb: number;
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
  status = 'Offline: just you and the rival down the street.';

  constructor(private game: Game, private hud: Hud) {
    this.labelRoot = h('div', { class: 'net-labels' });
    game.floaters.root.appendChild(this.labelRoot);
    game.playerLot = (pid) => this.lotSnapshot(pid);
    game.playerHotel = (pid) => this.lots.get(pid)?.hotelSnap ?? null;
    game.bannedBy = (pid) => this.bannedBy(pid);
    hud.remoteCard = (pid, el) => this.renderCard(pid, el);
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
        info: { look: snapData.look, layout: snapData.layout, floors: snapData.floors, cos: cleanCosmetics(raw.cos), hotel: hotelInfo(raw.hotel), rb: rebirthsOf(raw.rb) },
        hotelSnap: raw.hotelSnap ? sanitizeSnapshot(raw.hotelSnap, SIGN_FONTS.map((f) => f.id), sanitizeAppearance) : null,
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
        const label = h('div', { class: 'net-label' });
        this.labelRoot.appendChild(label);
        r = {
          key: p.peer, pid, name: 'Player', model, lookKey, x: 0, z: 0, tx: 0, tz: 0, yaw: 0, floor: 0, lot: '', moving: false, label, visible: false,
          bans: {}, owes: {}, casino: null, since: Date.now(), fx: new PlayerFx(model), rb: 0,
        };
        this.remotes.set(p.peer, r);
      } else if (r.lookKey !== lookKey) {
        r.model.setAppearance(look);
        r.lookKey = lookKey;
      }
      r.pid = pid;
      r.name = typeof pr.nm === 'string' && pr.nm.trim() ? pr.nm.slice(0, 20) : 'Player';
      r.rb = rebirthsOf(pr.rb);
      r.label.textContent = r.rb ? `⟳${roman(r.rb)} ${r.name}` : r.name;
      r.tx = num(pr.x);
      r.tz = num(pr.z);
      r.yaw = num(pr.yaw);
      r.floor = Math.max(0, Math.min(40, Math.round(num(pr.fl))));
      r.lot = typeof pr.lot === 'string' ? pr.lot.slice(0, 80) : '';
      r.moving = pr.mv === 1;
      r.bans = cleanNumbers(pr.bans);
      r.owes = cleanNumbers(pr.owes);
      r.since = num(pr.since) || r.since;
      const c = pr.casino as Record<string, unknown> | undefined;
      const snap = c ? sanitizeSnapshot({ ...c, items: [], staff: [] }, SIGN_FONTS.map((f) => f.id), sanitizeAppearance) : null;
      r.casino = snap ? { look: snap.look, layout: snap.layout, floors: snap.floors, cos: cleanCosmetics(c?.cos), hotel: hotelInfo(c?.hotel), rb: r.rb } : null;
      r.fx.set(cleanCosmetics(pr.cos));
    }
    for (const [k, r] of this.remotes) {
      if (seen.has(k)) continue;
      r.fx.dispose();
      r.model.root.removeFromParent();
      r.model.dispose();
      r.label.remove();
      this.remotes.delete(k);
    }
    this.syncStreet();
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
    const addHotel = (pid: string, owner: string, h: HotelInfo | null | undefined, on: boolean) => {
      if (!h) return;
      hotels.push({
        id: `${pid}~hotel`, kind: 'hotel', hotelOf: pid, owner, order: 0, online: on,
        info: { look: h.look, width: h.width, depth: h.depth, floors: h.floors, tagline: `${'★'.repeat(h.stars)} HOTEL`, style: 'hotel' },
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
    }
    // Players who can't publish still show their casino on the street while they're online.
    for (const r of this.remotes.values()) {
      if (this.lots.has(r.pid) || !r.casino || lots.some((l) => l.id === r.pid)) continue;
      lots.push({
        id: r.pid, kind: 'player', owner: r.name, order: r.since, online: true,
        info: { look: r.casino.look, width: r.casino.layout.width, depth: r.casino.layout.depth, floors: r.casino.floors, tagline: tag(r.name, r.rb), cos: r.casino.cos ?? [] },
      });
      addHotel(r.pid, r.name, r.casino.hotel, true);
    }
    lots.push(...hotels);
    const key = JSON.stringify(lots);
    if (key === this.streetKey) return;
    this.streetKey = key;
    this.game.extraLots = lots;
    this.game.refreshStreet();
    // If the casino you're in vanished from the street, head home.
    const v = this.game.visit?.lot;
    if (v && (v.kind === 'player' || (v.kind === 'hotel' && v.id !== 'hotel')) && !this.game.street.get(v.id)) this.game.returnHome(true);
  }

  // ------------------------------------------------------------------ queries used by the game

  private lotSnapshot(pid: string): CasinoSnapshot | null {
    return this.lots.get(pid)?.snap ?? null;
  }

  /** Until when (epoch ms) this owner keeps you out; 0 if you're welcome. */
  bannedBy(owner: string): number {
    let until = this.lots.get(owner)?.bans[this.pid] ?? 0;
    for (const r of this.remotes.values()) if (r.pid === owner) until = Math.max(until, r.bans[this.pid] ?? 0);
    return until;
  }

  /** Blacklist another player from your casino for a while. */
  ban(pid: string, name: string): void {
    const now = Date.now();
    const net = this.game.net;
    const cool = net.banCooldown[pid] ?? 0;
    if (cool > now) {
      audio.play('error');
      this.game.notify(`You can blacklist ${name} again in ${Math.ceil((cool - now) / 60000)} min.`, 'bad');
      return;
    }
    net.bans[pid] = now + BAN_MS;
    net.banCooldown[pid] = now + BAN_MS + BAN_COOLDOWN_MS;
    audio.play('bust');
    this.game.notify(`${name} is blacklisted from your casino for 10 minutes.`, 'good');
    this.publishT = 0;
    this.presenceT = 0;
    this.game.requestSave();
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
      // Expired bans drop off.
      const now = Date.now();
      for (const [k, v] of Object.entries(g.net.bans)) if (v < now) delete g.net.bans[k];
    }
  }

  /** Where the manager stands, in the street's shared frame of reference. */
  private presenceData(): Record<string, unknown> {
    const g = this.game;
    const p = g.player;
    const lot = g.street.activeId === 'me' ? this.pid : g.street.activeId === 'hotel' ? `${this.pid}~hotel` : g.street.activeId;
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
      look: p.appearance,
      bans,
      owes: g.net.owes,
      since: g.createdAt,
      cos: equipped(g.cosmetics, 'player'),
      rb: g.rebirths,
      casino: {
        cos: equipped(g.cosmetics, 'casino'),
        hotel: g.hotelInfo(),
        look: g.homeLook,
        layout: g.homeLayout,
        floors: g.homeFloors,
      },
    };
    if (JSON.stringify(data).length > 3800) delete data.owes;
    return data;
  }

  private async sendPresence(): Promise<void> {
    if (!this.room) return;
    const data = this.presenceData();
    const key = JSON.stringify(data);
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    try {
      await this.room.presence(data);
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
      hotelSnap: g.hotelSnapshot(),
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
      await this.db.collection('ledger').doc(this.pid).set({ owes: { ...g.net.owes }, name: g.player.name.slice(0, 24), t: Date.now() });
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
    const totals = new Map<string, { owed: number; name: string }>();
    for (const [pid, owes] of this.ledgers) {
      if (typeof owes[this.pid] === 'number') totals.set(pid, { owed: owes[this.pid], name: 'A visitor' });
    }
    for (const r of this.remotes.values()) {
      if (typeof r.owes[this.pid] === 'number') totals.set(r.pid, { owed: r.owes[this.pid], name: r.name });
      else if (totals.has(r.pid)) totals.get(r.pid)!.name = r.name;
    }
    for (const [pid, { owed, name }] of totals) {
      const prev = g.net.credited[pid] ?? 0;
      const delta = Math.round(owed - prev);
      if (Math.abs(delta) < 1 || Math.abs(delta) > 1e12) continue;
      g.net.credited[pid] = owed;
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
    const cam = g.renderer.camera;
    const { w, h: hh } = g.renderer.size;
    for (const r of this.remotes.values()) {
      const lotId = r.lot === this.pid ? 'me' : r.lot === `${this.pid}~hotel` ? 'hotel' : r.lot;
      const known = !!g.street.get(lotId);
      const outside = r.tz >= FACADE_Z + 0.2 && r.floor === 0;
      const wp = known ? g.street.toActive(lotId, CENTER_X + r.tx, r.tz) : { x: 0, z: 0 };
      const wx = wp.x;
      const wz = wp.z;
      let visible = known && (outside || (lotId === g.street.activeId && g.inside && r.floor === g.viewFloor));
      if (visible && Math.abs(wx - g.player.x) > 70) visible = false;
      if (visible && !r.visible) {
        r.x = wx;
        r.z = wz;
      }
      r.visible = visible;
      r.model.root.visible = visible;
      r.label.hidden = !visible;
      if (!visible) {
        r.fx.update(0, false);
        continue;
      }
      const k = 1 - Math.exp(-dt * 10);
      r.x += (wx - r.x) * k;
      r.z += (wz - r.z) * k;
      const m = r.model;
      m.root.position.set(r.x, outside ? g.streetDrop : 0, r.z);
      r.fx.update(dt, true);
      m.root.rotation.y = dampAngle(m.root.rotation.y, r.yaw + (known ? g.street.rotOf(lotId) : 0), 12, dt);
      if (r.moving) {
        m.moveSpeed = 2.6;
        m.setPose('walk');
      } else m.setPose('idle');
      m.update(dt);
      tmp.set(r.x, m.root.position.y + m.height + 0.45, r.z).project(cam);
      if (tmp.z > 1) r.label.hidden = true;
      else r.label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * hh}px) translate(-50%, -100%)`;
      views.push({ pid: r.pid, name: r.name, x: r.x, z: r.z });
    }
    g.remotes = views;
  }

  // ------------------------------------------------------------------ UI

  private renderCard(pid: string, el: HTMLElement): void {
    const g = this.game;
    const r = [...this.remotes.values()].find((x) => x.pid === pid);
    const name = r?.name ?? 'Player';
    const lotId = r ? (r.lot === this.pid ? 'me' : r.lot === `${this.pid}~hotel` ? 'hotel' : r.lot) : '';
    const where = !r ? 'Gone' : r.tz >= FACADE_Z ? 'Out on the street' : lotId === 'me' ? 'In your casino' : lotId === 'hotel' ? 'In your hotel' : `At ${g.street.get(lotId)?.info.look.name ?? 'another casino'}`;
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
    const now = Date.now();
    const banned = (g.net.bans[pid] ?? 0) > now;
    const cool = (g.net.banCooldown[pid] ?? 0) > now;
    const btn = h('button', {
      class: 'btn danger', disabled: banned || cool,
      html: banned
        ? `${icon('close', 16)} Blacklisted · ${Math.ceil(((g.net.bans[pid] ?? 0) - now) / 60000)} min left`
        : cool
          ? `${icon('close', 16)} Cooldown · ${Math.ceil(((g.net.banCooldown[pid] ?? 0) - now) / 60000)} min`
          : `${icon('close', 16)} Blacklist for 10 min`,
      onClick: () => {
        this.ban(pid, name);
        g.select(null);
      },
    });
    el.appendChild(h('div', { class: 'card-actions one' }, btn));
    el.appendChild(h('p', { class: 'muted small', text: 'A blacklisted player is walked out of your casino and can’t come back in until it ends. After that, a 30-minute cooldown before you can blacklist them again.' }));
  }
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

/** Another player's hotel as seen from the street (checked: presence and lots are untrusted). */
function hotelInfo(raw: unknown): HotelInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const snap = sanitizeSnapshot({ look: r.look, layout: { width: r.width, depth: r.depth }, floors: r.floors, items: [], staff: [] }, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
  if (!snap) return null;
  const stars = typeof r.stars === 'number' && Number.isFinite(r.stars) ? Math.max(1, Math.min(5, Math.round(r.stars))) : 1;
  return { look: snap.look, width: snap.layout.width, depth: snap.layout.depth, floors: snap.floors, stars };
}

function rebirthsOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(99, Math.round(v))) : 0;
}
