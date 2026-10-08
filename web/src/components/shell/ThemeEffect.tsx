import { useEffect, useMemo } from "react";
import { useToday } from "@/components/common/SeasonalPerch";
import { applyTheme, rememberAppearance, rememberedAppearance, type Appearance } from "@/lib/theme";
import { sanitizeThemes } from "@/lib/look/customTheme";
import { useLookDraft } from "@/lib/look/draft";
import { seasonalOrDefault } from "@/lib/look/seasonal";
import { useDesktop } from "@/stores/desktop";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

/** Keeps the document in sync with appearance settings and window focus. */
export function ThemeEffect() {
  const loaded = useSettings((s) => s.loaded);
  const theme = useSettings((s) => s.settings.theme);
  const accent = useSettings((s) => s.settings.accent);
  const fontScale = useSettings((s) => s.settings.fontScale);
  const fontFace = useSettings((s) => s.settings.fontFace);
  const reducedMotion = useSettings((s) => s.settings.reducedMotion);
  const underlineLinks = useSettings((s) => s.settings.underlineLinks);
  const rawThemes = useSettings((s) => s.settings.customThemes);
  const systemThemes = useSettings((s) => s.settings.systemThemes);
  const draft = useLookDraft((d) => d.theme);
  // Checked once per change of the list, not per render: it arrives from other devices too.
  const customThemes = useMemo(() => sanitizeThemes(rawThemes), [rawThemes]);
  // Until the account's settings arrive — the login page, the connecting
  // spinner, the first second of every reload — the page keeps the look this
  // device last had, which main.tsx already put on before the first render.
  // The store's defaults are not anybody's choice, only its starting point.
  // Read again whenever that changes, so signing out keeps the latest look.
  const remembered = useMemo(() => (loaded ? null : rememberedAppearance()), [loaded]);
  const look: Appearance = useMemo(
    () => (loaded || !remembered ? { theme, accent, fontScale, fontFace, reducedMotion, underlineLinks, customThemes, systemThemes } : remembered),
    [loaded, remembered, theme, accent, fontScale, fontFace, reducedMotion, underlineLinks, customThemes, systemThemes],
  );
  const patch = useSettings((s) => s.patch);
  const today = useToday();
  const setFocused = useUI((s) => s.setFocused);
  const inDesktopWindow = useDesktop((d) => d.window !== null);

  // A seasonal theme is worn only while its season lasts. Once it is over the
  // account goes back to the default theme, rather than drawing as Dark and
  // coming back by itself the next year.
  useEffect(() => {
    if (!loaded) return;
    const now = seasonalOrDefault(theme, today);
    if (now !== theme) patch({ theme: now });
  }, [loaded, theme, today, patch]);

  useEffect(() => {
    applyTheme(look, draft);
    // a theme being tried on in the builder is not anybody's choice yet
    if (loaded && !draft) rememberAppearance(look);
    if (look.theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(look, draft);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // today: a season ending while the app is open is drawn as over at once
  }, [loaded, look, draft, today]);

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
