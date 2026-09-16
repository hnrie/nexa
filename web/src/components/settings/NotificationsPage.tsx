import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import { desktopBridge } from "@/lib/desktopBridge";
import { showNotification } from "@/lib/notify";
import { playSound, soundTrouble, type SoundName } from "@/lib/sounds";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
export default function NotificationsPage() {
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const toast = useUI((x) => x.toast);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [soundHint, setSoundHint] = useState<string | null>(null);
  // the desktop app has its own switch, on until turned off, and never needs to ask
  const inApp = !!desktopBridge();
  const enable = async (v: boolean) => {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return;
    }
    patch({ notifications: { ...st.notifications, ...(inApp ? { app: v } : { desktop: v }) } });
  };
  // a sound that will not start says why, since a silent button tells nobody anything
  const testSound = async (name: SoundName) => {
    setSoundHint((await playSound(name)) ? null : soundTrouble());
  };
  const testNotification = async () => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      toast("Turn on desktop notifications first.", "error");
      return;
    }
    if (!(await showNotification("nexa", { body: "Notifications are working." }))) toast("This browser would not show the notification.", "error");
  };
  return (
    <>
      <h2 className={s.title}>{t("settings.notifications.notifications")}</h2>
      {inApp ? (
        <Toggle checked={st.notifications.app !== false} onChange={(v) => void enable(v)} label={t("settings.notifications.enableDesktopNotifications")} description={t("settings.notifications.getANotificationForNewMessages")} />
      ) : (
        <Toggle checked={st.notifications.desktop && perm === "granted"} disabled={perm === "unsupported" || perm === "denied"} onChange={(v) => void enable(v)} label={t("settings.notifications.enableDesktopNotifications")} description={perm === "denied" ? "Notifications are blocked for this site in your browser settings." : perm === "unsupported" ? "This browser does not support notifications." : "Get a notification for new messages while this tab is open, unless you are in Do Not Disturb."} />
      )}
      <Toggle checked={st.notifications.sounds} onChange={(v) => patch({ notifications: { ...st.notifications, sounds: v } })} label={t("settings.notifications.sounds")} description={t("settings.notifications.playASoundForNewMessages")} />
      <h3 className={s.h5}>{t("settings.notifications.test")}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="secondary" onClick={() => void testSound("message")}>{t("profile.profileCard.message")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("mention")}>{t("settings.notifications.mention")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("friend")}>{t("settings.notifications.friendRequest")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("ring")}>{t("settings.notifications.incomingCall")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("outgoing")}>{t("settings.notifications.outgoingCall")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("leave")}>{t("settings.notifications.leaveCall")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("mute")}>{t("settings.notifications.mute")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testSound("unmute")}>{t("settings.notifications.unmute")}</Button>
        <Button size="sm" variant="secondary" onClick={() => void testNotification()}>{t("settings.notifications.desktopNotification")}</Button>
      </div>
      {soundHint ? (
        <p className={s.hint} style={{ marginTop: 12 }} role="status" data-testid="sound-trouble">
          {soundHint}
        </p>
      ) : null}
    </>
  );
}
