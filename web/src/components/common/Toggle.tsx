import s from "./Toggle.module.css";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: Props) {
  return (
    <label className={s.row} data-disabled={disabled}>
      {label !== undefined ? (
        <span className={s.text}>
          <span className={s.label}>{label}</span>
          {description ? <span className={s.desc}>{description}</span> : null}
        </span>
      ) : null}
      <span className={s.switch} data-on={checked}>
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span className={s.knob} />
      </span>
    </label>
  );
}
