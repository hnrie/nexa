import { Check, Pencil, Plus, Upload } from "lucide-react";
import { useId, useMemo } from "react";
import { Button } from "@/components/common/Button";
import { seasonArt, useToday } from "@/components/common/SeasonalPerch";
import { Field } from "@/components/common/TextInput";
import { Select } from "@/components/common/Select";
import { Toggle } from "@/components/common/Toggle";
import { t, useLocale } from "@/i18n";
import { MAX_CUSTOM_THEMES, resolveCustom, sanitizeThemes, themeTokens } from "@/lib/look/customTheme";
import { PRESETS, presetCards, type PresetGroup } from "@/lib/look/presets";
import { seasonCards, seasonEnd, seasonalTokens, seasonById, seasonsOn } from "@/lib/look/seasonal";
import { CLASSIC } from "@/lib/look/tokens";
import type { CustomTheme } from "@/lib/look/types";
import { resolveLook } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { SplitMiniature, ThemeMiniature } from "./ThemeMiniature";
import s from "./Look.module.css";

/** The custom themes in the settings, checked: they arrive from every device of the account. */
export function useCustomThemes(): CustomTheme[] {
  const raw = useSettings((x) => x.settings.customThemes);
  return useMemo(() => sanitizeThemes(raw), [raw]);
}

/** The name a theme is shown under, whatever kind it is. */
export function themeName(id: string, customs: readonly CustomTheme[]): string {
  if (id === "system") return t("settings.appearance.themeSystem");
  const preset = PRESETS.find((p) => p.id === id) ?? seasonById(id);
  if (preset) return t(preset.nameKey);
  const custom = customs.find((c) => c.id === id);
  return custom ? custom.name || t("settings.themeBuilder.untitled") : t("settings.appearance.themeDark");
}

// a theme's light version shares its dark one's card, so the colour themes are one group rather than a dark and a light one
const GROUPS: { id: string; groups: PresetGroup[]; label: string }[] = [
  { id: "classic", groups: ["classic"], label: "settings.appearance.groupClassic" },
  { id: "colours", groups: ["dark", "light"], label: "settings.appearance.groupColours" },
  { id: "plain", groups: ["plain"], label: "settings.appearance.groupPlain" },
];

function Card({ id, name, note, on, onPick, children }: { id: string; name: string; note?: string; on: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={s.card} data-on={on} aria-pressed={on} onClick={onPick} data-theme-id={id}>
      <span className={s.art}>
        {children}
        {on ? (
          <span className={s.check} aria-hidden="true">
            <Check size={14} strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className={s.cardName} dir="auto">
        {name}
      </span>
      {note ? <span className={s.cardNote}>{note}</span> : null}
    </button>
  );
}

/**
 * A theme that comes in light and dark: one card showing the version being
 * worn (or `shown`), with a switch between the two in its corner. Each swatch
 * is that version's own background, and puts it on.
 */
function ModeCard({ light, dark, shown, pick, swatch, label, children }: { light: string; dark: string; shown: string; pick: (id: string) => void; swatch: (id: string) => string; label: string; children: React.ReactNode }) {
  return (
    <div className={s.cardWrap}>
      {children}
      <div className={s.modes} role="radiogroup" aria-label={label}>
        {[light, dark].map((id) => {
          const name = t(id === dark ? "settings.appearance.themeDark" : "settings.appearance.themeLight");
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={shown === id}
              className={s.mode}
              data-on={shown === id}
              style={{ background: swatch(id) }}
              aria-label={name}
              title={name}
              data-testid={`theme-mode-${id}`}
              onClick={() => pick(id)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every theme there is to pick, each shown as itself. Picking one puts it on
 * straight away, on every device the account uses.
 */
export function ThemeGallery({ onEdit, onNew, onImport }: { onEdit: (id: string) => void; onNew: () => void; onImport: () => void }) {
  const theme = useSettings((x) => x.settings.theme);
  const pair = useSettings((x) => x.settings.systemThemes);
  const patch = useSettings((x) => x.patch);
  const customs = useCustomThemes();
  const headId = useId();
  const pick = (id: string) => patch({ theme: id });
  const tokensOf = (id: string) => themeTokens(id, customs) ?? CLASSIC.dark;
  const swatch = (id: string) => tokensOf(id)["bg-raised"];
  // A card that comes in light and dark shows, and puts on, the version in the
  // mode being worn now: from a dark theme every such card offers its dark
  // version, so going from one to another never switches light and dark.
  const mode = resolveLook({ theme, accent: null, fontScale: 1, reducedMotion: false, underlineLinks: false, customThemes: customs, systemThemes: pair }).scheme;
  // what "Sync with system" can move between: any theme of the right kind, custom ones too
  const schemeOf = (id: string) => {
    const custom = customs.find((c) => c.id === id);
    return custom ? resolveCustom(custom).scheme : (PRESETS.find((p) => p.id === id)?.scheme ?? "dark");
  };
  const choices = (scheme: "dark" | "light") => [...PRESETS.map((p) => p.id), ...customs.map((c) => c.id)].filter((id) => schemeOf(id) === scheme);
  const full = customs.length >= MAX_CUSTOM_THEMES;
  const today = useToday();
  const seasons = seasonsOn(today);
  const snow = useSettings((x) => x.settings.seasonalSnow !== false);
  // in the app's language, not the browser's: "Till 2 november", not "Till November 2"
  const locale = useLocale();
  const until = (d: Date) => t("settings.appearance.seasonUntil", { date: d.toLocaleDateString(locale, { month: "long", day: "numeric" }) });

  return (
    <div>
      {seasons.length ? (
        // only while a season is on: offered alongside the rest, never put on by itself
        <div className={s.group} role="group" aria-labelledby={`${headId}-seasonal`} data-testid="theme-group-seasonal">
          <div className={s.groupHead}>
            <h4 className={s.groupTitle} id={`${headId}-seasonal`}>
              {t("settings.appearance.groupSeasonal")}
            </h4>
          </div>
          <div className={s.grid}>
            {seasonCards(seasons).map(({ light, dark }) => {
              const x = dark && mode === "dark" ? dark : light;
              const card = (
                <Card key={light.id} id={x.id} name={t(light.nameKey)} note={until(seasonEnd(x, today))} on={theme === x.id} onPick={() => pick(x.id)}>
                  <ThemeMiniature tokens={seasonalTokens(x.id)!} />
                  <img className={s.seasonArt} src={seasonArt(x)} alt="" aria-hidden="true" draggable={false} />
                </Card>
              );
              return dark ? (
                <ModeCard key={light.id} light={light.id} dark={dark.id} shown={x.id} pick={pick} swatch={swatch} label={t(light.nameKey)}>
                  {card}
                </ModeCard>
              ) : (
                card
              );
            })}
          </div>
          <p className={s.groupHint}>{t("settings.appearance.seasonalHint")}</p>
          {seasons.some((x) => x.snow) ? (
            <div className={s.seasonToggle}>
              <Toggle setting="seasonalSnow" checked={snow} onChange={(v) => patch({ seasonalSnow: v })} label={t("settings.appearance.seasonalSnow")} description={t("settings.appearance.seasonalSnowHint")} />
            </div>
          ) : null}
        </div>
      ) : null}
      {GROUPS.map((g) => (
        <div key={g.id} className={s.group} role="group" aria-labelledby={`${headId}-${g.id}`}>
          <div className={s.groupHead}>
            <h4 className={s.groupTitle} id={`${headId}-${g.id}`}>
              {t(g.label)}
            </h4>
          </div>
          <div className={s.grid}>
            {presetCards(g.groups).map(({ preset, light, dark }) => {
              const x = light && mode === "light" ? light : preset;
              const card = (
                <Card key={preset.id} id={x.id} name={t(preset.nameKey)} on={theme === x.id} onPick={() => pick(x.id)}>
                  <ThemeMiniature tokens={tokensOf(x.id)} />
                </Card>
              );
              return light && dark ? (
                <ModeCard key={preset.id} light={light.id} dark={dark.id} shown={x.id} pick={pick} swatch={swatch} label={t(preset.nameKey)}>
                  {card}
                </ModeCard>
              ) : (
                card
              );
            })}
            {g.id === "classic" ? (
              <Card id="system" name={t("settings.appearance.themeSystem")} on={theme === "system"} onPick={() => pick("system")}>
                <SplitMiniature dark={tokensOf(pair.dark)} light={tokensOf(pair.light)} />
              </Card>
            ) : null}
          </div>
          {g.id === "classic" && theme === "system" ? (
            <div className={s.pair}>
              <Field label={t("settings.appearance.systemDark")}>
                <Select value={schemeOf(pair.dark) === "dark" ? pair.dark : "dark"} onChange={(e) => patch({ systemThemes: { ...pair, dark: e.target.value } })}>
                  {choices("dark").map((id) => (
                    <option key={id} value={id}>
                      {themeName(id, customs)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("settings.appearance.systemLight")}>
                <Select value={schemeOf(pair.light) === "light" ? pair.light : "light"} onChange={(e) => patch({ systemThemes: { ...pair, light: e.target.value } })}>
                  {choices("light").map((id) => (
                    <option key={id} value={id}>
                      {themeName(id, customs)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className={s.pairHint}>{t("settings.appearance.systemHint")}</p>
            </div>
          ) : null}
        </div>
      ))}
      <div className={s.group} role="group" aria-labelledby={`${headId}-yours`}>
        <div className={s.groupHead}>
          <h4 className={s.groupTitle} id={`${headId}-yours`}>
            {t("settings.appearance.groupYours")}
          </h4>
          <div className={s.groupActions}>
            <Button variant="ghost" size="sm" onClick={onImport} data-testid="theme-import">
              <Upload size={15} aria-hidden="true" /> {t("settings.appearance.importTheme")}
            </Button>
          </div>
        </div>
        <div className={s.grid}>
          {customs.map((c) => (
            <div key={c.id} className={s.cardWrap}>
              <Card id={c.id} name={c.name || t("settings.themeBuilder.untitled")} on={theme === c.id} onPick={() => pick(c.id)}>
                <ThemeMiniature tokens={tokensOf(c.id)} />
              </Card>
              <button type="button" className={s.cardEdit} onClick={() => onEdit(c.id)} aria-label={t("settings.appearance.editTheme", { name: c.name || t("settings.themeBuilder.untitled") })} title={t("settings.appearance.editTheme", { name: c.name || t("settings.themeBuilder.untitled") })} data-testid="theme-edit">
                <Pencil size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
          {full ? null : (
            <button type="button" className={s.card} onClick={onNew} data-testid="theme-new">
              <span className={s.newArt}>
                <Plus size={22} aria-hidden="true" />
              </span>
              <span className={s.cardName}>{t("settings.appearance.newTheme")}</span>
            </button>
          )}
        </div>
        {full ? <p className={s.pairHint}>{t("settings.themeBuilder.limit", { max: MAX_CUSTOM_THEMES })}</p> : null}
      </div>
    </div>
  );
}

