import { useSettings } from "@/stores/settings";

/** Public media URL readers redraw when one of the independent animation preferences changes. */
export function useMediaAnimation(): void {
  useSettings((s) => [s.settings.animateAvatars, s.settings.animateIcons, s.settings.animateBanners, s.settings.animateEmoji, s.settings.animateStickers].join(","));
}
