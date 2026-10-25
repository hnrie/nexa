import { KeyRound } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { WeakKdfError } from "@/crypto/kdf";
import { useMediaQuery } from "@/hooks/useIsMobile";
import { addSignedIn } from "@/lib/addAccount";
import { describeError } from "@/lib/errors";
import { passkeyCancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { QrSignIn } from "@/pages/QrSignIn";
import { passwordSignIn, useAuth, type PasswordStep, type SignedIn } from "@/stores/auth";
import auth from "@/pages/Auth.module.css";

import { t } from "@/i18n";

type Finish = Extract<PasswordStep, { mfa: true }>["finish"];

/**
 * Add Another Account, over the app: a password (and its code), a passkey or
 * a QR code signs another account in without leaving the one open here, and
 * the app then switches to it (lib/accounts.ts addSignedIn).
 */
export default function AddAccountModal({ onClose }: { onClose: () => void }) {
  const me = useAuth((a) => a.me);
  const wide = useMediaQuery("(min-width: 768px)");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [finish, setFinish] = useState<{ fn: Finish; left: number } | null>(null);
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState<null | "password" | "passkey" | "code">(null);
  const [error, setError] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  const describe = (err: unknown, fallback: string) => {
    if (err instanceof WeakKdfError) return err.message;
    if (err instanceof ApiError && err.code === "invalid_credentials") return t("login.usernameOrPasswordIsWrong");
    if (err instanceof ApiError && err.code === "invalid_code") return t("login.thatCodeDidNotWork");
    if (err instanceof ApiError && err.code === "rate_limited") return t("login.tooManyAttempts");
    return describeError(err, fallback);
  };

  const keep = async (out: SignedIn) => {
    await addSignedIn(out);
    onClose();
  };

  const run = async (kind: "password" | "passkey" | "code", fn: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (!passkeyCancelled(err)) setError(describe(err, fallback));
    } finally {
      setBusy(null);
    }
  };

  const onPassword = () =>
    username.trim() && password &&
    run("password", async () => {
      const step = await passwordSignIn(username.trim().toLowerCase(), password);
      if (step.mfa) {
        setFinish({ fn: step.finish, left: step.backupCodesLeft });
        return;
      }
      await keep(step.out);
    }, t("login.couldNotDecryptYourKeysWith"));

  const onCode = () =>
    finish && code.trim() &&
    run("code", async () => {
      await keep(await finish.fn(useBackup ? { backupCode: code.trim() } : { code }));
    }, t("login.thatCodeDidNotWork"));

  const onPasskey = () => run("passkey", async () => keep(await signInWithPasskey()), t("passkeys.couldNotSignIn"));

  const form = finish ? (
    <div className={auth.form}>
      {error ? <div className={auth.error} role="alert">{error}</div> : null}
      <p className={auth.note}>{useBackup ? t("login.enterOneOfTheBackupCodes") : t("login.enterTheSixDigitCodeFrom")}</p>
      <Field label={useBackup ? t("login.backupCode") : t("login.authenticationCode")} required>
        <TextInput
          value={code}
          onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase().slice(0, 20) : e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={useBackup ? "XXXX-XXXX-XXXX" : "123456"}
          autoFocus
          data-testid="add-account-code"
        />
      </Field>
      <Button size="lg" block loading={busy === "code"} disabled={!code.trim()} onClick={() => void onCode()}>{t("login.logIn")}</Button>
      <Button type="button" variant="link" onClick={() => { setUseBackup((v) => !v); setCode(""); setError(null); }}>
        {useBackup ? t("login.useYourAuthenticatorInstead") : finish.left ? t("login.useABackupCodeLeft", { count: finish.left }) : t("login.useABackupCode")}
      </Button>
      <Button type="button" variant="link" onClick={() => { setFinish(null); setCode(""); setPassword(""); setError(null); }}>{t("modals.createServer.back")}</Button>
    </div>
  ) : (
    <div className={auth.form}>
      {error ? <div className={auth.error} role="alert">{error}</div> : null}
      <Field label={t("settings.account.username")} required>
        <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus data-testid="add-account-username" />
      </Field>
      <Field label={t("chat.lockedChannel.password")} required>
        <TextInput ref={passwordInput} type="password" reveal value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="add-account-password" />
      </Field>
      <Button size="lg" block loading={busy === "password"} disabled={!username.trim() || !password} onClick={() => void onPassword()} data-testid="add-account-submit">{t("login.logIn")}</Button>
      {passkeysSupported() ? (
        <Button type="button" variant="secondary" size="lg" block loading={busy === "passkey"} onClick={() => void onPasskey()}>
          <KeyRound size={18} /> {t("passkeys.logInWithAPasskey")}
        </Button>
      ) : null}
    </div>
  );

  return (
    <Modal open onClose={onClose} title={t("accounts.addAnotherAccount")} width={wide && !finish ? 760 : 440} onSubmit={() => void (finish ? onCode() : onPassword())}>
      <p className={auth.note} style={{ marginBottom: 20 }}>{t("accounts.addHint", { name: me?.display_name ?? "" })}</p>
      {wide && !finish ? (
        <div className={auth.split}>
          {form}
          <QrSignIn onSignedIn={keep} onError={setError} />
        </div>
      ) : (
        form
      )}
    </Modal>
  );
}
