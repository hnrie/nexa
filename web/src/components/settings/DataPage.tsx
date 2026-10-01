import { useState } from "react";
import { Button } from "@/components/common/Button";
import { describeError } from "@/lib/errors";
import { downloadBytes, exportMyData } from "@/lib/export";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";

/** Your Data: everything this device can read, as one download. */
export default function DataPage({ onDeleteAccount }: { onDeleteAccount: () => void }) {
  const toast = useUI((u) => u.toast);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");
  const run = async () => {
    setExporting(true);
    try {
      const bytes = await exportMyData(setStatus);
      downloadBytes(`evilion-chat-export-${new Date().toISOString().slice(0, 10)}.zip`, bytes);
    } catch (err) {
      toast(describeError(err, t("settings.privacy.couldNotExportYourData")), "error");
    } finally {
      setExporting(false);
      setStatus("");
    }
  };
  return (
    <>
      <h2 className={s.title}>{t("settings.privacy.yourData")}</h2>
      <h3 className={s.h5} data-setting="export">{t("settings.data.export")}</h3>
      <p className={s.hint} style={{ marginBottom: 8 }}>{t("settings.privacy.downloadEverythingYourProfileFriendsServers")}</p>
      <Button size="sm" variant="secondary" loading={exporting} onClick={() => void run()} data-testid="export-data">{t("settings.privacy.exportMyData")}</Button>
      {/* the button hides its label while loading, so the progress goes under it */}
      {exporting && status ? <p className={s.hint} aria-live="polite">{status}</p> : null}
      <h3 className={s.h5}>{t("settings.account.accountRemoval")}</h3>
      <p className={s.hint}>
        {t("settings.data.deleteIsIn")}{" "}
        <button type="button" className={s.inlineLink} onClick={onDeleteAccount}>{t("settings.data.goToMyAccount")}</button>
      </p>
    </>
  );
}
