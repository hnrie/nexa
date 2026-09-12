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
