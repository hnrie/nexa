/**
 * A connection to the real Discord on behalf of one program: the same
 * handshake the program made, then its frames passed through both ways.
 */
import net from "node:net";
import { FrameDecoder, OP, encodeFrame, type Frame } from "./frame";

export type UpstreamOpen =
  | { kind: "ready"; upstream: Upstream; ready: Frame }
  /** Discord answered the handshake by closing: a bad client id, or too many connections. */
  | { kind: "refused"; code: number; message: string }
  /** Nothing answered in time. */
  | { kind: "unavailable" };

export class Upstream {
  private readonly frameListeners = new Set<(f: Frame) => void>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  private constructor(private readonly sock: net.Socket, private readonly decoder: FrameDecoder) {
    sock.on("close", () => this.finish());
    sock.on("error", () => this.finish());
  }

  /** Connects to Discord at `target` and makes the handshake a program made. */
  static open(target: string, clientId: string, timeoutMs = 5000): Promise<UpstreamOpen> {
    return new Promise((resolve) => {
      const sock = net.connect(target);
      const decoder = new FrameDecoder();
      let settled = false;
      const settle = (r: UpstreamOpen) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.off("data", onData);
        resolve(r);
      };
      const timer = setTimeout(() => {
        sock.destroy();
        settle({ kind: "unavailable" });
      }, timeoutMs);
      const onData = (chunk: Buffer) => {
        let frames: Frame[];
        try {
          frames = decoder.push(chunk);
        } catch {
          sock.destroy();
          settle({ kind: "unavailable" });
          return;
        }
        for (const f of frames) {
          if (f.op === OP.CLOSE) {
            const d = (f.json ?? {}) as { code?: number; message?: string };
            sock.destroy();
            settle({ kind: "refused", code: typeof d.code === "number" ? d.code : 1000, message: typeof d.message === "string" ? d.message : "Closed" });
            return;
          }
          const j = f.json as { cmd?: string; evt?: string } | null;
          if (f.op === OP.FRAME && j?.cmd === "DISPATCH" && j.evt === "READY") {
            const up = new Upstream(sock, decoder);
            // anything Discord sent right behind READY belongs to the relay
            sock.on("data", (c: Buffer) => up.read(c));
            settle({ kind: "ready", upstream: up, ready: f });
            return;
          }
        }
      };
      sock.on("data", onData);
      sock.once("connect", () => sock.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: clientId })));
      sock.once("error", () => settle({ kind: "unavailable" }));
      sock.once("close", () => settle({ kind: "unavailable" }));
    });
  }

  private read(chunk: Buffer): void {
    let frames: Frame[];
    try {
      frames = this.decoder.push(chunk);
    } catch {
      this.close();
      return;
    }
    for (const f of frames) for (const l of this.frameListeners) l(f);
  }

  onFrame(cb: (f: Frame) => void): void {
    this.frameListeners.add(cb);
  }

  onClose(cb: () => void): void {
    this.closeListeners.add(cb);
  }

  /** Passes a whole frame to Discord, header included. */
  sendRaw(raw: Buffer): void {
    if (!this.closed) this.sock.write(raw);
  }

  send(op: number, json: unknown): void {
    this.sendRaw(encodeFrame(op as 0, json));
  }

  close(): void {
    this.sock.destroy();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.closeListeners) l();
    this.closeListeners.clear();
    this.frameListeners.clear();
  }
}
