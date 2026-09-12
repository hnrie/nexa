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
const ServerPage = lazy(() => import("@/pages/ServerPage"));
const InvitePage = lazy(() => import("@/pages/InvitePage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/recover" element={<RedirectIfAuthed><RecoverPage /></RedirectIfAuthed>} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route
          path="/channels/*"
          element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route path="@me" element={<FriendsPage />} />
                  <Route path="@me/:channelId" element={<DMPage />} />
                  <Route path="@me/:channelId/:messageId" element={<DMPage />} />
                  <Route path=":serverId" element={<ServerPage />} />
                  <Route path=":serverId/:channelId" element={<ServerPage />} />
                  <Route path=":serverId/:channelId/:messageId" element={<ServerPage />} />
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
