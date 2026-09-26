/**
 * A search, as a component runs it: the query read and resolved, the index
 * asked (in its worker), the answer kept, asked again as the index fills in,
 * and a page more when the list is scrolled to its end.
 *
 * Both search boxes use this: the one above a conversation and the global one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEmptyQuery, needlesOf, parseQuery, resolveQuery, type ResolvedQuery, type SearchQuery } from "@/lib/search";
import { EMPTY_RESULT, type EngineResult, type Sort, type Tab } from "@/search/engine";
import { demandIndex, querySearch, useSearchIndex } from "@/search/indexer";
import { currentBlockRules, useBlockRules } from "@/lib/blocked";
import { useChannels } from "@/stores/channels";
import { scopeChannels, type Names, type SearchScope } from "./scope";

/** Results asked for at a time, and again for each page after. */
export const PAGE_SIZE = 40;

/** How long typing has to pause before the index is asked. */
const TYPING_MS = 120;

/** How long a filling index waits between asking again, so results do not flicker. */
const REFRESH_MS = 600;

/**
 * Authors whose messages are left out of search results.
 *
 * This is the one place search results are filtered by who wrote them: the
 * people this reader blocked, while "Hide their messages completely" is on,
 * so their messages do not exist here either, in any tab or count. With it
 * off, a conversation folds their messages away but still has them, and so
 * does search.
 */
export function authorsHiddenFromSearch(): string[] {
  const rules = currentBlockRules();
  return rules.hideMessages ? [...rules.blocked] : [];
}

export interface SearchRun {
  parsed: SearchQuery;
  resolved: ResolvedQuery;
  /** Nothing to search for yet. */
  empty: boolean;
  /** The words to mark in results. */
  needles: string[];
  result: EngineResult;
  /** The query has changed and its first answer has not come back. */
  pending: boolean;
  /** There is more to show than has been loaded. */
  hasMore: boolean;
  more: () => void;
  /** The channels searched, or null for everywhere. */
  channels: string[] | null;
}

export function useSearch(args: { raw: string; scope: SearchScope; tab: Tab; sort: Sort; names: Names; enabled?: boolean; pageSize?: number }): SearchRun {
  const { raw, scope, tab, sort, names, enabled = true, pageSize = PAGE_SIZE } = args;
  const byId = useChannels((c) => c.byId);
  // blocking someone, or changing what blocking hides, asks again
  const blockRules = useBlockRules();
  const parsed = useMemo(() => parseQuery(raw), [raw]);
  const resolved = useMemo(() => resolveQuery(parsed, names.ctx), [parsed, names.ctx]);
  const empty = isEmptyQuery(parsed);
  const needles = useMemo(() => needlesOf(parsed), [parsed]);
  const scopeKey = scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}`;
  // what the scope covers only changes when its channels do, not on every message
  const channelsKey = useMemo(() => (scopeChannels(scope, byId) ?? ["*"]).join(","), [scope, byId]);
  const channels = useMemo(() => (channelsKey === "*" ? null : channelsKey ? channelsKey.split(",") : []), [channelsKey]);

  // As the index fills in, the search asks again: at most every REFRESH_MS,
  // however fast pages arrive, and never starved by them either.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || empty) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = useSearchIndex.subscribe((s, prev) => {
      if (s.version === prev.version || timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((n) => n + 1);
      }, REFRESH_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, empty]);

  const [result, setResult] = useState<EngineResult>(EMPTY_RESULT);
  const [pending, setPending] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const key = `${JSON.stringify(resolved)}|${scopeKey}|${channelsKey}|${tab}|${sort}`;
  const lastKey = useRef("");

  // a new question starts from the first page
  useEffect(() => setLimit(pageSize), [key, pageSize]);

  // While a search is open, the walk goes to where it looks first.
  useEffect(() => {
    if (!enabled || empty) return;
    return demandIndex(channels);
  }, [enabled, empty, channels]);

  useEffect(() => {
    if (!enabled || empty) {
      lastKey.current = "";
      setResult(EMPTY_RESULT);
      setPending(false);
      return;
    }
    const fresh = lastKey.current !== key;
    if (fresh) setPending(true);
    let alive = true;
    const timer = setTimeout(
      () => {
        void querySearch({ query: resolved, scope: channels, hide: authorsHiddenFromSearch(), tab, sort, offset: 0, limit }).then((r) => {
          if (!alive) return;
          lastKey.current = key;
          setResult(r);
          setPending(false);
        });
      },
      fresh ? TYPING_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `tick` asks again as the index fills in; `limit` fetches the next page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, empty, key, limit, tick, blockRules]);

  const hasMore = result.total > result.docs.length;
  const more = useCallback(() => {
    if (hasMore) setLimit((l) => Math.max(l, result.docs.length) + pageSize);
  }, [hasMore, result.docs.length, pageSize]);

  return { parsed, resolved, empty, needles, result, pending, hasMore, more, channels };
}
