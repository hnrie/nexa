import type { Message } from "@/api/types";
import { avatarUrl } from "@/api/users";
import { dispatchHooks } from "@/gateway/dispatch";
import { channelDisplayName } from "@/lib/names";
import { parse, plainText } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { usePresence } from "@/stores/presence";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { playSound } from "./sounds";

let navigateTo: ((path: string) => void) | null = null;

/** The router's navigate function, supplied by the shell. */
export function setNotificationNavigator(fn: ((path: string) => void) | null): void {
  navigateTo = fn;
}

function previewOf(m: Message): string {
  const stored = useMessages.getState().channels[m.channel_id]?.byId[m.id];
  const p = stored?.payload;
  if (!p) return stored?.decryptError ? "Encrypted message" : "New message";
  if (p.t) return plainText(parse(p.t, { inline: true })).slice(0, 140);
  if (p.att?.length) return p.att.length === 1 ? `Sent ${p.att[0]!.name}` : `Sent ${p.att.length} files`;
  if (p.sticker) return "Sent a sticker";
  return "New message";
}

function onMessage(m: Message, mine: boolean): void {
  if (mine || m.type.startsWith("system_")) return;
  const me = useAuth.getState().me;
  if (!me) return;
  const settings = useSettings.getState().settings;
  const chan = useChannels.getState().byId[m.channel_id];
  const serverId = chan?.server_id ?? null;
  const level = settings.notifications.perChannel[m.channel_id] ?? (serverId ? settings.notifications.perChannel[serverId] : undefined) ?? (serverId ? "mentions" : "all");
  if (settings.notifications.muted.includes(m.channel_id) || (serverId && settings.notifications.muted.includes(serverId)) || level === "none") return;
  const mentioned = m.mention_everyone || m.mentions.includes(me.id);
  if (level === "mentions" && !mentioned) return;
  const ui = useUI.getState();
  // Ask the browser rather than trusting a stored flag: a window can regain
  // focus without firing the event we listen for, and a chat you are looking
  // at should never make a noise.
  const looking = ui.activeChannelId === m.channel_id && document.visibilityState === "visible" && document.hasFocus();
  if (looking) return;
  const myPresence = usePresence.getState().byUser[me.id];
  if (myPresence?.status === "dnd") return;
  if (settings.notifications.sounds) playSound(mentioned ? "mention" : "message");
  if (!settings.notifications.desktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const users = useUsers.getState().byId;
  const ch = useChannels.getState().byId[m.channel_id];
  const author = displayName(users[m.author_id]);
  const title = ch && ch.type === "group_dm" ? `${author} (${channelDisplayName(ch, users, me.id)})` : ch && ch.server_id ? `${author} (#${ch.name})` : author;
  try {
    const n = new Notification(title, { body: previewOf(m), tag: `ec-${m.channel_id}`, icon: avatarUrl(users[m.author_id]?.avatar_id ?? null) ?? "/icons/icon-192.png", silent: true });
    n.onclick = () => {
      window.focus();
      navigateTo?.(ch?.server_id ? `/channels/${ch.server_id}/${m.channel_id}` : `/channels/@me/${m.channel_id}`);
      n.close();
    };
  } catch {
    /* some browsers throw for constructor-based notifications; ignore */
  }
}

let installed = false;
export function installNotifications(): void {
  if (installed) return;
  installed = true;
  dispatchHooks.onMessage.push(onMessage);
}
