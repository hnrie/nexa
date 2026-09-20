/**
 * One sticker in any of its shapes: a picture, a looping video, or a
 * Telegram animated sticker (gzipped Lottie). The element matches whatever
 * picture it replaces so every existing size rule keeps working, and the
 * player code only loads on the first animated sticker rather than with the
 * app itself.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import s from "./StickerView.module.css";

interface ViewProps {
  /** The sticker's format, when it is known: png, apng, gif, webp, tgs, webm. */
  format?: string | undefined;
  src: string;
  alt: string;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  eager?: boolean | undefined;
  draggable?: boolean | undefined;
}

export function StickerView({ format, src, alt, className, style, eager, draggable }: ViewProps) {
  if (format === "tgs") return <TgsView src={src} alt={alt} className={className} style={style} />;
  if (format === "webm") {
    return <video data-sticker-media className={className} style={style} src={src} autoPlay loop muted playsInline aria-label={alt} />;
  }
  return <img data-sticker-media className={className} style={style} src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" draggable={draggable} />;
}

/** A .tgs file, fetched and unzipped here, then played with lottie-web. */
function TgsView({ src, alt, className, style }: { src: string; alt: string; className?: string | undefined; style?: CSSProperties | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let anim: { destroy(): void } | undefined;
    void (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error("tgs fetch failed");
        const buf = await res.arrayBuffer();
        if (typeof DecompressionStream === "undefined") throw new Error("no gzip stream");
        const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
        const data: unknown = JSON.parse(text);
        const lottie = (await import("lottie-web")).default;
        if (!alive || !ref.current) return;
        anim = lottie.loadAnimation({ container: ref.current, animationData: data, loop: true, autoplay: true, renderer: "svg" });
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      try {
        anim?.destroy();
      } catch {
        /* already gone */
      }
    };
  }, [src]);
  if (failed) return <span data-sticker-media className={className} style={style} role="img" aria-label={alt} />;
  return <div ref={ref} data-sticker-media className={className ? `${className} ${s.tgs}` : s.tgs} style={style} role="img" aria-label={alt} />;
}
