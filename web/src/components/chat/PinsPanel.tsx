import { PinOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { channels as channelsApi } from "@/api/channels";
import { MSG_FLAG_PINNED } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { useMessages } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { canPin } from "./messageMenu";
import { messageFate, useBlockRules } from "@/lib/blocked";
import { hookText } from "@/lib/webhookMessage";
import { pollWords } from "@/lib/poll";
import { useLayerPresence } from "./useLayerPresence";
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
 * The pinned messages, in a panel over the chat. It is a dialog: focus goes
 * into it and back to where it was, Escape closes it, and each pin is a
 * button that goes to the message.
 */
export function PinsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [pins, setPins] = useState<DecryptedMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [unpinning, setUnpinning] = useState<string | null>(null);
  const users = useUsers((u) => u.byId);
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
        {shownPins?.map((m) => (
          <div key={m.id} className={s.pinItem}>
            <button type="button" className={s.pinJump} onClick={() => { setJumpTo({ channelId, messageId: m.id }); onClose(); }}>
              <span className={s.pinHead}>
                <span className={s.pinAuthor} dir="auto">{m.hook?.name ?? displayName(users[m.author_id])}</span>
                <span className={s.time}>{formatTimestamp(m.created_at)}</span>
              </span>
              <span className={s.pinText} dir="auto">{fates.get(m.id) === "collapse" ? t("people.blocked.replyPreview") : m.payload?.t ? <Markdown source={m.payload.t} ctx={ctx} inline /> : m.payload?.poll ? pollWords(m.payload.poll).replace(/\n/g, " ") : m.hook && hookText(m.hook) ? <Markdown source={hookText(m.hook)} ctx={ctx} inline /> : m.payload?.att?.length ? t("chat.pins.attachment") : t("chat.pins.encrypted")}</span>
            </button>
            {canPin(m) ? (
              <button
                className={s.pinRemove}
                aria-label={t("chat.pins.unpinThisMessage")}
                title={t("chat.pins.unpin")}
                disabled={unpinning === m.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setUnpinning(m.id);
                  channelsApi
                    .unpin(channelId, m.id)
                    .then(() => setPins((cur) => (cur ?? []).filter((x) => x.id !== m.id)))
                    .catch((err) => useUI.getState().toast(err instanceof Error ? err.message : t("chat.pins.thatMessageCouldNotBeUnpinned"), "error"))
                    .finally(() => setUnpinning(null));
                }}
              >
                <PinOff size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
