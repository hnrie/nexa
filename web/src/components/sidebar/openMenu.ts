import { button, type MenuButton } from "@/lib/contextMenus/registry";
import { useTabs } from "@/stores/tabs";
import { t } from "@/i18n";
import { sheetsHere } from "@/lib/sheetDrag";

/**
 * "Open in new tab", which every channel, conversation and subchat offers,
 * wherever it is listed. The tab opens behind the one in use, as a link opened
 * in a new tab does in a browser. `id` names the button in the menu it is in;
 * `where` says what it opens, or null where it does not apply. Not offered in
 * the phone layout, as the Android app has no tabs.
 */
export function openInTabButton<C>(id: string, where: (ctx: C) => { serverId: string | null; channelId: string } | null): MenuButton<C> {
  return button(id, (ctx) => {
    const w = sheetsHere() ? null : where(ctx);
    return w && { id: "newTab", label: t("panes.openInNewTab"), onSelect: () => useTabs.getState().openTab(w.serverId, w.channelId, { background: true }) };
  });
}
