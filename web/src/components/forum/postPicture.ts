import { useEffect, useState } from "react";
import type { AttachmentMeta } from "@/crypto/message";
import { acquire, attachmentObjectURL, PRIORITY, release } from "@/lib/mediaCache";

/** A post's first picture, as its small copy when it has one, for the list to show. */
export function firstPicture(att: readonly AttachmentMeta[] | undefined): AttachmentMeta | null {
  const pic = att?.find((a) => a.type.startsWith("image/") && !a.spoiler);
  if (!pic) return null;
  if (pic.preview) return { ...pic, blob_id: pic.preview.blob_id, key: pic.preview.key, size: pic.preview.size, type: pic.preview.type };
  return pic;
}

/** The address of a decrypted picture while it is shown, fetched when it comes into use. */
export function usePictureURL(att: AttachmentMeta | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!att) return;
    const stop = new AbortController();
    let held: string | null = null;
    attachmentObjectURL(att, stop.signal, PRIORITY.visible)
      .then((u) => {
        if (stop.signal.aborted || !acquire(att.blob_id, u)) return;
        held = u;
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      stop.abort();
      if (held) release(att.blob_id, held);
      setUrl(null);
    };
  }, [att?.blob_id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
