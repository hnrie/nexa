import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import s from "./Modal.module.css";

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

export function Modal({ open, onClose, title, children, footer, width = 440, closeOnOverlay = true, className, bare = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopLayer(ref.current)) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={[s.card, bare ? s.bare : "", className ?? ""].join(" ")} style={{ width }} role="dialog" aria-modal="true" tabIndex={-1} data-modal-layer="">
        {!bare && title !== undefined ? (
          <div className={s.header}>
            <h2 className={s.title}>{title}</h2>
            <button className={s.close} onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        ) : null}
        <div className={bare ? s.bareBody : s.body}>{children}</div>
        {footer ? <div className={s.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
