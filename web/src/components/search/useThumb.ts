/**
 * A picture for a search result, decrypted on this device like any other.
 *
 * Files are end-to-end encrypted and the server has no thumbnails to give, so
 * a thumbnail is the picture itself, fetched and decrypted once it nears the
 * screen and let go of when it scrolls far away. Big files are left alone
 * until someone opens them.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { AttachmentMeta } from "@/crypto/message";
import { acquire, attachmentObjectURL, cachedURL, release } from "@/lib/mediaCache";

/** Pictures up to this size load by themselves, as they do in the chat. */
export const THUMB_MAX = 25 * 1024 * 1024;

export function useThumb(att: AttachmentMeta | null, ref: RefObject<HTMLElement | null>): { url: string | null; failed: boolean; tooBig: boolean } {
  const [url, setUrl] = useState<string | null>(att ? (cachedURL(att.blob_id) ?? null) : null);
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);
  const started = useRef(false);
  const tooBig = !!att && att.size > THUMB_MAX;

  useEffect(() => {
    const el = ref.current;
    if (!att || tooBig || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { root: el.closest("[data-search-scroller]"), rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [att, tooBig, ref]);

  useEffect(() => {
    if (!att || !near || url || failed || started.current) return;
    started.current = true;
    attachmentObjectURL(att)
      .then((u) => setUrl(u))
      .catch(() => setFailed(true))
      .finally(() => {
        started.current = false;
      });
  }, [att, near, url, failed]);

  // held while shown, so the cache does not take it away under the picture
  useEffect(() => {
    if (!url || !att) return;
    if (!acquire(att.blob_id, url)) {
      setUrl(null);
      return;
    }
    return () => release(att.blob_id, url);
  }, [url, att]);

  return { url, failed, tooBig };
}
