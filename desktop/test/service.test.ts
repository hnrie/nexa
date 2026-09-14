import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RpcActivity } from "../src/shared/bridge";
import { FrameDecoder, OP, encodeFrame, type Frame } from "../src/main/rpc/frame";
import { probe } from "../src/main/rpc/paths";
import { RpcService } from "../src/main/rpc/service";

const APP = "123456789012345678";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** A folder of its own for the sockets, far from any real Discord's. */
function socketEnv(): { env: NodeJS.ProcessEnv; at: (i: number) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { env: { TMPDIR: dir }, at: (i) => path.join(dir, `discord-ipc-${i}`) };
}

/** A program talking to whatever listens at `target`. */
async function program(target: string, clientId = APP) {
  const sock = net.connect(target);
  await new Promise<void>((r, j) => {
    sock.once("connect", () => r());
    sock.once("error", j);
  });
  const decoder = new FrameDecoder();
  const frames: Frame[] = [];
  const waiters: ((f: Frame) => void)[] = [];
  let closed = false;
  sock.on("data", (c: Buffer) => {
    for (const f of decoder.push(c)) {
      const w = waiters.shift();
      if (w) w(f);
      else frames.push(f);
    }
  });
  sock.on("close", () => {
    closed = true;
  });
  cleanups.push(() => void sock.destroy());
  const next = (ms = 3000) =>
    new Promise<Frame>((resolve, reject) => {
      const f = frames.shift();
      if (f) return resolve(f);
      const t = setTimeout(() => reject(new Error("no frame")), ms);
      waiters.push((x) => {
        clearTimeout(t);
        resolve(x);
      });
    });
  sock.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: clientId }));
  return {
    next,
    send: (op: 0 | 1 | 2 | 3 | 4, json: unknown) => sock.write(encodeFrame(op, json)),
    command: async (cmd: string, args: unknown, extra: Record<string, unknown> = {}) => {
      const nonce = Math.random().toString(36).slice(2);
      sock.write(encodeFrame(OP.FRAME, { cmd, args, nonce, ...extra }));
      for (;;) {
        const f = await next();
        if ((f.json as { nonce?: string }).nonce === nonce) return f.json as { cmd: string; evt: string | null; data: Record<string, unknown> | null; nonce: string };
      }
    },
    end: () => sock.destroy(),
    get closed() {
      return closed;
    },
  };
}

/** A stand-in for Discord's own RPC server. */
async function fakeDiscord(target: string) {
  const received: unknown[] = [];
  const socks = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    socks.add(sock);
    const decoder = new FrameDecoder();
    sock.on("data", (c: Buffer) => {
      for (const f of decoder.push(c)) {
        if (f.op === OP.HANDSHAKE) {
          sock.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", nonce: null, data: { v: 1, user: { id: "999", username: "discord-user" } } }));
        } else if (f.op === OP.FRAME) {
          const m = f.json as { cmd: string; nonce: string; args: { activity: unknown } };
          if (m.cmd === "SET_ACTIVITY") {
            received.push(m.args.activity);
            sock.write(encodeFrame(OP.FRAME, { cmd: "SET_ACTIVITY", evt: null, nonce: m.nonce, data: { ...(m.args.activity as object), name: "Fake App", from: "discord" } }));
          }
        } else if (f.op === OP.PING) {
          sock.write(encodeFrame(OP.PONG, f.json));
        }
      }
    });
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(target, r));
  const stop = async () => {
    for (const s of socks) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  };
  cleanups.push(stop);
  return { received, stop };
}

function service(env: NodeJS.ProcessEnv, extra: Partial<ConstructorParameters<typeof RpcService>[0]> = {}) {
  const svc = new RpcService({
    enabled: true,
    relay: true,
    hidden: [],
    leftoverMove: null,
    rememberMove: () => {},
    identity: () => ({ id: "42", username: "alice", global_name: "Alice", avatar: null }),
    platform: process.platform === "win32" ? "linux" : process.platform,
    env,
    websocket: false,
    ...extra,
  });
  cleanups.push(() => svc.stop());
  return svc;
}

function nextActivities(svc: RpcService, ok: (list: RpcActivity[]) => boolean = () => true, ms = 3000): Promise<RpcActivity[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no activities event")), ms);
    const on = (list: RpcActivity[]) => {
      if (!ok(list)) return;
      clearTimeout(t);
      svc.off("activities", on);
      resolve(list);
    };
    svc.on("activities", on);
  });
}

const listening = { type: 2, details: "Song", state: "Artist", timestamps: { start: Math.floor(Date.now() / 1000) - 30, end: Math.floor(Date.now() / 1000) + 170 }, assets: { large_image: "album" } };

describe.skipIf(process.platform === "win32")("the Rich Presence server", () => {
  it("answers programs by itself when Discord is not running", async () => {
    const { env, at } = socketEnv();
    const svc = service(env);
    await svc.start();
    expect(svc.state().listening.ipc).toBe(at(0));
    expect(svc.state().discord).toBe("absent");

    const app = await program(at(0));
    const ready = (await app.next()).json as { cmd: string; evt: string; data: { user: { id: string; username: string } } };
    expect(ready.cmd).toBe("DISPATCH");
    expect(ready.evt).toBe("READY");
    expect(ready.data.user).toMatchObject({ id: "42", username: "alice" });

    const shown = nextActivities(svc, (l) => l.length === 1);
    const reply = await app.command("SET_ACTIVITY", { pid: 1, activity: listening });
    expect(reply.evt).toBeNull();
    expect(reply.data).toMatchObject({ type: 2, application_id: APP, details: "Song" });
    const [act] = await shown;
    expect(act!.timestamps!.start).toBe(listening.timestamps.start * 1000);
    expect(act!.timestamps!.end).toBe(listening.timestamps.end * 1000);

    expect((await app.command("SUBSCRIBE", {}, { evt: "ACTIVITY_JOIN" })).data).toEqual({ evt: "ACTIVITY_JOIN" });
    const err = await app.command("GET_GUILDS", {});
    expect(err.evt).toBe("ERROR");
    expect(err.data).toMatchObject({ code: 4002 });

    app.send(OP.PING, { n: 1 });
    const pong = await app.next();
    expect(pong.op).toBe(OP.PONG);
    expect(pong.json).toEqual({ n: 1 });

    const cleared = nextActivities(svc, (l) => l.length === 0);
    app.end();
    await cleared;
    await new Promise((r) => setTimeout(r, 100));
    expect(svc.state().apps).toEqual([]);
  });

  it("refuses a bad handshake the way Discord does", async () => {
    const { env, at } = socketEnv();
    const svc = service(env);
    await svc.start();
    const app = await program(at(0), "not-a-number");
    const close = await app.next();
    expect(close.op).toBe(OP.CLOSE);
    expect(close.json).toMatchObject({ code: 4000 });
  });

  it("moves Discord aside, passes everything to it, and still shows the activity here", async () => {
    const { env, at } = socketEnv();
    const discord = await fakeDiscord(at(0));
    const moves: unknown[] = [];
    const svc = service(env, { rememberMove: (m) => moves.push(m) });
    await svc.start();
    expect(svc.state().listening.ipc).toBe(at(0));
    expect(moves[0]).toEqual({ from: at(0), to: at(9) });
    expect(svc.state().discord).toBe("connected");

    const app = await program(at(0));
    const ready = (await app.next()).json as { data: { user: { id: string } } };
    // the program is greeted by Discord itself
    expect(ready.data.user.id).toBe("999");
    const shown = nextActivities(svc, (l) => l.length === 1);
    const reply = await app.command("SET_ACTIVITY", { pid: 1, activity: listening });
    expect(reply.data).toMatchObject({ name: "Fake App", from: "discord" });
    expect(discord.received).toHaveLength(1);
    expect((await shown)[0]).toMatchObject({ type: 2, details: "Song" });

    // stopping gives Discord its name back
    await svc.stop();
    expect(moves.at(-1)).toBeNull();
    expect(fs.existsSync(at(9))).toBe(false);
    const again = await program(at(0));
    expect(((await again.next()).json as { data: { user: { id: string } } }).data.user.id).toBe("999");
  });

  it("gives Discord its name back at once when the app is ending", async () => {
    const { env, at } = socketEnv();
    await fakeDiscord(at(0));
    const moves: unknown[] = [];
    const svc = service(env, { rememberMove: (m) => moves.push(m) });
    await svc.start();
    const app = await program(at(0));
    await app.next();
    expect(moves[0]).toEqual({ from: at(0), to: at(9) });
    // nothing is awaited: the process may end right after this returns
    svc.stopForExit();
    expect(moves.at(-1)).toBeNull();
    expect(fs.existsSync(at(9))).toBe(false);
    expect(await probe(at(0))).toBe("listening");
    const again = await program(at(0));
    expect(((await again.next()).json as { data: { user: { id: string } } }).data.user.id).toBe("999");
  });

  it("keeps answering a program when Discord quits under it", async () => {
    const { env, at } = socketEnv();
    const discord = await fakeDiscord(at(0));
    const svc = service(env);
    await svc.start();
    const app = await program(at(0));
    await app.next();
    await discord.stop();
    await new Promise((r) => setTimeout(r, 100));
    const reply = await app.command("SET_ACTIVITY", { pid: 1, activity: { details: "after Discord" } });
    expect(reply.evt).toBeNull();
    expect(reply.data).toMatchObject({ details: "after Discord", name: "" });
    expect(app.closed).toBe(false);
  });

  it("takes back a Discord socket a crashed run left moved", async () => {
    const { env, at } = socketEnv();
    await fakeDiscord(at(7));
    const svc = service(env, { leftoverMove: { from: at(0), to: at(7) } });
    await svc.start();
    const app = await program(at(0));
    expect(((await app.next()).json as { data: { user: { id: string } } }).data.user.id).toBe("999");
    await svc.stop();
    expect(await probe(at(0))).toBe("listening");
    expect(fs.existsSync(at(7))).toBe(false);
  });

  it("leaves hidden programs off and stops relaying on request", async () => {
    const { env, at } = socketEnv();
    const discord = await fakeDiscord(at(0));
    const svc = service(env);
    await svc.start();
    const app = await program(at(0));
    await app.next();
    await app.command("SET_ACTIVITY", { pid: 1, activity: { details: "secret" } });
    await nextActivities(svc, (l) => l.length === 1);
    svc.setHidden(APP, true);
    expect(await nextActivities(svc)).toEqual([]);
    expect(svc.state().apps[0]).toMatchObject({ clientId: APP, hidden: true });
    svc.setRelay(false);
    await new Promise((r) => setTimeout(r, 100));
    const reply = await app.command("SET_ACTIVITY", { pid: 1, activity: { details: "local now" } });
    expect(reply.data).not.toHaveProperty("from");
    expect(discord.received).toHaveLength(1);
  });

  it("works with a real Rich Presence client library", async () => {
    const { env, at } = socketEnv();
    const svc = service(env);
    await svc.start();
    const prev = process.env.TMPDIR;
    process.env.TMPDIR = env.TMPDIR;
    cleanups.push(() => {
      process.env.TMPDIR = prev;
    });
    const { Client } = await import("@xhayper/discord-rpc");
    const client = new Client({ clientId: APP, transport: { type: "ipc" } });
    cleanups.push(() => client.destroy().catch(() => {}));
    await client.login();
    const shown = nextActivities(svc, (l) => l.length === 1);
    const now = Date.now();
    await client.user?.setActivity({ type: 2, details: "Track", state: "Band", startTimestamp: now - 10_000, endTimestamp: now + 200_000, largeImageKey: "cover", largeImageText: "Album", buttons: [{ label: "Open", url: "https://example.com" }] });
    const [act] = await shown;
    expect(act).toMatchObject({ application_id: APP, type: 2, details: "Track", state: "Band", assets: { large_image: "cover", large_text: "Album" }, buttons: [{ label: "Open", url: "https://example.com/" }] });
    expect(act!.timestamps!.end! - act!.timestamps!.start!).toBeGreaterThan(200_000);
    const cleared = nextActivities(svc, (l) => l.length === 0);
    await client.user?.clearActivity();
    await cleared;
    expect(at(0)).toBeTruthy();
  });
});
