import { UserPlus } from "lucide-react";
import { Button } from "@/components/common/Button";
import { useUI } from "@/stores/ui";
import s from "./Chat.module.css";

import { t } from "@/i18n";

/**
 * The start of a group that has only its maker in it, as a group made with
 * nobody picked does: what to do next, and the button that does it. Whoever
 * is added through it is handed the group's key like anyone added later.
 */
export function GroupAlone({ channelId }: { channelId: string }) {
  return (
    <>
      <p className={s.emptyText}>{t("chat.messageList.groupAlone")} {t("chat.messageList.endToEnd")}</p>
      <Button size="sm" style={{ marginTop: 12 }} onClick={() => useUI.getState().openModal("createDM", { groupId: channelId })} data-testid="group-alone-add">
        <UserPlus size={16} aria-hidden="true" /> {t("chat.chat.addFriends")}
      </Button>
    </>
  );
}
