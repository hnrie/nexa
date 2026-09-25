import { useEffect, useMemo } from "react";
import { applyTheme, rememberAppearance, rememberedAppearance } from "@/lib/theme";
import { useDesktop } from "@/stores/desktop";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

/** Keeps the document in sync with appearance settings and window focus. */
export function ThemeEffect() {
  const loaded = useSettings((s) => s.loaded);
  const settings = {
    theme: useSettings((s) => s.settings.theme),
    accent: useSettings((s) => s.settings.accent),
    fontScale: useSettings((s) => s.settings.fontScale),
    reducedMotion: useSettings((s) => s.settings.reducedMotion),
    underlineLinks: useSettings((s) => s.settings.underlineLinks),
  };
  // Until the account's settings arrive — the login page, the connecting
  // spinner, the first second of every reload — the page keeps the look this
  // device last had, which main.tsx already put on before the first render.
  // The store's defaults are not anybody's choice, only its starting point.
  // Read again whenever that changes, so signing out keeps the latest look.
  const remembered = useMemo(() => (loaded ? null : rememberedAppearance()), [loaded]);
  const { theme, accent, fontScale, reducedMotion, underlineLinks } = loaded || !remembered ? settings : remembered;
  const setFocused = useUI((s) => s.setFocused);
  const inDesktopWindow = useDesktop((d) => d.window !== null);

  useEffect(() => {
    const look = { theme, accent, fontScale, reducedMotion, underlineLinks };
    applyTheme(look);
    if (loaded) rememberAppearance(look);
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(look);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [loaded, theme, accent, fontScale, reducedMotion, underlineLinks]);

  useEffect(() => {
    // Inside the desktop app these readings are the ones that lie: the page
    // there never counts as hidden and its focus was seen to stay true with
    // another app in front, which is why DesktopEffects sets the flag from the
    // window system instead. Two writers, and whichever fired last won.
    if (inDesktopWindow) return;
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
  }, [setFocused, inDesktopWindow]);
  return null;
}
