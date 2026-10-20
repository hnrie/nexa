import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { emojiUrl } from "@/api/users";
import { Popout } from "@/components/common/Popout";
import { Twemoji } from "@/components/common/Twemoji";
import { t } from "@/i18n";
import type { HookEmoji } from "@/lib/webhookMessage";
import s from "./SelectBox.module.css";

/** One thing a select box offers. */
export interface Choice {
  value: string;
  label: string;
  description?: string;
  emoji?: HookEmoji;
  /** A person's picture or a role's colour, drawn before the label. */
  picture?: ReactNode;
}

export function ChoiceGlyph({ e, size = 18 }: { e: HookEmoji; size?: number }) {
  if (e.id) return <img className={s.glyph} style={{ width: size, height: size }} src={emojiUrl(e.id, !!e.animated, size)} alt={e.name ? `:${e.name}:` : ""} width={size} height={size} loading="lazy" draggable={false} />;
  return e.name ? <Twemoji text={e.name} className={s.glyph} /> : null;
}

/**
 * A box that opens a list to pick from: what an app's select menu is, on its
 * message and in its forms. It looks like a text box (a well), and its list is
 * a floating panel under it, with a search for long lists and for people,
 * roles and channels. One that takes a single value gives it the moment it is
 * picked; one that takes several gives them all when the list closes, if
 * there are as many as it asks for.
 */
export function SelectBox({
  placeholder,
  picked,
  labelOf,
  choicesFor,
  min = 1,
  max = 1,
  disabled = false,
  busy = false,
  searchable = false,
  onSearch,
  onCommit,
  invalid = false,
  id,
  testId,
}: {
  placeholder: string;
  picked: readonly string[];
  /** The words a picked value shows with, once the list is closed. */
  labelOf: (value: string) => string;
  /** What the list offers for what is typed into its search. */
  choicesFor: (query: string) => Choice[];
  min?: number;
  max?: number;
  disabled?: boolean;
  busy?: boolean;
  searchable?: boolean;
  /** Told what is typed, for lists that look further afield (a big server's members). */
  onSearch?: (query: string) => void;
  onCommit: (values: string[]) => void;
  invalid?: boolean;
  id?: string;
  testId?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState<string[]>([...picked]);
  const multi = max > 1;
  useEffect(() => {
    if (!anchor) setDraft([...picked]);
  }, [picked, anchor]);
  useEffect(() => {
    if (anchor) onSearch?.(query);
  }, [anchor, query, onSearch]);

  const choices = anchor ? choicesFor(query) : [];
  const close = () => {
    setAnchor(null);
    setQuery("");
    setActive(0);
    if (multi && draft.join("\u0000") !== picked.join("\u0000") && draft.length >= min && draft.length <= max) onCommit(draft);
  };
  const pick = (value: string) => {
    if (!multi) {
      setAnchor(null);
      setQuery("");
      onCommit([value]);
      return;
    }
    setDraft((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : cur.length >= max ? cur : [...cur, value]));
  };
  const shown = (anchor && multi ? draft : picked).map(labelOf).join(", ");
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, choices.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && choices[active]) {
      e.preventDefault();
      pick(choices[active]!.value);
    }
  };
  return (
    <>
      <button
        type="button"
        id={id}
        className={s.select}
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        aria-invalid={invalid || undefined}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={(e) => (anchor ? close() : setAnchor(e.currentTarget))}
        onKeyDown={(e) => {
          if (anchor && !searchable) keys(e);
        }}
        data-testid={testId}
      >
        <span className={[s.text, shown ? "" : s.placeholder].join(" ")} dir="auto">{shown || placeholder}</span>
        {busy ? (
          <span className={s.dots} aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <ChevronDown size={18} aria-hidden="true" className={s.chevron} />
        )}
      </button>
      {anchor ? (
        <Popout anchor={anchor} onClose={close} label={placeholder} prefer="below" testId={testId ? `${testId}-list` : undefined}>
          <div style={{ width: Math.max(240, anchor.getBoundingClientRect().width) }} className={s.panel}>
            {searchable ? (
              <label className={s.search}>
                <Search size={16} aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  placeholder={t("apps.select.search")}
                  aria-label={t("apps.select.search")}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={keys}
                />
              </label>
            ) : null}
            <div className={s.options} role="listbox" aria-multiselectable={multi || undefined} aria-label={placeholder}>
              {choices.length === 0 ? <div className={s.none}>{t("apps.select.nothing")}</div> : null}
              {choices.map((o, i) => {
                const on = (multi ? draft : picked).includes(o.value);
                return (
                  <button key={o.value} type="button" role="option" aria-selected={on} className={s.option} data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}>
                    {o.picture ?? (o.emoji ? <ChoiceGlyph e={o.emoji} size={22} /> : null)}
                    <span className={s.optText}>
                      <span className={s.optLabel} dir="auto">{o.label}</span>
                      {o.description ? <span className={s.optDesc} dir="auto">{o.description}</span> : null}
                    </span>
                    {multi ? (
                      <span className={s.tick} data-on={on || undefined} aria-hidden="true">{on ? <Check size={14} strokeWidth={3} /> : null}</span>
                    ) : on ? (
                      <Check size={18} className={s.picked} aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {multi ? (
              <div className={s.foot}>
                <span>{min === max ? t("apps.select.pickExactly", { count: max }) : min === 0 ? t("apps.select.pickUpTo", { count: max }) : t("apps.select.pickBetween", { min, max })}</span>
                <span className={s.count}>{t("apps.select.picked", { count: draft.length })}</span>
              </div>
            ) : null}
          </div>
        </Popout>
      ) : null}
    </>
  );
}
