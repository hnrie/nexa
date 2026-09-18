import { RotateCcw, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { animatedByType, isAnimatedImage } from "./animatedImage";
import s from "./ImageCrop.module.css";

import { t } from "@/i18n";
export interface CropResult {
  blob: Blob;
  /** True when the original bytes are used unchanged (an animation kept whole). */
  original: boolean;
}

interface Props {
  file: File;
  /** Width divided by height of the area being filled. */
  aspect: number;
  /** Round mask, for avatars. */
  round?: boolean;
  title?: string;
  /** Longest edge of the exported image. */
  maxSize?: number;
  onDone: (result: CropResult) => void;
  onClose: () => void;
}

const VIEW = 320;

/** Pan-and-zoom cropper. Animated files can be kept whole instead of flattened. */
export function ImageCropModal({ file, aspect, round = false, title = t("common.imageCrop.editImage"), maxSize = 1024, onDone, onClose }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [animated, setAnimated] = useState(() => animatedByType(file.type));
  const [keepOriginal, setKeepOriginal] = useState(animated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const boxW = VIEW;
  const boxH = Math.round(VIEW / aspect);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    // Without this a file the browser cannot decode leaves an empty frame and
    // an Apply that is disabled for good, with nothing saying why.
    el.onerror = () => setError(t("common.imageCrop.thatPictureCouldNotBeOpened"));
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // a WebP or PNG only keeps its original when the file really animates
  useEffect(() => {
    if (animatedByType(file.type)) return;
    let alive = true;
    void isAnimatedImage(file).then((yes) => {
      if (!alive || !yes) return;
      setAnimated(true);
      setKeepOriginal(true);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  // the smallest zoom that still covers the frame
  const baseScale = img ? Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight) : 1;
  const scale = baseScale * zoom;

  const clamp = useCallback(
    (next: { x: number; y: number }, sc: number) => {
      if (!img) return next;
      const w = img.naturalWidth * sc;
      const h = img.naturalHeight * sc;
      const maxX = Math.max(0, (w - boxW) / 2);
      const maxY = Math.max(0, (h - boxH) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    },
    [img, boxW, boxH],
  );

  useEffect(() => setOffset((o) => clamp(o, scale)), [scale, clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, scale));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const apply = async () => {
    if (keepOriginal) {
      onDone({ blob: file, original: true });
      return;
    }
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const outW = Math.min(maxSize, Math.round(boxW * (img.naturalWidth * scale >= boxW ? 4 : 1)));
      const w = Math.min(maxSize, Math.max(128, outW));
      const h = Math.round(w / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // A canvas the browser refuses, or one it runs out of memory drawing, used
      // to leave Apply doing nothing at all and no word of why.
      if (!ctx) {
        setError(t("common.imageCrop.thatPictureCouldNotBeCropped"));
        return;
      }
      ctx.imageSmoothingQuality = "high";
      const k = w / boxW; // view pixels to output pixels
      const dw = img.naturalWidth * scale * k;
      const dh = img.naturalHeight * scale * k;
      ctx.drawImage(img, (w - dw) / 2 + offset.x * k, (h - dh) / 2 + offset.y * k, dw, dh);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (blob) onDone({ blob, original: false });
      else setError(t("common.imageCrop.thatPictureCouldNotBeCropped"));
    } catch {
      setError(t("common.imageCrop.thatPictureCouldNotBeCropped"));
    } finally {
      setBusy(false);
    }
  };

  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button loading={busy} disabled={!img} onClick={() => void apply()} data-testid="crop-apply">{t("common.imageCrop.apply")}</Button>
        </>
      }
    >
      <div className={s.wrap}>
        <div
          className={s.frame}
          data-round={round}
          style={{ width: boxW, height: boxH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z - e.deltaY / 500)))}
        >
          {img ? (
            <img
              className={s.img}
              src={img.src}
              alt=""
              draggable={false}
              style={{ width: dw, height: dh, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`, opacity: keepOriginal ? 0.55 : 1 }}
            />
          ) : null}
          <span className={s.mask} data-round={round} />
        </div>
        <div className={s.controls}>
          <ZoomIn size={16} />
          <input className={s.range} type="range" min={1} max={5} step={0.01} value={zoom} disabled={keepOriginal} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t("common.imageCrop.zoom")} />
          <button className={s.reset} aria-label={t("common.imageCrop.reset")} title={t("common.imageCrop.reset")} onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={16} /></button>
        </div>
        {animated ? (
          <label className={s.keep}>
            <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
            <span>{t("common.imageCrop.uploadTheOriginalSoItKeeps")}</span>
          </label>
        ) : null}
        {error ? <p className={s.error} data-testid="crop-error">{error}</p> : null}
        <p className={s.hint}>{t("common.imageCrop.dragToMoveScrollOrUse")}</p>
      </div>
    </Modal>
  );
}
