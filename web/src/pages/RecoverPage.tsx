import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { describeError } from "@/lib/errors";
import { Button } from "@/components/common/Button";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout, RecoveryKeyPanel, usePageTitle } from "./AuthLayout";
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
  // a key or name that did not match is said on the key's field, and goes when either is edited
  const [wrongKey, setWrongKey] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  usePageTitle(fresh ? t("recover.passwordReset") : t("recover.recoverYourAccount"), status !== "offline" || !!fresh);

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8 || password !== confirm) {
      confirmInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setWrongKey(null);
    justRecovered.current = true;
    try {
      const res = await recover(username.trim().toLowerCase(), key, password);
      setFresh(res.recoveryKey);
    } catch (err) {
      justRecovered.current = false;
      if (err instanceof ApiError) {
        if (err.code === "account_disabled") setError(t("login.accountDisabled"));
        else if (err.code === "invalid_credentials") {
          setWrongKey(t("recover.usernameOrRecoveryKeyIsWrong"));
          keyInput.current?.focus();
        } else setError(describeError(err, t("recover.recoveryFailedCheckTheKeyAnd")));
      } else if (err instanceof Error && /invalid recovery key/i.test(err.message)) {
        setWrongKey(t("recover.thatDoesNotLookLikeARecoveryKey"));
        keyInput.current?.focus();
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
        {/* The reset turned the authenticator off (the key it just used already
            unwraps everything), which nothing used to mention: the account was
            left on a password alone without the person knowing. */}
        <p className={s.note}>{t("recover.twoFactorIsOffNow")}</p>
        <RecoveryKeyPanel value={fresh} username={username.trim().toLowerCase()} confirm={t("recover.iHaveSavedMyNewRecovery")} doneLabel={t("settings.security.continue")} onDone={() => nav("/channels/@me", { replace: true })} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("recover.recoverYourAccount")} subtitle={t("recover.useTheRecoveryKeyYouSaved")}>
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.account.username")} required>
          <TextInput value={username} onChange={(e) => { setUsername(e.target.value); setWrongKey(null); }} autoComplete="username" autoCapitalize="none" spellCheck={false} invalid={!!wrongKey} aria-invalid={wrongKey ? true : undefined} required />
        </Field>
        <Field label={t("settings.account.recoveryKey")} required error={wrongKey} hint={t("recover.eightGroupsOfEightCharactersDashes")}>
          <TextInput ref={keyInput} value={key} onChange={(e) => { setKey(e.target.value); setWrongKey(null); }} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
        </Field>
        <Field label={t("settings.account.newPassword")} required>
          <TextInput type="password" reveal value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label={t("settings.account.confirmNewPassword")} required error={confirm && confirm !== password ? t("settings.account.passwordsDoNotMatch") : null}>
          <TextInput ref={confirmInput} type="password" reveal value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <p className={s.note}>{t("recover.whatAResetDoes")}</p>
        <Button type="submit" size="lg" block loading={busy}>{t("recover.resetPassword")}</Button>
        <div className={s.foot}>
          <Link to="/login">{t("recover.backToLogIn")}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
