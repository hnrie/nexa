import { create } from "zustand";
import type { Staged } from "@/lib/attachments";

interface UploadsState {
  /**
   * Each conversation's tray: files picked and not sent yet. It lives here
   * rather than in the message box, so a file picked in one conversation is
   * still waiting there after a look at another.
   */
  trays: Record<string, Staged[]>;
  add: (channelId: string, files: Staged[]) => void;
  update: (channelId: string, ids: Iterable<string>, patch: Partial<Staged>) => void;
  /** Takes files out of a tray, and lets go of their previews. */
  remove: (channelId: string, ids: Iterable<string>) => void;
  /** Empties a tray into a message being sent; the message keeps the previews. */
  take: (channelId: string) => Staged[];
  /** Forgets every tray (sign-out). */
  clear: () => void;
}

function revoke(files: Staged[]): void {
  for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
}

function without(trays: Record<string, Staged[]>, channelId: string, left: Staged[]): Record<string, Staged[]> {
  const next = { ...trays };
  if (left.length) next[channelId] = left;
  else delete next[channelId];
  return next;
}

export const useUploads = create<UploadsState>()((set, get) => ({
  trays: {},
  add: (channelId, files) => set((s) => ({ trays: { ...s.trays, [channelId]: [...(s.trays[channelId] ?? []), ...files] } })),
  update: (channelId, ids, patch) =>
    set((s) => {
      const tray = s.trays[channelId];
      if (!tray) return s;
      const hit = new Set(ids);
      return { trays: { ...s.trays, [channelId]: tray.map((f) => (hit.has(f.id) ? { ...f, ...patch } : f)) } };
    }),
  remove: (channelId, ids) => {
    const tray = get().trays[channelId];
    if (!tray) return;
    const hit = new Set(ids);
    revoke(tray.filter((f) => hit.has(f.id)));
    set((s) => ({ trays: without(s.trays, channelId, (s.trays[channelId] ?? []).filter((f) => !hit.has(f.id))) }));
  },
  take: (channelId) => {
    const tray = get().trays[channelId] ?? [];
    if (tray.length) set((s) => ({ trays: without(s.trays, channelId, []) }));
    return tray;
  },
  clear: () => {
    for (const tray of Object.values(get().trays)) revoke(tray);
    set({ trays: {} });
  },
}));
