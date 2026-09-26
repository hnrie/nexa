import { useEffect } from "react";
import { create } from "zustand";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { InvitePreview } from "@/api/types";

/**
 * Invite previews this device has asked the server for, by code.
 *
 * A link preview is made on the sender's device and sealed into the message,
 * so a message sent with previews off, or before invite cards existed, has
 * none. The reader asks the server about the invite instead: the answer is
 * public (anyone with the code may see it), and it is fresher than anything
 * sealed into a message, down to the banner and who is online now.
 */
export type InviteEntry =
  | { status: "loading" }
  | { status: "ready"; preview: InvitePreview; at: number }
  | { status: "invalid"; at: number }
  | { status: "failed"; at: number };

/** Counts go stale: a card drawn again after this long asks again, showing what it had meanwhile. */
const FRESH_MS = 5 * 60_000;
/** A failed request (offline, busy) is tried again after this long. */
const RETRY_MS = 30_000;

export const useInvitePreviews = create<{ byCode: Record<string, InviteEntry> }>()(() => ({ byCode: {} }));

const inflight = new Map<string, Promise<void>>();

function put(code: string, entry: InviteEntry): void {
  useInvitePreviews.setState((s) => ({ byCode: { ...s.byCode, [code]: entry } }));
}

function due(e: InviteEntry | undefined, now: number): boolean {
  if (!e) return true;
  if (e.status === "loading") return false;
  return now - e.at > (e.status === "failed" ? RETRY_MS : FRESH_MS);
}

interface LoadOptions {
  /** Ask again even if the answer is fresh: after trying again by hand, or after joining. */
  force?: boolean;
  fetch?: (code: string) => Promise<InvitePreview>;
  now?: () => number;
}

/** Asks the server about an invite unless this device already knows, or is already asking. */
export function loadInvitePreview(code: string, opts: LoadOptions = {}): Promise<void> {
  const now = opts.now ?? Date.now;
  const running = inflight.get(code);
  if (running) return running;
  const cur = useInvitePreviews.getState().byCode[code];
  if (!opts.force && !due(cur, now())) return Promise.resolve();
  // an answer already on screen stays there while it is refreshed
  if (cur?.status !== "ready") put(code, { status: "loading" });
  const fetchPreview = opts.fetch ?? ((c: string) => serversApi.invitePreview(c));
  const p = fetchPreview(code)
    .then(
      (preview) => put(code, { status: "ready", preview, at: now() }),
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 404) put(code, { status: "invalid", at: now() });
        else if (cur?.status === "ready") put(code, { ...cur, at: now() });
        else put(code, { status: "failed", at: now() });
      },
    )
    .finally(() => inflight.delete(code));
  inflight.set(code, p);
  return p;
}

/** What is known about an invite, asking the server when that is nothing yet or out of date. */
export function useInvitePreview(code: string): InviteEntry | undefined {
  const entry = useInvitePreviews((s) => s.byCode[code]);
  useEffect(() => {
    void loadInvitePreview(code);
  }, [code]);
  return entry;
}
