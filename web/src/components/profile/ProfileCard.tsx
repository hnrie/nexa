import { Check, Clock, MessageCircle, MoreHorizontal, NotebookPen, Pencil, UserPlus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import type { PublicUser } from "@/api/types";
import { bannerUrl, iconUrl, users as usersApi } from "@/api/users";
import { ActivityList } from "@/components/activity/ActivityCard";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { Twemoji } from "@/components/common/Twemoji";
import { promptFields } from "@/components/modals/PromptModal";
import { KeyStatusChip } from "./KeyVerify";
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
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Profile.module.css";

import { t } from "@/i18n";
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

interface Props {
  userId: string;
  /** The full profile in a dialog, or the preview in the column beside a DM. */
  variant: "modal" | "panel";
  onClose?: () => void;
  /** Settings' live preview: unsaved changes over the account's own profile, with nothing to click. */
  preview?: Partial<PublicUser>;
}

/** A round button laid over the banner, as Discord's preview has them. */
function BannerButton({ label, onClick, children, testId }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode; testId?: string }) {
  return (
    <Tooltip text={label} side="bottom">
      <button className={s.bannerBtn} aria-label={label} onClick={onClick} data-testid={testId}>
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Someone's profile, laid out the way Discord lays it out: the banner, the
 * avatar sitting in a hole cut out of it, a custom status in a bubble beside
 * the avatar, the names, and then everything else straight on the card. A
 * profile with two theme colours is a gradient from top to bottom, with its
 * text and buttons turned to read on it.
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
  const [noteOpen, setNoteOpen] = useState(false);
  const [showMutual, setShowMutual] = useState(false);
  const [bioClamped, setBioClamped] = useState(false);
  const bioRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const isMe = me?.id === userId;
  const base: PublicUser | undefined = isMe && me ? me : stored;
  const user: PublicUser | undefined = base ? { ...base, ...preview } : undefined;
  const panel = variant === "panel";

  useEffect(() => {
    if (preview) return;
    let alive = true;
    // The panel beside a DM is one card that changes person rather than a new
    // one, so without this it goes on showing the last person's mutual friends
    // and servers under the new name — forever if the request fails.
    setMutual({ friends: [], servers: [] });
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

  // the preview shows the start of a long bio and offers the rest
  const about = user?.about_me ?? "";
  useLayoutEffect(() => {
    const el = bioRef.current;
    if (!panel || !el) return;
    const measure = () => setBioClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel, about]);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  if (!user) return null;
  const st = preview ? "online" : statusOf(presence);
  const cs = preview ? (user.status_text || user.status_emoji ? { text: user.status_text, emoji: user.status_emoji } : null) : customStatus(presence);
  const activities = preview ? [] : activitiesOf(presence);
  const theme = profileThemeOf(user.accent_color, user.accent_color_2);
  const banner = bannerUrl(user.banner_id, panel ? 340 : 600);
  const friend = rel?.type === "friend";
  const interactive = !preview;
  const avatarSize = panel ? 80 : 120;

  const cardStyle = { "--av": `${avatarSize}px`, ...(theme ? { "--profile-top": theme.top, "--profile-bottom": theme.bottom } : {}) } as CSSProperties;
  // with a theme and no picture the banner is see-through, so the gradient runs unbroken from the top
  const bannerStyle: CSSProperties = banner ? { backgroundImage: `url(${banner})` } : { background: theme ? "transparent" : profileTheme(user.accent_color, null, user.id) };

  const message = async () => {
    try {
      const ch = await channelsApi.createDM([userId]);
      upsertChannel(ch);
      onClose?.();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("profile.profileCard.couldNotOpenAConversation"), "error");
    }
  };
  const addFriend = async () => {
    try {
      const res = await guarded("friend_request", (captcha) => relApi.request(user.username, captcha));
      setRel({ user: res.user, type: res.type as "friend" | "outgoing", nickname: "", created_at: Date.now() });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("profile.profileCard.couldNotSendTheRequest"), "error");
    }
  };
  const accept = async () => {
    try {
      const res = await relApi.accept(userId);
      setRel({ user: res.user, type: "friend", nickname: "", created_at: Date.now() });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("profile.profileCard.couldNotAccept"), "error");
    }
  };
  const failed = (err: unknown) => toast(err instanceof ApiError ? err.message : t("profile.profileCard.couldNotUpdateThisPerson"), "error");
  const editNickname = async () => {
    if (!rel || rel.type !== "friend") return;
    const values = await promptFields({ title: t("profile.profileCard.friendNickname"), fields: [{ key: "nickname", label: t("modals.serverProfile.nickname"), initial: rel.nickname, placeholder: user.display_name, maxLength: 32, hint: t("profile.profileCard.onlyYouSeeIt") }], confirmLabel: t("chat.editMessage.save"), allowEmpty: true });
    const next = values?.["nickname"]?.trim();
    if (next === undefined || next === rel.nickname) return;
    try {
      setRel(await relApi.setNickname(userId, next));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("profile.profileCard.couldNotSaveTheNickname"), "error");
    }
  };
  const more = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem[] = [];
    if (panel) items.push({ id: "full", label: t("profile.profileCard.viewFullProfile"), onSelect: () => openModal("profile", { userId }), separatorAfter: true });
    if (friend) {
      items.push({ id: "nick", label: rel.nickname ? t("profile.profileCard.editFriendNickname") : t("profile.profileCard.addFriendNickname"), onSelect: () => void editNickname() });
      items.push({ id: "rm", label: t("profile.profileCard.removeFriend"), danger: true, onSelect: () => void relApi.remove(userId).then(() => removeRel(userId), failed) });
    }
    if (rel?.type === "blocked") items.push({ id: "unblock", label: t("friends.unblock"), onSelect: () => void relApi.unblock(userId).then(() => removeRel(userId), failed) });
    else items.push({ id: "block", label: t("profile.profileCard.block"), danger: true, onSelect: () => void relApi.block(userId).then(() => setRel({ user, type: "blocked", nickname: "", created_at: Date.now() }), failed) });
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: t("chat.groupMemberMenu.copyUserId"), onSelect: () => void navigator.clipboard?.writeText(userId) });
    openContextMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const setNote = (value: string) => {
    const userNotes = { ...allNotes };
    if (value) userNotes[userId] = value;
    else delete userNotes[userId];
    patchSettings({ userNotes });
  };

  const shownName = friend && rel.nickname ? rel.nickname : user.display_name;
  const mutualServers = mutual.servers.filter((id) => servers[id]);
  const mutualCount = mutual.friends.length + mutualServers.length;
  const viewFull = () => openModal("profile", { userId });
  const buttons = interactive && !panel;

  // the full profile leads with one clear action; the preview keeps its buttons on the banner
  const primary = !buttons ? null : isMe ? (
    <button className={s.primary} onClick={() => { onClose?.(); openModal("settings", { page: "profiles" }); }}><Pencil size={16} /> {t("profile.profileCard.editProfile")}</button>
  ) : friend ? (
    <button className={s.primary} onClick={() => void message()}><MessageCircle size={16} /> {t("profile.profileCard.message")}</button>
  ) : rel?.type === "incoming" ? (
    <button className={s.primary} onClick={() => void accept()}><Check size={16} /> {t("profile.profileCard.acceptRequest")}</button>
  ) : rel?.type === "outgoing" ? (
    <button className={s.primary} disabled><Clock size={16} /> {t("profile.profileCard.requestSent")}</button>
  ) : rel?.type === "blocked" ? null : (
    <button className={s.primary} onClick={() => void addFriend()}><UserPlus size={16} /> {t("profile.profileCard.addFriend")}</button>
  );

  return (
    <div className={s.card} data-variant={variant} data-themed={theme?.text} style={cardStyle} data-testid={`profile-${variant}`}>
      <div className={s.top}>
        <div className={s.banner} style={bannerStyle} />
        <div className={s.bannerBtns}>
          {!interactive ? null : panel ? (
            isMe ? (
              <BannerButton label={t("profile.profileCard.editProfile")} onClick={() => openModal("settings", { page: "profiles" })}><Pencil size={16} /></BannerButton>
            ) : (
              <>
                {rel?.type === "incoming" ? <BannerButton label={t("profile.profileCard.acceptFriendRequest")} onClick={() => void accept()}><Check size={18} /></BannerButton> : null}
                {!rel ? <BannerButton label={t("profile.profileCard.addFriend")} onClick={() => void addFriend()}><UserPlus size={18} /></BannerButton> : null}
                <BannerButton label={t("chat.chat.more")} onClick={more} testId="profile-more"><MoreHorizontal size={18} /></BannerButton>
              </>
            )
          ) : onClose ? (
            <BannerButton label={t("chat.attachments.close")} onClick={onClose}><X size={18} /></BannerButton>
          ) : null}
        </div>
        <div className={s.avatar}>
          {panel ? (
            <button className={s.avatarBtn} aria-label={t("profile.profileCard.viewFullProfileOf", { name: shownName })} onClick={viewFull} data-testid="profile-avatar">
              <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={avatarSize} status={st} dotSize={18} />
            </button>
          ) : (
            <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={avatarSize} status={st} dotSize={26} />
          )}
        </div>
        {cs ? (
          <div className={s.bubble} data-testid="profile-status">
            <div className={s.bubbleText}>
              {/* one inline run, so the emoji stays on the text's first line and the clamp counts lines */}
              <span>
                {cs.emoji ? <Twemoji text={cs.emoji} className={s.bubbleEmoji} /> : null}
                {cs.text}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className={s.info}>
        <div className={s.ident}>
        <div className={s.nameRow}>
          <h2 className={s.display}>
            {panel ? <button className={s.displayBtn} onClick={viewFull} data-testid="profile-name">{shownName}</button> : shownName}
          </h2>
          {interactive && !isMe ? (
            <Tooltip text={note ? t("profile.profileCard.editNote") : t("profile.profileCard.addNote")} side="top">
              <button className={s.noteBtn} aria-label={note ? t("profile.profileCard.editNote2") : t("profile.profileCard.addNote2")} onClick={() => setNoteOpen((v) => !v)} data-testid="profile-note-toggle">
                <NotebookPen size={18} />
              </button>
            </Tooltip>
          ) : null}
        </div>
        <div className={s.user}>
          <span>{friend && rel.nickname ? `${user.display_name} · ${user.username}` : user.username}</span>
          {user.pronouns ? (
            <>
              <span className={s.sep} aria-hidden="true">•</span>
              <Tooltip text={t("settings.profile.pronouns")} side="top">
                <span className={s.pronouns} data-testid="profile-pronouns">{user.pronouns}</span>
              </Tooltip>
            </>
          ) : null}
          {user.flags & 1 ? <span className={s.chip}>{t("profile.profileCard.admin")}</span> : null}
        </div>
        </div>

        {buttons && (primary || !isMe) ? (
          <div className={s.actions}>
            {primary}
            {!isMe && !friend ? (
              <Tooltip text={t("profile.profileCard.message")} side="top">
                <button className={s.square} aria-label={t("profile.profileCard.message")} onClick={() => void message()}><MessageCircle size={18} /></button>
              </Tooltip>
            ) : null}
            {!isMe ? (
              <Tooltip text={t("chat.chat.more")} side="top">
                <button className={s.square} aria-label={t("chat.chat.more")} onClick={more} data-testid="profile-more"><MoreHorizontal size={18} /></button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {interactive && !isMe && mutualCount > 0 ? (
          <button className={s.mutualRow} onClick={() => (panel ? viewFull() : setShowMutual((v) => !v))} aria-expanded={panel ? undefined : showMutual} data-testid="profile-mutual">
            {mutual.friends.length > 0 ? (
              <span className={s.stack} aria-hidden="true">
                {mutual.friends.slice(0, 3).map((id) => (
                  <Avatar key={id} id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={20} className={s.stackItem} />
                ))}
              </span>
            ) : null}
            <span>{[mutual.friends.length ? t("profile.profileCard.mutualFriendCount", { count: mutual.friends.length }) : "", mutualServers.length ? t("profile.profileCard.mutualServerCount", { count: mutualServers.length }) : ""].filter(Boolean).join(" • ")}</span>
          </button>
        ) : null}

        {interactive && !isMe && (noteOpen || note) ? (
          <div className={s.section}>
            <h3>{t("profile.profileCard.note")}</h3>
            <textarea
              ref={noteRef}
              className={s.note}
              value={note}
              maxLength={256}
              rows={2}
              placeholder={t("profile.profileCard.clickToAddANote")}
              aria-label={t("profile.profileCard.note")}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => setNoteOpen(false)}
            />
          </div>
        ) : null}

        {activities.length ? <ActivityList activities={activities} /> : null}

        {user.about_me ? (
          <div className={s.section}>
            <div ref={bioRef} className={s.about} data-clamp={panel || undefined} data-overflow={(panel && bioClamped) || undefined}>
              <Markdown source={user.about_me} ctx={ctx} />
            </div>
            {panel && bioClamped && interactive ? (
              <button className={s.moreLink} onClick={viewFull} data-testid="view-full-bio">{t("profile.profileCard.viewFullBio")}</button>
            ) : null}
          </div>
        ) : null}

        {user.public_key && interactive ? (
          <div className={s.section} data-testid="profile-key">
            <h3>{t("encryption.encryptionKey")}</h3>
            <p><KeyStatusChip userId={userId} onClick={() => openModal("verifyKey", { userId })} /></p>
          </div>
        ) : null}

        <div className={s.sinceRow}>
          <div className={s.section}>
            <h3>{t("profile.profileCard.memberSince")}</h3>
            <p>{dateOf(user.created_at)}</p>
          </div>
          {friend && !isMe && rel.created_at ? (
            <div className={s.section} data-testid="friends-since">
              <h3>{t("profile.profileCard.friendsSince")}</h3>
              <p>{dateOf(rel.created_at)}</p>
            </div>
          ) : null}
        </div>

        {!panel && showMutual && mutualServers.length > 0 ? (
          <div className={s.section}>
            <h3>{t("profile.profileCard.mutualServersCount", { count: mutualServers.length })}</h3>
            {mutualServers.map((id) => {
              const server = servers[id]!.server;
              const icon = iconUrl(server.icon_id, 32);
              return (
                <button key={id} className={s.listItem} onClick={() => { onClose?.(); nav(`/channels/${id}`); }}>
                  {icon ? <img className={s.listIcon} src={icon} alt="" /> : <span className={s.listInitial}>{server.name.slice(0, 1).toUpperCase()}</span>}
                  <span>{server.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {!panel && showMutual && mutual.friends.length > 0 ? (
          <div className={s.section}>
            <h3>{t("profile.profileCard.mutualFriendsCount", { count: mutual.friends.length })}</h3>
            {mutual.friends.map((id) => (
              <button key={id} className={s.listItem} onClick={() => openModal("profile", { userId: id })}>
                <Avatar id={id} avatarId={users[id]?.avatar_id ?? null} name={displayName(users[id])} size={32} />
                <span>{displayName(users[id])}</span>
              </button>
            ))}
          </div>
        ) : null}

        {interactive && panel ? (
          <button className={s.fullBtn} onClick={viewFull} data-testid="view-full-profile">{t("profile.profileCard.viewFullProfile")}</button>
        ) : null}
      </div>
    </div>
  );
}
