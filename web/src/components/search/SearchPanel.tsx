import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import type { DecryptedMessage } from "@/lib/decrypt";
import { compareIds } from "@/lib/ids";
import { channelDisplayName, friendNicknames, memberName } from "@/lib/names";
import { highlight, isEmptyQuery, parseQuery, search } from "@/lib/search";
import { formatFull, formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { MAX_RESULTS, useFullSearch } from "./useFullSearch";
import { SearchSuggestions } from "./SearchSuggestions";
import s from "./Search.module.css";

import { t, Tr } from "@/i18n";

/** Conversations that hold messages; categories and voice channels hold none. */
const SEARCHABLE = new Set(["text", "dm", "group_dm", "subchat"]);

/** Newest first, ties broken by id so the list never reorders under itself. */
function newestFirst(a: DecryptedMessage, b: DecryptedMessage): number {
  return b.created_at - a.created_at || compareIds(b.id, a.id);
}

/**
 * Searches every message this account can read.
 *
 * Messages are end-to-end encrypted, so the server cannot do this for us and
 * there is no index to ask. What is already decrypted answers at once; behind
 * it a walk fetches the rest of the history, conversation by conversation,
 * decrypts it here and streams the matches in as they turn up. That takes as
 * long as it takes, so the panel says where it has got to and stops when asked.
 */
export function SearchPanel({ channel, query, onClose, onQuery, onJump, inline }: { channel: Channel; query: string; onClose: () => void; onQuery: (v: string) => void; onJump?: (() => void) | undefined; inline?: boolean }) {
  const nav = useNavigate();
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const store = useMessages((m) => m.channels);
  const servers = useServers((st) => st.byId);
  const rels = useRelationships((r) => r.byUser);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const q = useMemo(() => parseQuery(query), [query]);

  // Every conversation, not only this server's. Channels the account may not
  // read its history in are left in: the server is the authority on that, and
  // one refusal each is cheaper than getting the permission maths wrong here
  // and quietly hiding a conversation from search forever.
  const scope = useMemo(() => Object.values(channels).filter((c) => SEARCHABLE.has(c.type)), [channels]);
  const friends = useMemo(() => friendNicknames(rels), [rels]);
  const channelNames = useMemo(
    () => Object.fromEntries(scope.map((c) => [c.id, channelDisplayName(c, users, meId, friends).toLowerCase()])),
    [scope, users, meId, friends],
  );
  // `from:` and `mentions:` take a nickname from any server, because a result
  // can come from any of them.
  const nicknames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const st of Object.values(servers)) for (const m of Object.values(st.members)) if (m.nickname) out[m.user_id] = m.nickname.toLowerCase();
    return out;
  }, [servers]);
  const ctx = useMemo(() => ({ users, channelNames, nicknames, ...(meId ? { meId } : {}) }), [users, channelNames, nicknames, meId]);

  // What this device has already decrypted, matched on every keystroke so the
  // panel answers before the walk behind it has even started.
  const loaded = useMemo(() => {
    if (isEmptyQuery(q)) return [];
    const all = scope.flatMap((c) => Object.values(store[c.id]?.byId ?? {}));
    return search(all, q, ctx);
  }, [q, scope, store, ctx]);

  // `in:` narrows what is walked, not only what is shown: asking for one
  // channel should not cost a walk through every other one first.
  const scanChannels = useMemo(() => {
    const wanted = q.in;
    const list = wanted.length ? scope.filter((c) => wanted.some((w) => channelNames[c.id] === w || c.id === w)) : scope;
    return list.map((c) => ({ id: c.id, lastMessageId: c.last_message_id }));
  }, [scope, channelNames, q]);
  const { hits, progress, cancel, restart } = useFullSearch({ query: q, raw: query, ctx, channels: scanChannels, enabled: !isEmptyQuery(q) });

  const results = useMemo(() => {
    const byId = new Map<string, DecryptedMessage>();
    for (const m of loaded) byId.set(m.id, m);
    for (const m of hits) byId.set(m.id, m);
    return [...byId.values()].sort(newestFirst).slice(0, MAX_RESULTS);
  }, [loaded, hits]);

  const jump = (channelId: string, messageId: string) => {
    const ch = channels[channelId];
    if (!ch) return;
    nav(ch.server_id ? `/channels/${ch.server_id}/${ch.id}/${messageId}` : `/channels/@me/${ch.id}/${messageId}`);
    setJumpTo({ channelId, messageId });
    onJump?.();
  };

  const status = progress.running
    ? t("search.search.searching", { count: progress.messages, done: progress.channelsDone, total: progress.channelsTotal })
    : progress.messages > 0
      ? t("search.search.searched", { count: progress.messages, total: progress.channelsTotal })
      : t("search.search.notStarted");

  return (
    <aside className={s.panel} data-testid="search-panel">
      <div className={s.head}>
        <span className={s.headText}><Search size={16} /> {isEmptyQuery(q) ? t("chat.chat.search") : t("search.search.results", { count: results.length })}</span>
        <button className={s.close} aria-label={t("search.search.closeSearch")} onClick={onClose}><X size={18} /></button>
      </div>
      {inline ? (
        <div className={s.inlineSearch}>
          <Search size={16} />
          <input value={query} placeholder={t("chat.chat.search")} aria-label={t("chat.chat.searchMessages")} autoFocus data-testid="search-input-mobile" onChange={(e) => onQuery(e.target.value)} />
          {query ? <button className={s.clear} aria-label={t("chat.chat.clearSearch")} onClick={() => onQuery("")} data-testid="search-clear-mobile"><X size={14} /></button> : null}
        </div>
      ) : null}
      <SearchSuggestions query={query} users={users} channels={scope} nicknames={nicknames} onPick={onQuery} />
      {isEmptyQuery(q) ? (
        <div className={s.help}>
          <p>{t("search.search.helpEverything")}</p>
          <dl>
            <dt>from:</dt><dd><Tr id="search.search.fromHint" values={{ me: <b>{t("search.search.me")}</b> }} /></dd>
            <dt>in:</dt><dd>{t("search.search.channel")}</dd>
            <dt>has:</dt><dd>{t("search.search.linkImageFileStickerEmbed")}</dd>
            <dt>{t("search.search.beforeAfter")}</dt><dd>2026-01-31</dd>
            <dt>{t("search.search.quotes")}</dt><dd>{t("search.search.exactPhrase")}</dd>
            <dt>-word</dt><dd>exclude</dd>
          </dl>
        </div>
      ) : null}
      <div className={s.list}>
        {results.map((m) => {
          const ch = channels[m.channel_id];
          const author = users[m.author_id];
          const name = memberName(ch?.server_id ? servers[ch.server_id]?.members[m.author_id]?.nickname : undefined, author);
          const where = ch ? (ch.server_id ? `#${ch.name}` : channelDisplayName(ch, users, meId, friends)) : "";
          return (
            <button key={m.id} className={s.result} onClick={() => jump(m.channel_id, m.id)} data-result={m.id}>
              <div className={s.resultHead}>
                <Avatar id={m.author_id} avatarId={author?.avatar_id ?? null} name={name} size={20} />
                <span className={s.resultName}>{name}</span>
                {m.channel_id !== channel.id && where ? <span className={s.resultChan}>{where}</span> : null}
                <span className={s.resultTime} title={formatFull(m.created_at)}>{formatTimestamp(m.created_at)}</span>
              </div>
              <div className={s.resultText}>
                {m.payload?.t ? highlight(m.payload.t, q).map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>)) : m.payload?.sticker ? "[sticker]" : m.payload?.att?.length ? `[${m.payload.att.length} file${m.payload.att.length === 1 ? "" : "s"}]` : ""}
              </div>
            </button>
          );
        })}
        {!isEmptyQuery(q) && results.length === 0 ? (
          <div className={s.empty}>{progress.running ? t("search.search.stillLooking") : t("search.search.noResultsAnywhere", { count: progress.messages })}</div>
        ) : null}
      </div>
      {!isEmptyQuery(q) && (progress.unreadable > 0 || progress.capped || progress.throttled) ? (
        <div className={s.notes}>
          {progress.throttled ? <span>{t("search.search.waitingForServer")}</span> : null}
          {progress.unreadable > 0 ? <span>{t("search.search.unreadable", { count: progress.unreadable })}</span> : null}
          {progress.capped ? <span>{t("search.search.capped", { count: progress.indexed })}</span> : null}
        </div>
      ) : null}
      <div className={s.foot}>
        <span className={s.progress} data-testid="search-progress">{isEmptyQuery(q) ? t("search.search.typeToSearch") : status}</span>
        {isEmptyQuery(q) ? null : progress.running ? (
          <Button size="sm" variant="secondary" onClick={cancel} data-testid="search-cancel">{t("search.search.cancel")}</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={restart} data-testid="search-again">{t("search.search.searchAgain")}</Button>
        )}
      </div>
    </aside>
  );
}
