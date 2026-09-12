import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { StickerPack } from "@/api/types";
import { stickerUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { TextInput } from "@/components/common/TextInput";
import { PackEditor, packCover } from "@/components/server/PackEditor";
import { useAuth } from "@/stores/auth";
import { useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import st from "./Settings.module.css";
import s from "@/components/server/PackEditor.module.css";

/** User settings → Sticker Packs: your own packs, installed packs, and a Discover tab for public ones. */
export default function StickersPage({ initialPackId }: { initialPackId?: string | undefined }) {
  const meId = useAuth((a) => a.me?.id);
  const packs = useExpressions((x) => x.packs);
  const upsertPack = useExpressions((x) => x.upsertPack);
  const toast = useUI((u) => u.toast);
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [selected, setSelected] = useState<string | null>(initialPackId ?? null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StickerPack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = useMemo(() => Object.values(packs).filter((p) => !p.server_id && (p.owner_user_id === meId || p.installed)).sort((a, b) => Number(b.owner_user_id === meId) - Number(a.owner_user_id === meId) || b.updated_at - a.updated_at), [packs, meId]);

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
    const name = window.prompt("Name your sticker pack", "My stickers");
    if (!name?.trim()) return;
    try {
      const pack = await expressionsApi.createPack({ name: name.trim() });
      upsertPack(pack);
      setSelected(pack.id);
      setTab("mine");
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
      <h2 className={st.title}>Sticker Packs</h2>
      <p className={st.hint}>Make as many packs and stickers as you like, share them with a link, and install packs other people made. Nothing here costs anything.</p>
      <div className={s.tabs} style={{ marginTop: 16 }}>
        <button className={s.tab} data-on={tab === "mine"} onClick={() => setTab("mine")}>My Packs</button>
        <button className={s.tab} data-on={tab === "discover"} onClick={() => setTab("discover")}>Discover</button>
      </div>
      {tab === "mine" ? (
        <PackEditor packs={mine} selectedId={selected} onSelect={setSelected} canManage={(p) => p.owner_user_id === meId} onCreate={() => void create()} emptyText="You have no packs yet. Create one, or install some from Discover." />
      ) : (
        <>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public packs" autoFocus />
          {found === null ? <div style={{ marginTop: 16 }}><Spinner /></div> : null}
          {found && found.length === 0 ? <div className={s.empty}>{q ? "No public packs match." : "No public packs yet. Make one of yours public to be the first."}</div> : null}
          <div className={s.browseGrid}>
            {found?.map((p) => {
              const cover = packCover(p);
              return (
                <div key={p.id} className={s.browseCard} data-pack={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={s.cover}>{cover ? <img src={stickerUrl(cover.blob_id)} alt="" /> : p.name.slice(0, 1).toUpperCase()}</span>
                    <span className={s.packText}>
                      <span className={s.packName}>{p.name}</span>
                      <span className={s.packSub}>{p.stickers.length} sticker{p.stickers.length === 1 ? "" : "s"}</span>
                    </span>
                  </div>
                  {p.description ? <span className={s.packSub}>{p.description}</span> : null}
                  <div className={s.browseStickers}>{p.stickers.slice(0, 4).map((x) => <img key={x.id} src={stickerUrl(x.blob_id)} alt={x.name} title={x.name} loading="lazy" />)}</div>
                  {p.owner_user_id === meId ? <Button size="sm" variant="secondary" onClick={() => { setSelected(p.id); setTab("mine"); }}>Edit</Button> : p.installed ? <Button size="sm" variant="secondary" disabled>Installed</Button> : <Button size="sm" loading={busy === p.id} onClick={() => void install(p)}>Install</Button>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
