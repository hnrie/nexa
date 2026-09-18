import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { t } from "@/i18n";
import { MIN_PANE_H, MIN_PANE_W, usePanes, type Tile } from "@/stores/panes";
import { PaneCtx } from "./paneScope";
import s from "./Panes.module.css";

/**
 * Draws a tab's tile tree.
 *
 * Sizes are fractions that add up to one, so a window resize moves every tile
 * in proportion and nothing has to be recomputed. A divider drag turns pixels
 * back into fractions against the split's own measured box, which is the only
 * place a pixel appears in this file.
 */

/**
 * How big each pane is right now, so the menu knows whether there is room to
 * split one again. Module scope rather than the store: it changes on every
 * animation frame of a drag, and nothing should re-render because of it.
 */
const rects = new Map<string, DOMRect>();

export function paneRect(paneId: string): DOMRect | undefined {
  return rects.get(paneId);
}

/** Whether the focused pane can be halved along `dir` and still be readable. */
export function roomToSplit(paneId: string | undefined, dir: "row" | "column"): boolean {
  if (!paneId) return false;
  const box = rects.get(paneId);
  if (!box) return false;
  return dir === "row" ? box.width / 2 >= MIN_PANE_W : box.height / 2 >= MIN_PANE_H;
}

export interface GridProps {
  tile: Tile;
  /** The pane the sidebar and the address bar point at. */
  focus: string;
  /** True once the tab holds more than one pane, which is when panes get chrome. */
  split: boolean;
  renderPane: (paneId: string) => ReactNode;
}

export function PaneGrid({ tile, focus, split, renderPane }: GridProps) {
  if (tile.kind === "pane") {
    return (
      <PaneBox id={tile.id} focused={tile.id === focus} split={split}>
        {renderPane(tile.id)}
      </PaneBox>
    );
  }
  return <Split tile={tile} focus={focus} split={split} renderPane={renderPane} />;
}

function PaneBox({ id, focused, split, children }: { id: string; focused: boolean; split: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const focusPane = usePanes((p) => p.focusPane);
  const closePane = usePanes((p) => p.closePane);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => rects.set(id, el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      rects.delete(id);
    };
  }, [id]);
  return (
    <div
      ref={ref}
      className={s.pane}
      data-pane={id}
      data-focus={split ? focused : undefined}
      // Capture, so clicking or typing anywhere in a pane — a message, the
      // composer, a button — moves focus to it before that does whatever it
      // does. Deliberately not the DOM's own focus event: the caret moves for
      // reasons the reader did not ask for, and letting that drive pane focus
      // had three composers chasing each other in a loop.
      onPointerDownCapture={split && !focused ? () => focusPane(id) : undefined}
      onKeyDownCapture={split && !focused ? () => focusPane(id) : undefined}
    >
      <PaneCtx.Provider value={useMemo(() => ({ id, focused: !split || focused }), [id, focused, split])}>
        {children}
      </PaneCtx.Provider>
      {split ? (
        <button className={s.paneClose} aria-label={t("panes.closePane")} title={t("panes.closePane")} onClick={() => closePane(id)}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function Split({ tile, focus, split, renderPane }: GridProps & { tile: Tile & { kind: "split" } }) {
  const setSizes = usePanes((p) => p.setSizes);
  const box = useRef<HTMLDivElement>(null);
  /** The drag in progress: which divider, and the sizes it started from. */
  const drag = useRef<{ at: number; start: number; sizes: number[]; total: number } | null>(null);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const el = box.current;
      if (!d || !el) return;
      const along = tile.dir === "row";
      const moved = (along ? e.clientX : e.clientY) - d.start;
      // A right-to-left page lays the children out the other way, so dragging
      // the divider left has to make the first child bigger, not smaller.
      const rtl = along && getComputedStyle(el).direction === "rtl";
      const delta = (rtl ? -moved : moved) / d.total;
      const min = (along ? MIN_PANE_W : MIN_PANE_H) / d.total;
      const a = d.sizes[d.at]!;
      const b = d.sizes[d.at + 1]!;
      // Neither side may be pushed below what a chat needs to stay readable;
      // the pair keeps its combined share, so nothing beyond them moves.
      const shift = Math.max(min - a, Math.min(b - min, delta));
      if (!(a + b - 2 * min >= 0)) return;
      const sizes = [...d.sizes];
      sizes[d.at] = a + shift;
      sizes[d.at + 1] = b - shift;
      setSizes(tile.id, sizes);
    },
    [setSizes, tile.dir, tile.id],
  );

  useEffect(() => {
    const stop = () => {
      drag.current = null;
      document.body.classList.remove("ec-pane-drag");
      document.body.removeAttribute("data-drag");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stop();
    };
  }, [onMove]);

  const grab = (at: number) => (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    drag.current = {
      at,
      start: tile.dir === "row" ? e.clientX : e.clientY,
      sizes: [...tile.sizes],
      total: tile.dir === "row" ? rect.width : rect.height,
    };
    document.body.classList.add("ec-pane-drag");
    document.body.setAttribute("data-drag", tile.dir);
  };

  /** Nudging a divider from the keyboard, for anyone not using a pointer. */
  const nudge = (at: number) => (e: React.KeyboardEvent) => {
    const el = box.current;
    if (!el) return;
    const along = tile.dir === "row";
    const back = along ? "ArrowLeft" : "ArrowUp";
    const on = along ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== on) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const total = along ? rect.width : rect.height;
    const min = (along ? MIN_PANE_W : MIN_PANE_H) / total;
    const step = (e.key === on ? 24 : -24) / total;
    const a = tile.sizes[at]!;
    const b = tile.sizes[at + 1]!;
    const shift = Math.max(min - a, Math.min(b - min, step));
    const sizes = [...tile.sizes];
    sizes[at] = a + shift;
    sizes[at + 1] = b - shift;
    setSizes(tile.id, sizes);
  };

  return (
    <div ref={box} className={s.split} data-dir={tile.dir}>
      {tile.children.map((child, i) => (
        <div key={child.id} className={s.slot} style={{ flexBasis: `${(tile.sizes[i] ?? 1 / tile.children.length) * 100}%` }}>
          <PaneGrid tile={child} focus={focus} split={split} renderPane={renderPane} />
          {i < tile.children.length - 1 ? (
            <div
              className={s.divider}
              role="separator"
              tabIndex={0}
              aria-orientation={tile.dir === "row" ? "vertical" : "horizontal"}
              onPointerDown={grab(i)}
              onKeyDown={nudge(i)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
