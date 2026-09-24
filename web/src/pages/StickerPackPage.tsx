import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { describeError } from "@/lib/errors";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";

import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { LazySticker, StickerView } from "@/components/stickers/StickerView";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { packCount, packCover } from "@/components/server/PackEditor";
import { canRemovePack, removePack as removeInstalledPack, removePackQuestion } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { useExpressions, packImageUrl } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import s from "./InvitePage.module.css";
import p from "@/components/server/PackEditor.module.css";

import { t } from "@/i18n";
/** The shareable page for a sticker pack: preview it, install it, or open it for editing. */
export default function StickerPackPage() {
  const { packId = "" } = useParams();
  const meId = useAuth((a) => a.me?.id);
  const upsertPack = useExpressions((x) => x.upsertPack);
  const removePack = useExpressions((x) => x.removePack);
  const openModal = useUI((u) => u.openModal);
  const toast = useUI((u) => u.toast);
  const [pack, setPack] = useState<StickerPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // this page is outside the app, where its dialogs live, so it shows its own
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    expressionsApi
      .pack(packId)
      .then((res) => alive && setPack(res))
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 404 ? t("stickerPack.thisPackIsPrivate") : t("stickerPack.couldNotLoadThePack")));
    return () => {
      alive = false;
    };
  }, [packId]);

  const toggle = async () => {
    if (!pack) return;
    if (pack.installed && canRemovePack(pack, meId)) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      if (pack.installed) {
        await expressionsApi.uninstall(pack.id);
        removePack(pack.id);
        setPack({ ...pack, installed: false });
      } else {
        const res = await expressionsApi.install(pack.id);
        upsertPack(res);
        setPack(res);
      }
    } catch (err) {
      toast(describeError(err, t("server.packEditor.couldNotChangeThePack")), "error");
    } finally {
      setBusy(false);
    }
  };

  const cover = pack ? packCover(pack) : undefined;
  const mine = !!pack && pack.owner_user_id === meId;
  return (
    <div className={s.page}>
      <div className={s.card} style={{ maxWidth: 640 }}>
        {!pack && !error ? <Spinner /> : null}
        {error ? (
          <>
            <div className={s.iconBox} data-invalid="true">!</div>
            <h1 className={s.title}>{t("stickerPack.packUnavailable")}</h1>
            <p className={s.sub}>{error}</p>
            <Link to="/channels/@me" className={s.link}>{t("stickerPack.backToTheApp")}</Link>
          </>
        ) : null}
        {pack ? (
          <>
            <p className={s.kicker}>{pack.kind === "emoji" ? t("stickerPack.emojiPack") : t("stickerPack.stickerPack")}</p>
            <div className={s.iconBox}>{cover ? <StickerView format={cover.format} src={packImageUrl(pack, cover)} alt="" /> : pack.name.slice(0, 1).toUpperCase()}</div>
            <h1 className={s.title}>{pack.name}</h1>
            {pack.description ? <p className={s.sub}>{pack.description}</p> : null}
            <p className={s.sub}>{packCount(pack)}{pack.public ? "" : " · " + t("settings.stickers.privateTag")}</p>
            <div className={p.grid} style={{ width: "100%" }}>
              {pack.stickers.map((st) => (
                <div key={st.id} className={p.cell} style={{ cursor: "default" }}>
                  <LazySticker format={st.format} src={packImageUrl(pack, st)} alt={st.name} className={p.cellImg} />
                  <span className={p.cellName}>{st.name}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
              {mine ? <Button onClick={() => { navigate("/channels/@me"); openModal("settings", { page: "stickers", packId: pack.id }); }}>{t("stickerPack.editPack")}</Button> : <Button loading={busy} variant={pack.installed ? "secondary" : "primary"} onClick={() => void toggle()}>{pack.installed ? t("stickerPack.removeFromMyStickers") : t("stickerPack.installPack")}</Button>}
              <Link to="/channels/@me" className={s.link} style={{ alignSelf: "center" }}>{t("stickerPack.backToTheApp")}</Link>
            </div>
          </>
        ) : null}
      </div>
      {confirming && pack ? (
        <ConfirmModal
          {...removePackQuestion(pack)}
          danger
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            if (await removeInstalledPack(pack)) setPack({ ...pack, installed: false });
          }}
        />
      ) : null}
    </div>
  );
}
