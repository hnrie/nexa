import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { copyAndSay } from "@/lib/copyText";

/** Whether menus offer the Copy … ID items (Settings → Privacy → Developer Mode). */
export function developerMode(): boolean {
  return useSettings.getState().settings.developerMode;
}

/** A menu item that puts an ID on the clipboard and says so. */
export function copyIdItem(key: string, label: string, id: string): ContextMenuItem {
  return {
    id: key,
    label,
    onSelect: () => copyAndSay(id),
  };
}
