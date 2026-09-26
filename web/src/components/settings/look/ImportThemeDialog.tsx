import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextArea } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { importTheme } from "@/lib/look/customTheme";
import type { CustomTheme } from "@/lib/look/types";
import s from "./Look.module.css";

/** Theme files are a few kilobytes; anything much bigger is not one. */
const MAX_FILE = 256 * 1024;

/**
 * A theme someone shared, pasted or picked as a file. It opens in the builder
 * rather than being saved at once, so it can be looked at, worn and changed
 * first. A theme is only colours, each checked on the way in, so nothing in
 * one can do more than colour the app.
 */
export function ImportThemeDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (theme: CustomTheme) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const open = (raw: string) => {
    const r = importTheme(raw, t("settings.themeBuilder.importedName"));
    if (r.ok) {
      onOpen(r.theme);
      return;
    }
    setError(r.error === "notJson" ? t("settings.themeBuilder.importNotJson") : r.error === "newer" ? t("settings.themeBuilder.importNewer") : t("settings.themeBuilder.importNotTheme"));
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) return setError(t("settings.themeBuilder.importTooBig"));
    const raw = await f.text();
    setText(raw);
    open(raw);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.themeBuilder.importTitle")}
      width={520}
      onSubmit={() => open(text)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("look.common.cancel")}
          </Button>
          <Button onClick={() => open(text)} disabled={!text.trim()} data-testid="theme-import-open">
            {t("settings.themeBuilder.importGo")}
          </Button>
        </>
      }
    >
      <div className={s.dialogBody}>
        <p className={s.lead} style={{ margin: 0 }}>
          {t("settings.themeBuilder.importHint")}
        </p>
        <Field label={t("settings.themeBuilder.importPaste")} error={error}>
          <TextArea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={8}
            spellCheck={false}
            dir="ltr"
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            data-testid="theme-import-text"
          />
        </Field>
        <div>
          <input ref={file} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => void pick(e.target.files?.[0])} data-testid="theme-import-file" />
          <Button variant="secondary" size="sm" onClick={() => file.current?.click()}>
            <FileUp size={15} aria-hidden="true" /> {t("settings.themeBuilder.importFile")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
