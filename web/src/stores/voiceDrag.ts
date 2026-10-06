import { create } from "zustand";

/** Someone being dragged out of a voice channel by a moderator, to drop on another. */
export interface VoiceDrag {
  serverId: string;
  userId: string;
  /** The channel they are in. */
  from: string;
}

interface VoiceDragStore {
  drag: VoiceDrag | null;
  /** The voice channel the drag is over and could land in, lit up in the sidebar. */
  over: string | null;
  start: (d: VoiceDrag) => void;
  hover: (channelId: string | null) => void;
  end: () => void;
}

/**
 * A drag of a person from one voice channel to another (VoiceParticipants
 * starts it, ServerSidebar takes the drop). HTML drag and drop hides what is
 * dragged from everything but the drop, so the sidebar reads it from here.
 */
export const useVoiceDrag = create<VoiceDragStore>()((set) => ({
  drag: null,
  over: null,
  start: (drag) => set({ drag, over: null }),
  hover: (over) => set((s) => (s.over === over ? s : { over })),
  end: () => set({ drag: null, over: null }),
}));
