import s from "./Spinner.module.css";
import { t } from "@/i18n";

export function Spinner({ size = 32, label = t("chat.pins.loading") }: { size?: number; label?: string }) {
  return (
    <span className={s.spinner} role="status" aria-label={label} style={{ width: size, height: size }}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * FullScreenSpinner for one pane of the app: it fills the space the page
 * would, and leaves the server rail and the sidebars usable while a link is
 * opening — covering them made a slow link look like a frozen app.
 */
export function PaneSpinner({ text }: { text?: string }) {
  return (
    <div className={s.pane}>
      <Spinner size={40} />
      {text ? <p className={s.text}>{text}</p> : null}
    </div>
  );
}

export function FullScreenSpinner({ text }: { text?: string }) {
  return (
    <div className={s.full}>
      <Spinner size={40} />
      {text ? <p className={s.text}>{text}</p> : null}
    </div>
  );
}
