import { SizeGuard, VP8, vp8Header } from "./frameSize";

/** A VP8 keyframe as an encoder writes it: frame tag (keyframe, shown), start code, 14-bit width and height, then data. */
function vp8Key(width: number, height: number, body = 40, scaleBits = 0): Uint8Array {
  const d = new Uint8Array(10 + body).fill(0xa7);
  const tag = (1 << 4) | (body << 5); // bit 0 clear: a keyframe
  d[0] = tag & 0xff;
  d[1] = (tag >> 8) & 0xff;
  d[2] = (tag >> 16) & 0xff;
  d.set([0x9d, 0x01, 0x2a], 3);
  d[6] = width & 0xff;
  d[7] = ((width >> 8) & 0x3f) | (scaleBits << 6);
  d[8] = height & 0xff;
  d[9] = ((height >> 8) & 0x3f) | (scaleBits << 6);
  return d;
}

/** An inter frame: bit 0 of the frame tag set, no size of its own. */
function vp8Inter(len = 30): Uint8Array {
  const d = new Uint8Array(len).fill(0x5a);
  d[0] = 0x31;
  return d;
}

/** Deterministic noise, so a failing case can be run again. */
function noise(seed: number, len: number): Uint8Array {
  const d = new Uint8Array(len);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < len; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = x & 0xff;
  }
  return d;
}

describe("the VP8 keyframe header", () => {
  it("reads the size a keyframe declares", () => {
    expect(vp8Header(vp8Key(640, 480))).toEqual({ key: true, size: { width: 640, height: 480 } });
    expect(vp8Header(vp8Key(7680, 4320))).toEqual({ key: true, size: { width: 7680, height: 4320 } });
    expect(vp8Header(vp8Key(16383, 16383))).toEqual({ key: true, size: { width: 16383, height: 16383 } });
  });

  it("reads the coded size and leaves the scaling hint alone, as decoders do", () => {
    expect(vp8Header(vp8Key(1280, 720, 40, 3))).toEqual({ key: true, size: { width: 1280, height: 720 } });
  });

  it("finds no size in an inter frame", () => {
    expect(vp8Header(vp8Inter())).toEqual({ key: false });
    expect(vp8Header(new Uint8Array([0x01]))).toEqual({ key: false });
    expect(vp8Header(new Uint8Array(0))).toEqual({ key: false });
  });

  it("calls a keyframe broken when its header is cut short or wrong", () => {
    const key = vp8Key(640, 480);
    for (let n = 1; n < 10; n++) expect(vp8Header(key.subarray(0, n))).toEqual({ key: true, size: null });
    const badStart = key.slice();
    badStart[4] = 0x02;
    expect(vp8Header(badStart)).toEqual({ key: true, size: null });
    expect(vp8Header(vp8Key(0, 480))).toEqual({ key: true, size: null });
    expect(vp8Header(vp8Key(640, 0))).toEqual({ key: true, size: null });
    // what H.264 and AV1 frames begin with is no VP8 keyframe either
    expect(vp8Header(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0]))).toEqual({ key: true, size: null });
    expect(vp8Header(new Uint8Array([0x12, 0x00, 0x0a, 0x0b, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ key: true, size: null });
  });

  it("never throws on noise, and reads a size only after the start code", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const d = noise(seed, seed % 64);
      const h = vp8Header(d);
      if (h.key && h.size) expect([d[3], d[4], d[5]]).toEqual([0x9d, 0x01, 0x2a]);
    }
  });
});

describe("the size guard", () => {
  it("lets through the pictures real screens and cameras make, and the frames after them", () => {
    const sizes = [
      [640, 360],
      [1920, 1080],
      [3840, 2160],
      [5120, 1440],
      [7680, 2160],
      [7680, 4320],
      [4320, 7680],
      [8192, 4050],
    ] as const;
    for (const [w, h] of sizes) {
      const g = new SizeGuard();
      expect(g.check(vp8Key(w, h), VP8)).toBe("pass");
      expect(g.check(vp8Inter(), VP8)).toBe("pass");
      expect(g.blocked).toBe(false);
      expect(g.size).toEqual({ width: w, height: h });
    }
  });

  it("drops a keyframe over the cap, and everything after it until a keyframe within the cap", () => {
    const g = new SizeGuard();
    expect(g.check(vp8Key(1920, 1080), VP8)).toBe("pass");
    expect(g.check(vp8Inter(), VP8)).toBe("pass");
    expect(g.check(vp8Key(16383, 16383), VP8)).toBe("drop");
    expect(g.blocked).toBe(true);
    for (let i = 0; i < 5; i++) expect(g.check(vp8Inter(), VP8)).toBe("drop");
    // a keyframe no decoder can start from does not end it
    expect(g.check(vp8Key(1920, 1080).subarray(0, 6), VP8)).toBe("drop");
    expect(g.blocked).toBe(true);
    expect(g.check(vp8Key(1280, 720), VP8)).toBe("pass");
    expect(g.blocked).toBe(false);
    expect(g.check(vp8Inter(), VP8)).toBe("pass");
  });

  it("holds each side and the pixel count to the cap", () => {
    for (const [w, h] of [
      [8193, 100],
      [100, 8193],
      [8192, 4051],
      [8192, 8192],
      [7681, 4320],
    ] as const) {
      const g = new SizeGuard();
      expect(g.check(vp8Key(w, h), VP8)).toBe("drop");
      expect(g.blocked).toBe(true);
    }
  });

  it("drops a broken keyframe of a stream known to be VP8, without blocking it", () => {
    const g = new SizeGuard("pass");
    const bad = vp8Key(640, 480);
    bad[3] = 0;
    expect(g.check(bad, VP8)).toBe("drop");
    expect(g.blocked).toBe(false);
    expect(g.check(vp8Inter(), VP8)).toBe("pass");
  });

  it("treats frames of another codec as the guard was told to, and drops them while blocked", () => {
    const h264 = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xda, 0x01, 0x40]);
    const sfu = new SizeGuard("drop");
    expect(sfu.check(h264, "video/H264")).toBe("drop");
    expect(sfu.check(vp8Inter(), "video/AV1")).toBe("drop");
    const mesh = new SizeGuard("pass");
    expect(mesh.check(h264, "video/H264")).toBe("pass");
    expect(mesh.check(vp8Key(16383, 16383), "video/VP8")).toBe("drop");
    expect(mesh.check(h264, "video/H264")).toBe("drop");
  });

  it("reads the MIME type whatever its case", () => {
    const g = new SizeGuard("pass");
    expect(g.check(vp8Key(16383, 100), "video/VP8")).toBe("drop");
    expect(g.blocked).toBe(true);
  });

  it("with no codec known, checks what reads as VP8 and treats the rest as another codec", () => {
    const sfu = new SizeGuard("drop");
    expect(sfu.check(vp8Key(1920, 1080))).toBe("pass");
    expect(sfu.check(vp8Inter())).toBe("pass");
    expect(sfu.check(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0]))).toBe("drop");
    expect(sfu.check(vp8Key(10000, 10000))).toBe("drop");
    expect(sfu.blocked).toBe(true);
    const mesh = new SizeGuard("pass");
    expect(mesh.check(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0]))).toBe("pass");
    expect(mesh.check(vp8Key(10000, 10000))).toBe("drop");
    expect(mesh.check(new Uint8Array([0, 0, 0, 1, 0x65, 0x88]))).toBe("drop");
  });

  it("never throws, whatever it is given", () => {
    const g = new SizeGuard();
    for (let seed = 1; seed <= 3000; seed++) {
      const v = g.check(noise(seed, (seed * 7) % 300), seed % 3 === 0 ? VP8 : seed % 3 === 1 ? undefined : "video/H264");
      expect(v === "pass" || v === "drop").toBe(true);
    }
    expect(g.check(new Uint8Array(1 << 20), VP8)).toBe("drop");
  });
});
