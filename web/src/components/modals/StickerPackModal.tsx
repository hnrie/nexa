import { openReport } from "@/lib/reporting";
import { PersonName } from "@/components/common/PersonName";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions } from "@/api/expressions";
import type { StickerInfo } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { StickerView } from "@/components/stickers/StickerView";
import { LazySticker } from "@/components/stickers/StickerTile";
import { useAuth } from "@/stores/auth";
import { packImageUrl, useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import { displayName } from "@/stores/users";
import s from "./StickerPackModal.module.css";

import { t } from "@/i18n";
/**
 * A public sticker pack, opened from one of its stickers in a message: every
 * sticker in it, the picked one's name and who made it, and a button to
 * install the pack.
 */
export function StickerPackModal({ onClose, info, stickerId }: { onClose: () => void; info: StickerInfo; stickerId: string }) {
  const meId = useAuth((a) => a.me?.id);
  const pack = info.pack;
  const stored = useExpressions((x) => x.packs[pack.id]);
  const openModal = useUI((u) => u.openModal);
  const [picked, setPicked] = useState(stickerId);
  const [busy, setBusy] = useState(false);
  const users = useMemo(() => new Map(info.users.map((u) => [u.id, u])), [info.users]);

  const current = pack.stickers.find((x) => x.id === picked) ?? info.sticker;
  const creator = users.get(current.creator_id);
  const mine = !!meId && pack.owner_user_id === meId;
  const installed = pack.installed || !!stored?.installed;

  const install = async () => {
    setBusy(true);
    try {
      useExpressions.getState().upsertPack(await expressions.install(pack.id));
      useUI.getState().toast(t("modals.stickerPack.isInstalled", { name: pack.name }), "success");
    } catch (err) {
      useUI.getState().toast(err instanceof ApiError ? err.message : t("modals.stickerPack.couldNotInstallThePack"), "error");
    } finally {
      setBusy(false);
    }
  };

  const footer = mine ? (
    <Button
      variant="secondary"
      onClick={() => {
        onClose();
        openModal("settings", { page: "stickers", packId: pack.id });
      }}
    >
      {t("stickerPack.editPack")}
    </Button>
  ) : installed ? (
    <Button variant="secondary" disabled data-testid="sticker-pack-installed">
      <Check size={16} /> {t("settings.stickers.installed")}
    </Button>
  ) : (
    <Button loading={busy} onClick={() => void install()} data-testid="install-sticker-pack">
      {t("stickerPack.installPack")}
    </Button>
  );

  return (
    <Modal open onClose={onClose} title={pack.name} width={540} footer={<><Button variant="ghost" onClick={() => openReport({ kind: "sticker", id: current.id })}>{t("reports.report")} ({current.name})</Button><Button variant="ghost" onClick={() => openReport({ kind: "pack", id: pack.id })}>{t("reports.report")}</Button>{footer}</>}>
      <div className={s.top} data-testid="sticker-pack">
        <StickerView format={current.format} src={packImageUrl(pack, current)} alt={current.name} className={s.big} eager />
        <div className={s.info}>
          <div className={s.stickerName} data-testid="sticker-pack-name">{current.name}</div>
          <div className={s.creator}>
            {t("modals.stickerPack.createdBy")}{" "}
            {creator ? (
              <button className={s.creatorLink} onClick={() => openModal("profile", { userId: creator.id })}><PersonName user={creator}>{displayName(creator)}</PersonName></button>
            ) : (
              t("modals.stickerPack.someoneNoLongerHere")
            )}
          </div>
          {pack.description ? <div className={s.desc}>{pack.description}</div> : null}
        </div>
      </div>
      <div className={s.label}>{t("server.packEditor.stickerCount", { count: pack.stickers.length })}</div>
      <div className={s.grid}>
        {pack.stickers.map((x) => (
          <button key={x.id} className={s.tile} data-on={x.id === current.id} onClick={() => setPicked(x.id)} title={x.name} aria-label={x.name} aria-pressed={x.id === current.id}>
            <LazySticker sticker={x} pack={pack} alt="" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
