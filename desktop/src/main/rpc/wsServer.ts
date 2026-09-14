/**
 * Discord's local WebSocket transport, ws://127.0.0.1:6463-6472, for programs
 * that speak RPC that way. Browser pages are refused: Discord checks a page's
 * origin against the application's registered origins, which nobody outside
 * Discord can read, and letting any website set someone's activity would be
 * worse than not offering it.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { OP, type Frame } from "./frame";
import type { AppConnection } from "./session";

export const WS_PORTS = [6463, 6472] as const;

export interface WsHandlers {
  onSession(conn: AppConnection, clientId: string): { handle(frame: Frame): void; end(): void };
  log(msg: string, extra?: Record<string, unknown>): void;
}

const CLIENT_ID = /^\d{1,20}$/;
const MAX_MESSAGE = 64 * 1024;

export class WsServer {
  private server: WebSocketServer | null = null;
  port: number | null = null;

  constructor(private readonly handlers: WsHandlers) {}

  async listen(): Promise<number | null> {
    for (let port = WS_PORTS[0]; port <= WS_PORTS[1]; port++) {
      const server = await new Promise<WebSocketServer | null>((resolve) => {
        const s = new WebSocketServer({ host: "127.0.0.1", port, maxPayload: MAX_MESSAGE, perMessageDeflate: false });
        s.once("listening", () => resolve(s));
        s.once("error", () => {
          s.close();
          resolve(null);
        });
      });
      if (!server) continue;
      server.on("connection", (ws, req) => this.accept(ws, req));
      this.server = server;
      this.port = port;
      return port;
    }
    // every port is taken (Discord and others); programs can still use IPC
    return null;
  }

  private accept(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    if (origin) {
      ws.close(4001, "Invalid Origin");
      return;
    }
    if (Number(url.searchParams.get("v") ?? "1") !== 1) {
      ws.close(4004, "Invalid Version");
      return;
    }
    if ((url.searchParams.get("encoding") ?? "json") !== "json") {
      ws.close(4000, "Invalid Encoding");
      return;
    }
    const clientId = url.searchParams.get("client_id") ?? "";
    if (!CLIENT_ID.test(clientId)) {
      ws.close(4000, "Invalid Client ID");
      return;
    }
    const conn: AppConnection = {
      id: randomUUID(),
      transport: "ws",
      send: (json) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(json));
      },
      sendFrame: (frame) => {
        if (ws.readyState !== ws.OPEN) return;
        if (frame.op === OP.CLOSE) {
          const d = (frame.json ?? {}) as { code?: number; message?: string };
          ws.close(typeof d.code === "number" && d.code >= 4000 ? d.code : 1000, typeof d.message === "string" ? d.message.slice(0, 120) : "");
          return;
        }
        if (frame.op === OP.FRAME) ws.send(JSON.stringify(frame.json));
      },
      close: (code, message) => ws.close(code >= 4000 || code === 1000 ? code : 1000, message.slice(0, 120)),
    };
    const target = this.handlers.onSession(conn, clientId);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        ws.close(1003, "Bad JSON");
        return;
      }
      target.handle({ op: OP.FRAME, json, raw: Buffer.concat([header(OP.FRAME, Buffer.byteLength(JSON.stringify(json))), Buffer.from(JSON.stringify(json))]) });
    });
    ws.on("close", () => target.end());
    ws.on("error", () => ws.terminate());
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    for (const client of server.clients) client.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function header(op: number, len: number): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(op, 0);
  h.writeUInt32LE(len, 4);
  return h;
}
