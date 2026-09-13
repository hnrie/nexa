import type { Presence } from "@/api/types";
import { isGatewayFrame, type GatewayEvent } from "./events";

export type GatewayStatus = "idle" | "connecting" | "open" | "closed";

export interface GatewayOptions {
  url: () => string;
  token: () => string | null;
  onEvent: (e: GatewayEvent) => void;
  onStatus?: (s: GatewayStatus, info?: { code?: number; reason?: string; attempt: number }) => void;
  WebSocketImpl?: typeof WebSocket;
  /** Heartbeat interval; Cloudflare drops idle sockets around 100 s. */
  heartbeatMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  random?: () => number;
}

const MAX_QUEUE = 64;
const MAX_BACKOFF_MS = 30_000;
/**
 * How long a heartbeat may go unanswered. A phone that changes network or
 * wakes from sleep can keep a socket "open" for minutes after its connection
 * is gone, and nothing but silence ever says so.
 */
const ACK_TIMEOUT_MS = 8_000;

export class GatewayClient {
  private readonly opts: GatewayOptions;
  private ws: WebSocket | null = null;
  private _status: GatewayStatus = "idle";
  private attempt = 0;
  private closedByUser = false;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the socket last delivered anything at all. */
  private lastFrameAt = 0;
  private queue: string[] = [];
  private ready = false;

  constructor(opts: GatewayOptions) {
    this.opts = opts;
  }

  get status(): GatewayStatus {
    return this._status;
  }

  private setStatus(s: GatewayStatus, info?: { code?: number; reason?: string }): void {
    this._status = s;
    this.opts.onStatus?.(s, { ...info, attempt: this.attempt });
  }

  // The browser's timers are methods of the global object and refuse a
  // detached receiver with "Illegal invocation", so they are called through a
  // wrapper rather than handed out bare.
  private timers() {
    const { setTimeoutImpl, clearTimeoutImpl } = this.opts;
    return {
      set: (fn: () => void, ms: number): ReturnType<typeof setTimeout> =>
        setTimeoutImpl ? setTimeoutImpl(fn, ms) : globalThis.setTimeout(fn, ms),
      clear: (handle: ReturnType<typeof setTimeout>): void => {
        if (clearTimeoutImpl) clearTimeoutImpl(handle);
        else globalThis.clearTimeout(handle);
      },
    };
  }

  connect(): void {
    if (this._status === "connecting" || this._status === "open") return;
    this.closedByUser = false;
    const token = this.opts.token();
    if (!token) {
      this.setStatus("closed", { reason: "no token" });
      return;
    }
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    this.ready = false;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new Impl(this.opts.url());
    } catch {
      this.scheduleReconnect(1006, "constructor failed");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastFrameAt = Date.now();
      ws.send(JSON.stringify({ op: "identify", d: { token } }));
      this.setStatus("open");
      this.flush();
      this.startHeartbeat();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastFrameAt = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "") as unknown;
      } catch {
        return;
      }
      if (!isGatewayFrame(parsed)) return;
      if (parsed.t === "ready") {
        this.ready = true;
        this.attempt = 0;
      }
      this.opts.onEvent(parsed as GatewayEvent);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.ready = false;
      if (ev.code === 4001) {
        this.setStatus("closed", { code: ev.code, reason: ev.reason });
        this.opts.onEvent({ t: "session_expired", d: {} });
        return;
      }
      if (this.closedByUser) {
        this.setStatus("closed", { code: ev.code, reason: ev.reason });
        return;
      }
      this.scheduleReconnect(ev.code, ev.reason);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here
    };
  }

  private scheduleReconnect(code?: number, reason?: string): void {
    this.setStatus("closed", { code, reason });
    const rnd = this.opts.random ?? Math.random;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(1.7, this.attempt)) + rnd() * 500;
    this.attempt += 1;
    const { set, clear } = this.timers();
    if (this.reconnectTimer !== null) clear(this.reconnectTimer);
    this.reconnectTimer = set(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  /**
   * For when the device is back: online again, or the app reopened. A socket
   * waiting out its backoff tries again straight away rather than after up to
   * half a minute, and an open one is asked to prove it is still alive.
   */
  wake(): void {
    if (this.closedByUser) return;
    if (this._status === "open") {
      this.ping();
      return;
    }
    if (this._status !== "closed" || this.reconnectTimer === null) return;
    this.timers().clear(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.connect();
  }

  /** Sends a heartbeat and gives up on the socket if nothing comes back in time. */
  private ping(): void {
    const ws = this.ws;
    if (!ws || this._status !== "open") return;
    ws.send(JSON.stringify({ op: "heartbeat" }));
    if (this.ackTimer !== null) return;
    const sentAt = Date.now();
    this.ackTimer = this.timers().set(() => {
      this.ackTimer = null;
      if (this.ws !== ws || this.lastFrameAt > sentAt) return;
      // The connection is gone without saying so. Stop listening to it; its
      // close event, if one ever comes, is ignored like any stale socket's.
      this.ws = null;
      this.stopHeartbeat();
      this.ready = false;
      try {
        ws.close(4000, "heartbeat timeout");
      } catch {
        /* already closing */
      }
      this.scheduleReconnect(1006, "heartbeat timeout");
    }, ACK_TIMEOUT_MS);
  }

  close(): void {
    this.closedByUser = true;
    const { clear } = this.timers();
    if (this.reconnectTimer !== null) {
      clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (ws) ws.close(1000, "client closed");
    this.setStatus("closed", { code: 1000, reason: "client closed" });
  }

  send(op: string, d?: unknown): void {
    const frame = JSON.stringify(d === undefined ? { op } : { op, d });
    if (this.ws && this._status === "open" && this.ws.readyState === 1) {
      this.ws.send(frame);
      return;
    }
    if (op === "typing") return;
    this.queue.push(frame);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  sendTyping(channelId: string): void {
    this.send("typing", { channel_id: channelId });
  }

  /** Ends our typing indicator for everyone else immediately. */
  sendTypingStop(channelId: string): void {
    this.send("typing", { channel_id: channelId, stop: true });
  }

  sendPresence(p: {
    status?: Presence["status"];
    status_text?: string;
    status_emoji?: string;
    status_expires_at?: number | null;
    clear_status?: boolean;
  }): void {
    this.send("presence", p);
  }

  private flush(): void {
    if (!this.ws || this._status !== "open") return;
    const pending = this.queue;
    this.queue = [];
    for (const f of pending) this.ws.send(f);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const { set } = this.timers();
    const interval = this.opts.heartbeatMs ?? 25_000;
    const tick = (): void => {
      if (this.ws && this._status === "open") {
        this.heartbeat = set(tick, interval);
        this.ping();
      }
    };
    this.heartbeat = set(tick, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      this.timers().clear(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.ackTimer !== null) {
      this.timers().clear(this.ackTimer);
      this.ackTimer = null;
    }
  }
}
