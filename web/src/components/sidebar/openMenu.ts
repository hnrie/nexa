import { useTabs } from "@/stores/tabs";
import type { ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * "Open in new tab", which every channel, conversation and subchat offers,
 * wherever it is listed. The tab opens behind the one in use, as a link opened
 * in a new tab does in a browser.
 */
export function openMenuItems(serverId: string | null, channelId: string): ContextMenuItem[] {
  return [
    {
      id: "newTab",
      label: t("panes.openInNewTab"),
      onSelect: () => useTabs.getState().openTab(serverId, channelId, { background: true }),
      separatorAfter: true,
    },
  ];
}
