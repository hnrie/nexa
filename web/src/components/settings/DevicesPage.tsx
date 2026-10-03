import { Monitor, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState } from "react";
import { auth as authApi } from "@/api/auth";
import type { Session } from "@/api/types";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { describeDevice, type DeviceKind } from "@/lib/deviceLabel";
import { describeError } from "@/lib/errors";
import { formatDateDivider, formatRelative } from "@/lib/time";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
const KIND_ICON: Record<DeviceKind, typeof Monitor> = { phone: Smartphone, tablet: Tablet, computer: Monitor, unknown: MonitorSmartphone };

export default function DevicesPage() {
  const [list, setList] = useState<Session[] | null>(null);
  // A failed fetch left a blank area with no text in it at all — no list, no
  // spinner, nothing to say that the devices signed into this account were
  // never read.
  const [failed, setFailed] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const toast = useUI((u) => u.toast);
  const load = () =>
    authApi.sessions().then(
      (sessions) => {
        setList(sessions);
        setFailed(false);
      },
      () => {
        setList(null);
        setFailed(true);
      },
    );
  useEffect(() => {
    void load();
  }, []);
  const drop = async (id: string) => {
    try {
      await authApi.deleteSession(id);
      await load();
    } catch (err) {
      toast(describeError(err, t("settings.devices.couldNotLogThatDeviceOut")), "error");
    }
  };
  // Logging out one of nine used to look exactly like logging out all nine, so
  // the count that failed is said out loud.
  const dropOthers = async () => {
    setSweeping(true);
    let failures = 0;
    try {
      for (const se of list ?? []) {
        if (se.current) continue;
        await authApi.deleteSession(se.id).catch(() => {
          failures += 1;
        });
      }
      await load();
      if (failures > 0) toast(t("settings.devices.someDevicesCouldNotBeLogged", { count: failures }), "error");
      else toast(t("settings.devices.everyOtherDeviceIsSignedOut"), "success");
    } finally {
      setSweeping(false);
    }
  };
  const others = list?.filter((se) => !se.current).length ?? 0;
  // this device first, then the rest by when they were last used
  const sorted = list ? [...list].sort((a, b) => Number(b.current) - Number(a.current) || b.last_seen_at - a.last_seen_at) : null;
  const confirmSweep = () =>
    useUI.getState().openModal("confirm", {
      title: t("settings.devices.logOutAllOtherDevices"),
      body: t("settings.devices.everyOtherDeviceCountWillHave", { count: others }),
      confirmLabel: t("settings.devices.logThemOut"),
      danger: true,
      onConfirm: () => dropOthers(),
    });
  return (
    <>
      <h2 data-setting="sessions" className={s.title}>{t("settings.devices.devices")}</h2>
      <p className={s.hint}>{t("settings.devices.everyDeviceThatIsLoggedInto")}</p>
      {/* The one action that needs no device to be recognised comes first: it
          used to wait under every row, out of sight once there were a few. */}
      {others > 0 ? (
        <div className={s.dangerBox} style={{ marginTop: 16 }} data-testid="devices-sweep">
          <span className={s.hint} style={{ margin: 0 }}>{t("settings.devices.otherDevicesCount", { count: others })}</span>
          <Button variant="danger" size="sm" loading={sweeping} onClick={confirmSweep}>{t("settings.devices.logOutAllOtherDevices")}</Button>
        </div>
      ) : null}
      <div style={{ marginTop: 16 }}>
        {list === null && !failed ? <p className={s.hint}>{t("chat.pins.loading")}</p> : null}
        {failed ? <LoadError message={t("settings.devices.yourDevicesCouldNotBeLoaded")} onRetry={() => void load()} /> : null}
        {sorted?.map((se) => {
          const device = describeDevice(se.user_agent);
          const Icon = KIND_ICON[device.kind];
          return (
            <div key={se.id} className={s.device} data-current={se.current || undefined}>
              <div className={s.deviceMain}>
                <span className={s.deviceIcon} data-kind={device.kind} aria-hidden="true"><Icon size={20} /></span>
                <div className={s.deviceText}>
                  <div className={s.deviceName}>
                    {device.label}
                    {se.current ? <span className={s.thisDevice}>{t("settings.devices.thisDevice")}</span> : null}
                  </div>
                  <div className={s.deviceSub}>
                    {se.ip} · {t("settings.devices.signedIn", { date: formatDateDivider(se.created_at) })} · {se.current ? t("settings.devices.activeNow") : t("settings.devices.lastActive", { when: formatRelative(se.last_seen_at) })}
                  </div>
                </div>
              </div>
              {!se.current ? <Button size="sm" variant="secondary" onClick={() => void drop(se.id)}>{t("settings.devices.logOut")}</Button> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
