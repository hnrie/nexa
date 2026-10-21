import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { copyAndSay } from "@/lib/copyText";
import { t } from "@/i18n";

/** Whether menus offer the Copy … ID items (Settings → Privacy → Developer Mode). */
export function developerMode(): boolean {
  return useSettings.getState().settings.developerMode;
}

/**
 * What a bot's id adds to a Nexa id: the time between the two epochs, in an
 * id's millisecond bits (internal/botproto). Bots see every id this way, so a
 * person pasting one into a bot command needs it too.
 */
const BOT_ID_OFFSET = (1767225600000n - 1420070400000n) << 22n;

/** The id a bot knows someone or something by. */
export function botId(id: string): string {
  return (BigInt(id) + BOT_ID_OFFSET).toString();
}

/** A menu item that copies the id bots know a person by, for pasting into an app's commands. */
export function copyBotIdItem(userId: string): ContextMenuItem {
  return {
    id: "copy-bot",
    label: t("copyId.forBots"),
    onSelect: () => copyAndSay(botId(userId), t("copyId.forBotsCopied")),
  };
}

/** A menu item that puts an ID on the clipboard and says so. */
export function copyIdItem(key: string, label: string, id: string): ContextMenuItem {
  return {
    id: key,
    label,
    onSelect: () => copyAndSay(id),
  };
}
