/**
 * Sharing one window's sound instead of the whole computer's.
 *
 * Chromium can capture a single program's audio for a screen share when it is
 * told which program: on Windows by process id ("applicationLoopback:<pid>",
 * Windows' process loopback, which takes in the process's children too), on
 * macOS 14.2 and later by bundle id ("applicationLoopback:<bundle id>", a
 * Core Audio tap). Chrome's own picker does the same for a window. A share
 * names only the window, so the program behind it is looked up here.
 *
 * Every lookup is allowed to fail. The share then carries the computer's
 * sound without this app, as before, and a program whose sound will not start
 * is not asked for again this session (see permissions.ts).
 */
import { app, BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import os from "node:os";

type Log = (msg: string, extra?: Record<string, unknown>) => void;

/** Windows 10 2004 (build 19041) brought process loopback; OBS captures single programs from there. */
export const WINDOWS_PROCESS_LOOPBACK_BUILD = 19041;

/** Whether this computer can share one program's sound: Windows 10 2004 and later, macOS 14.2 and later. */
export function windowAudioSupported(): boolean {
  if (process.env.EVILION_WINDOW_AUDIO === "0") return false;
  if (process.env.EVILION_WINDOW_AUDIO === "1") return true;
  const [major = 0, minor = 0, build = 0] = os.release().split(".").map(Number);
  if (process.platform === "win32") return build >= WINDOWS_PROCESS_LOOPBACK_BUILD;
  // Darwin 23.2 is macOS 14.2, where Chromium captures loopback through Core Audio taps.
  // Before that its ScreenCaptureKit path would take the whole computer's sound for such an id.
  if (process.platform === "darwin") return major > 23 || (major === 23 && minor >= 2);
  return false;
}

/** The window id inside a desktopCapturer source id ("window:<id>:<n>"), or null for a screen. */
export function windowIdOf(sourceId: string): number | null {
  const m = /^window:(\d+):\d+$/.exec(sourceId);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A process id Chromium will parse (it stops the audio service outright on one it cannot). */
export function validPid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 4 && pid <= 0xffffffff;
}

/** A bundle id Chromium will parse: reverse-DNS, no colon to split it on. */
export function validBundleId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id);
}

/** This app's own processes, whose sound (the call) must never be what a share carries. */
function ownPids(): Set<number> {
  const pids = new Set<number>([process.pid]);
  try {
    for (const m of app.getAppMetrics()) pids.add(m.pid);
  } catch {
    /* only the main process then */
  }
  return pids;
}

function ownWindow(sourceId: string): boolean {
  try {
    return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.getMediaSourceId() === sourceId);
  } catch {
    return false;
  }
}

/**
 * Programs that play the person's own voice back to them: voice changers and
 * mixers with a "hear myself" monitor. Their sound is the sharer's voice, so a
 * share of one of their windows carries no sound at all rather than sending
 * that voice into the call a second time. Matched on the program's file name
 * (Windows) or bundle id (macOS).
 */
const SELF_MONITORING = /voicemod|voicemeeter|clownfish|morphvox|voxal|voice\.?ai|voicechanger|voice changer|magicmic|krisp|nvidia broadcast|nvbroadcast|steelseries ?gg|steelseries ?sonar|rogueamoeba\.(loopback|audiohijack|soundsource)/i;

/** Whether a program (a Windows image path or a macOS bundle id) plays the person's own voice back to them. */
export function selfMonitoringApp(program: string | null | undefined): boolean {
  if (!program) return false;
  const name = program.split(/[\\/]/).pop() ?? program;
  return SELF_MONITORING.test(name);
}

/** What windowAudioDevice answers for a window whose program must not be heard in a share. */
export const NO_SOUND = "none";

// --- Windows ---------------------------------------------------------------

interface WindowsApi {
  windowPid(hwnd: number): number;
  processImage(pid: number): string | null;
}

let windowsApi: WindowsApi | null | undefined;

/**
 * user32's GetWindowThreadProcessId and kernel32's process image name,
 * through koffi. Its native module ships beside the app (resources/koffi); if
 * it cannot be loaded, window shares keep the computer's sound.
 */
function loadWindowsApi(log: Log): WindowsApi | null {
  if (windowsApi !== undefined) return windowsApi;
  windowsApi = null;
  try {
    // required here, not imported: koffi loads its native module the moment it is required
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi") as typeof import("koffi");
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const GetWindowThreadProcessId = user32.func("uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)");
    const OpenProcess = kernel32.func("intptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)");
    const QueryFullProcessImageNameW = kernel32.func("int __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, _Out_ uint8_t *lpExeName, _Inout_ uint32_t *lpdwSize)");
    const CloseHandle = kernel32.func("int __stdcall CloseHandle(intptr_t hObject)");
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    windowsApi = {
      windowPid(hwnd) {
        const out = [0];
        GetWindowThreadProcessId(hwnd, out);
        return Number(out[0] ?? 0);
      },
      processImage(pid) {
        const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if (!handle) return null;
        try {
          const chars = 1024;
          const buf = Buffer.alloc(chars * 2);
          const size = [chars];
          if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return null;
          return buf.toString("utf16le", 0, Math.min(chars, Number(size[0] ?? 0)) * 2);
        } finally {
          CloseHandle(handle);
        }
      },
    };
  } catch (err) {
    log("window audio: koffi unavailable", { err: String(err) });
  }
  return windowsApi;
}

function windowsDevice(hwnd: number, supported: boolean, log: Log): string | null {
  const api = loadWindowsApi(log);
  if (!api) return null;
  const pid = api.windowPid(hwnd);
  if (!validPid(pid) || ownPids().has(pid)) return null;
  const image = api.processImage(pid);
  // A Store app's window belongs to its frame host, not to the program making the sound.
  if (image && /\\ApplicationFrameHost\.exe$/i.test(image)) return null;
  if (selfMonitoringApp(image)) return NO_SOUND;
  if (!supported) return null;
  return `applicationLoopback:${pid}`;
}

// --- macOS -----------------------------------------------------------------

/** Asks the window server who owns a window, without any permission prompt. */
const OWNER_SCRIPT = `ObjC.import("CoreGraphics");ObjC.import("AppKit");function run(a){const l=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow,Number(a[0]))))||[];const w=l[0];if(!w)return "";const p=$.NSRunningApplication.runningApplicationWithProcessIdentifier(w.kCGWindowOwnerPID);return JSON.stringify({pid:w.kCGWindowOwnerPID,bundle:p.isNil()?null:ObjC.unwrap(p.bundleIdentifier)})}`;

/** The program behind a macOS window: its process and bundle id, or null. */
export function macWindowOwner(windowId: number): Promise<{ pid: number; bundle: string | null } | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", OWNER_SCRIPT, String(windowId)], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const v = JSON.parse(String(stdout).trim() || "null") as { pid?: unknown; bundle?: unknown } | null;
        resolve(v && validPid(v.pid) ? { pid: v.pid, bundle: typeof v.bundle === "string" ? v.bundle : null } : null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function macDevice(windowId: number, supported: boolean, log: Log): Promise<string | null> {
  const owner = await macWindowOwner(windowId);
  if (!owner || ownPids().has(owner.pid)) return null;
  if (selfMonitoringApp(owner.bundle)) return NO_SOUND;
  if (!supported) return null;
  // this app (and Electron itself while developing); __CFBundleIdentifier is no help, it comes from whatever started the process
  const own = ["xyz.evilion.chat", "com.github.Electron"];
  if (!validBundleId(owner.bundle) || own.some((id) => owner.bundle === id || owner.bundle!.startsWith(`${id}.`))) {
    log("window audio: no usable bundle id", { bundle: owner.bundle });
    return null;
  }
  return `applicationLoopback:${owner.bundle}`;
}

/**
 * The audio device that carries just the sound of the program behind a
 * shared window, NO_SOUND for a program that plays the person's own voice
 * back (selfMonitoringApp), or null when that is not possible here (a screen,
 * this app's own window, an older system, or anything failing).
 */
export async function windowAudioDevice(sourceId: string, log: Log): Promise<string | null> {
  const id = windowIdOf(sourceId);
  if (id === null || ownWindow(sourceId)) return null;
  // the program is looked up even where its sound alone cannot be captured, to keep a voice changer out
  const supported = windowAudioSupported();
  // tests of the fallback ask for a device that cannot start
  if (supported && process.env.EVILION_TEST_PROGRAM_AUDIO_DEVICE) return process.env.EVILION_TEST_PROGRAM_AUDIO_DEVICE;
  try {
    if (process.platform === "win32") return windowsDevice(id, supported, log);
    if (process.platform === "darwin") return await macDevice(id, supported, log);
  } catch (err) {
    log("window audio: lookup failed", { err: String(err) });
  }
  return null;
}
