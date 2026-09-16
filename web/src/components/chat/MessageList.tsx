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
import { useSelection } from "@/stores/selection";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useChannels } from "@/stores/channels";
import { MessageItem } from "./MessageItem";
import s from "./Chat.module.css";

type Row =
  | { kind: "date"; key: string; ts: number }
  | { kind: "unread"; key: string }
  | { kind: "msg"; key: string; msg: DecryptedMessage; groupStart: boolean }
  | { kind: "pending"; key: string; p: PendingMessage; groupStart: boolean };

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
  const byIdChannels = useChannels((c) => c.byId);
  const state = useMessages((m) => m.channels[channel.id]);
  const loadOlder = useMessages((m) => m.loadOlder);
  const loadNewer = useMessages((m) => m.loadNewer);
  const loadInitial = useMessages((m) => m.loadInitial);
  const returnToPresent = useMessages((m) => m.returnToPresent);
  const readState = useReadStates((r) => r.byChannel[channel.id]);
  const ack = useReadStates((r) => r.ack);
  const focused = useUI((u) => u.focused);
  const jumpTo = useUI((u) => u.jumpTo);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const compact = useSettings((st) => st.settings.messageDisplay === "compact");
  const selecting = useSelection((x) => x.channelId === channel.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The row at the top of the view, and how far down it sat, as picking began or ended. */
  const pickAnchor = useRef<{ id: string; top: number } | null>(null);
  const atBottom = useRef(true);
  const prepend = useRef<{ height: number } | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  // Scrolling only moves refs, so whether the jump button shows has to be state of its own.
  const [showJump, setShowJump] = useState(false);
  // Newer pages load below the reader; the loader at the top is for older ones.
  const [newerBusy, setNewerBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  // ChatView mounts a fresh list for each channel, so these start over per channel.
  const unreadFrom = useRef<string | null | undefined>(undefined);
  const lastAcked = useRef<string | null>(null);
  const triedAround = useRef<string | null>(null);

  const ids = state?.ids ?? [];
  const byId = state?.byId ?? {};
  const pending = state?.pending ?? [];
  const hasOlder = state?.hasOlder ?? true;
  const hasNewer = state?.hasNewer ?? false;
  const loading = state?.loading ?? false;
  const loaded = state?.loaded ?? false;
  const failed = state?.failed ?? 0;

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
    // Unsent messages group with what is above them exactly as sent ones do,
    // or each would flash its own avatar and name until the server answered.
    for (const p of pending) {
      const asMessage = pendingToMessage(p);
      out.push({ kind: "pending", key: p.tmpId, p, groupStart: !shouldGroup(prev, asMessage) });
      prev = asMessage;
    }
    return out;
    // loaded is listed so the rows are built again once the unread point is captured
  }, [ids, byId, pending, me?.id, loaded]);

  const newest = ids[ids.length - 1];
  const prevNewest = useRef<string | undefined>(undefined);
  const prevPending = useRef(0);
  const prevHasNewer = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pre = prepend.current;
    if (pre) {
      prepend.current = null;
      const grew = el.scrollHeight - pre.height;
      // Only hold the reading position when older messages really did arrive.
      // The list can change height for other reasons, and treating that as a
      // prepend would throw the reader back up to where the page begins.
      // The shift is added to where the reader is now, not where they were
      // when the page was asked for: a fling keeps scrolling while it loads.
      if (grew > 0) {
        el.scrollTop += grew;
        return;
      }
    }
    // Your own message always gets shown, wherever you were reading. When the
    // list stops short of the present it would land after old history, so the
    // newest page is loaded again first.
    if (pending.length > prevPending.current) {
      atBottom.current = true;
      setShowJump(false);
      if (hasNewer) returnToPresent(channel.id);
    }
    prevPending.current = pending.length;
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else if (newest && prevNewest.current && compareIds(newest, prevNewest.current) > 0 && !prevHasNewer.current && byId[newest]?.author_id !== me?.id) {
      // A list that stopped short of the present only grows downwards by
      // loading pages the reader scrolled to, which are not news.
      setNewBelow(true);
    }
    prevNewest.current = newest;
    prevHasNewer.current = hasNewer;
  }, [rows, newest, byId, me?.id, pending.length, hasNewer, returnToPresent, channel.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    // Watch the list itself as well as its contents: the composer growing a
    // line shrinks this box without changing what is in it, and the newest
    // message would otherwise slide out of sight behind the box.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    ro.observe(el);
    return () => ro.disconnect();
  }, [channel.id]);

  // Picking moves every row over for its check, which rewraps long messages
  // and would slide what is being read out of view. The row at the top is
  // noted before the change lands (a store subscription runs before React
  // renders) and put back where it was after.
  useEffect(
    () =>
      useSelection.subscribe((next, prev) => {
        if ((next.channelId === channel.id) === (prev.channelId === channel.id)) return;
        const el = scrollRef.current;
        if (!el || atBottom.current) return;
        const box = el.getBoundingClientRect();
        for (const row of el.querySelectorAll<HTMLElement>("[data-id]")) {
          const r = row.getBoundingClientRect();
          if (r.bottom > box.top) {
            pickAnchor.current = { id: row.dataset.id!, top: r.top - box.top };
            return;
          }
        }
      }),
    [channel.id],
  );
  useLayoutEffect(() => {
    const a = pickAnchor.current;
    const el = scrollRef.current;
    pickAnchor.current = null;
    if (!a || !el) return;
    const row = el.querySelector<HTMLElement>(`[data-id="${a.id}"]`);
    if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top;
  }, [selecting]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // The end of a list that stops short of the present is not the bottom:
    // nothing should stick to it or be marked read from it.
    atBottom.current = dist < 80 && !hasNewer;
    setShowJump(!atBottom.current);
    if (atBottom.current) setNewBelow(false);
    if (el.scrollTop < 400 && hasOlder && !loading && loaded && ids.length > 0) {
      prepend.current = { height: el.scrollHeight };
      void loadOlder(channel.id)
        .catch(() => {})
        .finally(() => {
          if (prepend.current && scrollRef.current && scrollRef.current.scrollHeight === prepend.current.height) prepend.current = null;
        });
    } else if (dist < 400 && hasNewer && !loading && loaded) {
      // Pages added below the reader leave the scroll position where it is.
      setNewerBusy(true);
      void loadNewer(channel.id)
        .catch(() => {})
        .finally(() => setNewerBusy(false));
    }
  }, [channel.id, hasOlder, hasNewer, loading, loaded, ids.length, loadOlder, loadNewer]);

  useEffect(() => {
    // Wait for the first page: the unread point is taken from the read state
    // on that render, and acking earlier would move it to the newest message.
    // A list that stops short of the present has not shown the newest message.
    if (!loaded || hasNewer || !newest || !focused || !atBottom.current || typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (lastAcked.current === newest) return;
    if (readState?.lastReadId && compareIds(readState.lastReadId, newest) >= 0 && readState.mentions === 0) return;
    lastAcked.current = newest;
    void ack(channel.id, newest);
  }, [loaded, hasNewer, newest, focused, readState, ack, channel.id]);

  useEffect(() => {
    if (!jumpTo || jumpTo.channelId !== channel.id) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-id="${jumpTo.messageId}"]`);
    if (el) {
      triedAround.current = null;
      atBottom.current = false;
      setShowJump(true);
      el.scrollIntoView({ block: "center" });
      setHighlight(jumpTo.messageId);
      setTimeout(() => setHighlight(null), 2000);
      setJumpTo(null);
    } else if (!loading) {
      // The page around a deleted message holds its neighbours but never the
      // message itself, so after one try the jump is given up.
      if (triedAround.current === jumpTo.messageId) {
        triedAround.current = null;
        setJumpTo(null);
        useUI.getState().toast("That message could not be found.", "error");
        return;
      }
      triedAround.current = jumpTo.messageId;
      void useMessages.getState().loadAround(channel.id, jumpTo.messageId).catch(() => {});
    }
  }, [jumpTo, channel.id, rows, loading, setJumpTo]);

  const jumpToPresent = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    setShowJump(false);
    setNewBelow(false);
    // The newest messages are not loaded after a jump far back, so they are fetched again.
    if (hasNewer) returnToPresent(channel.id);
    else el.scrollTop = el.scrollHeight;
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
    if (channel.type === "subchat") {
      const parent = channel.parent_id ? byIdChannels[channel.parent_id] : undefined;
      const where = parent ? channelDisplayName(parent, users, me?.id) : "this conversation";
      return (
        <div className={s.empty}>
          <h2 className={s.emptyName}>{name}</h2>
          <p className={s.emptyText}>A subchat inside <b>{where}</b>, for everyone already in it. It has its own key, so what is said here is encrypted separately.</p>
        </div>
      );
    }
    return (
      <div className={s.empty}>
        {channel.type === "group_dm" && channel.icon_id ? <div className={s.emptyAvatar}><Avatar id={channel.id} avatarId={channel.icon_id} name={name} size={80} kind="icon" /></div> : null}
        <h2 className={s.emptyName}>{channel.server_id ? `Welcome to #${name}!` : name}</h2>
        <p className={s.emptyText}>{channel.server_id ? <>This is the start of the <b>#{name}</b> channel.{channel.topic ? ` ${channel.topic}` : ""}</> : <>Welcome to the beginning of the <b>{name}</b> group.</>} Messages here are end-to-end encrypted.</p>
      </div>
    );
  }, [channel, users, me?.id, byIdChannels]);

  useEffect(() => {
    if (loaded || loading) return;
    if (failed === 0) {
      void loadInitial(channel.id);
      return;
    }
    // After a failure, try again once the connection is back or after a pause
    // that doubles each time, up to half a minute.
    const retry = () => void loadInitial(channel.id);
    const timer = setTimeout(retry, Math.min(30_000, 1000 * 2 ** (failed - 1)));
    window.addEventListener("online", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [channel.id, loaded, loading, failed, loadInitial]);

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
    <div className={[s.listWrap, compact ? s.compact : ""].join(" ")} data-selecting={selecting || undefined}>
      {newBelow ? <div className={s.newPill} onClick={jumpToPresent}><span>New messages</span><span>Jump to present</span></div> : null}
      <div className={s.scroll} ref={scrollRef} onScroll={onScroll} data-scroller="">
        <div className={s.inner}>
          {!hasOlder ? (
            intro
          ) : !loaded && !loading && failed > 0 ? (
            <div className={s.loadError}>
              <span>Messages could not be loaded.</span>
              <button className={s.loadRetry} onClick={() => void loadInitial(channel.id)}>Try again</button>
            </div>
          ) : (loading && !newerBusy) || !loaded ? (
            <div className={s.loader}><Spinner size={24} /></div>
          ) : (
            <div style={{ height: 24 }} />
          )}
          {rows.map((row, i) => {
            if (row.kind === "date") return <div key={row.key} className={s.dateDivider}><span>{formatDateDivider(row.ts)}</span></div>;
            if (row.kind === "unread") return <div key={row.key} className={s.unreadDivider}><span>New</span></div>;
            if (row.kind === "pending") return <MessageItem key={row.key} msg={pendingToMessage(row.p)} groupStart={row.groupStart} pending={row.p.status} />;
            return <MessageItem key={row.key} msg={row.msg} groupStart={row.groupStart} highlight={highlight === row.msg.id} first={i < 2} />;
          })}
          {hasNewer && loaded ? <div className={s.loader}><Spinner size={24} /></div> : null}
        </div>
      </div>
      {showJump && ids.length > 0 && !newBelow ? (
        <button className={s.jumpBtn} aria-label="Jump to present" onClick={jumpToPresent}><ArrowDown size={18} /></button>
      ) : null}
    </div>
  );
}
