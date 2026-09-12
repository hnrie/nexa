import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

export default function RecoverPage() {
  const nav = useNavigate();
  const recover = useAuth((a) => a.recover);
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || password.length < 8 || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recover(username.trim().toLowerCase(), key, password);
      setFresh(res.recoveryKey);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") setError("Username or recovery key is wrong.");
        else if (err.code === "no_recovery_key") setError("This account has no recovery key, so its messages cannot be recovered.");
        else setError(err.message);
      } else if (err instanceof Error && /invalid recovery key/i.test(err.message)) {
        setError("That does not look like a recovery key (64 hex characters).");
      } else {
        setError("Recovery failed. Check the key and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (fresh) {
    return (
      <AuthLayout title="Password reset" subtitle="Here is your new recovery key. The old one no longer works.">
        <div className={s.recovery}>{fresh}</div>
        <Button variant="secondary" block onClick={() => void navigator.clipboard?.writeText(fresh)}>Copy</Button>
        <label className={s.check}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I have saved my new recovery key.</span>
        </label>
        <Button size="lg" block disabled={!saved} onClick={() => nav("/channels/@me", { replace: true })}>Continue</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recover your account" subtitle="Use the recovery key you saved when you registered.">
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label="Username" required>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </Field>
        <Field label="Recovery key" required hint="Eight groups of eight characters, dashes optional.">
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Field label="New password" required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Confirm new password" required error={confirm && confirm !== password ? "Passwords do not match." : null}>
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Button type="submit" size="lg" block loading={busy}>Reset password</Button>
        <div className={s.foot}>
          <Link to="/login">Back to log in</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
