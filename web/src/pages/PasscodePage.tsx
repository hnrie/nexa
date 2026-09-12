import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { hasLock, MAX_FAILURES, triesLeft, WrongPasscode } from "@/lib/appLock";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

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
        setError(err.left > 0 ? err.message : "Too many wrong tries. Log in with your password to get back in.");
      } else {
        setError(err instanceof Error ? err.message : "That did not work.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={adopting ? "This account has a passcode" : "Locked"}
      subtitle={
        adopting
          ? "Enter it to finish setting this device up. Your keys are then kept wrapped by it here too."
          : `Enter your passcode to unlock, ${me?.display_name ?? me?.username ?? "you"}.`
      }
      width={420}
    >
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label="Passcode" required>
          <TextInput
            ref={input}
            type="password"
            inputMode="numeric"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="off"
            data-testid="passcode-input"
            required
          />
        </Field>
        {left <= 3 ? <div className={s.warn}>{left} {left === 1 ? "try" : "tries"} left before this device forgets your keys. You would then sign in with your password.</div> : null}
        <Button type="submit" size="lg" block loading={busy} data-testid="passcode-submit">{adopting ? "Set up this device" : "Unlock"}</Button>
        <Button type="button" variant="link" onClick={() => void logout()}>Log out instead</Button>
      </form>
    </AuthLayout>
  );
}
