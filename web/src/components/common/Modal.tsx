import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePortalRoot } from "@/hooks/usePortalRoot";
import s from "./Modal.module.css";

import { t } from "@/i18n";
/** Only the most recently opened dialog reacts to Escape; portals mount in order, so the last in the DOM is on top. */
export function isTopLayer(el: HTMLElement | null): boolean {
  if (!el) return false;
  const layers = document.querySelectorAll("[data-modal-layer]");
  return layers[layers.length - 1] === el;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeOnOverlay?: boolean;
  className?: string;
  bare?: boolean;
}

/** What Tab can reach, for the trap below. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, width = 440, closeOnOverlay = true, className, bare = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const portalRoot = usePortalRoot();
  // This dialog's own container, kept for its whole life and moved between the
  // body and the fullscreen element rather than swapped. Handing createPortal a
  // different container makes React unmount and rebuild everything inside it,
  // so a name half typed into the dialog vanished when the stream behind it
  // left full screen.
  const [host] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.display = "contents";
    return el;
  });
  useLayoutEffect(() => {
    if (!host || !open) return;
    portalRoot.append(host);
    return () => host.remove();
  }, [host, portalRoot, open]);
  // Held in a ref so a caller passing a fresh function on every render does
  // not re-run the effect below: that put the caret back on the dialog after
  // every keystroke, so a field could only ever take one character.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(ref.current)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      // aria-modal says the rest of the page is out of reach, and clicks are
      // blocked by the overlay, but Tab walked straight through it into the
      // channel list behind, where Enter navigated away with the dialog still up
      if (e.key !== "Tab") return;
      const card = ref.current;
      if (!card) return;
      const stops = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!card.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    // start in the first field, so a dialog that asks for something is ready
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled])");
    (first ?? ref.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open || !host) return null;
  return createPortal(
    <div className={s.overlay} data-modal-overlay="" onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={[s.card, bare ? s.bare : "", className ?? ""].join(" ")} style={{ width }} role="dialog" aria-modal="true" tabIndex={-1} data-modal-layer="">
        {!bare && title !== undefined ? (
          <div className={s.header}>
            <h2 className={s.title}>{title}</h2>
            <button className={s.close} onClick={onClose} aria-label={t("chat.attachments.close")}>
              <X size={20} />
            </button>
          </div>
        ) : null}
        <div className={bare ? s.bareBody : s.body}>{children}</div>
        {footer ? <div className={s.footer}>{footer}</div> : null}
      </div>
    </div>,
    host,
  );
}
