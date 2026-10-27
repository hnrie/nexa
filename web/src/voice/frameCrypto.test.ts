import { channelKey, voiceFrameKey } from "@/crypto/conv";
import { FIRST_FRAME_COUNTER, MAX_FRAME_COUNTER, clearBytes, frameIv, importFrameKey, newSalt, nextCounter, openFrame, sealFrame } from "./frameCrypto";

const raw = (n: number) => new Uint8Array(32).fill(n);
const frame = (len: number) => Uint8Array.from({ length: len }, (_, i) => (i * 37) & 0xff);

describe("frame encryption", () => {
  it("opens what it seals, for audio and both kinds of video frame", async () => {
    const key = await importFrameKey(raw(1));
    const keys = new Map([[7, key]]);
    const salt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    for (const [kind, keyFrame] of [["audio", false], ["video", true], ["video", false]] as const) {
      const clear = clearBytes(kind, keyFrame);
      const plain = frame(200);
      const sealed = await sealFrame(key, 7, frameIv(salt, 42), plain, clear);
      // the header stays readable for the packetizer and the SFU, the rest does not
      expect(sealed.subarray(0, clear)).toEqual(plain.subarray(0, clear));
      expect(sealed.subarray(clear, 200)).not.toEqual(plain.subarray(clear, 200));
      expect(sealed.length).toBe(200 + 16 + 12 + 1);
      expect(await openFrame(keys, sealed, clear)).toEqual(plain);
    }
  });

  it("refuses a wrong key, an unknown key index and an altered header", async () => {
    const key = await importFrameKey(raw(1));
    const other = await importFrameKey(raw(2));
    const plain = frame(80);
    const sealed = await sealFrame(key, 3, frameIv(new Uint8Array(8), 1), plain, 10);
    expect(await openFrame(new Map([[3, other]]), sealed, 10)).toBeNull();
    expect(await openFrame(new Map([[4, key]]), sealed, 10)).toBeNull();
    const altered = sealed.slice();
    altered[0] = altered[0]! ^ 1;
    expect(await openFrame(new Map([[3, key]]), altered, 10)).toBeNull();
    expect(await openFrame(new Map([[3, key]]), sealed.subarray(0, 20), 10)).toBeNull();
  });

  it("seals frames shorter than their header", async () => {
    const key = await importFrameKey(raw(5));
    const tiny = frame(2);
    const sealed = await sealFrame(key, 0, frameIv(new Uint8Array(8), 5), tiny, 10);
    expect(await openFrame(new Map([[0, key]]), sealed, 10)).toEqual(tiny);
  });

  it("opens retained epochs sharing a legacy wire index without overwriting either", async () => {
    const older = await importFrameKey(raw(1)), newer = await importFrameKey(raw(2));
    const keys = new Map([[7, older], [263, newer]]);
    const plain = frame(80), iv = frameIv(new Uint8Array(8).fill(1), 42);
    for (const [epoch, key] of keys) {
      const sealed = await sealFrame(key, epoch, iv, plain, 1);
      expect(sealed[sealed.length - 1]).toBe(7);
      expect(await openFrame(keys, sealed, 1)).toEqual(plain);
    }
  });

  it("never repeats an IV and keeps the salt", () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = frameIv(salt, 1);
    const b = frameIv(salt, 2);
    expect(a.subarray(0, 8)).toEqual(salt);
    expect(a).not.toEqual(b);
    expect(frameIv(salt, 0xffffffff).subarray(8)).toEqual(new Uint8Array([255, 255, 255, 255]));
  });

  it("makes ivs with no zero byte in them, so a sealed H.264 frame never gets a start code from one", () => {
    for (let i = 0; i < 50; i++) expect([...newSalt()]).not.toContain(0);
    const bytes = (n: number) => [...frameIv(new Uint8Array(8).fill(1), n).subarray(8)];
    let n = FIRST_FRAME_COUNTER;
    for (let i = 0; i < 70_000; i++) {
      const next = nextCounter(n);
      expect(next).toBeGreaterThan(n);
      n = next;
    }
    expect(bytes(n)).not.toContain(0);
    // carried over a byte that rolls round, and past the last one when the counter has run out
    expect(nextCounter(0x010101ff)).toBe(0x01010201);
    expect(nextCounter(0x01ffffff)).toBe(0x02010101);
    expect(nextCounter(MAX_FRAME_COUNTER)).toBeGreaterThan(MAX_FRAME_COUNTER);
  });

  it("derives the call key apart from the message key", () => {
    const root = raw(3);
    expect(voiceFrameKey(root, "10")).not.toEqual(channelKey(root, "10"));
    expect(voiceFrameKey(root, "10")).not.toEqual(voiceFrameKey(root, "11"));
    expect(voiceFrameKey(root, "10")).toEqual(voiceFrameKey(raw(3), "10"));
  });
});
