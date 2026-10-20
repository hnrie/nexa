import { AtSign, Hash, SquareSlash } from "lucide-react";
import type { Channel, Emoji, PublicUser, Role } from "@/api/types";
import type { CommandApp } from "@/api/apps";
import type { CommandLeaf } from "@/lib/apps";
import { emojiUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Twemoji } from "@/components/common/Twemoji";
import type { EmojiEntry } from "@/components/pickers/emojiIndex";
import { withTone } from "@/components/pickers/emojiIndex";
import { pointerMoved } from "@/lib/pointerMoved";
import { optionName } from "@/lib/apps";
import { Fragment, useEffect, useMemo, useRef, type CSSProperties } from "react";
import s from "./Composer.module.css";
import { t } from "@/i18n";

export type AcItem =
  | { kind: "user"; user: PublicUser }
  | { kind: "role"; role: Role }
  | { kind: "channel"; channel: Channel; category?: string | undefined }
  /** `name` is the code that matched what was typed, where it is not the emoji's first. */
  | { kind: "emoji"; entry: EmojiEntry; name?: string }
  | { kind: "customEmoji"; emoji: Emoji }
  | { kind: "command"; name: string; desc: string }
  /** An app's slash command (or one of its subcommands), under its app. */
  | { kind: "appCommand"; app: CommandApp; leaf: CommandLeaf }
  /** One of the values an option of an app's command can take. */
  | { kind: "choice"; name: string; value: string | number | boolean };

/** The suggestion list's ids, so the message box can say which one is chosen. */
export const AC_LIST_ID = "composer-suggestions";
export function acOptionId(i: number): string {
  return `${AC_LIST_ID}-${i}`;
}

/** What a row is filed under, for the headings between the groups. */
function groupOf(it: AcItem, kind: string): string {
  if (it.kind === "appCommand") return it.app.name;
  if (it.kind === "choice") return t("apps.command.choices");
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
    case "appCommand":
      return "a" + it.leaf.command.id + ":" + it.leaf.path.join(" ");
    case "choice":
      return "v" + String(it.value);
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
export function Autocomplete({ kind, items, index, onHover, onPick, tone, heading: title, style, docked }: { kind: string; items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; tone: number; heading?: string | undefined; style?: CSSProperties | undefined; docked?: boolean }) {
  // a slash typed at the start: every command there is, by app, with a rail to jump between apps
  const slash = kind === "command" && items.length > 0 && items.every((it) => it.kind === "appCommand" || it.kind === "command");
  if (slash) return <CommandPicker items={items} index={index} onHover={onHover} onPick={onPick} docked={docked} />;
  return <SuggestionList kind={kind} items={items} index={index} onHover={onHover} onPick={onPick} tone={tone} heading={title} style={style} docked={docked} />;
}

/** Keeps the highlighted row of a list that scrolls in view. Only the list itself scrolls: scrollIntoView would also shift the app's clipped containers. */
function useRowInView(listRef: React.RefObject<HTMLDivElement | null>, index: number, items: AcItem[]) {
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`#${acOptionId(index)}`);
    if (!list || !row) return;
    // where the row sits in the list's own scrolled content, however the list is placed
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [listRef, index, items]);
}

/** The app a slash command row belongs to: its id (the app's, or "" for Nexa's own commands), name and picture. */
function appOf(it: AcItem): { id: string; name: string; app: CommandApp | null } {
  return it.kind === "appCommand" ? { id: it.app.id, name: it.app.name, app: it.app } : { id: "", name: t("composer.autocomplete.commands"), app: null };
}

/**
 * The slash command list: a rail of the apps that offer commands here (and
 * Nexa's own), and the commands under each app's picture and name, a row
 * each with its name, the options it needs, what it does and whose it is.
 */
function CommandPicker({ items, index, onHover, onPick, docked }: { items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; docked?: boolean | undefined }) {
  const listRef = useRef<HTMLDivElement>(null);
  useRowInView(listRef, index, items);
  const apps = useMemo(() => {
    const out: { id: string; name: string; app: CommandApp | null; first: number }[] = [];
    items.forEach((it, i) => {
      const a = appOf(it);
      if (!out.some((x) => x.id === a.id)) out.push({ ...a, first: i });
    });
    return out;
  }, [items]);
  const current = appOf(items[index] ?? items[0]!).id;
  return (
    <div className={[s.cmdPicker, docked ? s.docked : ""].join(" ")} data-testid="command-picker" onMouseDown={(e) => e.preventDefault()}>
      {apps.length > 1 ? (
        <nav className={s.cmdRail} aria-label={t("composer.autocomplete.commands")}>
          {apps.map((a) => (
            <button
              key={a.id || "nexa"}
              type="button"
              className={s.cmdRailItem}
              data-current={a.id === current || undefined}
              title={a.name}
              aria-label={a.name}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onHover(a.first)}
            >
              {a.app ? <Avatar id={a.app.id} avatarId={a.app.bot.avatar_id} name={a.app.name} size={32} square /> : <span className={s.cmdRailNexa} aria-hidden="true"><SquareSlash size={18} /></span>}
            </button>
          ))}
        </nav>
      ) : null}
      <div ref={listRef} id={AC_LIST_ID} className={s.cmdList} role="listbox">
        {items.map((it, i) => {
          const a = appOf(it);
          const heading = i === 0 || appOf(items[i - 1]!).id !== a.id ? (
            <div className={s.cmdSection} aria-hidden="true">
              {a.app ? <Avatar id={a.app.id} avatarId={a.app.bot.avatar_id} name={a.app.name} size={20} square /> : <SquareSlash size={16} />}
              <span>{a.name}</span>
            </div>
          ) : null;
          return (
            <Fragment key={keyOf(it)}>
              {heading}
              <button className={s.cmdRow} id={acOptionId(i)} data-selected={i === index} role="option" aria-selected={i === index} onMouseMove={(e) => i !== index && pointerMoved(e.nativeEvent) && onHover(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
                <span className={s.cmdRowMain}>
                  <span className={s.cmdRowName}>
                    /{it.kind === "appCommand" ? it.leaf.label : it.kind === "command" ? it.name : ""}
                    {it.kind === "appCommand"
                      ? it.leaf.options.filter((o) => o.required).map((o) => (
                          <span key={o.name} className={s.acOption}>{optionName(o)}</span>
                        ))
                      : null}
                  </span>
                  <span className={s.cmdRowDesc}>{it.kind === "appCommand" ? it.leaf.description : it.kind === "command" ? it.desc : ""}</span>
                </span>
                {a.app ? <span className={s.cmdRowApp}>{a.name}</span> : null}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionList({ kind, items, index, onHover, onPick, tone, heading: title, style, docked }: { kind: string; items: AcItem[]; index: number; onHover: (i: number) => void; onPick: (i: number) => void; tone: number; heading?: string | undefined; style?: CSSProperties | undefined; docked?: boolean | undefined }) {
  const listRef = useRef<HTMLDivElement>(null);
  // the list scrolls when it is taller than the room above the keyboard
  useRowInView(listRef, index, items);
  if (items.length === 0) return null;
  return (
    // style: where it floats, for a page that hangs it from the caret (a note) rather than over the message box
    <div ref={listRef} id={AC_LIST_ID} className={[s.ac, docked ? s.docked : ""].join(" ")} style={style} role="listbox" onMouseDown={(e) => e.preventDefault()}>
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
              ) : it.kind === "appCommand" ? (
                <>
                  <Avatar id={it.app.id} avatarId={it.app.bot.avatar_id} name={it.app.name} size={24} />
                  <span className={s.acName}>
                    /{it.leaf.label}
                    {it.leaf.options.filter((o) => o.required).map((o) => (
                      <span key={o.name} className={s.acOption}>{optionName(o)}</span>
                    ))}
                  </span>
                  <span className={s.acSub}>{it.leaf.description}</span>
                </>
              ) : it.kind === "choice" ? (
                <span className={s.acName}>{it.name}</span>
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
