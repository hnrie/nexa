import { VIDEO_CAP, capScale, capSender, clampBitrate, clampFps, fitsCap, preferVp8, recapSender, safeAspect, scaleFromStats } from "./videoCap";

/** The size an encoder makes of a picture divided by `scale`, rounding each side to the nearest pixel as libwebrtc does. */
const scaled = (w: number, h: number, scale: number) => [Math.round(w / scale), Math.round(h / scale)] as const;

describe("the video size cap", () => {
  it("fits 8K and every real screen shape, and nothing over", () => {
    expect(VIDEO_CAP.pixels).toBe(33_177_600);
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [5120, 1440],
      [7680, 2160],
      [7680, 4320],
      [4320, 7680],
      [8192, 4050],
    ])
      expect(fitsCap(w!, h!)).toBe(true);
    for (const [w, h] of [
      [8193, 1],
      [1, 8193],
      [8192, 4051],
      [16383, 16383],
      [0, 100],
      [-5, 100],
      [NaN, 100],
      [Infinity, 1],
      [1920.5, 1080],
    ])
      expect(fitsCap(w!, h!)).toBe(false);
  });

  it("scales a larger picture down in proportion until it fits, rounding included", () => {
    expect(capScale(3840, 2160)).toBe(1);
    expect(capScale(7680, 4320)).toBe(1);
    for (const [w, h] of [
      [11520, 2160],
      [10240, 2880],
      [16384, 16384],
      [8192, 8192],
      [8200, 4096],
      [16384, 64],
    ]) {
      const s = capScale(w!, h!);
      expect(s).toBeGreaterThan(1);
      const [sw, sh] = scaled(w!, h!, s);
      expect(fitsCap(sw, sh)).toBe(true);
      // the shape is kept
      expect(Math.abs(sw / sh - w! / h!) / (w! / h!)).toBeLessThan(0.01);
    }
    const [w, h] = scaled(11520, 2160, capScale(11520, 2160));
    expect(w).toBeGreaterThan(8150);
    expect(h).toBeGreaterThan(1520);
  });

  it("leaves a size it cannot read alone", () => {
    for (const [w, h] of [
      [0, 0],
      [NaN, 1080],
      [1920, Infinity],
      [-1, -1],
    ])
      expect(capScale(w!, h!)).toBe(1);
  });

  it("holds frame rates and bitrates to sane numbers", () => {
    expect(clampFps(60)).toBe(60);
    expect(clampFps(15)).toBe(15);
    expect(clampFps(1e9)).toBe(60);
    expect(clampFps(-3)).toBe(1);
    expect(clampFps(NaN)).toBe(30);
    expect(clampFps("60")).toBe(30);
    expect(clampFps(Infinity, 15)).toBe(15);
    expect(clampBitrate(5_000_000, 1_000_000, 12_000_000, 5_000_000)).toBe(5_000_000);
    expect(clampBitrate(1e15, 1_000_000, 12_000_000, 5_000_000)).toBe(12_000_000);
    expect(clampBitrate(10, 1_000_000, 12_000_000, 5_000_000)).toBe(1_000_000);
    for (const bad of [NaN, -1, 0, Infinity, "8000000", null]) expect(clampBitrate(bad, 1_000_000, 12_000_000, 5_000_000)).toBe(5_000_000);
  });

  it("keeps a received picture's shape within reason for its tile", () => {
    expect(safeAspect(1920, 1080)).toBeCloseTo(16 / 9);
    expect(safeAspect(16383, 1)).toBe(16);
    expect(safeAspect(1, 16383)).toBe(1 / 16);
    for (const [w, h] of [
      [0, 1080],
      [1920, 0],
      [NaN, 1],
      [Infinity, 1],
      [-1920, -1080],
    ])
      expect(safeAspect(w!, h!)).toBeNull();
  });
});

describe("what a sender sends", () => {
  interface Enc {
    maxBitrate?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
  }
  function fakeSender(encodings: Enc[], stats: Record<string, unknown>[] = []) {
    const set: { encodings: Enc[] }[] = [];
    const sender = {
      track: { kind: "video", readyState: "live" },
      getParameters: () => ({ transactionId: "t", encodings: encodings.map((e) => ({ ...e })) }),
      setParameters: async (p: { encodings: Enc[] }) => {
        set.push(p);
        encodings = p.encodings;
      },
      getStats: async () => new Map(stats.map((s, i) => [String(i), s])),
    };
    return { sender: sender as unknown as RTCRtpSender, set, now: () => encodings };
  }

  it("caps the bitrate and frame rate, and scales a picture over the cap down", () => {
    const f = fakeSender([{ maxFramerate: 120 }]);
    capSender(f.sender, 8_000_000, { width: 16384, height: 16384 });
    const enc = f.now()[0]!;
    expect(enc.maxBitrate).toBe(8_000_000);
    expect(enc.maxFramerate).toBe(60);
    const [w, h] = scaled(16384, 16384, enc.scaleResolutionDownBy!);
    expect(fitsCap(w, h)).toBe(true);
  });

  it("keeps a lower frame rate, and the scale already set when no size is given", () => {
    const f = fakeSender([{ maxFramerate: 30, scaleResolutionDownBy: 2 }]);
    capSender(f.sender, 1_500_000);
    expect(f.now()[0]).toEqual({ maxBitrate: 1_500_000, maxFramerate: 30, scaleResolutionDownBy: 2 });
  });

  it("still caps the bitrate where the browser refuses the frame rate or the scale", async () => {
    let encodings: Enc[] = [{}];
    const sender = {
      getParameters: () => ({ transactionId: "t", encodings: encodings.map((e) => ({ ...e })) }),
      setParameters: async (p: { encodings: Enc[] }) => {
        if (p.encodings.some((e) => e.maxFramerate !== undefined || e.scaleResolutionDownBy !== undefined)) throw new DOMException("not supported", "InvalidModificationError");
        encodings = p.encodings;
      },
    } as unknown as RTCRtpSender;
    capSender(sender, 1_500_000, { width: 1280, height: 720 });
    await new Promise((r) => setTimeout(r, 0));
    expect(encodings).toEqual([{ maxBitrate: 1_500_000 }]);
  });

  it("gives a sender with no encodings yet one, and never throws", () => {
    const f = fakeSender([]);
    capSender(f.sender, 2_500_000, { width: 1280, height: 720 });
    expect(f.now()).toEqual([{ maxBitrate: 2_500_000, maxFramerate: 60, scaleResolutionDownBy: 1 }]);
    const broken = { getParameters: () => { throw new Error("gone"); } } as unknown as RTCRtpSender;
    expect(() => capSender(broken, 1)).not.toThrow();
  });

  it("works out the scale from the picture going in, or from what went out", () => {
    const source = (width: number, height: number) => ({ type: "media-source", kind: "video", width, height });
    const out = (frameWidth: number, frameHeight: number) => ({ type: "outbound-rtp", kind: "video", frameWidth, frameHeight });
    expect(scaleFromStats([source(3840, 2160)], 1.5)).toBe(1);
    expect(scaleFromStats([out(1, 1), source(16384, 8192)], 1)).toBeCloseTo(capScale(16384, 8192));
    // from what went out, the scale only grows: the encoder may have shrunk the picture for a slow link
    expect(scaleFromStats([out(10000, 5000)], 1)).toBeCloseTo(capScale(10000, 5000));
    expect(scaleFromStats([out(960, 540)], 2)).toBe(2);
    expect(scaleFromStats([{ type: "media-source", kind: "audio", audioLevel: 0.1 }, { type: "inbound-rtp", kind: "video", frameWidth: 99999, frameHeight: 99999 }], 1)).toBeNull();
    expect(scaleFromStats([source(NaN, 100), out(0, 0)], 1)).toBeNull();
  });

  it("rescales a running sender when the picture going in grows or shrinks", async () => {
    const big = fakeSender([{ scaleResolutionDownBy: 1 }], [{ type: "media-source", kind: "video", width: 11520, height: 2160 }]);
    await recapSender(big.sender);
    expect(big.now()[0]!.scaleResolutionDownBy).toBeCloseTo(capScale(11520, 2160));
    const back = fakeSender([{ scaleResolutionDownBy: 1.4 }], [{ type: "media-source", kind: "video", width: 1920, height: 1080 }]);
    await recapSender(back.sender);
    expect(back.now()[0]!.scaleResolutionDownBy).toBe(1);
    const same = fakeSender([{ scaleResolutionDownBy: 1 }], [{ type: "media-source", kind: "video", width: 1920, height: 1080 }]);
    await recapSender(same.sender);
    expect(same.set).toHaveLength(0);
    const failing = { track: { kind: "video", readyState: "live" }, getParameters: () => ({ encodings: [{}] }), getStats: () => Promise.reject(new Error("closed")) } as unknown as RTCRtpSender;
    await expect(recapSender(failing)).resolves.toBeUndefined();
  });
});

describe("asking for VP8 alone", () => {
  const codecs = [
    { mimeType: "video/VP8", clockRate: 90000 },
    { mimeType: "video/rtx", clockRate: 90000 },
    { mimeType: "video/VP9", clockRate: 90000 },
    { mimeType: "video/H264", clockRate: 90000 },
    { mimeType: "video/AV1", clockRate: 90000 },
    { mimeType: "video/red", clockRate: 90000 },
  ];
  afterEach(() => vi.unstubAllGlobals());

  it("keeps VP8 and its retransmissions, and says whether the browser took the list", () => {
    vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs, headerExtensions: [] }) });
    vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs, headerExtensions: [] }) });
    const chosen: unknown[] = [];
    const tr = { setCodecPreferences: (c: unknown[]) => chosen.push(c) } as unknown as RTCRtpTransceiver;
    expect(preferVp8(tr)).toBe(true);
    expect(chosen).toEqual([[codecs[0], codecs[1]]]);
    expect(preferVp8({} as RTCRtpTransceiver)).toBe(false);
    const refusing = { setCodecPreferences: () => { throw new Error("InvalidModificationError"); } } as unknown as RTCRtpTransceiver;
    expect(preferVp8(refusing)).toBe(false);
  });
});
