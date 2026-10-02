import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { offerOf, Progress } from "@/components/shell/UpdateDialog";
import { t } from "@/i18n";
import { applyUpdate } from "@/lib/appUpdate";
import { desktopBridge } from "@/lib/desktopBridge";
import { inOldMacApp, useMacReplacement } from "@/lib/macReplacement";
import { modKeys } from "@/lib/textMenu";
import { useDesktop } from "@/stores/desktop";
import s from "@/components/shell/Update.module.css";

/**
 * What Paste in the right-click menu says in a desktop app too old to paste
 * for the page (lib/desktopBridge pasteNeedsUpdate): that the newest version
 * can, with the way to it. That is the app's own update where it can update
 * itself, or the new version's download for a Mac copy that cannot
 * (lib/macReplacement), the same offer the update prompt makes.
 */
export function PasteUpdateDialog({ onClose }: { onClose: () => void }) {
  const desktop = useDesktop((d) => d.update);
  const replacement = useMacReplacement();
  const [asked, setAsked] = useState(false);
  const oldMac = inOldMacApp();
  const offer = offerOf(null, desktop, true, replacement);
  const checking = asked && desktop?.status === "checking";
  const failed = asked && desktop?.status === "error";

  const downloadPage = () => {
    window.open(new URL("/download", window.location.origin).toString(), "_blank", "noopener");
    onClose();
  };
  const go = () => {
    if (offer?.kind === "replace" || offer?.kind === "manual") {
      if (offer.url) window.open(offer.url, "_blank", "noopener");
      onClose();
      return;
    }
    if (offer?.kind === "ready" || offer?.kind === "downloading") {
      // waits for the download, a call or a message on its way, as the update prompt's Update does
      void applyUpdate("restart");
      onClose();
      return;
    }
    // nothing found yet: a Mac copy this old has nowhere to look but the download page
    if (oldMac) return downloadPage();
    setAsked(true);
    void desktopBridge()?.updates.check().catch(() => undefined);
  };
  const label = offer?.kind === "replace" || offer?.kind === "manual" ? t("shell.update.download") : offer ? t("shell.update.update") : oldMac ? t("pasteUpdate.downloadPage") : failed ? t("pasteUpdate.tryAgain") : t("pasteUpdate.check");
  const version = offer && offer.kind !== "web" ? offer.version : null;

  return (
    <Modal
      open
      centered
      onClose={onClose}
      title={t("pasteUpdate.title")}
      width={440}
      footer={
        <>
          <Button variant="secondary" className={s.action} onClick={onClose} data-testid="paste-update-later">
            {t("pasteUpdate.notNow")}
          </Button>
          <Button className={s.action} onClick={go} loading={checking} data-testid="paste-update-go">
            {label}
          </Button>
        </>
      }
    >
      <div data-testid="paste-update" data-kind={offer?.kind ?? (oldMac ? "page" : "check")}>
        <p className={s.lead}>{t("pasteUpdate.body", { keys: modKeys("V") })}</p>
        {offer?.kind === "replace" ? <p className={s.lead}>{t("pasteUpdate.replaceBody")}</p> : null}
        {offer?.kind === "ready" ? <p className={s.lead}>{t("shell.update.readyBody")}</p> : null}
        {version ? <p className={s.version}>{t("shell.update.version", { version })}</p> : null}
        {offer?.kind === "downloading" ? <Progress value={offer.progress} /> : null}
        {failed ? (
          <p className={s.lead} role="alert">
            {t("pasteUpdate.failed")}{" "}
            <button type="button" className={s.link} onClick={downloadPage}>
              {t("pasteUpdate.downloadPage")}
            </button>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
