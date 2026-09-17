import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { startSession, stopSession } from "@/gateway/session";
import LockPage from "@/pages/LockPage";
import OfflinePage from "@/pages/OfflinePage";
import PasscodePage from "@/pages/PasscodePage";
import { useAuth } from "@/stores/auth";

import { t } from "@/i18n";
/** Gates the app behind a logged-in, unlocked session and keeps the gateway connected. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  const loc = useLocation();

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === "ready") void startSession();
    // Locking drops the keys, so the socket goes too: nothing should keep
    // arriving that this device can no longer read.
    if (status === "anonymous" || status === "pinlocked") stopSession();
  }, [status]);

  if (status === "idle" || status === "loading") return <FullScreenSpinner text={t("shell.requireAuth.connecting")} />;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (status === "offline") return <OfflinePage />;
  if (status === "pinlocked") return <PasscodePage />;
  if (status === "locked") return <LockPage />;
  return <>{children}</>;
}

/** Sends logged-in users away from the auth pages. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  if (status === "idle" || status === "loading") return <FullScreenSpinner />;
  // Still logged in, just not connected: the login form would only mislead.
  if (status === "offline") return <OfflinePage />;
  if (status === "ready" || status === "locked" || status === "pinlocked") return <Navigate to="/channels/@me" replace />;
  return <>{children}</>;
}
