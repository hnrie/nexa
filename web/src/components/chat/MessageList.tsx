import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Spinner } from "@/components/common/Spinner";
import { channelDisplayName } from "@/lib/names";
import { compareIds } from "@/lib/ids";
import { formatDateDivider, sameDay } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage, type PendingMessage } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { MessageItem } from "./MessageItem";
import s from "./Chat.module.css";

type Row =
  | { kind: "date"; key: string; ts: number }
  | { kind: "unread"; key: string }
  | { kind: "msg"; key: string; msg: DecryptedMessage; groupStart: boolean }
  | { kind: "pending"; key: string; p: PendingMessage };

const GROUP_MS = 7 * 60 * 1000;

function shouldGroup(prev: DecryptedMessage | undefined, cur: DecryptedMessage): boolean {
  if (!prev) return false;
  if (prev.author_id !== cur.author_id) return false;
  if (cur.type !== "default" && cur.type !== "reply") return false;
  if (prev.type.startsWith("system_")) return false;
  if (cur.reply_to_id) return false;
  if (cur.created_at - prev.created_at > GROUP_MS) return false;
  return sameDay(prev.created_at, cur.created_at);
}

function pendingToMessage(p: PendingMessage): DecryptedMessage {
  return {
    id: p.tmpId,
    channel_id: p.channelId,
    author_id: p.authorId,
    type: p.replyToId ? "reply" : "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: p.replyToId ?? null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: 0,
    edited_at: null,
    created_at: p.createdAt,
    payload: p.payload,
  };
}

export function MessageList({ channel }: { channel: Channel }) {
  const me = useAuth((a) => a.me);
  const users = useUsers((u) => u.byId);
  const state = useMessages((m) => m.channels[channel.id]);
  const loadOlder = useMessages((m) => m.loadOlder);
  const loadInitial = useMessages((m) => m.loadInitial);
  const readState = useReadStates((r) => r.byChannel[channel.id]);
  const ack = useReadStates((r) => r.ack);
  const focused = useUI((u) => u.focused);
  const jumpTo = useUI((u) => u.jumpTo);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const compact = useSettings((st) => st.settings.messageDisplay === "compact");
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const unreadFrom = useRef<string | null | undefined>(undefined);
  const lastAcked = useRef<string | null>(null);

  const ids = state?.ids ?? [];
  const byId = state?.byId ?? {};
  const pending = state?.pending ?? [];
  const hasOlder = state?.hasOlder ?? true;
  const loading = state?.loading ?? false;
  const loaded = state?.loaded ?? false;

  useEffect(() => {
    unreadFrom.current = undefined;
    lastAcked.current = null;
    atBottom.current = true;
    setNewBelow(false);
  }, [channel.id]);

  if (unreadFrom.current === undefined && loaded) unreadFrom.current = readState?.lastReadId ?? null;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let prev: DecryptedMessage | undefined;
    let unreadPlaced = false;
    const from = unreadFrom.current;
    for (const id of ids) {
      const m = byId[id];
      if (!m) continue;
      if (!prev || !sameDay(prev.created_at, m.created_at)) out.push({ kind: "date", key: `d${m.id}`, ts: m.created_at });
      if (!unreadPlaced && from !== undefined && from !== null && compareIds(m.id, from) > 0 && m.author_id !== me?.id) {
        out.push({ kind: "unread", key: "unread" });
        unreadPlaced = true;
      }
      out.push({ kind: "msg", key: m.id, msg: m, groupStart: !shouldGroup(prev, m) });
      prev = m;
    }
    for (const p of pending) out.push({ kind: "pending", key: p.tmpId, p });
    return out;
  }, [ids, byId, pending, me?.id]);

  const newest = ids[ids.length - 1];
  const prevNewest = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prepend.current) {
      el.scrollTop = el.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
      return;
    }
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else if (newest && prevNewest.current && newest !== prevNewest.current && byId[newest]?.author_id !== me?.id) {
      setNewBelow(true);
    }
    prevNewest.current = newest;
  }, [rows, newest, byId, me?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el.firstElementChild ?? el);
    return () => ro.disconnect();
  }, [channel.id]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = dist < 80;
    if (atBottom.current) setNewBelow(false);
    if (el.scrollTop < 400 && hasOlder && !loading && loaded && ids.length > 0) {
      prepend.current = { height: el.scrollHeight, top: el.scrollTop };
      void loadOlder(channel.id).finally(() => {
        if (prepend.current && scrollRef.current && scrollRef.current.scrollHeight === prepend.current.height) prepend.current = null;
      });
    }
  }, [channel.id, hasOlder, loading, loaded, ids.length, loadOlder]);

  useEffect(() => {
    if (!newest || !focused || !atBottom.current || typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (lastAcked.current === newest) return;
    if (readState?.lastReadId && compareIds(readState.lastReadId, newest) >= 0 && readState.mentions === 0) return;
    lastAcked.current = newest;
    void ack(channel.id, newest);
  }, [newest, focused, readState, ack, channel.id]);

  useEffect(() => {
    if (!jumpTo || jumpTo.channelId !== channel.id) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-id="${jumpTo.messageId}"]`);
    if (el) {
      atBottom.current = false;
      el.scrollIntoView({ block: "center" });
      setHighlight(jumpTo.messageId);
      setTimeout(() => setHighlight(null), 2000);
      setJumpTo(null);
    } else if (!loading) {
      void useMessages.getState().loadAround(channel.id, jumpTo.messageId);
    }
  }, [jumpTo, channel.id, rows, loading, setJumpTo]);

  const jumpToPresent = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setNewBelow(false);
  };

  const intro = useMemo(() => {
    const name = channelDisplayName(channel, users, me?.id);
    if (channel.type === "dm") {
      const other = channel.recipient_ids.find((id) => id !== me?.id) ?? "";
      const u = users[other];
      return (
        <div className={s.empty}>
          <div className={s.emptyAvatar}><Avatar id={other} avatarId={u?.avatar_id ?? null} name={name} size={80} /></div>
          <h2 className={s.emptyName}>{name}</h2>
          <div className={s.emptyUser}>{u?.username ?? ""}</div>
          <p className={s.emptyText}>This is the beginning of your direct message history with <b>{name}</b>. Messages here are end-to-end encrypted.</p>
        </div>
      );
    }
    return (
      <div className={s.empty}>
        <h2 className={s.emptyName}>{name}</h2>
        <p className={s.emptyText}>Welcome to the beginning of the <b>{name}</b> group. Messages here are end-to-end encrypted.</p>
      </div>
    );
  }, [channel, users, me?.id]);

  useEffect(() => {
    if (!loaded && !loading) void loadInitial(channel.id);
  }, [channel.id, loaded, loading, loadInitial]);

  useEffect(() => {
    const onScrollKey = (e: Event) => {
      const el = scrollRef.current;
      if (!el) return;
      const dir = (e as CustomEvent<number>).detail;
      el.scrollBy({ top: dir * el.clientHeight * 0.9, behavior: "smooth" });
    };
    window.addEventListener("ec:scroll", onScrollKey);
    return () => window.removeEventListener("ec:scroll", onScrollKey);
  }, []);

  return (
    <div className={[s.listWrap, compact ? s.compact : ""].join(" ")}>
      {newBelow ? <div className={s.newPill} onClick={jumpToPresent}><span>New messages</span><span>Jump to present</span></div> : null}
      <div className={s.scroll} ref={scrollRef} onScroll={onScroll}>
        <div className={s.inner}>
          {!hasOlder ? intro : loading || !loaded ? <div className={s.loader}><Spinner size={24} /></div> : <div style={{ height: 24 }} />}
          {rows.map((row) => {
            if (row.kind === "date") return <div key={row.key} className={s.dateDivider}><span>{formatDateDivider(row.ts)}</span></div>;
            if (row.kind === "unread") return <div key={row.key} className={s.unreadDivider}><span>New</span></div>;
            if (row.kind === "pending") return <MessageItem key={row.key} msg={pendingToMessage(row.p)} groupStart={true} pending={row.p.status} />;
            return <MessageItem key={row.key} msg={row.msg} groupStart={row.groupStart} highlight={highlight === row.msg.id} />;
          })}
        </div>
      </div>
      {!atBottom.current && ids.length > 0 && !newBelow ? (
        <button className={s.jumpBtn} aria-label="Jump to present" onClick={jumpToPresent}><ArrowDown size={18} /></button>
      ) : null}
    </div>
  );
}
