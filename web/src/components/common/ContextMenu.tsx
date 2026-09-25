import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePortalRoot } from "@/hooks/usePortalRoot";
import { useUI, type ContextMenuItem, type ContextMenuState } from "@/stores/ui";
import s from "./ContextMenu.module.css";

function SliderItem({ item }: { item: ContextMenuItem & { slider: NonNullable<ContextMenuItem["slider"]> } }) {
  const { min, max, step = 1, unit = "", onChange } = item.slider;
  const [value, setValue] = useState(item.slider.value);
  return (
    <div className={s.slider} role="group" aria-label={item.label}>
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
        data-menu-stop=""
        tabIndex={-1}
        onChange={(e) => {
          const next = Number(e.target.value);
          setValue(next);
          onChange(next);
        }}
      />
    </div>
  );
}

/**
 * The items, cut into groups at the headings.
 *
 * A heading is not an item — it is a title over the ones that follow — and the
 * only way to say that in ARIA is a `group` with a name. Everything before the
 * first heading is one unnamed group, which is what a menu with no headings is.
 */
function groups(items: ContextMenuItem[]): { label: string | null; items: ContextMenuItem[] }[] {
  const out: { label: string | null; items: ContextMenuItem[] }[] = [];
  for (const item of items) {
    if (item.heading) {
      out.push({ label: item.label, items: [] });
      continue;
    }
    if (out.length === 0) out.push({ label: null, items: [] });
    out[out.length - 1]!.items.push(item);
  }
  return out;
}

/** Where a menu opened from a button goes: by that button, lined up with its start or end edge. */
export function menuAnchor(el: Element, align: "start" | "end" = "end"): NonNullable<ContextMenuState["anchor"]> {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, align };
}

/** Renders the ui store's context menu; opened by any component via useUI.openContextMenu. */
export function ContextMenuHost() {
  const menu = useUI((st) => st.contextMenu);
  const close = useUI((st) => st.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const portalRoot = usePortalRoot();
  // What the menu was opened from. A menu portals to the body, so without this
  // choosing an item left focus at the very end of the document.
  const opener = useRef<HTMLElement | null>(null);
  // Letters typed in a row: "de" goes to Delete rather than to Deafen and then
  // to Edit. Cleared after a pause, as every other menu in every OS does.
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const a = menu.anchor;
    if (a) {
      // Lined up with the button it came from, measured rather than guessed:
      // the menu is as wide as its longest label in the language in use.
      const rightAligned = (a.align === "end") !== rtl;
      const x = rightAligned ? a.right - r.width : a.left;
      const below = a.bottom + 4;
      const over = a.top - r.height - 4;
      const fitsBelow = below + r.height <= window.innerHeight - 8;
      const fitsOver = over >= 8;
      // `above` says which side is wanted; the other one is taken when that one has no room
      const y = menu.above ? (fitsOver || !fitsBelow ? over : below) : fitsBelow || !fitsOver ? below : over;
      setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
      return;
    }
    // Towards the reading direction's end: in a right-to-left language a menu
    // opens to the left of where it was asked for, as the system's own do.
    const from = rtl ? menu.x - r.width : menu.x;
    const x = Math.min(from, window.innerWidth - r.width - 8);
    const y = Math.min(menu.above ? menu.y - r.height : menu.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  /** Everything the arrows can land on, in the order it is drawn. */
  const stops = useCallback((): HTMLElement[] => {
    const el = ref.current;
    if (!el) return [];
    return [...el.querySelectorAll<HTMLElement>("[data-menu-stop]")].filter((x) => !(x as HTMLButtonElement).disabled);
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      const list = stops();
      if (list.length === 0) return;
      const at = ((index % list.length) + list.length) % list.length;
      for (const x of list) x.tabIndex = -1;
      const target = list[at]!;
      target.tabIndex = 0;
      target.focus({ preventScroll: true });
    },
    [stops],
  );

  // Focus goes into the menu as it opens and comes back to the opener as it
  // closes, which is the difference between a menu you can use with a keyboard
  // and a menu a keyboard can only ever open.
  useEffect(() => {
    if (!menu) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Not this frame: the menu is drawn `visibility: hidden` until the layout
    // effect above has measured it and nudged it on screen, and focus() on a
    // hidden element does nothing at all. One frame later it is visible.
    const frame = requestAnimationFrame(() => stops()[0]?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      const back = opener.current;
      opener.current = null;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [menu, stops]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      // the backdrop closes on its own click, so that the tap ends on it rather than on what it covered
      if (e.target === backdrop.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) close();
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
    // Escape belongs to the menu while it is open, and to nothing else. The
    // dialog underneath keeps its own listener on `document`, and
    // `stopPropagation` does not suppress a sibling listener on the same node —
    // that needs `stopImmediatePropagation`, taken in the capture phase before
    // anyone else has seen the key. Right-clicking inside settings and pressing
    // Escape used to dismiss the menu *and* the whole settings dialog behind
    // it, unsaved edits and all.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  if (!menu) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = stops();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const onRange = document.activeElement instanceof HTMLInputElement && document.activeElement.type === "range";
    if (e.key === "Tab") {
      // A menu is not part of the tab order: Tab dismisses it and puts focus
      // back where it came from, so the next Tab carries on from there.
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "ArrowRight" && !onRange)) {
      e.preventDefault();
      moveTo(at < 0 ? 0 : at + 1);
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "ArrowLeft" && !onRange)) {
      e.preventDefault();
      moveTo(at < 0 ? list.length - 1 : at - 1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      moveTo(list.length - 1);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !onRange) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const want = typed.current.text;
      const from = at < 0 ? 0 : want.length === 1 ? at + 1 : at;
      for (let i = 0; i < list.length; i++) {
        const cand = list[(from + i) % list.length]!;
        if ((cand.textContent ?? "").trim().toLowerCase().startsWith(want)) {
          e.preventDefault();
          moveTo((from + i) % list.length);
          return;
        }
      }
    }
  };

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
      <div
        ref={ref}
        className={s.menu}
        data-context-menu
        data-modal-layer=""
        style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }}
        role="menu"
        aria-label={menu.label}
        onKeyDown={onKeyDown}
      >
        {groups(menu.items).map((g, gi) => (
          <div key={gi} role={g.label ? "group" : "none"} {...(g.label ? { "aria-label": g.label } : {})}>
            {g.label ? <div className={s.heading} aria-hidden="true">{g.label}</div> : null}
            {g.items.map((item) => (
              <div key={item.id} role="none">
                {item.slider ? (
                  <SliderItem item={{ ...item, slider: item.slider }} />
                ) : item.note ? (
                  // read, not chosen, so no stop for the arrows; whoever opens a menu
                  // with a note in it says the same thing in the menu's own name
                  <div className={s.note} aria-hidden="true">{item.label}</div>
                ) : (
                  <button
                    role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                    aria-checked={item.checked}
                    className={[s.item, item.danger ? s.danger : ""].join(" ")}
                    disabled={item.disabled}
                    data-menu-stop=""
                    tabIndex={-1}
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    <span className={s.itemLabel}>{item.label}</span>
                    {item.checked === undefined ? null : <span className={s.radio} data-on={item.checked} aria-hidden="true" />}
                  </button>
                )}
                {item.separatorAfter ? <div className={s.sep} role="separator" /> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>,
    portalRoot,
  );
}
