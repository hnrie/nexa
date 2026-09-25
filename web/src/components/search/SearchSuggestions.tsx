/**
 * What to type next. As a filter is being typed — `from:`, `in:`, `has:`,
 * `before:` — the people, channels or kinds that would match are offered with
 * their pictures, and a date filter opens a calendar rather than asking for
 * the exact spelling of a date. The list works from the search box itself:
 * ↓ and ↑ move through it and Enter takes the one chosen, as the message box's
 * suggestions do; it was reachable by pointer only.
 */
import { CalendarDays } from "lucide-react";
import { useEffect, useImperativeHandle, useMemo, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { Channel, PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { t } from "@/i18n";
import s from "./Search.module.css";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";

/** The filter being typed at the end of a query, if any. */
export interface PartialToken {
  key: "from" | "in" | "has" | "mentions" | "before" | "after";
  /** What has been typed after the colon. */
  value: string;
  /** Where the token starts in the raw query. */
  at: number;
}

const KEYS = ["from", "in", "has", "mentions", "before", "after"] as const;

export function partialToken(query: string, caret = query.length): PartialToken | null {
  const upto = query.slice(0, caret);
  const start = Math.max(upto.lastIndexOf(" ") + 1, 0);
  const tok = upto.slice(start);
  const colon = tok.indexOf(":");
  if (colon <= 0) return null;
  const key = tok.slice(0, colon).toLowerCase();
  if (!(KEYS as readonly string[]).includes(key)) return null;
  return { key: key as PartialToken["key"], value: tok.slice(colon + 1), at: start };
}

/** Replaces the filter being typed with a finished one. */
export function completeToken(query: string, tok: PartialToken, value: string): string {
  const after = query.slice(tok.at + tok.key.length + 1 + tok.value.length);
  return `${query.slice(0, tok.at)}${tok.key}:${value}${after.startsWith(" ") ? after : ` ${after.trimStart()}`}`;
}

const HAS = ["link", "image", "file", "sticker", "embed"];

/** The keys the search box hands the list; true when the list used the key. */
export interface SuggestHandle {
  key: (e: KeyboardEvent<HTMLInputElement>) => boolean;
}

/** One row: what it puts in the query, and how it looks. */
interface Option {
  id: string;
  value: string;
  body: ReactNode;
}

export function SearchSuggestions({
  query,
  users,
  channels,
  nicknames,
  onPick,
  handle,
  listId = "search-suggestions",
  onActive,
}: {
  query: string;
  users: Record<string, PublicUser>;
  channels: Channel[];
  nicknames?: Record<string, string>;
  onPick: (next: string) => void;
  handle?: Ref<SuggestHandle>;
  listId?: string;
  /** The row ↑ and ↓ have reached, for the box's aria-activedescendant. */
  onActive?: (optionId: string | undefined) => void;
}) {
  const tok = useMemo(() => partialToken(query), [query]);
  const wanted = tok?.value.replace(/^[@#]/, "").toLowerCase() ?? "";

  const people = useMemo(() => {
    if (!tok || (tok.key !== "from" && tok.key !== "mentions")) return [];
    return Object.values(users)
      .filter((u) => !wanted || u.username.toLowerCase().includes(wanted) || u.display_name.toLowerCase().includes(wanted) || (nicknames?.[u.id] ?? "").includes(wanted))
      .slice(0, 8);
  }, [tok, users, wanted, nicknames]);

  // A DM has no name of its own; it is offered as the people in it and put in
  // the query by id (which in: also takes), as is anything with a space in
  // its name — "in:Weekend plans" would search for "plans" in "Weekend".
  const chans = useMemo(() => {
    if (!tok || tok.key !== "in") return [];
    const meId = useAuth.getState().me?.id;
    return channels
      .map((c) => ({ c, label: channelDisplayName(c, users, meId), dm: c.type === "dm" || c.type === "group_dm" || c.type === "subchat" }))
      .filter((x) => !wanted || x.label.toLowerCase().includes(wanted))
      .slice(0, 8);
  }, [tok, channels, users, wanted]);

  const options = useMemo<Option[]>(() => {
    if (!tok) return [];
    if (tok.key === "has") {
      return HAS.filter((h) => h.startsWith(wanted)).map((h) => ({ id: `${listId}-${h}`, value: h, body: <span className={s.suggestName}>{h}</span> }));
    }
    if (tok.key === "in") {
      return chans.map(({ c, label, dm }) => ({
        id: `${listId}-${c.id}`,
        value: dm || /\s/.test(c.name) ? c.id : c.name,
        body: (
          <>
            <span className={s.suggestHash}>{dm ? "@" : "#"}</span>
            <span className={s.suggestName} dir="auto">{label}</span>
          </>
        ),
      }));
    }
    if (tok.key === "from" || tok.key === "mentions") {
      return people.map((u) => ({
        id: `${listId}-${u.id}`,
        value: u.username,
        body: (
          <>
            <Avatar id={u.id} avatarId={u.avatar_id} name={u.display_name} size={20} />
            <span className={s.suggestName} dir="auto">{u.display_name}</span>
            <span className={s.suggestSub}>@{u.username}</span>
          </>
        ),
      }));
    }
    return [];
  }, [tok, wanted, chans, people, listId]);

  const [active, setActive] = useState(-1);
  // a new query starts the choosing over
  useEffect(() => setActive(-1), [query]);
  useEffect(() => onActive?.(active >= 0 ? options[active]?.id : undefined), [active, options, onActive]);

  useImperativeHandle(
    handle,
    () => ({
      key: (e) => {
        if (!tok || options.length === 0) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          setActive((a) => (a < 0 ? (step > 0 ? 0 : options.length - 1) : (a + step + options.length) % options.length));
          return true;
        }
        if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && options[active]) {
          e.preventDefault();
          onPick(completeToken(query, tok, options[active]!.value));
          return true;
        }
        return false;
      },
    }),
    [tok, options, active, onPick, query],
  );

  if (!tok) return null;

  if (tok.key === "before" || tok.key === "after") {
    return (
      <div className={s.suggest} data-testid="search-suggest">
        <label className={s.suggestDate}>
          <CalendarDays size={16} />
          <span>{tok.key === "before" ? t("search.suggestions.sentBefore") : t("search.suggestions.sentAfter")}</span>
          <input
            type="date"
            value={/^\d{4}-\d{2}-\d{2}$/.test(tok.value) ? tok.value : ""}
            aria-label={tok.key === "before" ? t("search.suggestions.sentBefore") : t("search.suggestions.sentAfter")}
            data-testid="search-date"
            onChange={(e) => e.target.value && onPick(completeToken(query, tok, e.target.value))}
          />
        </label>
      </div>
    );
  }

  if (options.length === 0) return null;
  return (
    <div className={s.suggest} id={listId} role="listbox" aria-label={t("chat.chat.search")} data-testid="search-suggest">
      {options.map((o, i) => (
        <button
          key={o.id}
          id={o.id}
          role="option"
          aria-selected={i === active}
          data-active={i === active || undefined}
          tabIndex={-1}
          className={s.suggestRow}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(completeToken(query, tok, o.value))}
        >
          {o.body}
        </button>
      ))}
    </div>
  );
}
