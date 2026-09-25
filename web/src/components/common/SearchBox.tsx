import { Search, X } from "lucide-react";
import { forwardRef, useRef, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { t } from "@/i18n";
import s from "./SearchBox.module.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "className"> & {
  value: string;
  onChange: (value: string) => void;
  /** Always named: a search box's placeholder is not a label. */
  "aria-label": string;
  /** For the box around the input: a width, or a box that grows while it is used. */
  className?: string;
  /** Called when the × empties it, after the value is cleared. */
  onClear?: () => void;
  /** Escape empties the box first, then leaves it (this is called) once empty. */
  onEscape?: () => void;
};

/**
 * The one search box: a magnifier, the input and, once something is typed,
 * a button that empties it. Five hand-made boxes had three heights, and three
 * of them could only be emptied by selecting the text and deleting it, which
 * on a phone is the worst thing there is to do. It is a search field to the
 * browser too, so a phone's keyboard says "Search".
 */
export const SearchBox = forwardRef<HTMLInputElement, Props>(function SearchBox({ value, onChange, className, onClear, onEscape, onKeyDown, ...input }, ref) {
  const own = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Escape") return;
    if (value) {
      e.preventDefault();
      e.stopPropagation();
      onChange("");
    } else if (onEscape) {
      e.preventDefault();
      onEscape();
    }
  };
  return (
    <label className={[s.box, className ?? ""].join(" ")} data-filled={value ? "" : undefined}>
      <Search size={16} className={s.icon} aria-hidden="true" />
      <input ref={setRef} {...input} type="search" enterKeyHint="search" autoComplete="off" spellCheck={false} className={s.input} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />
      {value ? (
        <button
          type="button"
          className={s.clear}
          aria-label={t("chat.chat.clearSearch")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            onChange("");
            onClear?.();
            own.current?.focus({ preventScroll: true });
          }}
        >
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
});
