import { useEffect, useState } from "react";
import { admin as adminApi } from "@/api/admin";
import { ApiError } from "@/api/client";
import type { AdminSettings, AdminStats, AdminUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { formatBytes, formatFull } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import st from "./Settings.module.css";
import s from "@/components/server/ServerSettings.module.css";

/** User settings → Instance Admin (admins only): stats, registration policy, users. */
export default function AdminPage() {
  const meId = useAuth((a) => a.me?.id);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [key, setKey] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    adminApi.stats().then(setStats).catch(() => setStats(null));
    adminApi.settings().then(setSettings).catch(() => setSettings(null));
  }, []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      adminApi
        .users(q)
        .then((list) => alive && setUsers(list))
        .catch(() => alive && setUsers([]));
    }, q ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const setMode = async (mode: AdminSettings["registration"]) => {
    const before = settings;
    setSettings((cur) => (cur ? { ...cur, registration: mode } : cur)); // optimistic: the radio moves at once
    try {
      setSettings(await adminApi.patchSettings({ registration: mode }));
    } catch (err) {
      setSettings(before);
      toast(err instanceof ApiError ? err.message : "Could not change the policy.", "error");
    }
  };
  const saveKey = async () => {
    try {
      setSettings(await adminApi.patchSettings({ registration_key: key }));
      setKey("");
      toast("Registration key saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the key.", "error");
    }
  };
  const patchUser = async (u: AdminUser, body: { disabled?: boolean; admin?: boolean }) => {
    setBusy(u.id);
    try {
      const updated = await adminApi.patchUser(u.id, body);
      setUsers((cur) => cur?.map((x) => (x.id === u.id ? updated : x)) ?? null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update the user.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className={st.title}>Instance Admin</h2>
      <p className={st.hint}>You run this instance. These settings apply to everyone on it.</p>
      <h5 className={st.h5}>Overview</h5>
      {stats ? (
        <div className={st.rows} style={{ margin: 0 }}>
          <div className={st.row}><span className={st.rowLabel}>Users</span><span className={st.rowValue}>{stats.users} ({stats.online} online)</span></div>
          <div className={st.row}><span className={st.rowLabel}>Servers</span><span className={st.rowValue}>{stats.servers}</span></div>
          <div className={st.row}><span className={st.rowLabel}>Messages</span><span className={st.rowValue}>{stats.messages}</span></div>
          <div className={st.row}><span className={st.rowLabel}>Stored files</span><span className={st.rowValue}>{stats.blobs} · {formatBytes(stats.blob_bytes)}</span></div>
          <div className={st.row}><span className={st.rowLabel}>Version</span><span className={st.rowValue}>{stats.version}</span></div>
        </div>
      ) : <Spinner />}
      <h5 className={st.h5}>Registration</h5>
      {settings ? (
        <>
          {(["open", "invite", "closed"] as const).map((m) => (
            <label key={m} className={st.radio} data-on={settings.registration === m}>
              <input type="radio" checked={settings.registration === m} onChange={() => void setMode(m)} />
              <span className={st.radioText}>
                <span className={st.radioLabel}>{m === "open" ? "Open" : m === "invite" ? "Invite only" : "Closed"}</span>
                <span className={st.radioDesc}>{m === "open" ? "Anyone can create an account." : m === "invite" ? "New accounts need a server invite link or the registration key." : "No new accounts."}</span>
              </span>
            </label>
          ))}
          <p className={st.hint}>The config file says "{settings.config_registration}"; what you pick here overrides it until you clear it.</p>
          <Field label={`Registration key ${settings.registration_key_set ? "(set)" : "(not set)"}`} hint="Share this with people you want to let in while registration is invite-only.">
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="New key" maxLength={128} />
              <Button size="sm" onClick={() => void saveKey()}>Save</Button>
              {settings.registration_key_set ? <Button size="sm" variant="ghost" onClick={() => void adminApi.patchSettings({ registration_key: "" }).then(setSettings)}>Clear</Button> : null}
            </div>
          </Field>
          <p className={st.hint} style={{ marginTop: 12 }}>Limits from the config: uploads {formatBytes(settings.max_upload_bytes)}, avatars {formatBytes(settings.max_avatar_bytes)}, emoji {formatBytes(settings.max_emoji_bytes)}, stickers {formatBytes(settings.max_sticker_bytes)}. GIF search {settings.tenor ? "on" : "off"}, TURN {settings.turn ? "configured" : "not configured"}. Change these in chatd.env and restart.</p>
        </>
      ) : <Spinner />}
      <h5 className={st.h5}>Users</h5>
      <div className={s.searchRow}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or display name" />
      </div>
      {users === null ? <Spinner /> : null}
      {users?.map((u) => (
        <div key={u.id} className={s.memberRow}>
          <Avatar id={u.id} avatarId={null} name={u.display_name} size={36} />
          <div className={s.memberText}>
            <span className={s.memberName}>{u.display_name}{u.admin ? <span style={{ fontSize: 11, color: "var(--text-brand)" }}>ADMIN</span> : null}{u.disabled ? <span style={{ fontSize: 11, color: "var(--danger)" }}>DISABLED</span> : null}</span>
            <span className={s.memberSub}>@{u.username} · joined {formatFull(u.created_at)}</span>
          </div>
          {u.id !== meId ? (
            <div style={{ display: "flex", gap: 6 }}>
              <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => void patchUser(u, { admin: !u.admin })}>{u.admin ? "Remove admin" : "Make admin"}</Button>
              <Button size="sm" variant={u.disabled ? "positive" : "danger"} disabled={busy === u.id} onClick={() => (u.disabled ? void patchUser(u, { disabled: false }) : openModal("confirm", { title: `Disable @${u.username}`, body: "They are logged out everywhere and cannot log in until re-enabled. Their messages stay.", confirmLabel: "Disable", danger: true, onConfirm: () => patchUser(u, { disabled: true }) }))}>{u.disabled ? "Enable" : "Disable"}</Button>
            </div>
          ) : <span className={s.memberSub}>you</span>}
        </div>
      ))}
    </>
  );
}
