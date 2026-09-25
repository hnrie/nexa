import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { hasLock, loadLock, MAX_FAILURES, triesLeft, WrongPasscode } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";
import { describeError } from "@/lib/errors";
import { AuthLayout, usePageTitle } from "./AuthLayout";
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
  // a wrong passcode is said on its field, which moves nothing; the rest goes above
  const [wrong, setWrong] = useState<string | null>(null);
  const [left, setLeft] = useState(() => (me ? triesLeft(me.id) : MAX_FAILURES));
  // A device that has never been given the passcode is being set up, not unlocked.
  const [adopting] = useState(() => !!me && !hasLock(me.id));
  // A passcode can hold letters, and a phone's number pad cannot type them, so
  // the pad is only offered once this device knows the passcode is all digits.
  const [numeric] = useState(() => !!me && loadLock(me.id)?.numeric === true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  usePageTitle(adopting ? t("passcode.thisAccountHasAPasscode") : t("passcode.locked"));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !passcode) return;
    setBusy(true);
    setError(null);
    setWrong(null);
    try {
      await unlockWithPasscode(passcode);
    } catch (err) {
      setPasscode("");
      input.current?.focus();
      if (err instanceof WrongPasscode) {
        // null means this device counts nothing, so the warning below stays away
        if (err.left !== null) setLeft(err.left);
        if (err.left === null || err.left > 0) setWrong(err.message);
        else setError(t("passcode.tooManyWrongTriesLogIn"));
      } else {
        // Anything that is not a wrong passcode is a WebCrypto OperationError
        // or an IndexedDB InvalidStateError, whose message is written for
        // whoever wrote the browser. This is the app-lock screen; it gets a
        // sentence, and the console gets the exception.
        console.error("unlock failed", err);
        setError(describeError(err, t("passcode.thatDidNotWork")));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={adopting ? t("passcode.thisAccountHasAPasscode") : t("passcode.locked")}
      subtitle={
        adopting
          ? t("passcode.enterItToFinishSettingThis")
          : t("passcode.enterYourPasscodeToUnlock", { name: me?.display_name ?? me?.username ?? t("passcode.you") })
      }
      width={420}
    >
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label={t("settings.security.passcode")} required error={wrong}>
          <TextInput
            ref={input}
            type="password"
            inputMode={numeric ? "numeric" : "text"}
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setWrong(null);
            }}
            autoComplete="off"
            data-testid="passcode-input"
            required
          />
        </Field>
        {left <= 3 ? <div className={s.warn}>{t("passcode.triesLeft", { count: left })} {t("passcode.thenSignInWithPassword")}</div> : null}
        <Button type="submit" size="lg" block loading={busy} data-testid="passcode-submit">{adopting ? t("passcode.setUpThisDevice") : t("lock.unlock")}</Button>
        <Button type="button" variant="link" className={s.textButton} onClick={() => void logout()}>{t("lock.logOutInstead")}</Button>
      </form>
    </AuthLayout>
  );
}
