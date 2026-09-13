import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "./AuthLayout";
import s from "./Auth.module.css";

/** The first retry waits this long, and each one after waits twice as long as the last. */
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 30_000;

/**
 * Shown when the session could not be checked at startup: the phone has no
 * signal yet, or the server is restarting. The token is still stored, so this
 * keeps trying on its own (and as soon as the browser says it is back online)
 * rather than sending someone who is still logged in to the login form.
 */
export default function OfflinePage() {
  const bootstrap = useAuth((a) => a.bootstrap);
  const error = useAuth((a) => a.error);
  const [busy, setBusy] = useState(false);
  const retryNow = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let tries = 0;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(() => void retry(), Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** tries));
    };
    const retry = async () => {
      if (running) return;
      running = true;
      if (timer) clearTimeout(timer);
      timer = null;
      setBusy(true);
      await bootstrap();
      // Getting through replaces this screen; otherwise wait a little longer.
      if (!alive) return;
      running = false;
      setBusy(false);
      tries += 1;
      schedule();
    };
    const onOnline = () => void retry();
    retryNow.current = onOnline;
    schedule();
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [bootstrap]);

  return (
    <AuthLayout title="Can't connect" subtitle={error ?? "Could not reach the server."} width={420}>
      <p className={s.progress}>You are still logged in. Check your connection, or wait a moment if the server is restarting; this page keeps trying.</p>
      <Button size="lg" block loading={busy} onClick={() => retryNow.current()} data-testid="offline-retry">Retry</Button>
    </AuthLayout>
  );
}
