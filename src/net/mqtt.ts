/**
 * A tiny MQTT 3.1.1 client over WebSocket: connect (with a last will), subscribe, publish
 * (QoS 0, optionally retained), keep-alive pings and automatic reconnects. Enough for a
 * public broker to act as the game's relay; no dependencies.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): Uint8Array<ArrayBuffer> {
  const b = enc.encode(s);
  const out = new Uint8Array(b.length + 2);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(type: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const head = [type, ...remainingLength(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface MqttOptions {
  url: string;
  clientId: string;
  will?: { topic: string; payload: string; retain?: boolean };
  keepAlive?: number;
}

export type MessageHandler = (topic: string, payload: string) => void;

export class MqttClient {
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private subs: string[] = [];
  private nextId = 1;
  private pingT = 0;
  private retryMs = 1000;
  private closed = false;
  connected = false;
  onMessage: MessageHandler | null = null;
  onConnect: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(private opts: MqttOptions) {}

  connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url, ['mqtt']);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const will = this.opts.will;
      let flags = 0x02; // clean session
      const payload: Uint8Array[] = [str(this.opts.clientId)];
      if (will) {
        flags |= 0x04 | (will.retain ? 0x20 : 0);
        payload.push(str(will.topic), str(will.payload));
      }
      const ka = this.opts.keepAlive ?? 30;
      const vh = new Uint8Array([0, 4, 77, 81, 84, 84, 4, flags, ka >> 8, ka & 255]);
      ws.send(packet(0x10, vh, ...payload));
    };
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      window.clearInterval(this.pingT);
      if (was) this.onClose?.();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    window.setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(30000, this.retryMs * 2);
  }

  subscribe(filter: string): void {
    if (!this.subs.includes(filter)) this.subs.push(filter);
    if (this.connected) this.sendSubscribe(filter);
  }

  private sendSubscribe(filter: string): void {
    const id = this.nextId++ & 0xffff || 1;
    this.ws?.send(packet(0x82, new Uint8Array([id >> 8, id & 255]), str(filter), new Uint8Array([0])));
  }

  publish(topic: string, payload: string, retain = false): boolean {
    if (!this.connected || !this.ws) return false;
    this.ws.send(packet(0x30 | (retain ? 1 : 0), str(topic), new Uint8Array(enc.encode(payload))));
    return true;
  }

  close(): void {
    this.closed = true;
    try {
      this.ws?.send(new Uint8Array([0xe0, 0]));
    } catch {
      /* already gone */
    }
    this.ws?.close();
  }

  private onData(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4;
      const flags = this.buf[0] & 15;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(type, flags, body);
    }
  }

  private handle(type: number, flags: number, body: Uint8Array): void {
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) {
        this.ws?.close();
        return;
      }
      this.connected = true;
      this.retryMs = 1000;
      for (const s of this.subs) this.sendSubscribe(s);
      const ka = (this.opts.keepAlive ?? 30) * 1000 * 0.6;
      this.pingT = window.setInterval(() => this.ws?.send(new Uint8Array([0xc0, 0])), ka);
      this.onConnect?.();
    } else if (type === 3) {
      // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      let o = 2 + tl;
      const qos = (flags >> 1) & 3;
      if (qos > 0) o += 2;
      this.onMessage?.(topic, dec.decode(body.subarray(o)));
    }
  }
}
