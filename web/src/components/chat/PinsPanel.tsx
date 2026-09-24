import { PinOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { channels as channelsApi } from "@/api/channels";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { canPin } from "./messageMenu";
import s from "./Chat.module.css";

import { t } from "@/i18n";
export function PinsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [pins, setPins] = useState<DecryptedMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [unpinning, setUnpinning] = useState<string | null>(null);
  const users = useUsers((u) => u.byId);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const ctx = useRenderCtx();
  const ref = useRef<HTMLDivElement>(null);
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
        if (alive) setPins(dec);
      })
      // A failure is not an empty channel: the two used to render the same
      // line, which said confidently that there were no pins.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [channelId, attempt]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // the header's own pin button toggles the popup shut on its click
      if (target.closest?.('[data-pop-toggle="pins"]')) return;
      if (ref.current && !ref.current.contains(target)) closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  return (
    <div className={s.pinsPop} ref={ref}>
      <div className={s.pinsHead}>
        <span>{t("chat.chat.pinnedMessages")}</span>
        <button className={s.popClose} aria-label={t("chat.pins.closePinnedMessages")} onClick={onClose}><X size={18} /></button>
      </div>
      <div className={s.pinsList}>
        {failed ? (
          <div className={s.pinEmpty}>
            {t("chat.pins.couldNotLoadPinnedMessages")}{" "}
            <button className={s.loadRetry} onClick={() => setAttempt((n) => n + 1)} data-testid="pins-retry">{t("chat.messageList.tryAgain")}</button>
          </div>
        ) : pins === null ? <div className={s.pinEmpty}>{t("chat.pins.loading")}</div> : pins.length === 0 ? <div className={s.pinEmpty}>{t("chat.pins.thisChannelDoesnTHaveAny")}</div> : null}
        {pins?.map((m) => (
          <div key={m.id} className={s.pinItem} onClick={() => { setJumpTo({ channelId, messageId: m.id }); onClose(); }}>
            <div className={s.pinHead}>
              <span className={s.pinAuthor}>{displayName(users[m.author_id])}</span>
              <span className={s.time}>{formatTimestamp(m.created_at)}</span>
            </div>
            <div className={s.pinText}>{m.payload?.t ? <Markdown source={m.payload.t} ctx={ctx} inline /> : m.payload?.att?.length ? t("chat.pins.attachment") : t("chat.pins.encrypted")}</div>
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
