import { AtSign, ChevronLeft, Hash, Lock, MessageCircle, MoreVertical, Phone, Pin, Search, UserPlus, Users, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar, statusLabel } from "@/components/common/Avatar";
import { Composer } from "@/components/composer/Composer";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import { conversationOf, useChannels } from "@/stores/channels";
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
import { SubchatPanel } from "./SubchatPanel";
import { PinsPanel } from "./PinsPanel";
import { TypingBar } from "./TypingBar";
import s from "./Chat.module.css";

export function ChatView({ channel }: { channel: Channel }) {
  const me = useAuth((a) => a.me);
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const membersOpenDesktop = useUI((u) => u.membersOpen);
  const toggleMembersDesktop = useUI((u) => u.toggleMembers);
  // phones open the member list as a drawer that starts closed on every channel
  const rightOpen = useUI((u) => u.rightOpen);
  const setRightOpen = useUI((u) => u.setRightOpen);
  const [pins, setPins] = useState(false);
  const [subchats, setSubchats] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const mobile = useIsMobile();
  const membersOpen = mobile ? rightOpen : membersOpenDesktop;
  const toggleMembers = () => (mobile ? setRightOpen(!rightOpen) : toggleMembersDesktop());
  const nav = useNavigate();
  const channelsById = useChannels((c) => c.byId);
  // A subchat borrows its conversation for calls, invites and the member
  // list: it is a room inside that chat, not a separate one.
  const convo = conversationOf(channelsById, channel) ?? channel;
  const isSub = channel.type === "subchat";
  const serverId = channel.server_id;
  const serverState = useServers((st) => (serverId ? st.byId[serverId] : undefined));
  const rels = useRelationships((r) => r.byUser);
  const nicknames = useMemo(() => friendNicknames(rels), [rels]);
  const name = channelDisplayName(channel, users, me?.id, nicknames);
  const isServer = !!serverId && !!serverState;
  const inThisCall = useVoice((v) => v.mine?.channel_id === convo.id);
  const startCall = async (video: boolean) => {
    await joinVoice(convo.id);
    if (video) await toggleCamera();
  };
  // Panels belong to the chat they were opened in. On a phone they cover it,
  // so leaving one open across a channel switch hides the new conversation.
  useEffect(() => {
    setPins(false);
    setSubchats(false);
    setSearchOpen(false);
    setSearchQuery("");
  }, [channel.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("[data-modal-layer]")) return;
      setSearchOpen((open) => {
        if (open) e.stopPropagation();
        return false;
      });
      setPins(false);
      setSubchats(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const priv = isServer && isPrivateChannel(serverId, channel.overwrites);
  const other = convo.type === "dm" ? convo.recipient_ids.find((id) => id !== me?.id) : undefined;
  const otherStatus = other ? statusOf(presence[other]) : "offline";
  const cs = other ? customStatus(presence[other]) : null;

  return (
    <div className={s.chat}>
      <header className={s.header}>
        <PageHeaderButtons />
        <span className={s.hIcon}>{isSub ? <MessageCircle size={22} /> : channel.type === "dm" ? <AtSign size={22} /> : isServer ? (priv ? <span className={s.lockHash}><Hash size={22} /><Lock size={11} className={s.lock} /></span> : <Hash size={22} />) : <Users size={22} />}</span>
        <span className={s.hName}>{name}</span>
        {isSub ? (
          <button className={s.hParent} onClick={() => nav(`/channels/@me/${convo.id}`)} data-testid="subchat-parent">
            <ChevronLeft size={14} />
            in {channelDisplayName(convo, users, me?.id, nicknames)}
          </button>
        ) : channel.type === "dm" ? (
          <span className={s.hSub}>{cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : statusLabel(otherStatus)}</span>
        ) : isServer ? (
          channel.topic ? <button className={[s.hSub, s.hTopic].join(" ")} title={channel.topic} onClick={() => openModal("channelTopic", { channelId: channel.id })}>{channel.topic}</button> : null
        ) : (
          <span className={s.hSub}>{channel.recipient_ids.length} members</span>
        )}
        <span className={s.hSpacer} />
        {!isServer && !mobile ? (
          <Tooltip text="Subchats" side="bottom">
            <button className={s.hBtn} data-on={subchats} aria-label="Subchats" onClick={() => setSubchats((v) => !v)} data-testid="subchats-button"><MessageCircle size={22} /></button>
          </Tooltip>
        ) : null}
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
        {!mobile ? (
          <Tooltip text="Pinned Messages" side="bottom">
            <button className={s.hBtn} data-on={pins} aria-label="Pinned Messages" onClick={() => setPins((v) => !v)}><Pin size={22} /></button>
          </Tooltip>
        ) : null}
        {!mobile && isServer ? (
          <Tooltip text="Invite People" side="bottom">
            <button className={s.hBtn} aria-label="Invite People" onClick={() => openModal("invite", { serverId, channelId: channel.id })}><UserPlus size={22} /></button>
          </Tooltip>
        ) : null}
        {!mobile && !isServer ? (
          <Tooltip text={convo.type === "dm" ? "Add Friends to DM" : "Invite to Group"} side="bottom">
            <button className={s.hBtn} aria-label="Add friends" onClick={() => openModal(convo.type === "group_dm" ? "groupInvite" : "createDM", convo.type === "dm" ? { initial: other ? [other] : [] } : { channelId: convo.id })}><UserPlus size={22} /></button>
          </Tooltip>
        ) : null}
        {!mobile && (convo.type === "group_dm" || isServer) ? (
          <Tooltip text="Member List" side="bottom">
            <button className={s.hBtn} data-on={membersOpen} aria-label="Member List" onClick={toggleMembers}><Users size={22} /></button>
          </Tooltip>
        ) : null}
        {mobile ? (
          <button
            className={s.hBtn}
            aria-label="More"
            data-testid="chat-more"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const items: ContextMenuItem[] = [
                { id: "pins", label: "Pinned Messages", onSelect: () => setPins(true) },
                { id: "subchats", label: "Subchats", onSelect: () => setSubchats(true) },
              ];
              if (isServer) items.push({ id: "invite", label: "Invite People", onSelect: () => openModal("invite", { serverId, channelId: channel.id }) });
              else items.push({ id: "add", label: convo.type === "dm" ? "Add Friends to DM" : "Invite to Group", onSelect: () => openModal(convo.type === "group_dm" ? "groupInvite" : "createDM", convo.type === "dm" ? { initial: other ? [other] : [] } : { channelId: convo.id }) });
              if (isServer || convo.type === "group_dm") items.push({ id: "members", label: membersOpen ? "Hide Members" : "Show Members", onSelect: toggleMembers });
              openContextMenu({ x: Math.max(8, r.right - 200), y: r.bottom + 4, items });
            }}
          >
            <MoreVertical size={22} />
          </button>
        ) : null}
      </header>
      {subchats && !isServer ? <SubchatPanel parent={convo} activeId={channel.id} onClose={() => setSubchats(false)} /> : null}
      {!isServer ? <CallBanner channelId={convo.id} /> : null}
      {!isServer && inThisCall ? <VoiceView channel={convo} embedded /> : null}
      <div className={s.body}>
        {/* the composer belongs to the conversation's column, so the member list and search run the full height beside it */}
        <div className={s.main}>
          <MessageList channel={channel} />
          <TypingBar channelId={channel.id} />
          <Composer channel={channel} />
        </div>
        {pins ? <PinsPanel channelId={channel.id} onClose={() => setPins(false)} /> : null}
        {searchOpen ? <SearchPanel channel={channel} query={searchQuery} onQuery={mobile ? setSearchQuery : undefined} onClose={() => { setSearchOpen(false); setSearchQuery(""); }} /> : null}
        {isServer && serverId && (mobile || membersOpen) ? <MemberList serverId={serverId} channelId={channel.id} drawer={mobile} open={membersOpen} /> : null}
        {mobile && membersOpen && (isServer || convo.type === "group_dm") ? <div className={s.membersBackdrop} onClick={toggleMembers} /> : null}
        {convo.type === "group_dm" && (mobile || membersOpen) ? (
          <aside className={s.members} data-open={mobile ? membersOpen : undefined}>
            <div className={s.mHead}>Members — {convo.recipient_ids.length}</div>
            {convo.recipient_ids.map((id) => {
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
    </div>
  );
}
