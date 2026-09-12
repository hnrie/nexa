import { channels as channelsApi } from "@/api/channels";
import { b64 } from "@/crypto/bytes";
import { encryptFile } from "@/crypto/file";
import type { AttachmentMeta } from "@/crypto/message";

export const MAX_UPLOAD = 100 * 1024 * 1024;

export interface Staged {
  id: string;
  file: File;
  name: string;
  spoiler: boolean;
  preview: string | null;
  progress: number;
  error: string | null;
}

let seq = 0;
export function stage(file: File): Staged {
  seq += 1;
  const preview = file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null;
  return { id: `f${seq}`, file, name: file.name, spoiler: false, preview, progress: 0, error: null };
}

async function imageDims(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/** Encrypts and uploads a staged file, returning the metadata that rides inside the message. */
export async function uploadStaged(channelId: string, st: Staged, onProgress: (p: number) => void): Promise<{ meta: AttachmentMeta; blob_id: string; size: number }> {
  if (st.file.size > MAX_UPLOAD) throw new Error("That file is over the 100 MB limit.");
  const { key, blob } = await encryptFile(st.file, (done, total) => onProgress(total ? (done / total) * 0.4 : 0));
  const res = await channelsApi.uploadAttachment(channelId, blob, (loaded, total) => onProgress(0.4 + (total ? loaded / total : 0) * 0.6));
  const dims = await imageDims(st.file);
  const meta: AttachmentMeta = { blob_id: res.blob_id, name: st.name || st.file.name, type: st.file.type || "application/octet-stream", size: st.file.size, key: b64.enc(key) };
  if (dims) {
    meta.w = dims.w;
    meta.h = dims.h;
  }
  if (st.spoiler) meta.spoiler = true;
  return { meta, blob_id: res.blob_id, size: res.size };
}
