/**
 * What to type next. As a filter is being typed — `from:`, `in:`, `has:`,
 * `before:` — the people, channels or kinds that would match are offered with
 * their pictures, and a date filter opens a calendar rather than asking for
 * the exact spelling of a date.
 */
import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import type { Channel, PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import s from "./Search.module.css";

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

export function SearchSuggestions({
  query,
  users,
  channels,
  nicknames,
  onPick,
}: {
  query: string;
  users: Record<string, PublicUser>;
  channels: Channel[];
  nicknames?: Record<string, string>;
  onPick: (next: string) => void;
}) {
  const tok = useMemo(() => partialToken(query), [query]);
  const wanted = tok?.value.replace(/^[@#]/, "").toLowerCase() ?? "";

  const people = useMemo(() => {
    if (!tok || (tok.key !== "from" && tok.key !== "mentions")) return [];
    return Object.values(users)
      .filter((u) => !wanted || u.username.toLowerCase().includes(wanted) || u.display_name.toLowerCase().includes(wanted) || (nicknames?.[u.id] ?? "").includes(wanted))
      .slice(0, 8);
  }, [tok, users, wanted, nicknames]);

  const chans = useMemo(() => {
    if (!tok || tok.key !== "in") return [];
    return channels.filter((c) => !wanted || c.name.toLowerCase().includes(wanted)).slice(0, 8);
  }, [tok, channels, wanted]);

  if (!tok) return null;

  if (tok.key === "before" || tok.key === "after") {
    return (
      <div className={s.suggest} data-testid="search-suggest">
        <label className={s.suggestDate}>
          <CalendarDays size={16} />
          <span>{tok.key === "before" ? "Sent before" : "Sent after"}</span>
          <input
            type="date"
            value={/^\d{4}-\d{2}-\d{2}$/.test(tok.value) ? tok.value : ""}
            aria-label={tok.key === "before" ? "Sent before" : "Sent after"}
            data-testid="search-date"
            onChange={(e) => e.target.value && onPick(completeToken(query, tok, e.target.value))}
          />
        </label>
      </div>
    );
  }

  if (tok.key === "has") {
    const list = HAS.filter((h) => h.startsWith(wanted));
    if (list.length === 0) return null;
    return (
      <div className={s.suggest} data-testid="search-suggest">
        {list.map((h) => (
          <button key={h} className={s.suggestRow} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(completeToken(query, tok, h))}>
            <span className={s.suggestName}>{h}</span>
          </button>
        ))}
      </div>
    );
  }

  if (tok.key === "in") {
    if (chans.length === 0) return null;
    return (
      <div className={s.suggest} data-testid="search-suggest">
        {chans.map((c) => (
          <button key={c.id} className={s.suggestRow} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(completeToken(query, tok, c.name))}>
            <span className={s.suggestHash}>#</span>
            <span className={s.suggestName}>{c.name}</span>
          </button>
        ))}
      </div>
    );
  }

  if (people.length === 0) return null;
  return (
    <div className={s.suggest} data-testid="search-suggest">
      {people.map((u) => (
        <button key={u.id} className={s.suggestRow} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(completeToken(query, tok, u.username))}>
          <Avatar id={u.id} avatarId={u.avatar_id} name={u.display_name} size={20} />
          <span className={s.suggestName}>{u.display_name}</span>
          <span className={s.suggestSub}>@{u.username}</span>
        </button>
      ))}
    </div>
  );
}
