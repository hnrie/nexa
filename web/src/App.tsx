import { useEffect } from "react";
import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { AppLockEffect } from "@/components/shell/AppLockEffect";
import { ErrorBoundary, markHealthy } from "@/components/shell/ErrorBoundary";
import { markChunksHealthy } from "@/lib/lazyChunk";
import { ThemeEffect } from "@/components/shell/ThemeEffect";
import { AppRoutes } from "./routes";

export default function App() {
  useEffect(markHealthy, []);
  useEffect(markChunksHealthy, []);
  return (
    <ErrorBoundary>
      <ThemeEffect />
      <AppLockEffect />
      <AppRoutes />
      <ContextMenuHost />
      <Toasts />
    </ErrorBoundary>
  );
}
