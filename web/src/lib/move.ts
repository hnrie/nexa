/**
 * Moving to Nexa's new address without signing out.
 *
 * A browser keeps a sign-in per address, so the copy of the app at an
 * address Nexa moved away from cannot simply give its sign-in to the copy at
 * the new one: neither ever sees the other's storage. The page at the old
 * address (the server marks it, see movedTag in internal/api/static.go) seals
 * what this device holds with a key it makes up on the spot: the session, the
 * account's keys or the passcode-locked copy of them, and this device's own
 * preferences. It leaves the sealed copy with the server for a minute and
 * moves on to the same page at the new address, with the copy's name and the
 * key in the part of the link after the #, which no server ever sees. The page
 * there takes the copy back, once, opens it, and takes those words out of the
 * address before anything else reads it.
 *
 * The server holds only the sealed copy, never its key, and gives it only to
 * a page at Nexa's own address that was opened from the old one, so a link
 * someone is sent cannot sign them in to somebody else's account (see
 * internal/api/handoff.go).
 */
import { b64 } from "@/crypto/bytes";
import { keystore } from "@/crypto/keystore";
import { desktopBridge } from "@/lib/desktopBridge";
import { storage } from "@/lib/storage";
import { TOKEN_KEY } from "@/stores/auth";

const FRAGMENT = "nexa-handoff";
/** A preference bigger than this stays behind, and all of them together stop here. */
const MAX_ITEM = 64 * 1024;
const MAX_ALL = 384 * 1024;

/** What is moved: the session, the keys or their locked copy, and this device's preferences. */
export interface Moving {
  v: 1;
  token: string;
  userId: string;
  identity?: { pub: string; priv: string };
  /**
   * This device's localStorage at the old address, which only ever held the
   * app's own: the passcode's lock record, pinned keys, the Terms agreed to,
   * preferences. Crash counters stay behind.
   */
  local: Record<string, string>;
}

/** Where Nexa has moved to, when this page is at an address it moved away from. */
export function movedTo(): string | null {
  if (typeof document === "undefined") return null;
  const to = document.querySelector('meta[name="nexa-moved-to"]')?.getAttribute("content")?.trim();
  if (!to) return null;
  try {
    const u = new URL(to);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.origin === location.origin) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Whether `version` ("1.1.0") comes before `than`. */
export function olderThan(version: string, than: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = than.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/**
 * A desktop app from before the move opens the old address and can open no
 * other, so there the app goes on as it was until the app updates itself
 * (1.2.0 opens the new address, and moves its sign-in over the same way).
 */
export function stayForOldDesktop(): boolean {
  const bridge = desktopBridge();
  return !!bridge && olderThan(bridge.version ?? "0", "1.2.0");
}

function localEntries(): Record<string, string> {
  const out: Record<string, string> = {};
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || /crash/i.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value === null || value.length > MAX_ITEM || total + value.length > MAX_ALL) continue;
      out[key] = value;
      total += value.length;
    }
  } catch {
    /* storage turned off: the session alone moves */
  }
  return out;
}

async function aesKey(raw: Uint8Array, use: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, [use]);
}

/** Seals what moves under a key made for this move alone: the copy, and the key. */
export async function sealMoving(moving: Moving): Promise<{ sealed: string; key: Uint8Array }> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(moving));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(key, "encrypt"), plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return { sealed: b64.enc(out), key };
}

export async function openMoving(sealed: string, key: Uint8Array): Promise<Moving | null> {
  try {
    const all = b64.dec(sealed);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(key, "decrypt"), all.slice(12));
    const v = JSON.parse(new TextDecoder().decode(plain)) as Partial<Moving>;
    if (v.v !== 1 || typeof v.token !== "string" || typeof v.userId !== "string" || typeof v.local !== "object" || v.local === null) return null;
    return v as Moving;
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array): string => b64.enc(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array => b64.dec(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

/** Leaves this device's sign-in with the server, sealed: the words for the link, or "" signed out. */
async function leave(): Promise<string> {
  const token = storage.get(TOKEN_KEY);
  if (!token) return "";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const meRes = await fetch("/api/v1/users/@me", { headers });
  if (!meRes.ok) return "";
  const me = (await meRes.json()) as { id?: string };
  if (!me.id) return "";
  // with a passcode on this device there is no plain copy of the keys, and
  // the locked one goes with the preferences, so the passcode still opens them
  const identity = await keystore.loadIdentity(me.id).catch(() => null);
  const moving: Moving = { v: 1, token, userId: me.id, local: localEntries() };
  if (identity) moving.identity = { pub: b64.enc(identity.publicKey), priv: b64.enc(identity.privateKey) };
  const { sealed, key } = await sealMoving(moving);
  const res = await fetch("/api/v1/handoffs", { method: "POST", headers, body: JSON.stringify({ sealed }) });
  if (!res.ok) return "";
  const { id } = (await res.json()) as { id?: string };
  return id ? `${id}.${b64url(key)}` : "";
}

/** The link to `path` at `origin`, carrying the words to take a sign-in by when there are any. */
export function movedLink(origin: string, path: string, hash: string, words: string): string {
  const own = hash === "#" ? "" : hash;
  if (!words) return origin + path + own;
  return origin + path + (own ? `${own}&` : "#") + `${FRAGMENT}=${words}`;
}

/** Goes on to the same page at Nexa's new address, signed in as here when this device is. */
export async function moveTo(origin: string, go: (url: string) => void = (url) => location.replace(url)): Promise<void> {
  let words = "";
  try {
    words = await leave();
  } catch {
    /* moves on signed out: signing in there works as ever */
  }
  go(movedLink(origin, location.pathname + location.search, location.hash, words));
}

/** The words a moved link carries, and the address without them. */
export function handoffIn(hash: string): { id: string; key: string; rest: string } | null {
  const m = new RegExp(`(^#|&)${FRAGMENT}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)$`).exec(hash);
  if (!m) return null;
  const rest = hash.slice(0, m.index);
  return { id: m[2]!, key: m[3]!, rest: rest === "#" ? "" : rest };
}

/**
 * Takes a sign-in moved from the old address, when this page was opened with
 * one: before anything reads the session or the address. A device signed in
 * here already keeps the sign-in it has.
 */
export async function takeHandoff(): Promise<void> {
  if (typeof location === "undefined") return;
  const found = handoffIn(location.hash);
  if (!found) return;
  history.replaceState(history.state, "", location.pathname + location.search + found.rest);
  if (storage.get(TOKEN_KEY)) return;
  try {
    const res = await fetch("/api/v1/handoffs/take", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: found.id, from: document.referrer }),
    });
    if (!res.ok) return;
    const { sealed } = (await res.json()) as { sealed?: string };
    if (!sealed) return;
    const moving = await openMoving(sealed, fromB64url(found.key));
    if (!moving) return;
    for (const [k, v] of Object.entries(moving.local)) {
      if (k !== TOKEN_KEY && typeof v === "string" && !/crash/i.test(k)) storage.set(k, v);
    }
    if (moving.identity) await keystore.saveIdentity(moving.userId, { publicKey: b64.dec(moving.identity.pub), privateKey: b64.dec(moving.identity.priv) });
    storage.set(TOKEN_KEY, moving.token);
  } catch {
    /* not moved: signing in here works as ever */
  }
}
