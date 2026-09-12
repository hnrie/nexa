import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUI } from "@/stores/ui";
import s from "./ContextMenu.module.css";

/** Renders the ui store's context menu; opened by any component via useUI.openContextMenu. */
export function ContextMenuHost() {
  const menu = useUI((st) => st.contextMenu);
  const close = useUI((st) => st.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

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
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menu, close]);

  if (!menu) return null;
  return createPortal(
    <div ref={ref} className={s.menu} style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }} role="menu">
      {menu.items.map((item) => (
        <div key={item.id}>
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
          {item.separatorAfter ? <div className={s.sep} /> : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
