import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";

import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { LazySticker, StickerView } from "@/components/stickers/StickerView";
import { CreatePackModal, type ImportCounts } from "@/components/modals/CreatePackModal";
import { TextInput } from "@/components/common/TextInput";
import { PackEditor, packCount, packCover } from "@/components/server/PackEditor";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { useExpressions, packImageUrl } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { unlessUnsaved } from "@/stores/unsaved";
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
  const [creating, setCreating] = useState<null | "sticker" | "emoji">(null);
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

  const create = async (name: string) => {
    try {
      const pack = await expressionsApi.createPack({ name, kind });
      upsertPack(pack);
      setSelected(pack.id);
      setCreating(null);
      return pack;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : tr_("server.serverStickers.couldNotCreateThePack"), "error");
      return null;
    }
  };
  const imported = (pack: StickerPack, counts: ImportCounts) => {
    upsertPack(pack);
    setSelected(pack.id);
    setCreating(null);
    let msg = tr_("settings.stickers.importedToast", { imported: counts.imported });
    if (counts.skipped > 0) msg += " " + tr_("settings.stickers.importedSkipped", { skipped: counts.skipped });
    if (counts.failed > 0) msg += " " + tr_("settings.stickers.importedFailed", { failed: counts.failed });
    toast(msg, "success");
  };
  const install = async (p: StickerPack) => {
    setBusy(p.id);
    try {
      upsertPack(await expressionsApi.install(p.id));
      setFound((cur) => cur?.map((x) => (x.id === p.id ? { ...x, installed: true } : x)) ?? null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : tr_("modals.stickerPack.couldNotInstallThePack"), "error");
    } finally {
      setBusy(null);
    }
  };

  // Left and Right move along the tabs, as a tab strip does everywhere else.
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const strip = e.currentTarget.parentElement;
    const buttons = strip ? [...strip.querySelectorAll<HTMLElement>('[role="tab"]')] : [];
    // in a right-to-left page, Right goes back
    const dir = document.documentElement.dir === "rtl" ? -step : step;
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, buttons.indexOf(e.currentTarget) + dir))];
    next?.click();
    next?.focus();
  };

  return (
    <>
      <h2 className={st.title}>{tr_("settings.stickers.expressionPacks")}</h2>
      <p className={st.hint}>{tr_("settings.stickers.buildYourOwnEmojiAndSticker")}</p>
      {/* A tab strip, said as one: which of the three is open was only a colour. */}
      <div className={s.tabs} style={{ marginTop: 16 }} role="tablist" aria-label={tr_("settings.stickers.expressionPacks")}>
        {([
          ["stickers", tr_("pickers.expressionPicker.stickers"), "packs-stickers"],
          ["emoji", tr_("modals.customStatus.emoji"), "packs-emoji"],
          ["discover", tr_("settings.stickers.discover"), "packs-discover"],
        ] as const).map(([id, label, nav]) => (
          <button
            key={id}
            className={s.tab}
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            data-on={tab === id}
            data-nav={nav}
            onKeyDown={onTabKey}
            // a pack's unsaved name or description would go with the pack editor, so the tabs ask first, as pages do
            onClick={tab === id ? undefined : unlessUnsaved(() => {
              setTab(id);
              if (id !== "discover") setSelected(null);
            })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== "discover" ? (
        <PackEditor
          packs={mine}
          selectedId={selected}
          onSelect={setSelected}
          canManage={(p) => p.owner_user_id === meId}
          canRemove={(p) => canRemovePack(p, meId)}
          onCreate={unlessUnsaved(() => setCreating(kind))}
          createLabel={kind === "emoji" ? tr_("settings.stickers.createEmojiPack") : tr_("settings.stickers.createStickerPack")}
          emptyText={kind === "emoji" ? tr_("settings.stickers.noEmojiPacksYet") : tr_("settings.stickers.noStickerPacksYet")}
        />
      ) : (
        <>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr_("settings.stickers.searchPublicPacks")} autoFocus />
          {found === null ? <div style={{ marginTop: 16 }}><Spinner /></div> : null}
          {found && found.length === 0 ? <div className={s.empty}>{q ? tr_("settings.stickers.noPublicPacksMatch") : tr_("settings.stickers.noPublicPacksYet")}</div> : null}
          <div className={s.browseGrid}>
            {found?.map((p) => {
              const cover = packCover(p);
              return (
                <div key={p.id} className={s.browseCard} data-pack={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={s.cover}>{cover ? <StickerView format={cover.format} src={packImageUrl(p, cover)} alt="" /> : p.name.slice(0, 1).toUpperCase()}</span>
                    <span className={s.packText}>
                      <span className={s.packName}>{p.name}</span>
                      <span className={s.packSub}>{packCount(p)}</span>
                    </span>
                  </div>
                  {p.description ? <span className={s.packSub}>{p.description}</span> : null}
                  <div className={s.browseStickers}>{p.stickers.slice(0, 4).map((x) => <LazySticker key={x.id} format={x.format} src={packImageUrl(p, x)} alt={x.name} />)}</div>
                  {p.owner_user_id === meId ? <Button size="sm" variant="secondary" onClick={() => { setSelected(p.id); setTab((p.kind ?? "sticker") === "emoji" ? "emoji" : "stickers"); }}>{tr_("pickers.stickerPicker.edit")}</Button> : p.installed ? (
                    canRemovePack(p, meId) ? <Button size="sm" variant="secondary" onClick={() => confirmRemovePack(p, () => setFound((cur) => cur?.map((x) => (x.id === p.id ? { ...x, installed: false } : x)) ?? null))}>{tr_("composer.composer.remove")}</Button> : <Button size="sm" variant="secondary" disabled>{tr_("settings.stickers.installed")}</Button>
                  ) : <Button size="sm" loading={busy === p.id} onClick={() => void install(p)}>{tr_("settings.stickers.install")}</Button>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {creating ? <CreatePackModal kind={creating} onClose={() => setCreating(null)} onCreate={create} onImported={imported} /> : null}
    </>
  );
}
