import { roomToSplit } from "@/components/shell/PaneGrid";
import { activeTab, MAX_PANES, panesIn, usePanes } from "@/stores/panes";
import type { ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * "Open in new tab", "Split right" and "Split down" — the three entries every
 * channel, conversation and subchat offers, wherever it is listed.
 *
 * Splitting is offered only while there is room for another readable chat. A
 * pane narrower than about 380px is not a chat any more — the composer wraps
 * to three lines and every message becomes a column of single words — so
 * rather than let someone tile their way into that, the entry is shown
 * disabled with the reason. On a phone, where there is no room for two of
 * anything, only the tab entry appears.
 */
export function openMenuItems(serverId: string | null, channelId: string): ContextMenuItem[] {
  const panes = usePanes.getState();
  const tab = activeTab(panes);
  const full = panesIn(tab.root).length >= MAX_PANES;
  const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;

  const items: ContextMenuItem[] = [
    {
      id: "newTab",
      label: t("panes.openInNewTab"),
      onSelect: () => usePanes.getState().openTab(serverId, channelId, { background: true }),
      separatorAfter: phone,
    },
  ];
  if (phone) return items;

  const room = (dir: "row" | "column") => !full && roomToSplit(tab.focus, dir);
  items.push({
    id: "splitRight",
    label: t("panes.splitRight"),
    disabled: !room("row"),
    onSelect: () => usePanes.getState().split("row", serverId, channelId),
  });
  items.push({
    id: "splitDown",
    label: t("panes.splitDown"),
    disabled: !room("column"),
    onSelect: () => usePanes.getState().split("column", serverId, channelId),
    separatorAfter: true,
  });
  return items;
}
