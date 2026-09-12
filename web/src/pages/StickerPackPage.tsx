import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";
import { stickerUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { packCover } from "@/components/server/PackEditor";
import { useAuth } from "@/stores/auth";
import { useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import s from "./InvitePage.module.css";
import p from "@/components/server/PackEditor.module.css";

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

  useEffect(() => {
    let alive = true;
    expressionsApi
      .pack(packId)
      .then((res) => alive && setPack(res))
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 404 ? "This pack is private or no longer exists." : "Could not load the pack."));
    return () => {
      alive = false;
    };
  }, [packId]);

  const toggle = async () => {
    if (!pack) return;
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
      toast(err instanceof ApiError ? err.message : "Could not change the pack.", "error");
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
            <h1 className={s.title}>Pack unavailable</h1>
            <p className={s.sub}>{error}</p>
            <Link to="/channels/@me" className={s.link}>Back to the app</Link>
          </>
        ) : null}
        {pack ? (
          <>
            <p className={s.kicker}>Sticker pack</p>
            <div className={s.iconBox}>{cover ? <img src={stickerUrl(cover.blob_id)} alt="" style={{ objectFit: "contain" }} /> : pack.name.slice(0, 1).toUpperCase()}</div>
            <h1 className={s.title}>{pack.name}</h1>
            {pack.description ? <p className={s.sub}>{pack.description}</p> : null}
            <p className={s.sub}>{pack.stickers.length} sticker{pack.stickers.length === 1 ? "" : "s"}{pack.public ? "" : " · private"}</p>
            <div className={p.grid} style={{ width: "100%" }}>
              {pack.stickers.map((st) => (
                <div key={st.id} className={p.cell} style={{ cursor: "default" }}>
                  <img className={p.cellImg} src={stickerUrl(st.blob_id)} alt={st.name} loading="lazy" />
                  <span className={p.cellName}>{st.name}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
              {mine ? <Button onClick={() => openModal("settings", { page: "stickers", packId: pack.id })}>Edit pack</Button> : <Button loading={busy} variant={pack.installed ? "secondary" : "primary"} onClick={() => void toggle()}>{pack.installed ? "Remove from my stickers" : "Install pack"}</Button>}
              <Link to="/channels/@me" className={s.link} style={{ alignSelf: "center" }}>Back to the app</Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
