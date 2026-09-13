import type { CSSProperties } from "react";
import { avatarUrl } from "@/api/users";
import { avatarColor, initials } from "@/lib/avatarColor";
import type { StatusKind } from "@/stores/presence";
import s from "./Avatar.module.css";

interface Props {
  id: string;
  avatarId: string | null;
  name: string;
  size?: number;
  status?: StatusKind | null;
  className?: string;
  square?: boolean;
  style?: CSSProperties;
}

/** A user or group avatar with an optional presence dot. Animated avatars play as-is. */
export function Avatar({ id, avatarId, name, size = 32, status = null, className, square = false, style }: Props) {
  const url = avatarUrl(avatarId, size);
  const dot = Math.max(8, Math.round(size * 0.3125));
  return (
    <span className={[s.wrap, className ?? ""].join(" ")} style={{ width: size, height: size, ...style }}>
      {url ? (
        <img className={[s.img, square ? s.square : ""].join(" ")} src={url} alt="" width={size} height={size} draggable={false} loading="lazy" />
      ) : (
        <span className={[s.fallback, square ? s.square : ""].join(" ")} style={{ background: avatarColor(id), fontSize: Math.max(10, size * 0.42) }} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {status ? (
        <span className={[s.status, s[status]].join(" ")} style={{ width: dot, height: dot, borderWidth: Math.max(2, Math.round(dot * 0.25)) }} title={statusLabel(status)} />
      ) : null}
    </span>
  );
}

export function statusLabel(st: StatusKind): string {
  switch (st) {
    case "online":
      return "Online";
    case "idle":
      return "Idle";
    case "dnd":
      return "Do Not Disturb";
    case "invisible":
      return "Invisible";
    default:
      return "Offline";
  }
}
