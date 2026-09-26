import { useRef } from "react";
import s from "./Look.module.css";

/**
 * A box for code: monospace, no spelling fixes, no wrapping, with line
 * numbers that scroll with it. Tab still moves focus on, as everywhere else in
 * the app, so the box never traps a keyboard.
 */
export function CodeEditor({ value, onChange, label, placeholder, testId, minHeight }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; testId?: string; minHeight?: number }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  return (
    // code reads left to right in every language, line numbers on its left
    <div className={s.editor} dir="ltr">
      <div className={s.gutter} ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </div>
      <textarea
        className={s.code}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        wrap="off"
        dir="ltr"
        aria-label={label}
        placeholder={placeholder}
        data-testid={testId}
        style={minHeight ? { minHeight } : undefined}
      />
    </div>
  );
}
