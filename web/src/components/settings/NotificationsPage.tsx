import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import { showNotification } from "@/lib/notify";
import { playSound } from "@/lib/sounds";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

export default function NotificationsPage() {
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const toast = useUI((x) => x.toast);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const enable = async (v: boolean) => {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return;
    }
    patch({ notifications: { ...st.notifications, desktop: v } });
  };
  const testNotification = async () => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      toast("Turn on desktop notifications first.", "error");
      return;
    }
    if (!(await showNotification("Evilion Chat", { body: "Notifications are working." }))) toast("This browser would not show the notification.", "error");
  };
  return (
    <>
      <h2 className={s.title}>Notifications</h2>
      <Toggle checked={st.notifications.desktop && perm === "granted"} disabled={perm === "unsupported" || perm === "denied"} onChange={(v) => void enable(v)} label="Enable desktop notifications" description={perm === "denied" ? "Notifications are blocked for this site in your browser settings." : perm === "unsupported" ? "This browser does not support notifications." : "Get a notification for new messages while this tab is open, unless you are in Do Not Disturb."} />
      <Toggle checked={st.notifications.sounds} onChange={(v) => patch({ notifications: { ...st.notifications, sounds: v } })} label="Sounds" description="Play a sound for new messages, mentions and calls." />
      <h3 className={s.h5}>Test</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="secondary" onClick={() => playSound("message")}>Message</Button>
        <Button size="sm" variant="secondary" onClick={() => playSound("mention")}>Mention</Button>
        <Button size="sm" variant="secondary" onClick={() => playSound("ring")}>Call</Button>
        <Button size="sm" variant="secondary" onClick={() => void testNotification()}>Desktop notification</Button>
      </div>
    </>
  );
}
