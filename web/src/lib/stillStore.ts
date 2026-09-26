/**
 * Drawn stills kept on this device between visits.
 *
 * A Lottie or video sticker's still is drawn here (stickerPosters.ts), which
 * costs a weak phone a moment of work each; kept in the browser's cache
 * storage, the next visit shows them without drawing again. They are frames
 * of public stickers, so nothing private is stored. Everything here is a
 * convenience: when storage is unavailable (a private window, a full disk)
 * stills are simply drawn again.
 */

const NAME = "nexa-sticker-stills-v1";
/** Older versions of the store, cleared the first time this one opens. */
const OLD = /^nexa-sticker-stills-(?!v1$)/;

let opened: Promise<Cache | null> | null = null;

function open(): Promise<Cache | null> {
  if (!opened) {
    opened = (async () => {
      if (typeof caches === "undefined") return null;
      try {
        for (const k of await caches.keys()) if (OLD.test(k)) await caches.delete(k);
        return await caches.open(NAME);
      } catch {
        return null;
      }
    })();
  }
  return opened;
}

/** The address a still is filed under: never fetched, only a name. */
function keyOf(key: string): string {
  return new URL(`/__still/${encodeURIComponent(key)}`, typeof location !== "undefined" ? location.origin : "http://localhost").toString();
}

export async function loadStill(key: string): Promise<Blob | null> {
  try {
    const cache = await open();
    const hit = await cache?.match(keyOf(key));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function saveStill(key: string, blob: Blob): Promise<void> {
  try {
    const cache = await open();
    await cache?.put(keyOf(key), new Response(blob, { headers: { "Content-Type": blob.type || "image/webp" } }));
  } catch {
    /* storage is a convenience */
  }
}

/** For tests. */
export function resetStillStore(): void {
  opened = null;
}
