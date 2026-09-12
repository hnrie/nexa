import { Check, Minus, X } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { P, PERM_GROUPS, has, type PermName } from "@/lib/perms";
import s from "./PermissionGrid.module.css";

/** Which permissions a channel of this type exposes; categories show everything channel-scoped. */
export function permsForChannel(type: "text" | "voice" | "category" | undefined): PermName[] {
  const out: PermName[] = [];
  for (const g of PERM_GROUPS) {
    for (const it of g.items) {
      if (!it.channel) continue;
      if (!type || type === "category" || it.channel.includes(type)) out.push(it.name);
    }
  }
  return out;
}

/** On/off toggles for a role's server-wide permissions. */
export function RoleGrid({ value, onChange, editable, filter }: { value: bigint; onChange: (v: bigint) => void; editable: boolean; filter?: string }) {
  const q = (filter ?? "").trim().toLowerCase();
  return (
    <div className={s.grid}>
      {PERM_GROUPS.map((g) => {
        const items = g.items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.description.toLowerCase().includes(q));
        if (items.length === 0) return null;
        return (
          <section key={g.group} className={s.group}>
            <h4 className={s.groupHead}>{g.group}</h4>
            {items.map((it) => {
              const bit = P[it.name];
              return (
                <div key={it.name} className={s.row} data-perm={it.name}>
                  <Toggle checked={has(value, bit)} disabled={!editable} onChange={(on) => onChange(on ? value | bit : value & ~bit)} label={it.label} description={it.description} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

export type Tri = "allow" | "neutral" | "deny";

export function triOf(allow: bigint, deny: bigint, bit: bigint): Tri {
  if (has(allow, bit)) return "allow";
  if (has(deny, bit)) return "deny";
  return "neutral";
}

/** Allow / inherit / deny controls for a channel overwrite. */
export function OverwriteGrid({
  allow,
  deny,
  onChange,
  editable,
  channelType,
}: {
  allow: bigint;
  deny: bigint;
  onChange: (allow: bigint, deny: bigint) => void;
  editable: boolean;
  channelType: "text" | "voice" | "category" | undefined;
}) {
  const names = new Set(permsForChannel(channelType));
  const set = (bit: bigint, v: Tri) => {
    let a = allow & ~bit;
    let d = deny & ~bit;
    if (v === "allow") a |= bit;
    if (v === "deny") d |= bit;
    onChange(a, d);
  };
  return (
    <div className={s.grid}>
      {PERM_GROUPS.map((g) => {
        const items = g.items.filter((it) => names.has(it.name));
        if (items.length === 0) return null;
        return (
          <section key={g.group} className={s.group}>
            <h4 className={s.groupHead}>{g.group}</h4>
            {items.map((it) => {
              const bit = P[it.name];
              const cur = triOf(allow, deny, bit);
              return (
                <div key={it.name} className={s.row} data-perm={it.name}>
                  <div className={s.text}>
                    <span className={s.label}>{it.label}</span>
                    <span className={s.desc}>{it.description}</span>
                  </div>
                  <div className={s.tri} role="radiogroup" aria-label={it.label}>
                    <button type="button" className={s.triBtn} data-kind="deny" data-on={cur === "deny"} disabled={!editable} aria-label="Deny" aria-pressed={cur === "deny"} onClick={() => set(bit, "deny")}><X size={16} /></button>
                    <button type="button" className={s.triBtn} data-kind="neutral" data-on={cur === "neutral"} disabled={!editable} aria-label="Inherit" aria-pressed={cur === "neutral"} onClick={() => set(bit, "neutral")}><Minus size={16} /></button>
                    <button type="button" className={s.triBtn} data-kind="allow" data-on={cur === "allow"} disabled={!editable} aria-label="Allow" aria-pressed={cur === "allow"} onClick={() => set(bit, "allow")}><Check size={16} /></button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
