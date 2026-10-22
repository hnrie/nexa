import type { CSSProperties } from "react";
import type { Role } from "@/api/types";
import type { ServerState } from "@/stores/servers";
import { nameStyleClass, nameStyleVars, type NameStyle } from "./nameStyle";

/** A role's picture beside names: one of its own, an emoji, or one of the server's emoji. */
export type RoleIconInfo = { kind: "image"; id: string; name: string } | { kind: "emoji"; text: string; name: string } | { kind: "custom"; id: string; name: string };

/** How a member's name is drawn in a server: their highest coloured role's colours, and their highest role's icon. */
export interface RoleLook {
  color?: string;
  /** Two or three colours: the name is drawn in a gradient of them. */
  colors?: string[];
  /** Three colours shimmer across the name. */
  shimmer?: boolean;
  icon?: RoleIconInfo;
  /** The person's own name style (lib/nameStyle.ts): its font always shows, its colours only without a role colour. */
  own?: NameStyle;
}

export function hexOf(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** A role's own icon, if it has one. */
export function roleIconOf(r: Role): RoleIconInfo | undefined {
  if (r.icon_id) return { kind: "image", id: r.icon_id, name: r.name };
  if (r.icon_emoji?.startsWith("custom:")) return { kind: "custom", id: r.icon_emoji.slice(7), name: r.name };
  if (r.icon_emoji) return { kind: "emoji", text: r.icon_emoji, name: r.name };
  return undefined;
}

/** The colours a role draws names in: one, or a gradient of two or three. */
export function roleColors(r: Role): string[] {
  if (!r.color) return [];
  const out = [hexOf(r.color)];
  if (r.color2 != null) out.push(hexOf(r.color2));
  if (r.color2 != null && r.color3 != null) out.push(hexOf(r.color3));
  return out;
}

const looks = new WeakMap<ServerState, Map<string, RoleLook | null>>();

/** How a member's name looks in a server, worked out once per state of it. */
export function memberLook(st: ServerState | undefined, userId: string): RoleLook | undefined {
  if (!st) return undefined;
  let byUser = looks.get(st);
  if (!byUser) {
    byUser = new Map();
    looks.set(st, byUser);
  }
  const had = byUser.get(userId);
  if (had !== undefined) return had ?? undefined;
  const m = st.members[userId];
  let colored: Role | undefined;
  let iconed: Role | undefined;
  for (const id of m?.role_ids ?? []) {
    const r = st.roles[id];
    if (!r) continue;
    if (r.color !== 0 && (!colored || r.position > colored.position)) colored = r;
    if ((r.icon_id || r.icon_emoji) && (!iconed || r.position > iconed.position)) iconed = r;
  }
  let look: RoleLook | null = null;
  if (colored || iconed) {
    look = {};
    if (colored) {
      const colors = roleColors(colored);
      look.color = colors[0];
      if (colors.length > 1) look.colors = colors;
      if (colors.length > 2) look.shimmer = true;
    }
    const icon = iconed ? roleIconOf(iconed) : undefined;
    if (icon) look.icon = icon;
  }
  byUser.set(userId, look);
  return look ?? undefined;
}

/** The style that draws a name in a look's colours (a gradient goes with the role-gradient class), and in the person's own style. */
export function nameStyle(look: RoleLook | undefined): CSSProperties | undefined {
  const own = nameStyleVars(look?.own ?? null, !!look?.color);
  if (!look?.color) return own;
  if (!look.colors) return { ...own, color: look.color };
  const stops = look.shimmer ? [...look.colors, look.colors[0]!] : look.colors;
  return { ...own, "--name-grad": `linear-gradient(90deg, ${stops.join(", ")})`, color: look.color } as CSSProperties;
}

/** The class a gradient name takes, beside nameStyle, and the person's own style's. */
export function nameClass(look: RoleLook | undefined): string {
  const own = nameStyleClass(look?.own ?? null, !!look?.color);
  const role = !look?.colors ? "" : look.shimmer ? "role-gradient role-shimmer" : "role-gradient";
  return [role, own].filter(Boolean).join(" ");
}
