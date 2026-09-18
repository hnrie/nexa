import { Check, MessageSquare, MoreVertical, Phone, Search, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import type { Relationship } from "@/api/types";
import { Avatar, statusLabel } from "@/components/common/Avatar";
import { ApiError } from "@/api/client";
import { Button } from "@/components/common/Button";
import { Tooltip } from "@/components/common/Tooltip";
import { audioContext } from "@/voice/media";
import { joinVoice } from "@/voice/session";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { activitiesOf, customStatus, statusOf, usePresence } from "@/stores/presence";
import { activityLine } from "@/lib/activity";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "@/components/friends/Friends.module.css";
import { guarded } from "@/lib/captcha";
import { describeError } from "@/lib/errors";

import { t as tr_ } from "@/i18n";
type Tab = "online" | "all" | "pending" | "blocked" | "add";

export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>("online");
  const [query, setQuery] = useState("");
  const rels = useRelationships((r) => r.byUser);
  const presence = usePresence((p) => p.byUser);
  const users = useUsers((u) => u.byId);
  const list = useMemo(() => {
    const all = Object.values(rels);
    const q = query.trim().toLowerCase();
    const match = (r: Relationship) => !q || r.user.display_name.toLowerCase().includes(q) || r.user.username.includes(q);
    switch (tab) {
      case "online":
        return all.filter((r) => r.type === "friend" && statusOf(presence[r.user.id]) !== "offline" && match(r));
      case "all":
        return all.filter((r) => r.type === "friend" && match(r));
      case "pending":
        return all.filter((r) => (r.type === "incoming" || r.type === "outgoing") && match(r));
      case "blocked":
        return all.filter((r) => r.type === "blocked" && match(r));
      default:
        return [];
    }
  }, [rels, tab, query, presence]);
  const pendingCount = Object.values(rels).filter((r) => r.type === "incoming").length;

  // The count used to be glued onto the label in English and then stripped off
  // again below with an English-shaped regex; it travels beside the label now,
  // so neither half has to survive a round trip through the other's grammar.
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "online", label: tr_("shell.user.online") },
    { id: "all", label: tr_("friends.all") },
    { id: "pending", label: tr_("friends.pending"), ...(pendingCount ? { count: pendingCount } : {}) },
    { id: "blocked", label: tr_("friends.blocked") },
  ];
  const activeTab = tabs.find((x) => x.id === tab);

  // Left/Right across the strip, as a tablist is expected to move; the buttons
  // themselves carry tabIndex -1 so Tab passes over the set rather than through it.
  const order: Tab[] = [...tabs.map((x) => x.id), "add"];
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -order.length : e.key === "End" ? order.length : 0;
    if (!step) return;
    e.preventDefault();
    const at = order.indexOf(tab);
    const next = order[Math.min(order.length - 1, Math.max(0, at + step))]!;
    setTab(next);
    const strip = e.currentTarget.parentElement;
    const buttons = strip ? [...strip.querySelectorAll<HTMLElement>('[role="tab"]')] : [];
    buttons[order.indexOf(next)]?.focus();
  };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <PageHeaderButtons />
        <div className={s.title}><Users size={22} /> {tr_("sidebar.dMSidebar.friends")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} role="tablist" aria-label={tr_("sidebar.dMSidebar.friends")}>
          {tabs.map((x) => (
            <button key={x.id} className={s.tab} role="tab" aria-selected={tab === x.id} tabIndex={tab === x.id ? 0 : -1} onKeyDown={onTabKey} data-selected={tab === x.id} onClick={() => setTab(x.id)}>
              {x.count ? `${x.label} (${x.count})` : x.label}
            </button>
          ))}
          <button className={s.addTab} role="tab" aria-selected={tab === "add"} tabIndex={tab === "add" ? 0 : -1} onKeyDown={onTabKey} data-selected={tab === "add"} onClick={() => setTab("add")}>{tr_("profile.profileCard.addFriend")}</button>
        </div>
      </header>
      <div className={s.body}>
        {tab === "add" ? (
          <AddFriend />
        ) : (
          <>
            <div className={s.search}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr_("chat.chat.search")} aria-label={tr_("friends.searchFriends")} />
              <Search size={20} />
            </div>
            <h3 className={s.section}>{activeTab?.label} — <span role="status">{list.length}</span></h3>
            {list.length === 0 ? <Empty tab={tab} query={query} onClear={() => setQuery("")} /> : list.map((r) => <FriendRow key={r.user.id} rel={r} presenceUser={users[r.user.id] ?? r.user} />)}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Nothing to show. The list is filtered by the tab *and* by the search box, so
 * a typo in the box used to be answered with "You have no friends yet" — which
 * is a statement about the account, not about the search.
 */
function Empty({ tab, query, onClear }: { tab: Tab; query: string; onClear: () => void }) {
  const text: Record<Tab, string> = {
    online: tr_("friends.nobodyIsOnlineRightNow"),
    all: tr_("friends.noFriendsYet"),
    pending: tr_("friends.thereAreNoPendingFriendRequests"),
    blocked: tr_("friends.youHaveNotBlockedAnyone"),
    add: "",
  };
  const searching = query.trim().length > 0;
  return (
    <div className={s.empty}>
      <Users size={48} />
      <p>{searching ? tr_("friends.nobodyHereMatches", { query: query.trim() }) : text[tab]}</p>
      {searching ? <Button size="sm" variant="secondary" onClick={onClear}>{tr_("friends.clearTheSearch")}</Button> : null}
    </div>
  );
}

function FriendRow({ rel, presenceUser }: { rel: Relationship; presenceUser: Relationship["user"] }) {
  const nav = useNavigate();
  const p = usePresence((st) => st.byUser[rel.user.id]);
  const toast = useUI((u) => u.toast);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const upsertChannel = useChannels((c) => c.upsert);
  const setRel = useRelationships((r) => r.set);
  const removeRel = useRelationships((r) => r.remove);
  const meId = useAuth((a) => a.me?.id);
  const status = statusOf(p);
  const cs = customStatus(p);
  const act = activitiesOf(p)[0];
  const sub = rel.type === "incoming" ? tr_("friends.incomingFriendRequest") : rel.type === "outgoing" ? tr_("friends.outgoingFriendRequest") : rel.type === "blocked" ? tr_("friends.blocked") : cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : act ? activityLine(act) : statusLabel(status);

  /** Opens (or makes) the DM with them; returns its id, or null when that failed. */
  const openDM = async (): Promise<string | null> => {
    try {
      const ch = await channelsApi.createDM([rel.user.id]);
      upsertChannel(ch);
      nav(`/channels/@me/${ch.id}`);
      return ch.id;
    } catch (err) {
      toast(describeError(err, tr_("profile.profileCard.couldNotOpenAConversation")), "error");
      return null;
    }
  };
  const message = async () => {
    await openDM();
  };
  // straight into a call with them, ringing them the way the call button in the DM does
  const call = async () => {
    // audio has to start inside the tap (iOS), before waiting on the conversation
    audioContext();
    const id = await openDM();
    if (!id) return;
    try {
      await joinVoice(id);
    } catch (err) {
      // A refused microphone rejects here, and this page said nothing at all:
      // the conversation opened, no call started, and no reason was given.
      toast(describeError(err, tr_("friends.thatCallCouldNotBeStarted")), "error");
    }
  };
  const accept = async () => {
    try {
      const res = await relApi.accept(rel.user.id);
      setRel({ user: res.user, type: "friend", nickname: rel.nickname, created_at: Date.now() });
      // the server opens the conversation as part of accepting; go straight to it
      if (res.channel) {
        useChannels.getState().upsert([res.channel]);
        nav(`/channels/@me/${res.channel.id}`);
      }
    } catch (err) {
      toast(describeError(err, tr_("profile.profileCard.couldNotAccept")), "error");
    }
  };
  const remove = async (label: string) => {
    try {
      if (rel.type === "blocked") await relApi.unblock(rel.user.id);
      else await relApi.remove(rel.user.id);
      removeRel(rel.user.id);
      toast(label, "success");
    } catch (err) {
      toast(describeError(err, tr_("friends.couldNotUpdate")), "error");
    }
  };
  const block = async () => {
    try {
      await relApi.block(rel.user.id);
      setRel({ ...rel, type: "blocked" });
    } catch (err) {
      toast(describeError(err, tr_("friends.couldNotUpdate")), "error");
    }
  };
  // Both sit in a menu beside "Copy user ID" and both used to fire on the way
  // past. Blocking in particular is socially hard to undo.
  const confirmBlock = () =>
    useUI.getState().openModal("confirm", {
      title: tr_("profile.profileCard.block"),
      body: tr_("friends.blockNameTheyWillNotBe", { name: rel.user.display_name }),
      confirmLabel: tr_("profile.profileCard.block"),
      danger: true,
      onConfirm: () => block(),
    });
  const confirmRemove = () =>
    useUI.getState().openModal("confirm", {
      title: tr_("profile.profileCard.removeFriend"),
      body: tr_("friends.removeNameFromYourFriends", { name: rel.user.display_name }),
      confirmLabel: tr_("profile.profileCard.removeFriend"),
      danger: true,
      onConfirm: () => remove(tr_("friends.friendRemoved")),
    });
  const more = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "profile", label: tr_("profile.profile.profile"), onSelect: () => useUI.getState().openModal("profile", { userId: rel.user.id }) },
        { id: "msg", label: tr_("profile.profileCard.message"), onSelect: () => void message(), separatorAfter: rel.type !== "friend" },
        ...(rel.type === "friend" ? [{ id: "call", label: tr_("chat.chat.startVoiceCall"), onSelect: () => void call(), separatorAfter: true }] : []),
        ...(rel.type === "friend" ? [{ id: "rm", label: tr_("profile.profileCard.removeFriend"), danger: true, onSelect: confirmRemove }] : []),
        ...(rel.type !== "blocked"
          ? [{ id: "block", label: tr_("profile.profileCard.block"), danger: true, onSelect: confirmBlock }]
          : [{ id: "unblock", label: tr_("friends.unblock"), onSelect: () => void remove(tr_("friends.unblocked")) }]),
        { id: "copy", label: tr_("chat.groupMemberMenu.copyUserId"), onSelect: () => void navigator.clipboard?.writeText(rel.user.id).then(() => toast(tr_("friends.userIdCopied"), "success"), () => toast(tr_("friends.theUserIdCouldNotBe"), "error")) },
      ],
    });
  };

  return (
    <div className={s.row} data-user={rel.user.username} onContextMenu={more}>
      <Avatar id={rel.user.id} avatarId={presenceUser.avatar_id} name={presenceUser.display_name} size={32} status={rel.type === "friend" ? status : null} />
      <div className={s.rowText}>
        <span className={s.rowName}>
          <span className={s.rowDisplay}>{presenceUser.display_name}</span>
          <span className={s.rowUser}>{presenceUser.username}</span>
        </span>
        <span className={s.rowSub}>{sub}</span>
      </div>
      <div className={s.actions}>
        {rel.type === "friend" ? (
          <>
            <Tooltip text={tr_("profile.profileCard.message")}><button className={s.act} aria-label={tr_("profile.profileCard.message")} onClick={() => void message()}><MessageSquare size={20} /></button></Tooltip>
            <Tooltip text={tr_("chat.chat.startVoiceCall")}><button className={s.act} aria-label={tr_("chat.chat.startVoiceCall")} onClick={() => void call()} data-testid="friend-call"><Phone size={20} /></button></Tooltip>
            <Tooltip text={tr_("chat.chat.more")}><button className={s.act} aria-label={tr_("chat.chat.more")} onClick={more}><MoreVertical size={20} /></button></Tooltip>
          </>
        ) : rel.type === "incoming" ? (
          <>
            <Tooltip text={tr_("voice.incomingCall.accept")}><button className={[s.act, s.ok].join(" ")} aria-label={tr_("voice.incomingCall.accept")} onClick={() => void accept()}><Check size={20} /></button></Tooltip>
            <Tooltip text={tr_("friends.ignore")}><button className={[s.act, s.no].join(" ")} aria-label={tr_("friends.ignore")} onClick={() => void remove(tr_("friends.requestIgnored"))}><X size={20} /></button></Tooltip>
          </>
        ) : rel.type === "outgoing" ? (
          <Tooltip text={tr_("chat.editMessage.cancel")}><button className={[s.act, s.no].join(" ")} aria-label={tr_("chat.editMessage.cancel")} onClick={() => void remove(tr_("friends.requestCancelled"))}><X size={20} /></button></Tooltip>
        ) : (
          <Tooltip text={tr_("friends.unblock")}><button className={[s.act, s.no].join(" ")} aria-label={tr_("friends.unblock")} onClick={() => void remove(tr_("friends.unblocked"))}><X size={20} /></button></Tooltip>
        )}
      </div>
      {meId ? null : null}
    </div>
  );
}

function AddFriend() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setRel = useRelationships((r) => r.set);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = value.trim().replace(/^@/, "").toLowerCase();
    if (!username || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await guarded("friend_request", (captcha) => relApi.request(username, captcha));
      setRel({ user: res.user, type: res.type as Relationship["type"], nickname: "", created_at: Date.now() });
      setMsg({ ok: true, text: res.type === "friend" ? tr_("friends.youAreNowFriends", { name: res.user.display_name }) : tr_("friends.friendRequestSent", { name: res.user.display_name }) });
      setValue("");
    } catch (err) {
      const map: Record<string, string> = {
        user_not_found: tr_("friends.hmDidnTWorkDoubleCheck"),
        self: tr_("friends.youCanTAddYourselfBut"),
        blocked: tr_("friends.youCanTSendARequest"),
        already_friends: tr_("friends.youReAlreadyFriendsWithThat"),
        already_sent: tr_("friends.youAlreadySentARequestTo"),
      };
      setMsg({ ok: false, text: err instanceof ApiError && map[err.code] ? map[err.code]! : describeError(err, tr_("friends.thatFriendRequestCouldNotBe")) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.addBox}>
      <h3 className={s.addTitle}>{tr_("profile.profileCard.addFriend")}</h3>
      <p className={s.addSub}>{tr_("friends.youCanAddFriendsWithTheir")}</p>
      <form className={s.addForm} onSubmit={(e) => void submit(e)}>
        <UserPlus size={20} style={{ color: "var(--text-muted)" }} />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={tr_("friends.youCanAddFriendsWithTheir")} aria-label={tr_("settings.account.username")} autoCapitalize="none" spellCheck={false} />
        <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>{tr_("friends.sendFriendRequest")}</Button>
      </form>
      {msg ? <div className={[s.addMsg, msg.ok ? s.ok : s.err].join(" ")} role={msg.ok ? "status" : "alert"}>{msg.text}</div> : null}
    </div>
  );
}
