import type { Settings } from "@/stores/settings";

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
}

export function resolveTheme(theme: Settings["theme"]): "dark" | "light" | "ash" | "onyx" {
  if (theme !== "system") return theme;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

/** Applies theme, accent, font scale and motion preferences to the document. */
export function applyTheme(s: Pick<Settings, "theme" | "accent" | "fontScale" | "reducedMotion" | "underlineLinks">): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(s.theme);
  if (resolved === "dark") delete root.dataset["theme"];
  else root.dataset["theme"] = resolved;
  root.style.setProperty("--font-scale", String(Math.min(1.5, Math.max(0.75, s.fontScale || 1))));
  const accent = s.accent ? hexToHsl(s.accent) : null;
  if (accent) {
    root.style.setProperty("--brand", hsl(accent.h, accent.s, accent.l));
    root.style.setProperty("--brand-hover", hsl(accent.h, accent.s, Math.max(0, accent.l - 0.1)));
    root.style.setProperty("--brand-active", hsl(accent.h, accent.s, Math.max(0, accent.l - 0.18)));
    root.style.setProperty("--mention-bg", `hsl(${accent.h.toFixed(1)} ${(accent.s * 100).toFixed(1)}% ${(accent.l * 100).toFixed(1)}% / 0.24)`);
    root.style.setProperty("--text-brand", hsl(accent.h, Math.min(1, accent.s + 0.1), Math.min(0.9, accent.l + 0.2)));
  } else {
    for (const v of ["--brand", "--brand-hover", "--brand-active", "--mention-bg", "--text-brand"]) root.style.removeProperty(v);
  }
  root.dataset["reducedMotion"] = s.reducedMotion ? "true" : "false";
  root.dataset["underlineLinks"] = s.underlineLinks ? "true" : "false";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f3f3f4" : resolved === "onyx" ? "#000000" : resolved === "ash" ? "#1a1a1e" : "#2c2d32");
}
