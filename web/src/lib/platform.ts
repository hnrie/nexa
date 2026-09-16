/**
 * Which desktop app a visitor's computer takes, from what the browser tells.
 * Phones, tablets (an iPad asks for the desktop site but has a touch screen)
 * and Chromebooks get none.
 */
import type { DesktopFile, DesktopRelease } from "@/api/desktop";

export interface DesktopTarget {
  os: DesktopFile["os"] | null;
  arch: DesktopFile["arch"] | null;
}

export interface PlatformHints {
  ua: string;
  /** navigator.userAgentData.mobile */
  mobile?: boolean | undefined;
  /** navigator.userAgentData high-entropy architecture: "x86" | "arm" */
  architecture?: string | undefined;
  /** WebGL's unmasked renderer, e.g. "Apple M2" */
  gpu?: string | undefined;
  /** whether WebGL offers ASTC textures, which on a Mac only Apple's own chips have */
  astc?: boolean | undefined;
  /** navigator.maxTouchPoints */
  touchPoints?: number | undefined;
  /** navigator.userAgentData.platform, e.g. "Android" */
  platform?: string | undefined;
}

/**
 * An Android phone or tablet, which is offered the app rather than an
 * installer. A Chromebook says CrOS and runs the web app, and anything
 * claiming Android while pretending to be a desktop browser is left alone.
 */
export function detectAndroid(h: PlatformHints): boolean {
  if (/CrOS/i.test(h.ua)) return false;
  if (h.platform && /android/i.test(h.platform)) return true;
  return /Android/i.test(h.ua) && !/Windows|Macintosh|X11; Linux x86/i.test(h.ua);
}

export function detectDesktop(h: PlatformHints): DesktopTarget {
  const ua = h.ua;
  if (h.mobile || /Mobi|Android|iPhone|iPad|iPod|CrOS/i.test(ua)) return { os: null, arch: null };
  const arm = h.architecture ? /arm/i.test(h.architecture) : null;
  if (/Windows NT/i.test(ua)) return { os: "windows", arch: arm === true || /ARM64|aarch64/i.test(ua) ? "arm64" : "x64" };
  if (/Macintosh|Mac OS X/i.test(ua)) {
    if ((h.touchPoints ?? 0) > 1) return { os: null, arch: null };
    if (arm !== null) return { os: "mac", arch: arm ? "arm64" : "x64" };
    // Safari's user agent says Intel on every Mac, and it may call any graphics chip "Apple GPU"
    if (h.gpu && /Apple M\d/i.test(h.gpu)) return { os: "mac", arch: "arm64" };
    if (h.gpu && /Intel|AMD|Radeon|NVIDIA/i.test(h.gpu)) return { os: "mac", arch: "x64" };
    if (h.astc !== undefined) return { os: "mac", arch: h.astc ? "arm64" : "x64" };
    return { os: "mac", arch: null };
  }
  if (/Linux|X11/i.test(ua)) return { os: "linux", arch: arm === true || /aarch64|arm64/i.test(ua) ? "arm64" : "x64" };
  return { os: null, arch: null };
}

/** The file to offer first: the computer's installer (an AppImage on Linux). */
export function pickDownload(rel: DesktopRelease, target: DesktopTarget): DesktopFile | null {
  if (!target.os) return null;
  const kinds: DesktopFile["kind"][] = target.os === "linux" ? ["appimage", "deb"] : ["installer"];
  const mine = rel.files.filter((f) => f.os === target.os && kinds.includes(f.kind));
  // a Mac that will not say which chip it has is most likely a newer one
  const arch = target.arch ?? (target.os === "mac" ? "arm64" : "x64");
  const byKind = (list: DesktopFile[]) => [...list].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))[0] ?? null;
  return byKind(mine.filter((f) => f.arch === arch)) ?? byKind(mine);
}

/** Whether this browser is an Android one, for the app banner. */
export function isAndroid(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectAndroid({ ua: navigator.userAgent, platform: nav.userAgentData?.platform });
}

/** Reads the hints from this browser, including the slower ones Chromium offers. */
export async function currentPlatform(): Promise<DesktopTarget> {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } };
  let architecture: string | undefined;
  try {
    architecture = (await nav.userAgentData?.getHighEntropyValues?.(["architecture"]))?.architecture;
  } catch {
    /* not offered */
  }
  const webgl = !architecture && /Macintosh/.test(navigator.userAgent) ? webglHints() : {};
  return detectDesktop({ ua: navigator.userAgent, mobile: nav.userAgentData?.mobile, architecture, gpu: webgl.gpu, astc: webgl.astc, touchPoints: navigator.maxTouchPoints });
}

function webglHints(): { gpu?: string | undefined; astc?: boolean | undefined } {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return {};
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const astc = (gl.getSupportedExtensions() ?? []).includes("WEBGL_compressed_texture_astc");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { gpu: typeof r === "string" ? r : undefined, astc };
  } catch {
    return {};
  }
}
