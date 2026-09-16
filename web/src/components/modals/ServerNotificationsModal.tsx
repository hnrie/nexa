import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Toggle } from "@/components/common/Toggle";
import { useServers } from "@/stores/servers";
import { useSettings, type NotificationLevel } from "@/stores/settings";
import s from "./ServerModals.module.css";

import { t } from "@/i18n";
const LEVELS: { v: NotificationLevel; label: string; desc: string }[] = [
  { v: "all", label: "All Messages", desc: "Every message in this server notifies you." },
  { v: "mentions", label: "Only @mentions", desc: "Only messages that mention you notify you." },
  { v: "none", label: "Nothing", desc: "No notifications from this server, but unread markers still show." },
];

export function ServerNotificationsModal({ onClose, serverId }: { onClose: () => void; serverId: string }) {
  const st = useServers((x) => x.byId[serverId]);
  const settings = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const muted = settings.notifications.muted.includes(serverId);
  const level = settings.notifications.perChannel[serverId] ?? "all";
  const setMuted = (v: boolean) => patch({ notifications: { ...settings.notifications, muted: v ? [...settings.notifications.muted, serverId] : settings.notifications.muted.filter((x) => x !== serverId) } });
  const setLevel = (v: NotificationLevel) => patch({ notifications: { ...settings.notifications, perChannel: { ...settings.notifications.perChannel, [serverId]: v } } });
  return (
    <Modal open onClose={onClose} title={t("modals.serverNotifications.notificationSettings")} width={440} footer={<Button onClick={onClose}>{t("modals.serverNotifications.done")}</Button>}>
      <div className={s.form}>
        <p className={s.hint}>{st?.server.name}</p>
        <Toggle checked={muted} onChange={setMuted} label={`Mute ${st?.server.name ?? "server"}`} description={t("modals.serverNotifications.mutingAServerPreventsUnreadIndicators")} />
        <div className={s.sep} />
        <div className={s.radioList}>
          {LEVELS.map((l) => (
            <label key={l.v} className={s.radio} data-on={level === l.v}>
              <input type="radio" name="level" checked={level === l.v} onChange={() => setLevel(l.v)} />
              <span className={s.typeText}><span className={s.typeLabel}>{l.label}</span><span className={s.typeDesc}>{l.desc}</span></span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
