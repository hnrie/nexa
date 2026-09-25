import { Check, Pencil, Plus, Upload } from "lucide-react";
import { useId, useMemo } from "react";
import { Button } from "@/components/common/Button";
import { Field } from "@/components/common/TextInput";
import { Select } from "@/components/common/Select";
import { t } from "@/i18n";
import { MAX_CUSTOM_THEMES, resolveCustom, sanitizeThemes, themeTokens } from "@/lib/look/customTheme";
import { PRESETS, type PresetGroup } from "@/lib/look/presets";
import { CLASSIC } from "@/lib/look/tokens";
import type { CustomTheme } from "@/lib/look/types";
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
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) return t(preset.nameKey);
  const custom = customs.find((c) => c.id === id);
  return custom ? custom.name || t("settings.themeBuilder.untitled") : t("settings.appearance.themeDark");
}

const GROUPS: { id: PresetGroup; label: string }[] = [
  { id: "classic", label: "settings.appearance.groupClassic" },
  { id: "dark", label: "settings.appearance.groupDark" },
  { id: "light", label: "settings.appearance.groupLight" },
  { id: "plain", label: "settings.appearance.groupPlain" },
];

function Card({ id, name, on, onPick, children }: { id: string; name: string; on: boolean; onPick: () => void; children: React.ReactNode }) {
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
    </button>
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
  // what "Sync with system" can move between: any theme of the right kind, custom ones too
  const schemeOf = (id: string) => {
    const custom = customs.find((c) => c.id === id);
    return custom ? resolveCustom(custom).scheme : (PRESETS.find((p) => p.id === id)?.scheme ?? "dark");
  };
  const choices = (scheme: "dark" | "light") => [...PRESETS.map((p) => p.id), ...customs.map((c) => c.id)].filter((id) => schemeOf(id) === scheme);
  const full = customs.length >= MAX_CUSTOM_THEMES;

  return (
    <div>
      {GROUPS.map((g) => (
        <div key={g.id} className={s.group} role="group" aria-labelledby={`${headId}-${g.id}`}>
          <div className={s.groupHead}>
            <h4 className={s.groupTitle} id={`${headId}-${g.id}`}>
              {t(g.label)}
            </h4>
          </div>
          <div className={s.grid}>
            {PRESETS.filter((p) => p.group === g.id).map((p) => (
              <Card key={p.id} id={p.id} name={t(p.nameKey)} on={theme === p.id} onPick={() => pick(p.id)}>
                <ThemeMiniature tokens={tokensOf(p.id)} />
              </Card>
            ))}
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

