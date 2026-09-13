import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { EmojiPicker, focusSearchOnOpen, type EmojiPick } from "./EmojiPicker";
import s from "./Picker.module.css";

export type PickerTab = "emoji" | "gif" | "sticker";

interface Props {
  tab?: PickerTab;
  onEmoji: (e: EmojiPick) => void;
  onClose: () => void;
  gifs?: React.ReactNode;
  stickers?: React.ReactNode;
  /** When given, the picker is portalled to the body and placed next to this rect. */
  anchor?: DOMRect | null;
  /** The server whose custom emoji lead the list. */
  serverId?: string | null | undefined;
}

const W = 498;
const H = 498;

function anchoredStyle(a: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(W, vw - 16);
  const h = Math.min(H, Math.floor(vh * 0.7));
  const above = a.top - h - 8;
  const top = above >= 8 ? above : Math.min(vh - h - 8, a.bottom + 8);
  const left = Math.max(8, Math.min(a.right - w, vw - w - 8));
  return { position: "fixed", left, top, width: w, height: h, right: "auto", bottom: "auto" };
}

/** Context menus and dialogs, which live outside the picker in the page. */
const OVER = "[data-context-menu], [data-modal-overlay]";

/** The button that opened the picker, which closes it again with its own click (it carries this only while its picker is open). */
const TOGGLE = "[data-picker-toggle]";

/**
 * Whether el was opened over the picker, from inside it (a GIF's menu, the
 * question before removing a pack): it comes later in the page. One the
 * picker itself was opened from comes earlier, and a click on it still
 * closes the picker.
 */
function openedOver(picker: HTMLElement, el: Element | null): boolean {
  return !!el && !!(picker.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Tabbed popover above the composer (or anchored anywhere); closes on outside click or Escape. */
export function ExpressionPicker({ tab = "emoji", onEmoji, onClose, gifs, stickers, anchor = null, serverId }: Props) {
  const [active, setActive] = useState<PickerTab>(tab);
  const ref = useRef<HTMLDivElement>(null);
  const mobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
  useEffect(() => {
    // On a touch screen the keyboard of the field the picker was opened from
    // would cover the picker, so it goes down.
    const field = document.activeElement;
    if (!focusSearchOnOpen() && field instanceof HTMLElement && (field.matches("input, textarea") || field.isContentEditable) && !ref.current?.contains(field)) field.blur();
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      if (e.target instanceof Element && openedOver(ref.current, e.target.closest(OVER))) return;
      // closing here would let the button's click open the picker again
      if (e.target instanceof Element && e.target.closest(TOGGLE)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape closes whatever is on top first: a menu or a dialog opened from the picker
      if (e.key === "Escape" && ref.current && !Array.from(document.querySelectorAll(OVER)).some((el) => openedOver(ref.current!, el))) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  const body = (
    <div className={s.pop} ref={ref} role="dialog" aria-label="Expression picker" style={anchor && !mobile ? anchoredStyle(anchor) : undefined} data-anchored={!!anchor}>
      <div className={s.tabs}>
        <button className={s.tab} data-selected={active === "gif"} disabled={!gifs} onClick={() => setActive("gif")}>GIFs</button>
        <button className={s.tab} data-selected={active === "sticker"} disabled={!stickers} onClick={() => setActive("sticker")}>Stickers</button>
        <button className={s.tab} data-selected={active === "emoji"} onClick={() => setActive("emoji")}>Emoji</button>
        <button className={s.close} aria-label="Close picker" onClick={onClose}><X size={18} /></button>
      </div>
      {active === "emoji" ? <EmojiPicker onPick={onEmoji} serverId={serverId} /> : active === "gif" ? gifs : stickers}
    </div>
  );
  return anchor ? createPortal(body, document.body) : body;
}
