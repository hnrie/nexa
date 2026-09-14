/**
 * Finding Discord and sharing its endpoint with it.
 *
 * Programs connect to discord-ipc-0 first. To hear them while Discord is
 * running, the Rich Presence server needs that index, and passes everything
 * on to Discord wherever Discord is. On macOS and Linux a socket file can be
 * renamed while Discord keeps listening on it, so Discord's is moved to a free
 * index and put back when we stop. Windows pipes cannot be moved: there the
 * app starts at login ahead of Discord, and offers to restart Discord if it
 * started first anyway.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_INDEX, endpoint, probe } from "./paths";

export interface Moved {
  from: string;
  to: string;
}

export class DiscordLocator {
  /** Where Discord's socket was moved to, while it is moved. */
  moved: Moved | null = null;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: NodeJS.ProcessEnv = process.env,
    /** Called with the move so it can be undone after a crash, or null once undone. */
    private readonly remember: (m: Moved | null) => void = () => {},
  ) {}

  /**
   * Makes index 0 ours to take. A socket left moved by a run that crashed is
   * adopted as Discord's. Returns "first" on Windows when Discord holds it.
   */
  async claimFirst(leftover: Moved | null): Promise<"ready" | "first"> {
    const zero = endpoint(0, this.platform, this.env);
    if (this.platform !== "win32" && leftover && path.dirname(leftover.from) === path.dirname(zero) && fs.existsSync(leftover.to)) {
      if ((await probe(leftover.to)) === "listening" && (await probe(zero)) !== "listening") this.moved = leftover;
    }
    const state = await probe(zero);
    if (state === "free") return "ready";
    if (this.platform === "win32") return state === "listening" ? "first" : "ready";
    if (state === "stale") {
      fs.rmSync(zero, { force: true });
      return "ready";
    }
    for (let i = MAX_INDEX; i >= 1; i--) {
      const to = endpoint(i, this.platform, this.env);
      if (fs.existsSync(to)) continue;
      try {
        fs.renameSync(zero, to);
      } catch {
        return "first";
      }
      this.moved = { from: zero, to };
      this.remember(this.moved);
      return "ready";
    }
    return "first";
  }

  /** Puts Discord's socket back where Discord made it, once ours has gone. */
  restore(): void {
    const m = this.moved;
    if (!m) return;
    this.moved = null;
    try {
      if (fs.existsSync(m.to) && !fs.existsSync(m.from)) fs.renameSync(m.to, m.from);
    } catch {
      /* Discord remade its socket meanwhile, or quit; either way there is nothing to put back */
    }
    this.remember(null);
  }

  /** Where Discord (or another Rich Presence server) listens, not counting ours; best first. */
  async endpoints(ours: string | null): Promise<string[]> {
    const out: string[] = [];
    if (this.moved && (await probe(this.moved.to)) === "listening") out.push(this.moved.to);
    const candidates: string[] = [];
    for (let i = 0; i <= MAX_INDEX; i++) candidates.push(endpoint(i, this.platform, this.env));
    if (this.platform === "linux") {
      // Discord installed as a Flatpak or a Snap keeps its socket in a folder of its own
      const dir = path.dirname(endpoint(0, this.platform, this.env));
      for (const sub of ["app/com.discordapp.Discord", "app/com.discordapp.DiscordCanary", "snap.discord", "snap.discord-canary"]) {
        for (let i = 0; i <= 2; i++) candidates.push(path.join(dir, sub, `discord-ipc-${i}`));
      }
    }
    for (const target of candidates) {
      if (target === ours || out.includes(target)) continue;
      if ((await probe(target, 300)) === "listening") out.push(target);
    }
    return out;
  }
}

const DISCORD_BUILDS = ["Discord", "DiscordPTB", "DiscordCanary"] as const;

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (_err, stdout) => resolve(String(stdout ?? "")));
  });
}

/** Which Discord builds are running on Windows. */
export async function runningDiscordBuilds(): Promise<string[]> {
  const out = await run("tasklist", ["/FO", "CSV", "/NH"]);
  return DISCORD_BUILDS.filter((b) => new RegExp(`^"${b}\\.exe"`, "im").test(out));
}

/**
 * Windows: quits the running Discord builds, lets `takeFirst` claim the first
 * pipe, then starts them again through their updaters, as their shortcuts do.
 */
export async function restartDiscordWindows(takeFirst: () => Promise<void>): Promise<boolean> {
  const builds = await runningDiscordBuilds();
  if (builds.length === 0) return false;
  for (const b of builds) await run("taskkill", ["/IM", `${b}.exe`, "/T", "/F"]);
  // the pipe goes when the process does
  for (let i = 0; i < 40 && (await probe(endpoint(0, "win32"))) === "listening"; i++) await new Promise((r) => setTimeout(r, 250));
  await takeFirst();
  const local = process.env.LOCALAPPDATA ?? "";
  for (const b of builds) {
    const updater = path.join(local, b, "Update.exe");
    if (fs.existsSync(updater)) execFile(updater, ["--processStart", `${b}.exe`], { windowsHide: true }).unref();
  }
  return true;
}
