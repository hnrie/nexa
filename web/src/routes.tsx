import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { AppShell } from "@/components/shell/AppShell";
import { RedirectIfAuthed, RequireAuth } from "@/components/shell/RequireAuth";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const RecoverPage = lazy(() => import("@/pages/RecoverPage"));
const FriendsPage = lazy(() => import("@/pages/FriendsPage"));
const DMPage = lazy(() => import("@/pages/DMPage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/recover" element={<RedirectIfAuthed><RecoverPage /></RedirectIfAuthed>} />
        <Route
          path="/channels/*"
          element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route path="@me" element={<FriendsPage />} />
                  <Route path="@me/:channelId" element={<DMPage />} />
                  <Route path="@me/:channelId/:messageId" element={<DMPage />} />
                  <Route path="*" element={<Navigate to="/channels/@me" replace />} />
                </Routes>
              </AppShell>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/channels/@me" replace />} />
      </Routes>
    </Suspense>
  );
}
