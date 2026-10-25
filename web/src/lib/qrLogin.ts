/**
 * Signing in with a QR code (internal/api/qr_login.go).
 *
 * The device signing in makes a one-time key and shows a code that is a link
 * to `/login/qr#<id>.<public key>`, so a phone's own camera opens it as well
 * as the Android app's scanner. On a device where the account is signed in,
 * that page (or the app) says which device is asking and, on Approve, seals
 * the identity key to the public key from the code itself, never to one the
 * server names. The waiting device opens the box, checks it holds the key of
 * the account it was signed in to, and goes on as after a password.
 */
import { api } from "@/api/client";
import type { MeUser, PublicUser } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { generateIdentity, open, publicKeyOf, seal, type Identity } from "@/crypto/keys";
import { b64url } from "@/lib/passkeys";

export type QrState = "pending" | "scanned" | "approved" | "denied" | "expired";

interface PollAnswer {
  state: QrState;
  user?: PublicUser & Partial<MeUser>;
  token?: string;
  public_key?: string;
  sealed_identity?: string;
}

/** The link a code carries for a request. */
export function qrLink(origin: string, id: string, publicKey: Uint8Array): string {
  return `${origin}/login/qr#${id}.${b64url.enc(publicKey)}`;
}

/** Reads `<id>.<public key>` from a code's link, or null when it is not one. */
export function parseQrLink(hashOrUrl: string): { id: string; publicKey: Uint8Array } | null {
  const frag = hashOrUrl.includes("#") ? hashOrUrl.slice(hashOrUrl.indexOf("#") + 1) : hashOrUrl;
  const m = /^([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{43})$/.exec(frag.trim());
  const [, id, key] = m ?? [];
  if (!id || !key) return null;
  try {
    const publicKey = b64url.dec(key);
    return publicKey.length === 32 ? { id, publicKey } : null;
  } catch {
    return null;
  }
}

export interface QrWaitEvents {
  /** A new code to show (the first, and each one after the last expired). */
  onCode: (link: string) => void;
  /** Someone scanned it and is deciding. */
  onScanned: (user: PublicUser) => void;
  /** They said no; a new code follows. */
  onDenied: () => void;
}

/**
 * Shows codes until one is approved, then returns the session and the identity
 * key it carried. `signal` stops it (the page going away).
 */
export async function waitForQrSignIn(ev: QrWaitEvents, signal: AbortSignal): Promise<{ me: MeUser; token: string; identity: Identity }> {
  while (!signal.aborted) {
    const eph = generateIdentity();
    const req = await api.request<{ id: string; poll: string }>("POST", "/auth/qr", { public_key: b64.enc(eph.publicKey) }, { signal });
    ev.onCode(qrLink(location.origin, req.id, eph.publicKey));
    let seen: QrState = "pending";
    for (;;) {
      const a: PollAnswer = await api.request<PollAnswer>("GET", `/auth/qr/${req.id}`, undefined, { signal, query: { poll: req.poll, seen } });
      if (a.state === seen) continue;
      if (a.state === "scanned" && a.user) {
        seen = "scanned";
        ev.onScanned(a.user);
        continue;
      }
      if (a.state === "approved" && a.user && a.token && a.public_key && a.sealed_identity) {
        const publicKey = b64.dec(a.public_key);
        const privateKey = await open(eph.privateKey, eph.publicKey, b64.dec(a.sealed_identity));
        // the box must hold the key of the account the session is for
        if (b64.enc(publicKeyOf(privateKey)) !== a.public_key) throw new Error("qr: the key does not belong to the account");
        return { me: a.user as MeUser, token: a.token, identity: { publicKey, privateKey } };
      }
      if (a.state === "denied") ev.onDenied();
      break;
    }
  }
  throw new DOMException("stopped", "AbortError");
}

/** The phone's side: says it scanned, and learns which device is asking. */
export function scanQr(id: string): Promise<{ user_agent: string; created_at: number }> {
  return api.request("POST", `/auth/qr/${id}/scan`, {});
}

/** Seals the identity key to the key in the code and lets the device in. */
export async function approveQr(id: string, publicKey: Uint8Array, identity: Identity): Promise<void> {
  const box = await seal(publicKey, identity.privateKey);
  await api.request<void>("POST", `/auth/qr/${id}/approve`, { sealed_identity: b64.enc(box) });
}

export function denyQr(id: string): Promise<void> {
  return api.request<void>("POST", `/auth/qr/${id}/deny`, {});
}
