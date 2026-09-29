/**
 * Discord's IPC framing: a little-endian uint32 opcode, a uint32 length, then
 * that many bytes of JSON.
 */

export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;
export type Opcode = (typeof OP)[keyof typeof OP];

/** Discord's own messages stay far below this; anything larger is an abuse of the socket. */
export const MAX_PAYLOAD = 64 * 1024;

export class FrameError extends Error {}

export interface Frame {
  op: Opcode;
  json: unknown;
  /** The whole frame, header included, for passing on untouched. */
  raw: Buffer;
}

export function encodeFrame(op: Opcode, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Collects bytes from a stream and hands back whole frames as they complete. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Frame[] = [];
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (op > OP.PONG) throw new FrameError(`unknown opcode ${op}`);
      if (len > MAX_PAYLOAD) throw new FrameError(`frame of ${len} bytes`);
      if (this.buf.length < 8 + len) break;
      const raw = this.buf.subarray(0, 8 + len);
      let json: unknown;
      try {
        json = len ? JSON.parse(raw.subarray(8).toString("utf8")) : null;
      } catch {
        throw new FrameError("frame is not JSON");
      }
      out.push({ op: op as Opcode, json, raw: Buffer.from(raw) });
      this.buf = this.buf.subarray(8 + len);
    }
    return out;
  }
}
