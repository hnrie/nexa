import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadSummary } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { t } from "@/i18n";
import { formatFull, formatRelative } from "@/lib/time";
import { nameClass, nameStyle } from "@/lib/roleLook";
import { useMemberLook } from "@/lib/useMemberLook";
import { useChannels } from "@/stores/channels";
import { openSummaryLast, useThreadLast } from "@/stores/threadLast";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import { useShownName } from "./useShownName";
import s from "./Chat.module.css";

/** Where the line from the avatar starts: just under it, or the top of a row that has none. */
const UNDER_AVATAR = 46;
const ROW_TOP = 4;

/**
 * The thread a message started, under it: a line runs down from the
 * message's avatar and turns into a card with the thread's name, how many
 * messages it holds, and the newest of them: who said it, a line of it and
 * when. Pressing the card opens the thread. It is kept current from the
 * thread itself, as messages arrive in it.
 */
export function ThreadChip({ serverId, summary }: { serverId: string; summary: ThreadSummary }) {
  const nav = useNavigate();
  const ref = useRef<HTMLButtonElement>(null);
  const live = useChannels((c) => c.byId[summary.id]);
  const name = live?.name ?? summary.name;
  const count = live?.thread?.message_count ?? summary.message_count;
  const archived = live?.thread?.archived ?? summary.archived;
  const last = useThreadLast((x) => x.byThread[summary.id]);
  const sealed = summary.last_message;
  useEffect(() => {
    if (sealed) void openSummaryLast(summary.id, sealed).catch(() => undefined);
  }, [summary.id, sealed]);

  // the line from the avatar has to reach the card, however tall the message above it is
  useLayoutEffect(() => {
    const card = ref.current;
    const row = card?.closest<HTMLElement>("[data-row]");
    if (!card || !row) return;
    const measure = () => {
      const from = row.dataset.groupStart === "true" ? UNDER_AVATAR : ROW_TOP;
      const up = card.getBoundingClientRect().top - row.getBoundingClientRect().top - from;
      card.style.setProperty("--spine-up", `${Math.max(0, Math.round(up))}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  return (
    <button type="button" ref={ref} className={s.threadCard} onClick={() => nav(`/channels/${serverId}/${summary.id}`)} data-testid="thread-chip" style={{ "--spine-up": "0px" } as CSSProperties}>
      <span className={s.threadSpine} aria-hidden="true" />
      <span className={s.threadTop}>
        <span className={s.threadName} dir="auto">
          {name}
        </span>
        {archived ? <span className={s.threadClosed}>{t("threads.chip.closed")}</span> : null}
        <span className={s.threadCount}>
          {count === 0 ? t("threads.chip.open") : t("threads.card.count", { count })}
          <ChevronRight size={16} aria-hidden="true" className={s.threadChev} />
        </span>
      </span>
      {last && count > 0 ? <LastLine threadId={summary.id} serverId={serverId} authorId={last.author_id} text={last.text} at={last.created_at} /> : count === 0 ? <span className={s.threadQuiet}>{t("threads.chip.noMessages")}</span> : null}
    </button>
  );
}

function LastLine({ threadId, serverId, authorId, text, at }: { threadId: string; serverId: string; authorId: string; text: string; at: number }) {
  const avatarId = useUsers((u) => u.byId[authorId]?.avatar_id ?? null);
  const serverAvatar = useServers((st) => st.byId[serverId]?.members[authorId]?.avatar_id ?? null);
  const name = useShownName(threadId, authorId);
  const look = useMemberLook(serverId, authorId);
  return (
    <span className={s.threadLast}>
      <Avatar id={authorId} avatarId={serverAvatar ?? avatarId} name={name} size={16} />
      <span className={[s.threadWho, nameClass(look)].join(" ")} style={nameStyle(look)} dir="auto">
        {name}
      </span>
      <span className={s.threadWords} dir="auto">
        {text}
      </span>
      <time className={s.threadWhen} dateTime={new Date(at).toISOString()} title={formatFull(at)}>
        {formatRelative(at)}
      </time>
    </span>
  );
}
