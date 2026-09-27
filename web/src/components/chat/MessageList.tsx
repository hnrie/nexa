import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Channel, GroupAddNotice } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Spinner } from "@/components/common/Spinner";
import { channelDisplayName } from "@/lib/names";
import { compareIds } from "@/lib/ids";
import { setReadingPresent } from "@/lib/readPosition";
import { formatDateDivider, formatTime, sameDay } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useMessages, type DecryptedMessage, type PendingMessage } from "@/stores/messages";
import { useReadStates } from "@/stores/readStates";
import { useSelection } from "@/stores/selection";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useChannels } from "@/stores/channels";
import { MessageItem } from "./MessageItem";
import { GroupAlone } from "./GroupAlone";
import { GroupAddNoticeRow } from "./GroupAddNoticeRow";
import { noticeSpot } from "@/lib/groupAdd";
import { useGroupAddNotices } from "@/stores/groupAddNotices";
import { BlockedRun } from "./BlockedRun";
import { isQuiet, messageFate, useBlockRules, type AuthorOf } from "@/lib/blocked";
import s from "./Chat.module.css";

import { t, Tr } from "@/i18n";
import { cssValue } from "@/lib/cssEscape";
import { RenderCtxProvider, useRenderCtx } from "@/lib/markdownCtx";
import { sameHookSender } from "@/lib/webhookMessage";
import { pollWords } from "@/lib/poll";
import { parse, plainText } from "@/markdown";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { displayName } from "@/stores/users";
import { ActiveRows, ActiveRowsProvider, rowIdOf } from "./activeRow";
import { dispatchGeneration, dispatchHooks } from "@/gateway/dispatch";
/** A run of messages from blocked people, folded into one row (open shows them under it). */
type BlockedRow = { kind: "blocked"; key: string; ids: string[]; open: boolean };
type Row =
  | { kind: "date"; key: string; ts: number }
  | { kind: "unread"; key: string }
  | { kind: "msg"; key: string; msg: DecryptedMessage; groupStart: boolean }
  | { kind: "pending"; key: string; p: PendingMessage; groupStart: boolean }
  /** Nexa's note, to this account alone, that a friend added it to the group: not a message. */
  | { kind: "notice"; key: string; notice: GroupAddNotice }
  | BlockedRow;

const GROUP_MS = 7 * 60 * 1000;

/**
 * The session whose ready has been applied. A conversation opened straight
 * from the address bar can load its messages before ready arrives, while
 * nothing is known yet about how far it was read: the "new" line was placed
 * against nothing (so never shown) and the newest message acked at once,
 * which undid Mark Unread and every unread message waiting there.
 */
let readyIn = -1;
const readyWatchers = new Set<() => void>();
dispatchHooks.onReady.push(() => {
  readyIn = dispatchGeneration();
  for (const fn of readyWatchers) fn();
});

/** Whether this session's read positions are in. */
function useReadStatesKnown(): boolean {
  const [known, setKnown] = useState(() => readyIn === dispatchGeneration());
  useEffect(() => {
    if (known) return;
    const check = () => setKnown(readyIn === dispatchGeneration());
    readyWatchers.add(check);
    check();
    return () => {
      readyWatchers.delete(check);
    };
  }, [known]);
  return known;
}

/**
 * How long the reading position goes on being held after a page of older
 * messages has landed. The page is in the list before the pictures and embeds
 * in it know how tall they are, so it keeps growing above the reader for a few
 * frames more, and `.scroll` turns `overflow-anchor` off, so nothing else
 * takes that growth back off again.
 */
const HOLD_AFTER_LOAD_MS = 1500;

/** A row of the list and how far its top sat below the top of the box. */
type Anchor = { id: string; top: number };

/**
 * Notes where the reader is, as the first row still showing and where it sits.
 *
 * A height measured before a change and compared with the height after cannot
 * tell fifty older messages arriving from one message finishing its decryption
 * and growing a line, and it is spent by whichever render happens to come
 * first. A row that is still on screen afterwards is the reading position
 * itself, and putting it back is the same answer however much else moved.
 */
function readAnchor(el: HTMLElement): Anchor | null {
  const box = el.getBoundingClientRect();
  for (const row of el.querySelectorAll<HTMLElement>("[data-id]")) {
    const r = row.getBoundingClientRect();
    if (r.bottom > box.top) return { id: row.dataset.id!, top: r.top - box.top };
  }
  return null;
}

/** Puts a noted row back where it sat. False when that row has gone from the list. */
function restoreAnchor(el: HTMLElement, a: Anchor): boolean {
  const row = el.querySelector<HTMLElement>(`[data-id="${cssValue(a.id)}"]`);
  if (!row) return false;
  const now = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  if (now !== a.top) el.scrollTop += now - a.top;
  return true;
}

function shouldGroup(prev: DecryptedMessage | undefined, cur: DecryptedMessage): boolean {
  if (!prev) return false;
  if (prev.author_id !== cur.author_id) return false;
  // every webhook's messages are filed under one account; one sender is one
  // webhook posting under one name and picture
  if (prev.webhook_id !== cur.webhook_id || !sameHookSender(prev.hook, cur.hook)) return false;
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
  const addNotice = useGroupAddNotices((n) => (channel.type === "group_dm" ? n.byChannel[channel.id] : undefined));
  const loadOlder = useMessages((m) => m.loadOlder);
  const loadNewer = useMessages((m) => m.loadNewer);
  const loadInitial = useMessages((m) => m.loadInitial);
  const returnToPresent = useMessages((m) => m.returnToPresent);
  const readState = useReadStates((r) => r.byChannel[channel.id]);
  const readKnown = useReadStatesKnown();
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
  /**
   * The reading position while a page of older messages is on its way. Held
   * rather than spent: it has to outlive every unrelated render in between —
   * a message finishing its decryption, a reaction, someone going idle — or
   * there is nothing left to hold on to by the time the page itself lands and
   * the reader is thrown up to the top of it.
   */
  const hold = useRef<Anchor | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A page of older messages is on its way. Set here, not read from the last render, which lags a frame behind. */
  const olderBusy = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  // The newest message there was when news started arriving below the reader:
  // the pill counts what came after it, and says since when.
  const newFrom = useRef<string | null>(null);
  const clearNewBelow = useCallback(() => {
    newFrom.current = null;
    setNewBelow(false);
  }, []);
  // Scrolling only moves refs, so whether the jump button shows has to be state of its own.
  const [showJump, setShowJump] = useState(false);
  const [reachedBottom, setReachedBottom] = useState(0);
  // one render context for every row, rather than every row subscribing to
  // every user, channel and server itself
  const renderCtx = useRenderCtx();
  // which row is pointed at or focused: only that one draws its toolbar
  const [activeRows] = useState(() => new ActiveRows());
  // what a screen reader is told about a message arriving (see announce below)
  const [said, setSaid] = useState<{ n: number; text: string } | null>(null);
  // Newer pages load below the reader; the loader at the top is for older ones.
  const [newerBusy, setNewerBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  // ChatView mounts a fresh list for each channel, so these start over per channel.
  const unreadFrom = useRef<string | null | undefined>(undefined);
  const lastAcked = useRef<string | null>(null);
  const triedAround = useRef<string | null>(null);
  // messages from people this account blocked, and which folded runs of them are open
  const blockRules = useBlockRules();
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRun = useCallback((key: string) => {
    setOpenRuns((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const ids = state?.ids ?? [];
  const byId = state?.byId ?? {};
  const pending = state?.pending ?? [];
  const hasOlder = state?.hasOlder ?? true;
  const hasNewer = state?.hasNewer ?? false;
  const loading = state?.loading ?? false;
  const loaded = state?.loaded ?? false;
  const failed = state?.failed ?? 0;

  if (unreadFrom.current === undefined && loaded && readKnown) unreadFrom.current = readState?.lastReadId ?? null;
  // Marked unread (here or on another device): the read position moves back,
  // and the "new" line moves up with it at once rather than on the next visit.
  const lastRead = readState?.lastReadId ?? null;
  const seenLastRead = useRef(lastRead);
  if (seenLastRead.current !== lastRead) {
    const before = seenLastRead.current;
    seenLastRead.current = lastRead;
    if (unreadFrom.current !== undefined && before !== null && (lastRead === null || compareIds(lastRead, before) < 0)) unreadFrom.current = lastRead ?? "0";
  }

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let prev: DecryptedMessage | undefined;
    let unreadPlaced = false;
    const from = unreadFrom.current;
    // Messages from people this account blocked fold into one row per run, or
    // leave no trace at all (lib/blocked.ts). Dates and grouping are worked out
    // from what is left, so a hidden message leaves no gap, no lone date line
    // and no break in the run of messages around it.
    const authorOf: AuthorOf = (mid) => byId[mid]?.author_id;
    let run: BlockedRow | null = null;
    // Nexa's note about who added this account goes where noticeSpot says,
    // and whatever follows it starts a run of its own, with a name
    const meId = me?.id;
    const spot = addNotice && meId && loaded ? noticeSpot(ids, byId, addNotice, meId, { hasOlder, hasNewer }) : null;
    let noticePlaced = false;
    let afterNotice = false;
    const placeNotice = () => {
      if (!addNotice || noticePlaced) return;
      out.push({ kind: "notice", key: "group-add-notice", notice: addNotice });
      noticePlaced = true;
      afterNotice = true;
    };
    if (spot === "start") placeNotice();
    for (const id of ids) {
      const m = byId[id];
      if (!m) continue;
      const fate = messageFate(m, blockRules, authorOf);
      if (fate === "hide") continue;
      const newDay = !prev || !sameDay(prev.created_at, m.created_at);
      if (newDay) out.push({ kind: "date", key: `d${m.id}`, ts: m.created_at });
      // nothing from someone blocked is news, so the "new" line waits for what is
      if (!unreadPlaced && from !== undefined && from !== null && compareIds(m.id, from) > 0 && m.author_id !== me?.id && !isQuiet(m, blockRules, authorOf)) {
        out.push({ kind: "unread", key: "unread" });
        unreadPlaced = true;
      }
      if (fate === "collapse") {
        // a run ends at the next shown message, and at a new day so the date line stays true
        if (!run || newDay) {
          const key = `b${m.id}`;
          run = { kind: "blocked", key, ids: [], open: openRuns.has(key) };
          out.push(run);
        }
        run.ids.push(m.id);
        if (run.open) out.push({ kind: "msg", key: m.id, msg: m, groupStart: !shouldGroup(prev, m) });
        prev = m;
        continue;
      }
      run = null;
      out.push({ kind: "msg", key: m.id, msg: m, groupStart: afterNotice || !shouldGroup(prev, m) });
      afterNotice = false;
      prev = m;
      if (spot && typeof spot === "object" && spot.after === m.id) placeNotice();
    }
    // at the end, or there after all when the line it follows is not shown
    if (spot === "end" || (spot && !noticePlaced && !hasNewer)) placeNotice();
    // Unsent messages group with what is above them exactly as sent ones do,
    // or each would flash its own avatar and name until the server answered.
    for (const p of pending) {
      const asMessage = pendingToMessage(p);
      out.push({ kind: "pending", key: p.tmpId, p, groupStart: afterNotice || !shouldGroup(prev, asMessage) });
      afterNotice = false;
      prev = asMessage;
    }
    return out;
    // loaded, readKnown and lastRead are listed so the rows are built again when the unread point is captured or moves
  }, [ids, byId, pending, me?.id, loaded, readKnown, lastRead, blockRules, openRuns, addNotice, hasOlder, hasNewer]);
  /** Whether a message stays quiet here: from someone blocked, or hidden for answering them. */
  const quiet = useCallback((m: DecryptedMessage | undefined) => !!m && isQuiet(m, blockRules, (mid) => byId[mid]?.author_id), [blockRules, byId]);

  const newest = ids[ids.length - 1];
  const prevNewest = useRef<string | undefined>(undefined);
  const prevPending = useRef(0);
  const prevHasNewer = useRef(false);

  /** Lets the reading position go, along with any wait for it to settle. */
  const dropHold = useCallback(() => {
    hold.current = null;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  /** Takes back whatever the list grew or shrank above the held row. */
  const keepHold = useCallback((el: HTMLElement) => {
    const a = hold.current;
    if (!a) return;
    // The held row can be deleted, or swept away by a jump that reloaded the
    // list around somewhere else; then the row in its place is what to hold.
    if (!restoreAnchor(el, a)) hold.current = readAnchor(el);
  }, []);

  /**
   * Says a message that just arrived, the way a sighted reader sees it land:
   * who and what, in a polite live region of its own. Rows added any other way
   * — a page of history above, a jump — are not news and say nothing, which a
   * live region over the whole list could not tell apart.
   */
  const announce = useCallback(
    (m: DecryptedMessage) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      const st = channel.server_id ? useServers.getState().byId[channel.server_id] : undefined;
      const name = m.hook?.name || st?.members[m.author_id]?.nickname || useRelationships.getState().byUser[m.author_id]?.nickname || displayName(users[m.author_id]);
      const body = m.payload?.t ? plainText(parse(m.payload.t), renderCtx).slice(0, 300) : m.payload?.poll ? pollWords(m.payload.poll).replace(/\n/g, ", ").slice(0, 300) : "";
      const text = body
        ? t("chat.messageList.announce", { name, text: body })
        : m.payload?.sticker
          ? t("chat.messageList.announceSticker", { name })
          : m.payload?.att?.length
            ? t("chat.messageList.announceFile", { name })
            : "";
      if (text) setSaid((cur) => ({ n: (cur?.n ?? 0) + 1, text }));
    },
    [channel.server_id, users, renderCtx],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Something new at the end that was not paged in: a message arriving live.
    const arrived = !!newest && !!prevNewest.current && compareIds(newest, prevNewest.current) > 0 && !prevHasNewer.current;
    if (arrived && byId[newest!] && byId[newest!]!.author_id !== me?.id && !quiet(byId[newest!])) announce(byId[newest!]!);
    // Your own message always gets shown, wherever you were reading. When the
    // list stops short of the present it would land after old history, so the
    // newest page is loaded again first.
    if (pending.length > prevPending.current) {
      atBottom.current = true;
      setShowJump(false);
      // Going to the bottom outranks whatever a page of older messages was holding.
      dropHold();
      if (hasNewer) returnToPresent(channel.id);
    }
    prevPending.current = pending.length;
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
      clearNewBelow();
    } else {
      // Older messages are inserted above the viewport, so everything being
      // read is pushed down the list by however tall they turned out to be.
      // Putting the held row back takes exactly that off again — and nothing
      // more, so a render that only made a message a line taller, or that
      // changed nothing at all, costs the reader nothing.
      keepHold(el);
      if (newest && prevNewest.current && compareIds(newest, prevNewest.current) > 0 && !prevHasNewer.current && byId[newest]?.author_id !== me?.id && !quiet(byId[newest])) {
        // A list that stopped short of the present only grows downwards by
        // loading pages the reader scrolled to, which are not news.
        if (!newFrom.current) newFrom.current = prevNewest.current;
        setNewBelow(true);
      }
    }
    prevNewest.current = newest;
    prevHasNewer.current = hasNewer;
  }, [rows, newest, byId, me?.id, pending.length, hasNewer, returnToPresent, channel.id, dropHold, keepHold, announce, quiet]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      // A picture or an embed in a page of older messages has no height of its
      // own until it loads, so the list goes on growing above the reader for a
      // while after the page landed. Nothing in a render says that happened,
      // which is why the hold is kept until it has settled.
      keepHold(el);
    });
    // Watch the list itself as well as its contents: the composer growing a
    // line shrinks this box without changing what is in it, and the newest
    // message would otherwise slide out of sight behind the box.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    ro.observe(el);
    return () => ro.disconnect();
  }, [channel.id, keepHold]);

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
        pickAnchor.current = readAnchor(el);
      }),
    [channel.id],
  );
  useLayoutEffect(() => {
    const a = pickAnchor.current;
    const el = scrollRef.current;
    pickAnchor.current = null;
    if (a && el) restoreAnchor(el, a);
  }, [selecting]);

  /**
   * Arrow keys walk the messages from the keyboard: from the list itself ↑
   * starts at the newest, ↑ and ↓ move a message at a time, Home and End go to
   * either end. A focused message shows its toolbar, and the menu key opens
   * its menu. Keys typed in an edit box stay the edit box's.
   */
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Home" && e.key !== "End") return;
    const target = e.target as HTMLElement;
    if (target.closest("textarea, input, select, [contenteditable='true']")) return;
    const list = scrollRef.current;
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-row]")];
    if (rows.length === 0) return;
    const at = target.closest<HTMLElement>("[data-row]");
    let i = at ? rows.indexOf(at) : -1;
    if (e.key === "Home") i = 0;
    else if (e.key === "End") i = rows.length - 1;
    else if (i < 0) i = rows.length - 1;
    else i = e.key === "ArrowUp" ? Math.max(0, i - 1) : Math.min(rows.length - 1, i + 1);
    e.preventDefault();
    rows[i]!.focus({ preventScroll: true });
    rows[i]!.scrollIntoView({ block: "nearest" });
  };

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // The end of a list that stops short of the present is not the bottom:
    // nothing should stick to it or be marked read from it.
    const wasAtBottom = atBottom.current;
    atBottom.current = dist < 80 && !hasNewer;
    // arriving at the bottom is reading what is there: the ack below runs
    // again for it, instead of waiting for the next message or a refocus
    if (atBottom.current && !wasAtBottom) setReachedBottom((n) => n + 1);
    setShowJump(!atBottom.current);
    if (atBottom.current) {
      clearNewBelow();
      // Nothing to hold: the bottom is where this list puts itself anyway.
      hold.current = null;
    } else if (hold.current || olderBusy.current) {
      // A fling carries on while the page loads, so what is worth holding is
      // the row in front of the reader now, not the one they had left behind
      // when the page was asked for. `olderBusy` is asked as well as the hold
      // itself, so a reader who reached the bottom and came back up before the
      // page landed gets a new row taken rather than nothing at all.
      hold.current = readAnchor(el) ?? hold.current;
    }
    if (el.scrollTop < 400 && hasOlder && !olderBusy.current && !loading && loaded && ids.length > 0) {
      // A second scroll event in the same frame still sees `loading` false —
      // the store sets it synchronously, React has not re-rendered — so the
      // guard is a ref of this list's own, set before the call rather than
      // read back out of the last render.
      olderBusy.current = true;
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      hold.current = readAnchor(el);
      void loadOlder(channel.id)
        .catch(() => {})
        .finally(() => {
          olderBusy.current = false;
          // The page is in the list; the pictures in it are not yet as tall as
          // they are going to be. Hold on a little longer so what they add
          // above the reader comes off again too, and so a second page asked
          // for in the meantime replaces the hold rather than racing it.
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null;
            hold.current = null;
          }, HOLD_AFTER_LOAD_MS);
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
    if (!loaded || !readKnown || hasNewer || !newest || !focused || !atBottom.current || typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (lastAcked.current === newest) return;
    if (readState?.lastReadId && compareIds(readState.lastReadId, newest) >= 0 && readState.mentions === 0) return;
    lastAcked.current = newest;
    void ack(channel.id, newest);
  }, [loaded, readKnown, hasNewer, newest, focused, readState, ack, channel.id, reachedBottom]);

  // A list too short to scroll never sends the scroll that asks for older
  // messages — after most of a page was deleted, or on a tall screen — so it
  // asks once it has settled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded || !hasOlder || loading) return;
    // (a list with no size yet has not been laid out, and says nothing)
    if (el.clientHeight > 0 && el.scrollHeight > 0 && el.scrollHeight <= el.clientHeight + 400) onScroll();
  }, [ids.length, loaded, hasOlder, loading, onScroll]);

  useEffect(() => {
    if (!jumpTo || jumpTo.channelId !== channel.id) return;
    // A message from someone blocked: a folded run opens to show it, and one
    // left out entirely is not there to go to, which is said rather than
    // searched for and then called missing.
    const wanted = byId[jumpTo.messageId];
    const fate = wanted ? messageFate(wanted, blockRules, (mid) => byId[mid]?.author_id) : "show";
    if (fate === "hide") {
      setJumpTo(null);
      useUI.getState().toast(t("people.blocked.jumpHidden"), "info");
      return;
    }
    if (fate === "collapse") {
      const run = rows.find((r): r is BlockedRow => r.kind === "blocked" && r.ids.includes(jumpTo.messageId));
      if (run && !run.open) {
        setOpenRuns((cur) => new Set(cur).add(run.key));
        return;
      }
    }
    // the id comes from the address bar, so it is escaped before it is a selector
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-id="${cssValue(jumpTo.messageId)}"]`);
    if (el) {
      triedAround.current = null;
      atBottom.current = false;
      setShowJump(true);
      // Going somewhere on purpose beats holding where you were: the row that
      // was being held is very likely not even in the list any more.
      dropHold();
      el.scrollIntoView({ block: "center" });
      setHighlight(jumpTo.messageId);
      // a second jump within the two seconds would otherwise have its highlight
      // cleared by the first one's timer
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        highlightTimer.current = null;
        setHighlight(null);
      }, 2000);
      setJumpTo(null);
    } else if (!loading) {
      // The page around a deleted message holds its neighbours but never the
      // message itself, so after one try the jump is given up.
      if (triedAround.current === jumpTo.messageId) {
        triedAround.current = null;
        setJumpTo(null);
        useUI.getState().toast(t("chat.messageList.thatMessageCouldNotBeFound"), "error");
        return;
      }
      triedAround.current = jumpTo.messageId;
      void useMessages.getState().loadAround(channel.id, jumpTo.messageId).catch(() => {});
    }
  }, [jumpTo, channel.id, rows, loading, setJumpTo, dropHold, byId, blockRules]);

  // "3 new messages since 4:32 PM": what came in below the reader since the news began
  const newSince = (): string => {
    const from = newFrom.current;
    const fresh = from ? ids.filter((id) => compareIds(id, from) > 0 && byId[id]?.author_id !== me?.id && !quiet(byId[id])) : [];
    const first = fresh.length ? byId[fresh[0]!] : undefined;
    return first ? t("chat.messageList.newMessagesSince", { count: fresh.length, time: formatTime(first.created_at) }) : t("chat.messageList.newMessages");
  };
  const jumpToPresent = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    setShowJump(false);
    clearNewBelow();
    dropHold();
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
          <p className={s.emptyText}><Tr id="chat.messageList.dmStart" values={{ name: <b>{name}</b> }} /></p>
        </div>
      );
    }
    if (channel.type === "subchat") {
      const parent = channel.parent_id ? byIdChannels[channel.parent_id] : undefined;
      const where = parent ? channelDisplayName(parent, users, me?.id) : t("chat.messageList.thisConversation");
      return (
        <div className={s.empty}>
          <h2 className={s.emptyName}>{name}</h2>
          <p className={s.emptyText}><Tr id="chat.messageList.subchatStart" values={{ where: <b>{where}</b> }} /></p>
        </div>
      );
    }
    // a group of one (made with nobody picked) says how to fill it
    const alone = channel.type === "group_dm" && channel.recipient_ids.length <= 1;
    return (
      <div className={s.empty}>
        {channel.type === "group_dm" && channel.icon_id ? <div className={s.emptyAvatar}><Avatar id={channel.id} avatarId={channel.icon_id} name={name} size={80} kind="icon" /></div> : null}
        <h2 className={s.emptyName}>{channel.server_id ? t("chat.messageList.welcomeToChannel", { name }) : name}</h2>
        {alone ? <GroupAlone channelId={channel.id} /> : <p className={s.emptyText}>
          {channel.server_id
            ? <Tr id="chat.messageList.channelStart" values={{ name: <b>#{name}</b> }} />
            : <Tr id="chat.messageList.groupStart" values={{ name: <b>{name}</b> }} />}
          {channel.server_id && channel.topic ? ` ${channel.topic}` : ""} {t("chat.messageList.endToEnd")}
        </p>}
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

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // No dependencies: every change to atBottom also flips showJump, so this runs
  // whenever the answer can have changed. The dispatcher reads it to decide
  // whether an arriving message was really in front of the reader.
  useEffect(() => {
    setReadingPresent(atBottom.current && loaded && !hasNewer ? channel.id : null);
  });
  useEffect(() => () => setReadingPresent(null), []);

  return (
    <div className={[s.listWrap, compact ? s.compact : ""].join(" ")} data-selecting={selecting || undefined}>
      {newBelow ? (
        <button type="button" className={s.newPill} onClick={jumpToPresent} data-testid="new-messages">
          <span className={s.newPillText}>{newSince()}</span>
          <span className={s.newPillJump}>{t("chat.messageList.jumpToPresent")}</span>
        </button>
      ) : null}
      <div className="visually-hidden" role="status">{said ? <span key={said.n}>{said.text}</span> : null}</div>
      <div
        className={s.scroll}
        ref={scrollRef}
        onScroll={onScroll}
        data-scroller=""
        role="region"
        tabIndex={0}
        aria-label={t("modals.quickSwitcher.messages")}
        onKeyDown={onListKey}
        // a finger has no hover: only a mouse or a pen points at a row
        onPointerOver={(e) => e.pointerType !== "touch" && activeRows.hover(rowIdOf(e.target))}
        onPointerLeave={() => activeRows.hover(null)}
        onFocus={(e) => activeRows.focus(rowIdOf(e.target))}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) activeRows.focus(null);
        }}
      >
        <div className={s.inner}>
          {!hasOlder ? (
            intro
          ) : !loaded && !loading && failed > 0 ? (
            <div className={s.loadError}>
              <span>{t("chat.messageList.messagesCouldNotBeLoaded")}</span>
              <button className={s.loadRetry} onClick={() => void loadInitial(channel.id)}>{t("chat.messageList.tryAgain")}</button>
            </div>
          ) : (loading && !newerBusy) || !loaded ? (
            <div className={s.loader}><Spinner size={24} /></div>
          ) : (
            <div style={{ height: 24 }} />
          )}
          <RenderCtxProvider value={renderCtx}>
            <ActiveRowsProvider value={activeRows}>
            {rows.map((row, i) => {
              if (row.kind === "date") return <div key={row.key} className={s.dateDivider}><span>{formatDateDivider(row.ts)}</span></div>;
              if (row.kind === "unread") return <div key={row.key} className={s.unreadDivider}><span>{t("chat.messageList.new")}</span></div>;
              if (row.kind === "blocked") return <BlockedRun key={row.key} runKey={row.key} count={row.ids.length} open={row.open} compact={compact} onToggle={toggleRun} />;
              if (row.kind === "notice") return <GroupAddNoticeRow key={row.key} notice={row.notice} />;
              if (row.kind === "pending") return <MessageItem key={row.key} msg={pendingToMessage(row.p)} groupStart={row.groupStart} pending={row.p.status} upload={row.p.upload} />;
              return <MessageItem key={row.key} msg={row.msg} groupStart={row.groupStart} highlight={highlight === row.msg.id} first={i < 2} />;
            })}
            </ActiveRowsProvider>
          </RenderCtxProvider>
          {hasNewer && loaded ? <div className={s.loader}><Spinner size={24} /></div> : null}
        </div>
      </div>
      {showJump && ids.length > 0 && !newBelow ? (
        <button className={s.jumpBtn} aria-label={t("chat.messageList.jumpToPresent")} onClick={jumpToPresent}><ArrowDown size={18} /></button>
      ) : null}
    </div>
  );
}
