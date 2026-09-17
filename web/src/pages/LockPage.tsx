import { useState, type FormEvent } from "react";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch {
      setError(t("lock.thatPasswordCouldNotUnlockYour"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t("lock.unlockYourMessages")} subtitle={`Welcome back, ${me?.display_name ?? me?.username ?? ""}. Enter your password to decrypt your keys on this device.`}>
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("chat.lockedChannel.password")} required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>{t("lock.unlock")}</Button>
        <Button type="button" variant="link" onClick={() => void logout()}>{t("lock.logOutInstead")}</Button>
      </form>
    </AuthLayout>
  );
}
