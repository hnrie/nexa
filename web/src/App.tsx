import { ContextMenuHost } from "@/components/common/ContextMenu";
import { Toasts } from "@/components/common/Toasts";
import { ThemeEffect } from "@/components/shell/ThemeEffect";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <>
      <ThemeEffect />
      <AppRoutes />
      <ContextMenuHost />
      <Toasts />
    </>
  );
}
