import { Check, Pipette, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Toggle } from "@/components/common/Toggle";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { LANGUAGES } from "@/i18n";
import { readableOn } from "@/lib/color";
import { newThemeId, themeTokens } from "@/lib/look/customTheme";
import type { CustomTheme } from "@/lib/look/types";
import { resolveLook } from "@/lib/theme";
import { forget } from "@/lib/spell";
import { ImportThemeDialog } from "./look/ImportThemeDialog";
import { startingColours } from "./look/SimpleEditor";
import { ThemeBuilder } from "./look/ThemeBuilder";
import { ThemeGallery, useCustomThemes } from "./look/ThemeGallery";
import look from "./look/Look.module.css";
import s from "./Settings.module.css";

import { t as tr_ } from "@/i18n";
/** The accent the app uses until one is picked; the Default swatch stands for it. */
const DEFAULT_ACCENT = "#8000ff";
// Default is drawn in the first swatch, so it is not in this list as well:
// listed twice, it was two identical purple squares side by side.
const ACCENTS = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#3498db", "#e91e63"];

/** The scrolling column a settings page sits in, to bring a sub-page in at its top. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export default function AppearancePage() {
  const me = useAuth((a) => a.me);
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  const customs = useCustomThemes();
  const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const px = Math.round(st.fontScale * 16);
  // the default picked by hand is still the default
  const accent = st.accent === DEFAULT_ACCENT ? null : st.accent;
  const shown = resolveLook({ ...st, customThemes: customs });
  // Default means the theme's own accent, so the swatch shows that
  const themeAccent = themeTokens(shown.id, customs)?.brand ?? DEFAULT_ACCENT;

  useLayoutEffect(() => {
    const col = scroller(top.current);
    col?.scrollTo?.(0, 0);
  }, [editing]);

  const startNew = () => {
    const from = customs.find((c) => c.id === shown.id);
    const theme: CustomTheme = from
      ? { ...from, id: newThemeId(), name: tr_("settings.themeBuilder.copyOf", { name: from.name || tr_("settings.themeBuilder.untitled") }) }
      : { id: newThemeId(), name: tr_("settings.themeBuilder.defaultName"), source: { kind: "simple", ...(startingColours(shown.id) ?? startingColours("dark")!) }, overrides: {} };
    setEditing({ theme, isNew: true });
  };

  if (editing) {
    return (
      <div ref={top}>
        <ThemeBuilder key={editing.theme.id} initial={editing.theme} isNew={editing.isNew} onClose={() => setEditing(null)} />
      </div>
    );
  }

  return (
    <div ref={top}>
      <h2 className={s.title}>{tr_("settings.appearance.appearance")}</h2>
      <p className={look.lead}>{tr_("settings.appearance.lead")}</p>
      <h3 className={s.h5}>{tr_("settings.appearance.theme")}</h3>
      <ThemeGallery
        onEdit={(id) => {
          const theme = customs.find((c) => c.id === id);
          if (theme) setEditing({ theme, isNew: false });
        }}
        onNew={startNew}
        onImport={() => setImporting(true)}
      />
      {importing ? (
        <ImportThemeDialog
          onClose={() => setImporting(false)}
          onOpen={(theme) => {
            setImporting(false);
            setEditing({ theme, isNew: true });
          }}
        />
      ) : null}
      <h3 className={s.h5}>{tr_("settings.appearance.accentColour")}</h3>
      <p className={s.hint} style={{ margin: "0 0 10px" }}>
        {tr_("settings.appearance.accentHint")}
      </p>
      <div className={s.swatches}>
        {/* Named and marked as pressed: a title of "#5865f2" was all a screen reader had, and which one was chosen was only a border. */}
        <button className={s.swatch} data-on={accent === null} aria-pressed={accent === null} style={{ background: themeAccent }} title={tr_("settings.appearance.accentDefault")} aria-label={tr_("settings.appearance.accentDefault")} onClick={() => patch({ accent: null })} data-testid="accent-default">
          {accent === null ? (
            <span className={look.swatchCheck}>
              <Check size={18} strokeWidth={3} color={readableOn(themeAccent)} aria-hidden="true" />
            </span>
          ) : null}
        </button>
        {ACCENTS.map((c, i) => <button key={c} className={s.swatch} data-on={accent === c} aria-pressed={accent === c} style={{ background: c }} title={c} aria-label={tr_("server.roles.colourIndexOfCount", { index: i + 1, count: ACCENTS.length })} onClick={() => patch({ accent: c })} />)}
        <label className={[s.swatch, look.swatchPick].join(" ")} data-on={!!accent && !ACCENTS.includes(accent)} title={tr_("settings.appearance.custom")} style={accent && !ACCENTS.includes(accent) ? { background: accent } : undefined}>
          {accent && !ACCENTS.includes(accent) ? null : <Pipette size={18} aria-hidden="true" />}
          <input type="color" value={accent ?? themeAccent} aria-label={tr_("settings.appearance.custom")} onChange={(e) => patch({ accent: e.target.value })} />
        </label>
      </div>
      <h3 className={[s.h5, look.sizeHead].join(" ")}>
        <span>{tr_("settings.appearance.textSize")}</span>
        <span className={look.sizeValue}>{tr_("settings.appearance.textSizeValue", { px })}</span>
      </h3>
      <input className={s.slider} type="range" min={12} max={20} step={1} value={px} onChange={(e) => patch({ fontScale: Number(e.target.value) / 16 })} aria-label={tr_("settings.appearance.fontSize")} aria-valuetext={tr_("settings.appearance.textSizeValue", { px })} />
      <div className={s.previewMsg} style={{ fontSize: `${px}px`, marginTop: 12 }}>
        <Avatar id={me?.id ?? "0"} avatarId={me?.avatar_id ?? null} name={me?.display_name ?? "You"} size={40} />
        <div>
          <span className={s.previewName}>{me?.display_name ?? "You"}</span>
          <span className={s.previewTime}>{tr_("settings.appearance.todayAt420Pm")}</span>
          <div className={s.previewText}>{tr_("settings.appearance.lookAtMeIMA")}</div>
          <div className={s.previewText}>{tr_("settings.appearance.waitingForTheDayWhen")}</div>
        </div>
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
      <h3 className={s.h5}>{tr_("settings.appearance.language")}</h3>
      <p className={s.hint}>{tr_("settings.appearance.languageHint")}</p>
      <div className={s.languages} style={{ marginTop: 10 }}>
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
      <h3 className={s.h5}>{tr_("settings.appearance.accessibility")}</h3>
      <Toggle checked={st.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} label={tr_("settings.appearance.reducedMotion")} description={tr_("settings.appearance.disablesAnimationsAndTransitions")} />
      <Toggle checked={st.underlineLinks} onChange={(v) => patch({ underlineLinks: v })} label={tr_("settings.appearance.alwaysUnderlineLinks")} description={tr_("settings.appearance.makesLinksEasierToSpotIn")} />
      <h3 className={s.h5}>{tr_("settings.appearance.typing")}</h3>
      <Toggle checked={st.spellcheck !== false} onChange={(v) => patch({ spellcheck: v })} label={tr_("settings.appearance.spellCheck")} description={tr_("settings.appearance.underlinesMisspelledWordsInTheMessage")} />
      {st.spellWords.length ? (
        // the words added from the right-click menu, each one a click away from being checked again
        <div className={s.spellWords} role="group" aria-labelledby="spell-words-head" data-testid="spell-words">
          <div className={s.spellWordsHead} id="spell-words-head">{tr_("settings.appearance.yourWords")}</div>
          <div className={s.spellWordList}>
            {st.spellWords.map((w) => (
              <span key={w} className={s.spellWord}>
                <span dir="auto">{w}</span>
                <button type="button" className={s.spellWordRemove} aria-label={tr_("settings.appearance.removeWord", { word: w })} title={tr_("settings.appearance.removeWord", { word: w })} onClick={() => forget(w)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <Toggle checked={st.sendButton} onChange={(v) => patch({ sendButton: v })} label={tr_("settings.appearance.sendButton")} description={tr_("settings.appearance.sendButtonHint")} />
    </div>
  );
}
