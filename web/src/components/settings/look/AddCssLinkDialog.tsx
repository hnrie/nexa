import { useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { FetchError, checkLink, fetchFailure, fetchText } from "@/lib/look/fetchText";
import { Caution } from "./Caution";
import s from "./Look.module.css";

/**
 * Adding a theme from a link: the address, what it means to add one, and a
 * box to tick that says so. The file is fetched before it is added, so a bad
 * address is caught here rather than turning up as a broken entry.
 */
export function AddCssLinkDialog({ taken, onClose, onAdded }: { taken: string[]; onClose: () => void; onAdded: (url: string, text: string) => void }) {
  const [url, setUrl] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (!agree || busy) return;
    const link = checkLink(url);
    if (!link) return setError(t("look.fetch.https"));
    if (taken.includes(link.href)) return setError(t("look.css.alreadyAdded"));
    setBusy(true);
    setError(null);
    try {
      onAdded(link.href, await fetchText(link.href));
    } catch (err) {
      const e = err instanceof FetchError ? err : new FetchError("network");
      setError(fetchFailure(e.reason, e.status));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t("look.css.addTitle")}
      width={520}
      onSubmit={() => void add()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("look.common.cancel")}
          </Button>
          <Button onClick={() => void add()} disabled={!agree || !url.trim()} loading={busy} data-testid="css-link-add">
            {t("look.css.addButton")}
          </Button>
        </>
      }
    >
      <div className={s.dialogBody}>
        <Field label={t("look.css.linkLabel")} error={error} hint={t("look.css.linkHint")}>
          <TextInput
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            type="url"
            inputMode="url"
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            data-testid="css-link-url"
          />
        </Field>
        <Caution>
          <p>{t("look.css.dialogCaution")}</p>
        </Caution>
        <label className={s.consent}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="css-link-agree" />
          <span>{t("look.css.consent")}</span>
        </label>
      </div>
    </Modal>
  );
}
