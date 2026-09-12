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

export class GatewayClient {
  private readonly opts: GatewayOptions;
  private ws: WebSocket | null = null;
  private _status: GatewayStatus = "idle";
  private attempt = 0;
  private closedByUser = false;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

  private timers() {
    return {
      set: this.opts.setTimeoutImpl ?? setTimeout,
      clear: this.opts.clearTimeoutImpl ?? clearTimeout,
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
      ws.send(JSON.stringify({ op: "identify", d: { token } }));
      this.setStatus("open");
      this.flush();
      this.startHeartbeat();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
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
    const { set } = this.timers();
    this.reconnectTimer = set(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, delay);
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
        this.ws.send(JSON.stringify({ op: "heartbeat" }));
        this.heartbeat = set(tick, interval);
      }
    };
    this.heartbeat = set(tick, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      this.timers().clear(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
