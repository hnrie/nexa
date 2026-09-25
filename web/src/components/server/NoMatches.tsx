import { Button } from "@/components/common/Button";
import { t } from "@/i18n";
import st from "@/components/settings/Settings.module.css";

/**
 * A search that matched nothing, said as such. Under an empty result the area
 * used to be blank — or, on the bans page, to say nobody was banned when the
 * query had only filtered fifty bans out — and a failed search, an empty list
 * and a page still loading all looked the same.
 */
export function NoMatches({ query, onClear, people = false }: { query: string; onClear: () => void; people?: boolean }) {
  return (
    <div className={st.noMatches} role="status">
      <p className={st.hint} style={{ margin: 0 }}>{people ? t("friends.nobodyHereMatches", { query: query.trim() }) : t("common.nothingMatches", { query: query.trim() })}</p>
      <Button size="sm" variant="secondary" onClick={onClear}>{t("friends.clearTheSearch")}</Button>
    </div>
  );
}
