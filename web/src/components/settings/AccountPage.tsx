import { useState } from "react";
import { ApiError } from "@/api/client";
import { bannerUrl, users as usersApi } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { usernameProblem } from "@/pages/AuthLayout";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

type Dialog = null | "username" | "displayName" | "password" | "recovery" | "delete";

export default function AccountPage({ onClose }: { onClose: () => void }) {
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const changePassword = useAuth((a) => a.changePassword);
  const newRecoveryKey = useAuth((a) => a.newRecoveryKey);
  const logout = useAuth((a) => a.logout);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [value, setValue] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  if (!me) return null;

  const open = (d: Dialog, initial = "") => {
    setDialog(d);
    setValue(initial);
    setPw("");
    setPw2("");
    setError(null);
    setRecovery(null);
  };
  const close = () => setDialog(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const saveName = (field: "username" | "display_name") =>
    run(async () => {
      const v = value.trim();
      if (field === "username") {
        const p = usernameProblem(v.toLowerCase());
        if (p) throw new Error(p);
      } else if (!v) throw new Error("Display name cannot be empty.");
      setMe(await usersApi.patchMe(field === "username" ? { username: v.toLowerCase() } : { display_name: v }));
      toast("Saved.", "success");
      close();
    });
  const banner = bannerUrl(me.banner_id, 600);

  return (
    <>
      <h2 className={s.title}>My Account</h2>
      <div className={s.card}>
        <div className={s.cardBanner} style={banner ? { backgroundImage: `url(${banner})` } : me.accent_color !== null ? { background: `#${me.accent_color.toString(16).padStart(6, "0")}` } : undefined} />
        <div className={s.cardHead}>
          <div className={s.cardAvatar}><Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={80} status="online" /></div>
          <div className={s.cardText}>
            <div className={s.cardName}>{me.display_name}</div>
            <div className={s.cardUser}>{me.username}</div>
          </div>
          <Button size="sm" onClick={() => { onClose(); openModal("settings", { page: "profiles" }); }}>Edit User Profile</Button>
        </div>
        <div className={s.rows}>
          <div className={s.row}>
            <div><div className={s.rowLabel}>Display Name</div><div className={s.rowValue}>{me.display_name}</div></div>
            <Button size="sm" variant="secondary" onClick={() => open("displayName", me.display_name)}>Edit</Button>
          </div>
          <div className={s.row}>
            <div><div className={s.rowLabel}>Username</div><div className={s.rowValue}>{me.username}</div></div>
            <Button size="sm" variant="secondary" onClick={() => open("username", me.username)}>Edit</Button>
          </div>
        </div>
      </div>

      <div className={s.sep} />
      <h3 className={s.h5}>Password and Authentication</h3>
      <p className={s.hint}>Your password protects your account and the keys that decrypt your messages. Changing it re-wraps your keys; nothing is lost.</p>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => open("password")}>Change Password</Button>
        <Button variant="secondary" onClick={() => open("recovery")}>{me.has_recovery ? "Generate a new recovery key" : "Set up a recovery key"}</Button>
      </div>
      <p className={s.hint}>{me.has_recovery ? "A recovery key is set. Generating a new one replaces it." : "Without a recovery key, a forgotten password means your message history cannot be recovered."}</p>

      <div className={s.sep} />
      <h3 className={s.h5}>Account Removal</h3>
      <div className={s.dangerBox}>
        <span className={s.hint} style={{ margin: 0 }}>Deleting your account is permanent. Your messages stay in conversations but your profile and keys are erased.</span>
        <Button variant="danger" onClick={() => open("delete")}>Delete Account</Button>
      </div>

      {dialog === "displayName" || dialog === "username" ? (
        <Modal open onClose={close} title={dialog === "username" ? "Change your username" : "Change your display name"} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} onClick={() => void saveName(dialog === "username" ? "username" : "display_name")}>Done</Button></>}>
          <Field label={dialog === "username" ? "Username" : "Display name"} error={error}>
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={32} autoCapitalize={dialog === "username" ? "none" : undefined} />
          </Field>
        </Modal>
      ) : null}

      {dialog === "password" ? (
        <Modal open onClose={close} title="Update your password" footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} disabled={value.length < 1 || pw.length < 8 || pw !== pw2} onClick={() => void run(async () => { await changePassword(value, pw); toast("Password changed. Other devices were logged out.", "success"); close(); })}>Done</Button></>}>
          <div className={s.form}>
            {error ? <p className={s.hint} style={{ color: "var(--danger)" }}>{error}</p> : null}
            <Field label="Current password" required><TextInput type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" autoFocus /></Field>
            <Field label="New password" required hint="At least 8 characters."><TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Confirm new password" required error={pw2 && pw2 !== pw ? "Passwords do not match." : null}><TextInput type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          </div>
        </Modal>
      ) : null}

      {dialog === "recovery" ? (
        <Modal open onClose={close} closeOnOverlay={!recovery} title="Recovery key" footer={recovery ? <Button onClick={close}>Done</Button> : <><Button variant="ghost" onClick={close}>Cancel</Button><Button loading={busy} disabled={!value} onClick={() => void run(async () => setRecovery(await newRecoveryKey(value)))}>Generate</Button></>}>
          {recovery ? (
            <div className={s.form}>
              <p className={s.hint}>Save this key now. It will not be shown again, and it replaces any previous key.</p>
              <div className={s.recovery}>{recovery}</div>
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(recovery)}>Copy</Button>
            </div>
          ) : (
            <div className={s.form}>
              {error ? <p className={s.hint} style={{ color: "var(--danger)" }}>{error}</p> : null}
              <p className={s.hint}>Confirm your password to generate a new recovery key.</p>
              <Field label="Password" required><TextInput type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" autoFocus /></Field>
            </div>
          )}
        </Modal>
      ) : null}

      {dialog === "delete" ? (
        <Modal open onClose={close} title="Delete Account" footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={!value} onClick={() => void run(async () => {
          const { deriveAuthKey, deriveMaster } = await import("@/crypto/kdf");
          const { b64 } = await import("@/crypto/bytes");
          const bundle = await usersApi.myKeys();
          const master = await deriveMaster(value, b64.dec(bundle.kdf_salt), { m: bundle.kdf_params.m, t: bundle.kdf_params.t, p: bundle.kdf_params.p, v: 1 });
          await usersApi.deleteMe(b64.enc(deriveAuthKey(master)));
          await logout();
        })}>Delete Account</Button></>}>
          <div className={s.form}>
            {error ? <p className={s.hint} style={{ color: "var(--danger)" }}>{error}</p> : null}
            <p className={s.hint}>This cannot be undone. Enter your password to confirm.</p>
            <Field label="Password" required><TextInput type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" autoFocus /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
