import { PinOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { channels as channelsApi } from "@/api/channels";
import { MSG_FLAG_PINNED } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { formatFull, formatTimestamp } from "@/lib/time";
import { RenderCtxProvider, useRenderCtx } from "@/lib/markdownCtx";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { memberColor, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { canPin } from "./messageMenu";
import { MessageBody } from "./MessageItem";
import { messageFate, useBlockRules } from "@/lib/blocked";
import { useLayerPresence } from "./useLayerPresence";
import { useShownName } from "./useShownName";
import { HookAvatar, HookTags } from "./webhook/HookHeader";
import s from "./Chat.module.css";

import { t } from "@/i18n";

/**
 * What says the pins may have changed, as seen from the messages loaded here:
 * which of them carry the pin flag, and how many "pinned a message" notes there
 * are. The list is asked for again when it changes, so a pin made while the
 * panel is open shows up in it.
 */
function usePinSignal(channelId: string): string {
  return useMessages((m) => {
    const c = m.channels[channelId];
    if (!c) return "";
    let pinned = "";
    let notes = 0;
    for (const id of c.ids) {
      const x = c.byId[id];
      if (!x) continue;
      if (x.flags & MSG_FLAG_PINNED) pinned += id + ",";
      if (x.type === "system_pin") notes += 1;
    }
    return `${pinned}|${notes}`;
  });
}

/**
 * One pinned message, drawn the way the conversation draws it: who, when, and
 * all of what it says and carries, however long. Jump goes to it in the
 * conversation, and Unpin sits beside it for those who may.
 */
function PinnedMessage({ msg, collapsed, unpinning, onJump, onUnpin }: { msg: DecryptedMessage; collapsed: boolean; unpinning: boolean; onJump: () => void; onUnpin: (() => void) | null }) {
  const hook = msg.hook;
  const avatarId = useUsers((u) => u.byId[msg.author_id]?.avatar_id ?? null);
  const shownName = useShownName(msg.channel_id, hook ? undefined : msg.author_id);
  const name = hook ? hook.name : shownName;
  const serverId = useChannels((c) => c.byId[msg.channel_id]?.server_id ?? null);
  const color = useServers((st) => (serverId && st.byId[serverId] && !msg.webhook_id ? memberColor(st.byId[serverId], msg.author_id) : undefined));
  const openModal = useUI((u) => u.openModal);
  const whoId = useId();
  return (
    <article className={s.pinCard} aria-labelledby={whoId} data-testid="pinned-message" data-pin={msg.id}>
      <span className={s.pinAvatar} aria-hidden="true">
        {hook && msg.webhook_id ? <HookAvatar hook={hook} webhookId={msg.webhook_id} /> : <Avatar id={msg.author_id} avatarId={avatarId} name={name} size={40} />}
      </span>
      <div className={s.pinMain}>
        <div className={s.headerRow} id={whoId}>
          {hook ? (
            <span className={s.pinName} dir="auto">{name}</span>
          ) : (
            <button type="button" className={s.author} style={color ? { color } : undefined} onClick={() => openModal("profile", { userId: msg.author_id })} dir="auto">
              {name}
            </button>
          )}
          {hook ? <HookTags /> : null}
          <time className={s.time} dateTime={new Date(msg.created_at).toISOString()} title={formatFull(msg.created_at)}>
            {formatTimestamp(msg.created_at)}
          </time>
        </div>
        {collapsed ? <div className={s.content}><span className={s.waiting}>{t("people.blocked.replyPreview")}</span></div> : <MessageBody msg={msg} name={name} />}
      </div>
      <div className={s.pinActions}>
        <button type="button" className={s.pinJump} onClick={onJump} data-testid="pin-jump">
          {t("chat.pins.jump")}
        </button>
        {onUnpin ? (
          <button type="button" className={s.pinRemove} aria-label={t("chat.pins.unpinThisMessage")} title={t("chat.pins.unpin")} disabled={unpinning} onClick={onUnpin} data-testid="pin-remove">
            <PinOff size={16} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The pinned messages, in a panel over the chat. It is a dialog: focus goes
 * into it and back to where it was, and Escape closes it. Each pin is drawn
 * as the message it is, with a way to it.
 */
export function PinsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [pins, setPins] = useState<DecryptedMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [unpinning, setUnpinning] = useState<string | null>(null);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const ctx = useRenderCtx();
  const ref = useRef<HTMLDivElement>(null);
  const signal = usePinSignal(channelId);
  const titleId = useId();
  // pins from people this account blocked fold to a line, or go, as they do in the conversation
  const rules = useBlockRules();
  const fates = new Map((pins ?? []).map((m) => [m.id, messageFate(m, rules, (id) => pins?.find((x) => x.id === id)?.author_id ?? useMessages.getState().channels[channelId]?.byId[id]?.author_id)]));
  const shownPins = pins?.filter((m) => fates.get(m.id) !== "hide") ?? null;
  useLayerPresence();
  // The parent passes a new onClose on every render; fetching must not follow it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let alive = true;
    setFailed(false);
    channelsApi
      .pins(channelId)
      .then(async (list) => {
        const dec = await Promise.all(list.map(decryptForStore));
        if (!alive) return;
        setPins(dec);
        // a pin can be old, by someone this device has not met yet
        const known = useUsers.getState().byId;
        for (const id of new Set(dec.map((m) => m.author_id))) {
          if (!known[id]) void usersApi.get(id).then((u) => useUsers.getState().upsert(u), () => undefined);
        }
      })
      // A failure is not an empty channel: the two used to render the same
      // line, which said confidently that there were no pins.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [channelId, attempt, signal]);
  // focus in as it opens, and back to what opened it as it closes
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // the header's own pin button toggles the popup shut on its click
      if (target.closest?.('[data-pop-toggle="pins"]')) return;
      // and what a pin opens over the app (a picture, a profile, a menu) is not somewhere else
      if (!target.closest?.("#root")) return;
      if (ref.current && !ref.current.contains(target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // a dialog opened from here (Unpin's confirmation) is on top, and Escape is its
      const panel = ref.current;
      const over = [...document.querySelectorAll("[data-modal-layer]")].some((el) => el !== panel && !!panel && !!(panel.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (over) return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className={s.pinsPop} ref={ref} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-modal-layer="" data-testid="pins-panel">
      <div className={s.pinsHead}>
        <h2 className={s.pinsTitle} id={titleId}>{t("chat.chat.pinnedMessages")}</h2>
        <button className={s.popClose} aria-label={t("chat.pins.closePinnedMessages")} onClick={onClose}><X size={18} /></button>
      </div>
      <div className={s.pinsList}>
        {failed ? (
          <div className={s.pinEmpty}>
            {t("chat.pins.couldNotLoadPinnedMessages")}{" "}
            <button className={s.loadRetry} onClick={() => setAttempt((n) => n + 1)} data-testid="pins-retry">{t("chat.messageList.tryAgain")}</button>
          </div>
        ) : shownPins === null ? <div className={s.pinEmpty}>{t("chat.pins.loading")}</div> : shownPins.length === 0 ? <div className={s.pinEmpty}>{t("chat.pins.thisChannelDoesnTHaveAny")}</div> : null}
        <RenderCtxProvider value={ctx}>
          {shownPins?.map((m) => (
            <PinnedMessage
              key={m.id}
              msg={m}
              collapsed={fates.get(m.id) === "collapse"}
              unpinning={unpinning === m.id}
              onJump={() => {
                setJumpTo({ channelId, messageId: m.id });
                onClose();
              }}
              onUnpin={
                canPin(m)
                  ? () => {
                      setUnpinning(m.id);
                      channelsApi
                        .unpin(channelId, m.id)
                        .then(() => setPins((cur) => (cur ?? []).filter((x) => x.id !== m.id)))
                        .catch((err) => useUI.getState().toast(err instanceof Error ? err.message : t("chat.pins.thatMessageCouldNotBeUnpinned"), "error"))
                        .finally(() => setUnpinning(null));
                    }
                  : null
              }
            />
          ))}
        </RenderCtxProvider>
      </div>
    </div>
  );
}
