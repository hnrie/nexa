/**
 * The small still picture a grid of stickers shows for each one.
 *
 * A grid used to draw every sticker near the screen in full: a video player
 * per video sticker, a Lottie player per animated one, every GIF moving at
 * once. Players whose tiles had gone (the picker closed, a pack scrolled
 * past) kept loading, could not be collected while they did, and took the
 * connection from the tiles in view; a browser also refuses new video
 * players past a cap. So tiles stayed grey, for good, mostly the second time
 * the picker opened. Now a grid tile shows a still: a small copy from the
 * server for pictures (the first frame of a moving one), and a first frame
 * drawn here once for Lottie and video. Only the tile being pointed at plays.
 *
 * Stills are made a few at a time, those on screen first (loadQueue.ts), and
 * kept while the memory budget allows, so a reopened picker shows them at
 * once. A load nobody is waiting for any more is dropped before it starts. A
 * failure is tried again by itself after a growing wait, or at once when its
 * tile is pressed or the connection comes back, and until then the tile says
 * it could not load rather than staying grey.
 */
import { emojiUrl, stickerUrl } from "@/api/users";
import { isAborted, LoadQueue, loadSlots, retryDelay, type Ticket } from "./loadQueue";
import { idle, tgsPoster, UnsupportedError, warmLottie, webmPoster } from "./stickerPosters";
import { loadStill, saveStill } from "./stillStore";

export interface StillSource {
  kind: "sticker" | "emoji";
  blobId: string;
  /** png, apng, gif, webp, jpeg, tgs or webm; unknown is treated as a picture. */
  format?: string | undefined;
  animated: boolean;
}

export type StillStatus = "idle" | "loading" | "ready" | "failed";

export interface StillView {
  status: StillStatus;
  url: string | null;
  /** Failed in a way trying again will not fix (gone, or a format this browser cannot play). */
  permanent: boolean;
}

export interface StillHandle {
  /** How near the screen the tile is: 0 on it, 1 about to be, null far away. */
  want(priority: number | null): void;
  /** Tries a failed still again now. */
  retry(): void;
  release(): void;
}

/** A download that has gone quiet this long is given up and tried again. */
const STALL_MS = 20_000;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Downloads run a few at a time; drawing a frame runs one at a time, so scrolling stays smooth. */
const network = new LoadQueue(() => loadSlots());
const drawing = new LoadQueue(() => 1);

interface Watcher {
  listener: (v: StillView) => void;
  priority: number | null;
}

interface Entry {
  key: string;
  src: StillSource;
  px: number;
  url: string | null;
  bytes: number;
  /** The downloaded .tgs or video, kept while its frame waits to be drawn. */
  source: Blob | null;
  watchers: Set<Watcher>;
  ticket: Ticket<Blob> | null;
  failures: number;
  /** Tried again because someone pressed it: shown as loading, where a retry of its own keeps the failed mark up. */
  pressed: boolean;
  /** Looking for a drawn still kept from an earlier visit (stillStore.ts), and whether that has been done. */
  checking: boolean;
  checked: boolean;
  permanent: boolean;
  retryAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  used: number;
  view: StillView;
}

const IDLE: StillView = { status: "idle", url: null, permanent: false };
const entries = new Map<string, Entry>();
let bytesKept = 0;

export function stillKey(src: StillSource, px: number): string {
  return `${src.kind}:${src.blobId}:${px}`;
}

/** Where a tile's still comes from, and whether it is drawn here. */
export function stillPlan(src: StillSource, px: number): { url: string; draw: "tgs" | "webm" | null } {
  if (src.format === "tgs" || src.format === "webm") return { url: fullStickerUrl(src), draw: src.format };
  const moving = src.animated ? "&still=1" : "";
  const base = src.kind === "emoji" ? emojiUrl(src.blobId, src.animated) : stickerUrl(src.blobId);
  return { url: `${base}?size=${px}${moving}`, draw: null };
}

/** The sticker itself, moving, for the one tile being pointed at (and the download a drawn frame comes from). */
export function fullStickerUrl(src: StillSource, css = 160): string {
  return src.kind === "emoji" ? emojiUrl(src.blobId, src.animated, css) : stickerUrl(src.blobId, css);
}

/** How much memory stills may hold once nothing on screen needs them. */
function budget(): number {
  const memory = typeof navigator !== "undefined" ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) : 4;
  return (memory <= 2 ? 12 : memory <= 4 ? 24 : 48) * 1024 * 1024;
}

function viewOf(e: Entry): StillView {
  if (e.url) return { status: "ready", url: e.url, permanent: false };
  if (e.failures > 0 && !e.pressed) return { status: "failed", url: null, permanent: e.permanent };
  return e.ticket || e.source || e.pressed || e.checking ? { status: "loading", url: null, permanent: false } : IDLE;
}

function notify(e: Entry): void {
  const v = viewOf(e);
  if (v.status === e.view.status && v.url === e.view.url && v.permanent === e.view.permanent) return;
  e.view = v;
  for (const w of [...e.watchers]) w.listener(v);
}

function best(e: Entry): number | null {
  let p: number | null = null;
  for (const w of e.watchers) if (w.priority !== null && (p === null || w.priority < p)) p = w.priority;
  return p;
}

/** Forgets an entry that holds nothing and that nothing is waiting on. */
function tidy(e: Entry): void {
  if (e.watchers.size > 0 || e.url || e.ticket || e.timer || e.checking) return;
  if (e.source) bytesKept -= e.source.size;
  e.source = null;
  entries.delete(e.key);
}

/** Starts, reorders, drops or schedules the work for an entry after something changed. */
function update(e: Entry): void {
  if (e.url) return;
  const p = best(e);
  if (p === null) {
    // nobody near: a load that has not started is dropped (one already running finishes and is kept)
    if (e.ticket?.waiting) {
      e.ticket.cancel();
      e.ticket = null;
    }
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    notify(e);
    tidy(e);
    return;
  }
  e.used = performance.now();
  if (e.ticket || e.checking) {
    e.ticket?.setPriority(p);
    return;
  }
  if (e.permanent || e.timer) return;
  const wait = e.retryAt - Date.now();
  if (e.failures > 0 && wait > 0) {
    e.timer = setTimeout(() => {
      e.timer = null;
      update(e);
    }, wait);
    return;
  }
  void load(e, p);
}

async function load(e: Entry, priority: number): Promise<void> {
  const plan = stillPlan(e.src, e.px);
  try {
    let blob: Blob | null = null;
    if (plan.draw && !e.checked) {
      // drawn on an earlier visit: no download and no drawing
      e.checking = true;
      notify(e);
      blob = await loadStill(e.key);
      e.checking = false;
      e.checked = true;
      if (!blob && best(e) === null) {
        notify(e);
        tidy(e);
        return;
      }
    }
    if (blob) {
      // kept from before
    } else if (plan.draw === "webm") {
      // the player fetches only what the first frame needs, so it is the download
      const t = network.add(priority, (signal) => webmPoster(plan.url, e.px, signal, STALL_MS));
      e.ticket = t;
      notify(e);
      blob = await t.promise;
      void saveStill(e.key, blob);
    } else {
      if (plan.draw === "tgs") void warmLottie().catch(() => undefined);
      let got = e.source;
      if (!got) {
        const t = network.add(priority, (signal) => fetchBlob(plan.url, signal));
        e.ticket = t;
        notify(e);
        got = await t.promise;
        if (plan.draw) {
          e.source = got;
          bytesKept += got.size;
        }
      }
      blob = got;
      if (plan.draw === "tgs") {
        const source = got;
        const t = drawing.add(best(e) ?? 2, async (signal) => {
          // one frame per quiet moment, so a long grid of them never holds up scrolling
          await idle();
          return tgsPoster(source, e.px, signal);
        });
        e.ticket = t;
        notify(e);
        blob = await t.promise;
        if (e.source) bytesKept -= e.source.size;
        e.source = null;
        void saveStill(e.key, blob);
      }
    }
    e.ticket = null;
    e.url = URL.createObjectURL(blob);
    e.bytes = blob.size;
    bytesKept += blob.size;
    e.failures = 0;
    e.pressed = false;
    e.permanent = false;
    e.used = performance.now();
    notify(e);
    trim();
  } catch (err) {
    e.ticket = null;
    e.pressed = false;
    if (isAborted(err)) {
      notify(e);
      // dropped because nobody wanted it; someone may want it again meanwhile
      if (best(e) !== null) update(e);
      else tidy(e);
      return;
    }
    // a file that would not draw may have come in damaged: the next try downloads it again
    if (e.source) bytesKept -= e.source.size;
    e.source = null;
    e.failures++;
    e.permanent = err instanceof UnsupportedError || (err instanceof HttpError && [400, 403, 404, 410].includes(err.status));
    e.retryAt = Date.now() + retryDelay(e.failures - 1);
    notify(e);
    update(e);
  }
}

/**
 * Lets go of the stills least recently wanted once over budget, but only ones
 * no tile near the screen is showing; such a tile loads its still again when
 * it comes back near.
 */
function trim(): void {
  const limit = budget();
  if (bytesKept <= limit) return;
  const spare = [...entries.values()].filter((e) => e.url && best(e) === null).sort((a, b) => a.used - b.used);
  for (const e of spare) {
    if (bytesKept <= limit) break;
    URL.revokeObjectURL(e.url!);
    bytesKept -= e.bytes;
    e.url = null;
    e.bytes = 0;
    notify(e);
    tidy(e);
  }
}

/** Downloads url, giving up if it goes quiet for STALL_MS (a stalled connection otherwise waits forever). */
async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const ctrl = new AbortController();
  let stalled = false;
  const stop = () => ctrl.abort();
  signal.addEventListener("abort", stop);
  let timer = setTimeout(() => {
    stalled = true;
    stop();
  }, STALL_MS);
  const quiet = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      stop();
    }, STALL_MS);
  };
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status);
    const type = res.headers.get("Content-Type") ?? "";
    if (!res.body) return await res.blob();
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      quiet();
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return new Blob(parts as BlobPart[], { type });
  } catch (err) {
    if (signal.aborted) throw err instanceof Error && err.name === "AbortError" ? err : Object.assign(new Error("aborted"), { name: "AbortError" });
    if (stalled) throw new Error("download stalled");
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

let listening = false;

/** Failed stills are tried again as soon as the connection comes back. */
function listenForOnline(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => {
    for (const e of entries.values()) {
      if (e.url || e.failures === 0 || e.permanent) continue;
      e.retryAt = 0;
      if (e.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
      update(e);
    }
  });
}

/**
 * Loads the Lottie player for a grid that holds animated stickers further
 * down, once the stills near the screen are in: scrolling to them then only
 * waits for their own files. (A tile that needs it sooner loads it at once.)
 */
export function warmLottieLater(): void {
  void new Promise((r) => setTimeout(r, 500))
    .then(() => network.whenIdle())
    .then(idle)
    .then(() => warmLottie())
    .catch(() => undefined);
}

/** What a tile would show right now, without asking for anything: a kept still shows on the first frame. */
export function peekStill(src: StillSource, px: number): StillView {
  return entries.get(stillKey(src, px))?.view ?? IDLE;
}

/** Follows the still for one tile. The listener hears every change; the first call is immediate. */
export function watchStill(src: StillSource, px: number, listener: (v: StillView) => void): StillHandle {
  listenForOnline();
  const key = stillKey(src, px);
  let e = entries.get(key);
  if (!e) {
    e = { key, src, px, url: null, bytes: 0, source: null, watchers: new Set(), ticket: null, failures: 0, pressed: false, checking: false, checked: false, permanent: false, retryAt: 0, timer: null, used: 0, view: IDLE };
    entries.set(key, e);
  }
  const entry = e;
  const w: Watcher = { listener, priority: null };
  entry.watchers.add(w);
  listener(entry.view);
  let released = false;
  return {
    want(priority) {
      if (released || w.priority === priority) return;
      w.priority = priority;
      update(entry);
    },
    retry() {
      if (released || entry.url || entry.ticket) return;
      entry.permanent = false;
      entry.pressed = true;
      entry.retryAt = 0;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (w.priority === null) w.priority = 0;
      update(entry);
    },
    release() {
      if (released) return;
      released = true;
      entry.watchers.delete(w);
      update(entry);
    },
  };
}

/** For tests: forgets every still. */
export function resetStills(): void {
  for (const e of entries.values()) {
    if (e.url) URL.revokeObjectURL(e.url);
    if (e.timer) clearTimeout(e.timer);
    e.ticket?.cancel();
  }
  entries.clear();
  bytesKept = 0;
}
