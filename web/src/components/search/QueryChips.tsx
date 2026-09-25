/**
 * The query read back in words, under the search box: where it looks, then
 * one chip for each filter ("From Bob", "Has an image", "Before 31 Jan 2026").
 * It shows what the syntax meant, says plainly when a filter could not be
 * read, and takes any filter out with its ✕, so nobody has to edit
 * `before:2026-01-31` by hand to be rid of it.
 */
import { AlertTriangle, AtSign, CalendarDays, Hash, MinusCircle, Pin, Server, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/common/Avatar";
import { t } from "@/i18n";
import { dateRange, withoutToken, type HasKind, type QueryToken, type ResolvedQuery, type SearchQuery } from "@/lib/search";
import { useChannels } from "@/stores/channels";
import { formatPeriod, HAS_ICONS } from "./SearchSuggestions";
import type { Names, SearchScope } from "./scope";
import s from "./Search.module.css";

function Chip({ icon, label, onRemove, removeLabel, warn, testId }: { icon: ReactNode; label: string; onRemove: () => void; removeLabel: string; warn?: boolean; testId?: string }) {
  return (
    <span className={s.chip} data-warn={warn || undefined} data-testid={testId}>
      <span className={s.chipIcon} aria-hidden="true">{icon}</span>
      <span className={s.chipLabel} dir="auto">{label}</span>
      <button type="button" className={s.chipX} aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
        <X size={14} />
      </button>
    </span>
  );
}

const HAS_CHIP: Record<HasKind, string> = {
  link: "search.chip.hasLink",
  image: "search.chip.hasImage",
  video: "search.chip.hasVideo",
  audio: "search.chip.hasAudio",
  file: "search.chip.hasFile",
  embed: "search.chip.hasEmbed",
  sticker: "search.chip.hasSticker",
};

function unitOf(v: string): "day" | "month" | "year" {
  const parts = v.split("-").length;
  return parts === 3 ? "day" : parts === 2 ? "month" : "year";
}

/** What one filter chip says, and whether it could be read. */
function describe(tok: QueryToken, resolved: ResolvedQuery, names: Names, channelsById: ReturnType<typeof useChannels.getState>["byId"]): { icon: ReactNode; label: string; warn?: boolean } | null {
  const v = tok.value;
  if (tok.kind === "exclude") return { icon: <MinusCircle size={14} />, label: t("search.chip.without", { word: v }) };
  if (tok.kind !== "filter" || !v) return null;
  const lower = v.toLowerCase().replace(/^[@#]/, "");
  switch (tok.key) {
    case "from":
    case "mentions": {
      if (tok.key === "mentions" && (lower === "everyone" || lower === "here")) return { icon: <AtSign size={14} />, label: t("search.chip.mentionsEveryone") };
      const ids = tok.key === "from" ? resolved.from : resolved.mentions;
      // the first person the name found; a chip for each would say the same name twice
      const id = lower === "me" ? names.meId : Object.values(names.users).find((u) => u.username.toLowerCase() === lower || u.display_name.toLowerCase() === lower || (names.ctx.nicknames?.[u.id] ?? []).includes(lower) || u.id === lower)?.id;
      if (!id || (ids && !ids.includes(id))) return { icon: <AlertTriangle size={14} />, label: t("search.chip.nobody", { name: v }), warn: true };
      const who = lower === "me" ? t("search.suggest.me") : names.person(id);
      return {
        icon: <Avatar id={id} avatarId={names.users[id]?.avatar_id ?? null} name={who} size={16} />,
        label: tok.key === "from" ? t("search.chip.from", { name: who }) : t("search.chip.mentions", { name: who }),
      };
    }
    case "in": {
      const found = Object.entries(names.ctx.channelNames).find(([id, list]) => id === lower || list.includes(lower));
      const ch = found ? channelsById[found[0]] : undefined;
      if (!ch) return { icon: <AlertTriangle size={14} />, label: t("search.chip.noConversation", { name: v }), warn: true };
      const icon = ch.type === "dm" ? <AtSign size={14} /> : ch.type === "group_dm" ? <Users size={14} /> : <Hash size={14} />;
      return { icon, label: t("search.chip.in", { name: ch.type === "dm" ? `@${names.channel(ch)}` : names.channel(ch) }) };
    }
    case "has": {
      if (tok.invalid) return { icon: <AlertTriangle size={14} />, label: t("search.chip.badHas", { value: v }), warn: true };
      const Icon = HAS_ICONS[lower as HasKind];
      return { icon: <Icon size={14} />, label: t(HAS_CHIP[lower as HasKind]) };
    }
    case "pinned":
      if (tok.invalid) return { icon: <AlertTriangle size={14} />, label: t("search.chip.badPinned"), warn: true };
      return { icon: <Pin size={14} />, label: resolved.pinned === false && ["no", "false", "n", "0"].includes(lower) ? t("search.chip.notPinned") : t("search.chip.pinned") };
    default: {
      const range = dateRange(v);
      if (!range || tok.invalid) return { icon: <AlertTriangle size={14} />, label: t("search.chip.badDate", { value: v }), warn: true };
      const unit = unitOf(v);
      const when = formatPeriod(range.start, unit);
      const label = tok.key === "before" ? t("search.chip.before", { date: when }) : tok.key === "after" ? t("search.chip.after", { date: when }) : unit === "day" ? t("search.chip.onDay", { date: when }) : t("search.chip.duringPeriod", { date: when });
      return { icon: <CalendarDays size={14} />, label };
    }
  }
}

export function QueryChips({
  raw,
  parsed,
  resolved,
  names,
  onChange,
  scope,
  scopeLabel,
  onWiden,
  narrowTo,
  onNarrow,
}: {
  raw: string;
  parsed: SearchQuery;
  resolved: ResolvedQuery;
  names: Names;
  onChange: (next: string) => void;
  /** The scope, when the search has one to show (the box above a conversation). */
  scope?: SearchScope;
  scopeLabel?: string;
  onWiden?: () => void;
  /** Where the search came from, offered again once it has been widened. */
  narrowTo?: string;
  onNarrow?: () => void;
}) {
  const byId = useChannels((c) => c.byId);
  const chips: ReactNode[] = [];
  if (scope && scope.kind !== "all" && scopeLabel && onWiden) {
    const icon = scope.kind === "server" ? <Server size={14} /> : scopeLabel.startsWith("@") ? <AtSign size={14} /> : <Users size={14} />;
    chips.push(
      <Chip key="scope" testId="search-scope" icon={icon} label={t("search.chip.in", { name: scopeLabel })} onRemove={onWiden} removeLabel={t("search.chip.widen", { name: scopeLabel })} />,
    );
  }
  for (const tok of parsed.tokens) {
    const d = describe(tok, resolved, names, byId);
    if (!d) continue;
    chips.push(<Chip key={`${tok.start}-${tok.end}`} testId="search-chip" icon={d.icon} label={d.label} warn={d.warn} onRemove={() => onChange(withoutToken(raw, tok))} removeLabel={t("search.chip.remove", { filter: d.label })} />);
  }
  const narrow = scope?.kind === "all" && narrowTo && onNarrow;
  if (chips.length === 0 && !narrow) return null;
  return (
    <div className={s.chips} data-testid="search-chips">
      {chips}
      {narrow ? (
        <button type="button" className={s.narrow} onClick={onNarrow} data-testid="search-narrow">
          {t("search.chip.onlyIn", { name: narrowTo })}
        </button>
      ) : null}
    </div>
  );
}
