import { AtSign, Hash, Lock, Phone, Pin, Search, UserPlus, Users, Video } from "lucide-react";
import { useState } from "react";
import type { Channel } from "@/api/types";
import { Avatar, statusLabel } from "@/components/common/Avatar";
import { Composer } from "@/components/composer/Composer";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { useRelationships } from "@/stores/relationships";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMemo } from "react";
import { useServers } from "@/stores/servers";
import { isPrivateChannel } from "@/lib/perms";
import { MemberList } from "./MemberList";
import { CallBanner } from "@/components/voice/CallBanner";
import { SearchPanel } from "@/components/search/SearchPanel";
import sc from "@/components/search/Search.module.css";
import { VoiceView } from "@/components/voice/VoiceView";
import { useVoice } from "@/stores/voice";
import { joinVoice, toggleCamera } from "@/voice/session";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const mobile = useIsMobile();
  const serverId = channel.server_id;
  const serverState = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const name = channelDisplayName(channel, users, me?.id, nicknames);
  const isServer = !!serverId && !!serverState;
  const inThisCall = useVoice((v) => v.mine?.channel_id === channel.id);
  const startCall = async (video: boolean) => {
    await joinVoice(channel.id);
    if (video) await toggleCamera();
  };
  const priv = isServer && isPrivateChannel(serverId, channel.overwrites);
  const other = channel.type === "dm" ? channel.recipient_ids.find((id) => id !== me?.id) : undefined;
  const otherStatus = other ? statusOf(presence[other]) : "offline";
  const cs = other ? customStatus(presence[other]) : null;

  return (
    <div className={s.chat}>
      <header className={s.header}>
        <PageHeaderButtons />
        <span className={s.hIcon}>{channel.type === "dm" ? <AtSign size={22} /> : isServer ? (priv ? <span className={s.lockHash}><Hash size={22} /><Lock size={11} className={s.lock} /></span> : <Hash size={22} />) : <Users size={22} />}</span>
        <span className={s.hName}>{name}</span>
        {channel.type === "dm" ? (
          <span className={s.hSub}>{cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : statusLabel(otherStatus)}</span>
        ) : isServer ? (
          channel.topic ? <button className={[s.hSub, s.hTopic].join(" ")} title={channel.topic} onClick={() => openModal("channelTopic", { channelId: channel.id })}>{channel.topic}</button> : null
        ) : (
          <span className={s.hSub}>{channel.recipient_ids.length} members</span>
        )}
        <span className={s.hSpacer} />
        {!isServer ? (
          <>
            <Tooltip text="Start Voice Call" side="bottom">
              <button className={s.hBtn} aria-label="Start Voice Call" onClick={() => void startCall(false)} data-testid="start-call"><Phone size={22} /></button>
            </Tooltip>
            <Tooltip text="Start Video Call" side="bottom">
              <button className={s.hBtn} aria-label="Start Video Call" onClick={() => void startCall(true)}><Video size={22} /></button>
            </Tooltip>
          </>
        ) : null}
        {mobile ? (
          <Tooltip text="Search" side="bottom">
            <button className={s.hBtn} data-on={searchOpen} aria-label="Search messages" onClick={() => setSearchOpen((v) => !v)}><Search size={22} /></button>
          </Tooltip>
        ) : (
          <label className={sc.searchBox} title="Search this device's decrypted messages">
            <Search size={16} />
            <input
              value={searchQuery}
              placeholder="Search"
              aria-label="Search messages"
              data-testid="search-input"
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); e.currentTarget.blur(); } }}
            />
          </label>
        )}
        <Tooltip text="Pinned Messages" side="bottom">
          <button className={s.hBtn} data-on={pins} aria-label="Pinned Messages" onClick={() => setPins((v) => !v)}><Pin size={22} /></button>
        </Tooltip>
        {isServer ? (
          <Tooltip text="Invite People" side="bottom">
            <button className={s.hBtn} aria-label="Invite People" onClick={() => openModal("invite", { serverId, channelId: channel.id })}><UserPlus size={22} /></button>
          </Tooltip>
        ) : (
          <Tooltip text={channel.type === "dm" ? "Add Friends to DM" : "Add Friends to Group"} side="bottom">
            <button className={s.hBtn} aria-label="Add friends" onClick={() => openModal("createDM", channel.type === "dm" ? { initial: other ? [other] : [] } : { groupId: channel.id })}><UserPlus size={22} /></button>
          </Tooltip>
        )}
        {channel.type === "group_dm" || isServer ? (
          <Tooltip text="Member List" side="bottom">
            <button className={s.hBtn} data-on={membersOpen} aria-label="Member List" onClick={toggleMembers}><Users size={22} /></button>
          </Tooltip>
        ) : null}
      </header>
      {!isServer ? <CallBanner channelId={channel.id} /> : null}
      {!isServer && inThisCall ? <VoiceView channel={channel} embedded /> : null}
      <div className={s.body}>
        <MessageList channel={channel} />
        {pins ? <PinsPanel channelId={channel.id} onClose={() => setPins(false)} /> : null}
        {searchOpen ? <SearchPanel channel={channel} query={searchQuery} onQuery={mobile ? setSearchQuery : undefined} onClose={() => { setSearchOpen(false); setSearchQuery(""); }} /> : null}
        {isServer && membersOpen && serverId ? <MemberList serverId={serverId} channelId={channel.id} /> : null}
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
