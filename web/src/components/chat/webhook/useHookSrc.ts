import { useEffect, useState } from "react";
import { acquire, attachmentObjectURL, cachedURL, release } from "@/lib/mediaCache";
import { useMediaLinks } from "@/lib/mediaLinks";
import { mediaAttachment, type HookContent, type HookMedia } from "@/lib/webhookMessage";

/**
 * Where to load a picture in a webhook message from: one of the message's own
 * files (fetched with the reader's session, like any attachment), or a remote
 * picture through this server's media proxy, which signs it again when its
 * link has run out. Undefined while it is on its way, null for nothing to show.
 */
export function useHookSrc(hook: HookContent, media: Pick<HookMedia, "proxy_url" | "blob_id"> | undefined): string | null | undefined {
  const links = useMediaLinks();
  const att = media?.blob_id ? mediaAttachment(hook, { url: "", blob_id: media.blob_id }) : null;
  const blobId = att?.blob_id ?? null;
  const [url, setUrl] = useState<string | null | undefined>(() => (blobId ? (cachedURL(blobId) ?? undefined) : undefined));
  useEffect(() => {
    if (!att) return;
    const have = cachedURL(att.blob_id);
    if (have) {
      setUrl(have);
      return;
    }
    let alive = true;
    attachmentObjectURL(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
    // the attachment is rebuilt on every render; its blob is what identifies it
  }, [blobId]);
  useEffect(() => {
    if (!blobId || !url) return;
    if (!acquire(blobId, url)) return;
    return () => release(blobId, url);
  }, [blobId, url]);
  if (media?.blob_id) return att ? url : null;
  return links(media?.proxy_url);
}

/** useHookSrc for an icon given as a proxy link and a blob id. */
export function useHookIcon(hook: HookContent, proxy: string | undefined, blob: string | undefined): string | null | undefined {
  const media: Pick<HookMedia, "proxy_url" | "blob_id"> = {};
  if (proxy) media.proxy_url = proxy;
  if (blob) media.blob_id = blob;
  return useHookSrc(hook, proxy || blob ? media : undefined);
}
