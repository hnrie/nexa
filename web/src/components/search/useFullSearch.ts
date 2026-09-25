/**
 * The full search, as a component uses it.
 *
 * `lib/fullSearch` does the walking; this decides when to start one, keeps the
 * results in a state a panel can render, and makes sure the walk stops when the
 * panel closes or the query moves on. Hits arrive a page at a time and are
 * flushed on a timer rather than one render each, because a scan finding a
 * thousand matches should not be a thousand renders.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DecryptedMessage } from "@/lib/decrypt";
import { scanEverything, type ScanChannel, type ScanProgress } from "@/lib/fullSearch";
import { compareIds } from "@/lib/ids";
import { isEmptyQuery, type SearchCtx, type SearchQuery } from "@/lib/search";
import { useMessages } from "@/stores/messages";

/**
 * How long the typing has to stop before a walk starts.
 *
 * Long enough that a search typed one letter at a time starts once, short
 * enough that it feels like a consequence of typing.
 */
const DEBOUNCE_MS = 400;

/** Hits held on screen. Beyond this the newest are kept and the rest dropped. */
export const MAX_RESULTS = 500;

/** How often accumulated hits reach React. */
const FLUSH_MS = 150;

const IDLE: ScanProgress = {
  messages: 0,
  indexed: 0,
  channelsDone: 0,
  channelsTotal: 0,
  unreadable: 0,
  capped: false,
  throttled: false,
  running: false,
};

/** Newest first, ties broken by id so the order never wobbles between flushes. */
function newestFirst(a: DecryptedMessage, b: DecryptedMessage): number {
  return b.created_at - a.created_at || compareIds(b.id, a.id);
}

/**
 * What the chat view has already decrypted for a conversation, so the scan
 * never pays to fetch the page that is on screen.
 */
function seedFromStore(channelId: string): { msgs: DecryptedMessage[]; reachedStart: boolean } | null {
  const c = useMessages.getState().channels[channelId];
  // Only a window that reaches the present: one the reader jumped back into
  // history with would have the search catch up a few pages from there and
  // walk backwards, never reading the newest part of the channel — while
  // saying nothing was left out.
  if (!c || c.ids.length === 0 || c.hasNewer) return null;
  const msgs: DecryptedMessage[] = [];
  for (const id of c.ids) {
    const m = c.byId[id];
    if (m) msgs.push(m);
  }
  // `hasOlder` false means this list runs unbroken back to the first message,
  // which is the only case where there is nothing older worth fetching.
  return { msgs, reachedStart: c.loaded && !c.hasOlder };
}

export interface FullSearch {
  hits: DecryptedMessage[];
  progress: ScanProgress;
  /** Stops the walk where it is; what was found stays. */
  cancel: () => void;
  /** Starts again from whatever the index already holds. */
  restart: () => void;
}

export function useFullSearch(args: {
  query: SearchQuery;
  /** The raw text, which is what actually changes as someone types. */
  raw: string;
  ctx: SearchCtx;
  channels: ScanChannel[];
  /** False while the panel is closed, so nothing walks in the background. */
  enabled: boolean;
}): FullSearch {
  const { query, raw, ctx, channels, enabled } = args;
  const [hits, setHits] = useState<DecryptedMessage[]>([]);
  const [progress, setProgress] = useState<ScanProgress>(IDLE);
  const [attempt, setAttempt] = useState(0);

  // The scan reads these once when it starts; holding them in refs keeps them
  // out of the effect's dependencies, where a new object every render would
  // restart the walk on every keystroke somewhere else in the app.
  const ctxRef = useRef(ctx);
  const channelsRef = useRef(channels);
  const queryRef = useRef(query);
  ctxRef.current = ctx;
  channelsRef.current = channels;
  queryRef.current = query;

  const abort = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    abort.current?.abort();
    // Said here rather than waited for: an aborted walk stops between two
    // awaits, and the button should go quiet the moment it is pressed.
    setProgress((p) => (p.running ? { ...p, running: false, throttled: false } : p));
  }, []);
  const restart = useCallback(() => {
    abort.current?.abort();
    setAttempt((n) => n + 1);
  }, []);

  const empty = isEmptyQuery(query);
  const key = empty ? "" : raw.trim();

  useEffect(() => {
    if (!enabled || !key) {
      setHits([]);
      setProgress(IDLE);
      return;
    }
    const started: ScanProgress = { ...IDLE, channelsTotal: channelsRef.current.length, running: true };
    setHits([]);
    setProgress(started);

    const ctrl = new AbortController();
    abort.current = ctrl;
    let pending: DecryptedMessage[] = [];
    let flush: ReturnType<typeof setTimeout> | null = null;
    let latest: ScanProgress = started;

    const apply = (): void => {
      flush = null;
      const batch = pending;
      pending = [];
      setProgress(ctrl.signal.aborted ? { ...latest, running: false, throttled: false } : latest);
      if (batch.length === 0) return;
      setHits((prev) => {
        const next = prev.concat(batch);
        next.sort(newestFirst);
        return next.length > MAX_RESULTS ? next.slice(0, MAX_RESULTS) : next;
      });
    };
    const schedule = (): void => {
      if (flush === null) flush = setTimeout(apply, FLUSH_MS);
    };

    const start = setTimeout(() => {
      void scanEverything({
        query: queryRef.current,
        ctx: ctxRef.current,
        channels: channelsRef.current,
        signal: ctrl.signal,
        onHit: (found) => {
          pending = pending.concat(found);
          schedule();
        },
        onProgress: (p) => {
          latest = p;
          schedule();
        },
        deps: { seed: seedFromStore },
      }).then((final) => {
        if (ctrl.signal.aborted) return;
        latest = final;
        apply();
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(start);
      if (flush !== null) clearTimeout(flush);
      ctrl.abort();
      // A cancelled walk leaves its progress showing whatever it had reached,
      // with `running` cleared, so the panel can say "stopped" rather than
      // freezing mid-count.
      setProgress((p) => (p.running ? { ...p, running: false, throttled: false } : p));
    };
  }, [enabled, key, attempt]);

  return { hits, progress, cancel, restart };
}
