import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { channels as channelsApi } from "@/api/channels";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import s from "./Chat.module.css";

export function PinsPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [pins, setPins] = useState<DecryptedMessage[] | null>(null);
  const users = useUsers((u) => u.byId);
  const setJumpTo = useUI((u) => u.setJumpTo);
  const ctx = useRenderCtx();
  const ref = useRef<HTMLDivElement>(null);
  // The parent passes a new onClose on every render; fetching must not follow it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let alive = true;
    channelsApi
      .pins(channelId)
      .then(async (list) => {
        const dec = await Promise.all(list.map(decryptForStore));
        if (alive) setPins(dec);
      })
      .catch(() => alive && setPins([]));
    return () => {
      alive = false;
    };
  }, [channelId]);
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
        <span>Pinned Messages</span>
        <button className={s.popClose} aria-label="Close pinned messages" onClick={onClose}><X size={18} /></button>
      </div>
      <div className={s.pinsList}>
        {pins === null ? <div className={s.pinEmpty}>Loading…</div> : pins.length === 0 ? <div className={s.pinEmpty}>This channel doesn't have any pinned messages… yet.</div> : null}
        {pins?.map((m) => (
          <div key={m.id} className={s.pinItem} onClick={() => { setJumpTo({ channelId, messageId: m.id }); onClose(); }}>
            <div className={s.pinHead}>
              <span className={s.pinAuthor}>{displayName(users[m.author_id])}</span>
              <span className={s.time}>{formatTimestamp(m.created_at)}</span>
            </div>
            <div className={s.pinText}>{m.payload?.t ? <Markdown source={m.payload.t} ctx={ctx} inline /> : m.payload?.att?.length ? "[attachment]" : "[encrypted]"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
