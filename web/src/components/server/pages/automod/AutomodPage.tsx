import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { automod as automodApi } from "@/api/automod";
import type { AutomodKind, AutomodRule } from "@/api/types";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { Toggle } from "@/components/common/Toggle";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { t } from "@/i18n";
import { P } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import { AutomodLog } from "./AutomodLog";
import { actionLabels, KINDS, kindInfo, ruleSummary } from "./kinds";
import { RuleEditor } from "./RuleEditor";
import s from "./Automod.module.css";

type View = { kind: "list" } | { kind: "pick" } | { kind: "edit"; rule: AutomodRule | null; ruleKind: AutomodKind };

function RuleRow({ rule, count, onOpen, onToggle }: { rule: AutomodRule; count: number; onOpen: () => void; onToggle: (on: boolean) => void }) {
  const channels = useChannels((c) => c.byId);
  const info = kindInfo(rule.kind);
  const Icon = info?.icon;
  const does = actionLabels(rule.actions, (id) => `#${channels[id]?.name ?? "?"}`);
  return (
    <div className={s.rule} data-off={!rule.enabled || undefined} data-testid="automod-rule">
      <span className={s.ruleIcon} data-server={info?.server || undefined} aria-hidden="true">{Icon ? <Icon size={20} /> : null}</span>
      <button type="button" className={s.ruleMain} onClick={onOpen}>
        <span className={s.ruleName} dir="auto">{rule.name}</span>
        <span className={s.ruleSummary}>{ruleSummary(rule)}</span>
        <span className={s.does}>
          {rule.actions.map((a, i) => (
            <span key={a.type} className={s.doChip} data-kind={a.type}>{does[i]}</span>
          ))}
        </span>
      </button>
      <span className={s.ruleCount} title={t("automod.page.weekCountLong", { count })}>
        <b>{count}</b>
        {t("automod.page.thisWeek")}
      </span>
      <Toggle checked={rule.enabled} onChange={onToggle} ariaLabel={rule.enabled ? t("automod.page.turnOff", { name: rule.name }) : t("automod.page.turnOn", { name: rule.name })} />
    </div>
  );
}

/**
 * AutoMod: the rules a server's members' apps apply to messages as they are
 * written (messages are end-to-end encrypted, so nobody else can read them)
 * and the ones the server applies to pings, floods, names and titles, with
 * what each did this week; and the log of what AutoMod did.
 */
export default function AutomodPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const toast = useUI((u) => u.toast);
  const mayEdit = canI(server, P.MANAGE_SERVER);
  const [tab, setTab] = useState<"rules" | "log">(mayEdit ? "rules" : "log");
  const [rules, setRules] = useState<AutomodRule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>({ kind: "list" });

  const load = useCallback(async () => {
    if (!mayEdit) return;
    setFailed(false);
    try {
      const [list, stats] = await Promise.all([automodApi.rules(serverId), automodApi.stats(serverId).catch(() => null)]);
      setRules(list);
      if (stats) setCounts(Object.fromEntries(stats.rules.filter((r) => r.rule_id).map((r) => [r.rule_id!, r.count])));
    } catch {
      setFailed(true);
    }
  }, [serverId, mayEdit]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const hook = (e: GatewayEvent) => {
      if (e.t === "automod_rules_update" && e.d.server_id === serverId) void load();
      if (e.t === "automod_event" && e.d.server_id === serverId && e.d.rule_id) {
        const id = e.d.rule_id;
        setCounts((cur) => ({ ...cur, [id]: (cur[id] ?? 0) + 1 }));
      }
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId, load]);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const toggle = async (rule: AutomodRule, on: boolean) => {
    setRules((cur) => cur?.map((r) => (r.id === rule.id ? { ...r, enabled: on } : r)) ?? null);
    try {
      await automodApi.update(serverId, rule.id, { enabled: on });
    } catch (err) {
      setRules((cur) => cur?.map((r) => (r.id === rule.id ? { ...r, enabled: !on } : r)) ?? null);
      toast(err instanceof ApiError ? err.message : t("automod.editor.saveFailed"), "error");
    }
  };

  if (view.kind === "edit") {
    return (
      <RuleEditor
        serverId={serverId}
        rule={view.rule}
        kind={view.ruleKind}
        onDone={() => {
          setView({ kind: "list" });
          void load();
        }}
      />
    );
  }

  return (
    <>
      <h2 className={st.title}>{t("automod.title")}</h2>
      <p className={s.intro}>{t("automod.page.intro")}</p>
      {mayEdit ? (
        <div className={s.tabs} role="tablist" aria-label={t("automod.title")}>
          <button type="button" role="tab" className={s.tab} aria-selected={tab === "rules"} onClick={() => setTab("rules")}>{t("automod.page.rules")}</button>
          <button type="button" role="tab" className={s.tab} aria-selected={tab === "log"} onClick={() => setTab("log")} data-testid="automod-log-tab">{t("automod.page.log")}</button>
        </div>
      ) : null}
      {tab === "log" ? (
        <AutomodLog serverId={serverId} />
      ) : view.kind === "pick" ? (
        <KindPicker
          existing={rules ?? []}
          onPick={(k) => setView({ kind: "edit", rule: null, ruleKind: k })}
          onCancel={() => setView({ kind: "list" })}
        />
      ) : (
        <>
          {failed ? <LoadError message={t("automod.page.failed")} onRetry={() => void load()} /> : null}
          {rules === null && !failed ? <Spinner label={t("chat.pins.loading")} /> : null}
          {rules && rules.length > 0 ? (
            <>
              <div className={s.week}>
                <span className={s.weekNum}>{total}</span>
                <span>{t("automod.page.weekTotal", { count: total })}</span>
              </div>
              <div className={s.rules}>
                {rules.map((r) => (
                  <RuleRow key={r.id} rule={r} count={counts[r.id] ?? 0} onOpen={() => setView({ kind: "edit", rule: r, ruleKind: r.kind })} onToggle={(on) => void toggle(r, on)} />
                ))}
              </div>
            </>
          ) : null}
          {rules && rules.length === 0 ? (
            <div className={[s.rules, s.empty].join(" ")}>
              <h3>{t("automod.page.none")}</h3>
              <p>{t("automod.page.noneHint")}</p>
            </div>
          ) : null}
          {rules ? (
            <div className={s.addRow}>
              <Button onClick={() => setView({ kind: "pick" })} data-testid="automod-add">
                <Plus size={16} aria-hidden="true" /> {t("automod.page.add")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/** What a new rule can look for: read in members' apps, or by the server itself. */
function KindPicker({ existing, onPick, onCancel }: { existing: AutomodRule[]; onPick: (k: AutomodKind) => void; onCancel: () => void }) {
  const groups = [
    { head: t("automod.page.appKinds"), kinds: KINDS.filter((k) => !k.server) },
    { head: t("automod.page.serverKinds"), kinds: KINDS.filter((k) => k.server) },
  ];
  return (
    <>
      {groups.map((g) => (
        <div key={g.head}>
          <h3 className={s.kindGroup}>{g.head}</h3>
          <div className={s.kinds}>
            {g.kinds.map(({ kind, icon: Icon, server }) => {
              const has = existing.filter((r) => r.kind === kind).length;
              return (
                <button key={kind} type="button" className={s.kind} onClick={() => onPick(kind)} data-testid={`automod-kind-${kind}`}>
                  <span className={s.ruleIcon} data-server={server || undefined} aria-hidden="true"><Icon size={20} /></span>
                  <span className={s.kindText}>
                    <span className={s.kindName}>{t(`automod.kind.${kind}`)}</span>
                    <span className={s.kindDesc}>{t(`automod.kindDesc.${kind}`)}</span>
                    {has ? <span className={s.kindDesc}>{t("automod.page.alreadyHave", { count: has })}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className={s.addRow}>
        <Button variant="ghost" onClick={onCancel}>{t("chat.editMessage.cancel")}</Button>
      </div>
    </>
  );
}
