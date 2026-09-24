import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";

/** Whether menus offer the Copy … ID items (Settings → Privacy → Developer Mode). */
export function developerMode(): boolean {
  return useSettings.getState().settings.developerMode;
}

/** A menu item that puts an ID on the clipboard and says so. */
export function copyIdItem(key: string, label: string, id: string): ContextMenuItem {
  return {
    id: key,
    label,
    onSelect: () => void navigator.clipboard?.writeText(id).then(() => useUI.getState().toast(t("chat.groupMemberMenu.copied"), "success"), () => undefined),
  };
}

/** Adds `extra` to the end of a menu, set apart from what came before. */
export function appendSection(items: ContextMenuItem[], extra: ContextMenuItem[]): ContextMenuItem[] {
  if (!extra.length) return items;
  const last = items[items.length - 1];
  if (last) items[items.length - 1] = { ...last, separatorAfter: true };
  items.push(...extra);
  return items;
}
