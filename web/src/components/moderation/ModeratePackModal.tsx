import { personText } from "@/lib/personText";
import { PersonName } from "@/components/common/PersonName";
import { X } from "lucide-react";
import { useState } from "react";
import { moderation as modApi, type ModPack, type ModServerRef, type PackField, type Person, type StaffCase } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { TextArea } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { describeError } from "@/lib/errors";
import { packFieldLabel, personName, previewText } from "@/lib/moderation";
import { useUI } from "@/stores/ui";
import { t, Tr } from "@/i18n";
import { PackCover, StickerThumbs } from "./ExpressionsTab";
import m from "./Moderation.module.css";

const MAX_REASON = 1000;
const FIELDS: PackField[] = ["name", "description", "public"];

/** What the modal opens with already chosen: stickers ticked on the pack's page, a part of the pack, or all of it. */
export interface PackPreset {
  stickers?: string[];
  fields?: PackField[];
  delete?: boolean;
}

/**
 * Taking down stickers in a pack, parts of what the pack shows everyone (its
 * name, its description, its public listing), or the whole pack. The reason
 * goes to whoever answers for it, word for word with the moderator's name,
 * and opens a case they can answer in. Pictures taken down can be blocked
 * everywhere: served to nobody, and refused if anyone uploads them again.
 */
export function ModeratePackModal({ pack, owner, server, preset, onClose, onDone }: { pack: ModPack; owner: Person | undefined; server?: ModServerRef | undefined; preset?: PackPreset | undefined; onClose: () => void; onDone: (c: StaffCase, removed: string[]) => void }) {
  const toast = useUI((u) => u.toast);
  const emoji = pack.kind === "emoji";
  const empty: Record<PackField, boolean> = { name: false, description: !pack.description, public: !pack.public };
  const chosen = new Set(preset?.stickers ?? []);
  const stickers = pack.stickers.filter((s) => chosen.has(s.id));
  const [withStickers, setWithStickers] = useState(stickers.length > 0);
  const [fields, setFields] = useState<PackField[]>((preset?.fields ?? []).filter((f) => !empty[f]));
  const [whole, setWhole] = useState(!!preset?.delete);
  const [block, setBlock] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const reasonOk = [...trimmed].length >= 3 && [...reason].length <= MAX_REASON;
  const takesPictures = whole ? pack.stickers.length > 0 : withStickers && stickers.length > 0;
  const ready = (whole || (withStickers && stickers.length > 0) || fields.length > 0) && reasonOk;
  const ownerName = personName(owner);

  const toggle = (f: PackField) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = whole
        ? { delete: true, block: block && takesPictures, reason: trimmed }
        : { stickers: withStickers ? stickers.map((s) => s.id) : [], fields: FIELDS.filter((f) => fields.includes(f)), block: block && takesPictures, reason: trimmed };
      const r = await modApi.actOnPack(pack.id, body);
      toast(personText("moderation.packs.done", owner?.id, ownerName, { number: r.case.number }), "success");
      onDone(r.case, whole ? pack.stickers.map((s) => s.id) : withStickers ? stickers.map((s) => s.id) : []);
      onClose();
    } catch (err) {
      setError(describeError(err, t("moderation.failed")));
    } finally {
      setBusy(false);
    }
  };

  const value = (f: PackField) => {
    if (f === "public") return pack.public ? t("moderation.packs.listingPublic") : t("moderation.packs.listingPrivate");
    if (empty[f]) return t("moderation.form.none");
    return f === "name" ? pack.name : previewText(pack.description);
  };
  const quick = [t("moderation.quick.hateful"), t("moderation.quick.explicit"), t("moderation.quick.harassment"), t("moderation.quick.impersonation"), t("moderation.quick.spam"), t("moderation.packs.quickCopyright")];

  return (
    <Modal open onClose={onClose} bare width={620} ariaLabel={t("moderation.packs.moderateNamed", { name: pack.name })}>
      <div className={m.modal} data-testid="moderate-pack-modal">
        <div className={m.modalTop}>
          <PackCover pack={pack} />
          <div style={{ minWidth: 0 }}>
            <h2 className={m.modalTitle}>{emoji ? t("moderation.packs.moderateEmojiPack") : t("moderation.packs.moderateTitle")}</h2>
            <div className={m.modalTarget}>
              <span dir="auto">{pack.name}</span>
              <span>{server ? t("moderation.packs.inServer", { name: server.name }) : <Tr id="moderation.servers.ownedBy" values={{ name: <PersonName user={owner}>{ownerName}</PersonName> }} />}</span>
            </div>
          </div>
          <button type="button" className={m.modalClose} onClick={onClose} aria-label={t("chat.attachments.close")}>
            <X size={20} />
          </button>
        </div>

        <div className={m.modalScroll}>
          <div className={m.section}>
            <span className={m.sectionLabel}>{t("moderation.servers.whatToTake")}</span>
            <div className={m.choiceRow}>
              {stickers.length ? (
                <label className={m.pick} data-checked={withStickers && !whole} data-disabled={whole} data-testid="pack-take-stickers">
                  <input type="checkbox" checked={withStickers && !whole} disabled={whole} onChange={() => setWithStickers((v) => !v)} />
                  <span className={m.pickText}>
                    <span className={m.pickName}>{emoji ? t("moderation.packs.chosenEmoji", { count: stickers.length }) : t("moderation.packs.chosenStickers", { count: stickers.length })}</span>
                    <StickerThumbs stickers={stickers} kind={emoji ? "emoji" : "sticker"} />
                  </span>
                </label>
              ) : null}
              {FIELDS.map((f) => (
                <label key={f} className={m.pick} data-checked={fields.includes(f) && !whole} data-disabled={empty[f] || whole} data-testid={`pack-field-${f}`}>
                  <input type="checkbox" checked={fields.includes(f) && !whole} disabled={empty[f] || whole} onChange={() => toggle(f)} />
                  <span className={m.pickText}>
                    <span className={m.pickName}>{f === "public" ? t("moderation.packs.makePrivate") : packFieldLabel(f)}</span>
                    <span className={m.pickValue} title={f === "description" ? pack.description : undefined} dir="auto">{value(f)}</span>
                  </span>
                </label>
              ))}
              <label className={m.pick} data-checked={whole} data-tone="danger" data-testid="pack-take-whole">
                <input type="checkbox" checked={whole} onChange={() => setWhole((v) => !v)} />
                <span className={m.pickText}>
                  <span className={m.pickName}>{emoji ? t("moderation.packs.wholeEmojiPack") : t("moderation.packs.wholePack")}</span>
                  <span className={m.pickValue}>{t("moderation.packs.wholePackHint", { count: pack.installs })}</span>
                </span>
              </label>
            </div>
            <p className={m.note}>{t("moderation.packs.takeNote")}</p>
          </div>

          {takesPictures ? (
            <div className={m.section}>
              <Toggle checked={block} onChange={setBlock} label={t("moderation.packs.blockPictures")} description={t("moderation.packs.blockPicturesHint")} />
            </div>
          ) : null}

          <div className={m.section}>
            <label className={m.section}>
              <span className={m.sectionLabel}>{t("moderation.form.reason")}</span>
              <TextArea className={m.reasonBox} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("moderation.packs.reasonPlaceholder")} maxLength={MAX_REASON + 50} data-testid="moderate-pack-reason" />
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
          <span className={m.summary}>{server ? <Tr id="moderation.packs.notifiesServer" values={{ name: <PersonName user={owner}>{ownerName}</PersonName>, server: server.name }} /> : <Tr id="moderation.packs.notifies" values={{ name: <PersonName user={owner}>{ownerName}</PersonName> }} />}</span>
          <span className={m.grow} />
          <Button variant="ghost" onClick={onClose}>
            {t("moderation.cancel")}
          </Button>
          <Button variant={whole ? "danger" : "primary"} disabled={!ready} loading={busy} onClick={() => void submit()} data-testid="moderate-pack-submit">
            {whole ? (emoji ? t("moderation.packs.removeEmojiPack") : t("moderation.packs.removePack")) : t("moderation.packs.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
