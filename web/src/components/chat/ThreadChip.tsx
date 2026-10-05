import { ChevronRight, MessageSquareText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ThreadSummary } from "@/api/types";
import { t } from "@/i18n";
import { useChannels } from "@/stores/channels";
import s from "./Chat.module.css";

/**
 * The thread a message started, under it: its name, how much has been said
 * in it, and the way in. Kept current from the thread itself where this app
 * holds it.
 */
export function ThreadChip({ serverId, summary }: { serverId: string; summary: ThreadSummary }) {
  const nav = useNavigate();
  const live = useChannels((c) => c.byId[summary.id]);
  const name = live?.name ?? summary.name;
  const count = live?.thread?.message_count ?? summary.message_count;
  const archived = live?.thread?.archived ?? summary.archived;
  return (
    <button type="button" className={s.threadChip} onClick={() => nav(`/channels/${serverId}/${summary.id}`)} data-testid="thread-chip">
      <MessageSquareText size={16} className={s.threadChipIcon} aria-hidden="true" />
      <span className={s.threadChipName} dir="auto">{name}</span>
      <span className={s.threadChipMeta}>{count === 0 ? t("threads.chip.noMessages") : t("threads.chip.messages", { count })}</span>
      {archived ? <span className={s.threadChipClosed}>{t("threads.chip.closed")}</span> : null}
      <span className={s.threadChipGo}>
        {t("threads.chip.open")}
        <ChevronRight size={14} aria-hidden="true" />
      </span>
    </button>
  );
}
