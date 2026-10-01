import { useEffect } from "react";
import { create } from "zustand";
import { ApiError } from "@/api/client";
import { notes as notesApi } from "@/api/notes";
import type { NoteLinkView } from "@/api/types";
import { DecryptError } from "@/crypto/keys";
import { openNote, unwrapNoteKeyFromLink, type NoteLinkSecret } from "@/crypto/notes";
import { readHead, type NoteHead } from "./model";

/**
 * What a note's share link leads to, for a card in a message, the dialog a
 * link opens and the page a visitor lands on.
 *
 * The server keeps, beside each link, the note's key under the link's own
 * key, which is the part of the link after the # and never reaches it. So the
 * server is asked only for what the link's token leads to, and this device
 * opens it with the key in the link.
 */

/** What a share link leads to, opened with the key in the link. */
export interface OpenedNoteLink {
  view: NoteLinkView;
  /** The note's key, as the link gives it. */
  key: Uint8Array;
  head: NoteHead;
}

export async function openNoteLinkView(secret: NoteLinkSecret, fetch: (token: string) => Promise<NoteLinkView> = (token) => notesApi.link(token)): Promise<OpenedNoteLink> {
  const view = await fetch(secret.token);
  const key = await unwrapNoteKeyFromLink(secret, view.key_wrapped);
  return { view, key, head: readHead(await openNote(key, "head", view.head)) };
}

export type NoteLinkEntry =
  | { status: "loading" }
  | { status: "ready"; opened: OpenedNoteLink; at: number }
  /** No such link: removed, or never was. */
  | { status: "invalid"; at: number }
  /** The link is there, but the key it carries does not open it: cut short when it was copied. */
  | { status: "locked"; at: number }
  | { status: "failed"; at: number };

/** A note's title and first lines move on as it is written: a card drawn again after this long asks again. */
const FRESH_MS = 2 * 60_000;
const RETRY_MS = 30_000;

export const useNoteLinkPreviews = create<{ byLink: Record<string, NoteLinkEntry> }>()(() => ({ byLink: {} }));

const inflight = new Map<string, Promise<void>>();
/** Counts sign-outs: an answer for the account that has gone is not kept. */
let generation = 0;

const keyOf = (secret: NoteLinkSecret): string => `${secret.token}#${secret.key}`;

function put(k: string, entry: NoteLinkEntry): void {
  useNoteLinkPreviews.setState((s) => ({ byLink: { ...s.byLink, [k]: entry } }));
}

function due(e: NoteLinkEntry | undefined, now: number): boolean {
  if (!e) return true;
  if (e.status === "loading") return false;
  return now - e.at > (e.status === "failed" ? RETRY_MS : FRESH_MS);
}

export function loadNoteLinkPreview(secret: NoteLinkSecret, opts: { force?: boolean; fetch?: (token: string) => Promise<NoteLinkView> } = {}): Promise<void> {
  const k = keyOf(secret);
  const running = inflight.get(k);
  if (running) return running;
  const cur = useNoteLinkPreviews.getState().byLink[k];
  if (!opts.force && !due(cur, Date.now())) return Promise.resolve();
  if (cur?.status !== "ready") put(k, { status: "loading" });
  const mine = generation;
  const p = openNoteLinkView(secret, opts.fetch)
    .then(
      (opened) => {
        if (mine === generation) put(k, { status: "ready", opened, at: Date.now() });
      },
      (err: unknown) => {
        if (mine !== generation) return;
        const at = Date.now();
        if (err instanceof ApiError && err.status === 404) put(k, { status: "invalid", at });
        else if (err instanceof DecryptError) put(k, { status: "locked", at });
        else if (cur?.status === "ready") put(k, { ...cur, at });
        else put(k, { status: "failed", at });
      },
    )
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** What is known about a share link, asking when that is nothing yet or out of date. Null asks nothing. */
export function useNoteLinkPreview(secret: NoteLinkSecret | null): NoteLinkEntry | undefined {
  const k = secret ? keyOf(secret) : "";
  const entry = useNoteLinkPreviews((s) => (k ? s.byLink[k] : undefined));
  useEffect(() => {
    if (secret) void loadNoteLinkPreview(secret);
    // the link's two parts are what it is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return entry;
}

/** Forgets every share link this account opened, with the keys they gave. */
export function forgetNoteLinkPreviews(): void {
  generation += 1;
  inflight.clear();
  useNoteLinkPreviews.setState({ byLink: {} });
}
