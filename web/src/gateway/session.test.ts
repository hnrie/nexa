// @vitest-environment jsdom
import { api } from "@/api/client";
import type { DecryptedMessage } from "@/lib/decrypt";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { useTyping } from "@/stores/typing";
import { useReadStates } from "@/stores/readStates";
import { useVoice } from "@/stores/voice";
import { useUI } from "@/stores/ui";
import { CLOSE_TOO_MANY } from "./client";
import { connectionNote, enqueueEvent, gateway, startSession, stopSession } from "./session";

const voice = vi.hoisted(() => ({ handleVoiceEvent: vi.fn(), onReadyVoice: vi.fn(), leaveVoice: vi.fn(async () => undefined) }));
vi.mock("@/voice/session", () => voice);

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

const identity = { publicKey: new Uint8Array(32).fill(1), privateKey: new Uint8Array(32).fill(2) };
const me = { id: "me", username: "me", display_name: "Me", flags: 0 } as unknown as NonNullable<ReturnType<typeof useAuth.getState>["me"]>;
const loadedList = () => ({ ids: ["1"], byId: { "1": { id: "1", channel_id: "c1", author_id: "u2", mentions: [] } as unknown as DecryptedMessage }, hasOlder: false, hasNewer: false, loading: false, loaded: true, failed: 0, pending: [] });
/** Lets the event queue and the lazy imports behind it run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  FakeWS.all = [];
  vi.stubGlobal("WebSocket", FakeWS);
  api.request = <T>(): Promise<T> => Promise.resolve({} as T);
  voice.handleVoiceEvent.mockClear();
  voice.onReadyVoice.mockClear();
  useVoice.getState().clear();
  useAuth.setState({ status: "ready", me, identity, settingsKey: new Uint8Array(32), token: "tok" });
});

afterEach(() => {
  stopSession();
  vi.unstubAllGlobals();
});

describe("locking", () => {
  it("forgets the keys and the messages and closes the socket, with no route guard to remember it", async () => {
    await startSession();
    const ws = FakeWS.all[0]!;
    ws.open();
    useMessages.setState({ channels: { c1: loadedList() } });
    useAuth.setState({ status: "pinlocked", identity: null, settingsKey: null });
    expect(ws.readyState).toBe(3);
    expect(gateway()).toBeNull();
    expect(useKeys.getState().identity).toBeNull();
    expect(useMessages.getState().channels["c1"]).toBeUndefined();
  });

  it("keeps a call going through the lock, applying only the call's own events, and connects afresh on unlock", async () => {
    await startSession();
    const ws = FakeWS.all[0]!;
    ws.open();
    useVoice.setState({ mine: { channel_id: "v1", user_id: "me" } as never });
    useMessages.setState({ channels: { c1: loadedList() } });
    useAuth.setState({ status: "pinlocked", identity: null, settingsKey: null });
    // the readable things go, the socket stays
    expect(ws.readyState).toBe(1);
    expect(useKeys.getState().identity).toBeNull();
    expect(useMessages.getState().channels["c1"]).toBeUndefined();
    ws.message({ t: "typing", d: { channel_id: "c1", user_id: "u2" } });
    ws.message({ t: "voice_state", d: { channel_id: "v1", user_id: "u2" } });
    await settle();
    expect(useTyping.getState().byChannel["c1"]?.["u2"]).toBeUndefined();
    expect(voice.handleVoiceEvent).toHaveBeenCalledTimes(1);
    // unlocking brings a fresh ready on a new socket; the old one is let go
    useAuth.setState({ status: "ready", identity, settingsKey: new Uint8Array(32) });
    await startSession();
    expect(ws.readyState).toBe(3);
    expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1]!.open();
    FakeWS.all[1]!.message({ t: "typing", d: { channel_id: "c1", user_id: "u3" } });
    await settle();
    expect(useTyping.getState().byChannel["c1"]?.["u3"]).toBeDefined();
  });
});

describe("the event queue", () => {
  it("says so when a handler throws, and goes on with the next event", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const set = useReadStates.getState().set;
    useReadStates.setState({
      set: () => {
        throw new Error("boom");
      },
    });
    try {
      void enqueueEvent({ t: "read_state", d: { channel_id: "c1", last_read_message_id: "1", mention_count: 0 } } as never);
      await enqueueEvent({ t: "typing", d: { channel_id: "c9", user_id: "u4" } } as never);
      expect(warn).toHaveBeenCalledWith("gateway: the handler for an event failed", "read_state", expect.any(Error));
      expect(useTyping.getState().byChannel["c9"]?.["u4"]).toBeDefined();
    } finally {
      useReadStates.setState({ set });
      warn.mockRestore();
    }
  });
});

describe("the connection banner", () => {
  it("says why a socket was turned away as one too many, and nothing for an ordinary drop", () => {
    expect(connectionNote("closed", { code: CLOSE_TOO_MANY, reason: "too many connections for this account" })).toMatch(/too many/i);
    expect(connectionNote("closed", { code: CLOSE_TOO_MANY, reason: "too many connections from this address" })).toMatch(/network/i);
    expect(connectionNote("closed", { code: CLOSE_TOO_MANY, reason: "the server is at its connection limit" })).toMatch(/full/i);
    expect(connectionNote("closed", { code: 1006, reason: "" })).toBeNull();
    expect(connectionNote("connecting")).toBeUndefined();
  });

  it("keeps the reason through the reconnect it explains, and drops it once connected", () => {
    const ui = useUI.getState();
    ui.setConnection("closed", "Too many tabs");
    ui.setConnection("connecting");
    expect(useUI.getState().connectionNote).toBe("Too many tabs");
    ui.setConnection("open");
    expect(useUI.getState().connectionNote).toBeNull();
  });
});
