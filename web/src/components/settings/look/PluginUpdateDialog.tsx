import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { t } from "@/i18n";
import { codeKey, lookCache } from "@/lib/look/cache";
import { shortHash } from "@/lib/look/hash";
import type { PluginEntry } from "@/lib/look/types";
import { formatBytes } from "@/lib/time";
import { Caution } from "./Caution";
import s from "./Look.module.css";

/** Shown in full up to this; past it the start is shown and the size says the rest. */
const SHOW_MAX = 200_000;

/**
 * The code behind a plugin's link has changed since it was approved. Nothing
 * of it has run: this says what changed, shows the new code for anyone who
 * wants to read it, and runs it only once the person ticks that they trust it.
 */
export function PluginUpdateDialog({ entry, name, update, onClose, onAccept, onKeep }: { entry: PluginEntry; name: string; update: { hash: string; size: number; code: string }; onClose: () => void; onAccept: () => void; onKeep: () => void }) {
  const [agree, setAgree] = useState(false);
  const [oldSize, setOldSize] = useState<number | null>(null);
  useEffect(() => {
    void lookCache.get(codeKey(entry.hash)).then((f) => setOldSize(f ? new TextEncoder().encode(f.text).length : null));
  }, [entry.hash]);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("look.plugins.updateTitle", { name })}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onKeep} data-testid="plugin-update-keep">
            {t("look.plugins.keepOld")}
          </Button>
          <Button variant="danger" onClick={onAccept} disabled={!agree} data-testid="plugin-update-accept">
            {t("look.plugins.acceptUpdate")}
          </Button>
        </>
      }
    >
      <div className={s.dialogBody}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--text)" }}>{t("look.plugins.updateBody")}</p>
        <dl className={s.facts}>
          <dt>{t("look.plugins.factLink")}</dt>
          <dd dir="ltr">{entry.url}</dd>
          <dt>{t("look.plugins.factApproved")}</dt>
          <dd dir="ltr">{oldSize !== null ? `${formatBytes(oldSize)}, ${shortHash(entry.hash)}` : shortHash(entry.hash)}</dd>
          <dt>{t("look.plugins.factNew")}</dt>
          <dd dir="ltr" data-testid="plugin-update-hash">{`${formatBytes(update.size)}, ${shortHash(update.hash)}`}</dd>
        </dl>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--text-subtle)" }}>{t("look.plugins.showCode")}</summary>
          <pre className={s.codeView} style={{ marginTop: 8 }} dir="ltr">
            {update.code.length > SHOW_MAX ? update.code.slice(0, SHOW_MAX) : update.code}
          </pre>
        </details>
        <Caution level="danger">
          <p>{t("look.plugins.updateCaution")}</p>
        </Caution>
        <label className={s.consent} data-level="danger">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="plugin-update-agree" />
          <span>{t("look.plugins.updateConsent")}</span>
        </label>
      </div>
    </Modal>
  );
}
