import { useMemo } from "react";
import { useServers } from "@/stores/servers";
import { memberLook, type RoleLook } from "./roleLook";

/**
 * How a member's name looks in a server, kept current. Read as a string so a
 * change anywhere else in the server leaves the name (and its row) alone.
 */
export function useMemberLook(serverId: string | null | undefined, userId: string | undefined): RoleLook | undefined {
  const key = useServers((st) => {
    if (!serverId || !userId) return "";
    const look = memberLook(st.byId[serverId], userId);
    return look ? JSON.stringify(look) : "";
  });
  return useMemo(() => (key ? (JSON.parse(key) as RoleLook) : undefined), [key]);
}
