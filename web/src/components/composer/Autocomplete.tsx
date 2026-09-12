import type { PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { withTone } from "@/components/pickers/emojiIndex";
import s from "./Composer.module.css";

export type AcItem = { kind: "user"; user: PublicUser } | { kind: "emoji"; entry: EmojiEntry } | { kind: "command"; name: string; desc: string };

export function Autocomplete({ items, index, onHover, onPick, tone }: { items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; tone: number }) {
  if (items.length === 0) return null;
  const head = items[0]?.kind === "user" ? "Members" : items[0]?.kind === "emoji" ? "Emoji" : "Commands";
  return (
    <div className={s.ac} role="listbox">
      <div className={s.acHead}>{head}</div>
      {items.map((it, i) => (
        <button key={it.kind === "user" ? it.user.id : it.kind === "emoji" ? it.entry.hexcode : it.name} className={s.acRow} data-selected={i === index} role="option" aria-selected={i === index} onMouseEnter={() => onHover(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
          {it.kind === "user" ? (
            <>
              <Avatar id={it.user.id} avatarId={it.user.avatar_id} name={it.user.display_name} size={24} />
              <span>{it.user.display_name}</span>
              <span className={s.acSub}>{it.user.username}</span>
            </>
          ) : it.kind === "emoji" ? (
            <>
              <span className={s.acEmoji}>{withTone(it.entry, tone)}</span>
              <span>:{it.entry.shortcodes[0] ?? it.entry.label}:</span>
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
