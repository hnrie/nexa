import { memo, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { Sticker, StickerPack } from "@/api/types";
import { moveFocusInGrid } from "@/lib/gridKeys";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { groupPacks, packImageUrl, searchStickers, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { StickerView } from "@/components/stickers/StickerView";
import { useNearScreen } from "@/hooks/useNearScreen";
import { useSettings } from "@/stores/settings";
import { focusSearchOnOpen } from "./EmojiPicker";
import { SearchBox } from "@/components/common/SearchBox";
import s from "./Picker.module.css";

import { t } from "@/i18n";
import { cssValue } from "@/lib/cssEscape";
export interface StickerPick {
  sticker: Sticker;
  pack: StickerPack;
}

/**
 * One sticker in the grid. Its picture exists only while the cell is on screen
 * or close to it, and an animated one moves only while it is pointed at or
 * focused: a picker holding every pack at once used to start every animation
 * and video in them together, which is what took phones down.
 */
const StickerCell = memo(function StickerCell({ sticker, pack, onPick, root, still }: { sticker: Sticker; pack: StickerPack; onPick: (p: StickerPick) => void; root: RefObject<HTMLDivElement | null>; still: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const near = useNearScreen(ref, root);
  const [hot, setHot] = useState(false);
  return (
    <button
      ref={ref}
      className={s.stickerCell}
      title={sticker.name}
      aria-label={sticker.name}
      data-sticker={sticker.id}
      tabIndex={-1}
      onClick={() => onPick({ sticker, pack })}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      {/* a cell is about 100 px wide, so the picture is fetched at that size rather than the 160 px a message shows */}
      {near ? <StickerView format={sticker.format} src={packImageUrl(pack, sticker, 100)} alt={sticker.name} play={hot && !still} renderer="canvas" /> : null}
    </button>
  );
});

function prefersStill(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The Stickers tab: this server's packs, mine, installed; searchable by name and tags. */
export function StickerPicker({ serverId, onPick }: { serverId: string | null | undefined; onPick: (p: StickerPick) => void }) {
  const packs = useExpressions((x) => x.packs);
  const recents = useExpressions((x) => x.recents);
  const meId = useAuth((a) => a.me?.id);
  // whether a pack can be removed depends on the servers you are in
  useServers((x) => x.byId);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const still = useSettings((x) => x.settings.reducedMotion) || prefersStill();
  const groups = useMemo(() => groupPacks(packs, serverId, meId), [packs, serverId, meId]);
  const all = useMemo(() => groups.flatMap((g) => g.packs), [groups]);
  const results = useMemo(() => (q.trim() ? searchStickers(all, q) : null), [all, q]);
  // Recently sent stickers first, resolved against the packs on this device
  // so each cell keeps its pack for sending. Anything whose pack is gone
  // (deleted, uninstalled) simply stays out of the row.
  const recentItems = useMemo(() => {
    const out: StickerPick[] = [];
    for (const st of recents) {
      const pack = packs[st.pack_id];
      if (pack && (pack.kind ?? "sticker") === "sticker") out.push({ sticker: st, pack });
      if (out.length >= 24) break;
    }
    return out;
  }, [recents, packs]);
  const jump = (id: string) => gridRef.current?.querySelector<HTMLElement>(`[data-pack="${cssValue(id)}"]`)?.scrollIntoView({ block: "start" });
  const edit = (p: StickerPack) => openModal("settings", { page: "stickers", packId: p.id });
  // right click, or a long press on a phone
  const packMenu = (p: StickerPack) => (e: MouseEvent) => {
    const items: ContextMenuItem[] = [];
    if (p.owner_user_id === meId) items.push({ id: "edit", label: t("pickers.stickerPicker.editPack"), onSelect: () => edit(p) });
    if (canRemovePack(p, meId)) items.push({ id: "remove", label: t("pickers.stickerPicker.removePack"), danger: true, onSelect: () => confirmRemovePack(p) });
    if (!items.length) return;
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const cell = (sticker: Sticker, pack: StickerPack) => <StickerCell key={sticker.id} sticker={sticker} pack={pack} onPick={onPick} root={gridRef} still={still} />;

  return (
    <>
      <div className={s.searchRow}>
        <SearchBox className={s.searchBox} value={q} onChange={setQ} placeholder={t("pickers.stickerPicker.searchStickers")} aria-label={t("pickers.stickerPicker.searchStickers")} autoFocus={focusSearchOnOpen()} />
      </div>
      <div className={s.body}>
        <div className={s.cats}>
          {all.map((p) => {
            const cover = p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
            return (
              <button key={p.id} className={s.cat} title={p.name} aria-label={p.name} onClick={() => jump(p.id)} onContextMenu={packMenu(p)}>
                {/* a pack's icon stays still: a column of them all moving at once is noise, and costly */}
                {cover ? <StickerView format={cover.format} src={packImageUrl(p, cover, 24)} alt="" className={s.catImg} play={false} renderer="canvas" /> : <span className={s.catInitial}>{p.name.slice(0, 1).toUpperCase()}</span>}
              </button>
            );
          })}
        </div>
        {/* One tab stop for the whole grid, with the arrows inside it: every
            cell was a stop of its own, which is hundreds in a full picker. */}
        <div
          className={s.grid}
          ref={gridRef}
          tabIndex={0}
          role="group"
          aria-label={t("pickers.stickerPicker.searchStickers")}
          onKeyDown={(e) => {
            if (gridRef.current && moveFocusInGrid(gridRef.current, "[data-sticker]", e.key)) e.preventDefault();
          }}
        >
          {all.length === 0 ? (
            <div className={s.empty}>
              {t("pickers.stickerPicker.noStickerPacksYet")}
              <br />
              <button className={s.sectionLink} onClick={() => openModal("settings", { page: "stickers" })}>{t("pickers.stickerPicker.createOrInstallAPack")}</button>
            </div>
          ) : null}
          {results ? (
            results.length === 0 ? <div className={s.empty}>{t("pickers.stickerPicker.noStickersMatch")}</div> : <div className={s.stickerGrid}>{results.map((r) => cell(r.sticker, r.pack))}</div>
          ) : (
            <>
              {recentItems.length > 0 ? (
                <div>
                  <div className={s.section}>{t("pickers.stickerPicker.recent")}</div>
                  <div className={s.stickerGrid}>{recentItems.map((r) => cell(r.sticker, r.pack))}</div>
                </div>
              ) : null}
              {groups.map((g) => (
              <div key={g.label}>
                <div className={s.section}>{g.label}</div>
                {g.packs.map((p) => (
                  <div key={p.id} data-pack={p.id} className={s.packSection} style={{ containIntrinsicSize: `auto ${40 + Math.ceil(Math.max(p.stickers.length, 1) / 4) * 108}px` }}>
                    <div className={[s.section, s.sectionRow].join(" ")} onContextMenu={packMenu(p)}>
                      <span className={s.sectionName}>{p.name}</span>
                      {p.owner_user_id === meId ? <button className={s.sectionLink} onClick={() => edit(p)}>{t("pickers.stickerPicker.edit")}</button> : null}
                      {canRemovePack(p, meId) ? <button className={s.sectionLink} data-danger="true" onClick={() => confirmRemovePack(p)} aria-label={t("pickers.stickerPicker.removeName", { name: p.name })}>{t("composer.composer.remove")}</button> : null}
                    </div>
                    {p.stickers.length === 0 ? <div className={s.gifNote}>{t("pickers.stickerPicker.thisPackIsEmpty")}</div> : <div className={s.stickerGrid}>{p.stickers.map((st) => cell(st, p))}</div>}
                  </div>
                ))}
              </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
