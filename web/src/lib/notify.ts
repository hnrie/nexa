import type { Message, Relationship } from "@/api/types";
import { avatarUrl } from "@/api/users";
import { dispatchHooks } from "@/gateway/dispatch";
import { channelDisplayName } from "@/lib/names";
import { parse, plainText } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { usePresence } from "@/stores/presence";
import { useSettings, type Settings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { desktopBridge } from "./desktopBridge";
import { installAudioUnlock, playSound, preloadSounds } from "./sounds";

let navigateTo: ((path: string) => void) | null = null;

/** The router's navigate function, supplied by the shell. */
export function setNotificationNavigator(fn: ((path: string) => void) | null): void {
  navigateTo = fn;
}

/**
 * Whether new messages show a notification. The desktop app shows them
 * unless they were turned off there; a browser only once the person has
 * allowed them, which the settings page asks for.
 */
export function notificationsEnabled(settings: Settings): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  return desktopBridge() ? settings.notifications.app !== false : settings.notifications.desktop;
}

/**
 * Shows a notification the way this browser allows. Chrome on Android and
 * iOS home-screen apps refuse the Notification constructor and only take one
 * through the service worker, which then hands the click back (see sw.ts).
 * The desktop app shows them natively through the constructor, and a click
 * brings its window back even from the tray. Resolves false when neither way
 * works.
 */
export async function showNotification(title: string, opts: NotificationOptions, path?: string): Promise<boolean> {
  const bridge = desktopBridge();
  if (!bridge) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/");
      if (reg?.active) {
        await reg.showNotification(title, { ...opts, data: { path } });
        return true;
      }
    } catch {
      /* no usable worker: try the constructor */
    }
  }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      // window.focus() cannot bring the app's window back from the tray or a minimised taskbar button
      if (bridge?.focusWindow) bridge.focusWindow();
      else window.focus();
      if (path) navigateTo?.(path);
      n.close();
    };
    // the desktop app also asks for attention the way its system does, until the window is looked at
    bridge?.requestAttention?.();
    return true;
  } catch {
    return false;
  }
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
  if (!notificationsEnabled(settings)) return;
  const users = useUsers.getState().byId;
  const ch = useChannels.getState().byId[m.channel_id];
  const author = displayName(users[m.author_id]);
  const title = ch && ch.type === "group_dm" ? `${author} (${channelDisplayName(ch, users, me.id)})` : ch && ch.server_id ? `${author} (#${ch.name})` : author;
  const path = ch?.server_id ? `/channels/${ch.server_id}/${m.channel_id}` : `/channels/@me/${m.channel_id}`;
  void showNotification(title, { body: previewOf(m), tag: `ec-${m.channel_id}`, icon: avatarUrl(users[m.author_id]?.avatar_id ?? null, 96) ?? "/icons/icon-192.png", silent: true }, path);
}

/** A new friend request plays its own sound, and notifies while the app is not being looked at. */
function onFriendRequest(r: Relationship): void {
  const me = useAuth.getState().me;
  if (!me || usePresence.getState().byUser[me.id]?.status === "dnd") return;
  const settings = useSettings.getState().settings;
  if (settings.notifications.sounds) playSound("friend");
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  if (!notificationsEnabled(settings)) return;
  void showNotification("Friend Request", { body: `${displayName(r.user)} sent you a friend request.`, tag: `ec-friend-${r.user.id}`, icon: avatarUrl(r.user.avatar_id ?? null, 96) ?? "/icons/icon-192.png", silent: true }, "/channels/@me");
}

let installed = false;
export function installNotifications(): void {
  if (installed) return;
  installed = true;
  dispatchHooks.onMessage.push(onMessage);
  dispatchHooks.onFriendRequest.push(onFriendRequest);
  // a phone can only play sounds once a tap has let the page make noise
  installAudioUnlock();
  // the recorded sounds come down once the app has settled, so the first message is not late
  setTimeout(() => preloadSounds(), 4000);
  // a notification shown by the service worker is clicked there, which sends the chat to open back here
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: unknown; path?: unknown } | null;
    if (d?.type === "notification-open" && typeof d.path === "string" && d.path.startsWith("/")) navigateTo?.(d.path);
  });
}
