import { Toggle } from "@/components/common/Toggle";
import { useSettings } from "@/stores/settings";
import s from "./Settings.module.css";

import { t } from "@/i18n";

/** Accessibility: movement, links that stand out, and where the text size is. */
export default function AccessibilityPage({ onTextSize }: { onTextSize: () => void }) {
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  return (
    <>
      <h2 className={s.title}>{t("settings.appearance.accessibility")}</h2>
      <h3 className={s.h5}>{t("settings.accessibility.motion")}</h3>
      <Toggle setting="reducedMotion" checked={st.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} label={t("settings.appearance.reducedMotion")} description={t("settings.appearance.disablesAnimationsAndTransitions")} />
      <h3 className={s.h5}>{t("settings.accessibility.reading")}</h3>
      <Toggle setting="underlineLinks" checked={st.underlineLinks} onChange={(v) => patch({ underlineLinks: v })} label={t("settings.appearance.alwaysUnderlineLinks")} description={t("settings.appearance.makesLinksEasierToSpotIn")} />
      <p className={s.hint}>
        {t("settings.accessibility.textSizeIsIn")}{" "}
        <button type="button" className={s.inlineLink} onClick={onTextSize}>{t("settings.accessibility.goToTextSize")}</button>
      </p>
    </>
  );
}
