/**
 * Privacy & Safety → Search: whether this account keeps a search index on its
 * devices, how much this one holds, and a way to start it again or forget
 * the searches the box offers.
 */
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Toggle } from "@/components/common/Toggle";
import s from "@/components/settings/Settings.module.css";
import { t } from "@/i18n";
import { rebuildSearchIndex, useSearchIndex } from "@/search/indexer";
import { clearRecentSearches } from "@/search/recent";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

export function SearchSettings() {
  const settings = useSettings((st) => st.settings);
  const patch = useSettings((st) => st.patch);
  const toast = useUI((u) => u.toast);
  const index = useSearchIndex();
  const [busy, setBusy] = useState(false);
  const on = settings.searchIndex !== false;
  const rebuild = async () => {
    setBusy(true);
    try {
      await rebuildSearchIndex();
      toast(t("settings.privacy.searchRebuilding"), "success");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3 className={s.h5}>{t("settings.privacy.search")}</h3>
      <Toggle checked={on} onChange={(v) => patch({ searchIndex: v })} label={t("settings.privacy.searchIndex")} description={t("settings.privacy.searchIndexHint")} />
      <p className={s.hint} style={{ marginBottom: 8 }} data-testid="search-index-info">
        {index.mode === "disk" ? t("settings.privacy.searchIndexCount", { count: index.docs }) : index.mode === "memory" ? t("settings.privacy.searchIndexMemory") : t("settings.privacy.searchIndexClosed")}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {on ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void rebuild()} data-testid="search-rebuild">
            {t("settings.privacy.searchRebuild")}
          </Button>
        ) : null}
        {settings.searchRecent.length ? (
          <Button size="sm" variant="secondary" onClick={clearRecentSearches} data-testid="search-forget-recent">
            {t("settings.privacy.searchForgetRecent")}
          </Button>
        ) : null}
      </div>
    </>
  );
}
