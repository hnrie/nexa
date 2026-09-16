import { AtSign, ChevronLeft, Hash, Lock, MessageCircle, MoreVertical, Phone, Pin, Search, UserPlus, UserRound, Users, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Channel } from "@/api/types";
import { Avatar, StatusDot, statusLabel } from "@/components/common/Avatar";
import { Composer } from "@/components/composer/Composer";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { activitiesOf, customStatus, statusOf, usePresence } from "@/stores/presence";
import { activityLine } from "@/lib/activity";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { conversationOf, useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useIsMobile, useIsNarrow } from "@/hooks/useIsMobile";
import { useMemo } from "react";
import { useServers } from "@/stores/servers";
import { isPrivateChannel } from "@/lib/perms";
import { GroupMemberList } from "./GroupMemberList";
import { MemberList } from "./MemberList";
import { CallBanner } from "@/components/voice/CallBanner";
import { SearchPanel } from "@/components/search/SearchPanel";
import sc from "@/components/search/Search.module.css";
import { VoiceView } from "@/components/voice/VoiceView";
import { useVoice } from "@/stores/voice";
import { useSelection } from "@/stores/selection";
import { joinVoice, toggleCamera } from "@/voice/session";
import { MessageList } from "./MessageList";
import { SubchatPanel } from "./SubchatPanel";
import { PinsPanel } from "./PinsPanel";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { LockedChannel } from "./LockedChannel";
import { lockState } from "@/lib/subchatLock";
import { storage } from "@/lib/storage";
import { SelectionBar } from "./SelectionBar";
import { TypingBar } from "./TypingBar";
import s from "./Chat.module.css";

const PROFILE_PANEL_KEY = "ec:dmProfilePanel";

export function ChatView({ channel }: { channel: Channel }) {
  const me = useAuth((a) => a.me);
  const users = useUsers((u) => u.byId);
  const presence = usePresence((p) => p.byUser);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const membersOpenDesktop = useUI((u) => u.membersOpen);
  const toggleMembersDesktop = useUI((u) => u.toggleMembers);
  // phones, tablets and narrow windows open the member list as a drawer that
  // starts closed on every channel: beside the chat it would squeeze it to nothing
  const rightOpen = useUI((u) => u.rightOpen);
  const setRightOpen = useUI((u) => u.setRightOpen);
  const [pins, setPins] = useState(false);
  const [subchats, setSubchats] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The profile of the person a DM is with, in a column beside it, as Discord shows it, remembered on
  // this device. Where it would cover the chat (a narrow window) it only opens when asked, each time.
  const [profileWide, setProfileWide] = useState(() => storage.get(PROFILE_PANEL_KEY) !== "0");
  const [profileNarrow, setProfileNarrow] = useState(false);
  const mobile = useIsMobile();
  const drawer = useIsNarrow();
  const profileOpen = drawer ? profileNarrow : profileWide;
  const toggleProfile = () => {
    if (drawer) {
      setProfileNarrow((open) => !open);
      return;
    }
    storage.set(PROFILE_PANEL_KEY, profileWide ? "0" : "1");
    setProfileWide(!profileWide);
  };
  const membersOpen = drawer ? rightOpen : membersOpenDesktop;
  const toggleMembers = () => (drawer ? setRightOpen(!rightOpen) : toggleMembersDesktop());
  // The drawer's member list is mounted only while open, and for its slide-out
  // after, so a closed drawer never pages in and sorts every member of a big server.
  const [membersMounted, setMembersMounted] = useState(membersOpen);
  useEffect(() => {
    if (membersOpen) {
      setMembersMounted(true);
      return;
    }
    const t = setTimeout(() => setMembersMounted(false), 250);
    return () => clearTimeout(t);
  }, [membersOpen]);
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
    setProfileNarrow(false);
    // picking belongs to the channel it started in too
    return () => {
      if (useSelection.getState().channelId === channel.id) useSelection.getState().clear();
    };
  }, [channel.id]);
  const selecting = useSelection((x) => x.channelId === channel.id);
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
  // A subchat with a password stays shut until this sign-in has typed it.
  const [unlocked, setUnlocked] = useState(!channel.locked);
  useEffect(() => {
    if (!channel.locked) return setUnlocked(true);
    let alive = true;
    setUnlocked(false);
    lockState(channel.id)
      .then((st) => alive && setUnlocked(!st.locked || st.unlocked))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [channel.id, channel.locked]);
  const locked = !!channel.locked && !unlocked;
  const other = convo.type === "dm" ? convo.recipient_ids.find((id) => id !== me?.id) : undefined;
  const otherStatus = other ? statusOf(presence[other]) : "offline";
  const cs = other ? customStatus(presence[other]) : null;
  const act = other ? activitiesOf(presence[other])[0] : undefined;

  return (
    <div className={s.chat}>
      <header className={s.header}>
        <PageHeaderButtons />
        {channel.type === "group_dm" ? (
          // a group's icon and name open its settings, as Discord's header does
          <button className={s.hGroup} onClick={() => openModal("editGroup", { channelId: channel.id })} aria-label="Edit group" data-testid="edit-group">
            <span className={s.hIcon}>{channel.icon_id ? <Avatar id={channel.id} avatarId={channel.icon_id} name={name} size={24} kind="icon" /> : <Users size={22} />}</span>
            <span className={s.hName}>{name}</span>
          </button>
        ) : (
          <>
            <span className={s.hIcon}>{isSub ? <MessageCircle size={22} /> : channel.type === "dm" ? <AtSign size={22} /> : isServer ? (priv ? <span className={s.lockHash}><Hash size={22} /><Lock size={11} className={s.lock} /></span> : <Hash size={22} />) : <Users size={22} />}</span>
            {channel.type === "dm" && other ? (
              // the other person's name is the way to their profile, as their avatar is
              <button className={[s.hName, s.hNameBtn].join(" ")} onClick={() => openModal("profile", { userId: other })} data-testid="dm-header-name">{name}</button>
            ) : (
              <span className={s.hName}>{name}</span>
            )}
          </>
        )}
        {isSub ? (
          <button className={s.hParent} onClick={() => nav(`/channels/@me/${convo.id}`)} data-testid="subchat-parent">
            <ChevronLeft size={14} />
            <span className={s.hParentText}>in {channelDisplayName(convo, users, me?.id, nicknames)}</span>
          </button>
        ) : channel.type === "dm" ? (
          // the status reads in its own colour; a custom status or activity keeps a dot of it in front
          cs || act ? (
            <span className={[s.hSub, s.hStatus].join(" ")} data-testid="dm-status">
              <StatusDot status={otherStatus} size={10} />
              <span className={s.hStatusText}>{cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : act ? activityLine(act) : ""}</span>
            </span>
          ) : (
            <span className={s.hSub} data-status={otherStatus} data-testid="dm-status">{statusLabel(otherStatus)}</span>
          )
        ) : isServer ? (
          channel.topic ? <button className={[s.hSub, s.hTopic].join(" ")} title={channel.topic} onClick={() => openModal("channelTopic", { channelId: channel.id })}>{channel.topic}</button> : null
        ) : (
          <span className={s.hSub}>{channel.recipient_ids.length} members</span>
        )}
        <span className={s.hSpacer} />
        {!isServer && !mobile ? (
          <Tooltip text="Subchats" side="bottom">
            <button className={s.hBtn} data-on={subchats} aria-label="Subchats" onClick={() => setSubchats((v) => !v)} data-testid="subchats-button" data-pop-toggle="subchats"><MessageCircle size={22} /></button>
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
              onKeyDown={(e) => { if (e.key === "Escape") { if (searchQuery) { setSearchQuery(""); } else { setSearchOpen(false); e.currentTarget.blur(); } } }}
            />
            {searchQuery ? (
              <button
                type="button"
                className={sc.clear}
                aria-label="Clear search"
                data-testid="search-clear"
                onClick={(e) => { e.preventDefault(); setSearchQuery(""); setSearchOpen(false); }}
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
        )}
        {!mobile ? (
          <Tooltip text="Pinned Messages" side="bottom">
            <button className={s.hBtn} data-on={pins} aria-label="Pinned Messages" onClick={() => setPins((v) => !v)} data-pop-toggle="pins"><Pin size={22} /></button>
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
        {!mobile && channel.type === "dm" && other ? (
          <Tooltip text={profileOpen ? "Hide User Profile" : "Show User Profile"} side="bottom">
            <button className={s.hBtn} data-on={profileOpen} aria-label={profileOpen ? "Hide User Profile" : "Show User Profile"} aria-pressed={profileOpen} onClick={toggleProfile} data-testid="toggle-profile"><UserRound size={22} /></button>
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
                // server channels have no subchats
                ...(!isServer ? [{ id: "subchats", label: "Subchats", onSelect: () => setSubchats(true) }] : []),
              ];
              if (isServer) items.push({ id: "invite", label: "Invite People", onSelect: () => openModal("invite", { serverId, channelId: channel.id }) });
              else items.push({ id: "add", label: convo.type === "dm" ? "Add Friends to DM" : "Invite to Group", onSelect: () => openModal(convo.type === "group_dm" ? "groupInvite" : "createDM", convo.type === "dm" ? { initial: other ? [other] : [] } : { channelId: convo.id }) });
              if (isServer || convo.type === "group_dm") items.push({ id: "members", label: membersOpen ? "Hide Members" : "Show Members", onSelect: toggleMembers });
              // a phone's call bar has no room for it, so inviting guests to the call is here too
              if (!isServer && inThisCall && (convo.type === "dm" || convo.type === "group_dm")) items.push({ id: "guests", label: "Invite Guests to Call", onSelect: () => openModal("guestLink", { channelId: convo.id }) });
              openContextMenu({ x: Math.max(8, r.right - 200), y: r.bottom + 4, items });
            }}
          >
            <MoreVertical size={22} />
          </button>
        ) : null}
      </header>
      {subchats && !isServer ? <SubchatPanel parent={convo} activeId={channel.id} onClose={() => setSubchats(false)} /> : null}
      <div className={s.body} data-search={searchOpen}>
        {/* The call and the composer belong to the conversation's column, so the member list, search and the
            profile run the full height beside them, and pinned messages open at the top rather than under the call. */}
        <div className={s.main}>
          {!isServer ? <CallBanner channelId={convo.id} /> : null}
          {!isServer && inThisCall ? <VoiceView channel={convo} embedded /> : null}
          {locked ? (
            <LockedChannel channel={channel} onUnlocked={() => setUnlocked(true)} />
          ) : (
            <>
              <MessageList key={channel.id} channel={channel} />
              {/* the composer stays mounted underneath, so a draft and its attachments survive picking */}
              <div className={s.composerSlot} hidden={selecting}>
                <TypingBar channelId={channel.id} />
                <Composer channel={channel} />
              </div>
              {selecting ? <SelectionBar channelId={channel.id} /> : null}
            </>
          )}
        </div>
        {pins ? <PinsPanel channelId={channel.id} onClose={() => setPins(false)} /> : null}
        {/* where search covers the chat, a picked result closes it (keeping the query) so the message shows */}
        {searchOpen ? <SearchPanel channel={channel} query={searchQuery} onQuery={setSearchQuery} inline={mobile} onJump={drawer ? () => setSearchOpen(false) : undefined} onClose={() => { setSearchOpen(false); setSearchQuery(""); }} /> : null}
        {isServer && serverId && (drawer ? membersOpen || membersMounted : membersOpen) ? <MemberList serverId={serverId} channelId={channel.id} drawer={drawer} open={membersOpen} /> : null}
        {drawer && membersOpen && (isServer || convo.type === "group_dm") ? <div className={s.membersBackdrop} onClick={toggleMembers} /> : null}
        {convo.type === "group_dm" && (drawer || membersOpen) ? <GroupMemberList channel={convo} drawer={drawer} open={membersOpen} /> : null}
        {!mobile && channel.type === "dm" && other && profileOpen && !searchOpen ? (
          <aside className={s.profilePanel} aria-label="User profile" data-testid="dm-profile-panel">
            <ProfileCard key={other} userId={other} variant="panel" />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
