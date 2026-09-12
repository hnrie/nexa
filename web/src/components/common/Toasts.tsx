import { useUI } from "@/stores/ui";
import s from "./Toasts.module.css";

export function Toasts() {
  const toasts = useUI((st) => st.toasts);
  const dismiss = useUI((st) => st.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className={s.stack} aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={[s.toast, s[t.kind]].join(" ")} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
