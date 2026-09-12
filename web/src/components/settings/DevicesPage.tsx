import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { auth as authApi } from "@/api/auth";
import type { Session } from "@/api/types";
import { Button } from "@/components/common/Button";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

function describe(ua: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default function DevicesPage() {
  const [list, setList] = useState<Session[] | null>(null);
  const toast = useUI((u) => u.toast);
  const load = () => authApi.sessions().then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []);
  const drop = async (id: string) => {
    try {
      await authApi.deleteSession(id);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not log that device out.", "error");
    }
  };
  const dropOthers = async () => {
    for (const se of list ?? []) if (!se.current) await authApi.deleteSession(se.id).catch(() => undefined);
    await load();
  };
  return (
    <>
      <h2 className={s.title}>Devices</h2>
      <p className={s.hint}>Every device that is logged into your account. Logging one out removes its session immediately; it will need your password again.</p>
      <div style={{ marginTop: 16 }}>
        {list === null ? <p className={s.hint}>Loading…</p> : null}
        {list?.map((se) => (
          <div key={se.id} className={s.device}>
            <div>
              <div className={s.deviceName}>{describe(se.user_agent)}{se.current ? " · This device" : ""}</div>
              <div className={s.deviceSub}>{se.ip} · last active {new Date(se.last_seen_at).toLocaleString()}</div>
            </div>
            {!se.current ? <Button size="sm" variant="secondary" onClick={() => void drop(se.id)}>Log out</Button> : null}
          </div>
        ))}
      </div>
      {list && list.some((se) => !se.current) ? <Button variant="danger" onClick={() => void dropOthers()}>Log out all other devices</Button> : null}
    </>
  );
}
