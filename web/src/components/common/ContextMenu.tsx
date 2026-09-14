import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePortalRoot } from "@/hooks/usePortalRoot";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import s from "./ContextMenu.module.css";

function SliderItem({ item }: { item: ContextMenuItem & { slider: NonNullable<ContextMenuItem["slider"]> } }) {
  const { min, max, step = 1, unit = "", onChange } = item.slider;
  const [value, setValue] = useState(item.slider.value);
  return (
    <div className={s.slider}>
      <div className={s.sliderHead}>
        <span>{item.label}</span>
        <span className={s.sliderValue}>{value}{unit}</span>
      </div>
      <input
        type="range"
        className={s.range}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={item.label}
        disabled={item.disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          setValue(next);
          onChange(next);
        }}
      />
    </div>
  );
}

/** Renders the ui store's context menu; opened by any component via useUI.openContextMenu. */
export function ContextMenuHost() {
  const menu = useUI((st) => st.contextMenu);
  const close = useUI((st) => st.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const portalRoot = usePortalRoot();

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const y = Math.min(menu.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      // the backdrop closes on its own click, so that the tap ends on it rather than on what it covered
      if (e.target === backdrop.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A phone's address bar and keyboard change the height as they come and
    // go; only a real change of width (turning the phone) moves things enough
    // to close the menu.
    const width = window.innerWidth;
    const onResize = () => {
      if (Math.abs(window.innerWidth - width) > 1) close();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  if (!menu) return null;
  return createPortal(
    <>
      {/* On a touch screen, tapping away closes the menu without also tapping whatever is behind it. */}
      <div
        ref={backdrop}
        className={s.backdrop}
        data-context-menu
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div ref={ref} className={s.menu} data-context-menu style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }} role="menu">
        {menu.items.map((item) => (
          <div key={item.id}>
            {item.slider ? (
              <SliderItem item={{ ...item, slider: item.slider }} />
            ) : (
              <button
                role="menuitem"
                className={[s.item, item.danger ? s.danger : ""].join(" ")}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect?.();
                }}
              >
                <span>{item.label}</span>
              </button>
            )}
            {item.separatorAfter ? <div className={s.sep} /> : null}
          </div>
        ))}
      </div>
    </>,
    portalRoot,
  );
}
