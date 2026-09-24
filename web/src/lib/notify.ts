import type { Message, Relationship } from "@/api/types";
import { avatarUrl } from "@/api/users";
import { dispatchHooks, type NexaAlert } from "@/gateway/dispatch";
import { noticeTitle } from "@/lib/moderation";
import { channelDisplayName } from "@/lib/names";
import { parse, plainText } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useDesktop } from "@/stores/desktop";
import { useMessages, type DecryptedMessage } from "@/stores/messages";
import { useSettings, type Settings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { desktopBridge } from "./desktopBridge";
import { doNotDisturb } from "./dnd";
import { installAudioUnlock, playSound, preloadSounds } from "./sounds";

import { t } from "@/i18n";
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

/**
 * Whether the app is in front of the person: its window (or tab) focused and
 * showing. The browser is asked rather than a stored flag, because a window
 * can regain focus without firing the event that flag listens for.
 */
export function appOnScreen(): boolean {
  // the desktop app says where its window is; inside it the page is never hidden, and its focus reading was seen to stay true
  const w = useDesktop.getState().window;
  if (w) return w.focused && w.visible && !w.minimized;
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

/**
 * What a new message does: nothing in the conversation being looked at, a
 * sound anywhere else, and a notification whenever the app is not in front of
 * the person (unfocused, minimised, in the tray, a background tab). While it
 * is in front of them the unread badge and the sound are enough.
 */
export function messageAlert(onScreen: boolean, viewingChannel: boolean): { sound: boolean; popup: boolean } {
  if (onScreen && viewingChannel) return { sound: false, popup: false };
  return { sound: true, popup: !onScreen };
}

function previewOf(m: Message, decrypted?: DecryptedMessage): string {
  // The decrypted copy is handed in because the store may not have it: a list
  // jumped back into history refuses messages past its end, and reading it
  // back gave every one of them a notification saying only "New message".
  const stored = decrypted ?? useMessages.getState().channels[m.channel_id]?.byId[m.id];
  const p = stored?.payload;
  if (!p) return stored?.decryptError ? t("chat.messageItem.encryptedMessage") : t("notify.newMessage");
  if (p.t) return plainText(parse(p.t, { inline: true })).slice(0, 140);
  if (p.att?.length) return p.att.length === 1 ? t("notify.sentFile", { name: p.att[0]!.name }) : t("notify.sentFiles", { count: p.att.length });
  if (p.sticker) return t("notify.sentASticker");
  return t("notify.newMessage");
}

function onMessage(m: Message, mine: boolean, decrypted?: DecryptedMessage): void {
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
  const alert = messageAlert(appOnScreen(), ui.activeChannelId === m.channel_id);
  if (!alert.sound && !alert.popup) return;
  if (doNotDisturb()) return;
  if (alert.sound && settings.notifications.sounds) playSound(mentioned ? "mention" : "message");
  if (!alert.popup || !notificationsEnabled(settings)) return;
  const users = useUsers.getState().byId;
  const ch = useChannels.getState().byId[m.channel_id];
  const author = displayName(users[m.author_id]);
  const title = ch && ch.type === "group_dm" ? `${author} (${channelDisplayName(ch, users, me.id)})` : ch && ch.server_id ? `${author} (#${ch.name})` : author;
  const path = ch?.server_id ? `/channels/${ch.server_id}/${m.channel_id}` : `/channels/@me/${m.channel_id}`;
  void showNotification(title, { body: previewOf(m, decrypted), tag: `ec-${m.channel_id}`, icon: avatarUrl(users[m.author_id]?.avatar_id ?? null, 96) ?? "/icons/icon-192.png", silent: true }, path);
}

/** A new friend request plays its own sound, and notifies while the app is not being looked at. */
function onFriendRequest(r: Relationship): void {
  const me = useAuth.getState().me;
  if (!me || doNotDisturb()) return;
  const settings = useSettings.getState().settings;
  if (settings.notifications.sounds) playSound("friend");
  if (appOnScreen()) return;
  if (!notificationsEnabled(settings)) return;
  void showNotification(t("notify.friendRequest"), { body: t("notify.sentYouAFriendRequest", { name: displayName(r.user) }), tag: `ec-friend-${r.user.id}`, icon: avatarUrl(r.user.avatar_id ?? null, 96) ?? "/icons/icon-192.png", silent: true }, "/channels/@me");
}

/**
 * Something new from Nexa: a notice about this account, a staff reply in one
 * of its cases, an announcement — or, for staff, a member writing in a case.
 * It sounds like a message and notifies like one, and stays quiet the same
 * ways: sounds off, Do Not Disturb, or already looking at it.
 */
function onNexa(a: NexaAlert): void {
  const me = useAuth.getState().me;
  if (!me || doNotDisturb()) return;
  const path =
    a.kind === "appeal" ? `/channels/@admin/cases/${a.caseId}` : a.kind === "announcement" ? "/channels/@me/nexa" : a.kind === "reply" ? `/channels/@me/nexa/cases/${a.case.id}` : "/channels/@me/nexa";
  const onScreen = appOnScreen();
  const viewing = typeof location !== "undefined" && (location.pathname === path || (a.kind === "appeal" && location.pathname.endsWith(`/cases/${a.caseId}`)));
  if (onScreen && viewing) return;
  const settings = useSettings.getState().settings;
  if (settings.notifications.sounds) void playSound(a.kind === "notice" ? "mention" : "message");
  if (onScreen || !notificationsEnabled(settings)) return;
  const title = a.kind === "appeal" ? t("nexa.notify.appealTitle") : "Nexa";
  const body =
    a.kind === "notice"
      ? noticeTitle(a.case.action, a.case.details)
      : a.kind === "reply"
        ? t("nexa.notify.reply", { number: a.case.number })
        : a.kind === "announcement"
          ? a.announcement.title || plainText(parse(a.announcement.body, { inline: true })).slice(0, 140)
          : t("nexa.notify.appeal");
  const tag = a.kind === "appeal" ? `ec-appeal-${a.caseId}` : a.kind === "announcement" ? `ec-nexa-a-${a.announcement.id}` : `ec-nexa-${a.case.id}`;
  void showNotification(title, { body, tag, icon: "/icons/icon-192.png", silent: true }, path);
}

let installed = false;
export function installNotifications(): void {
  if (installed) return;
  installed = true;
  dispatchHooks.onMessage.push(onMessage);
  dispatchHooks.onFriendRequest.push(onFriendRequest);
  dispatchHooks.onNexa.push(onNexa);
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
