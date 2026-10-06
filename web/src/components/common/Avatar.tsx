import type { CSSProperties, ReactNode } from "react";
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
  /** Someone talking in a call: a ring round the picture, cut round the presence dot. */
  "data-speaking"?: boolean;
  /** A presence dot of this size instead of the one that goes with the avatar's size, as a profile's big avatar has. */
  dotSize?: number;
  /**
   * Someone is typing (in the conversation the avatar stands for): the
   * presence dot grows into a pill with three dots in it, in the status's
   * colour. Never for someone who shows as offline, invisible included.
   * Leave it out where typing can never show; set, the cut round the dot can
   * grow with it.
   */
  typing?: boolean;
  /** Drawn in place of the picture, with the dot and its cut kept: a group's glyph. */
  face?: ReactNode;
}

/** Whether a status shows typing on its dot: whoever shows as offline (or invisible) shows nothing. */
export function showsTyping(status: StatusKind | null | undefined): boolean {
  return status === "online" || status === "idle" || status === "dnd";
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
export function Avatar({ id, avatarId, name, size = 32, status = null, className, square = false, style, kind = "avatar", "data-speaking": speaking, dotSize, typing, face }: Props) {
  const url = kind === "icon" ? iconUrl(avatarId, size) : avatarUrl(avatarId, size);
  const geometry = statusGeometry(size);
  const dot = dotSize ?? geometry.dot;
  const ring = dotSize ? Math.max(2, Math.round(dotSize * 0.28)) : geometry.ring;
  // the dot sits in the corner and bites a ring out of the picture, so it reads on any background
  const vars = status ? ({ "--dot": `${dot}px`, "--cut": `${dot / 2 + ring}px`, "--ring": `${ring}px` } as CSSProperties) : undefined;
  // where typing can show, the cut is the one that grows into a pill with the dot (Avatar.module.css)
  const typable = typing !== undefined;
  const pill = !!typing && showsTyping(status);
  const cut = status ? (typable ? s.cutPill : s.cut) : "";
  return (
    <span className={[s.wrap, status ? s.hasDot : "", typable ? s.typable : "", className ?? ""].join(" ")} style={{ width: size, height: size, ...vars, ...style }} data-speaking={speaking === undefined ? undefined : speaking} data-typing={typable ? pill : undefined}>
      {face ? (
        <span className={[s.face, cut].join(" ")} aria-hidden="true">{face}</span>
      ) : url ? (
        <img className={[s.img, square ? s.square : "", cut].join(" ")} src={url} alt="" width={size} height={size} draggable={false} loading="lazy" />
      ) : (
        <span className={[s.fallback, square ? s.square : "", cut].join(" ")} style={{ background: avatarColor(id), fontSize: Math.max(10, size * 0.42) }} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {status ? (
        <>
          <span className={[s.status, s[status]].join(" ")} title={statusLabel(status)} data-status={status} data-typing={pill || undefined} aria-hidden="true">
            {pill ? (
              <span className={s.typingDots} data-testid="typing-dot">
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </span>
          {/* The shapes are distinct enough to read without colour, but `title`
              on a role-less span is not reliably announced and a touch screen
              never shows it at all. Online or offline is one of the most
              consulted facts in the app; it gets words. */}
          <span className="visually-hidden">{pill ? t("presence.statusTyping", { status: statusLabel(status) }) : statusLabel(status)}</span>
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
