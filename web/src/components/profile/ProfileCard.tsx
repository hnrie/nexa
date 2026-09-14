import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import type { PublicUser } from "@/api/types";
import { bannerUrl, iconUrl, users as usersApi } from "@/api/users";
import { ActivityList } from "@/components/activity/ActivityCard";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Tooltip } from "@/components/common/Tooltip";
import { Twemoji } from "@/components/common/Twemoji";
import { profileTheme, profileThemeOf } from "@/lib/avatarColor";
import { guarded } from "@/lib/captcha";
import { useRenderCtx } from "@/lib/markdownCtx";
import { Markdown } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { activitiesOf, customStatus, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Profile.module.css";

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

interface Props {
  userId: string;
  /** A dialog with the person's buttons, or the column beside a DM. */
  variant: "modal" | "panel";
  onClose?: () => void;
  /** Settings' live preview: unsaved changes over the account's own profile, with nothing to click. */
  preview?: Partial<PublicUser>;
}

/**
 * Someone's profile: banner, avatar and names, what they are doing, about
 * them, since when, and what you share. A profile with two theme colours is a
 * gradient from top to bottom, with its text and panels turned to read on it.
 */
export function ProfileCard({ userId, variant, onClose, preview }: Props) {
  const nav = useNavigate();
  const me = useAuth((a) => a.me);
  const stored = useUsers((u) => u.byId[userId]);
  const upsertUser = useUsers((u) => u.upsert);
  const users = useUsers((u) => u.byId);
  const rel = useRelationships((r) => r.byUser[userId]);
  const setRel = useRelationships((r) => r.set);
  const removeRel = useRelationships((r) => r.remove);
  const presence = usePresence((p) => p.byUser[userId]);
  const servers = useServers((st) => st.byId);
  const upsertChannel = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const openContextMenu = useUI((u) => u.openContextMenu);
  const note = useSettings((st) => st.settings.userNotes[userId] ?? "");
  const allNotes = useSettings((st) => st.settings.userNotes);
  const patchSettings = useSettings((st) => st.patch);
  const ctx = useRenderCtx();
  const [mutual, setMutual] = useState<{ friends: string[]; servers: string[] }>({ friends: [], servers: [] });
  const [nickEditing, setNickEditing] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const isMe = me?.id === userId;
  const base: PublicUser | undefined = isMe && me ? me : stored;
  const user: PublicUser | undefined = base ? { ...base, ...preview } : undefined;

  useEffect(() => {
    if (preview) return;
    let alive = true;
    usersApi
      .profile(userId)
      .then((p) => {
        if (!alive) return;
        upsertUser(p.user);
        setMutual({ friends: p.mutual_friends, servers: p.mutual_servers ?? [] });
      })
      .catch(() => {
        /* a profile already on hand still shows; the dialog says when there is none */
      });
    return () => {
      alive = false;
    };
  }, [userId, upsertUser, preview]);

  if (!user) return null;
  const st = preview ? "online" : statusOf(presence);
  const cs = preview ? (user.status_text || user.status_emoji ? { text: user.status_text, emoji: user.status_emoji } : null) : customStatus(presence);
  const activities = preview ? [] : activitiesOf(presence);
  const theme = profileThemeOf(user.accent_color, user.accent_color_2);
  const banner = bannerUrl(user.banner_id, variant === "modal" ? 600 : 340);
  const friend = rel?.type === "friend";
  const interactive = !preview;

  const cardStyle: CSSProperties | undefined = theme ? ({ "--profile-top": theme.top, "--profile-bottom": theme.bottom } as CSSProperties) : undefined;
  // with a theme and no picture the banner is see-through, so the gradient runs unbroken from the top
  const bannerStyle: CSSProperties = banner ? { backgroundImage: `url(${banner})` } : { background: theme ? "transparent" : profileTheme(user.accent_color, null, user.id) };

  const message = async () => {
    try {
      const ch = await channelsApi.createDM([userId]);
      upsertChannel(ch);
      onClose?.();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open a conversation.", "error");
    }
  };
  const addFriend = async () => {
    try {
      const res = await guarded("friend_request", (captcha) => relApi.request(user.username, captcha));
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
  const failed = (err: unknown) => toast(err instanceof ApiError ? err.message : "Could not update this person.", "error");
  const more = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        ...(friend ? [{ id: "rm", label: "Remove Friend", danger: true, onSelect: () => void relApi.remove(userId).then(() => removeRel(userId), failed) }] : []),
        ...(rel?.type === "blocked"
          ? [{ id: "unblock", label: "Unblock", onSelect: () => void relApi.unblock(userId).then(() => removeRel(userId), failed) }]
          : [{ id: "block", label: "Block", danger: true, onSelect: () => void relApi.block(userId).then(() => setRel({ user, type: "blocked", nickname: "", created_at: Date.now() }), failed) }]),
        { id: "copy", label: "Copy User ID", onSelect: () => void navigator.clipboard?.writeText(userId) },
      ],
    });
  };
  const saveNickname = async () => {
    setNickEditing(false);
    if (!rel || rel.type !== "friend" || nickDraft.trim() === rel.nickname) return;
    try {
      setRel(await relApi.setNickname(userId, nickDraft.trim()));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the nickname.", "error");
    }
  };

  const shownName = friend && rel.nickname ? rel.nickname : user.display_name;
  const mutualServers = mutual.servers.filter((id) => servers[id]);

  return (
    <div className={s.card} data-variant={variant} data-themed={theme?.text} style={cardStyle} data-testid={`profile-${variant}`}>
      {variant === "modal" && onClose ? <button className={s.close} aria-label="Close profile" onClick={onClose}><X size={20} /></button> : null}
      <div className={s.banner} style={bannerStyle} />
      <div className={s.head}>
        <div className={s.avatar}><Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={variant === "modal" ? 80 : 80} status={st} /></div>
        <div className={s.actions}>
          {!interactive || variant === "panel" ? null : isMe ? (
            <Button size="sm" onClick={() => { onClose?.(); openModal("settings", { page: "profiles" }); }}>Edit Profile</Button>
          ) : (
            <>
              {friend ? <span className={s.badge} style={{ alignSelf: "center" }}>Friends</span> : rel?.type === "outgoing" ? <Button size="sm" variant="secondary" disabled>Request sent</Button> : rel?.type === "incoming" ? <Button size="sm" variant="positive" onClick={() => void accept()}>Accept Request</Button> : rel?.type === "blocked" ? null : <Button size="sm" variant="positive" onClick={() => void addFriend()}>Add Friend</Button>}
              <Button size="sm" onClick={() => void message()}>Message</Button>
              <Button size="sm" variant="secondary" aria-label="More" onClick={more}><MoreHorizontal size={18} /></Button>
            </>
          )}
        </div>
        <div className={s.names}>
          <div className={s.display}>
            <span className={s.displayText}>{shownName}</span>
            {user.flags & 1 ? <span className={s.badge}>Admin</span> : null}
            {interactive && friend && !isMe && variant === "modal" ? (
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveNickname();
                    if (e.key === "Escape") setNickEditing(false);
                  }}
                />
              ) : (
                <button className={s.nickBtn} onClick={() => { setNickDraft(rel.nickname); setNickEditing(true); }} title="Set a nickname only you see">{rel.nickname ? "edit nickname" : "add nickname"}</button>
              )
            ) : null}
          </div>
          <div className={s.user}>
            <span>{friend && rel.nickname ? `${user.display_name} · ${user.username}` : user.username}</span>
            {user.pronouns ? (
              <>
                <span className={s.sep} aria-hidden="true">•</span>
                <Tooltip text="Pronouns" side="top">
                  <span className={s.pronouns} data-testid="profile-pronouns">{user.pronouns}</span>
                </Tooltip>
              </>
            ) : null}
          </div>
          {cs ? (
            <div className={s.status}>
              {cs.emoji ? <Twemoji text={cs.emoji} className={s.statusEmoji} /> : null}
              {cs.text ? <span>{cs.text}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className={s.body}>
        {activities.length ? <ActivityList activities={activities} /> : null}
        {user.about_me ? (
          <div className={s.section}>
            <h4>About Me</h4>
            <div className={s.about}><Markdown source={user.about_me} ctx={ctx} /></div>
          </div>
        ) : null}
        <div className={s.sinceRow}>
          <div className={s.section}>
            <h4>Member Since</h4>
            <p>{dateOf(user.created_at)}</p>
          </div>
          {friend && !isMe && rel.created_at ? (
            <div className={s.section} data-testid="friends-since">
              <h4>Friends Since</h4>
              <p>{dateOf(rel.created_at)}</p>
            </div>
          ) : null}
        </div>
        {interactive && mutualServers.length > 0 ? (
          <div className={s.section}>
            <h4>Mutual Servers — {mutualServers.length}</h4>
            {mutualServers.map((id) => {
              const server = servers[id]!.server;
              const icon = iconUrl(server.icon_id, 24);
              return (
                <button key={id} className={s.mutual} onClick={() => { onClose?.(); nav(`/channels/${id}`); }}>
                  {icon ? <img className={s.mutualIcon} src={icon} alt="" /> : <span className={s.mutualInitial}>{server.name.slice(0, 1).toUpperCase()}</span>}
                  <span>{server.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {interactive && mutual.friends.length > 0 ? (
          <div className={s.section}>
            <h4>Mutual Friends — {mutual.friends.length}</h4>
            {mutual.friends.map((id) => (
              <button key={id} className={s.mutual} onClick={() => openModal("profile", { userId: id })}>
                <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={24} />
                <span>{displayName(users[id])}</span>
              </button>
            ))}
          </div>
        ) : null}
        {interactive && !isMe ? (
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
        {interactive && variant === "panel" ? (
          <Button variant="secondary" block onClick={() => openModal("profile", { userId })} data-testid="view-full-profile">View Full Profile</Button>
        ) : null}
      </div>
    </div>
  );
}
