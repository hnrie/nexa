import { useEffect } from "react";
import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { AppLockEffect } from "@/components/shell/AppLockEffect";
import { ErrorBoundary, markHealthy } from "@/components/shell/ErrorBoundary";
import { markChunksHealthy } from "@/lib/lazyChunk";
import { ThemeEffect } from "@/components/shell/ThemeEffect";
import { I18nProvider } from "@/i18n";
import { useSettings } from "@/stores/settings";
import { AppRoutes } from "./routes";

export default function App() {
  useEffect(markHealthy, []);
  useEffect(markChunksHealthy, []);
  // The account carries the choice, so signing in anywhere is in the same
  // language; with none set the browser's own preference decides.
  const locale = useSettings((s) => s.settings.locale);
  return (
    <ErrorBoundary>
      <I18nProvider locale={locale}>
        <ThemeEffect />
        <AppLockEffect />
        <AppRoutes />
        <ContextMenuHost />
        <Toasts />
      </I18nProvider>
    </ErrorBoundary>
  );
}
