import { useMemo, useRef, useState } from "react";
import type { Sticker, StickerPack } from "@/api/types";
import { packImageUrl } from "@/stores/expressions";
import { useAuth } from "@/stores/auth";
import { groupPacks, searchStickers, useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import s from "./Picker.module.css";

export interface StickerPick {
  sticker: Sticker;
  pack: StickerPack;
}

/** The Stickers tab: this server's packs, mine, installed; searchable by name and tags. */
export function StickerPicker({ serverId, onPick }: { serverId: string | null | undefined; onPick: (p: StickerPick) => void }) {
  const packs = useExpressions((x) => x.packs);
  const meId = useAuth((a) => a.me?.id);
  const openModal = useUI((u) => u.openModal);
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupPacks(packs, serverId, meId), [packs, serverId, meId]);
  const all = useMemo(() => groups.flatMap((g) => g.packs), [groups]);
  const results = useMemo(() => (q.trim() ? searchStickers(all, q) : null), [all, q]);
  const jump = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-pack="${id}"]`)?.scrollIntoView({ block: "start" });

  const cell = (sticker: Sticker, pack: StickerPack) => (
    <button key={sticker.id} className={s.stickerCell} title={sticker.name} aria-label={sticker.name} data-sticker={sticker.id} onClick={() => onPick({ sticker, pack })}>
      <img src={packImageUrl(pack, sticker)} alt={sticker.name} loading="lazy" draggable={false} />
    </button>
  );

  return (
    <>
      <div className={s.searchRow}>
        <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stickers" aria-label="Search stickers" autoFocus />
      </div>
      <div className={s.body}>
        <div className={s.cats}>
          {all.map((p) => {
            const cover = p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
            return (
              <button key={p.id} className={s.cat} title={p.name} onClick={() => jump(p.id)}>
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
                    <div className={[s.section, s.sectionRow].join(" ")}>
                      <span>{p.name}</span>
                      {p.owner_user_id === meId ? <button className={s.sectionLink} onClick={() => openModal("settings", { page: "stickers", packId: p.id })}>Edit</button> : null}
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
