import { createPortal } from "react-dom";
import { usePortalRoot } from "@/hooks/usePortalRoot";
import { useUI } from "@/stores/ui";
import s from "./Toasts.module.css";

export function Toasts() {
  const toasts = useUI((st) => st.toasts);
  const dismiss = useUI((st) => st.dismissToast);
  const root = usePortalRoot();
  if (toasts.length === 0) return null;
  // mounted on the body, or inside whatever is full screen, where nothing else would show
  return createPortal(
    <div className={s.stack} aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={[s.toast, s[t.kind]].join(" ")} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>,
    root,
  );
}
