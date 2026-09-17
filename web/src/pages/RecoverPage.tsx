import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import OfflinePage from "./OfflinePage";
import s from "./Auth.module.css";

import { t } from "@/i18n";
export default function RecoverPage() {
  const nav = useNavigate();
  const recover = useAuth((a) => a.recover);
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  // Recovering logs in before the new key comes back, so this page must not
  // send a now logged-in user away until they have seen that key.
  const justRecovered = useRef(false);
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || password.length < 8 || password !== confirm) return;
    setBusy(true);
    setError(null);
    justRecovered.current = true;
    try {
      const res = await recover(username.trim().toLowerCase(), key, password);
      setFresh(res.recoveryKey);
    } catch (err) {
      justRecovered.current = false;
      if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") setError(t("recover.usernameOrRecoveryKeyIsWrong"));
        else if (err.code === "no_recovery_key") setError(t("recover.thisAccountHasNoRecoveryKey"));
        else setError(err.message);
      } else if (err instanceof Error && /invalid recovery key/i.test(err.message)) {
        setError(t("recover.thatDoesNotLookLikeARecoveryKey"));
      } else {
        setError(t("recover.recoveryFailedCheckTheKeyAnd"));
      }
    } finally {
      setBusy(false);
    }
  };

  // Someone already logged in who lands here goes to the app.
  if (!fresh && !justRecovered.current) {
    if (status === "idle" || status === "loading") return <FullScreenSpinner />;
    if (status === "offline") return <OfflinePage />;
    if (status === "ready" || status === "locked" || status === "pinlocked") return <Navigate to="/channels/@me" replace />;
  }

  if (fresh) {
    return (
      <AuthLayout title={t("recover.passwordReset")} subtitle={t("recover.hereIsYourNewRecoveryKey")}>
        <div className={s.recovery}>{fresh}</div>
        <Button variant="secondary" block onClick={() => void navigator.clipboard?.writeText(fresh)}>{t("modals.groupInvite.copy")}</Button>
        <label className={s.check}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>{t("recover.iHaveSavedMyNewRecovery")}</span>
        </label>
        <Button size="lg" block disabled={!saved} onClick={() => nav("/channels/@me", { replace: true })}>{t("settings.security.continue")}</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("recover.recoverYourAccount")} subtitle={t("recover.useTheRecoveryKeyYouSaved")}>
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.account.username")} required>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </Field>
        <Field label={t("settings.account.recoveryKey")} required hint={t("recover.eightGroupsOfEightCharactersDashes")}>
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Field label={t("settings.account.newPassword")} required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label={t("settings.account.confirmNewPassword")} required error={confirm && confirm !== password ? t("settings.account.passwordsDoNotMatch") : null}>
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>{t("recover.resetPassword")}</Button>
        <div className={s.foot}>
          <Link to="/login">{t("recover.backToLogIn")}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
