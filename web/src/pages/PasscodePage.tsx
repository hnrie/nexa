import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { hasLock, loadLock, MAX_FAILURES, triesLeft, WrongPasscode } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";
/** The passcode screen: shown whenever this device's app lock is on. */
export default function PasscodePage() {
  const me = useAuth((a) => a.me);
  const unlockWithPasscode = useAuth((a) => a.unlockWithPasscode);
  const logout = useAuth((a) => a.logout);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(() => (me ? triesLeft(me.id) : MAX_FAILURES));
  // A device that has never been given the passcode is being set up, not unlocked.
  const [adopting] = useState(() => !!me && !hasLock(me.id));
  // A passcode can hold letters, and a phone's number pad cannot type them, so
  // the pad is only offered once this device knows the passcode is all digits.
  const [numeric] = useState(() => !!me && loadLock(me.id)?.numeric === true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !passcode) return;
    setBusy(true);
    setError(null);
    try {
      await unlockWithPasscode(passcode);
    } catch (err) {
      setPasscode("");
      input.current?.focus();
      if (err instanceof WrongPasscode) {
        setLeft(err.left);
        setError(err.left > 0 ? err.message : t("passcode.tooManyWrongTriesLogIn"));
      } else {
        setError(err instanceof Error ? err.message : t("passcode.thatDidNotWork"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={adopting ? t("passcode.thisAccountHasAPasscode") : "Locked"}
      subtitle={
        adopting
          ? t("passcode.enterItToFinishSettingThis")
          : `Enter your passcode to unlock, ${me?.display_name ?? me?.username ?? "you"}.`
      }
      width={420}
    >
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.security.passcode")} required>
          <TextInput
            ref={input}
            type="password"
            inputMode={numeric ? "numeric" : "text"}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="off"
            data-testid="passcode-input"
            required
          />
        </Field>
        {left <= 3 ? <div className={s.warn}>{t("passcode.triesLeft", { count: left })} {t("passcode.thenSignInWithPassword")}</div> : null}
        <Button type="submit" size="lg" block loading={busy} data-testid="passcode-submit">{adopting ? t("passcode.setUpThisDevice") : t("lock.unlock")}</Button>
        <Button type="button" variant="link" onClick={() => void logout()}>{t("lock.logOutInstead")}</Button>
      </form>
    </AuthLayout>
  );
}
