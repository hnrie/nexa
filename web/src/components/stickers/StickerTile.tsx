/**
 * Stickers in grids: the picker, a pack's page, the settings and pack editor.
 *
 * A tile shows a small still of its sticker (see lib/stickerStills.ts): made
 * once, a few at a time with the ones on screen first, and kept, so a grid
 * fills fast even on a slow phone and a reopened picker is full at once. The
 * moving sticker plays only on the tile being pointed at or focused. A tile
 * whose still could not load says so and keeps trying by itself; pressing it
 * tries at once.
 */
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Sticker, StickerPack } from "@/api/types";
import { mediaSize } from "@/api/users";
import { useScreenPlace, type ScreenPlace } from "@/hooks/useNearScreen";
import { fullStickerUrl, peekStill, stillKey, watchStill, type StillHandle, type StillSource, type StillView } from "@/lib/stickerStills";
import { t } from "@/i18n";
import { StickerView, useStill } from "./StickerView";
import s from "./StickerView.module.css";

/**
 * How many pixels across a grid's stills are: sharp enough at a tile's size
 * on this screen, and no bigger, so they arrive fast; on a connection that
 * says it is slow or saving data, a quarter of the bytes matters more than
 * the last bit of sharpness. Every grid uses the same size, so a still made
 * for one serves them all.
 */
export function gridStillPx(): number {
  const conn = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined;
  const slow = !!conn?.saveData || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g" || conn?.effectiveType === "3g";
  return Math.min(slow ? 128 : 256, mediaSize(100));
}

/**
 * Pointing at a tile with a mouse or pen plays it; a finger on a phone is
 * about to send it, and loading the moving sticker then only costs data.
 */
export function hoverPlays(e: { pointerType: string }): boolean {
  return e.pointerType !== "touch";
}

export function stillSourceOf(pack: Pick<StickerPack, "kind">, st: Pick<Sticker, "blob_id" | "format" | "animated">): StillSource {
  return { kind: pack.kind === "emoji" ? "emoji" : "sticker", blobId: st.blob_id, format: st.format, animated: st.animated };
}

/** Whether a sticker moves, so pointing at its tile has something to play. */
export function moves(src: StillSource): boolean {
  return src.animated || src.format === "tgs" || src.format === "webm";
}

/**
 * The still for one tile, asked for as urgently as the tile is near the
 * screen (later still by `lower`), and a way to try again.
 */
export function useStickerStill(src: StillSource, place: ScreenPlace, lower = 0): [StillView, () => void] {
  const px = gridStillPx();
  const key = stillKey(src, px);
  const [view, setView] = useState<StillView>(() => peekStill(src, px));
  const handle = useRef<StillHandle | null>(null);
  const latest = useRef(src);
  latest.current = src;
  useEffect(() => {
    const h = watchStill(latest.current, px, setView);
    handle.current = h;
    return () => {
      handle.current = null;
      h.release();
    };
  }, [key, px]);
  useEffect(() => {
    handle.current?.want(place === "visible" ? lower : place === "near" ? lower + 1 : null);
  }, [key, place, lower]);
  const retry = useCallback(() => handle.current?.retry(), []);
  return [view, retry];
}

/**
 * What a tile shows: the still once it is here, a quiet placeholder while it
 * loads, a mark saying it could not load, and the moving sticker over the
 * still while `play`.
 */
export function StillFace({ view, src, alt, play, className }: { view: StillView; src: StillSource; alt: string; play: boolean; className?: string | undefined }) {
  // Stickers are see-through, so the still goes once the moving one has
  // drawn (the two would show through each other), and comes back when it stops.
  const [live, setLive] = useState(false);
  const playing = play && !!view.url;
  useEffect(() => {
    if (!playing) setLive(false);
  }, [playing]);
  const onReady = useCallback(() => setLive(true), []);
  return (
    <span className={className ? `${s.still} ${className}` : s.still} data-sticker-state={view.status}>
      {/* data-sticker-media: the size and backdrop rules grids already had for the sticker apply to its still */}
      {view.url ? <img data-sticker-media className={s.stillImg} src={view.url} alt={alt} draggable={false} decoding="async" style={live && playing ? { visibility: "hidden" } : undefined} /> : null}
      {view.status === "failed" ? (
        <span className={s.failed} title={t("stickers.tile.couldNotLoadHint")}>
          <RotateCw aria-hidden="true" />
          <span className={s.failedText}>{t("stickers.tile.couldNotLoad")}</span>
        </span>
      ) : null}
      {/* the still shows until the moving one has drawn its first frame */}
      {playing ? (
        <span className={s.live}>
          <StickerView format={src.format} src={fullStickerUrl(src)} alt="" className={s.fill} play renderer="canvas" eager onReady={onReady} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * A sticker in a grid of many that is not a button of its own (a pack's
 * page, the settings, the pack editor, a pack preview). Pressing one that
 * could not load tries it again; whatever the press also does around it
 * still happens.
 */
export function LazySticker({ sticker, pack, alt, className, root }: { sticker: Sticker; pack: Pick<StickerPack, "kind">; alt: string; className?: string | undefined; root?: RefObject<Element | null> }) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = useScreenPlace(ref, root);
  const src = stillSourceOf(pack, sticker);
  const [view, retry] = useStickerStill(src, place);
  const [hot, setHot] = useState(false);
  const still = useStill();
  return (
    <span
      ref={ref}
      className={className ? `${s.lazy} ${className}` : s.lazy}
      onPointerEnter={(e) => hoverPlays(e) && setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      onClick={view.status === "failed" ? retry : undefined}
    >
      <StillFace view={view} src={src} alt={alt} play={hot && !still && moves(src) && place !== "far"} />
    </span>
  );
}
