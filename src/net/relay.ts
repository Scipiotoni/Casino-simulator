import { MqttClient } from './mqtt';

/**
 * Multiplayer for the stand-alone site (GitHub Pages): a public MQTT broker stands in for
 * the artifact runtime's shared database and live presence, behind the same small
 * interfaces the game already uses. Casinos and ledgers are *retained* messages, so the
 * broker remembers them while their owners are offline; presence is a stream of small
 * messages plus a last will that clears it when a player disconnects.
 *
 * Public brokers are open to anyone and make no promises: treat everything received as
 * untrusted (the game sanitizes it) and never send anything private.
 */

/** Brokers tried in order. `?mqtt=wss://…` in the page URL overrides them. */
export const DEFAULT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
/** One street for everyone playing the published site. */
export const PREFIX = 'jackpot-tycoon/scipiotoni/street-v2';

interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

type SnapFn = (s: { docs: DocSnap[] }) => void;

export interface RelayPeer {
  peer: string;
  by: string | null;
  isMe: boolean;
  presence: Record<string, unknown>;
}

const PRESENCE_TTL = 8000;
const HEARTBEAT = 2500;

export class Relay {
  private client: MqttClient | null = null;
  private docs = new Map<string, Map<string, Record<string, unknown>>>();
  private snapFns = new Map<string, Set<SnapFn>>();
  private peers = new Map<string, { presence: Record<string, unknown>; seen: number }>();
  private peerFns = new Set<(c: { peers: readonly RelayPeer[] }) => void>();
  private myPresence: Record<string, unknown> | null = null;
  private lastSent = 0;
  private brokerIdx = 0;
  private urls: string[];
  private readonly me: string;
  connected = false;

  constructor(pid: string) {
    this.me = `${pid.replace(/[^a-zA-Z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
    const q = new URLSearchParams(location.search).get('mqtt');
    this.urls = q && /^wss?:\/\//.test(q) ? [q] : DEFAULT_BROKERS;
  }

  /** Called whenever the connection comes up or drops. */
  onStatus: ((connected: boolean) => void) | null = null;

  /**
   * Keep trying brokers in turn until one answers (a slow first load or a flaky broker
   * shouldn't leave anyone alone on the street). Resolves on the first connection.
   */
  start(timeoutMs = 10000): Promise<void> {
    window.setInterval(() => this.tick(), 1000);
    return new Promise((resolve) => {
      const attempt = () => {
        const url = this.urls[this.brokerIdx++ % this.urls.length];
        const c = new MqttClient({
          url, clientId: this.me, keepAlive: 30,
          will: { topic: `${PREFIX}/presence/${this.me}`, payload: '' },
        });
        const timer = window.setTimeout(() => {
          if (c.connected) return;
          c.close();
          attempt();
        }, timeoutMs);
        c.onConnect = () => {
          window.clearTimeout(timer);
          this.client = c;
          this.connected = true;
          this.onStatus?.(true);
          resolve();
          if (this.myPresence) this.sendPresence(true);
        };
        c.onClose = () => {
          this.connected = false;
          this.onStatus?.(false);
        };
        c.onMessage = (t, p) => this.onMessage(t, p);
        c.subscribe(`${PREFIX}/lots/+`);
        c.subscribe(`${PREFIX}/ledger/+`);
        c.subscribe(`${PREFIX}/presence/+`);
        c.connect();
      };
      attempt();
    });
  }

  private onMessage(topic: string, payload: string): void {
    const rest = topic.slice(PREFIX.length + 1);
    const [coll, id] = rest.split('/');
    if (!coll || !id) return;
    if (coll === 'presence') {
      if (id === this.me) return;
      if (!payload) this.peers.delete(id);
      else {
        const data = parse(payload);
        if (data) this.peers.set(id, { presence: data, seen: Date.now() });
      }
      this.emitPeers();
      return;
    }
    let m = this.docs.get(coll);
    if (!m) this.docs.set(coll, (m = new Map()));
    if (!payload) m.delete(id);
    else {
      const data = parse(payload);
      if (!data) return;
      m.set(id, data);
    }
    this.emitColl(coll);
  }

  private emitColl(coll: string): void {
    const m = this.docs.get(coll) ?? new Map();
    const docs: DocSnap[] = [...m.entries()].map(([id, d]) => ({ id, exists: true, data: () => d }));
    for (const fn of this.snapFns.get(coll) ?? []) fn({ docs });
  }

  private emitPeers(): void {
    const list: RelayPeer[] = [...this.peers.entries()].map(([peer, p]) => ({ peer, by: null, isMe: false, presence: p.presence }));
    if (this.myPresence) list.push({ peer: this.me, by: null, isMe: true, presence: this.myPresence });
    for (const fn of this.peerFns) fn({ peers: list });
  }

  /** Drop players we haven't heard from and keep our own presence fresh. */
  private tick(): void {
    const now = Date.now();
    let changed = false;
    for (const [k, p] of this.peers) {
      if (now - p.seen > PRESENCE_TTL) {
        this.peers.delete(k);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
    if (this.myPresence && now - this.lastSent > HEARTBEAT) this.sendPresence(true);
  }

  private sendPresence(force = false): void {
    if (!this.client || !this.myPresence) return;
    const now = Date.now();
    if (!force && now - this.lastSent < 100) return;
    this.lastSent = now;
    this.client.publish(`${PREFIX}/presence/${this.me}`, JSON.stringify(this.myPresence));
  }

  // ------------------------------------------------------------------ the game-facing shapes

  /** Stand-in for the artifact `db` capability (only what the game uses). */
  readonly db = {
    collection: (coll: string) => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => {
          if (!this.client?.publish(`${PREFIX}/${coll}/${id}`, JSON.stringify(data), true)) throw { code: 'unavailable' };
        },
      }),
      onSnapshot: (next: SnapFn) => {
        let set = this.snapFns.get(coll);
        if (!set) this.snapFns.set(coll, (set = new Set()));
        set.add(next);
        window.setTimeout(() => this.emitColl(coll), 0);
        return () => set!.delete(next);
      },
    }),
  };

  /** Stand-in for the artifact `room` capability. */
  readonly room = {
    presence: async (p: Record<string, unknown>) => {
      this.myPresence = p;
      this.sendPresence();
    },
    peers: () => [] as readonly RelayPeer[],
    onPeers: (fn: (c: { peers: readonly RelayPeer[] }) => void) => {
      this.peerFns.add(fn);
      window.setTimeout(() => this.emitPeers(), 0);
      return () => this.peerFns.delete(fn);
    },
  };
}

function parse(s: string): Record<string, unknown> | null {
  if (s.length > 600_000) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
