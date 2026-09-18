import type { CSSProperties } from "react";
import { avatarUrl, iconUrl } from "@/api/users";
import { avatarColor, initials } from "@/lib/avatarColor";
import type { StatusKind } from "@/stores/presence";
import s from "./Avatar.module.css";

import { t } from "@/i18n";
interface Props {
  id: string;
  avatarId: string | null;
  name: string;
  size?: number;
  status?: StatusKind | null;
  className?: string;
  square?: boolean;
  style?: CSSProperties;
  /** A group's icon is a picture of its own kind; a person's avatar is the default. */
  kind?: "avatar" | "icon";
  /** Marks someone talking in a call, for a ring drawn by the caller's own styles. */
  "data-speaking"?: boolean;
  /** A presence dot of this size instead of the one that goes with the avatar's size, as a profile's big avatar has. */
  dotSize?: number;
}

/**
 * How big a presence dot is on an avatar of this size, and how wide a ring it
 * cuts out of the picture around itself: 10 px with a 3 px ring on a 32 px
 * avatar, as Discord draws it, growing more slowly than the avatar after that.
 */
export function statusGeometry(size: number): { dot: number; ring: number } {
  const dot = Math.round(Math.max(8, Math.min(size * 0.3125, 10 + (size - 32) * 0.125)));
  return { dot, ring: Math.max(2, Math.round(dot * 0.3)) };
}

/** A user or group avatar with an optional presence dot. Animated avatars play as-is. */
export function Avatar({ id, avatarId, name, size = 32, status = null, className, square = false, style, kind = "avatar", "data-speaking": speaking, dotSize }: Props) {
  const url = kind === "icon" ? iconUrl(avatarId, size) : avatarUrl(avatarId, size);
  const geometry = statusGeometry(size);
  const dot = dotSize ?? geometry.dot;
  const ring = dotSize ? Math.max(2, Math.round(dotSize * 0.28)) : geometry.ring;
  // the dot sits in the corner and bites a ring out of the picture, so it reads on any background
  const vars = status ? ({ "--dot": `${dot}px`, "--cut": `${dot / 2 + ring}px` } as CSSProperties) : undefined;
  const cut = status ? s.cut : "";
  return (
    <span className={[s.wrap, className ?? ""].join(" ")} style={{ width: size, height: size, ...vars, ...style }} data-speaking={speaking === undefined ? undefined : speaking}>
      {url ? (
        <img className={[s.img, square ? s.square : "", cut].join(" ")} src={url} alt="" width={size} height={size} draggable={false} loading="lazy" />
      ) : (
        <span className={[s.fallback, square ? s.square : "", cut].join(" ")} style={{ background: avatarColor(id), fontSize: Math.max(10, size * 0.42) }} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {status ? (
        <>
          <span className={[s.status, s[status]].join(" ")} title={statusLabel(status)} data-status={status} aria-hidden="true" />
          {/* The shapes are distinct enough to read without colour, but `title`
              on a role-less span is not reliably announced and a touch screen
              never shows it at all. Online or offline is one of the most
              consulted facts in the app; it gets words. */}
          <span className="visually-hidden">{statusLabel(status)}</span>
        </>
      ) : null}
    </span>
  );
}

/** A presence dot on its own, drawn in the same shapes as on avatars: for menus that list the statuses. */
export function StatusDot({ status, size = 10, className }: { status: StatusKind; size?: number; className?: string }) {
  return <span className={[s.status, s.alone, s[status], className ?? ""].join(" ")} style={{ "--dot": `${size}px` } as CSSProperties} aria-hidden="true" />;
}

export function statusLabel(st: StatusKind): string {
  switch (st) {
    case "online":
      return t("shell.user.online");
    case "idle":
      return t("shell.user.idle");
    case "dnd":
      return t("shell.user.doNotDisturb");
    case "invisible":
      return t("shell.user.invisible");
    default:
      return t("chat.memberList.offline");
  }
}
