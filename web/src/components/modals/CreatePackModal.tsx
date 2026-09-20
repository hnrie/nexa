import { useState, type FormEvent } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";

export interface ImportCounts {
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * The create-pack dialog for personal packs: a name field with Create on the
 * right, and Import Telegram Sticker Pack pinned to the bottom left. The
 * import flips the dialog into a second step (paste a t.me link, watch it
 * build) rather than opening somewhere else, so nobody loses the thread.
 */
export function CreatePackModal({ kind, onClose, onCreate, onImported }: {
  kind: "sticker" | "emoji";
  onClose: () => void;
  onCreate: (name: string) => Promise<StickerPack | null>;
  onImported: (pack: StickerPack, counts: ImportCounts) => void;
}) {
  const [name, setName] = useState(kind === "emoji" ? t("settings.stickers.myEmoji") : t("settings.stickers.myStickers"));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"create" | "import">("create");
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    void onCreate(name.trim()).finally(() => setBusy(false));
  };

  const runImport = (e?: FormEvent) => {
    e?.preventDefault();
    if (working || !url.trim()) return;
    setWorking(true);
    setError(null);
    void expressionsApi
      .importTelegram(url.trim())
      .then((res) => onImported(res.pack, { imported: res.imported, skipped: res.skipped, failed: res.failed }))
      .catch((err) => setError(err instanceof ApiError ? err.message : t("settings.stickers.importFailed")))
      .finally(() => setWorking(false));
  };

  if (step === "import") {
    return (
      <Modal
        open
        onClose={onClose}
        title={t("settings.stickers.importTitle")}
        width={460}
        footer={
          <>
            <span style={{ marginRight: "auto" }}>
              <Button variant="ghost" onClick={() => { setStep("create"); setError(null); }}>{t("settings.stickers.back")}</Button>
            </span>
            <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
            <Button loading={working} disabled={!url.trim()} onClick={() => runImport()}>{t("settings.stickers.importButton")}</Button>
          </>
        }
      >
        <form onSubmit={runImport}>
          <p style={{ color: "var(--text-subtle)", fontSize: 14, margin: "0 0 12px" }}>{t("settings.stickers.importHint")}</p>
          {error ? <p role="alert" style={{ color: "var(--danger)", fontSize: 14, margin: "0 0 12px" }}>{error}</p> : null}
          <Field label={t("settings.stickers.importLinkLabel")}>
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("settings.stickers.importPlaceholder")} autoComplete="off" spellCheck={false} autoFocus data-testid="telegram-import-url" />
          </Field>
          {working ? <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "12px 0 0" }}>{t("settings.stickers.importing")}</p> : null}
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "emoji" ? t("settings.stickers.createEmojiPack") : t("settings.stickers.createStickerPack")}
      width={440}
      footer={
        <>
          {kind === "sticker" ? (
            <span style={{ marginRight: "auto" }}>
              <Button variant="ghost" onClick={() => setStep("import")} data-testid="telegram-import-open">{t("settings.stickers.importTelegram")}</Button>
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => submit()}>{t("settings.stickers.create")}</Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={t("server.packEditor.packName")}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus data-testid="create-pack-name" />
        </Field>
      </form>
    </Modal>
  );
}
