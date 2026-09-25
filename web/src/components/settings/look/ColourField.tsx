import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { parseColour, toHex, toThemeHex } from "@/lib/color";
import s from "./Look.module.css";

/**
 * One colour: a swatch that opens the system's colour picker, its hex code to
 * type or paste, and for a see-through colour how see-through it is. A code
 * typed in is only taken once it is a colour; until then the box says so and
 * the theme keeps the last good one.
 */
export function ColourField({
  label,
  hint,
  name,
  value,
  onChange,
  alpha = false,
  changed = false,
  onReset,
  issue,
  testId,
}: {
  label: string;
  hint?: ReactNode;
  /** The custom property, shown under the label for people who write CSS. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  alpha?: boolean;
  changed?: boolean;
  onReset?: () => void;
  issue?: string | null;
  testId?: string;
}) {
  const parsed = parseColour(value);
  const hex = parsed ? toHex(parsed.rgb) : "#000000";
  const opacity = parsed ? Math.round(parsed.alpha * 100) : 100;
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  // a change from outside (a reset, another tab of the editor) shows here too
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);

  const commit = (raw: string) => {
    const c = parseColour(raw);
    if (!c) {
      setBad(raw.trim() !== "");
      return;
    }
    setBad(false);
    onChange(toThemeHex(c.rgb, alpha ? c.alpha : 1));
  };

  return (
    <div className={s.colour} data-testid={testId}>
      <label className={s.chip} title={t("settings.themeBuilder.pick", { name: label })}>
        <span style={{ background: value }} />
        <input type="color" value={hex} aria-label={t("settings.themeBuilder.pick", { name: label })} onChange={(e) => onChange(toThemeHex(parseColour(e.target.value)!.rgb, alpha ? (parsed?.alpha ?? 1) : 1))} />
      </label>
      <span className={s.colourText}>
        <span className={s.colourName}>
          {label}
        </span>
        {name ? <span className={s.colourVar}>{name}</span> : null}
        {hint ? <span className={s.fieldHint}>{hint}</span> : null}
        {issue ? (
          <span className={s.colourIssue}>
            <AlertTriangle size={13} aria-hidden="true" /> {issue}
          </span>
        ) : null}
      </span>
      <span className={s.colourEnd}>
        <input
          className={s.hexInput}
          value={text}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label={t("settings.themeBuilder.hexFor", { name: label })}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            setText(e.target.value);
            // taken as soon as it is a whole colour, so the preview follows the typing
            if (/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value.trim())) commit(e.target.value);
          }}
          onBlur={() => {
            commit(text);
            if (!parseColour(text)) setText(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            }
          }}
          dir="ltr"
        />
        {onReset ? (
          <button type="button" className={s.iconBtn} hidden={!changed} onClick={onReset} aria-label={t("settings.themeBuilder.resetNamed", { name: label })} title={t("settings.themeBuilder.resetNamed", { name: label })}>
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        ) : null}
        {onReset && !changed ? <span className={s.resetSpace} aria-hidden="true" /> : null}
      </span>
      {alpha ? (
        <label className={s.colourAlpha}>
          <span>{t("settings.themeBuilder.opacity", { value: opacity })}</span>
          <input type="range" min={0} max={100} step={1} value={opacity} onChange={(e) => parsed && onChange(toThemeHex(parsed.rgb, Number(e.target.value) / 100))} aria-label={t("settings.themeBuilder.opacityOf", { name: label })} aria-valuetext={`${opacity}%`} />
        </label>
      ) : null}
    </div>
  );
}
