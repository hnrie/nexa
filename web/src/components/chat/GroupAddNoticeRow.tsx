import { PersonName } from "@/components/common/PersonName";
import { Eye } from "lucide-react";
import { useId } from "react";
import type { GroupAddNotice } from "@/api/types";
import { NexaAvatar, OfficialBadge } from "@/components/nexa/NexaBits";
import { describeError } from "@/lib/errors";
import { formatFull, formatTimestamp } from "@/lib/time";
import { useGroupAddNotices } from "@/stores/groupAddNotices";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Chat.module.css";
import n from "./GroupAddNotice.module.css";

import { t, Tr } from "@/i18n";

/**
 * Nexa's note to someone a friend put in this group directly. It is drawn
 * among the messages but is not one of them: nobody else sees it, it is never
 * unread, searched or exported, and Dismiss takes it away on every device.
 */
export function GroupAddNoticeRow({ notice }: { notice: GroupAddNotice }) {
  const uid = useId();
  const adder = useUsers((u) => u.byId[notice.added_by]);
  const nickname = useRelationships((r) => r.byUser[notice.added_by]?.nickname);
  const openModal = useUI((u) => u.openModal);
  const name = nickname || displayName(adder);
  const dismiss = () => {
    void useGroupAddNotices
      .getState()
      .dismiss(notice.channel_id)
      .catch((err: unknown) => useUI.getState().toast(describeError(err, t("groupAdd.notice.couldNotDismiss")), "error"));
  };
  return (
    <div
      role="article"
      aria-labelledby={`${uid}who ${uid}body`}
      className={[s.msg, n.notice].join(" ")}
      data-group-start="true"
      data-id="group-add-notice"
      // reachable with the arrow keys from the list, like the messages around it
      data-row=""
      tabIndex={-1}
      data-testid="group-add-notice"
    >
      <span className={n.avatar} aria-hidden="true">
        <NexaAvatar size={40} />
      </span>
      <div className={s.headerRow} id={`${uid}who`}>
        <span className={n.nexa}>Nexa</span>
        <OfficialBadge compact />
        <time className={s.time} dateTime={new Date(notice.added_at).toISOString()} title={formatFull(notice.added_at)}>
          {formatTimestamp(notice.added_at)}
        </time>
      </div>
      <div className={s.content} id={`${uid}body`}>
        <Tr
          id="groupAdd.notice.body"
          values={{
            name: (
              <button type="button" className={n.link} dir="auto" onClick={() => openModal("profile", { userId: notice.added_by })} data-testid="group-add-notice-name">
                <PersonName userId={notice.added_by}>{name}</PersonName>
              </button>
            ),
            setting: t("settings.privacy.letFriendsAddMe"),
            where: (
              <button type="button" className={n.link} onClick={() => openModal("settings", { page: "privacy" })} data-testid="group-add-notice-settings">
                {t("groupAdd.notice.where")}
              </button>
            ),
          }}
        />
      </div>
      <div className={n.foot}>
        <Eye size={14} aria-hidden="true" />
        <span>{t("groupAdd.notice.onlyYou")}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className={n.dismiss} onClick={dismiss} data-testid="group-add-notice-dismiss">
          {t("groupAdd.notice.dismiss")}
        </button>
      </div>
    </div>
  );
}
