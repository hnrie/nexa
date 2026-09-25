import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/api/client";
import { WeakKdfError } from "@/crypto/kdf";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { describeError } from "@/lib/errors";
import { useAuth } from "@/stores/auth";
import { AuthLayout, usePageTitle } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";
/** Shown when a session token exists but the encryption keys are not on this device. */
export default function LockPage() {
  const me = useAuth((a) => a.me);
  const unlock = useAuth((a) => a.unlock);
  const logout = useAuth((a) => a.logout);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a password that did not open the keys is said on its field, which moves nothing
  const [wrong, setWrong] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  usePageTitle(t("lock.unlockYourMessages"));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWrong(null);
    try {
      await unlock(password);
    } catch (err) {
      // No answer, or the server's own refusal, is about the connection; a
      // key that would not unwrap is about the password.
      if (err instanceof ApiError || err instanceof TypeError || err instanceof WeakKdfError) {
        setError(describeError(err, t("lock.thatPasswordCouldNotUnlockYour")));
      } else {
        setWrong(t("lock.thatPasswordCouldNotUnlockYour"));
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t("lock.unlockYourMessages")} subtitle={t("lock.welcomeBackEnterYourPassword", { name: me?.display_name ?? me?.username ?? "" })}>
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        {/* the account's name rides along, hidden, so a password manager knows which password this is */}
        <input type="text" autoComplete="username" value={me?.username ?? ""} readOnly hidden />
        <Field label={t("chat.lockedChannel.password")} required error={wrong}>
          <TextInput ref={input} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setWrong(null); }} autoComplete="current-password" autoFocus required />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>{t("lock.unlock")}</Button>
        <Button type="button" variant="link" className={s.textButton} onClick={() => void logout()}>{t("lock.logOutInstead")}</Button>
      </form>
    </AuthLayout>
  );
}
