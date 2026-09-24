/**
 * One sticker in any of its shapes: a picture, a looping video, or a
 * Telegram animated sticker (gzipped Lottie). The element matches whatever
 * picture it replaces so every existing size rule keeps working, and the
 * player code only loads on the first animated sticker rather than with the
 * app itself.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useNearScreen } from "@/hooks/useNearScreen";
import { useSettings } from "@/stores/settings";
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
  /**
   * Whether an animated sticker moves; when not, it shows its first frame.
   * A grid of them plays only the one being pointed at, which is what keeps
   * a picker of hundreds from taking a phone down.
   */
  play?: boolean | undefined;
  /**
   * How a Telegram sticker is drawn: svg is sharpest for one at a time, a
   * canvas is far lighter when there are many.
   */
  renderer?: "svg" | "canvas" | undefined;
}

export function StickerView({ format, src, alt, className, style, eager, draggable, play = true, renderer = "svg" }: ViewProps) {
  if (format === "tgs") return <TgsView src={src} alt={alt} className={className} style={style} play={play} renderer={renderer} />;
  if (format === "webm") return <WebmView src={src} alt={alt} className={className} style={style} play={play} />;
  return <img data-sticker-media className={className} style={style} src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" draggable={draggable} />;
}

function WebmView({ src, alt, className, style, play }: { src: string; alt: string; className?: string | undefined; style?: CSSProperties | undefined; play: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (play) {
      void v.play().catch(() => undefined);
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [play]);
  // the #t fragment makes a still video show its first frame rather than nothing
  return <video ref={ref} data-sticker-media className={className} style={style} src={play ? src : `${src}#t=0.001`} autoPlay={play} loop muted playsInline preload={play ? "auto" : "metadata"} aria-label={alt} />;
}

/**
 * The unzipped Lottie text of recent Telegram stickers, so scrolling a grid
 * back and forth does not fetch and unzip each one again. Text rather than
 * the parsed object: the player writes into what it is given.
 */
const tgsText = new Map<string, Promise<string>>();
const TGS_KEEP = 96;

function loadTgs(src: string): Promise<string> {
  const hit = tgsText.get(src);
  if (hit) {
    // most recently used last, so the oldest is the one let go
    tgsText.delete(src);
    tgsText.set(src, hit);
    return hit;
  }
  const load = (async () => {
    const res = await fetch(src);
    if (!res.ok) throw new Error("tgs fetch failed");
    const buf = await res.arrayBuffer();
    if (typeof DecompressionStream === "undefined") throw new Error("no gzip stream");
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  })();
  tgsText.set(src, load);
  load.catch(() => tgsText.delete(src));
  while (tgsText.size > TGS_KEEP) tgsText.delete(tgsText.keys().next().value as string);
  return load;
}

interface Lottie {
  play(): void;
  goToAndStop(value: number, isFrame?: boolean): void;
  destroy(): void;
}

/** A .tgs file, fetched and unzipped here, then played with lottie-web. */
function TgsView({ src, alt, className, style, play, renderer }: { src: string; alt: string; className?: string | undefined; style?: CSSProperties | undefined; play: boolean; renderer: "svg" | "canvas" }) {
  const ref = useRef<HTMLDivElement>(null);
  const anim = useRef<Lottie | null>(null);
  const playing = useRef(play);
  playing.current = play;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data: unknown = JSON.parse(await loadTgs(src));
        const lottie = (await import("lottie-web")).default;
        if (!alive || !ref.current) return;
        const base = { container: ref.current, animationData: data, loop: true, autoplay: playing.current };
        const a =
          renderer === "canvas"
            ? lottie.loadAnimation({ ...base, renderer: "canvas", rendererSettings: { dpr: window.devicePixelRatio || 1, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" } })
            : lottie.loadAnimation({ ...base, renderer: "svg" });
        anim.current = a;
        if (!playing.current) a.goToAndStop(0, true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      try {
        anim.current?.destroy();
      } catch {
        /* already gone */
      }
      anim.current = null;
    };
  }, [src, renderer]);
  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    if (play) a.play();
    else a.goToAndStop(0, true);
  }, [play]);
  if (failed) return <span data-sticker-media className={className} style={style} role="img" aria-label={alt} />;
  return <div ref={ref} data-sticker-media className={className ? `${className} ${s.tgs}` : s.tgs} style={style} role="img" aria-label={alt} />;
}

/** Whether stickers should keep still: Reduced motion, here or in the system. */
export function useStill(): boolean {
  const setting = useSettings((x) => x.settings.reducedMotion);
  return setting || (typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * A sticker in a grid of many: drawn only while it is on screen or close to
 * it, and, if animated, moving only while pointed at or focused. `className`
 * sizes the box it sits in; the sticker fills that box.
 */
export function LazySticker({ format, src, alt, className, root }: { format?: string | undefined; src: string; alt: string; className?: string | undefined; root?: RefObject<Element | null> }) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref, root);
  const [hot, setHot] = useState(false);
  const still = useStill();
  return (
    <span
      ref={ref}
      className={className ? `${s.lazy} ${className}` : s.lazy}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      {near ? <StickerView format={format} src={src} alt={alt} className={s.fill} play={hot && !still} renderer="canvas" /> : null}
    </span>
  );
}
