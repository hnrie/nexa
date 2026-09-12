import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout, passwordStrength, usernameProblem } from "./AuthLayout";
import s from "./Auth.module.css";

export default function RegisterPage() {
  const nav = useNavigate();
  const register = useAuth((a) => a.register);
  const status = useAuth((a) => a.status);
  const justRegistered = useRef(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteKey, setInviteKey] = useState("");
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
    setProgress("Securing your account… this takes a moment.");
    justRegistered.current = true;
    try {
      const res = await register(uname, displayName.trim(), password, inviteKey ? { registration_key: inviteKey, invite_code: inviteKey } : undefined);
      setRecovery(res.recoveryKey);
    } catch (err) {
      justRegistered.current = false;
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          username_taken: "That username is taken.",
          invalid_username: "That username is not allowed.",
          registration_closed: "This server is not accepting new accounts.",
          invite_required: "You need an invite or registration key to sign up here.",
          rate_limited: "Too many sign-ups from your network. Try again later.",
        };
        setError(map[err.code] ?? err.message);
      } else {
        setError("Something went wrong. Please try again.");
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
      const blob = new Blob([`Evilion Chat recovery key for @${uname}\n\n${recovery}\n\nKeep this somewhere safe. It is the only way to recover your messages if you forget your password.\n`], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evilion-chat-recovery-${uname}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <AuthLayout title="Save your recovery key" subtitle="Your messages are end-to-end encrypted. If you forget your password, this key is the only way back in.">
        <div className={s.recovery} data-testid="recovery-key">{recovery}</div>
        <div className={s.row}>
          <Button variant="secondary" block onClick={() => void navigator.clipboard?.writeText(recovery)}>Copy</Button>
          <Button variant="secondary" block onClick={download}>Download .txt</Button>
        </div>
        <div className={s.warn}>We cannot show this key again. Anyone who has it can read your messages, so store it like a password.</div>
        <label className={s.check}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I have saved my recovery key somewhere safe.</span>
        </label>
        <Button size="lg" block disabled={!saved} onClick={() => nav("/channels/@me", { replace: true })}>Continue to Evilion Chat</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create an account">
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label="Username" required error={uname && uProblem ? uProblem : null} hint="Lowercase letters, numbers, underscores and dots. This is your unique @handle.">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} required />
        </Field>
        <Field label="Display name" required hint="How your name appears to others. You can change it any time.">
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" maxLength={32} required />
        </Field>
        <Field label="Password" required hint={password && password.length < 8 ? "At least 8 characters." : undefined}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          {password ? (
            <div className={s.strength} data-score={strength.score}>
              {[1, 2, 3, 4].map((n) => <i key={n} data-on={strength.score >= n} />)}
              <span className={s.strengthLabel}>{strength.label}</span>
            </div>
          ) : null}
        </Field>
        <Field label="Confirm password" required error={confirm && confirm !== password ? "Passwords do not match." : null}>
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        <details>
          <summary className={s.foot}>Have an invite or registration key?</summary>
          <Field label="Invite / registration key">
            <TextInput value={inviteKey} onChange={(e) => setInviteKey(e.target.value)} />
          </Field>
        </details>
        {progress ? <div className={s.progress}>{progress}</div> : null}
        <Button type="submit" size="lg" block loading={busy} disabled={!canSubmit}>Continue</Button>
        <div className={s.foot}>
          <Link to="/login">Already have an account?</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
