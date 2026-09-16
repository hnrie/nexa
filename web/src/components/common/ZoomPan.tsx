/**
 * A box whose contents can be zoomed into and dragged around: the wheel (or a
 * trackpad pinch, which arrives as a ctrl-wheel) on a computer, two fingers on
 * a phone, a double click or double tap to go in and back out again. The view
 * is written straight onto the element rather than through React, so it keeps
 * up with the pointer.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { clampView, pinchView, type View } from "@/lib/zoomPan";

/** Where a double click lands when the picture is at its own size. */
const STEP = 2.5;
const DOUBLE_TAP_MS = 350;

export interface ZoomPanHandle {
  reset: () => void;
  zoomBy: (factor: number) => void;
}

function middle(list: { x: number; y: number }[]) {
  const n = list.length || 1;
  return { x: list.reduce((a, p) => a + p.x, 0) / n, y: list.reduce((a, p) => a + p.y, 0) / n };
}
function spread(list: { x: number; y: number }[]) {
  if (list.length < 2) return 0;
  const [a, b] = list as [{ x: number; y: number }, { x: number; y: number }];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ZoomPan({
  children,
  className,
  onZoom,
  handle,
  onIdleClick,
}: {
  children: ReactNode;
  className?: string;
  /** Called with the scale whenever it changes, for a readout or a reset button. */
  onZoom?: (scale: number) => void;
  handle?: Ref<ZoomPanHandle>;
  /** A click that was not a drag and did not zoom — a backdrop close, usually. */
  onIdleClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; from: { x: number; y: number }; spread: number } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef(0);
  const report = useRef(onZoom);
  report.current = onZoom;

  const apply = useCallback(() => {
    const el = ref.current;
    const target = el?.firstElementChild as HTMLElement | null;
    if (!el || !target) return;
    const v = view.current;
    target.style.transform = v.scale > 1 ? `translate(${v.x}px, ${v.y}px) scale(${v.scale})` : "";
    el.dataset.zoomed = String(v.scale > 1);
    report.current?.(v.scale);
  }, []);

  const box = () => ({ width: ref.current?.clientWidth ?? 0, height: ref.current?.clientHeight ?? 0 });
  const reset = useCallback(() => {
    view.current = { scale: 1, x: 0, y: 0 };
    points.current.clear();
    gesture.current = null;
    apply();
  }, [apply]);
  const zoomAt = useCallback(
    (pt: { x: number; y: number }, factor: number) => {
      view.current = pinchView(view.current, pt, pt, factor, box());
      apply();
    },
    [apply],
  );

  useImperativeHandle(handle, () => ({ reset, zoomBy: (f: number) => zoomAt({ x: 0, y: 0 }, f) }), [reset, zoomAt]);

  // The wheel is taken here: React listens passively, and zooming must not
  // scroll whatever sits behind.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const pt = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      // a trackpad pinch arrives as ctrl+wheel, and wants a firmer response
      const step = e.deltaMode === 1 ? 0.03 : e.ctrlKey ? 0.01 : 0.0018;
      zoomAt(pt, Math.exp(-e.deltaY * step));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const restart = () => {
    const list = [...points.current.values()];
    gesture.current = list.length ? { start: { ...view.current }, from: middle(list), spread: spread(list) } : null;
  };
  const lift = (e: { pointerId: number }) => {
    if (!points.current.delete(e.pointerId)) return;
    restart();
  };
  /** In at a point, or all the way back out if already in. */
  const toggle = (pt: { x: number; y: number }) => {
    if (view.current.scale > 1) reset();
    else {
      view.current = clampView({ scale: STEP, x: -pt.x * (STEP - 1), y: -pt.y * (STEP - 1) }, box());
      apply();
    }
  };

  return (
    <div
      ref={ref}
      className={className}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" && view.current.scale <= 1) return;
        points.current.set(e.pointerId, at(e));
        moved.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        restart();
      }}
      onPointerMove={(e) => {
        if (!points.current.has(e.pointerId)) return;
        const before = points.current.get(e.pointerId)!;
        const now = at(e);
        if (Math.hypot(now.x - before.x, now.y - before.y) > 2) moved.current = true;
        points.current.set(e.pointerId, now);
        const g = gesture.current;
        if (!g) return;
        const list = [...points.current.values()];
        const factor = list.length > 1 && g.spread > 0 ? spread(list) / g.spread : 1;
        view.current = pinchView(g.start, g.from, middle(list), factor, box());
        apply();
      }}
      onPointerUp={lift}
      onPointerCancel={lift}
      onDoubleClick={(e) => {
        e.stopPropagation();
        toggle(at(e));
      }}
      onClick={(e) => {
        // a drag that ended here is not a click on what is behind the picture
        if (moved.current) {
          moved.current = false;
          e.stopPropagation();
          return;
        }
        if (view.current.scale > 1) {
          e.stopPropagation();
          return;
        }
        const now = performance.now();
        if (e.detail === 0 && now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          e.stopPropagation();
          toggle(at(e));
          return;
        }
        lastTap.current = now;
        onIdleClick?.();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
