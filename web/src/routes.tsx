import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { lazyPage } from "@/lib/lazyChunk";
import { FullScreenSpinner } from "@/components/common/Spinner";
import { AppShell } from "@/components/shell/AppShell";
import { RedirectIfAuthed, RequireAuth } from "@/components/shell/RequireAuth";

const HomePage = lazyPage(() => import("@/pages/HomePage"));
const LoginPage = lazyPage(() => import("@/pages/LoginPage"));
const RegisterPage = lazyPage(() => import("@/pages/RegisterPage"));
const RecoverPage = lazyPage(() => import("@/pages/RecoverPage"));
const FriendsPage = lazyPage(() => import("@/pages/FriendsPage"));
const DMPage = lazyPage(() => import("@/pages/DMPage"));
const ServerPage = lazyPage(() => import("@/pages/ServerPage"));
const InvitePage = lazyPage(() => import("@/pages/InvitePage"));
const StickerPackPage = lazyPage(() => import("@/pages/StickerPackPage"));
const DownloadPage = lazyPage(() => import("@/pages/DownloadPage"));
const GuestCallPage = lazyPage(() => import("@/pages/GuestCallPage"));
const LegalPage = lazyPage(() => import("@/pages/LegalPage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/terms" element={<LegalPage page="terms" />} />
        <Route path="/privacy" element={<LegalPage page="privacy" />} />
        <Route path="/about" element={<LegalPage page="about" />} />
        {/* a guest link: the call and nothing else, with no account */}
        <Route path="/call/:code" element={<GuestCallPage />} />
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
