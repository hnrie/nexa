import { useEffect } from "react";
import { applyTheme } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

/** Keeps the document in sync with appearance settings and window focus. */
export function ThemeEffect() {
  const theme = useSettings((s) => s.settings.theme);
  const accent = useSettings((s) => s.settings.accent);
  const fontScale = useSettings((s) => s.settings.fontScale);
  const reducedMotion = useSettings((s) => s.settings.reducedMotion);
  const underlineLinks = useSettings((s) => s.settings.underlineLinks);
  const setFocused = useUI((s) => s.setFocused);

  useEffect(() => {
    applyTheme({ theme, accent, fontScale, reducedMotion, underlineLinks });
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme({ theme, accent, fontScale, reducedMotion, underlineLinks });
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, accent, fontScale, reducedMotion, underlineLinks]);

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    const vis = () => setFocused(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [setFocused]);
  return null;
}
