import { Info } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/common/Button";
import { Field } from "@/components/common/TextInput";
import { Select } from "@/components/common/Select";
import { Toggle } from "@/components/common/Toggle";
import { t } from "@/i18n";
import { flipBackground, schemeOf, type Derived } from "@/lib/look/derive";
import { PRESETS, presetColours } from "@/lib/look/presets";
import { seasonById } from "@/lib/look/seasonal";
import { CLASSIC, isClassic } from "@/lib/look/tokens";
import type { Scheme, SimpleColours } from "@/lib/look/types";
import { ColourField } from "./ColourField";
import s from "./Look.module.css";

/**
 * The few colours a preset starts from, for "Start from"; a classic theme gives
 * its page and the default purple. A seasonal theme gives its own, so a new
 * theme made while wearing one can keep its colours after the season.
 */
export function startingColours(id: string): SimpleColours | null {
  const made = presetColours(id);
  if (made) return made;
  const season = seasonById(id);
  if (season) return { background: season.background, accent: season.accent, text: null, scheme: season.scheme };
  if (!isClassic(id)) return null;
  return { background: CLASSIC[id]["bg-raised"], accent: CLASSIC[id].brand, text: null, scheme: id === "light" ? "light" : "dark" };
}

/**
 * Simple mode: a background, an accent, dark or light, and if wanted the text
 * colour. derive.ts works everything else out and keeps it readable; when it
 * had to move one of these to do that, this says which and why.
 */
export function SimpleEditor({ value, onChange, derived, handSet, onClearHandSet }: { value: SimpleColours; onChange: (v: SimpleColours) => void; derived: Derived; handSet: number; onClearHandSet: () => void }) {
  const modeId = useId();
  const setScheme = (scheme: Scheme) => {
    if (scheme === value.scheme) return;
    // the same tint, carried over to a background of the other kind
    onChange({ ...value, scheme, background: flipBackground(value.background, scheme) });
  };
  const moved = [derived.adjusted.background ? t("settings.themeBuilder.adjustedBackground") : null, derived.adjusted.accent ? t("settings.themeBuilder.adjustedAccent") : null, derived.adjusted.text ? t("settings.themeBuilder.adjustedText") : null].filter(Boolean) as string[];
  return (
    <div>
      <p className={s.panelHint}>{t("settings.themeBuilder.simpleHint")}</p>
      <div className={s.fieldRow}>
        <span className={s.fieldLabel} id={modeId}>
          {t("settings.themeBuilder.mode")}
        </span>
        <div className={s.segment} role="radiogroup" aria-labelledby={modeId}>
          {(["dark", "light"] as const).map((m) => (
            <label key={m}>
              <input type="radio" name={`${modeId}-mode`} checked={value.scheme === m} onChange={() => setScheme(m)} data-testid={`builder-mode-${m}`} />
              {m === "dark" ? t("settings.themeBuilder.modeDark") : t("settings.themeBuilder.modeLight")}
            </label>
          ))}
        </div>
      </div>
      <ColourField
        label={t("settings.themeBuilder.background")}
        hint={t("settings.themeBuilder.backgroundHint")}
        value={value.background}
        // a background picked on the other side of middle grey takes its scheme with it
        onChange={(background) => onChange({ ...value, background, scheme: schemeOf(background) })}
        testId="builder-background"
      />
      <ColourField label={t("settings.themeBuilder.accent")} hint={t("settings.themeBuilder.accentHint")} value={value.accent} onChange={(accent) => onChange({ ...value, accent })} testId="builder-accent" />
      <div className={s.fieldRow} style={{ borderBottom: value.text ? "0" : undefined }}>
        <Toggle
          checked={value.text !== null}
          onChange={(on) => onChange({ ...value, text: on ? derived.tokens.text : null })}
          label={t("settings.themeBuilder.textOwn")}
          description={value.text === null ? t("settings.themeBuilder.textAuto") : undefined}
        />
      </div>
      {value.text !== null ? <ColourField label={t("settings.themeBuilder.text")} value={value.text} onChange={(text) => onChange({ ...value, text })} testId="builder-text" /> : null}
      {moved.length ? (
        <div className={s.notice} role="status" data-testid="builder-adjusted">
          <Info size={16} aria-hidden="true" />
          <div className={s.noticeBody}>
            {moved.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        </div>
      ) : null}
      {handSet > 0 ? (
        <div className={s.notice}>
          <Info size={16} aria-hidden="true" />
          <p className={s.noticeBody}>{t("settings.themeBuilder.handSet", { count: handSet })}</p>
          <Button className={s.noticeAction} variant="secondary" size="sm" onClick={onClearHandSet}>
            {t("settings.themeBuilder.clearHandSet")}
          </Button>
        </div>
      ) : null}
      <div className={s.startRow}>
        <Field label={t("settings.themeBuilder.startFrom")} hint={t("settings.themeBuilder.startFromHint")}>
          <Select
            value=""
            onChange={(e) => {
              const c = startingColours(e.target.value);
              if (c) onChange(c);
            }}
            data-testid="builder-start"
          >
            <option value="" disabled>
              {t("settings.themeBuilder.chooseTheme")}
            </option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.nameKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
