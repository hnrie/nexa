import { conversationCount } from "@/lib/unread";
import { useChannels } from "@/stores/channels";
import { useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";

const BASE = "Nexa";

/** Friend requests waiting for an answer. */
export function pendingFriendRequests(): number {
  let n = 0;
  for (const r of Object.values(useRelationships.getState().byUser)) if (r.type === "incoming") n += 1;
  return n;
}

/** Everything waiting for this user: messages in conversations, mentions elsewhere, and friend requests. */
export function unreadTotal(): number {
  const channels = useChannels.getState().byId;
  const reads = useReadStates.getState().byChannel;
  const settings = useSettings.getState().settings;
  let n = 0;
  for (const ch of Object.values(channels)) {
    const rs = reads[ch.id];
    // a conversation counts its waiting messages; elsewhere only mentions do
    n += ch.type === "dm" || ch.type === "group_dm" ? conversationCount(ch, rs, settings) : (rs?.mentions ?? 0);
  }
  return n + pendingFriendRequests();
}

/**
 * Watches everything the unread total is made of, and reports it once.
 *
 * The four stores behind it are among the busiest in the app — every message
 * changes one, every draft save another — and the total is a walk over every
 * channel and every relationship. The tab title and the desktop badge both
 * wanted it, so each change ran that walk twice. It runs once now, after the
 * stores have settled, and only says anything when the number itself moves.
 */
const watchers = new Set<(n: number) => void>();
let offStores: (() => void)[] = [];
let lastTotal = -1;
let queued = false;

function recount(): void {
  queued = false;
  const n = unreadTotal();
  if (n === lastTotal) return;
  lastTotal = n;
  for (const w of [...watchers]) w(n);
}

export function onUnreadTotal(fn: (n: number) => void): () => void {
  if (watchers.size === 0) {
    const bump = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(recount);
    };
    offStores = [useChannels.subscribe(bump), useReadStates.subscribe(bump), useSettings.subscribe(bump), useRelationships.subscribe(bump)];
  }
  watchers.add(fn);
  lastTotal = unreadTotal();
  fn(lastTotal);
  return () => {
    watchers.delete(fn);
    if (watchers.size > 0) return;
    for (const off of offStores) off();
    offStores = [];
    lastTotal = -1;
  };
}

/** Keeps the tab title's unread count in sync with the stores. */
export function installTitleBadge(): () => void {
  const off = onUnreadTotal((n) => {
    if (typeof document !== "undefined") document.title = n > 0 ? `(${n > 99 ? "99+" : n}) ${BASE}` : BASE;
  });
  return () => {
    off();
    document.title = BASE;
  };
}
