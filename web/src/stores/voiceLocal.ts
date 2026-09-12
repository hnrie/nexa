import { create } from "zustand";

/** Local mic/speaker state; the voice transport (phase 4) reads these. */
interface VoiceLocalState {
  muted: boolean;
  deafened: boolean;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
}

export const useVoiceLocal = create<VoiceLocalState>()((set) => ({
  muted: false,
  deafened: false,
  toggleMute: () => set((s) => ({ muted: !s.muted, deafened: s.deafened && !s.muted ? false : s.deafened })),
  toggleDeafen: () => set((s) => (s.deafened ? { deafened: false, muted: false } : { deafened: true, muted: true })),
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) => set({ deafened }),
}));
