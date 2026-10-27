import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceState } from "@/api/types";
import { SfuTransport } from "./sfu";
import { voice } from "@/api/voice";

vi.mock("@/api/voice", () => ({ voice: {
  sfuSession: vi.fn(), sfuPublish: vi.fn(), sfuSubscribe: vi.fn(), sfuClose: vi.fn(),
} }));
vi.mock("./e2ee", () => ({
  FrameCrypto: class { static legacy() { return false; } setKeys() {} protectSender() {} close() {} },
  voiceKeysFor: () => ({ keys: [{ index: 1, raw: new Uint8Array(32) }], send: 1, version: "1" }),
  voiceKeysVersion: () => "1",
}));
vi.mock("./videoCap", () => ({ sharesInH264: async () => false }));

class PeerConnection {
  static all: PeerConnection[] = [];
  connectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  signalingState = "stable";
  ontrack = null;
  onconnectionstatechange = null;
  constructor() { PeerConnection.all.push(this); }
  addTransceiver() { return { mid: "0", sender: { replaceTrack: async () => undefined } }; }
  createOffer() { return Promise.resolve({ type: "offer", sdp: "v=0" }); }
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = value; }
  async setRemoteDescription() {}
  close() { this.connectionState = "closed"; }
}

afterEach(() => vi.unstubAllGlobals());
describe("SFU moderation recovery", () => {
  it("joins without publishing forbidden audio, then reconnects and republishes after unmute", async () => {
    vi.stubGlobal("RTCPeerConnection", PeerConnection);
    PeerConnection.all = [];
    vi.mocked(voice.sfuSession).mockResolvedValueOnce({ session_id: "restricted" }).mockResolvedValueOnce({ session_id: "allowed" });
    vi.mocked(voice.sfuPublish).mockResolvedValue({ answer: { type: "answer", sdp: "v=0" }, failed: 0 });
    const errors = vi.fn();
    const transport = new SfuTransport("1", "2", [], { onSignal: vi.fn(), onPeerState: vi.fn(), onRemoteStream: vi.fn(), onSpeaking: vi.fn(), onError: errors });
    const state = (generation: number, muted: boolean) => ({ user_id: "1", channel_id: "2", sfu_generation: generation, server_mute: muted } as VoiceState);
    try {
      transport.setLocalAudio({ kind: "audio" } as MediaStreamTrack);
      transport.setRoster([state(0, true)]);
      transport.joined(state(0, true));
      await vi.waitFor(() => expect(transport.currentSession()).toBe("restricted"));
      expect(voice.sfuPublish).not.toHaveBeenCalled();
      transport.setRoster([state(1, false)]);
      await vi.waitFor(() => expect(voice.sfuPublish).toHaveBeenCalledTimes(1));
      expect(transport.currentSession()).toBe("allowed");
      expect(vi.mocked(voice.sfuPublish).mock.calls[0]![0]).toMatchObject({ session_id: "allowed", tracks: [{ mid: "0", kind: "audio" }] });
      expect(PeerConnection.all[0]!.connectionState).toBe("closed");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      transport.close();
    }
  });
});
