import { useEffect, useState } from "react";
import { auth as authApi } from "@/api/auth";
import type { Session } from "@/api/types";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { describeError } from "@/lib/errors";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
function describe(ua: string): string {
  if (!ua) return t("settings.devices.unknownDevice");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

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
      <h2 className={s.title}>{t("settings.devices.devices")}</h2>
      <p className={s.hint}>{t("settings.devices.everyDeviceThatIsLoggedInto")}</p>
      <div style={{ marginTop: 16 }}>
        {list === null && !failed ? <p className={s.hint}>{t("chat.pins.loading")}</p> : null}
        {failed ? <LoadError message={t("settings.devices.yourDevicesCouldNotBeLoaded")} onRetry={() => void load()} /> : null}
        {list?.map((se) => (
          <div key={se.id} className={s.device}>
            <div>
              <div className={s.deviceName}>{describe(se.user_agent)}{se.current ? ` · ${t("settings.devices.thisDevice")}` : ""}</div>
              <div className={s.deviceSub}>{se.ip} · {t("settings.devices.lastActive", { when: new Date(se.last_seen_at).toLocaleString() })}</div>
            </div>
            {!se.current ? <Button size="sm" variant="secondary" onClick={() => void drop(se.id)}>{t("settings.devices.logOut")}</Button> : null}
          </div>
        ))}
      </div>
      {others > 0 ? <Button variant="danger" loading={sweeping} onClick={confirmSweep}>{t("settings.devices.logOutAllOtherDevices")}</Button> : null}
    </>
  );
}
