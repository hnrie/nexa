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
  // Deafening also mutes, so unmuting has to undeafen too, or the mic shows on
  // while nothing is sent and nothing is heard.
  toggleMute: () => set((s) => (s.muted ? { muted: false, deafened: false } : { muted: true })),
  toggleDeafen: () => set((s) => (s.deafened ? { deafened: false, muted: false } : { deafened: true, muted: true })),
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) => set({ deafened }),
}));
