import { AtSign, Pin, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import type { Channel } from "@/api/types";
import { Avatar, statusLabel } from "@/components/common/Avatar";
import { Composer } from "@/components/composer/Composer";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { MessageList } from "./MessageList";
import { PinsPanel } from "./PinsPanel";
import { TypingBar } from "./TypingBar";
import s from "./Chat.module.css";

export function ChatView({ channel }: { channel: Channel }) {
  const me = useAuth((a) => a.me);
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const openModal = useUI((u) => u.openModal);
  const membersOpen = useUI((u) => u.membersOpen);
  const toggleMembers = useUI((u) => u.toggleMembers);
  const [pins, setPins] = useState(false);
  const name = channelDisplayName(channel, users, me?.id);
  const other = channel.type === "dm" ? channel.recipient_ids.find((id) => id !== me?.id) : undefined;
  const otherStatus = other ? statusOf(presence[other]) : "offline";
  const cs = other ? customStatus(presence[other]) : null;

  return (
    <div className={s.chat}>
      <header className={s.header}>
        <PageHeaderButtons />
        <span className={s.hIcon}>{channel.type === "dm" ? <AtSign size={22} /> : <Users size={22} />}</span>
        <span className={s.hName}>{name}</span>
        {channel.type === "dm" ? <span className={s.hSub}>{cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : statusLabel(otherStatus)}</span> : <span className={s.hSub}>{channel.recipient_ids.length} members</span>}
        <span className={s.hSpacer} />
        <Tooltip text="Pinned Messages" side="bottom">
          <button className={s.hBtn} data-on={pins} aria-label="Pinned Messages" onClick={() => setPins((v) => !v)}><Pin size={22} /></button>
        </Tooltip>
        <Tooltip text={channel.type === "dm" ? "Add Friends to DM" : "Add Friends to Group"} side="bottom">
          <button className={s.hBtn} aria-label="Add friends" onClick={() => openModal("createDM", channel.type === "dm" ? { initial: other ? [other] : [] } : { groupId: channel.id })}><UserPlus size={22} /></button>
        </Tooltip>
        {channel.type === "group_dm" ? (
          <Tooltip text="Member List" side="bottom">
            <button className={s.hBtn} data-on={membersOpen} aria-label="Member List" onClick={toggleMembers}><Users size={22} /></button>
          </Tooltip>
        ) : null}
      </header>
      <div className={s.body}>
        <MessageList channel={channel} />
        {pins ? <PinsPanel channelId={channel.id} onClose={() => setPins(false)} /> : null}
        {channel.type === "group_dm" && membersOpen ? (
          <aside className={s.members}>
            <div className={s.mHead}>Members — {channel.recipient_ids.length}</div>
            {channel.recipient_ids.map((id) => {
              const u = users[id];
              const st = statusOf(presence[id]);
              return (
                <button key={id} className={s.mRow} data-offline={st === "offline"} onClick={() => openModal("profile", { userId: id })}>
                  <Avatar id={id} avatarId={u?.avatar_id ?? null} name={displayName(u)} size={32} status={st} />
                  <span className={s.mName}>{displayName(u)}{channel.owner_id === id ? " 👑" : ""}</span>
                </button>
              );
            })}
          </aside>
        ) : null}
      </div>
      <TypingBar channelId={channel.id} />
      <Composer channel={channel} />
    </div>
  );
}
