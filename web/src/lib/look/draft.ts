import { create } from "zustand";
import type { ThemeDraft } from "@/lib/theme";

/**
 * What is being tried on but not saved yet: a theme open in the builder, or
 * CSS being typed. ThemeEffect and the custom CSS layer draw these over the
 * saved look, so the whole app is the preview; dropping the draft puts the
 * saved look back.
 */
interface DraftState {
  theme: ThemeDraft | null;
  /** CSS typed on the Custom CSS page, in place of the saved snippet while it is open. */
  css: string | null;
  setTheme: (d: ThemeDraft | null) => void;
  setCss: (css: string | null) => void;
}

export const useLookDraft = create<DraftState>()((set) => ({
  theme: null,
  css: null,
  setTheme: (theme) => set({ theme }),
  setCss: (css) => set({ css }),
}));
