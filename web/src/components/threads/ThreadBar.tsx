import { Archive, ChevronLeft, Lock, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { threads as threadsApi } from "@/api/threads";
import type { Channel } from "@/api/types";
import { menuAnchor } from "@/components/common/ContextMenu";
import { Tooltip } from "@/components/common/Tooltip";
import { t } from "@/i18n";
import { P } from "@/lib/perms";
import { canManageThread } from "@/lib/threads";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useThreads } from "@/stores/threads";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import chat from "@/components/chat/Chat.module.css";
import s from "./Threads.module.css";

/** In a thread's header: the channel it belongs to, the way back to it. */
export function ThreadParentLink({ thread }: { thread: Channel }) {
  const nav = useNavigate();
  const parent = useChannels((c) => (thread.parent_id ? c.byId[thread.parent_id] : undefined));
  if (!parent) return null;
  return (
    <button className={chat.hParent} onClick={() => nav(`/channels/${thread.server_id}/${parent.id}`)} data-testid="thread-parent">
      <ChevronLeft size={14} />
      <span className={chat.hParentText}>{parent.type === "forum" ? t("threads.bar.inForum", { name: parent.name }) : t("threads.bar.inChannel", { name: parent.name })}</span>
    </button>
  );
}

async function patchThread(thread: Channel, body: { archived?: boolean; locked?: boolean }): Promise<void> {
  try {
    const fresh = await serversApi.patchChannel(thread.id, body);
    useChannels.getState().upsert(fresh);
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("threads.bar.changeFailed"), "error");
  }
}

/**
 * In a thread's header: Join or Leave, and what else can be done with it,
 * closing, locking, its settings and deleting, for whoever may.
 */
export function ThreadActions({ thread, compact }: { thread: Channel; compact: boolean }) {
  const nav = useNavigate();
  const meId = useAuth((a) => a.me?.id);
  const joined = useThreads((x) => !!x.joined[thread.id]);
  const st = useServers((x) => (thread.server_id ? x.byId[thread.server_id] : undefined));
  const [busy, setBusy] = useState(false);
  const manage = canManageThread(thread);
  const own = !!meId && thread.owner_id === meId;
  const meta = thread.thread;
  const toggleJoin = async () => {
    setBusy(true);
    try {
      if (joined) await threadsApi.leave(thread.id);
      else await threadsApi.join(thread.id);
      useThreads.getState().setJoined(thread.id, !joined);
    } catch (err) {
      useUI.getState().toast(err instanceof ApiError ? err.message : t("threads.bar.changeFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const menu = (el: HTMLElement) => {
    const items: ContextMenuItem[] = [];
    if (compact) items.push({ id: "join", label: joined ? t("threads.bar.leave") : t("threads.bar.join"), onSelect: () => void toggleJoin() });
    if (manage || own) items.push({ id: "archive", label: meta?.archived ? t("threads.bar.open") : t("threads.bar.close"), onSelect: () => void patchThread(thread, { archived: !meta?.archived }) });
    if (manage) items.push({ id: "lock", label: meta?.locked ? t("threads.bar.unlock") : t("threads.bar.lock"), onSelect: () => void patchThread(thread, { locked: !meta?.locked }) });
    if (manage || own) items.push({ id: "settings", label: t("threads.bar.settings"), onSelect: () => useUI.getState().openModal("channelSettings", { channelId: thread.id }) });
    if (manage || own) {
      items.push({
        id: "delete",
        label: t("threads.bar.delete"),
        danger: true,
        onSelect: () =>
          useUI.getState().openModal("confirm", {
            title: t("threads.bar.deleteTitle"),
            body: t("threads.bar.deleteBody", { name: thread.name }),
            confirmLabel: t("threads.bar.delete"),
            danger: true,
            onConfirm: async () => {
              try {
                await serversApi.deleteChannel(thread.id);
                useChannels.getState().remove(thread.id);
                nav(`/channels/${thread.server_id}/${thread.parent_id ?? ""}`);
              } catch (err) {
                useUI.getState().toast(err instanceof ApiError ? err.message : t("threads.bar.deleteFailed"), "error");
              }
            },
          }),
      });
    }
    if (!items.length) return;
    const anchor = menuAnchor(el);
    useUI.getState().openContextMenu({ x: anchor.left, y: anchor.bottom + 4, anchor, items, label: t("threads.bar.more") });
  };
  const anyMenu = compact || manage || own;
  // a private thread is joined by being brought in; leaving it is still one's own to do
  const canJoin = thread.type !== "private_thread" || joined || canI(st, P.MANAGE_THREADS, thread.id);
  return (
    <>
      {!compact && canJoin ? (
        <button type="button" className={s.joinBtn} data-joined={joined || undefined} disabled={busy} onClick={() => void toggleJoin()} data-testid="thread-join">
          {joined ? t("threads.bar.leave") : t("threads.bar.join")}
        </button>
      ) : null}
      {anyMenu ? (
        <Tooltip text={t("threads.bar.more")} side="bottom">
          <button className={chat.hBtn} aria-label={t("threads.bar.more")} onClick={(e) => menu(e.currentTarget)} data-testid="thread-menu"><MoreHorizontal size={22} /></button>
        </Tooltip>
      ) : null}
    </>
  );
}

/** Over a thread's box: that it is closed (a message opens it again) or locked (only moderators write). */
export function ThreadStateBar({ thread }: { thread: Channel }) {
  const meta = thread.thread;
  const st = useServers((x) => (thread.server_id ? x.byId[thread.server_id] : undefined));
  if (!meta || (!meta.archived && !meta.locked)) return null;
  const mod = canI(st, P.MANAGE_THREADS, thread.id);
  return (
    <div className={s.stateBar} data-testid="thread-state">
      {meta.locked ? <Lock size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
      <span>{meta.locked ? (mod ? t("threads.bar.lockedMod") : t("threads.bar.locked")) : t("threads.bar.closed")}</span>
    </div>
  );
}
