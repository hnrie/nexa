import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const login = useAuth((a) => a.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = new URLSearchParams(loc.search).get("next") || "/channels/@me";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim().toLowerCase(), password);
      nav(next.startsWith("/") ? next : "/channels/@me", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") setError("Username or password is wrong.");
        else if (err.code === "rate_limited") setError("Too many attempts. Wait a minute and try again.");
        else setError(err.message);
      } else {
        setError("Could not decrypt your keys with that password.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back!" subtitle="We're so excited to see you again!">
      <form className={s.form} onSubmit={(e) => void onSubmit(e)}>
        {error ? <div className={s.error} role="alert">{error}</div> : null}
        <Field label="Username" required>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
        </Field>
        <Field label="Password" required>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <Link to="/recover" className={s.foot}>Forgot your password?</Link>
        </Field>
        <Button type="submit" size="lg" block loading={busy}>Log In</Button>
        <div className={s.foot}>
          Need an account? <Link to="/register">Register</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
