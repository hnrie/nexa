import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/common/Avatar";
import { ChannelGlyph } from "@/components/common/ChannelGlyph";
import { t, Tr } from "@/i18n";
import { openCaught } from "@/lib/automod/rules";
import type { DecryptedMessage } from "@/lib/decrypt";
import { P } from "@/lib/perms";
import { formatFull, formatTimestamp } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { openProfilePopout } from "@/stores/profilePopout";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Chat.module.css";

/** What an action AutoMod took is called on its alert. */
function actionLabel(a: string): string | null {
  switch (a) {
    case "block":
      return t("automod.action.blocked");
    case "timeout":
      return t("automod.action.timedOut");
    case "quarantine":
      return t("automod.action.held");
    default:
      return null;
  }
}

/**
 * AutoMod's alert in the channel a rule sends them to: who it caught, where,
 * what they wrote (sealed with the server's key, opened here) or what the
 * server saw, what the rule did, and what a moderator can do next.
 */
export function AutomodAlert({ msg }: { msg: DecryptedMessage }) {
  const note = msg.automod;
  const nav = useNavigate();
  const serverId = useChannels((c) => c.byId[msg.channel_id]?.server_id ?? null);
  const where = useChannels((c) => (note?.channel_id ? c.byId[note.channel_id] : undefined));
  const st = useServers((x) => (serverId ? x.byId[serverId] : undefined));
  const user = useUsers((u) => u.byId[msg.author_id]);
  const [caught, setCaught] = useState<string | null | undefined>(note?.content ? undefined : null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!note?.content || !serverId) return;
    let alive = true;
    void openCaught(serverId, msg.author_id, note.content).then((text) => {
      if (alive) setCaught(text);
    });
    return () => {
      alive = false;
    };
  }, [note?.content, serverId, msg.author_id]);
  if (!note) return null;
  const name = user ? displayName(user) : t("chat.systemMessage.someone");
  const who = (
    <button type="button" className={s.sysName} dir="auto" onClick={(e) => openProfilePopout(msg.author_id, e.currentTarget, serverId ?? undefined)}>
      {name}
    </button>
  );
  const chan = where ? (
    <button type="button" className={s.amChannel} onClick={() => serverId && nav(`/channels/${serverId}/${where.id}`)}>
      <ChannelGlyph channel={where} size={14} />
      <span dir="auto">{where.name}</span>
    </button>
  ) : null;
  let detail: React.ReactNode = null;
  if (note.rule_kind === "mentions") detail = note.raid ? t("automod.alert.raid", { count: note.mentions ?? 0 }) : t("automod.alert.mentions", { count: note.mentions ?? 0 });
  else if (note.rule_kind === "flood") detail = t("automod.alert.flood", { count: note.messages ?? 0, seconds: note.seconds ?? 0 });
  else if (note.title) detail = t("automod.alert.title", { text: note.matched ?? "" });
  else if (note.rule_kind === "profile") detail = t("automod.alert.profile", { text: note.matched ?? "" });
  const done = note.actions.map(actionLabel).filter((x): x is string => !!x);
  const canTimeout = canI(st, P.MODERATE_MEMBERS);
  const canKick = canI(st, P.KICK_MEMBERS);
  const canBan = canI(st, P.BAN_MEMBERS);
  const act = (action: "timeout" | "kick" | "ban") => useUI.getState().openModal("memberAction", { serverId, userId: msg.author_id, action });
  const jump = note.message_id && note.channel_id ? () => {
    useUI.getState().setJumpTo({ channelId: note.channel_id!, messageId: note.message_id! });
    nav(`/channels/${serverId}/${note.channel_id}/${note.message_id}`);
  } : null;
  return (
    <div className={s.amAlert} data-id={msg.id} role="article" aria-label={t("automod.alert.label", { rule: note.rule_name })}>
      <span className={s.amMark} aria-hidden="true"><ShieldCheck size={20} /></span>
      <div className={s.amHead}>
        <span className={s.amName}>{t("automod.name")}</span>
        <span className={s.amRule} dir="auto">{note.rule_name}</span>
        <time className={s.time} dateTime={new Date(msg.created_at).toISOString()} title={formatFull(msg.created_at)}>{formatTimestamp(msg.created_at)}</time>
      </div>
      <div className={s.amLine}>
        <span className={s.amWho}>
          <Avatar id={msg.author_id} avatarId={user?.avatar_id ?? null} name={name} size={20} />
        </span>
        {chan ? <Tr id="automod.alert.whoWhere" values={{ who, where: chan }} /> : who}
      </div>
      {caught ? (
        <blockquote className={s.amCaught} data-open={open || undefined} dir="auto">
          {caught}
        </blockquote>
      ) : caught === undefined ? (
        <div className={s.amPending}>{t("automod.alert.opening")}</div>
      ) : note.content ? (
        <div className={s.amPending}>{t("automod.alert.cannotOpen")}</div>
      ) : null}
      {caught && caught.length > 280 && !open ? (
        <button type="button" className={s.sysLink} onClick={() => setOpen(true)}>{t("automod.alert.showAll")}</button>
      ) : null}
      {detail ? <div className={s.amDetail} dir="auto">{detail}</div> : null}
      {done.length ? (
        <div className={s.amDone}>
          {done.map((d) => (
            <span key={d} className={s.amChip}>{d}</span>
          ))}
        </div>
      ) : null}
      {jump || canTimeout || canKick || canBan ? (
        <div className={s.amButtons}>
          {jump ? <button type="button" className={s.amBtn} onClick={jump}>{t("automod.alert.jump")}</button> : null}
          {canTimeout && !note.actions.includes("timeout") ? <button type="button" className={s.amBtn} onClick={() => act("timeout")}>{t("automod.alert.timeout")}</button> : null}
          {canKick ? <button type="button" className={s.amBtn} onClick={() => act("kick")}>{t("automod.alert.kick")}</button> : null}
          {canBan ? <button type="button" className={s.amBtn} data-danger="true" onClick={() => act("ban")}>{t("automod.alert.ban")}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
