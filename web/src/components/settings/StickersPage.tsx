import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";

import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { TextInput } from "@/components/common/TextInput";
import { PackEditor, packCount, packCover } from "@/components/server/PackEditor";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { useExpressions, packImageUrl } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { promptText } from "@/components/modals/PromptModal";
import st from "./Settings.module.css";
import s from "@/components/server/PackEditor.module.css";

import { t as tr_ } from "@/i18n";
/** User settings → Sticker Packs: your own packs, installed packs, and a Discover tab for public ones. */
export default function StickersPage({ initialPackId }: { initialPackId?: string | undefined }) {
  const meId = useAuth((a) => a.me?.id);
  const packs = useExpressions((x) => x.packs);
  const servers = useServers((x) => x.byId);
  const upsertPack = useExpressions((x) => x.upsertPack);
  const toast = useUI((u) => u.toast);
  const [tab, setTab] = useState<"stickers" | "emoji" | "discover">("stickers");
  const [selected, setSelected] = useState<string | null>(initialPackId ?? null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StickerPack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const kind = tab === "emoji" ? "emoji" : "sticker";
  const mine = useMemo(
    () =>
      Object.values(packs)
        // a server's packs live in its settings, unless one was installed from a server you are not in
        .filter((p) => ((!p.server_id && (p.owner_user_id === meId || p.installed)) || canRemovePack(p, meId)) && (p.kind ?? "sticker") === kind)
        .sort((a, b) => Number(b.owner_user_id === meId) - Number(a.owner_user_id === meId) || b.updated_at - a.updated_at),
    [packs, meId, kind, servers],
  );

  useEffect(() => {
    if (tab !== "discover") return;
    let alive = true;
    const t = setTimeout(() => {
      expressionsApi
        .publicPacks(q)
        .then((list) => alive && setFound(list))
        .catch(() => alive && setFound([]));
    }, q ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tab, q]);

  const create = async () => {
    const name = await promptText(kind === "emoji" ? "Create Emoji Pack" : "Create Sticker Pack", { label: "Pack name", initial: kind === "emoji" ? "My emoji" : "My stickers", maxLength: 60 }, "Create");
    if (!name?.trim()) return;
    try {
      const pack = await expressionsApi.createPack({ name: name.trim(), kind });
      upsertPack(pack);
      setSelected(pack.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create the pack.", "error");
    }
  };
  const install = async (p: StickerPack) => {
    setBusy(p.id);
    try {
      upsertPack(await expressionsApi.install(p.id));
      setFound((cur) => cur?.map((x) => (x.id === p.id ? { ...x, installed: true } : x)) ?? null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not install the pack.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className={st.title}>{tr_("settings.stickers.expressionPacks")}</h2>
      <p className={st.hint}>{tr_("settings.stickers.buildYourOwnEmojiAndSticker")}</p>
      <div className={s.tabs} style={{ marginTop: 16 }}>
        <button className={s.tab} data-on={tab === "stickers"} onClick={() => { setTab("stickers"); setSelected(null); }} data-nav="packs-stickers">{tr_("pickers.expressionPicker.stickers")}</button>
        <button className={s.tab} data-on={tab === "emoji"} onClick={() => { setTab("emoji"); setSelected(null); }} data-nav="packs-emoji">{tr_("modals.customStatus.emoji")}</button>
        <button className={s.tab} data-on={tab === "discover"} onClick={() => setTab("discover")}>{tr_("settings.stickers.discover")}</button>
      </div>
      {tab !== "discover" ? (
        <PackEditor
          packs={mine}
          selectedId={selected}
          onSelect={setSelected}
          canManage={(p) => p.owner_user_id === meId}
          canRemove={(p) => canRemovePack(p, meId)}
          onCreate={() => void create()}
          createLabel={kind === "emoji" ? "Create Emoji Pack" : "Create Sticker Pack"}
          emptyText={kind === "emoji" ? "No emoji packs yet. Create one and drop images in; type them as :name: anywhere." : "You have no sticker packs yet. Create one, or install some from Discover."}
        />
      ) : (
        <>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr_("settings.stickers.searchPublicPacks")} autoFocus />
          {found === null ? <div style={{ marginTop: 16 }}><Spinner /></div> : null}
          {found && found.length === 0 ? <div className={s.empty}>{q ? "No public packs match." : "No public packs yet. Make one of yours public to be the first."}</div> : null}
          <div className={s.browseGrid}>
            {found?.map((p) => {
              const cover = packCover(p);
              return (
                <div key={p.id} className={s.browseCard} data-pack={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={s.cover}>{cover ? <img src={packImageUrl(p, cover)} alt="" /> : p.name.slice(0, 1).toUpperCase()}</span>
                    <span className={s.packText}>
                      <span className={s.packName}>{p.name}</span>
                      <span className={s.packSub}>{packCount(p)}</span>
                    </span>
                  </div>
                  {p.description ? <span className={s.packSub}>{p.description}</span> : null}
                  <div className={s.browseStickers}>{p.stickers.slice(0, 4).map((x) => <img key={x.id} src={packImageUrl(p, x)} alt={x.name} title={x.name} loading="lazy" />)}</div>
                  {p.owner_user_id === meId ? <Button size="sm" variant="secondary" onClick={() => { setSelected(p.id); setTab((p.kind ?? "sticker") === "emoji" ? "emoji" : "stickers"); }}>{tr_("pickers.stickerPicker.edit")}</Button> : p.installed ? (
                    canRemovePack(p, meId) ? <Button size="sm" variant="secondary" onClick={() => confirmRemovePack(p, () => setFound((cur) => cur?.map((x) => (x.id === p.id ? { ...x, installed: false } : x)) ?? null))}>{tr_("composer.composer.remove")}</Button> : <Button size="sm" variant="secondary" disabled>{tr_("settings.stickers.installed")}</Button>
                  ) : <Button size="sm" loading={busy === p.id} onClick={() => void install(p)}>{tr_("settings.stickers.install")}</Button>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
