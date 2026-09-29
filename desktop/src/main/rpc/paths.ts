/**
 * Where Discord's IPC endpoints live, and a way to see whether something is
 * listening there without talking to it: Discord limits how many RPC
 * connections a program may make in a minute, so looking must not count.
 */
import net from "node:net";
import path from "node:path";

export const MAX_INDEX = 9;

/** The folder of the Unix sockets, found the way Discord's own libraries look for it. */
export function socketDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  return dir.replace(/[\\/]+$/, "") || "/";
}

/** The endpoint for index i: a named pipe on Windows, a socket file elsewhere. */
export function endpoint(i: number, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === "win32" ? `\\\\?\\pipe\\discord-ipc-${i}` : path.join(socketDir(env), `discord-ipc-${i}`);
}

export type Probe = "listening" | "free" | "stale";

/**
 * listening: something accepts connections there. free: nothing is there.
 * stale: a socket file is left over from a program that is gone.
 */
export function probe(target: string, timeoutMs = 800): Promise<Probe> {
  return new Promise((resolve) => {
    const s = net.connect(target);
    let settled = false;
    const done = (r: Probe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.destroy();
      resolve(r);
    };
    // something slow to accept still holds the name; treat it as taken rather than take it over
    const timer = setTimeout(() => done("listening"), timeoutMs);
    s.once("connect", () => done("listening"));
    s.once("error", (err: NodeJS.ErrnoException) => done(err.code === "ECONNREFUSED" ? "stale" : "free"));
  });
}
