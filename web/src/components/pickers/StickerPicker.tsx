import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { Sticker, StickerPack } from "@/api/types";
import { moveFocusInGrid } from "@/lib/gridKeys";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useAuth } from "@/stores/auth";
import { groupPacks, searchStickers, useExpressions } from "@/stores/expressions";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { stickerPackMenu } from "./pickerMenus";
import { hoverPlays, moves, StillFace, stillSourceOf, useStickerStill } from "@/components/stickers/StickerTile";
import { useScreenPlace } from "@/hooks/useNearScreen";
import { warmLottieLater } from "@/lib/stickerStills";
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
 * One sticker in the grid, as a small still (see StickerTile.tsx): loaded
 * while the cell is on screen or close to it, the ones in view first, and
 * kept for the next time the picker opens. An animated one moves only while
 * it is pointed at or focused. A cell whose still could not load says so,
 * and pressing it tries again instead of sending something you cannot see.
 */
const StickerCell = memo(function StickerCell({ sticker, pack, onPick, root, still, active }: { sticker: Sticker; pack: StickerPack; onPick: (p: StickerPick) => void; root: RefObject<HTMLDivElement | null>; still: boolean; active: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const place = useScreenPlace(ref, root, active);
  const src = useMemo(() => stillSourceOf(pack, sticker), [pack, sticker]);
  const [view, retry] = useStickerStill(src, place);
  const [hot, setHot] = useState(false);
  const failed = view.status === "failed";
  const label = failed ? t("stickers.tile.couldNotLoadNamed", { name: sticker.name }) : sticker.name;
  return (
    <button
      ref={ref}
      className={s.stickerCell}
      title={label}
      aria-label={label}
      aria-busy={view.status === "loading" || undefined}
      data-sticker={sticker.id}
      data-sticker-state={view.status}
      tabIndex={-1}
      onClick={() => (failed ? retry() : onPick({ sticker, pack }))}
      onPointerEnter={(e) => hoverPlays(e) && setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <StillFace view={view} src={src} alt="" play={hot && !still && moves(src) && place !== "far"} />
    </button>
  );
});

/**
 * A pack's grid. Its cells watch where they are only while the pack is within
 * a screen of view, so a collection of thousands of stickers keeps the few
 * hundred near the screen watched rather than every one of them.
 */
function PackGrid({ pack, root, cell }: { pack: StickerPack; root: RefObject<HTMLDivElement | null>; cell: (st: Sticker, pack: StickerPack, active: boolean) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useScreenPlace(ref, root) !== "far";
  return (
    <div ref={ref} className={s.stickerGrid}>
      {pack.stickers.map((st) => cell(st, pack, active))}
    </div>
  );
}

/** A pack's icon in the column beside the grid: its cover, as a still like the grid's. */
function PackIcon({ pack, cover, root }: { pack: StickerPack; cover: Sticker; root: RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = useScreenPlace(ref, root);
  const src = useMemo(() => stillSourceOf(pack, cover), [pack, cover]);
  // after the stickers in view, which are what people came for
  const [view] = useStickerStill(src, place, 1);
  return (
    <span ref={ref} className={s.catImg}>
      {/* a pack's icon stays still: a column of them all moving at once is noise, and costly */}
      <StillFace view={view} src={src} alt="" play={false} />
    </span>
  );
}

function prefersStill(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The Stickers tab: this server's packs, mine, installed; searchable by name and tags. */
export function StickerPicker({ serverId, onPick, onlyServer = false }: { serverId: string | null | undefined; onPick: (p: StickerPick) => void; onlyServer?: boolean }) {
  const allPacks = useExpressions((x) => x.packs);
  // without Use External Stickers a server channel takes only the server's own
  const packs = useMemo(() => (onlyServer && serverId ? Object.fromEntries(Object.entries(allPacks).filter(([, p]) => p.server_id === serverId)) : allPacks), [allPacks, onlyServer, serverId]);
  const recents = useExpressions((x) => x.recents);
  const meId = useAuth((a) => a.me?.id);
  // whether a pack can be removed depends on the servers you are in
  useServers((x) => x.byId);
  const openModal = useUI((u) => u.openModal);
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  const still = useSettings((x) => x.settings.reducedMotion) || prefersStill();
  const groups = useMemo(() => groupPacks(packs, serverId, meId), [packs, serverId, meId]);
  const all = useMemo(() => groups.flatMap((g) => g.packs), [groups]);
  const results = useMemo(() => (q.trim() ? searchStickers(all, q) : null), [all, q]);
  // a pack of Telegram animated stickers further down needs the Lottie player for its stills
  const anyLottie = useMemo(() => all.some((p) => p.stickers.some((st) => st.format === "tgs")), [all]);
  useEffect(() => {
    if (anyLottie) warmLottieLater();
  }, [anyLottie]);
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
    if (stickerPackMenu.open({ pack: p, meId, edit: () => edit(p) }, { x: e.clientX, y: e.clientY })) e.preventDefault();
  };

  // the same function every render, so typing elsewhere does not redraw every cell
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((p: StickerPick) => pickRef.current(p), []);
  const cell = (sticker: Sticker, pack: StickerPack, active = true) => <StickerCell key={sticker.id} sticker={sticker} pack={pack} onPick={pick} root={gridRef} still={still} active={active} />;

  return (
    <>
      <div className={s.searchRow}>
        <SearchBox className={s.searchBox} value={q} onChange={setQ} placeholder={t("pickers.stickerPicker.searchStickers")} aria-label={t("pickers.stickerPicker.searchStickers")} autoFocus={focusSearchOnOpen()} />
      </div>
      <div className={s.body}>
        <div className={s.cats} ref={catsRef} data-scroll-root="">
          {all.map((p) => {
            const cover = p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
            return (
              <button key={p.id} className={s.cat} title={p.name} aria-label={p.name} onClick={() => jump(p.id)} onContextMenu={packMenu(p)}>
                {cover ? <PackIcon pack={p} cover={cover} root={catsRef} /> : <span className={s.catInitial}>{p.name.slice(0, 1).toUpperCase()}</span>}
              </button>
            );
          })}
        </div>
        {/* One tab stop for the whole grid, with the arrows inside it: every
            cell was a stop of its own, which is hundreds in a full picker. */}
        <div
          className={s.grid}
          ref={gridRef}
          data-scroll-root=""
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
                    {p.stickers.length === 0 ? <div className={s.gifNote}>{t("pickers.stickerPicker.thisPackIsEmpty")}</div> : <PackGrid pack={p} root={gridRef} cell={cell} />}
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
