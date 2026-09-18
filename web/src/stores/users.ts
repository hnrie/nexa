import { create } from "zustand";
import type { PublicUser } from "@/api/types";
import { judgeKey } from "./keyAlerts";
import { t } from "@/i18n";

interface UsersState {
  byId: Record<string, PublicUser>;
  upsert: (u: PublicUser | PublicUser[]) => void;
  get: (id: string) => PublicUser | undefined;
  clear: () => void;
}

export const useUsers = create<UsersState>()((set, get) => ({
  byId: {},
  upsert: (u) => {
    const list = Array.isArray(u) ? u : [u];
    if (list.length === 0) return;
    // Every user object the server sends carries that account's identity public
    // key, and this is the one door they all come through — ready, a member
    // joining, a profile opened, a user_update. Judging the key here means a
    // swapped one is caught when it is offered, not when it is next used.
    //
    // Guarded, because this is the path that draws every name in the app: a
    // device whose storage throws must end up less watchful, not unable to show
    // who is in the room.
    try {
      for (const user of list) judgeKey(user.id, user.public_key);
    } catch (err) {
      console.warn("keys: could not check the identity keys the server sent", err);
    }
    set((s) => {
      const byId = { ...s.byId };
      for (const user of list) byId[user.id] = user;
      return { byId };
    });
  },
  get: (id) => get().byId[id],
  clear: () => set({ byId: {} }),
}));

/** Display name with username fallback. */
export function displayName(u: PublicUser | undefined, fallback = t("names.unknownUser")): string {
  if (!u) return fallback;
  return u.display_name || u.username || fallback;
}
