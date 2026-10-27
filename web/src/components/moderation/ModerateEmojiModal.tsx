import { PersonName } from "@/components/common/PersonName";
import { X } from "lucide-react";
import { useState } from "react";
import { moderation as modApi, type ModServerRef, type Person, type StaffCase } from "@/api/moderation";
import type { Emoji } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { TextArea } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { describeError } from "@/lib/errors";
import { personName } from "@/lib/moderation";
import { useUI } from "@/stores/ui";
import { t, Tr } from "@/i18n";
import { StickerThumbs } from "./ExpressionsTab";
import { ServerIcon } from "./ProfileSheet";
import m from "./Moderation.module.css";

const MAX_REASON = 1000;

/**
 * Taking down some of a server's emoji. The server's owner answers for them:
 * the reason goes to them, word for word with the moderator's name, and opens
 * a case they can answer in, and everyone in the server sees the emoji go.
 */
export function ModerateEmojiModal({ server, owner, emojis, onClose, onDone }: { server: ModServerRef; owner: Person | undefined; emojis: Emoji[]; onClose: () => void; onDone: (c: StaffCase) => void }) {
  const toast = useUI((u) => u.toast);
  const [block, setBlock] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const ready = emojis.length > 0 && [...trimmed].length >= 3 && [...reason].length <= MAX_REASON;
  const ownerName = personName(owner);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await modApi.actOnEmojis(server.id, { emojis: emojis.map((e) => e.id), block, reason: trimmed });
      toast(t("moderation.servers.done", { number: r.case.number, name: server.name }), "success");
      onDone(r.case);
      onClose();
    } catch (err) {
      setError(describeError(err, t("moderation.failed")));
    } finally {
      setBusy(false);
    }
  };
  const quick = [t("moderation.quick.hateful"), t("moderation.quick.explicit"), t("moderation.quick.harassment"), t("moderation.quick.impersonation"), t("moderation.packs.quickCopyright")];

  return (
    <Modal open onClose={onClose} bare width={560} ariaLabel={t("moderation.packs.moderateEmojiNamed", { name: server.name })}>
      <div className={m.modal} data-testid="moderate-emoji-modal">
        <div className={m.modalTop}>
          <ServerIcon id={server.id} iconId={server.icon_id} name={server.name} size={40} />
          <div style={{ minWidth: 0 }}>
            <h2 className={m.modalTitle}>{t("moderation.packs.moderateEmoji")}</h2>
            <div className={m.modalTarget}>
              <span dir="auto">{server.name}</span>
              <span>{<Tr id="moderation.servers.ownedBy" values={{ name: <PersonName user={owner}>{ownerName}</PersonName> }} />}</span>
            </div>
          </div>
          <button type="button" className={m.modalClose} onClick={onClose} aria-label={t("chat.attachments.close")}>
            <X size={20} />
          </button>
        </div>

        <div className={m.modalScroll}>
          <div className={m.section}>
            <span className={m.sectionLabel}>{t("moderation.servers.whatToTake")}</span>
            <StickerThumbs stickers={emojis.map((e) => ({ id: e.id, blob_id: e.blob_id, format: "png", name: `:${e.name}:` }))} kind="emoji" max={24} />
            <p className={m.note}>{t("moderation.packs.emojiNote")}</p>
          </div>
          <div className={m.section}>
            <Toggle checked={block} onChange={setBlock} label={t("moderation.packs.blockPictures")} description={t("moderation.packs.blockPicturesHint")} />
          </div>
          <div className={m.section}>
            <label className={m.section}>
              <span className={m.sectionLabel}>{t("moderation.form.reason")}</span>
              <TextArea className={m.reasonBox} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("moderation.packs.reasonPlaceholder")} maxLength={MAX_REASON + 50} data-testid="moderate-emoji-reason" />
            </label>
            <div className={m.quick}>
              {quick.map((q) => (
                <button key={q} type="button" onClick={() => setReason((r) => (r.trim() ? `${r.trim()} ${q}` : q))}>
                  {q}
                </button>
              ))}
            </div>
            <div className={m.reasonMeta}>
              <span>{<Tr id="moderation.servers.reasonVisible" values={{ name: <PersonName user={owner}>{ownerName}</PersonName> }} />}</span>
              {[...reason.trim()].length < 3 ? <span data-short="">{t("moderation.form.reasonTooShort", { min: 3 })}</span> : <span>{[...reason].length}/{MAX_REASON}</span>}
            </div>
          </div>
          {error ? (
            <p className={m.danger} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={m.modalFoot}>
          <span className={m.summary}>{<Tr id="moderation.servers.notifies" values={{ name: <PersonName user={owner}>{ownerName}</PersonName> }} />}</span>
          <span className={m.grow} />
          <Button variant="ghost" onClick={onClose}>
            {t("moderation.cancel")}
          </Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()} data-testid="moderate-emoji-submit">
            {t("moderation.packs.submitEmoji", { count: emojis.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
