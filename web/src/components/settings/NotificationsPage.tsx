import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import { desktopBridge } from "@/lib/desktopBridge";
import { showNotification } from "@/lib/notify";
import { playSound, soundTrouble, type SoundName } from "@/lib/sounds";
import { useSettings, type NotificationPreview } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";

function previewChoices(): { value: NotificationPreview; label: string; desc: string }[] {
  return [
    { value: "full", label: t("settings.notifications.previewFull"), desc: t("settings.notifications.previewFullHint") },
    { value: "name", label: t("settings.notifications.previewName"), desc: t("settings.notifications.previewNameHint") },
    { value: "none", label: t("settings.notifications.previewNone"), desc: t("settings.notifications.previewNoneHint") },
  ];
}

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
      toast(t("settings.notifications.turnOnDesktopNotificationsFirst"), "error");
      return;
    }
    if (!(await showNotification("Nexa", { body: t("settings.notifications.notificationsAreWorking") }))) toast(t("settings.notifications.thisBrowserWouldNotShowThe"), "error");
  };
  return (
    <>
      <h2 className={s.title}>{t("settings.notifications.notifications")}</h2>
      {inApp ? (
        <Toggle checked={st.notifications.app !== false} onChange={(v) => void enable(v)} label={t("settings.notifications.enableDesktopNotifications")} description={t("settings.notifications.getANotificationForNewMessages")} />
      ) : (
        <Toggle checked={st.notifications.desktop && perm === "granted"} disabled={perm === "unsupported" || perm === "denied"} onChange={(v) => void enable(v)} label={t("settings.notifications.enableDesktopNotifications")} description={perm === "denied" ? t("settings.notifications.notificationsAreBlocked") : perm === "unsupported" ? t("settings.notifications.thisBrowserDoesNotSupport") : t("settings.notifications.getANotificationWhileThisTabIsOpen")} />
      )}
      <Toggle checked={st.notifications.sounds} onChange={(v) => patch({ notifications: { ...st.notifications, sounds: v } })} label={t("settings.notifications.sounds")} description={t("settings.notifications.playASoundForNewMessages")} />
      <h3 className={s.h5}>{t("settings.notifications.previewHeading")}</h3>
      <p className={s.hint}>{t("settings.notifications.previewIntro")}</p>
      {previewChoices().map((o) => (
        <label key={o.value} className={s.radio} data-on={(st.notifications.preview ?? "full") === o.value}>
          <input type="radio" name="notification-preview" checked={(st.notifications.preview ?? "full") === o.value} onChange={() => patch({ notifications: { ...st.notifications, preview: o.value } })} data-testid={`notification-preview-${o.value}`} />
          <span className={s.radioText}><span className={s.radioLabel}>{o.label}</span><span className={s.radioDesc}>{o.desc}</span></span>
        </label>
      ))}
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
