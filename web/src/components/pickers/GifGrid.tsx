import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { moveFocusInGrid } from "@/lib/gridKeys";
import { gifHeight, masonry, tilesWithin } from "@/lib/masonry";
import s from "./Picker.module.css";

import { t as tr_ } from "@/i18n";
export interface GifTileData {
  key: string;
  src: string;
  /** What the GIF shows, for screen readers. */
  label: string;
  w?: number;
  h?: number;
  /** It failed to load; a short note stands in its place. */
  dead?: boolean;
}

const COLS = 2;
const GAP = 8;
/** The grid's margin inside the scrolling box. */
const PAD = 8;
const DEAD_HEIGHT = 72;
/**
 * GIFs further than this above or below what is on screen are taken off the
 * page, so their frames are let go instead of piling up as someone scrolls.
 */
const KEEP_PX = 600;
/** More results are asked for once the end is this close. */
const NEAR_END_PX = 800;
/** The window of kept GIFs moves in steps this big, not on every pixel. */
const STEP_PX = 100;

interface Props<T extends GifTileData> {
  tiles: T[];
  onPick: (tile: T) => void;
  /** Right click, or a long press on a phone. */
  onMenu?: (tile: T, x: number, y: number) => void;
  onDead?: (tile: T) => void;
  /** Buttons drawn over a GIF, like the favourite star. */
  overlay?: (tile: T) => ReactNode;
  /** Shown under the GIFs, inside the scrolling part. */
  footer?: ReactNode;
  /** Called when the end is in sight, to load more. */
  onNearEnd?: () => void;
}

/** GIFs in two columns that scroll down, with only the ones near the screen on the page. */
export function GifGrid<T extends GifTileData>({ tiles, onPick, onMenu, onDead, overlay, footer, onNearEnd }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  // the shapes of GIFs saved without a size, learnt as they load
  const [measured, setMeasured] = useState<ReadonlyMap<string, { w: number; h: number }>>(() => new Map());

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const top = Math.floor(el.scrollTop / STEP_PX) * STEP_PX;
      const height = el.clientHeight;
      setView((v) => (v.top === top && v.height === height ? v : { top, height }));
      setWidth(Math.max(0, el.clientWidth - PAD * 2));
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", onScroll, { passive: true });
    // the same guard its two sibling call sites have: where the API is missing
    // this threw during layout and took the whole picker down with it
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => read());
    resize?.observe(el);
    return () => {
      resize?.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const layout = useMemo(
    () =>
      masonry(tiles.length, width, COLS, GAP, (i, colWidth) => {
        const t = tiles[i]!;
        if (t.dead) return DEAD_HEIGHT;
        const m = t.w && t.h ? undefined : measured.get(t.key);
        return gifHeight(colWidth, t.w ?? m?.w, t.h ?? m?.h);
      }),
    [tiles, width, measured],
  );
  const shown = tilesWithin(layout.tiles, view.top - PAD - KEEP_PX, view.top - PAD + view.height + KEEP_PX);

  const nearEnd = width > 0 && view.height > 0 && view.top + view.height + NEAR_END_PX >= layout.height + PAD * 2;
  useEffect(() => {
    if (nearEnd) onNearEnd?.();
  }, [nearEnd, tiles.length, onNearEnd]);

  const learnShape = (tile: T, img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    setMeasured((m) => {
      const known = m.get(tile.key);
      return known && known.w === w && known.h === h ? m : new Map(m).set(tile.key, { w, h });
    });
  };

  return (
    // One tab stop for the grid, with the arrows moving inside it. The tiles
    // are absolutely placed by the masonry, so where a cell *is* is the only
    // description of the grid there is.
    <div
      ref={scroller}
      className={s.gifScroll}
      tabIndex={0}
      role="group"
      aria-label={tr_("pickers.gifPicker.searchGifs")}
      onKeyDown={(e) => {
        if (scroller.current && moveFocusInGrid(scroller.current, "[data-gif-pick]", e.key)) e.preventDefault();
      }}
    >
      <div className={s.gifGrid} style={{ height: layout.height }}>
        {shown.map((i) => {
          const tile = tiles[i]!;
          const box = layout.tiles[i]!;
          return (
            <div
              key={tile.key}
              className={s.gifCell}
              data-dead={tile.dead || undefined}
              style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
              onContextMenu={
                onMenu
                  ? (e) => {
                      e.preventDefault();
                      onMenu(tile, e.clientX, e.clientY);
                    }
                  : undefined
              }
            >
              {tile.dead ? (
                <span className={s.gifDead}>{tr_("pickers.gifGrid.thisOneIsGone")}</span>
              ) : (
                <button type="button" className={s.gifPick} aria-label={tile.label} data-gif-pick tabIndex={-1} onClick={() => onPick(tile)}>
                  <img
                    src={tile.src}
                    alt=""
                    draggable={false}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={tile.w && tile.h ? undefined : (e) => learnShape(tile, e.currentTarget)}
                    onError={onDead ? () => onDead(tile) : undefined}
                  />
                </button>
              )}
              {overlay?.(tile)}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
