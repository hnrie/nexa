import { Avatar } from "@/components/common/Avatar";
import { Toggle } from "@/components/common/Toggle";
import { useAuth } from "@/stores/auth";
import { useSettings, type Theme } from "@/stores/settings";
import { LANGUAGES } from "@/i18n";
import s from "./Settings.module.css";

import { t as tr_ } from "@/i18n";
/** The themes, named per render so the names follow the language. */
function themes(): { id: Theme; name: string; colors: string[] }[] {
  return [
    { id: "dark", name: tr_("settings.appearance.themeDark"), colors: ["#2c2d32", "#323339", "#393a41"] },
    { id: "light", name: tr_("settings.appearance.themeLight"), colors: ["#f3f3f4", "#ffffff", "#ebeced"] },
    { id: "ash", name: tr_("settings.appearance.themeAsh"), colors: ["#1a1a1e", "#232428", "#27272c"] },
    { id: "onyx", name: tr_("settings.appearance.themeOnyx"), colors: ["#000000", "#000000", "#131416"] },
    { id: "system", name: tr_("settings.appearance.themeSystem"), colors: ["#2c2d32", "#f3f3f4", "#8000ff"] },
  ];
}
/** The accent the app uses until one is picked; the Default swatch stands for it. */
const DEFAULT_ACCENT = "#8000ff";
// Default is drawn in the first swatch, so it is not in this list as well:
// listed twice, it was two identical purple squares side by side.
const ACCENTS = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#3498db", "#e91e63"];

export default function AppearancePage() {
  const me = useAuth((a) => a.me);
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const px = Math.round(st.fontScale * 16);
  // the default picked by hand is still the default
  const accent = st.accent === DEFAULT_ACCENT ? null : st.accent;
  return (
    <>
      <h2 className={s.title}>{tr_("settings.appearance.appearance")}</h2>
      <div className={s.previewMsg} style={{ fontSize: `${px}px` }}>
        <Avatar id={me?.id ?? "0"} avatarId={me?.avatar_id ?? null} name={me?.display_name ?? "You"} size={40} />
        <div>
          <span className={s.previewName}>{me?.display_name ?? "You"}</span>
          <span className={s.previewTime}>{tr_("settings.appearance.todayAt420Pm")}</span>
          <div className={s.previewText}>{tr_("settings.appearance.lookAtMeIMA")}</div>
          <div className={s.previewText}>{tr_("settings.appearance.waitingForTheDayWhen")}</div>
        </div>
      </div>
      <h3 className={s.h5}>{tr_("settings.appearance.language")}</h3>
      <p className={s.hint}>{tr_("settings.appearance.languageHint")}</p>
      <div className={s.languages}>
        <button className={s.language} data-on={st.locale === null} aria-pressed={st.locale === null} onClick={() => patch({ locale: null })} data-testid="language-auto">
          {tr_("settings.appearance.matchMyBrowser")}
        </button>
        {LANGUAGES.map((l) => (
          <button
            key={l.tag}
            className={s.language}
            data-on={st.locale === l.tag}
            aria-pressed={st.locale === l.tag}
            onClick={() => patch({ locale: l.tag })}
            data-testid={`language-${l.tag}`}
          >
            {/* Only the name is in its own language and direction. The whole
                tile used to be, which set the Arabic one flush against the
                other edge of the grid, its English gloss with it. */}
            <span className={s.languageName} lang={l.tag} dir={l.rtl ? "rtl" : "ltr"}>{l.endonym}</span>
            <span className={s.languageEnglish}>{l.english}</span>
          </button>
        ))}
      </div>
      <h3 className={s.h5}>{tr_("settings.appearance.theme")}</h3>
      <div className={s.themes}>
        {themes().map((t) => (
          <button key={t.id} className={s.themeCard} data-on={st.theme === t.id} aria-pressed={st.theme === t.id} onClick={() => patch({ theme: t.id })}>
            <div className={s.themeSwatch}>{t.colors.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
            <div className={s.themeName}>{t.name}</div>
          </button>
        ))}
      </div>
      <h3 className={s.h5}>{tr_("settings.appearance.accentColour")}</h3>
      <div className={s.swatches}>
        {/* Named and marked as pressed: a title of "#5865f2" was all a screen reader had, and which one was chosen was only a border. */}
        <button className={s.swatch} data-on={accent === null} aria-pressed={accent === null} style={{ background: DEFAULT_ACCENT }} title={tr_("server.roles.default")} aria-label={tr_("server.roles.default")} onClick={() => patch({ accent: null })} />
        {ACCENTS.map((c, i) => <button key={c} className={s.swatch} data-on={accent === c} aria-pressed={accent === c} style={{ background: c }} title={c} aria-label={tr_("server.roles.colourIndexOfCount", { index: i + 1, count: ACCENTS.length })} onClick={() => patch({ accent: c })} />)}
        <label className={s.swatch} data-on={!!accent && !ACCENTS.includes(accent)} title={tr_("settings.appearance.custom")} style={{ background: accent && !ACCENTS.includes(accent) ? accent : "linear-gradient(135deg,#f00,#0f0,#00f)" }}>
          <input type="color" value={accent ?? DEFAULT_ACCENT} aria-label={tr_("settings.appearance.custom")} onChange={(e) => patch({ accent: e.target.value })} />
        </label>
      </div>
      <h3 className={s.h5}>{tr_("settings.appearance.messageDisplay")}</h3>
      {(["cozy", "compact"] as const).map((m) => (
        <label key={m} className={s.radio} data-on={st.messageDisplay === m}>
          <input type="radio" name="display" checked={st.messageDisplay === m} onChange={() => patch({ messageDisplay: m })} />
          <span className={s.radioText}>
            <span className={s.radioLabel}>{m === "cozy" ? tr_("settings.appearance.cozy") : tr_("settings.appearance.compact")}</span>
            <span className={s.radioDesc}>{m === "cozy" ? tr_("settings.appearance.cozyDesc") : tr_("settings.appearance.compactDesc")}</span>
          </span>
        </label>
      ))}
      <h3 className={s.h5}>{tr_("settings.appearance.chatFontScaling", { px })}</h3>
      <input className={s.slider} type="range" min={12} max={20} step={1} value={px} onChange={(e) => patch({ fontScale: Number(e.target.value) / 16 })} aria-label={tr_("settings.appearance.fontSize")} />
      <h3 className={s.h5}>{tr_("settings.appearance.accessibility")}</h3>
      <Toggle checked={st.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} label={tr_("settings.appearance.reducedMotion")} description={tr_("settings.appearance.disablesAnimationsAndTransitions")} />
      <Toggle checked={st.underlineLinks} onChange={(v) => patch({ underlineLinks: v })} label={tr_("settings.appearance.alwaysUnderlineLinks")} description={tr_("settings.appearance.makesLinksEasierToSpotIn")} />
      <h3 className={s.h5}>{tr_("settings.appearance.typing")}</h3>
      <Toggle checked={st.spellcheck !== false} onChange={(v) => patch({ spellcheck: v })} label={tr_("settings.appearance.spellCheck")} description={tr_("settings.appearance.underlinesMisspelledWordsInTheMessage")} />
    </>
  );
}
