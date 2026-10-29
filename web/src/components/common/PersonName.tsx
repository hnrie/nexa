import { useEffect, type HTMLAttributes } from "react";
import { nameClass, nameStyle } from "@/lib/roleLook";
import { useMemberLook } from "@/lib/useMemberLook";
import { useAuth } from "@/stores/auth";
import { fetchMissingUsers, useUsers } from "@/stores/users";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  userId?: string | null;
  serverId?: string | null;
  /** A list's profile snapshot, used until the live user store knows them. */
  user?: { id: string; name_style?: unknown } | null;
  /** Suppress the profile's custom font and name effect in compact identity labels such as mentions. */
  showNameStyle?: boolean;
}

/** Uses the live profile's style by default while keeping its supplied nickname/text. */
export function PersonName({ userId, serverId, user, children, className, style, showNameStyle = true, ...props }: Props) {
  const id = userId ?? user?.id;
  const known = useUsers((s) => id ? s.byId[id] : undefined);
  const me = useAuth((s) => s.me?.id === id ? s.me : null);
  const look = useMemberLook(serverId, id, me ? me.name_style : user?.name_style, showNameStyle);
  useEffect(() => {
    if (id && !known && !me && user?.name_style === undefined) fetchMissingUsers([id]);
  }, [id, known, me, user?.name_style]);
  return <span dir="auto" {...props} className={["person-name", className, nameClass(look)].filter(Boolean).join(" ") || undefined} style={{ ...style, ...nameStyle(look) }}>{children}</span>;
}
