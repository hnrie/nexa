import { b64 } from "@/crypto/bytes";

/**
 * Invite links may carry the server's current root key in the URL fragment
 * (`#k=<epoch>.<base64url root>`). Fragments never reach the server, so the
 * key stays end-to-end: the inviter hands it to whoever they gave the link to.
 */
export interface InviteKey {
  epoch: number;
  root: Uint8Array;
}

function toUrl(b: string): string {
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrl(u: string): string {
  const s = u.replace(/-/g, "+").replace(/_/g, "/");
  return s + "=".repeat((4 - (s.length % 4)) % 4);
}

export function encodeInviteKey(k: InviteKey): string {
  return `k=${k.epoch}.${toUrl(b64.enc(k.root))}`;
}

export function parseInviteFragment(hash: string): InviteKey | null {
  const m = /(?:^|[#&])k=(\d+)\.([A-Za-z0-9_-]{40,50})(?:&|$)/.exec(hash);
  if (!m) return null;
  try {
    const root = b64.dec(fromUrl(m[2]!));
    if (root.length !== 32) return null;
    return { epoch: Number(m[1]), root };
  } catch {
    return null;
  }
}

export function inviteUrl(code: string, key?: InviteKey | null): string {
  const base = `${window.location.origin}/invite/${code}`;
  return key ? `${base}#${encodeInviteKey(key)}` : base;
}

/**
 * How an invite link to Nexa reads in a message: its address
 * without the key, which is most of its length and nothing a reader needs to
 * see. The link still carries the key when it is opened. Null for any other
 * address, or an invite with no key to hide.
 */
export function shownInvite(url: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(url);
    if (u.origin !== window.location.origin || !/^\/invite\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) || !u.hash) return null;
    return u.host + u.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}
