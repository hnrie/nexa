import { Lock, MessageSquareText, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { threads as threadsApi } from "@/api/threads";
import type { Channel, ThreadListing } from "@/api/types";
import { SearchBox } from "@/components/common/SearchBox";
import { useLayerPresence } from "@/components/chat/useLayerPresence";
import { t } from "@/i18n";
import { idTime } from "@/lib/ids";
import { memberName } from "@/lib/names";
import { canStartThread } from "@/lib/threads";
import { formatRelative } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useThreads } from "@/stores/threads";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import chat from "@/components/chat/Chat.module.css";
import s from "./Threads.module.css";

/** When a thread last had something said in it. */
function lastActive(th: Channel): number {
  return idTime(th.last_message_id ?? th.id);
}

function ThreadRow({ thread, onOpen }: { thread: Channel; onOpen: () => void }) {
  const count = thread.thread?.message_count ?? 0;
  const owner = useUsers((u) => (thread.owner_id ? u.byId[thread.owner_id] : undefined));
  // their name in this server, as the chat shows it
  const nickname = useServers((st) => (thread.server_id && thread.owner_id ? st.byId[thread.server_id]?.members[thread.owner_id]?.nickname : undefined));
  return (
    <button type="button" className={s.row} onClick={onOpen} data-testid="thread-row" data-thread={thread.id}>
      <span className={s.rowIcon} aria-hidden="true">{thread.type === "private_thread" ? <Lock size={18} /> : <MessageSquareText size={18} />}</span>
      <span className={s.rowMain}>
        <span className={s.rowName} dir="auto">{thread.name}</span>
        <span className={s.rowMeta}>
          {owner ? <span dir="auto">{t("threads.panel.startedBy", { name: memberName(nickname, owner) })}</span> : null}
          <span>{count === 0 ? t("threads.chip.noMessages") : t("threads.chip.messages", { count })}</span>
        </span>
      </span>
      <span className={s.rowWhen}>{formatRelative(lastActive(thread))}</span>
    </button>
  );
}

/**
 * A channel's threads, in a panel over the chat: the ones this account is in,
 * the others still going, and the closed ones, which are fetched as they are
 * asked for. Search narrows all three by name.
 */
export function ThreadsPanel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const all = useChannels((c) => c.byId);
  const joined = useThreads((x) => x.joined);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<ThreadListing[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayerPresence();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const active = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.values(all)
      .filter((c) => c.parent_id === channel.id && (c.type === "thread" || c.type === "private_thread") && !c.thread?.archived && (!term || c.name.toLowerCase().includes(term)))
      .sort((a, b) => lastActive(b) - lastActive(a));
  }, [all, channel.id, q]);
  const mine = active.filter((c) => joined[c.id]);
  const others = active.filter((c) => !joined[c.id]);

  const loadClosed = async (reset: boolean) => {
    setLoading(true);
    setFailed(false);
    try {
      const last = reset ? undefined : closed?.[closed.length - 1];
      const res = await threadsApi.list(channel.id, { archived: true, limit: 25, ...(q.trim() ? { q: q.trim() } : {}), ...(last?.thread?.archived_at ? { before: last.thread.archived_at } : {}) });
      useUsers.getState().upsert(res.users);
      setClosed((cur) => (reset || !cur ? res.threads : [...cur, ...res.threads]));
      setMore(res.has_more);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  // the closed ones are asked for again as the search changes, a moment after typing stops
  useEffect(() => {
    const timer = setTimeout(() => void loadClosed(true), q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, q]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.('[data-pop-toggle="threads"]') || !target.closest?.("#root")) return;
      if (ref.current && !ref.current.contains(target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role='dialog'][aria-modal='true']")) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const open = (th: Channel) => {
    if (th.server_id) useChannels.getState().upsert(th);
    nav(`/channels/${channel.server_id}/${th.id}`);
    onClose();
  };
  const canCreate = canStartThread(channel) || canStartThread(channel, true);
  const nothing = mine.length === 0 && others.length === 0 && closed !== null && closed.length === 0 && !loading;

  return (
    <div className={chat.pinsPop} ref={ref} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-modal-layer="" data-testid="threads-panel">
      <div className={chat.pinsHead}>
        <h2 className={chat.pinsTitle} id={titleId}>{t("threads.panel.title")}</h2>
        <span className={s.headActions}>
          {canCreate ? (
            <button type="button" className={s.create} onClick={() => { onClose(); useUI.getState().openModal("createThread", { channelId: channel.id }); }} data-testid="threads-create">
              <Plus size={16} aria-hidden="true" />
              {t("threads.panel.create")}
            </button>
          ) : null}
          <button className={chat.popClose} aria-label={t("threads.panel.close")} onClick={onClose}><X size={18} /></button>
        </span>
      </div>
      <div className={s.search}>
        <SearchBox value={q} onChange={setQ} placeholder={t("threads.panel.search")} aria-label={t("threads.panel.search")} />
      </div>
      <div className={chat.pinsList}>
        {mine.length ? (
          <section className={s.group} aria-label={t("threads.panel.joined")}>
            <h3 className={s.groupHead}>{t("threads.panel.joined")}</h3>
            {mine.map((th) => <ThreadRow key={th.id} thread={th} onOpen={() => open(th)} />)}
          </section>
        ) : null}
        {others.length ? (
          <section className={s.group} aria-label={t("threads.panel.active")}>
            <h3 className={s.groupHead}>{mine.length ? t("threads.panel.otherActive") : t("threads.panel.active")}</h3>
            {others.map((th) => <ThreadRow key={th.id} thread={th} onOpen={() => open(th)} />)}
          </section>
        ) : null}
        {closed?.length ? (
          <section className={s.group} aria-label={t("threads.panel.closed")}>
            <h3 className={s.groupHead}>{t("threads.panel.closed")}</h3>
            {closed.map((th) => <ThreadRow key={th.id} thread={th} onOpen={() => open(th)} />)}
            {more ? (
              <button type="button" className={s.more} disabled={loading} onClick={() => void loadClosed(false)}>{t("threads.panel.loadMore")}</button>
            ) : null}
          </section>
        ) : null}
        {failed ? (
          <div className={chat.pinEmpty}>
            {t("threads.panel.closedFailed")}{" "}
            <button className={chat.loadRetry} onClick={() => void loadClosed(true)}>{t("chat.messageList.tryAgain")}</button>
          </div>
        ) : null}
        {nothing ? (
          <div className={s.empty}>
            <MessageSquareText size={28} aria-hidden="true" />
            <p>{q ? t("threads.panel.noMatches") : t("threads.panel.none")}</p>
            {!q && canCreate ? <p className={s.emptyHint}>{t("threads.panel.noneHint")}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
