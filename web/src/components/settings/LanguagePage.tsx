import { LANGUAGES, browserLanguage, languageInfo } from "@/i18n";
import { useSettings } from "@/stores/settings";
import s from "./Settings.module.css";

import { t } from "@/i18n";

/** Language: the one the app speaks, or the browser's. */
export default function LanguagePage() {
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  // the tile says which language that comes to, like the others say theirs
  const browser = languageInfo(browserLanguage());
  return (
    <>
      <h2 className={s.title} data-setting="language">{t("settings.appearance.language")}</h2>
      <p className={s.hint}>{t("settings.appearance.languageHint")}</p>
      <div className={s.languages} style={{ marginTop: 10 }}>
        <button className={s.language} data-on={st.locale === null} aria-pressed={st.locale === null} onClick={() => patch({ locale: null })} data-testid="language-auto">
          <span className={s.languageName}>{t("settings.appearance.matchMyBrowser")}</span>
          {browser ? <span className={s.languageEnglish} lang={browser.tag} dir={browser.rtl ? "rtl" : "ltr"}>{browser.endonym}</span> : null}
        </button>
        {LANGUAGES.map((l) => (
          <button key={l.tag} className={s.language} data-on={st.locale === l.tag} aria-pressed={st.locale === l.tag} onClick={() => patch({ locale: l.tag })} data-testid={`language-${l.tag}`}>
            {/* Only the name is in its own language and direction. The whole
                tile used to be, which set the Arabic one flush against the
                other edge of the grid, its English gloss with it. */}
            <span className={s.languageName} lang={l.tag} dir={l.rtl ? "rtl" : "ltr"}>{l.endonym}</span>
            <span className={s.languageEnglish}>{l.english}</span>
          </button>
        ))}
      </div>
    </>
  );
}
