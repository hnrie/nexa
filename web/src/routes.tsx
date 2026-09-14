import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { lazyPage } from "@/lib/lazyChunk";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { AppShell } from "@/components/shell/AppShell";
import { RedirectIfAuthed, RequireAuth } from "@/components/shell/RequireAuth";

const LoginPage = lazyPage(() => import("@/pages/LoginPage"));
const RegisterPage = lazyPage(() => import("@/pages/RegisterPage"));
const RecoverPage = lazyPage(() => import("@/pages/RecoverPage"));
const FriendsPage = lazyPage(() => import("@/pages/FriendsPage"));
const DMPage = lazyPage(() => import("@/pages/DMPage"));
const ServerPage = lazyPage(() => import("@/pages/ServerPage"));
const InvitePage = lazyPage(() => import("@/pages/InvitePage"));
const StickerPackPage = lazyPage(() => import("@/pages/StickerPackPage"));
const DownloadPage = lazyPage(() => import("@/pages/DownloadPage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/stickers/pack/:packId" element={<RequireAuth><StickerPackPage /></RequireAuth>} />
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
