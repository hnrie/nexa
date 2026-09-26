/**
 * One quiet line under the results saying how much of what is being searched
 * this device has read so far: "Still indexing 12 of 40 conversations", then
 * "Everything is searchable". Messages are only ever decrypted here, so this
 * is the honest answer to "is that everything?".
 */
import { Lock } from "lucide-react";
import { useMemo } from "react";
import { t } from "@/i18n";
import { scopeProgress, useSearchIndex } from "@/search/indexer";
import type { SearchScope } from "./scope";
import s from "./Search.module.css";

export function useScopeProgress(channels: string[] | null) {
  const st = useSearchIndex();
  // worked out again whenever the walk moves on
  return useMemo(() => ({ st, p: scopeProgress(channels) }), [channels, st]);
}

export function IndexStatus({ channels, scope }: { channels: string[] | null; scope: SearchScope }) {
  const { st, p } = useScopeProgress(channels);
  if (st.mode === "closed") return null;
  let text: string;
  let busy = false;
  const left = p.total - p.done;
  if (st.mode === "opening") {
    text = t("search.status.opening");
    busy = true;
  } else if (st.throttled && left > 0) {
    text = t("search.status.throttled");
    busy = true;
  } else if (st.mode === "memory" && left > 0) {
    // kept in memory only, history is read while a search waits on it
    busy = st.walking;
    text = st.walking ? t("search.status.looking", { done: p.done, count: p.total }) : t("search.status.memoryIdle");
  } else if (st.capped && left > 0) {
    text = t("search.status.full");
  } else if (left > 0) {
    busy = true;
    text = scope.kind === "conversation" ? t("search.status.indexingConversation") : scope.kind === "server" ? t("search.status.indexingServer", { done: p.done, count: p.total }) : t("search.status.indexing", { done: p.done, count: p.total });
  } else if (st.capped) {
    text = t("search.status.full");
  } else if (st.mode === "memory") {
    text = t("search.status.memoryDone");
  } else {
    text = scope.kind === "conversation" ? t("search.status.conversationDone") : scope.kind === "server" ? t("search.status.serverDone") : t("search.status.done");
  }
  const unreadable = p.unreadable > 0 ? (scope.kind === "conversation" ? t("search.status.cannotRead") : t("search.status.cannotReadCount", { count: p.unreadable })) : null;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className={s.status} data-busy={busy || undefined} data-testid="search-status" title={t("search.status.onDevice")}>
      {busy && st.mode !== "opening" ? (
        <span className={s.statusBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("search.status.progress")}>
          <span style={{ width: `${Math.max(4, pct)}%` }} />
        </span>
      ) : null}
      <Lock size={12} aria-hidden="true" className={s.statusIcon} />
      <span className={s.statusText}>
        {text}
        {unreadable ? <span className={s.statusNote}>{unreadable}</span> : null}
      </span>
    </div>
  );
}
