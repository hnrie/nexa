import s from "./Spinner.module.css";

export function Spinner({ size = 32, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span className={s.spinner} role="status" aria-label={label} style={{ width: size, height: size }}>
      <i />
      <i />
      <i />
    </span>
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
