import { personText } from "@/lib/personText";
/**
 * The system notifications of an incoming call: "Incoming call" for someone
 * away from the app (a background tab, a minimised window, a phone in a
 * pocket), taken down the moment the call is answered, declined or silenced on
 * any of this account's devices, and "Missed call" in its place when the call
 * ends with nobody here picking up. The ring itself plays in the app. Nothing
 * of this is kept anywhere but on this device.
 */
import { avatarUrl } from "@/api/users";
import { doNotDisturb } from "@/lib/dnd";
import { channelDisplayName } from "@/lib/names";
import { appOnScreen, closeNotifications, notificationsEnabled, showNotification } from "@/lib/notify";
import { roundAvatar } from "@/lib/roundIcon";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";

import { t } from "@/i18n";

const tagOf = (channelId: string) => `ec-call-${channelId}`;

/** A group's name, for a call in one; null for a DM, where the caller's name says it all. */
function groupName(channelId: string): string | null {
  const ch = useChannels.getState().byId[channelId];
  if (ch?.type !== "group_dm") return null;
  return channelDisplayName(ch, useUsers.getState().byId, useAuth.getState().me?.id);
}

function notify(channelId: string, from: string, body: string, ringing: boolean): void {
  if (doNotDisturb() || !notificationsEnabled(useSettings.getState().settings)) return;
  const caller = useUsers.getState().byId[from];
  // A ringing call stays up until it is dealt with, as a phone's does; the
  // app plays the ring itself, so the notification makes no sound of its own.
  const name = displayName(caller);
  void roundAvatar({ id: from, name, url: avatarUrl(caller?.avatar_id ?? null, 96) }, "/icons/icon-192.png").then((icon) =>
    showNotification(name, { body, tag: tagOf(channelId), icon, requireInteraction: ringing, silent: true }, `/channels/@me/${channelId}`),
  );
}

/** A call is ringing here: a notification for someone who is not looking at the app. */
export function ringNotice(channelId: string, from: string): void {
  if (appOnScreen()) return;
  const group = groupName(channelId);
  notify(channelId, from, group ? t("voice.incomingCall.inGroup", { name: group }) : t("voice.incomingCall.incomingCall"), true);
}

/** The call was answered, declined or silenced: its notification goes. */
export function closeRingNotice(channelId: string): void {
  void closeNotifications(tagOf(channelId));
}

/**
 * A call rang here and ended with nobody on this account picking up. Someone
 * looking at the app saw the ringing go away, and is told why; someone away
 * finds "Missed call" where the ringing notification was.
 */
export function missedNotice(channelId: string, from: string): void {
  if (appOnScreen()) {
    closeRingNotice(channelId);
    useUI.getState().toast(personText("voice.callLine.missedFrom", from, displayName(useUsers.getState().byId[from])), "info");
    return;
  }
  const group = groupName(channelId);
  notify(channelId, from, group ? t("voice.callNotice.missedInGroup", { name: group }) : t("voice.callNotice.missedCall"), false);
}
