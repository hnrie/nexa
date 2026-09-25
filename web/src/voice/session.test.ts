// @vitest-environment jsdom
import type { Channel, VoiceState } from "@/api/types";
import { startRinging, stopRinging } from "@/lib/sounds";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useVoice } from "@/stores/voice";
import { closeRingNotice, missedNotice } from "./callNotice";
import * as engine from "./engine";
import { handleVoiceEvent, installVoice, joinVoice, leaveVoice, onReadyVoice } from "./session";

vi.mock("@/lib/sounds", () => ({ playSound: vi.fn(), startRinging: vi.fn(), stopRinging: vi.fn(), startCalling: vi.fn(), stopCalling: vi.fn() }));
vi.mock("@/gateway/session", () => ({ gateway: () => null }));
vi.mock("@/api/voice", () => ({ voice: { ice: vi.fn(async () => ({ ice_servers: [], sfu: false, guests: true })), decline: vi.fn(async () => undefined), callSummary: vi.fn(async () => undefined) } }));
vi.mock("./media", () => ({ audioContext: vi.fn(), resumeAudio: vi.fn() }));
vi.mock("./callNotice", () => ({ ringNotice: vi.fn(), missedNotice: vi.fn(), closeRingNotice: vi.fn() }));
// the call itself: what the app around it does is what is tested here
let inCall: string | null = null;
vi.mock("./engine", () => ({
  join: vi.fn(async (channelId: string) => {
    inCall = channelId;
    return true;
  }),
  leave: vi.fn(() => {
    inCall = null;
  }),
  current: vi.fn(() => (inCall ? { channelId: inCall, announced: true } : null)),
  onMine: vi.fn(() => true),
  onOther: vi.fn(() => null),
  onSignal: vi.fn(),
  onResumed: vi.fn(),
  onReady: vi.fn(),
  throughSfu: vi.fn(() => false),
  setOutputMuted: vi.fn(),
  applyTransmit: vi.fn(),
  setWatching: vi.fn(),
  setPttHeld: vi.fn(),
}));

function state(over: Partial<VoiceState>): VoiceState {
  return { user_id: "me", channel_id: "c1", session_id: "s1", self_mute: false, self_deaf: false, video: false, streaming: false, server_mute: false, server_deaf: false, joined_at: 1, ...over };
}

const toasts = () => useUI.getState().toasts.map((t) => t.text);

describe("voice events", () => {
  beforeAll(() => installVoice());
  beforeEach(async () => {
    await leaveVoice(false);
    useAuth.setState({ me: { id: "me" } as never });
    useChannels.setState({ byId: { c1: { id: "c1", type: "dm", recipient_ids: ["me", "bob"], server_id: null } as unknown as Channel } });
    useUsers.setState({ byId: { bob: { id: "bob", display_name: "Bob" } as never } });
    useVoice.getState().clear();
    useUI.setState({ toasts: [] });
    onReadyVoice([], "s1");
    vi.clearAllMocks();
  });

  it("does not take another device's call for this one's", () => {
    useVoice.getState().setRinging("c1", "friend");
    handleVoiceEvent({ t: "voice_state", d: state({ session_id: "s2" }) });
    expect(useVoice.getState().mine).toBeNull();
    // answered elsewhere, so this device stops ringing
    expect(useVoice.getState().ringing.c1).toBeUndefined();
    expect(missedNotice).not.toHaveBeenCalled();
  });

  it("shows no call when this device is not in one", () => {
    handleVoiceEvent({ t: "voice_state", d: state({}) });
    expect(useVoice.getState().mine).toBeNull();
  });

  it("ignores refused signals instead of reporting them", () => {
    handleVoiceEvent({ t: "voice_error", d: { code: "peer_gone", message: "That user is not in your voice channel." } });
    expect(useVoice.getState().error).toBeNull();
    expect(useUI.getState().toasts).toHaveLength(0);
    handleVoiceEvent({ t: "voice_error", d: { code: "channel_full", message: "That voice channel is full." } });
    expect(useVoice.getState().error).toBe("That voice channel is full.");
  });

  it("rings until the call is answered or ends", () => {
    handleVoiceEvent({ t: "call_ring", d: { channel_id: "c1", from: "friend" } });
    expect(startRinging).toHaveBeenCalledTimes(1);
    handleVoiceEvent({ t: "call_ring", d: { channel_id: "c2", from: "other" } });
    expect(startRinging).toHaveBeenCalledTimes(1);
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c1", reason: "ended" } });
    expect(stopRinging).not.toHaveBeenCalled();
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c2", reason: "ended" } });
    expect(stopRinging).toHaveBeenCalledTimes(1);
  });

  it("calls a ring that ended with nobody here picking up a missed call", () => {
    handleVoiceEvent({ t: "call_ring", d: { channel_id: "c1", from: "bob" } });
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c1", reason: "ended" } });
    expect(missedNotice).toHaveBeenCalledWith("c1", "bob");
  });

  it("does not call a ring answered on another device missed", () => {
    handleVoiceEvent({ t: "call_ring", d: { channel_id: "c1", from: "bob" } });
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c1", user_id: "me", reason: "answered" } });
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c1", reason: "ended" } });
    expect(closeRingNotice).toHaveBeenCalledWith("c1");
    expect(missedNotice).not.toHaveBeenCalled();
  });

  it("stops a ring whose call ended while the gateway was away", () => {
    handleVoiceEvent({ t: "call_ring", d: { channel_id: "c1", from: "bob" } });
    onReadyVoice([], "s1");
    expect(useVoice.getState().ringing.c1).toBeUndefined();
    expect(missedNotice).toHaveBeenCalledWith("c1", "bob");
  });

  it("says so when another device of this account picks the call up", async () => {
    await joinVoice("c1");
    handleVoiceEvent({ t: "voice_state", d: state({ channel_id: null, old_channel_id: "c1", reason: "moved" }) });
    expect(engine.leave).toHaveBeenCalledWith(false);
    expect(toasts()).toContain("Your call moved to another device.");
  });

  it("gives a call up when the one person called declines it", async () => {
    await joinVoice("c1");
    expect(useVoice.getState().calling).toBe("c1");
    handleVoiceEvent({ t: "call_end", d: { channel_id: "c1", user_id: "bob", reason: "declined" } });
    expect(useVoice.getState().calling).toBeNull();
    expect(toasts()).toContain("Bob declined the call.");
    expect(engine.leave).toHaveBeenCalledWith(true);
  });

  it("hands the server's word that it let the call go to the call", async () => {
    await joinVoice("c1");
    handleVoiceEvent({ t: "voice_resumed", d: { channel_id: "c1", kept: false } });
    expect(engine.onResumed).toHaveBeenCalled();
  });
});
