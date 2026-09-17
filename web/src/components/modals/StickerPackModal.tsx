import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions } from "@/api/expressions";
import type { StickerInfo } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
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
      useUI.getState().toast(`${pack.name} is installed. Its stickers are in your picker.`, "success");
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
      Edit Pack
    </Button>
  ) : installed ? (
    <Button variant="secondary" disabled data-testid="sticker-pack-installed">
      <Check size={16} /> Installed
    </Button>
  ) : (
    <Button loading={busy} onClick={() => void install()} data-testid="install-sticker-pack">
      Install Sticker Pack
    </Button>
  );

  return (
    <Modal open onClose={onClose} title={pack.name} width={540} footer={footer}>
      <div className={s.top} data-testid="sticker-pack">
        <img className={s.big} src={packImageUrl(pack, current)} alt={current.name} draggable={false} />
        <div className={s.info}>
          <div className={s.stickerName} data-testid="sticker-pack-name">{current.name}</div>
          <div className={s.creator}>
            Created by{" "}
            {creator ? (
              <button className={s.creatorLink} onClick={() => openModal("profile", { userId: creator.id })}>{displayName(creator)}</button>
            ) : (
              "someone no longer here"
            )}
          </div>
          {pack.description ? <div className={s.desc}>{pack.description}</div> : null}
        </div>
      </div>
      <div className={s.label}>{pack.stickers.length === 1 ? "1 sticker" : `${pack.stickers.length} stickers`}</div>
      <div className={s.grid}>
        {pack.stickers.map((x) => (
          <button key={x.id} className={s.tile} data-on={x.id === current.id} onClick={() => setPicked(x.id)} title={x.name} aria-label={x.name} aria-pressed={x.id === current.id}>
            <img src={packImageUrl(pack, x)} alt="" loading="lazy" draggable={false} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
