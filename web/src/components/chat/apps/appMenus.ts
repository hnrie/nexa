import type { ContextMenuItem } from "@/stores/ui";
import { t } from "@/i18n";
import { commandName } from "@/lib/apps";
import type { DecryptedMessage } from "@/lib/decrypt";
import { copyFor, interact } from "@/lib/interactions";
import { MSG_FLAG_EPHEMERAL } from "@/api/types";
import { CMD_MESSAGE, CMD_USER, channelCommands, commandsOfType, useAppCommands } from "@/stores/appCommands";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { P } from "@/lib/perms";

/**
 * The Apps item of a message's and a person's menu: the commands apps made
 * for a message (a message command) or a person (a user command), in a
 * submenu, under each app's name. Chosen, the app is told what it was used
 * on; a message it could not read otherwise goes to it sealed to its bot, so
 * the app reads only the message it was asked about.
 */

/** Where apps' commands may be used: anywhere outside a server, and in a server with Use Application Commands. */
function mayUse(channelId: string): boolean {
  const ch = useChannels.getState().byId[channelId];
  if (!ch) return false;
  if (!ch.server_id) return true;
  return canI(useServers.getState().byId[ch.server_id], P.USE_APPLICATION_COMMANDS, channelId);
}

function appsItem(channelId: string, type: number, use: (appId: string, commandId: string) => void): ContextMenuItem | null {
  if (!mayUse(channelId)) return null;
  const list = channelCommands(channelId);
  // not known yet, or stale: asked for now, for the next time the menu opens
  void useAppCommands.getState().load(channelId);
  if (!list) return null;
  const entries = commandsOfType(list, type);
  if (!entries.length) return null;
  const submenu: ContextMenuItem[] = [];
  let lastApp = "";
  const apps = new Set(entries.map((e) => e.app.id));
  for (const { app, command } of entries) {
    if (apps.size > 1 && app.id !== lastApp) submenu.push({ id: `app${app.id}`, label: app.name, heading: true });
    lastApp = app.id;
    submenu.push({ id: `cmd${command.id}`, label: commandName(command), onSelect: () => use(app.id, command.id) });
  }
  return { id: "apps", label: t("apps.menu.apps"), submenu };
}

/** The Apps item of a message's menu. */
export function messageAppsItem(msg: DecryptedMessage): ContextMenuItem | null {
  if (msg.local || msg.flags & MSG_FLAG_EPHEMERAL || msg.type.startsWith("system_")) return null;
  return appsItem(msg.channel_id, CMD_MESSAGE, (appId, commandId) => {
    const go = () =>
      void copyFor(appId, msg).then((copy) =>
        interact({ type: 2, application_id: appId, channel_id: msg.channel_id, data: { id: commandId, target_id: msg.id }, ...(copy ? { copy } : {}) }),
      );
    // an app on the person's own account is not part of this conversation:
    // they say so before it is handed someone's message
    // (in a conversation with the app's own bot, the messages are already its)
    const list = channelCommands(msg.channel_id);
    const app = list?.applications.find((a) => a.id === appId);
    if (!app || app.installed.includes("guild") || list?.context === 1) return go();
    useUI.getState().openModal("confirm", {
      title: t("apps.shareMessage.title", { app: app.name }),
      body: t("apps.shareMessage.body", { app: app.name }),
      confirmLabel: t("apps.shareMessage.continue"),
      onConfirm: go,
    });
  });
}

/** The Apps item of a person's menu, used in a conversation. */
export function userAppsItem(channelId: string | null | undefined, userId: string): ContextMenuItem | null {
  if (!channelId) return null;
  return appsItem(channelId, CMD_USER, (appId, commandId) => void interact({ type: 2, application_id: appId, channel_id: channelId, data: { id: commandId, target_id: userId } }));
}
