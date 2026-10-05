import { useId } from "react";
import s from "./Toggle.module.css";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Names a switch that has no visible label. */
  ariaLabel?: string;
  /** Which setting this is, for Settings' search to find and point at. */
  setting?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, ariaLabel, setting }: Props) {
  const descId = useId();
  return (
    // a switch on its own sits in someone else's row, without the padding and rule of a settings row
    <label className={s.row} data-disabled={disabled} data-setting={setting} data-bare={label === undefined || undefined}>
      {label !== undefined ? (
        <span className={s.text}>
          <span className={s.label}>{label}</span>
          {description ? <span className={s.desc} id={descId}>{description}</span> : null}
        </span>
      ) : null}
      <span className={s.switch} data-on={checked}>
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label || ariaLabel} aria-describedby={label !== undefined && description ? descId : undefined} />
        <span className={s.knob} />
      </span>
    </label>
  );
}
