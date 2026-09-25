import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { EmojiPicker, focusSearchOnOpen, type EmojiPick } from "./EmojiPicker";
import s from "./Picker.module.css";
import { useLayerPresence } from "@/components/chat/useLayerPresence";

import { t } from "@/i18n";
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

/** What Tab can reach inside the popover, for the trap. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  // drawn in place over the message box, it tells the back gesture itself (a portalled one is seen anyway)
  useLayerPresence(!anchor);
  const [active, setActive] = useState<PickerTab>(tab === "gif" && !gifs ? "emoji" : tab === "sticker" && !stickers ? "emoji" : tab);
  const ref = useRef<HTMLDivElement>(null);
  // Where focus came from. Escape used to drop it on `<body>` — and on touch
  // the composer is deliberately blurred first, so there was nothing focused
  // at all — which meant a keyboard user restarted tabbing from the top of the
  // document every time they closed the emoji picker.
  const opener = useRef<HTMLElement | null>(null);
  const mobile = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;
  useEffect(() => {
    // On a touch screen the keyboard of the field the picker was opened from
    // would cover the picker, so it goes down.
    const field = document.activeElement;
    opener.current = document.querySelector<HTMLElement>(TOGGLE) ?? (field instanceof HTMLElement ? field : null);
    if (!focusSearchOnOpen() && field instanceof HTMLElement && (field.matches("input, textarea") || field.isContentEditable) && !ref.current?.contains(field)) field.blur();
    return () => {
      const back = opener.current;
      opener.current = null;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, []);

  // Tab stays inside the popover while it is open, the way it does in a dialog.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const stops = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const at = document.activeElement;
    if (!ref.current.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };
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
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const strip = e.currentTarget.parentElement;
    const buttons = strip ? [...strip.querySelectorAll<HTMLElement>('[role="tab"]')] : [];
    const at = buttons.indexOf(e.currentTarget);
    buttons[Math.min(buttons.length - 1, Math.max(0, at + step))]?.click();
  };

  const body = (
    // a layer, so the back gesture on a phone closes the picker (through the Escape it answers) instead of leaving the page
    <div className={s.pop} ref={ref} role="dialog" aria-modal="true" aria-label={t("pickers.expressionPicker.expressionPicker")} onKeyDown={onKeyDown} style={anchor && !mobile ? anchoredStyle(anchor) : undefined} data-anchored={!!anchor} data-modal-layer="">
      {/* A tab with nothing behind it was rendered `disabled` forever with no
          reason given — two dead controls on the most-opened popover in the
          app, implying a feature that is not coming. Where the caller has no
          GIFs or stickers to offer, there is no tab. */}
      <div className={s.tabs}>
        {/* The close button is not a tab, so the tablist is only the tabs. */}
        <div style={{ display: "flex", gap: 4 }} role="tablist" aria-label={t("pickers.expressionPicker.expressionPicker")}>
        {gifs ? <button className={s.tab} role="tab" aria-selected={active === "gif"} tabIndex={active === "gif" ? 0 : -1} onKeyDown={onTabKey} data-selected={active === "gif"} onClick={() => setActive("gif")}>{t("pickers.expressionPicker.gifs")}</button> : null}
        {stickers ? <button className={s.tab} role="tab" aria-selected={active === "sticker"} tabIndex={active === "sticker" ? 0 : -1} onKeyDown={onTabKey} data-selected={active === "sticker"} onClick={() => setActive("sticker")}>{t("pickers.expressionPicker.stickers")}</button> : null}
        <button className={s.tab} role="tab" aria-selected={active === "emoji"} tabIndex={active === "emoji" ? 0 : -1} onKeyDown={onTabKey} data-selected={active === "emoji"} onClick={() => setActive("emoji")}>{t("modals.customStatus.emoji")}</button>
        </div>
        <button className={s.close} aria-label={t("pickers.expressionPicker.closePicker")} onClick={onClose}><X size={18} /></button>
      </div>
      {active === "emoji" ? <EmojiPicker onPick={onEmoji} serverId={serverId} /> : active === "gif" ? gifs : stickers}
    </div>
  );
  return anchor ? createPortal(body, document.body) : body;
}
