import type { Emoji, PublicUser } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Twemoji } from "@/components/common/Twemoji";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { withTone } from "@/components/pickers/emojiIndex";
import { useEffect, useRef } from "react";
import s from "./Composer.module.css";

export type AcItem = { kind: "user"; user: PublicUser } | { kind: "emoji"; entry: EmojiEntry } | { kind: "customEmoji"; emoji: Emoji } | { kind: "command"; name: string; desc: string };

export function Autocomplete({ items, index, onHover, onPick, tone }: { items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; tone: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  // The list scrolls when it is taller than the room above the keyboard, so the
  // highlighted row is kept in view. Only the list itself is scrolled:
  // scrollIntoView would also shift the app's clipped containers.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[index + 1] as HTMLElement | undefined;
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [index, items]);
  if (items.length === 0) return null;
  const head = items[0]?.kind === "user" ? "Members" : items[0]?.kind === "emoji" || items[0]?.kind === "customEmoji" ? "Emoji" : "Commands";
  return (
    <div ref={listRef} className={s.ac} role="listbox" onMouseDown={(e) => e.preventDefault()}>
      <div className={s.acHead}>{head}</div>
      {items.map((it, i) => (
        <button key={it.kind === "user" ? it.user.id : it.kind === "emoji" ? it.entry.hexcode : it.kind === "customEmoji" ? it.emoji.id : it.name} className={s.acRow} data-selected={i === index} role="option" aria-selected={i === index} onMouseEnter={() => onHover(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
          {it.kind === "user" ? (
            <>
              <Avatar id={it.user.id} avatarId={it.user.avatar_id} name={it.user.display_name} size={24} />
              <span>{it.user.display_name}</span>
              <span className={s.acSub}>{it.user.username}</span>
            </>
          ) : it.kind === "emoji" ? (
            <>
              <Twemoji text={withTone(it.entry, tone)} className={s.acEmojiImg} fallbackClassName={s.acEmoji} />
              <span>:{it.entry.shortcodes[0] ?? it.entry.label}:</span>
            </>
          ) : it.kind === "customEmoji" ? (
            <>
              <img className={s.acEmoji} src={emojiUrl(it.emoji.blob_id, it.emoji.animated, 24)} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
              <span>:{it.emoji.name}:</span>
            </>
          ) : (
            <>
              <span>/{it.name}</span>
              <span className={s.acSub}>{it.desc}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
