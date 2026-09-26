/**
 * The screenshots and recordings sent with bug reports, as addresses a page
 * can show. They are not public, so an <img src> cannot fetch them: the
 * server wants this session's token, which only a request made here can
 * carry. Each is fetched once, kept as an object URL while something shows it,
 * and let go a while after nothing does.
 */
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { bugs as bugsApi } from "@/api/bugs";
import { playableType } from "@/lib/mediaCache";

interface Entry {
  url: string;
  /** Whose session fetched it: another account never sees it. */
  token: string | null;
  refs: number;
  last: number;
}

/** How many unused ones are kept for coming back to. */
const KEEP = 24;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

function keyOf(id: string, size?: number): string {
  return size ? `${id}@${size}` : id;
}

function drop(k: string, e: Entry): void {
  URL.revokeObjectURL(e.url);
  cache.delete(k);
}

function trim(): void {
  const idle = [...cache.entries()].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].last - b[1].last);
  for (const [k, e] of idle.slice(0, Math.max(0, idle.length - KEEP))) drop(k, e);
}

/** Fetches a report file, or a picture's thumbnail no larger than `size`, as an object URL. */
export function bugFileURL(id: string, size?: number): Promise<string> {
  const k = keyOf(id, size);
  const token = api.getToken();
  const hit = cache.get(k);
  if (hit && hit.token === token) {
    hit.last = Date.now();
    return Promise.resolve(hit.url);
  }
  if (hit) drop(k, hit);
  const pending = inflight.get(k);
  if (pending) return pending;
  const job = (async () => {
    try {
      const res = await api.fetchImpl(bugsApi.fileUrl(id, size), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`bug file ${id}: ${res.status}`);
      const raw = await res.blob();
      // the session changed while it was on its way: it belonged to that one
      if (api.getToken() !== token) throw new DOMException("Aborted", "AbortError");
      const blob = new Blob([raw], { type: playableType(raw.type) });
      const url = URL.createObjectURL(blob);
      cache.set(k, { url, token, refs: 0, last: Date.now() });
      trim();
      return url;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, job);
  return job;
}

/** Keeps a fetched URL from being let go while something shows it; pair with releaseBugFile. */
export function holdBugFile(id: string, size: number | undefined, url: string): boolean {
  const e = cache.get(keyOf(id, size));
  if (!e || e.url !== url) return false;
  e.refs += 1;
  e.last = Date.now();
  return true;
}

export function releaseBugFile(id: string, size: number | undefined, url: string): void {
  const e = cache.get(keyOf(id, size));
  if (!e || e.url !== url || e.refs === 0) return;
  e.refs -= 1;
  e.last = Date.now();
  if (e.refs === 0) trim();
}

/** Lets go of everything, on sign-out. */
export function clearBugFiles(): void {
  for (const [k, e] of [...cache.entries()]) drop(k, e);
  inflight.clear();
}

/** A report file as an object URL, fetched when `enabled`, held while the component shows it. */
export function useBugFileURL(id: string, size: number | undefined, enabled = true): { url: string | null; failed: boolean; retry: () => void } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let held: string | null = null;
    setFailed(false);
    bugFileURL(id, size)
      .then((u) => {
        if (!alive) return;
        if (holdBugFile(id, size, u)) held = u;
        setUrl(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (held) releaseBugFile(id, size, held);
    };
  }, [id, size, enabled, attempt]);
  return { url, failed, retry: () => setAttempt((n) => n + 1) };
}
