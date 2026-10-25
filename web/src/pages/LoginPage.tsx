import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { describeError } from "@/lib/errors";
import { WeakKdfError } from "@/crypto/kdf";
import { safeNext } from "@/lib/nextPath";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { useMediaQuery } from "@/hooks/useIsMobile";
import { switchAccount, useAccounts } from "@/lib/accounts";
import { passkeyCancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { KeyRound } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { AuthLayout, usePageTitle } from "./AuthLayout";
import { QrSignIn } from "./QrSignIn";
import s from "./Auth.module.css";

import { t } from "@/i18n";
export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const login = useAuth((a) => a.login);
  const completeMfa = useAuth((a) => a.completeMfa);
  const cancelMfa = useAuth((a) => a.cancelMfa);
  const loginWith = useAuth((a) => a.loginWith);
  // the accounts already signed in here, when this is Add Account
  const saved = useAccounts((a) => a.list);
  // a phone cannot scan its own screen, so the code is for wider ones
  const wide = useMediaQuery("(min-width: 768px)");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A general failure (no connection, too many tries) sits above the form; a
  // wrong password or code is said on its own field, where it takes no room
  // and so moves nothing, and goes as soon as that field is edited.
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [codesLeft, setCodesLeft] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const next = new URLSearchParams(loc.search).get("next") || "/channels/@me";
  const go = () => nav(safeNext(next), { replace: true });
  usePageTitle(step === "code" ? t("login.oneMoreStep") : t("login.logIn"));

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step, useBackup]);

  const describe = (err: unknown, fallback: string) => {
    // The password was never stretched and never sent: the server asked for
    // parameters that would have handed it over. Saying "wrong password" here
    // would send someone to reset a password that is perfectly good.
    if (err instanceof WeakKdfError) return err.message;
    if (err instanceof ApiError) {
      if (err.code === "invalid_credentials") return t("login.usernameOrPasswordIsWrong");
      if (err.code === "rate_limited") return t("login.tooManyAttempts");
      // Said only once the password is known to be right (the server's rule),
      // so a disabled account stops being told its password is wrong.
      if (err.code === "account_disabled") return t("login.accountDisabled");
      return describeError(err, fallback);
    }
    // fetch rejects with a TypeError when the request never got an answer
    // ("Failed to fetch", "Load failed"), which says nothing about the password.
    if (err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
      return t("login.canTReachTheServerCheck");
    }
    return fallback;
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setWrong(null);
    try {
      const out = await login(username.trim().toLowerCase(), password);
      if (out.mfa) {
        setCodesLeft(out.backupCodesLeft);
        setStep("code");
        return;
      }
      go();
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_credentials") {
        setWrong(t("login.usernameOrPasswordIsWrong"));
        passwordInput.current?.focus();
        passwordInput.current?.select();
      } else {
        setError(describe(err, t("login.couldNotDecryptYourKeysWith")));
      }
    } finally {
      setBusy(false);
    }
  };

  const onPasskey = async () => {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    setError(null);
    setWrong(null);
    try {
      const out = await signInWithPasskey();
      await loginWith(out.me, out.token, out.identity);
      go();
    } catch (err) {
      if (!passkeyCancelled(err)) setError(describe(err, t("passkeys.couldNotSignIn")));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setWrong(null);
    try {
      await completeMfa(useBackup ? { backupCode: code.trim() } : { code });
      go();
    } catch (err) {
      setCode("");
      if (err instanceof ApiError && (err.code === "mfa_expired" || err.code === "mfa_disabled")) {
        cancelMfa();
        setStep("password");
        setPassword("");
        setError(describeError(err, t("login.thatCodeDidNotWork")));
      } else if (err instanceof ApiError && err.code === "invalid_code") {
        setWrong(t("login.thatCodeDidNotWork"));
        codeInput.current?.focus();
      } else {
        setError(describe(err, t("login.thatCodeDidNotWork")));
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
    setWrong(null);
    setUseBackup(false);
  };

  if (step === "code") {
    return (
      <AuthLayout
        title={t("login.oneMoreStep")}
        subtitle={useBackup ? t("login.enterOneOfTheBackupCodes") : t("login.enterTheSixDigitCodeFrom")}
        width={420}
      >
        <form className={s.form} onSubmit={(e) => void onCode(e)}>
          {error ? <div className={s.error} role="alert">{error}</div> : null}
          <Field label={useBackup ? t("login.backupCode") : t("login.authenticationCode")} required error={wrong}>
            <TextInput
              ref={codeInput}
              value={code}
              onChange={(e) => {
                setWrong(null);
                setCode(useBackup ? e.target.value.toUpperCase().slice(0, 20) : e.target.value.replace(/[^\d\s]/g, "").slice(0, 7));
              }}
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={useBackup ? "XXXX-XXXX-XXXX" : "123456"}
              data-testid="mfa-code"
              required
            />
          </Field>
          {/* the same words as the button on the step before, since it finishes the same thing */}
          <Button type="submit" size="lg" block loading={busy} data-testid="mfa-submit">{t("login.logIn")}</Button>
          <Button type="button" variant="link" className={s.textButton} onClick={() => { setUseBackup((v) => !v); setCode(""); setError(null); setWrong(null); }}>
            {useBackup ? t("login.useYourAuthenticatorInstead") : codesLeft ? t("login.useABackupCodeLeft", { count: codesLeft }) : t("login.useABackupCode")}
          </Button>
          <Button type="button" variant="link" className={s.textButton} onClick={backToPassword}>{t("modals.createServer.back")}</Button>
        </form>
      </AuthLayout>
    );
  }

  const form = (
      <form className={s.form} onSubmit={(e) => void onPassword(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.account.username")} required>
          <TextInput value={username} onChange={(e) => { setUsername(e.target.value); setWrong(null); }} autoComplete="username" autoCapitalize="none" spellCheck={false} invalid={!!wrong} aria-invalid={wrong ? true : undefined} autoFocus required />
        </Field>
        {/* The link sits outside the field's label: inside it, it became part
            of the password box's name ("Password, Forgot your password?"). */}
        <div className={s.group}>
          <Field label={t("chat.lockedChannel.password")} required error={wrong}>
            <TextInput ref={passwordInput} type="password" reveal value={password} onChange={(e) => { setPassword(e.target.value); setWrong(null); }} autoComplete="current-password" required />
          </Field>
          <Link to="/recover" className={s.forgot}>{t("login.forgotYourPassword")}</Link>
        </div>
        <Button type="submit" size="lg" block loading={busy}>{t("login.logIn")}</Button>
        {passkeysSupported() ? (
          <Button type="button" variant="secondary" size="lg" block loading={passkeyBusy} onClick={() => void onPasskey()} data-testid="passkey-login">
            <KeyRound size={18} /> {t("passkeys.logInWithAPasskey")}
          </Button>
        ) : null}
        {/* Sessions are long, and nothing said so: someone on a shared
            computer had no reason to think they should log out. */}
        <p className={s.note}>{t("login.staySignedIn")}</p>
        <div className={s.foot}>
          {t("login.needAnAccount")} <Link to="/register">{t("login.register")}</Link>
        </div>
        {saved.length ? (
          // Add Account: the way back to an account already signed in here
          <div className={s.backTo}>
            {saved.map((a) => (
              <button key={a.id} type="button" className={s.backToAccount} onClick={() => void switchAccount(a.id)}>
                <Avatar id={a.id} avatarId={a.avatar_id} name={a.display_name} size={24} />
                <span>{t("accounts.backTo", { name: a.display_name })}</span>
              </button>
            ))}
          </div>
        ) : null}
      </form>
  );

  return (
    <AuthLayout title={t("login.welcomeBack")} subtitle={t("login.weReSoExcitedToSee")} banner width={wide ? 820 : 480}>
      {wide ? (
        <div className={s.split}>
          {form}
          <QrSignIn onDone={go} onError={setError} />
        </div>
      ) : (
        form
      )}
    </AuthLayout>
  );
}
