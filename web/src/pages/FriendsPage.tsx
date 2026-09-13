import { Check, MessageSquare, MoreVertical, Search, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import type { Relationship } from "@/api/types";
import { Avatar, statusLabel } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { PageHeaderButtons } from "@/components/shell/PageHeader";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "@/components/friends/Friends.module.css";
import { guarded } from "@/lib/captcha";

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

  const tabs: { id: Tab; label: string }[] = [
    { id: "online", label: "Online" },
    { id: "all", label: "All" },
    { id: "pending", label: pendingCount ? `Pending (${pendingCount})` : "Pending" },
    { id: "blocked", label: "Blocked" },
  ];

  return (
    <div className={s.page}>
      <header className={s.header}>
        <PageHeaderButtons />
        <div className={s.title}><Users size={22} /> Friends</div>
        {tabs.map((t) => (
          <button key={t.id} className={s.tab} data-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <button className={s.addTab} data-selected={tab === "add"} onClick={() => setTab("add")}>Add Friend</button>
      </header>
      <div className={s.body}>
        {tab === "add" ? (
          <AddFriend />
        ) : (
          <>
            <div className={s.search}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search friends" />
              <Search size={20} />
            </div>
            <h3 className={s.section}>{tabs.find((t) => t.id === tab)?.label.replace(/ \(\d+\)$/, "")} — {list.length}</h3>
            {list.length === 0 ? <Empty tab={tab} /> : list.map((r) => <FriendRow key={r.user.id} rel={r} presenceUser={users[r.user.id] ?? r.user} />)}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ tab }: { tab: Tab }) {
  const text: Record<Tab, string> = {
    online: "No one's around to play with Wumpus… I mean, nobody is online right now.",
    all: "Wumpus is waiting on friends. You don't have to though!",
    pending: "There are no pending friend requests. Here's Wumpus for now.",
    blocked: "You can't unblock the Wumpus. But you can unblock people here.",
    add: "",
  };
  return (
    <div className={s.empty}>
      <Users size={48} />
      <p>{text[tab].replace(/Wumpus/g, "anyone").replace("the anyone", "anyone")}</p>
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
  const sub = rel.type === "incoming" ? "Incoming Friend Request" : rel.type === "outgoing" ? "Outgoing Friend Request" : rel.type === "blocked" ? "Blocked" : cs ? `${cs.emoji ? cs.emoji + " " : ""}${cs.text}` : statusLabel(status);

  const message = async () => {
    try {
      const ch = await channelsApi.createDM([rel.user.id]);
      upsertChannel(ch);
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open a conversation.", "error");
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
      toast(err instanceof ApiError ? err.message : "Could not accept.", "error");
    }
  };
  const remove = async (label: string) => {
    try {
      if (rel.type === "blocked") await relApi.unblock(rel.user.id);
      else await relApi.remove(rel.user.id);
      removeRel(rel.user.id);
      toast(label, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update.", "error");
    }
  };
  const more = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "profile", label: "Profile", onSelect: () => useUI.getState().openModal("profile", { userId: rel.user.id }) },
        { id: "msg", label: "Message", onSelect: () => void message(), separatorAfter: true },
        ...(rel.type === "friend" ? [{ id: "rm", label: "Remove Friend", danger: true, onSelect: () => void remove("Friend removed.") }] : []),
        ...(rel.type !== "blocked"
          ? [{ id: "block", label: "Block", danger: true, onSelect: () => void relApi.block(rel.user.id).then(() => setRel({ ...rel, type: "blocked" })) }]
          : [{ id: "unblock", label: "Unblock", onSelect: () => void remove("Unblocked.") }]),
        { id: "copy", label: "Copy User ID", onSelect: () => void navigator.clipboard?.writeText(rel.user.id) },
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
            <button className={s.act} title="Message" aria-label="Message" onClick={() => void message()}><MessageSquare size={20} /></button>
            <button className={s.act} title="More" aria-label="More" onClick={more}><MoreVertical size={20} /></button>
          </>
        ) : rel.type === "incoming" ? (
          <>
            <button className={[s.act, s.ok].join(" ")} title="Accept" aria-label="Accept" onClick={() => void accept()}><Check size={20} /></button>
            <button className={[s.act, s.no].join(" ")} title="Ignore" aria-label="Ignore" onClick={() => void remove("Request ignored.")}><X size={20} /></button>
          </>
        ) : rel.type === "outgoing" ? (
          <button className={[s.act, s.no].join(" ")} title="Cancel" aria-label="Cancel" onClick={() => void remove("Request cancelled.")}><X size={20} /></button>
        ) : (
          <button className={[s.act, s.no].join(" ")} title="Unblock" aria-label="Unblock" onClick={() => void remove("Unblocked.")}><X size={20} /></button>
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
      setMsg({ ok: true, text: res.type === "friend" ? `You and ${res.user.display_name} are now friends!` : `Success! Your friend request to ${res.user.display_name} was sent.` });
      setValue("");
    } catch (err) {
      const map: Record<string, string> = {
        user_not_found: "Hm, didn't work. Double check that the username is correct.",
        self: "You can't add yourself, but we admire the confidence.",
        blocked: "You can't send a request to this user.",
        already_friends: "You're already friends with that user!",
        already_sent: "You already sent a request to that user.",
      };
      setMsg({ ok: false, text: err instanceof ApiError ? (map[err.code] ?? err.message) : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.addBox}>
      <h3 className={s.addTitle}>Add Friend</h3>
      <p className={s.addSub}>You can add friends with their username.</p>
      <form className={s.addForm} onSubmit={(e) => void submit(e)}>
        <UserPlus size={20} style={{ color: "var(--text-muted)" }} />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="You can add friends with their username." aria-label="Username" autoCapitalize="none" spellCheck={false} />
        <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>Send Friend Request</Button>
      </form>
      {msg ? <div className={[s.addMsg, msg.ok ? s.ok : s.err].join(" ")}>{msg.text}</div> : null}
    </div>
  );
}
