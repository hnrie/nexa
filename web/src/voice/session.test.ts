// @vitest-environment jsdom
import type { VoiceState } from "@/api/types";
import { startRinging, stopRinging } from "@/lib/sounds";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { useVoice } from "@/stores/voice";
import { handleVoiceEvent, installVoice, onReadyVoice } from "./session";

vi.mock("@/lib/sounds", () => ({ playSound: vi.fn(), startRinging: vi.fn(), stopRinging: vi.fn() }));
vi.mock("@/gateway/session", () => ({ gateway: () => null }));

function state(over: Partial<VoiceState>): VoiceState {
  return { user_id: "me", channel_id: "c1", session_id: "s1", self_mute: false, self_deaf: false, video: false, streaming: false, server_mute: false, server_deaf: false, joined_at: 1, ...over };
}

describe("voice events", () => {
  beforeAll(() => installVoice());
  beforeEach(() => {
    useAuth.setState({ me: { id: "me" } as never });
    useVoice.getState().clear();
    useUI.setState({ toasts: [] });
    onReadyVoice([], "s1");
    vi.mocked(startRinging).mockClear();
    vi.mocked(stopRinging).mockClear();
  });

  it("does not take another device's call for this one's", () => {
    useVoice.getState().setRinging("c1", "friend");
    handleVoiceEvent({ t: "voice_state", d: state({ session_id: "s2" }) });
    expect(useVoice.getState().mine).toBeNull();
    // answered elsewhere, so this device stops ringing
    expect(useVoice.getState().ringing.c1).toBeUndefined();
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
});
