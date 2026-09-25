import type { Channel, PublicUser } from "@/api/types";
import { formatList, t } from "@/i18n";
import { displayName } from "@/stores/users";

/** The name shown for a DM or group DM. */
export function channelDisplayName(ch: Channel, users: Record<string, PublicUser>, meId: string | undefined, nicknames?: Record<string, string>): string {
  const name = (id: string | undefined) => (id && nicknames?.[id]) || displayName(id ? users[id] : undefined);
  if (ch.type === "dm") {
    const other = ch.recipient_ids.find((id) => id !== meId) ?? ch.recipient_ids[0];
    return name(other);
  }
  if (ch.type === "group_dm") {
    if (ch.name) return ch.name;
    const names = ch.recipient_ids.filter((id) => id !== meId).map(name);
    // joined as the language joins a list: "Ann, Bob, Carl", "Ann、Bob、Carl", "Ann, Bob und Carl"
    return names.length ? formatList(names) : t("names.unnamedGroup");
  }
  return ch.name;
}

/** Friend nicknames by user id, for channelDisplayName. */
export function friendNicknames(rels: Record<string, { nickname: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, r] of Object.entries(rels)) if (r.nickname) out[id] = r.nickname;
  return out;
}

/** A member's name in a server: nickname, else display name, else username. */
export function memberName(nickname: string | undefined, u: PublicUser | undefined, fallback = t("names.unknownUser")): string {
  if (nickname) return nickname;
  return displayName(u, fallback);
}
