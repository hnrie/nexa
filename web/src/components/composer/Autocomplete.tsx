import { AtSign, Hash } from "lucide-react";
import type { Channel, Emoji, PublicUser, Role } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Twemoji } from "@/components/common/Twemoji";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { withTone } from "@/components/pickers/emojiIndex";
import { pointerMoved } from "@/lib/pointerMoved";
import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import s from "./Composer.module.css";
import { t } from "@/i18n";

export type AcItem =
  | { kind: "user"; user: PublicUser }
  | { kind: "role"; role: Role }
  | { kind: "channel"; channel: Channel; category?: string | undefined }
  /** `name` is the code that matched what was typed, where it is not the emoji's first. */
  | { kind: "emoji"; entry: EmojiEntry; name?: string }
  | { kind: "customEmoji"; emoji: Emoji }
  | { kind: "command"; name: string; desc: string };

/** The suggestion list's ids, so the message box can say which one is chosen. */
export const AC_LIST_ID = "composer-suggestions";
export function acOptionId(i: number): string {
  return `${AC_LIST_ID}-${i}`;
}

/** What a row is filed under, for the headings between the groups. */
function groupOf(it: AcItem, kind: string): string {
  if (it.kind === "role") return t("server.members.roles");
  if (it.kind === "user" || (it.kind === "command" && kind === "user")) return t("server.serverSettings.members");
  if (it.kind === "channel") return t("servers.defaults.textChannels");
  if (it.kind === "emoji" || it.kind === "customEmoji") return t("server.emoji.emoji");
  return t("composer.autocomplete.commands");
}

function keyOf(it: AcItem): string {
  switch (it.kind) {
    case "user":
      return "u" + it.user.id;
    case "role":
      return "r" + it.role.id;
    case "channel":
      return "c" + it.channel.id;
    case "emoji":
      return "e" + it.entry.hexcode;
    case "customEmoji":
      return "x" + it.emoji.id;
    default:
      return "m" + it.name;
  }
}

/** A role's own colour for its name, mixed toward the theme's text so it reads in either theme. */
function roleStyle(role: Role): CSSProperties | undefined {
  if (!role.color) return undefined;
  return { color: `color-mix(in srgb, #${role.color.toString(16).padStart(6, "0")} 72%, var(--text-strong))` };
}

/**
 * The suggestions above the message box. `kind` is what is being typed: the
 * @everyone and @here rows are offered while typing a mention, so they read
 * as mentions there, not as commands. `heading` names the whole list in place
 * of its groups, as the emoji used most do.
 */
export function Autocomplete({ kind, items, index, onHover, onPick, tone, heading: title }: { kind: string; items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; tone: number; heading?: string | undefined }) {
  const listRef = useRef<HTMLDivElement>(null);
  // The list scrolls when it is taller than the room above the keyboard, so the
  // highlighted row is kept in view. Only the list itself is scrolled:
  // scrollIntoView would also shift the app's clipped containers.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`#${acOptionId(index)}`);
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [index, items]);
  if (items.length === 0) return null;
  return (
    <div ref={listRef} id={AC_LIST_ID} className={s.ac} role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        const group = title ?? groupOf(it, kind);
        const heading = i === 0 || (!title && groupOf(items[i - 1]!, kind) !== group) ? <div className={s.acHead} aria-hidden="true">{group}</div> : null;
        return (
          <Fragment key={keyOf(it)}>
            {heading}
            {/* only a mouse that moves picks a row: the list changes under a still one with every letter typed */}
            <button className={s.acRow} id={acOptionId(i)} data-selected={i === index} role="option" aria-selected={i === index} onMouseMove={(e) => i !== index && pointerMoved(e.nativeEvent) && onHover(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
              {it.kind === "user" ? (
                <>
                  <Avatar id={it.user.id} avatarId={it.user.avatar_id} name={it.user.display_name} size={24} />
                  <span className={s.acName}>{it.user.display_name}</span>
                  <span className={s.acSub}>{it.user.username}</span>
                </>
              ) : it.kind === "role" ? (
                <>
                  <span className={s.acIcon} style={roleStyle(it.role)} aria-hidden="true"><AtSign size={18} /></span>
                  <span className={s.acName} style={roleStyle(it.role)}>{it.role.name}</span>
                  <span className={s.acSub}>{t("composer.autocomplete.notifyRole")}</span>
                </>
              ) : it.kind === "channel" ? (
                <>
                  <span className={s.acIcon} aria-hidden="true"><Hash size={18} /></span>
                  <span className={s.acName}>{it.channel.name}</span>
                  {it.category ? <span className={s.acSub}>{it.category}</span> : null}
                </>
              ) : it.kind === "emoji" ? (
                <>
                  <Twemoji text={withTone(it.entry, tone)} className={s.acEmojiImg} fallbackClassName={s.acEmoji} />
                  <span className={s.acName}>:{it.name ?? it.entry.shortcodes[0] ?? it.entry.label}:</span>
                </>
              ) : it.kind === "customEmoji" ? (
                <>
                  <img className={s.acEmojiImg} src={emojiUrl(it.emoji.blob_id, it.emoji.animated, 24)} alt="" />
                  <span className={s.acName}>:{it.emoji.name}:</span>
                </>
              ) : kind === "user" ? (
                <>
                  <span className={s.acIcon} aria-hidden="true"><AtSign size={18} /></span>
                  <span className={s.acName}>{it.name}</span>
                  <span className={s.acSub}>{it.desc}</span>
                </>
              ) : (
                <>
                  <span className={s.acName}>/{it.name}</span>
                  <span className={s.acSub}>{it.desc}</span>
                </>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
