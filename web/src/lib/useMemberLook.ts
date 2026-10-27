import { useMemo } from "react";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import { memberLook, type RoleLook } from "./roleLook";
import { readNameStyle } from "./nameStyle";

/**
 * How someone's name looks: in a server, their highest coloured role's colours
 * and their highest role's icon; anywhere, their own name style. Read as a
 * string so a change anywhere else in the server leaves the name (and its row)
 * alone.
 */
export function useMemberLook(serverId: string | null | undefined, userId: string | undefined, fallbackStyle?: unknown): RoleLook | undefined {
  const key = useServers((st) => {
    if (!serverId || !userId) return "";
    const look = memberLook(st.byId[serverId], userId);
    return look ? JSON.stringify(look) : "";
  });
  const ownKey = useUsers((u) => (userId ? JSON.stringify(u.byId[userId] ? (u.byId[userId]!.name_style ?? null) : (fallbackStyle ?? null)) : "null"));
  const meKey = useAuth((a) => a.me && a.me.id === userId ? JSON.stringify(a.me.name_style ?? null) : undefined);
  const styleKey = meKey ?? ownKey;
  return useMemo(() => withOwn(key ? (JSON.parse(key) as RoleLook) : undefined, JSON.parse(styleKey)), [key, styleKey]);
}

/** A look with the person's own name style added, as the name_style the server sent. */
export function withOwn(look: RoleLook | undefined, nameStyle: unknown): RoleLook | undefined {
  const own = readNameStyle(nameStyle);
  return own ? { ...look, own } : look;
}
