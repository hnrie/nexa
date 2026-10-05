import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { automod as automodApi } from "@/api/automod";
import type { AutomodEvent } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { t } from "@/i18n";
import { openCaught } from "@/lib/automod/rules";
import { formatFull, formatTimestamp } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { displayName, useUsers } from "@/stores/users";
import { kindInfo } from "./kinds";
import s from "./Automod.module.css";

const ACTION_KEYS: Record<string, string> = { block: "automod.action.blocked", timeout: "automod.action.timedOut", quarantine: "automod.action.held", alert: "automod.action.alerted" };

/** One time a rule acted: who, where, what they wrote (opened here), and what came of it. */
function EventRow({ serverId, ev, onPerson }: { serverId: string; ev: AutomodEvent; onPerson: (id: string) => void }) {
  const user = useUsers((u) => u.byId[ev.user_id]);
  const where = useChannels((c) => (ev.channel_id ? c.byId[ev.channel_id] : undefined));
  const [words, setWords] = useState<string | null | undefined>(ev.content ? undefined : null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ev.content) return;
    let alive = true;
    void openCaught(serverId, ev.user_id, ev.content).then((w) => alive && setWords(w));
    return () => {
      alive = false;
    };
  }, [serverId, ev]);
  const name = user ? displayName(user) : t("chat.systemMessage.someone");
  const Icon = kindInfo(ev.rule_kind)?.icon;
  return (
    <article className={s.event} data-testid="automod-event">
      <span className={s.eventWho}><Avatar id={ev.user_id} avatarId={user?.avatar_id ?? null} name={name} size={36} /></span>
      <div className={s.eventHead}>
        <button type="button" className={s.eventName} onClick={() => onPerson(ev.user_id)} dir="auto">{name}</button>
        <span className={s.eventMeta} title={formatFull(ev.created_at)}>{formatTimestamp(ev.created_at)}</span>
      </div>
      <div className={s.eventHead}>
        <span className={s.doChip}>
          {Icon ? <Icon size={12} aria-hidden="true" style={{ marginInlineEnd: 4, verticalAlign: -1 }} /> : null}
          {ev.rule_name || t("automod.log.goneRule")}
        </span>
        {where ? <span className={s.eventMeta}>{t("automod.log.in", { channel: where.name })}</span> : null}
        {ev.actions.map((a) => (
          <span key={a} className={s.doChip} data-kind={a}>{ACTION_KEYS[a] ? t(ACTION_KEYS[a]!) : a}</span>
        ))}
        {ev.reporter_id ? <span className={s.eventMeta}>{t("automod.log.caughtLate")}</span> : null}
      </div>
      {words ? (
        <>
          <p className={s.eventWords} data-open={open || undefined} dir="auto">{words}</p>
          {words.length > 240 && !open ? <button type="button" className={s.eventMeta} onClick={() => setOpen(true)}>{t("automod.alert.showAll")}</button> : null}
        </>
      ) : words === undefined ? (
        <span className={s.eventMeta}>{t("automod.alert.opening")}</span>
      ) : ev.content ? (
        <span className={s.eventMeta}>{t("automod.alert.cannotOpen")}</span>
      ) : null}
    </article>
  );
}

/** What AutoMod did, newest first, for one person when picked. Opened sealed with the server's key. */
export function AutomodLog({ serverId }: { serverId: string }) {
  const [events, setEvents] = useState<AutomodEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const person_ = useUsers((u) => (person ? u.byId[person] : undefined));
  const load = useCallback(
    async (before?: string) => {
      setFailed(false);
      try {
        const res = await automodApi.events(serverId, { limit: 50, ...(before ? { before } : {}), ...(person ? { user_id: person } : {}) });
        useUsers.getState().upsert(res.users);
        setEvents((cur) => (before && cur ? [...cur, ...res.events] : res.events));
        setMore(res.events.length === 50);
      } catch {
        setFailed(true);
      }
    },
    [serverId, person],
  );
  useEffect(() => {
    setEvents(null);
    void load();
  }, [load]);
  // what AutoMod does while the log is open comes in at the top
  useEffect(() => {
    const hook = (e: GatewayEvent) => {
      if (e.t !== "automod_event" || e.d.server_id !== serverId) return;
      if (person && e.d.user_id !== person) return;
      setEvents((cur) => (cur && !cur.some((x) => x.id === e.d.id) ? [e.d, ...cur] : cur));
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId, person]);
  return (
    <>
      {person ? (
        <div className={s.logFilter}>
          <span>{t("automod.log.onlyFor", { name: person_ ? displayName(person_) : "" })}</span>
          <button type="button" className={s.pick} onClick={() => setPerson(null)}>
            {t("automod.log.everyone")} <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {failed ? <LoadError message={t("automod.log.failed")} onRetry={() => void load()} /> : null}
      {events === null && !failed ? <Spinner label={t("chat.pins.loading")} /> : null}
      {events && events.length === 0 ? (
        <div className={s.empty}>
          <h3>{t("automod.log.empty")}</h3>
          <p>{t("automod.log.emptyHint")}</p>
        </div>
      ) : null}
      {events?.length ? (
        <div className={s.events}>
          {events.map((ev) => <EventRow key={ev.id} serverId={serverId} ev={ev} onPerson={setPerson} />)}
        </div>
      ) : null}
      {more ? (
        <div className={s.addRow}>
          <button type="button" className={s.pick} onClick={() => void load(events?.[events.length - 1]?.id)}>{t("automod.log.more")}</button>
        </div>
      ) : null}
    </>
  );
}
