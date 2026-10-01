import { Toggle } from "@/components/common/Toggle";
import { useSettings } from "@/stores/settings";
import s from "./Settings.module.css";

import { t } from "@/i18n";

/** Advanced: what only someone building on Nexa needs. */
export default function AdvancedPage() {
  const st = useSettings((x) => x.settings);
  const patch = useSettings((x) => x.patch);
  return (
    <>
      <h2 className={s.title}>{t("settings.privacy.advanced")}</h2>
      <Toggle setting="developerMode" checked={st.developerMode} onChange={(v) => patch({ developerMode: v })} label={t("settings.privacy.developerMode")} description={t("settings.privacy.addsCopyIdOptionsToContext")} />
    </>
  );
}
