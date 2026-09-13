import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Sticker, StickerPack } from "@/api/types";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { groupPacks, packImageUrl, searchStickers, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { focusSearchOnOpen } from "./EmojiPicker";
import s from "./Picker.module.css";

export interface StickerPick {
  sticker: Sticker;
  pack: StickerPack;
}

/** The Stickers tab: this server's packs, mine, installed; searchable by name and tags. */
export function StickerPicker({ serverId, onPick }: { serverId: string | null | undefined; onPick: (p: StickerPick) => void }) {
  const packs = useExpressions((x) => x.packs);
  const meId = useAuth((a) => a.me?.id);
  // whether a pack can be removed depends on the servers you are in
  useServers((x) => x.byId);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupPacks(packs, serverId, meId), [packs, serverId, meId]);
  const all = useMemo(() => groups.flatMap((g) => g.packs), [groups]);
  const results = useMemo(() => (q.trim() ? searchStickers(all, q) : null), [all, q]);
  const jump = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-pack="${id}"]`)?.scrollIntoView({ block: "start" });
  const edit = (p: StickerPack) => openModal("settings", { page: "stickers", packId: p.id });
  // right click, or a long press on a phone
  const packMenu = (p: StickerPack) => (e: MouseEvent) => {
    const items: ContextMenuItem[] = [];
    if (p.owner_user_id === meId) items.push({ id: "edit", label: "Edit Pack", onSelect: () => edit(p) });
    if (canRemovePack(p, meId)) items.push({ id: "remove", label: "Remove Pack", danger: true, onSelect: () => confirmRemovePack(p) });
    if (!items.length) return;
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const cell = (sticker: Sticker, pack: StickerPack) => (
    <button key={sticker.id} className={s.stickerCell} title={sticker.name} aria-label={sticker.name} data-sticker={sticker.id} onClick={() => onPick({ sticker, pack })}>
      <img src={packImageUrl(pack, sticker)} alt={sticker.name} loading="lazy" draggable={false} />
    </button>
  );

  return (
    <>
      <div className={s.searchRow}>
        <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stickers" aria-label="Search stickers" autoFocus={focusSearchOnOpen()} />
      </div>
      <div className={s.body}>
        <div className={s.cats}>
          {all.map((p) => {
            const cover = p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
            return (
              <button key={p.id} className={s.cat} title={p.name} onClick={() => jump(p.id)} onContextMenu={packMenu(p)}>
                {cover ? <img className={s.catImg} src={packImageUrl(p, cover)} alt="" /> : <span className={s.catInitial}>{p.name.slice(0, 1).toUpperCase()}</span>}
              </button>
            );
          })}
        </div>
        <div className={s.grid} ref={gridRef}>
          {all.length === 0 ? (
            <div className={s.empty}>
              No sticker packs yet.
              <br />
              <button className={s.sectionLink} onClick={() => openModal("settings", { page: "stickers" })}>Create or install a pack</button>
            </div>
          ) : null}
          {results ? (
            results.length === 0 ? <div className={s.empty}>No stickers match.</div> : <div className={s.stickerGrid}>{results.map((r) => cell(r.sticker, r.pack))}</div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className={s.section}>{g.label}</div>
                {g.packs.map((p) => (
                  <div key={p.id} data-pack={p.id}>
                    <div className={[s.section, s.sectionRow].join(" ")} onContextMenu={packMenu(p)}>
                      <span className={s.sectionName}>{p.name}</span>
                      {p.owner_user_id === meId ? <button className={s.sectionLink} onClick={() => edit(p)}>Edit</button> : null}
                      {canRemovePack(p, meId) ? <button className={s.sectionLink} data-danger="true" onClick={() => confirmRemovePack(p)} aria-label={`Remove ${p.name}`}>Remove</button> : null}
                    </div>
                    {p.stickers.length === 0 ? <div className={s.gifNote}>This pack is empty.</div> : <div className={s.stickerGrid}>{p.stickers.map((st) => cell(st, p))}</div>}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
