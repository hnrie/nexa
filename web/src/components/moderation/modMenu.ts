import { button, defineMenu } from "@/lib/contextMenus/registry";
import { describeError } from "@/lib/errors";
import { unreadCount, useModeration } from "@/stores/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * The menu of the panel's place in the rail and the sidebar: Mark as Read,
 * which reads every case thread and bug report waiting on the staff, as any
 * conversation is read from its menu.
 */
export const moderationMenu = defineMenu<null>("moderation", [
  [button("markModerationRead", () => ({
    id: "read",
    label: t("sidebar.dmMenu.markAsRead"),
    disabled: !(unreadCount(useModeration.getState().unread) > 0),
    onSelect: () => void useModeration.getState().readAll().catch((err: unknown) => useUI.getState().toast(describeError(err, t("moderation.failed")), "error")),
  }))],
]);
