import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { memberName } from "@/lib/names";
import { highlight, isEmptyQuery, parseQuery, search } from "@/lib/search";
import { formatFull, formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { SearchSuggestions } from "./SearchSuggestions";
import s from "./Search.module.css";

/**
 * Searches the messages this device has decrypted. Messages are end-to-end
 * encrypted, so the server cannot do this for us; "Load older" pulls more
 * history into the index.
 */
export function SearchPanel({ channel, query, onClose, onQuery, onJump, inline }: { channel: Channel; query: string; onClose: () => void; onQuery: (v: string) => void; onJump?: (() => void) | undefined; inline?: boolean }) {
  const nav = useNavigate();
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const store = useMessages((m) => m.channels);
  const loadOlder = useMessages((m) => m.loadOlder);
  const loadInitial = useMessages((m) => m.loadInitial);
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const setJumpTo = useUI((u) => u.setJumpTo);
  const [loading, setLoading] = useState(false);
  const q = useMemo(() => parseQuery(query), [query]);
  // server channels search the whole server; DMs search themselves
  const scope = useMemo(() => Object.values(channels).filter((c) => (channel.server_id ? c.server_id === channel.server_id && c.type === "text" : c.id === channel.id)), [channels, channel]);
  const channelNames = useMemo(() => Object.fromEntries(scope.map((c) => [c.id, c.name.toLowerCase()])), [scope]);
  const nicknames = useMemo(() => Object.fromEntries(Object.values(serverState?.members ?? {}).map((m) => [m.user_id, m.nickname.toLowerCase()])), [serverState]);
  const indexed = useMemo(() => scope.reduce((n, c) => n + (store[c.id]?.ids.length ?? 0), 0), [scope, store]);
  const results = useMemo(() => {
    if (isEmptyQuery(q)) return [];
    const all = scope.flatMap((c) => Object.values(store[c.id]?.byId ?? {}));
    return search(all, q, { users, channelNames, nicknames, ...(meId ? { meId } : {}) });
  }, [q, scope, store, users, channelNames, nicknames, meId]);

  // Channels whose history could not be loaded (one you may view but not read
  // the history of answers 403). They are skipped so the rest still load.
  const failed = useRef(new Set<string>());
  const [, setFailedCount] = useState(0);
  const markFailed = (id: string) => {
    failed.current.add(id);
    setFailedCount(failed.current.size);
  };
  // pull more history into the index for whichever scoped channels still have older pages
  const loadMore = async () => {
    setLoading(true);
    try {
      for (let round = 0; round < 3; round++) {
        let any = false;
        for (const c of scope) {
          if (failed.current.has(c.id)) continue;
          const cur = useMessages.getState().channels[c.id];
          try {
            if (!cur?.loaded) {
              await loadInitial(c.id);
              any = true;
            } else if (cur.hasOlder) {
              await loadOlder(c.id);
              any = true;
            }
          } catch {
            markFailed(c.id);
          }
        }
        if (!any) break;
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    // make sure every scoped channel has at least its first page
    for (const c of scope) if (!useMessages.getState().channels[c.id]?.loaded && !failed.current.has(c.id)) loadInitial(c.id).catch(() => markFailed(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.length]);
  const exhausted = scope.every((c) => failed.current.has(c.id) || (store[c.id]?.loaded && !store[c.id]?.hasOlder));

  const jump = (channelId: string, messageId: string) => {
    const ch = channels[channelId];
    if (!ch) return;
    nav(ch.server_id ? `/channels/${ch.server_id}/${ch.id}/${messageId}` : `/channels/@me/${ch.id}/${messageId}`);
    setJumpTo({ channelId, messageId });
    onJump?.();
  };

  return (
    <aside className={s.panel} data-testid="search-panel">
      <div className={s.head}>
        <span className={s.headText}><Search size={16} /> {isEmptyQuery(q) ? "Search" : `${results.length} result${results.length === 1 ? "" : "s"}`}</span>
        <button className={s.close} aria-label="Close search" onClick={onClose}><X size={18} /></button>
      </div>
      {inline ? (
        <div className={s.inlineSearch}>
          <Search size={16} />
          <input value={query} placeholder="Search" aria-label="Search messages" autoFocus data-testid="search-input-mobile" onChange={(e) => onQuery(e.target.value)} />
          {query ? <button className={s.clear} aria-label="Clear search" onClick={() => onQuery("")} data-testid="search-clear-mobile"><X size={14} /></button> : null}
        </div>
      ) : null}
      <SearchSuggestions query={query} users={users} channels={scope} nicknames={nicknames} onPick={onQuery} />
      {isEmptyQuery(q) ? (
        <div className={s.help}>
          <p>Search the messages this device has decrypted{channel.server_id ? " in this server" : " in this conversation"}. Nothing leaves your device: the server only holds ciphertext.</p>
          <dl>
            <dt>from:</dt><dd>@user, or <b>me</b></dd>
            <dt>in:</dt><dd>#channel</dd>
            <dt>has:</dt><dd>link, image, file, sticker, embed</dd>
            <dt>before: / after:</dt><dd>2026-01-31</dd>
            <dt>"quotes"</dt><dd>exact phrase</dd>
            <dt>-word</dt><dd>exclude</dd>
          </dl>
        </div>
      ) : null}
      <div className={s.list}>
        {results.map((m) => {
          const ch = channels[m.channel_id];
          const author = users[m.author_id];
          const name = memberName(serverState?.members[m.author_id]?.nickname, author);
          return (
            <button key={m.id} className={s.result} onClick={() => jump(m.channel_id, m.id)} data-result={m.id}>
              <div className={s.resultHead}>
                <Avatar id={m.author_id} avatarId={author?.avatar_id ?? null} name={name} size={20} />
                <span className={s.resultName}>{name}</span>
                {channel.server_id && ch ? <span className={s.resultChan}>#{ch.name}</span> : null}
                <span className={s.resultTime} title={formatFull(m.created_at)}>{formatTimestamp(m.created_at)}</span>
              </div>
              <div className={s.resultText}>
                {m.payload?.t ? highlight(m.payload.t, q).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>)) : m.payload?.sticker ? "[sticker]" : m.payload?.att?.length ? `[${m.payload.att.length} file${m.payload.att.length === 1 ? "" : "s"}]` : ""}
              </div>
            </button>
          );
        })}
        {!isEmptyQuery(q) && results.length === 0 ? <div className={s.empty}>No results in the {indexed} messages loaded so far.</div> : null}
      </div>
      <div className={s.foot}>
        <span>{indexed} messages indexed</span>
        <Button size="sm" variant="secondary" loading={loading} disabled={exhausted} onClick={() => void loadMore()} data-testid="search-older">{exhausted ? "All history loaded" : "Load older"}</Button>
      </div>
    </aside>
  );
}
