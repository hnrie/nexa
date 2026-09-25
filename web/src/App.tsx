import { Suspense, useEffect } from "react";
import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { AppLockEffect } from "@/components/shell/AppLockEffect";
import { ErrorBoundary, markHealthy } from "@/components/shell/ErrorBoundary";
import { lazyPage, markChunksHealthy } from "@/lib/lazyChunk";
import { ThemeEffect } from "@/components/shell/ThemeEffect";
import { I18nProvider } from "@/i18n";
import { useNexa } from "@/stores/nexa";
import { useAppLocale } from "@/lib/appLocale";
import { AppRoutes } from "./routes";

// Shown once in an account's life, if ever; the front page and the sign-in
// page need not download it on the chance.
const DeletedNotice = lazyPage(() => import("@/components/nexa/NexaNotices").then((m) => ({ default: m.DeletedNotice })));

/** The notice a moderator's deletion leaves, read on the way out of the app. */
function AccountDeletedNotice() {
  const deleted = useNexa((n) => n.deleted);
  if (!deleted) return null;
  return (
    <Suspense fallback={null}>
      <DeletedNotice />
    </Suspense>
  );
}

export default function App() {
  useEffect(markHealthy, []);
  useEffect(markChunksHealthy, []);
  // The account carries the choice, so signing in anywhere is in the same
  // language; with none set the browser's own preference decides.
  const locale = useAppLocale();
  return (
    <ErrorBoundary>
      <I18nProvider locale={locale}>
        <ThemeEffect />
        <AppLockEffect />
        <AppRoutes />
        <ContextMenuHost />
        <AccountDeletedNotice />
        <Toasts />
      </I18nProvider>
    </ErrorBoundary>
  );
}
