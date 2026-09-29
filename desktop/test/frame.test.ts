import { describe, expect, it } from "vitest";
import { FrameDecoder, FrameError, MAX_PAYLOAD, OP, encodeFrame } from "../src/main/rpc/frame";

describe("IPC frames", () => {
  it("puts the opcode and length in front of the JSON, little-endian", () => {
    const buf = encodeFrame(OP.HANDSHAKE, { v: 1, client_id: "1" });
    expect(buf.readUInt32LE(0)).toBe(0);
    expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    expect(JSON.parse(buf.subarray(8).toString())).toEqual({ v: 1, client_id: "1" });
  });

  it("reads frames split across chunks and several in one chunk", () => {
    const a = encodeFrame(OP.FRAME, { cmd: "SET_ACTIVITY", nonce: "1" });
    const b = encodeFrame(OP.PING, { hi: true });
    const all = Buffer.concat([a, b]);
    const dec = new FrameDecoder();
    const got = [...dec.push(all.subarray(0, 5)), ...dec.push(all.subarray(5, a.length + 3)), ...dec.push(all.subarray(a.length + 3))];
    expect(got.map((f) => f.op)).toEqual([OP.FRAME, OP.PING]);
    expect(got[0]!.json).toEqual({ cmd: "SET_ACTIVITY", nonce: "1" });
    expect(got[1]!.raw.length).toBe(b.length);
  });

  it("refuses unknown opcodes, oversized frames and broken JSON", () => {
    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(9, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(FrameError);
    const big = Buffer.alloc(8);
    big.writeUInt32LE(OP.FRAME, 0);
    big.writeUInt32LE(MAX_PAYLOAD + 1, 4);
    expect(() => new FrameDecoder().push(big)).toThrow(FrameError);
    const junk = Buffer.concat([Buffer.from([1, 0, 0, 0, 3, 0, 0, 0]), Buffer.from("{x}")]);
    expect(() => new FrameDecoder().push(junk)).toThrow(FrameError);
  });
});
