import { MessageCircle, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "@/components/common/Tooltip";
import { useChannels } from "@/stores/channels";
import { useReadStates, isUnread } from "@/stores/readStates";
import { useUI } from "@/stores/ui";
import s from "./Rail.module.css";

/** The 72 px server rail: home (DMs), separator, servers (phase 2), add. */
export function Rail() {
  const nav = useNavigate();
  const loc = useLocation();
  const channels = useChannels((c) => c.byId);
  const reads = useReadStates((r) => r.byChannel);
  const openModal = useUI((u) => u.openModal);
  const home = loc.pathname.startsWith("/channels/@me");

  let mentions = 0;
  let unread = false;
  for (const ch of Object.values(channels)) {
    if (ch.type !== "dm" && ch.type !== "group_dm") continue;
    const rs = reads[ch.id];
    mentions += rs?.mentions ?? 0;
    if (isUnread(rs, ch.last_message_id)) unread = true;
  }

  return (
    <nav className={s.rail} aria-label="Servers">
      <div className={s.item} data-selected={home} data-unread={unread && !home}>
        <span className={s.pill} />
        <Tooltip text="Direct Messages" side="right">
          <button className={s.btn} aria-label="Direct Messages" onClick={() => nav("/channels/@me")}>
            <MessageCircle size={28} strokeWidth={2.2} />
          </button>
        </Tooltip>
        {mentions > 0 ? <span className={s.badge}>{mentions > 99 ? "99+" : mentions}</span> : null}
      </div>
      <div className={s.sep} />
      <div className={[s.item, s.add].join(" ")}>
        <span className={s.pill} />
        <Tooltip text="Add a Server" side="right">
          <button className={s.btn} aria-label="Add a Server" onClick={() => openModal("createServer")}>
            <Plus size={24} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
