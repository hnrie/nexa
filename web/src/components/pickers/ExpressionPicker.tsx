import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { EmojiPicker, type EmojiPick } from "./EmojiPicker";
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

/** Tabbed popover above the composer (or anchored anywhere); closes on outside click or Escape. */
export function ExpressionPicker({ tab = "emoji", onEmoji, onClose, gifs, stickers, anchor = null }: Props) {
  const [active, setActive] = useState<PickerTab>(tab);
  const ref = useRef<HTMLDivElement>(null);
  const mobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
      </div>
      {active === "emoji" ? <EmojiPicker onPick={onEmoji} /> : active === "gif" ? gifs : stickers}
    </div>
  );
  return anchor ? createPortal(body, document.body) : body;
}
