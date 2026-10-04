import { describe, expect, it } from "vitest";
import { FIRST_FRAME_COUNTER, H264_TRAILER, frameIv, importFrameKey, nextCounter, openH264Frame, sealH264Frame } from "./frameCrypto";
import { isAnnexB, naluClearBytes, naluIndices, spsSize, type Nalu } from "./h264";
import { BASELINE_SPS_176x144, TINY_HIGH, TINY_HIGH_FRAMES } from "./h264.fixture";

const frames = TINY_HIGH_FRAMES.map((at, i) => TINY_HIGH.subarray(at, TINY_HIGH_FRAMES[i + 1] ?? TINY_HIGH.length));
const units = (data: Uint8Array) => naluIndices(data).map((n) => data.subarray(n.payload, n.end));
const types = (data: Uint8Array) => naluIndices(data).map((n) => data[n.payload]! & 0x1f);
// ivs as a sender makes them: no zero byte anywhere (frameCrypto.ts nextCounter)
const iv = (n: number) => frameIv(Uint8Array.from([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7]), FIRST_FRAME_COUNTER + (n % 250));

/** What a receiver's depacketizer hands on: every NAL unit after a 4-byte start code. */
function depacketized(data: Uint8Array): Uint8Array {
  const parts = units(data);
  const out = new Uint8Array(parts.reduce((sum, u) => sum + 4 + u.length, 0));
  let o = 0;
  for (const u of parts) {
    out.set([0, 0, 0, 1], o);
    out.set(u, o + 4);
    o += 4 + u.length;
  }
  return out;
}

async function keyPair() {
  const raw = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
  return { key: await importFrameKey(raw), keys: new Map([[5, await importFrameKey(raw)]]) };
}

describe("naluIndices", () => {
  it("finds every NAL unit of a frame, its start code 3 or 4 bytes long, as WebRTC does", () => {
    const found = naluIndices(TINY_HIGH);
    expect(found.map((n) => [n.start, n.payload, n.end])).toEqual([
      [0, 4, 28], [28, 32, 38], [38, 41, 673], [673, 676, 1673], [1673, 1676, 1859],
      [1859, 1863, 2038], [2038, 2041, 2049], [2049, 2053, 2214], [2214, 2217, 2228],
    ]);
    expect(types(TINY_HIGH)).toEqual([7, 8, 6, 5, 5, 1, 1, 1, 1]);
  });

  it("tells H.264 from VP8 by its opening start code", () => {
    expect(isAnnexB(TINY_HIGH)).toBe(true);
    expect(isAnnexB(Uint8Array.from([0x50, 0x42, 0x00, 0x9d, 0x01, 0x2a]))).toBe(false);
  });
});

describe("spsSize", () => {
  const sps = (data: Uint8Array) => naluIndices(data).find((n) => (data[n.payload]! & 0x1f) === 7)!;

  it("reads the picture a high profile SPS sets up, in whole macroblocks, past an emulation prevention byte", () => {
    expect(spsSize(TINY_HIGH, sps(TINY_HIGH))).toEqual({ width: 96, height: 48 });
  });

  it("reads a baseline profile SPS", () => {
    expect(spsSize(BASELINE_SPS_176x144, sps(BASELINE_SPS_176x144))).toEqual({ width: 176, height: 144 });
  });

  it("gives up on an SPS cut short", () => {
    const cut = BASELINE_SPS_176x144.subarray(0, 9);
    expect(spsSize(cut, sps(cut))).toBeNull();
  });
});

describe("naluClearBytes", () => {
  it("keeps parameter sets and SEI whole, and of a slice only its header up to the PPS id", () => {
    const clear = naluIndices(frames[0]!).map((n) => naluClearBytes(frames[0]!, n));
    expect(clear.slice(0, 3)).toEqual([24, 6, 632]);
    for (const c of clear.slice(3)) expect(c).toBeGreaterThanOrEqual(2);
    for (const c of clear.slice(3)) expect(c).toBeLessThanOrEqual(5);
  });

  it("refuses a slice too short to name its PPS", () => {
    const nalu: Nalu = { start: 0, payload: 4, end: 5 };
    expect(naluClearBytes(Uint8Array.from([0, 0, 0, 1, 0x65]), nalu)).toBeNull();
  });
});

describe("sealH264Frame and openH264Frame", () => {
  it("seals every frame so its NAL units stay where they were, the picture unreadable, and opens it again", async () => {
    const { key, keys } = await keyPair();
    for (const frame of frames) {
      const sealed = (await sealH264Frame(key, 5, iv(1), frame))!;
      expect(sealed).not.toBeNull();
      // the packetizer finds the same units, the last one carrying the trailer
      const before = units(frame);
      const after = units(sealed);
      expect(after.map((u) => u.length)).toEqual(before.map((u, i) => u.length + (i === before.length - 1 ? H264_TRAILER : 0)));
      // headers and parameter sets read the same; the pictures do not
      naluIndices(frame).forEach((n, i) => {
        const clear = naluClearBytes(frame, n)!;
        expect(after[i]!.subarray(0, clear)).toEqual(before[i]!.subarray(0, clear));
        if (clear < before[i]!.length) expect(after[i]!.subarray(clear, before[i]!.length)).not.toEqual(before[i]!.subarray(clear));
      });
      expect(await openH264Frame(keys, sealed)).toEqual(depacketized(frame));
      // and through a receiver's depacketizer, which writes every start code as 4 bytes
      expect(await openH264Frame(keys, depacketized(sealed))).toEqual(depacketized(frame));
    }
  });

  it("opens nothing that was altered, readable parts included, or sealed under another key", async () => {
    const { key, keys } = await keyPair();
    const sealed = (await sealH264Frame(key, 5, iv(2), frames[0]!))!;
    const at = (n: number) => {
      const copy = sealed.slice();
      copy[n] = copy[n]! ^ 1;
      return copy;
    };
    const nalus = naluIndices(sealed);
    // the SPS's level byte, a slice's readable header, a slice's sealed picture
    for (const n of [nalus[0]!.payload + 3, nalus[3]!.payload + 1, nalus[3]!.payload + 40]) expect(await openH264Frame(keys, at(n))).toBeNull();
    expect(await openH264Frame(new Map([[5, await importFrameKey(new Uint8Array(32))]]), sealed)).toBeNull();
    expect(await openH264Frame(keys, sealed.subarray(0, 20))).toBeNull();
  });

  it("refuses to send sealed bytes that hold a start code, so a fresh iv can try again", async () => {
    const { key, keys } = await keyPair();
    // a big slice gives the cipher room to make 00 00 01 now and then (about once in 16 million bytes)
    const frame = new Uint8Array(4 + 2 + 2_000_000);
    frame.set([0, 0, 0, 1, 0x65, 0x88]);
    for (let i = 6; i < frame.length; i++) frame[i] = ((i * 2654435761) >>> 24) | 0x10;
    let refused = 0;
    let sent = 0;
    let counter = FIRST_FRAME_COUNTER;
    for (let n = 0; n < 300 && (refused === 0 || sent === 0); n++, counter = nextCounter(counter)) {
      const sealed = await sealH264Frame(key, 5, frameIv(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), counter), frame);
      if (!sealed) {
        refused++;
        continue;
      }
      sent++;
      expect(naluIndices(sealed)).toHaveLength(1);
      // compared as buffers: an element-by-element toEqual on 2 MB takes seconds
      expect(Buffer.from((await openH264Frame(keys, sealed))!).equals(Buffer.from(frame))).toBe(true);
    }
    expect(refused).toBeGreaterThan(0);
    expect(sent).toBeGreaterThan(0);
  });

  it("does not seal a frame that is not Annex B", async () => {
    const { key } = await keyPair();
    expect(await sealH264Frame(key, 5, iv(3), Uint8Array.from([0x50, 0x42, 0x00, 0x9d, 0x01, 0x2a, 1, 2, 3]))).toBeNull();
  });
});

describe("the H.264 vector the Android app checks itself against (CallTestHooks SEAL)", () => {
  const unhex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));
  const plain = "000000016742c00ad902c4ec0440000003004000000503c48992" + "00000168ce3c80" + "0000000165888400a1b2c3d4e5f60718293a4b5c6d7e8f" + "000001419a0210deadbeefcafe";
  const sealed =
    "000000016742c00ad902c4ec0440000003004000000503c48992" + "0000000168ce3c80" + "000000016588840" + "7d58e6a566d4037423db470141ffdc4" +
    "00000001419aadd620d77c434e73" + "e8d7635e59436cecf3bc6bd775f9b66a" + "a0a1a2a3a4a5a6a701020304" + "05";

  it("seals to the same bytes and opens them again, every start code then 4 bytes long", async () => {
    const key = await importFrameKey(unhex("b12789f29993834f2127e2379c3be51b0351a9ddae44147d3570de350a7cccb9"));
    expect(await sealH264Frame(key, 261 & 0xff, unhex("a0a1a2a3a4a5a6a701020304"), unhex(plain))).toEqual(unhex(sealed));
    expect(await openH264Frame(new Map([[5, key]]), unhex(sealed))).toEqual(unhex(plain.replace("00000168ce3c80", "0000000168ce3c80").replace("000001419a", "00000001419a")));
  });
});
