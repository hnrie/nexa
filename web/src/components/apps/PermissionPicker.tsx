import { Check } from "lucide-react";
import { P, permGroups } from "@/lib/perms";
import s from "./PermissionPicker.module.css";

/**
 * Permissions as ticks, in the role editor's groups: the ones an app's bot is
 * given when it is added. With `only`, just those are listed (what an app
 * asks for, on the consent page, where each can be taken away); without, every
 * permission is, for building an app's install link.
 */
export function PermissionPicker({ value, onChange, only, columns = 2 }: { value: bigint; onChange: (v: bigint) => void; only?: bigint; columns?: 1 | 2 }) {
  const admin = (value & P.ADMINISTRATOR) !== 0n;
  const groups = permGroups()
    .map((g) => ({ ...g, items: g.items.filter((it) => only === undefined || (only & P[it.name]) !== 0n) }))
    .filter((g) => g.items.length);
  return (
    <div className={s.picker} data-columns={columns}>
      {groups.map((g) => (
        <fieldset key={g.group} className={s.group}>
          <legend className={s.head}>{g.group}</legend>
          <div className={s.items}>
            {g.items.map((it) => {
              const bit = P[it.name];
              const on = (value & bit) !== 0n;
              // under Administrator every other permission is had anyway
              const implied = admin && it.name !== "ADMINISTRATOR";
              return (
                <label key={it.name} className={s.item} data-on={on || implied || undefined} data-implied={implied || undefined} title={it.description}>
                  <input type="checkbox" checked={on || implied} disabled={implied} onChange={() => onChange(on ? value & ~bit : value | bit)} />
                  <span className={s.box} aria-hidden="true">{on || implied ? <Check size={13} strokeWidth={3} /> : null}</span>
                  <span className={s.label}>{it.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
