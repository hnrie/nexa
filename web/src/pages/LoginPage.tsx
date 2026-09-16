import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";
export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const login = useAuth((a) => a.login);
  const completeMfa = useAuth((a) => a.completeMfa);
  const cancelMfa = useAuth((a) => a.cancelMfa);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [codesLeft, setCodesLeft] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const next = new URLSearchParams(loc.search).get("next") || "/channels/@me";
  const go = () => nav(next.startsWith("/") ? next : "/channels/@me", { replace: true });

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step, useBackup]);

  const describe = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      if (err.code === "invalid_credentials") return "Username or password is wrong.";
      if (err.code === "rate_limited") return "Too many attempts. Wait a minute and try again.";
      return err.message;
    }
    // fetch rejects with a TypeError when the request never got an answer
    // ("Failed to fetch", "Load failed"), which says nothing about the password.
    if (err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
      return "Can't reach the server. Check your connection and try again.";
    }
    return fallback;
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await login(username.trim().toLowerCase(), password);
      if (out.mfa) {
        setCodesLeft(out.backupCodesLeft);
        setStep("code");
        return;
      }
      go();
    } catch (err) {
      setError(describe(err, "Could not decrypt your keys with that password."));
    } finally {
      setBusy(false);
    }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await completeMfa(useBackup ? { backupCode: code.trim() } : { code });
      go();
    } catch (err) {
      setCode("");
      if (err instanceof ApiError && (err.code === "mfa_expired" || err.code === "mfa_disabled")) {
        cancelMfa();
        setStep("password");
        setPassword("");
        setError(err.message);
      } else {
        setError(describe(err, "That code did not work."));
      }
    } finally {
      setBusy(false);
    }
  };

  const backToPassword = () => {
    cancelMfa();
    setStep("password");
    setCode("");
    setPassword("");
    setError(null);
    setUseBackup(false);
  };

  if (step === "code") {
    return (
      <AuthLayout
        title={t("login.oneMoreStep")}
        subtitle={useBackup ? "Enter one of the backup codes you saved." : "Enter the six-digit code from your authenticator app."}
        width={420}
      >
        <form className={s.form} onSubmit={(e) => void onCode(e)}>
          {error ? <div className={s.error} role="alert">{error}</div> : null}
          <Field label={useBackup ? "Backup code" : "Authentication code"} required>
            <TextInput
              ref={codeInput}
              value={code}
              onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase().slice(0, 20) : e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={useBackup ? "XXXX-XXXX-XXXX" : "123456"}
              data-testid="mfa-code"
              required
            />
          </Field>
          <Button type="submit" size="lg" block loading={busy} data-testid="mfa-submit">{t("login.signIn")}</Button>
          <Button type="button" variant="link" onClick={() => { setUseBackup((v) => !v); setCode(""); setError(null); }}>
            {useBackup ? "Use your authenticator instead" : `Use a backup code${codesLeft ? ` (${codesLeft} left)` : ""}`}
          </Button>
          <Button type="button" variant="link" onClick={backToPassword}>{t("modals.createServer.back")}</Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("login.welcomeBack")} subtitle={t("login.weReSoExcitedToSee")}>
      <form className={s.form} onSubmit={(e) => void onPassword(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.account.username")} required>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
        </Field>
        <Field label={t("chat.lockedChannel.password")} required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <Link to="/recover" className={s.foot}>{t("login.forgotYourPassword")}</Link>
        </Field>
        <Button type="submit" size="lg" block loading={busy}>{t("login.logIn")}</Button>
        <div className={s.foot}>
          Need an account? <Link to="/register">{t("login.register")}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
