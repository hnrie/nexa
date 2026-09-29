/**
 * The IPC side of the Rich Presence server: listens on the first free
 * discord-ipc-N, checks each program's handshake the way Discord does, and
 * hands the program to a session.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { FrameDecoder, FrameError, OP, encodeFrame, type Frame } from "./frame";
import { MAX_INDEX, endpoint, probe } from "./paths";
import type { AppConnection } from "./session";

export interface IpcHandlers {
  /** A program finished its handshake. Returns what receives its later frames. */
  onSession(conn: AppConnection, clientId: string): { handle(frame: Frame): void; end(): void };
  log(msg: string, extra?: Record<string, unknown>): void;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;
const CLIENT_ID = /^\d{1,20}$/;

export class IpcServer {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  path: string | null = null;
  index = -1;

  constructor(
    private readonly handlers: IpcHandlers,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Listens on the lowest index nothing else answers on. */
  async listen(): Promise<string> {
    for (let i = 0; i <= MAX_INDEX; i++) {
      const target = endpoint(i, this.platform, this.env);
      const state = await probe(target);
      if (state === "listening") continue;
      if (state === "stale" && this.platform !== "win32") {
        try {
          fs.unlinkSync(target);
        } catch {
          continue;
        }
      }
      if (await this.tryListen(target)) {
        this.path = target;
        this.index = i;
        return target;
      }
    }
    throw new Error("every discord-ipc endpoint is taken");
  }

  private tryListen(target: string): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer((sock) => this.accept(sock));
      // nobody but this user may connect to the socket file
      const oldMask = this.platform === "win32" ? null : process.umask(0o177);
      server.once("error", () => {
        if (oldMask !== null) process.umask(oldMask);
        resolve(false);
      });
      server.listen(target, () => {
        if (oldMask !== null) process.umask(oldMask);
        this.server = server;
        resolve(true);
      });
    });
  }

  private accept(sock: net.Socket): void {
    this.sockets.add(sock);
    const decoder = new FrameDecoder();
    const id = randomUUID();
    let target: { handle(frame: Frame): void; end(): void } | null = null;
    let closed = false;
    const conn: AppConnection = {
      id,
      transport: "ipc",
      send: (json) => {
        if (!closed) sock.write(encodeFrame(OP.FRAME, json));
      },
      sendFrame: (frame) => {
        if (closed) return;
        sock.write(frame.raw);
        if (frame.op === OP.CLOSE) sock.end();
      },
      close: (code, message) => {
        if (closed) return;
        sock.end(encodeFrame(OP.CLOSE, { code, message }));
        closed = true;
      },
    };
    const timer = setTimeout(() => conn.close(4000, "Handshake timed out"), HANDSHAKE_TIMEOUT_MS);
    sock.on("data", (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = decoder.push(chunk);
      } catch (err) {
        conn.close(1003, err instanceof FrameError ? err.message : "Bad frame");
        return;
      }
      for (const frame of frames) {
        if (target) {
          target.handle(frame);
          continue;
        }
        if (frame.op !== OP.HANDSHAKE) {
          conn.close(1003, "Handshake first");
          return;
        }
        clearTimeout(timer);
        const hs = (frame.json ?? {}) as { v?: unknown; client_id?: unknown };
        if (Number(hs.v) !== 1) {
          conn.close(4004, "Invalid Version");
          return;
        }
        if (typeof hs.client_id !== "string" || !CLIENT_ID.test(hs.client_id)) {
          conn.close(4000, "Invalid Client ID");
          return;
        }
        target = this.handlers.onSession(conn, hs.client_id);
      }
    });
    const finish = () => {
      clearTimeout(timer);
      closed = true;
      this.sockets.delete(sock);
      target?.end();
      target = null;
    };
    sock.on("close", finish);
    sock.on("error", () => sock.destroy());
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((r) => server.close(() => r()));
    this.path = null;
    this.index = -1;
  }
}
