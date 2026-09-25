/**
 * The key that seals the search index on this device.
 *
 * It is a random key made on this device for this account, never sent
 * anywhere. It is kept wrapped, in this browser's local storage, under a key
 * derived from the account's identity key, so it can only be opened while the
 * account is unlocked here: behind a passcode the identity key itself is
 * sealed with the passcode (lib/appLock.ts), and a locked app holds neither.
 * Without a passcode the identity key sits in this browser's key store, and
 * the index is as well protected as the conversation keys beside it, which
 * read the same messages from the server.
 *
 * Signing out removes the wrapped key first. That takes effect at once,
 * whatever happens to the database after it: blocks left behind by a delete
 * that did not finish can never be opened again.
 */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { b64, randomBytes, utf8 } from "@/crypto/bytes";
import { storage } from "@/lib/storage";

const INFO = utf8.enc("evilion-chat/search-index/v1");
const PREFIX = "ec.searchKey.";

function slot(userId: string): string {
  return PREFIX + userId;
}

function view(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(u);
}

async function wrapping(identityPrivateKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const kek = hkdf(sha256, identityPrivateKey, new Uint8Array(0), INFO, 32);
  try {
    return await crypto.subtle.importKey("raw", view(kek), "AES-GCM", false, [usage]);
  } finally {
    kek.fill(0);
  }
}

/** The index key for use: an AES-GCM key the page and the worker can use but never export. */
function asIndexKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", view(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface IndexKey {
  key: CryptoKey;
  /** Made just now: whatever index was on disk before cannot be opened with it. */
  fresh: boolean;
}

/**
 * This account's index key on this device, made if there is none. Null when
 * this browser cannot keep one (local storage refused), in which case the
 * index is kept in memory only.
 */
export async function indexKeyFor(userId: string, identityPrivateKey: Uint8Array): Promise<IndexKey | null> {
  const aad = utf8.enc(`search-key/v1|${userId}`);
  const stored = storage.get(slot(userId));
  if (stored) {
    try {
      const blob = b64.dec(stored);
      const iv = blob.subarray(0, 12);
      const ct = blob.subarray(12);
      const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: view(iv), additionalData: view(aad) }, await wrapping(identityPrivateKey, "decrypt"), view(ct)));
      try {
        return { key: await asIndexKey(raw), fresh: false };
      } finally {
        raw.fill(0);
      }
    } catch {
      // wrapped under another identity key (a recovery gave the account a
      // new one) or damaged: a new key, and a new index with it
    }
  }
  const raw = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: view(iv), additionalData: view(aad) }, await wrapping(identityPrivateKey, "encrypt"), view(raw)));
    const blob = new Uint8Array(iv.length + ct.length);
    blob.set(iv, 0);
    blob.set(ct, iv.length);
    const encoded = b64.enc(blob);
    storage.set(slot(userId), encoded);
    if (storage.get(slot(userId)) !== encoded) return null;
    return { key: await asIndexKey(raw), fresh: true };
  } finally {
    raw.fill(0);
  }
}

/** Forgets the key, which makes the index on disk unreadable for good. */
export function forgetIndexKey(userId: string): void {
  storage.remove(slot(userId));
}
