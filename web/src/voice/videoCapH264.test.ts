import { afterEach, describe, expect, it, vi } from "vitest";

const codec = (mimeType: string, sdpFmtpLine?: string) => ({ mimeType, clockRate: 90000, ...(sdpFmtpLine ? { sdpFmtpLine } : {}) });
const CODECS = [
  codec("video/VP8"),
  codec("video/rtx", "apt=96"),
  codec("video/H264", "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f"),
  codec("video/H264", "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"),
  codec("video/VP9"),
];

/** A fresh copy of the module, since what it learns about the device is kept for the page's life. */
async function load() {
  vi.resetModules();
  return import("./videoCap");
}

function device(platform: string | undefined, powerEfficient: boolean, codecs = CODECS) {
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs, headerExtensions: [] }) });
  vi.stubGlobal("navigator", {
    ...(platform ? { userAgentData: { platform } } : {}),
    mediaCapabilities: { encodingInfo: async () => ({ supported: true, smooth: true, powerEfficient }) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("sharing in H.264", () => {
  it("is for a Mac whose H.264 encoder is the hardware one", async () => {
    device("macOS", true);
    expect(await (await load()).sharesInH264()).toBe(true);
  });

  it("stays on VP8 where the encoder is software, off a Mac, or outside Chromium", async () => {
    device("macOS", false);
    expect(await (await load()).sharesInH264()).toBe(false);
    device("Windows", true);
    expect(await (await load()).sharesInH264()).toBe(false);
    device(undefined, true);
    expect(await (await load()).sharesInH264()).toBe(false);
    device("macOS", true, CODECS.filter((c) => c.mimeType !== "video/H264"));
    expect(await (await load()).sharesInH264()).toBe(false);
  });

  it("asks for H.264 alone, packetisation mode 1 first, with retransmissions", async () => {
    device("macOS", true);
    const { preferH264 } = await load();
    let list: RTCRtpCodec[] = [];
    const tr = { setCodecPreferences: (l: RTCRtpCodec[]) => void (list = l) } as unknown as RTCRtpTransceiver;
    expect(preferH264(tr)).toBe(true);
    expect(list.map((c) => c.mimeType)).toEqual(["video/H264", "video/H264", "video/rtx"]);
    expect(list[0]!.sdpFmtpLine).toContain("packetization-mode=1");
    const refusing = { setCodecPreferences: () => { throw new Error("InvalidModificationError"); } } as unknown as RTCRtpTransceiver;
    expect(preferH264(refusing)).toBe(false);
  });
});
