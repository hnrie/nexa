import type { Channel, PublicUser } from "@/api/types";
import { displayName } from "@/stores/users";

/** The name shown for a DM or group DM. */
export function channelDisplayName(ch: Channel, users: Record<string, PublicUser>, meId: string | undefined): string {
  if (ch.type === "dm") {
    const other = ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0];
    return displayName(other ? users[other] : undefined);
  }
  if (ch.type === "group_dm") {
    if (ch.name) return ch.name;
    const names = ch.recipient_ids.filter((id) => id !== meId).map((id) => displayName(users[id]));
    return names.length ? names.join(", ") : "Unnamed group";
  }
  return ch.name;
}

/** A member's name in a server: nickname, else display name, else username. */
export function memberName(nickname: string | undefined, u: PublicUser | undefined, fallback = "Unknown User"): string {
  if (nickname) return nickname;
  return displayName(u, fallback);
}
