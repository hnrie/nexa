import { PersonName } from "@/components/common/PersonName";
/**
 * The suggestions under a search box (search/suggest.ts decides what they
 * are). They are worked from the box itself: ↓ and ↑ move through them, Enter
 * or Tab takes the one chosen and Escape puts them away, while the caret stays
 * where it was typing; a click does the same.
 */
import { AtSign, CalendarDays, Clock, File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, Film, Hash, Image as ImageIcon, Link as LinkIcon, Music, Newspaper, Paperclip, Pin, Sticker, Users, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/common/Avatar";
import { isolate } from "@/components/server/bidi";
import { t, translator } from "@/i18n";
import type { HasKind } from "@/lib/search";
import { forgetSearch } from "@/search/recent";
import { useChannels } from "@/stores/channels";
import type { Names } from "./scope";
import { flat, type Suggestion, type SuggestionGroup } from "./suggest";
import s from "./Search.module.css";

export const HAS_ICONS: Record<HasKind, LucideIcon> = { link: LinkIcon, image: ImageIcon, video: Film, audio: Music, file: Paperclip, embed: Newspaper, sticker: Sticker };

/** The chosen suggestion and the keys that move it; `key` says whether it used the key. */
export function useSuggestionKeys(groups: SuggestionGroup[], onPick: (s: Suggestion) => void, onDismiss: () => void) {
  const items = useMemo(() => flat(groups), [groups]);
  const [active, setActive] = useState(-1);
  // different suggestions start with nothing chosen, so Enter still searches;
  // the same ones worked out again keep the choice
  const sig = items.map((i) => i.id).join("\n");
  useEffect(() => setActive(-1), [sig]);
  const key = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): boolean => {
      if (items.length === 0) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a < 0 ? (step > 0 ? 0 : items.length - 1) : (a + step + items.length) % items.length));
        return true;
      }
      if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && items[active] && !e.nativeEvent.isComposing) {
        const chosen = items[active]!;
        // the calendar row is chosen with its own date field
        if (chosen.kind === "pickDate") return false;
        e.preventDefault();
        onPick(chosen);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        return true;
      }
      return false;
    },
    [items, active, onPick, onDismiss],
  );
  return { items, active, setActive, key, activeId: active >= 0 ? items[active]?.id : undefined };
}

const GROUP_TITLE: Record<SuggestionGroup["kind"], string> = {
  recent: "search.suggest.recent",
  keys: "search.suggest.options",
  people: "search.suggest.people",
  conversations: "search.suggest.conversations",
  kinds: "search.suggest.kinds",
  dates: "search.suggest.dates",
  pinned: "search.suggest.pins",
  filters: "search.suggest.filters",
};

const KEY_HINT: Record<string, string> = {
  from: "search.suggest.keyFrom",
  in: "search.suggest.keyIn",
  mentions: "search.suggest.keyMentions",
  has: "search.suggest.keyHas",
  before: "search.suggest.keyBefore",
  after: "search.suggest.keyAfter",
  during: "search.suggest.keyDuring",
  pinned: "search.suggest.keyPinned",
};

const HAS_LABEL: Record<HasKind, string> = {
  link: "search.has.link",
  image: "search.has.image",
  video: "search.has.video",
  audio: "search.has.audio",
  file: "search.has.file",
  embed: "search.has.embed",
  sticker: "search.has.sticker",
};

export function hasLabel(h: HasKind): string {
  return t(HAS_LABEL[h]);
}

/** A day, a month or a year, written out in the reader's language. */
export function formatPeriod(start: number, unit: "day" | "month" | "year"): string {
  const opts: Intl.DateTimeFormatOptions = unit === "day" ? { day: "numeric", month: "short", year: "numeric" } : unit === "month" ? { month: "long", year: "numeric" } : { year: "numeric" };
  try {
    return new Intl.DateTimeFormat(translator().locale, opts).format(new Date(start));
  } catch {
    return new Date(start).toDateString();
  }
}

const RELATIVE: Record<string, string> = {
  today: "search.date.today",
  yesterday: "search.date.yesterday",
  thisMonth: "search.date.thisMonth",
  lastMonth: "search.date.lastMonth",
  thisYear: "search.date.thisYear",
};

function ChannelGlyph({ ch, names }: { ch: NonNullable<Suggestion["channel"]>; names: Names }) {
  if (ch.type === "dm") {
    const other = ch.recipient_ids.find((id) => id !== names.meId) ?? "";
    const u = names.users[other];
    return <Avatar id={other} avatarId={u?.avatar_id ?? null} name={names.person(other)} size={24} />;
  }
  if (ch.type === "group_dm") return <span className={s.glyph}><Users size={16} /></span>;
  return <span className={s.glyph}><Hash size={16} /></span>;
}

/** The title of a group of suggestions. */
export function groupTitle(kind: SuggestionGroup["kind"]): string {
  return t(GROUP_TITLE[kind]);
}

/** What one suggestion looks like, wherever it is listed. */
export function SuggestionRow({ item, names, onDate }: { item: Suggestion; names: Names; onDate: (key: string, value: string) => void }) {
  const byId = useChannels((c) => c.byId);
  switch (item.kind) {
    case "recent":
      return (
        <>
          <span className={s.glyph}><Clock size={16} /></span>
          <span className={s.optMain} dir="auto">{item.recent}</span>
          <button
            type="button"
            className={s.optRemove}
            tabIndex={-1}
            aria-label={t("search.suggest.forget", { query: isolate(item.recent ?? "") })}
            title={t("search.suggest.forgetShort")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              forgetSearch(item.recent ?? "");
            }}
          >
            <X size={14} />
          </button>
        </>
      );
    case "key":
      return (
        <>
          <span className={s.optKey} dir="ltr">{item.key}:</span>
          <span className={s.optSub}>{t(KEY_HINT[item.key!] ?? "")}</span>
        </>
      );
    case "person": {
      const u = item.userId ? names.users[item.userId] : undefined;
      const me = item.value === "me";
      return (
        <>
          <Avatar id={item.userId ?? ""} avatarId={u?.avatar_id ?? null} name={names.person(item.userId ?? "")} size={24} />
          <span className={s.optMain} dir="auto">{me ? t("search.suggest.me") : <PersonName userId={item.userId}>{names.person(item.userId ?? "")}</PersonName>}</span>
          <span className={s.optSub} dir="ltr">@{u?.username ?? item.value}</span>
        </>
      );
    }
    case "everyone":
      return (
        <>
          <span className={s.glyph}><AtSign size={16} /></span>
          <span className={s.optMain}>{t("search.suggest.everyone")}</span>
        </>
      );
    case "channel": {
      const ch = item.channel!;
      const where = ch.server_id ? names.serverName(ch.server_id) : ch.type === "subchat" && ch.parent_id && byId[ch.parent_id] ? names.channel(byId[ch.parent_id]!) : ch.type === "dm" ? t("search.suggest.directMessage") : t("search.suggest.group");
      return (
        <>
          <ChannelGlyph ch={ch} names={names} />
          <span className={s.optMain} dir="auto">{ch.type === "dm" ? <PersonName userId={ch.recipient_ids.find((id) => id !== names.meId)}>{names.channel(ch).replace(/^#/, "")}</PersonName> : names.channel(ch).replace(/^#/, "")}</span>
          {where ? <span className={s.optSub} dir="auto">{where}</span> : null}
        </>
      );
    }
    case "has": {
      const Icon = HAS_ICONS[item.has!];
      return (
        <>
          <span className={s.glyph}><Icon size={16} /></span>
          <span className={s.optMain}>{hasLabel(item.has!)}</span>
        </>
      );
    }
    case "date":
      return (
        <>
          <span className={s.glyph}><CalendarDays size={16} /></span>
          <span className={s.optMain}>{t(RELATIVE[item.date!.relative ?? ""] ?? "")}</span>
          <span className={s.optSub}>{formatPeriod(item.date!.start, item.date!.unit)}</span>
        </>
      );
    case "pickDate":
      return (
        <label className={s.optDate} onMouseDown={(e) => e.stopPropagation()}>
          <span className={s.glyph}><CalendarDays size={16} /></span>
          <span className={s.optMain}>{t("search.suggest.pickDate")}</span>
          <input
            type="date"
            className={s.dateInput}
            aria-label={t("search.suggest.pickDate")}
            data-testid="search-date"
            onChange={(e) => e.target.value && onDate(item.key!, e.target.value)}
          />
        </label>
      );
    case "pinned":
      return (
        <>
          <span className={s.glyph}><Pin size={16} /></span>
          <span className={s.optMain}>{item.value === "yes" ? t("search.chip.pinned") : t("search.chip.notPinned")}</span>
        </>
      );
  }
}

export function SearchSuggestions({
  groups,
  active,
  listId,
  names,
  onPick,
  onHover,
  onDate,
  onClearRecent,
  floating = true,
}: {
  groups: SuggestionGroup[];
  active: number;
  listId: string;
  names: Names;
  onPick: (s: Suggestion) => void;
  onHover: (index: number) => void;
  /** A date picked from the calendar row, for that filter. */
  onDate: (key: string, value: string) => void;
  onClearRecent?: () => void;
  /** Over what is below it (under a search box), or part of the page (a dialog's body). */
  floating?: boolean;
}) {
  if (groups.length === 0) return null;
  let index = -1;
  return (
    <div className={floating ? s.suggest : s.suggestInline} id={listId} role="listbox" aria-label={t("search.suggest.label")} data-testid="search-suggest">
      {groups.map((g) => (
        <div key={g.kind} role="group" aria-label={groupTitle(g.kind)} className={s.optGroup}>
          <div className={s.optHead} aria-hidden="true">
            <span>{groupTitle(g.kind)}</span>
            {g.kind === "recent" && onClearRecent ? (
              <button type="button" className={s.optClear} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClearRecent}>
                {t("search.suggest.clearRecent")}
              </button>
            ) : null}
          </div>
          {g.items.map((item) => {
            index += 1;
            const i = index;
            return (
              <div
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                data-kind={item.kind}
                className={s.opt}
                onMouseDown={(e) => {
                  // the box keeps focus, and its caret, while a row is clicked
                  if (item.kind !== "pickDate") e.preventDefault();
                }}
                // a pointer that moves chooses; rows sliding under a still one do not
                onMouseMove={() => i !== active && onHover(i)}
                onClick={() => item.kind !== "pickDate" && onPick(item)}
              >
                <SuggestionRow item={item} names={names} onDate={onDate} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** For a file row: a glyph that says what kind of file it is. */
export function fileGlyph(type: string, name: string): LucideIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (type.startsWith("audio/")) return FileAudio;
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext)) return FileArchive;
  if (["csv", "tsv", "xls", "xlsx", "ods", "numbers"].includes(ext)) return FileSpreadsheet;
  if (["js", "ts", "tsx", "jsx", "py", "go", "rs", "c", "cpp", "h", "java", "kt", "rb", "php", "sh", "json", "yaml", "yml", "toml", "html", "css", "sql"].includes(ext)) return FileCode;
  if (type === "application/pdf" || type.startsWith("text/") || ["pdf", "doc", "docx", "txt", "md", "rtf", "odt", "pages", "epub"].includes(ext)) return FileText;
  return File;
}
