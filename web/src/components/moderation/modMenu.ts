import { describeError } from "@/lib/errors";
import { unreadCount, useModeration } from "@/stores/moderation";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * The menu of the panel's place in the rail and the sidebar: Mark as Read,
 * which reads every case thread and bug report waiting on the staff, as any
 * conversation is read from its menu.
 */
export function moderationMenuItems(): ContextMenuItem[] {
  const unread = unreadCount(useModeration.getState().unread) > 0;
  return [
    {
      id: "read",
      label: t("sidebar.dmMenu.markAsRead"),
      disabled: !unread,
      onSelect: () => void useModeration.getState().readAll().catch((err: unknown) => useUI.getState().toast(describeError(err, t("moderation.failed")), "error")),
    },
  ];
}
