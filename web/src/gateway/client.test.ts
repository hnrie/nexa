import { GatewayClient } from "./client";
import type { GatewayEvent } from "./events";

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) } as MessageEvent);
  }
  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }
}

function make(token: string | null = "tok") {
  FakeWS.instances = [];
  const events: GatewayEvent[] = [];
  const statuses: string[] = [];
  const client = new GatewayClient({
    url: () => "ws://x/gateway",
    token: () => token,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
    heartbeatMs: 1000,
    random: () => 0,
  });
  return { client, events, statuses };
}

const ops = (ws: FakeWS): string[] => ws.sent.map((s) => (JSON.parse(s) as { op: string }).op);

describe("GatewayClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends identify first, then heartbeats on the cadence", () => {
    const { client, statuses } = make();
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();
    expect(ops(ws)).toEqual(["identify"]);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ op: "identify", d: { token: "tok" } });
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(ops(ws)).toEqual(["identify", "heartbeat", "heartbeat"]);
    expect(statuses).toEqual(["connecting", "open"]);
    expect(client.status).toBe("open");
  });

  it("queues ops until ready, drops typing while connecting, dispatches events", () => {
    const { client, events } = make();
    client.connect();
    const ws = FakeWS.instances[0]!;
    client.send("presence", { status: "idle" });
    client.sendTyping("5");
    ws.open();
    expect(ops(ws)).toEqual(["identify", "presence"]);
    ws.message({ t: "ready", s: 1, d: { user: { id: "1" } } });
    expect(events[0]?.t).toBe("ready");
    ws.message("not json");
    ws.message({ nope: true });
    ws.message({ t: "presence", d: { user_id: "2", status: "online" } });
    expect(events.map((e) => e.t)).toEqual(["ready", "presence"]);
    client.sendTyping("5");
    expect(ops(ws).at(-1)).toBe("typing");
  });

  it("reconnects with growing delay and resets after ready", () => {
    const { client } = make();
    client.connect();
    const ws1 = FakeWS.instances[0]!;
    ws1.open();
    ws1.serverClose(1006);
    expect(client.status).toBe("closed");
    vi.advanceTimersByTime(999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(2);
    const ws2 = FakeWS.instances[1]!;
    ws2.serverClose(1006);
    vi.advanceTimersByTime(1699);
    expect(FakeWS.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(3);
    const ws3 = FakeWS.instances[2]!;
    ws3.open();
    ws3.message({ t: "ready", d: {} });
    ws3.serverClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWS.instances).toHaveLength(4);
  });

  it("stops on 4001 and emits session_expired", () => {
    const { client, events } = make();
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();
    ws.serverClose(4001, "authentication failed");
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(events.map((e) => e.t)).toContain("session_expired");
    expect(client.status).toBe("closed");
  });

  it("close() prevents reconnects and stops heartbeats", () => {
    const { client } = make();
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(ops(ws)).toEqual(["identify"]);
    expect(client.status).toBe("closed");
  });

  it("does not connect without a token", () => {
    const { client, statuses } = make(null);
    client.connect();
    expect(FakeWS.instances).toHaveLength(0);
    expect(statuses).toEqual(["closed"]);
  });
});
