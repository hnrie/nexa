import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { startSession, stopSession } from "@/gateway/session";
import LockPage from "@/pages/LockPage";
import { useAuth } from "@/stores/auth";

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
    if (status === "anonymous") stopSession();
  }, [status]);

  if (status === "idle" || status === "loading") return <FullScreenSpinner text="Connecting…" />;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
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
  if (status === "ready" || status === "locked") return <Navigate to="/channels/@me" replace />;
  return <>{children}</>;
}
