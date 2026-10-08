import { AlertCircle, FileIcon, GripVertical, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AttachmentMeta } from "@/crypto/message";
import { Attachments } from "@/components/chat/Attachments";
import { acquire, attachmentObjectURL, cachedURL, PRIORITY, release } from "@/lib/mediaCache";
import { copyOf } from "@/lib/pictureCopy";
import { FILE_MIN_WIDTH, type FileAlign } from "@/markdown/parse";
import { t } from "@/i18n";
import s from "./Notes.module.css";

/** A file on its way into a note from this device. */
export interface PendingUpload {
  name: string;
  /** From 0 to 1. */
  progress: number;
  /** Why it did not go up, when it did not. */
  error: string | null;
}

interface Props {
  meta: AttachmentMeta | undefined;
  /** What the note's text calls it. */
  name: string;
  pending?: PendingUpload | undefined;
  /** In a note being written: takes the file out of it. */
  onRemove?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** How much of the line a picture or video takes, in percent. */
  width?: number | undefined;
  /** In a note being written: makes a picture or video that wide. */
  onResize?: ((width: number) => void) | undefined;
  /** The side of its line a narrower picture keeps to; null or left out for the middle. */
  align?: FileAlign | null | undefined;
  /**
   * In a note being written: puts the file in another gap between the note's
   * lines (`to`, counted as the editor counts its blocks; null to stay) and on
   * a side of its line.
   */
  onPlace?: ((to: number | null, align: FileAlign | null) => void) | undefined;
}

/** Where a file being moved would land, drawn over the page while it is dragged. */
interface Landing {
  top: number;
  left: number;
  width: number;
  height: number;
  /** A slim bar between two lines, or the picture's own place on its line. */
  between: boolean;
}

/** How close to the top or bottom of the note a drag scrolls it, and how fast at the edge. */
const EDGE = 56;
const EDGE_SPEED = 14;

/** The side a point across a line asks for: its left third, its middle, its right third. */
function sideAt(x: number, line: DOMRect): FileAlign | null {
  const at = (x - line.left) / (line.width || 1);
  return at < 1 / 3 ? "left" : at > 2 / 3 ? "right" : null;
}

/** The nearest element above that scrolls up and down. */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** The sizes offered at a click, in percent of the line. */
const SIZES: { width: number; label: () => string }[] = [
  { width: 33, label: () => t("notes.file.small") },
  { width: 50, label: () => t("notes.file.medium") },
  { width: 75, label: () => t("notes.file.large") },
  { width: 100, label: () => t("notes.file.fullWidth") },
];

/**
 * A file where a note's text has it. Once it is up it is drawn the way a
 * message draws its files, a picture or a video as wide as the note says
 * (dragged wider or narrower by its edges, or set at a click from its
 * toolbar), a sound to play, a file to download. While it goes up from this
 * device it shows how far it has got. One the note names but nobody has the
 * file for (someone else's still on its way, or one that never made it up)
 * says so.
 */
export function NoteFile({ meta, name, pending, onRemove, onRetry, width = 100, onResize, align = null, onPlace }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const visual = !!meta && (meta.type.startsWith("image/") || meta.type.startsWith("video/"));
  const resizable = visual && !!onResize;
  const movable = !!onPlace;
  const shown = live ?? width;
  // narrower than its line, it keeps to a side; a full-width one has none to keep to
  const side = shown < 100 ? align : null;
  // keys pressed faster than the note redraws each start from the one before
  const sideNow = useRef(side);
  sideNow.current = side;

  /** The editor's line the file is, and the lines around it: what a move counts in. */
  const lines = (): { el: HTMLElement; all: HTMLElement[]; at: number } | null => {
    const el = root.current?.closest<HTMLElement>("[data-b='file']");
    const all = el?.parentElement ? ([...el.parentElement.children] as HTMLElement[]) : [];
    const at = el ? all.indexOf(el) : -1;
    return el && at >= 0 ? { el, all, at } : null;
  };

  /** Where a picture this wide sits across a line, on a side. */
  const across = (line: DOMRect, to: FileAlign | null): { left: number; width: number } => {
    const w = (line.width * shown) / 100;
    return { left: to === "left" ? line.left : to === "right" ? line.right - w : line.left + (line.width - w) / 2, width: w };
  };

  const startMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !onPlace) return;
    const here = lines();
    if (!here) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const scroller = scrollerOf(here.el);
    let x = e.clientX;
    let y = e.clientY;
    let to: number | null = null;
    let aim: FileAlign | null = side;
    let frame = 0;
    const measure = (): void => {
      const { el, all, at } = here;
      const line = el.getBoundingClientRect();
      // the gap between lines nearest the pointer, down the page
      let best = at;
      let bestGap = Infinity;
      let bestY = 0;
      for (let k = 0; k <= all.length; k++) {
        const above = all[k - 1]?.getBoundingClientRect();
        const below = all[k]?.getBoundingClientRect();
        const gy = above && below ? (above.bottom + below.top) / 2 : below ? below.top : (above?.bottom ?? 0);
        const d = Math.abs(y - gy);
        if (d < bestGap) {
          bestGap = d;
          best = k;
          bestY = gy;
        }
      }
      to = best === at || best === at + 1 ? null : best;
      if (shown < 100) aim = sideAt(x, line);
      const place = across(line, aim);
      if (to === null) {
        const host = root.current?.getBoundingClientRect() ?? line;
        setLanding({ top: host.top, left: place.left, width: place.width, height: host.height, between: false });
      } else setLanding({ top: bestY - 2, left: place.left, width: place.width, height: 4, between: true });
    };
    // near the note's top or bottom edge the note scrolls along
    const tick = (): void => {
      frame = 0;
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const step = y < box.top + EDGE ? -EDGE_SPEED * (1 - Math.max(0, y - box.top) / EDGE) : y > box.bottom - EDGE ? EDGE_SPEED * (1 - Math.max(0, box.bottom - y) / EDGE) : 0;
      if (!step) return;
      scroller.scrollTop += step;
      measure();
      frame = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent): void => {
      x = ev.clientX;
      y = ev.clientY;
      measure();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const finish = (keep: boolean): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      scroller?.removeEventListener("scroll", measure);
      cancelAnimationFrame(frame);
      setLanding(null);
      if (keep && (to !== null || aim !== side)) onPlace(to, aim);
    };
    const up = (): void => finish(true);
    const cancel = (): void => finish(false);
    // Escape puts it down where it was
    const key = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    scroller?.addEventListener("scroll", measure);
    measure();
  };

  // Up and Down move it past the line before or after it; Left and Right move
  // it to that side of its own line, through the middle.
  const moveKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onPlace) return;
    const here = lines();
    if (!here) return;
    const { all, at } = here;
    const blank = (el: HTMLElement | undefined) => el?.dataset["b"] === "p" && el.hasAttribute("data-empty");
    const was = sideNow.current;
    let to: number | null = null;
    let next = was;
    if (e.key === "ArrowUp") {
      if (at === 0) return;
      to = at - 1;
    } else if (e.key === "ArrowDown") {
      // the empty line that follows a file is stepped over with it
      const past = blank(all[at + 1]) && all[at + 2] ? at + 3 : at + 2;
      if (past > all.length) return;
      to = past;
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && shown < 100) {
      const order: (FileAlign | null)[] = ["left", null, "right"];
      next = order[Math.max(0, Math.min(2, order.indexOf(was) + (e.key === "ArrowLeft" ? -1 : 1)))] ?? null;
      if (next === was) return;
    } else return;
    e.preventDefault();
    onPlace(to, next);
    sideNow.current = next;
    // the editor puts its caret after the file; the keyboard stays on the handle
    handle.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => handle.current?.focus({ preventScroll: true }));
  };

  /** The line the file sits on: its width is what a percentage is of. */
  const line = (): HTMLElement | null => root.current?.closest<HTMLElement>("[data-b='file'], [data-note-file-line]") ?? null;
  const show = (w: number | null): void => {
    const el = line();
    if (!el) return;
    if (w === null || w >= 100) el.style.removeProperty("--file-w");
    else el.style.setProperty("--file-w", `${w}%`);
  };

  const grab = (side: "start" | "end") => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !onResize) return;
    const el = line();
    const box = root.current?.getBoundingClientRect();
    if (!el || !box) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rtl = getComputedStyle(el).direction === "rtl";
    // the picture is centred, so it grows by as much on the other side too
    const sign = (side === "end") !== rtl ? 2 : -2;
    const from = e.clientX;
    const start = box.width;
    const full = el.clientWidth || 1;
    let now = shown;
    const move = (ev: PointerEvent): void => {
      const px = start + sign * (ev.clientX - from);
      now = Math.round(Math.max(FILE_MIN_WIDTH, Math.min(100, (px / full) * 100)));
      setLive(now);
      show(now);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLive(null);
      if (now !== width) onResize(now);
      else show(width);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // the arrow keys move a handle too, five percent at a time
  const key = (side: "start" | "end") => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onResize) return;
    const rtl = line() ? getComputedStyle(line()!).direction === "rtl" : false;
    const out = side === "end" ? (rtl ? "ArrowLeft" : "ArrowRight") : rtl ? "ArrowRight" : "ArrowLeft";
    const step = e.key === out ? 5 : e.key === "ArrowLeft" || e.key === "ArrowRight" ? -5 : e.key === "Home" ? -100 : e.key === "End" ? 100 : 0;
    if (!step) return;
    e.preventDefault();
    onResize(Math.max(FILE_MIN_WIDTH, Math.min(100, width + step)));
  };

  let body;
  if (meta) {
    body = <Attachments list={[meta]} fill={visual} />;
  } else if (pending) {
    const percent = Math.round(pending.progress * 100);
    body = (
      <div className={s.fileWait} data-error={pending.error ? "" : undefined}>
        {pending.error ? <AlertCircle size={20} className={s.fileWaitIcon} aria-hidden="true" /> : <FileIcon size={20} className={s.fileWaitIcon} aria-hidden="true" />}
        <div className={s.fileWaitText}>
          <span className={s.fileWaitName} dir="auto" title={pending.name}>{pending.name}</span>
          {pending.error ? (
            <span className={s.fileWaitError} role="alert">{pending.error}</span>
          ) : (
            <span className={s.fileWaitBar} role="progressbar" aria-label={t("notes.file.uploading", { name: pending.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ width: `${Math.max(4, percent)}%` }} />
            </span>
          )}
        </div>
        {pending.error && onRetry ? (
          <button type="button" className={s.fileAct} onMouseDown={(e) => e.preventDefault()} onClick={onRetry} aria-label={t("notes.file.retry", { name: pending.name })} title={t("notes.file.retryShort")}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className={s.fileWait} data-missing="">
        <FileIcon size={20} className={s.fileWaitIcon} aria-hidden="true" />
        <div className={s.fileWaitText}>
          <span className={s.fileWaitName} dir="auto" title={name}>{name}</span>
          <span className={s.fileWaitNote}>{t("notes.file.notHere")}</span>
        </div>
      </div>
    );
  }
  return (
    <div ref={root} className={s.file} data-testid="note-file" data-visual={visual || undefined} data-resizing={live !== null || undefined} data-moving={landing ? "" : undefined} data-align={visual ? (side ?? undefined) : undefined} data-state={meta ? "ready" : pending ? (pending.error ? "failed" : "uploading") : "missing"}>
      {body}
      {resizable
        ? (["start", "end"] as const).map((side) => (
            <span
              key={side}
              className={s.grip}
              data-side={side}
              role="slider"
              tabIndex={0}
              aria-label={t("notes.file.width", { name })}
              aria-valuemin={FILE_MIN_WIDTH}
              aria-valuemax={100}
              aria-valuenow={shown}
              aria-valuetext={`${shown}%`}
              onPointerDown={grab(side)}
              onKeyDown={key(side)}
              data-testid={`note-file-grip-${side}`}
            />
          ))
        : null}
      {live !== null ? <span className={s.fileSize} aria-hidden="true">{live}%</span> : null}
      {landing
        ? createPortal(<div className={s.landing} data-between={landing.between || undefined} style={{ top: landing.top, left: landing.left, width: landing.width, height: landing.height }} aria-hidden="true" />, document.body)
        : null}
      {resizable || onRemove || movable ? (
        <div className={s.fileBar} role="toolbar" aria-label={t("notes.file.tools", { name })} onMouseDown={(e) => e.preventDefault()}>
          {movable ? (
            <>
              <button
                ref={handle}
                type="button"
                className={s.fileMove}
                aria-label={t("notes.file.move", { name })}
                aria-description={shown < 100 ? t("notes.file.moveHint") : t("notes.file.moveHintFull")}
                title={t("notes.file.moveShort")}
                onPointerDown={startMove}
                onKeyDown={moveKey}
                data-testid="note-file-move"
              >
                <GripVertical size={16} aria-hidden="true" />
                <span className={s.sizeWord} aria-hidden="true">{t("notes.file.moveShort")}</span>
              </button>
              {resizable ? <span className={s.fileBarRule} aria-hidden="true" /> : null}
            </>
          ) : null}
          {resizable
            ? SIZES.map((size) => (
                <button key={size.width} type="button" className={s.fileBarSize} aria-pressed={shown === size.width} aria-label={size.label()} onClick={() => onResize?.(size.width)} data-testid={`note-file-size-${size.width}`}>
                  {/* on a narrow picture the sizes say how wide, which needs no words */}
                  <span className={s.sizeWord} aria-hidden="true">{size.label()}</span>
                  <span className={s.sizeShort} aria-hidden="true">{size.width}%</span>
                </button>
              ))
            : null}
          {onRemove ? (
            <button type="button" className={s.fileBarRemove} onClick={onRemove} aria-label={t("notes.file.remove", { name })} title={t("notes.file.removeShort")} data-testid="note-file-remove">
              <Trash2 size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The line a file sits on in a note that is only read: as wide as the note says for a picture, in the middle or on the side it says. */
export function NoteFileLine({ width, align, children }: { width?: number | undefined; align?: FileAlign | undefined; children: React.ReactNode }) {
  return (
    <div className={s.fileLine} data-note-file-line="" data-align={width && width < 100 ? align : undefined} style={width && width < 100 ? ({ "--file-w": `${width}%` } as React.CSSProperties) : undefined}>
      {children}
    </div>
  );
}

/** A picture this big with no small copy beside it is not fetched for a card: the card names it instead. */
const THUMB_MAX = 8 * 1024 * 1024;

/**
 * A file as a note's card in the list shows it: a picture as a small crop of
 * itself, anything else by its name.
 */
export function NoteFileThumb({ meta, name }: { meta: AttachmentMeta | undefined; name: string }) {
  const shown = meta && meta.type.startsWith("image/") ? (copyOf(meta) ?? (meta.size <= THUMB_MAX ? meta : null)) : null;
  const id = shown?.blob_id ?? "";
  const [url, setUrl] = useState<string | null>(() => (id ? (cachedURL(id) ?? null) : null));
  useEffect(() => {
    if (!shown) return;
    const ctrl = new AbortController();
    attachmentObjectURL(shown, ctrl.signal, PRIORITY.near)
      .then((u) => {
        if (!ctrl.signal.aborted) setUrl(u);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
    // the file is what it is by its id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // held while it is on the card, so the cache does not let go of it underneath
  useEffect(() => {
    if (!url || !id) return;
    if (!acquire(id, url)) {
      setUrl(null);
      return;
    }
    return () => release(id, url);
  }, [url, id]);
  if (!shown) {
    return (
      <span className={s.thumbFile}>
        <FileIcon size={14} aria-hidden="true" />
        <span dir="auto">{name}</span>
      </span>
    );
  }
  return <span className={s.thumb}>{url ? <img src={url} alt={meta?.alt || name} decoding="async" /> : null}</span>;
}
