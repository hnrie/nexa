import { Toggle } from "@/components/common/Toggle";
import { t } from "@/i18n";
import { DANGEROUS_PERMISSIONS, inOrder, permissionWords, type PermissionName } from "@/lib/look/plugins/permissions";
import s from "./Look.module.css";

/** What a permission touches, which is how they are grouped wherever they are listed. */
type Area = "people" | "dms" | "servers" | "app" | "everything";

function areaOf(p: PermissionName): Area {
  if (p === "stores") return "everything";
  if (p.startsWith("users.")) return "people";
  if (p.startsWith("directmessages.")) return "dms";
  if (p.startsWith("servers.")) return "servers";
  return "app";
}

const AREAS: { area: Area; name: () => string }[] = [
  { area: "people", name: () => t("look.plugins.group.people") },
  { area: "dms", name: () => t("look.plugins.group.dms") },
  { area: "servers", name: () => t("look.plugins.group.servers") },
  { area: "app", name: () => t("look.plugins.group.app") },
  { area: "everything", name: () => t("look.plugins.group.everything") },
];

/**
 * A plugin's permissions, grouped by what they touch, each by its name and
 * what it lets the plugin do. The dangerous one is set apart with a rule in
 * the danger colour, and permissions new code asks for with one in the
 * warning colour. With `switches`, each has a switch that gives or takes it.
 */
export function PermissionLedger({ permissions, fresh, switches, testId }: { permissions: Iterable<string>; fresh?: ReadonlySet<string>; switches?: { granted: ReadonlySet<string>; onChange: (p: PermissionName, on: boolean) => void; plugin: string }; testId?: string }) {
  const list = inOrder(permissions);
  return (
    <div className={s.ledger} data-testid={testId}>
      {AREAS.map(({ area, name }) => {
        const here = list.filter((p) => areaOf(p) === area);
        if (!here.length) return null;
        return (
          <section key={area} className={s.ledgerGroup} aria-label={name()}>
            <h4 className={s.ledgerGroupName}>{name()}</h4>
            <ul className={s.ledgerRows}>
              {here.map((p) => {
                const words = permissionWords(p);
                const danger = DANGEROUS_PERMISSIONS.includes(p);
                const isNew = !!fresh?.has(p);
                return (
                  <li key={p} className={s.ledgerRow} data-tone={danger ? "danger" : isNew ? "new" : undefined} data-permission={p}>
                    <div className={s.ledgerText}>
                      <span className={s.ledgerName}>
                        {words.name}
                        {danger ? <span className={s.ledgerTag} data-tone="danger">{t("look.plugins.dangerous")}</span> : null}
                        {isNew ? <span className={s.ledgerTag} data-tone="new">{t("look.plugins.newPerm")}</span> : null}
                      </span>
                      <span className={s.ledgerHint}>{words.hint}</span>
                    </div>
                    {switches ? (
                      <div className={s.ledgerSwitch}>
                        <Toggle checked={switches.granted.has(p)} onChange={(on) => switches.onChange(p, on)} ariaLabel={t("look.plugins.permOf", { permission: words.name, name: switches.plugin })} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
