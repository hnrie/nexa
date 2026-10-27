import { PersonName } from "@/components/common/PersonName";
import { Hash } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { channelsFor, peopleFor, rolesFor } from "@/lib/pickables";
import { useChannels } from "@/stores/channels";
import { displayName, useUsers } from "@/stores/users";
import type { Choice } from "./SelectBox";
import s from "./SelectBox.module.css";

/** What an app can ask someone to pick: people, roles, both, or channels. */
export type EntityKind = "user" | "role" | "mentionable" | "channel";

/** The people, roles or channels of where something was used, as choices, for what was typed. */
export function entityChoices(kind: EntityKind, channelId: string, query: string, channelTypes?: readonly number[]): Choice[] {
  const out: Choice[] = [];
  if (kind === "user" || kind === "mentionable") {
    for (const u of peopleFor(channelId, query)) out.push({ value: u.id, label: displayName(u), labelNode: <PersonName user={u} serverId={useChannels.getState().byId[channelId]?.server_id}>{displayName(u)}</PersonName>, description: u.username, picture: <Avatar id={u.id} avatarId={u.avatar_id} name={displayName(u)} size={24} /> });
  }
  if (kind === "role" || kind === "mentionable") {
    for (const r of rolesFor(channelId, query)) {
      const color = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : undefined;
      out.push({ value: r.id, label: r.name, picture: <span className={s.roleDot} style={color ? { background: color } : undefined} aria-hidden="true" /> });
    }
  }
  if (kind === "channel") {
    for (const ch of channelsFor(channelId, query, channelTypes)) out.push({ value: ch.id, label: ch.name, picture: <Hash size={18} aria-hidden="true" style={{ flex: "none", color: "var(--icon)", marginInline: 3 }} /> });
  }
  return out;
}

/** The words a picked person, role or channel shows with. */
export function entityLabel(channelId: string, value: string): string {
  const users = useUsers.getState().byId;
  if (users[value]) return displayName(users[value]);
  const ch = useChannels.getState().byId[value];
  if (ch) return `#${ch.name}`;
  const role = rolesFor(channelId, "", 1000).find((r) => r.id === value);
  return role?.name ?? value;
}

/** The kind of entity a select component (5 to 8) or a command option (6 to 9) asks for. */
export function entityKindOfComponent(type: number): EntityKind | null {
  return type === 5 ? "user" : type === 6 ? "role" : type === 7 ? "mentionable" : type === 8 ? "channel" : null;
}

/** Rich identity labels, keeping entityLabel's string for search and accessibility. */
export function entityLabelNode(channelId: string, value: string, kind: EntityKind) {
  return <EntityPersonLabel channelId={channelId} value={value} kind={kind} />;
}

/** Selected people follow a fetched profile or rename without requiring their app form to render. */
function EntityPersonLabel({ channelId, value, kind }: { channelId: string; value: string; kind: EntityKind }) {
  const user = useUsers((u) => u.byId[value]);
  const serverId = useChannels((c) => c.byId[channelId]?.server_id);
  const text = user ? displayName(user) : entityLabel(channelId, value);
  return kind === "user" || user ? <PersonName userId={value} user={user} serverId={serverId}>{text}</PersonName> : text;
}
