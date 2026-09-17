import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout, passwordStrength, usernameProblem } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";
export default function RegisterPage() {
  const nav = useNavigate();
  const register = useAuth((a) => a.register);
  const status = useAuth((a) => a.status);
  const justRegistered = useRef(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const next = params.get("next") || "/channels/@me";
  const [inviteKey, setInviteKey] = useState(params.get("invite") ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const uname = username.trim().toLowerCase();
  const uProblem = uname ? usernameProblem(uname) : null;
  const strength = useMemo(() => passwordStrength(password), [password]);
  const canSubmit = !busy && !uProblem && uname.length >= 2 && displayName.trim().length > 0 && password.length >= 8 && password === confirm;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setProgress(t("register.securingYourAccountThisTakesA"));
    justRegistered.current = true;
    try {
      const res = await register(uname, displayName.trim(), password, inviteKey ? { registration_key: inviteKey, invite_code: inviteKey } : undefined);
      setRecovery(res.recoveryKey);
    } catch (err) {
      justRegistered.current = false;
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          username_taken: t("register.thatUsernameIsTaken"),
          invalid_username: t("register.thatUsernameIsNotAllowed"),
          registration_closed: t("register.thisServerIsNotAcceptingNew"),
          invite_required: t("register.youNeedAnInviteOrRegistration"),
          rate_limited: t("register.tooManySignUpsFromYour"),
        };
        setError(map[err.code] ?? err.message);
      } else {
        setError(t("register.somethingWentWrongPleaseTryAgain"));
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  // Someone already logged in who lands here goes to the app; a fresh registration stays to show the recovery key.
  if ((status === "ready" || status === "locked") && !recovery && !justRegistered.current) {
    return <Navigate to="/channels/@me" replace />;
  }

  if (recovery) {
    const download = () => {
      const blob = new Blob([`Nexa recovery key for @${uname}\n\n${recovery}\n\nKeep this somewhere safe. It is the only way to recover your messages if you forget your password.\n`], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evilion-chat-recovery-${uname}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <AuthLayout title={t("register.saveYourRecoveryKey")} subtitle={t("register.yourMessagesAreEndToEnd")}>
        <div className={s.recovery} data-testid="recovery-key">{recovery}</div>
        <div className={s.row}>
          <Button variant="secondary" block onClick={() => void navigator.clipboard?.writeText(recovery)}>{t("modals.groupInvite.copy")}</Button>
          <Button variant="secondary" block onClick={download}>{t("register.downloadTxt")}</Button>
        </div>
        <div className={s.warn}>{t("register.weCannotShowThisKeyAgain")}</div>
        <label className={s.check}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>{t("register.iHaveSavedMyRecoveryKey")}</span>
        </label>
        <Button size="lg" block disabled={!saved} onClick={() => nav(next.startsWith("/") ? next : "/channels/@me", { replace: true })}>{t("register.continueToNexa")}</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("register.createAnAccount")}>
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.account.username")} required error={uname && uProblem ? uProblem : null} hint={t("register.lowercaseLettersNumbersUnderscoresAndDots")}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} required />
        </Field>
        <Field label={t("register.displayName")} required hint={t("register.howYourNameAppearsToOthers")}>
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" maxLength={32} required />
        </Field>
        <Field label={t("chat.lockedChannel.password")} required hint={password && password.length < 8 ? t("settings.account.atLeast8Characters") : undefined}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          {password ? (
            <div className={s.strength} data-score={strength.score}>
              {[1, 2, 3, 4].map((n) => <i key={n} data-on={strength.score >= n} />)}
              <span className={s.strengthLabel}>{strength.label}</span>
            </div>
          ) : null}
        </Field>
        <Field label={t("register.confirmPassword")} required error={confirm && confirm !== password ? "Passwords do not match." : null}>
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <details>
          <summary className={s.foot}>{t("register.haveAnInviteOrRegistrationKey")}</summary>
          <Field label={t("register.inviteRegistrationKey")}>
            <TextInput value={inviteKey} onChange={(e) => setInviteKey(e.target.value)} />
          </Field>
        </details>
        {progress ? <div className={s.progress}>{progress}</div> : null}
        <Button type="submit" size="lg" block loading={busy} disabled={!canSubmit}>{t("settings.security.continue")}</Button>
        <div className={s.foot}>
          <Link to="/login">{t("register.alreadyHaveAnAccount")}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
