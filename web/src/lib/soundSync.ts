/**
 * Keeps the sound player (lib/sounds.ts) in step with the account's sound
 * settings, which arrive with the encrypted settings and change whenever any
 * of the account's devices changes them. Also what adds and takes away a
 * custom pack's recordings on the server.
 */

import { channels } from "@/api/channels";
import { sounds as soundsApi } from "@/api/sounds";
import { b64 } from "@/crypto/bytes";
import { decryptFile, encryptFile } from "@/crypto/file";
import { useSettings } from "@/stores/settings";
import { filesInUse, prepareSound, type SoundFile } from "./soundPacks";
import { configureSounds, type SoundName } from "./sounds";

/** Fetches a custom recording and opens it. */
async function openSoundFile(file: SoundFile): Promise<ArrayBuffer> {
  const sealed = await channels.downloadAttachment(file.blob, undefined, file.size > 0 ? file.size : undefined);
  const plain = await decryptFile(sealed, b64.dec(file.key));
  return plain.arrayBuffer();
}

let installed = false;

/** Configures the player now and whenever the sound settings change. */
export function installSoundSettings(): void {
  if (installed) return;
  installed = true;
  let last = useSettings.getState().settings.sounds;
  configureSounds(last, openSoundFile);
  useSettings.subscribe((st) => {
    if (st.settings.sounds === last) return;
    last = st.settings.sounds;
    configureSounds(last);
  });
}

/**
 * Makes a picked file into one of the account's sounds: converted, sealed
 * and kept on the server. The returned SoundFile goes into a pack; until it
 * does, nothing plays it.
 */
export async function addSoundFile(file: File, name: SoundName, signal?: AbortSignal): Promise<SoundFile> {
  const { wav, ms } = await prepareSound(file, name);
  const { key, blob } = await encryptFile(wav);
  const res = await soundsApi.upload(blob, signal);
  return { blob: res.blob_id, key: b64.enc(key), name: file.name.slice(0, 120), ms, size: res.size || blob.size };
}

/** Lets a recording go on the server; quietly, since a leftover only costs a little space until the next tidy. */
export async function dropSoundFile(blob: string): Promise<void> {
  try {
    await soundsApi.remove(blob);
  } catch {
    /* tidySoundFiles takes it later */
  }
}

/** How long a file must have been on the server before a tidy may take it: another device may be about to name it. */
const TIDY_AFTER_MS = 60 * 60 * 1000;

/**
 * Takes away recordings no pack names any more: one replaced or removed on a
 * device that went offline before it could say so, or an upload whose pack
 * was never saved.
 */
export async function tidySoundFiles(): Promise<void> {
  const st = useSettings.getState();
  // judged only against the account's own settings, never the defaults a device has before they arrive
  if (!st.loaded) return;
  const used = filesInUse(st.settings.sounds);
  const { sounds } = await soundsApi.list();
  const now = Date.now();
  for (const f of sounds) {
    if (!used.has(f.blob_id) && now - f.created_at > TIDY_AFTER_MS) await dropSoundFile(f.blob_id);
  }
}
