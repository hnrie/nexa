import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSettings } from "@/stores/settings";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import { bannerUrl, users as usersApi } from "@/api/users";
import type { PublicUser } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { useRenderCtx } from "@/lib/markdownCtx";
import { profileTheme } from "@/lib/avatarColor";
import { Markdown } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { customStatus, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers, displayName } from "@/stores/users";
import s from "./Profile.module.css";

function themeOf(u: PublicUser | undefined): string {
  return profileTheme(u?.accent_color, u?.accent_color_2, u?.id);
}

function accentColor(u: PublicUser | undefined): string {
  if (u?.accent_color !== null && u?.accent_color !== undefined) return `#${u.accent_color.toString(16).padStart(6, "0")}`;
  return "var(--brand)";
}

export default function ProfileModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const nav = useNavigate();
  const me = useAuth((a) => a.me);
  const stored = useUsers((u) => u.byId[userId]);
  const upsertUser = useUsers((u) => u.upsert);
  const rel = useRelationships((r) => r.byUser[userId]);
  const setRel = useRelationships((r) => r.set);
  const removeRel = useRelationships((r) => r.remove);
  const presence = usePresence((p) => p.byUser[userId]);
  const upsertChannel = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const ctx = useRenderCtx();
  const [mutual, setMutual] = useState<string[]>([]);
  const note = useSettings((st) => st.settings.userNotes[userId] ?? "");
  const patchSettings = useSettings((st) => st.patch);
  const allNotes = useSettings((st) => st.settings.userNotes);
  const [nickEditing, setNickEditing] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const saveNickname = async () => {
    setNickEditing(false);
    if (!rel || rel.type !== "friend" || nickDraft.trim() === rel.nickname) return;
    try {
      setRel(await relApi.setNickname(userId, nickDraft.trim()));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the nickname.", "error");
    }
  };
  const users = useUsers((u) => u.byId);
  const isMe = me?.id === userId;
  const user: PublicUser | undefined = isMe && me ? me : stored;

  useEffect(() => {
    let alive = true;
    usersApi
      .profile(userId)
      .then((p) => {
        if (!alive) return;
        upsertUser(p.user);
        setMutual(p.mutual_friends);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId, upsertUser]);

  if (!user) return <Modal open onClose={onClose} title="Profile"><p className={s.small}>Loading…</p></Modal>;
  const st = statusOf(presence);
  const cs = customStatus(presence);
  const banner = bannerUrl(user.banner_id);

  const message = async () => {
    try {
      const ch = await channelsApi.createDM([userId]);
      upsertChannel(ch);
      onClose();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open a conversation.", "error");
    }
  };
  const addFriend = async () => {
    try {
      const res = await relApi.request(user.username);
      setRel({ user: res.user, type: res.type as "friend" | "outgoing", nickname: "", created_at: Date.now() });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not send the request.", "error");
    }
  };
  const accept = async () => {
    try {
      const res = await relApi.accept(userId);
      setRel({ user: res.user, type: "friend", nickname: "", created_at: Date.now() });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not accept.", "error");
    }
  };
  const more = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        ...(rel?.type === "friend" ? [{ id: "rm", label: "Remove Friend", danger: true, onSelect: () => void relApi.remove(userId).then(() => removeRel(userId)) }] : []),
        ...(rel?.type === "blocked"
          ? [{ id: "unblock", label: "Unblock", onSelect: () => void relApi.unblock(userId).then(() => removeRel(userId)) }]
          : [{ id: "block", label: "Block", danger: true, onSelect: () => void relApi.block(userId).then(() => setRel({ user, type: "blocked", nickname: "", created_at: Date.now() })) }]),
        { id: "copy", label: "Copy User ID", onSelect: () => void navigator.clipboard?.writeText(userId) },
      ],
    });
  };

  return (
    <Modal open onClose={onClose} width={600} bare>
      <div className={s.card}>
        <button className={s.close} aria-label="Close profile" onClick={onClose}><X size={20} /></button>
        <div className={s.banner} style={banner ? { backgroundImage: `url(${banner})` } : { background: themeOf(user) }} />
        <div className={s.head}>
          <div className={s.avatar}><Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={80} status={st} /></div>
          <div className={s.actions}>
            {isMe ? (
              <Button size="sm" onClick={() => { onClose(); openModal("settings", { page: "profiles" }); }}>Edit Profile</Button>
            ) : (
              <>
                {rel?.type === "friend" ? <span className={s.badge} style={{ alignSelf: "center" }}>Friends</span> : rel?.type === "outgoing" ? <Button size="sm" variant="secondary" disabled>Request sent</Button> : rel?.type === "incoming" ? <Button size="sm" variant="positive" onClick={() => void accept()}>Accept Request</Button> : rel?.type === "blocked" ? null : <Button size="sm" variant="positive" onClick={() => void addFriend()}>Add Friend</Button>}
                <Button size="sm" onClick={() => void message()}>Message</Button>
                <Button size="sm" variant="secondary" aria-label="More" onClick={more}><MoreHorizontal size={18} /></Button>
              </>
            )}
          </div>
          <div className={s.names}>
            <div className={s.display}>
              {rel?.type === "friend" && rel.nickname ? rel.nickname : user.display_name}
              {user.flags & 1 ? <span className={s.badge}>Admin</span> : null}
              {rel?.type === "friend" && !isMe ? (
                nickEditing ? (
                  <input
                    className={s.nickInput}
                    value={nickDraft}
                    maxLength={32}
                    autoFocus
                    placeholder={user.display_name}
                    aria-label="Friend nickname"
                    onChange={(e) => setNickDraft(e.target.value)}
                    onBlur={() => void saveNickname()}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(); if (e.key === "Escape") setNickEditing(false); }}
                  />
                ) : (
                  <button className={s.nickBtn} onClick={() => { setNickDraft(rel.nickname); setNickEditing(true); }} title="Set a nickname only you see">{rel.nickname ? "edit nickname" : "add nickname"}</button>
                )
              ) : null}
            </div>
            <div className={s.user}>{rel?.type === "friend" && rel.nickname ? `${user.display_name} · ${user.username}` : user.username}{user.pronouns ? <span className={s.pronouns}> • {user.pronouns}</span> : null}</div>
            {cs ? <div className={s.status}>{cs.emoji ? cs.emoji + " " : ""}{cs.text}</div> : null}
          </div>
        </div>
        <div className={s.body}>
          {user.about_me ? (
            <div className={s.section}>
              <h4>About Me</h4>
              <div className={s.about}><Markdown source={user.about_me} ctx={ctx} /></div>
            </div>
          ) : null}
          {!isMe ? (
            <div className={s.section}>
              <h4>Note</h4>
              <textarea
                className={s.note}
                value={note}
                maxLength={256}
                placeholder="Click to add a note (only you can see it; it is stored encrypted with your settings)"
                aria-label="Note"
                onChange={(e) => {
                  const userNotes = { ...allNotes };
                  if (e.target.value) userNotes[userId] = e.target.value;
                  else delete userNotes[userId];
                  patchSettings({ userNotes });
                }}
              />
            </div>
          ) : null}
          <div className={s.section}>
            <h4>Member Since</h4>
            <p>{new Date(user.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
          </div>
          {mutual.length > 0 ? (
            <div className={s.section}>
              <h4>Mutual Friends — {mutual.length}</h4>
              {mutual.map((id) => (
                <div key={id} className={s.mutual}>
                  <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={24} />
                  <span>{displayName(users[id])}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
