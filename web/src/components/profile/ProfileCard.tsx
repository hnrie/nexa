import { NexaProfile } from "@/components/nexa/NexaProfile";
import { isSystemAccount } from "@/lib/moderation";
import { Link2, LoaderCircle, MessageCircle, MoreHorizontal, NotebookPen, Pencil, UserPlus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { dmOpenError } from "@/lib/errors";
import { channels as channelsApi } from "@/api/channels";
import { relationships as relApi } from "@/api/relationships";
import { confirmRemoveFriend, openBlockDialog, sendFriendRequest, unblockUser, useBusyWith } from "@/lib/friendship";
import type { PublicUser } from "@/api/types";
import { avatarUrl, bannerUrl, iconUrl, users as usersApi } from "@/api/users";
import { ActivityList } from "@/components/activity/ActivityCard";
import { Avatar } from "@/components/common/Avatar";
import { AdminBadge, OwnerBadge } from "@/components/common/OwnerBadge";
import { isOwner } from "@/lib/owner";
import { Tooltip } from "@/components/common/Tooltip";
import { Twemoji } from "@/components/common/Twemoji";
import { promptFields } from "@/components/modals/PromptModal";
import { KeyStatusChip } from "./KeyVerify";
import { RelationshipBar, relationshipLine } from "./RelationshipBar";
import { profileTheme, profileThemeOf } from "@/lib/avatarColor";
import { copyText } from "@/lib/clipboard";
import { copyProfileLink } from "@/lib/profileLinks";
import { useDominantColor } from "@/lib/dominantColor";
import { formatShortDate } from "@/lib/time";
import { useRenderCtx } from "@/lib/markdownCtx";
import { Markdown } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { activitiesOf, customStatus, statusOf, usePresence } from "@/stores/presence";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { servers as serversApi } from "@/api/servers";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Profile.module.css";

import { t } from "@/i18n";
// in the app's language, not the browser's (lib/time)
const dateOf = formatShortDate;

interface Props {
  userId: string;
  /** The full profile in a dialog, or the preview in the column beside a DM. */
  variant: "modal" | "panel";
  onClose?: () => void;
  /** Settings' live preview: unsaved changes over the account's own profile, with nothing to click. */
  preview?: Partial<PublicUser>;
  /** The server it was opened from; otherwise the server being looked at, if any. */
  serverId?: string;
  /**
   * A profile opened from its link by someone who may have no account
   * (pages/ProfilePage): the card as the app draws it, from the profile the
   * link shows, with the visitor's own way in where the person's buttons go,
   * and nothing that needs an account (status, notes, mutuals, the key).
   */
  visitor?: { user: PublicUser; actions: ReactNode };
}

/** The server whose page is open, which a profile opened from it belongs to. */
function useServerInView(explicit: string | undefined): string | null {
  const loc = useLocation();
  const fromPath = /^\/channels\/(\d+)(?:\/|$)/.exec(loc.pathname)?.[1] ?? null;
  const id = explicit ?? fromPath;
  return useServers((st) => (id && st.byId[id] ? id : null));
}

/**
 * Someone's roles in the server their profile was opened from, highest first,
 * each in its colour, and when they joined it. A big server's members arrive a
 * page at a time, so one who is not loaded yet is asked for.
 */
function ServerRoles({ serverId, userId }: { serverId: string; userId: string }) {
  const server = useServers((st) => st.byId[serverId]);
  const member = server?.members[userId];
  const upsertMember = useServers((st) => st.upsertMember);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (member || missing) return;
    let alive = true;
    serversApi
      .member(serverId, userId)
      .then((m) => alive && upsertMember(m))
      // not (or no longer) a member: there is nothing of theirs here to show
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [serverId, userId, member, missing, upsertMember]);
  if (!server || !member) return null;
  const roles = member.role_ids
    .map((id) => server.roles[id])
    .filter((r): r is NonNullable<typeof r> => !!r && r.id !== serverId)
    .sort((a, b) => b.position - a.position);
  return (
    <>
      <div className={s.section} data-testid="profile-roles">
        <h3>{t("profile.profileCard.rolesIn", { server: server.server.name })}</h3>
        {roles.length ? (
          <ul className={s.roles}>
            {roles.map((r) => (
              <li key={r.id} className={s.role}>
                <span className={s.roleDot} style={r.color ? { background: `#${r.color.toString(16).padStart(6, "0")}` } : undefined} aria-hidden="true" />
                <span className={s.roleName} dir="auto">{r.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.noRoles}>{t("profile.profileCard.noRoles")}</p>
        )}
      </div>
      <div className={s.section}>
        <h3>{t("profile.profileCard.joinedServer", { server: server.server.name })}</h3>
        <p>{dateOf(member.joined_at)}</p>
      </div>
    </>
  );
}

/** A round button laid over the banner, as Discord's preview has them. */
function BannerButton({ label, onClick, children, testId, busy }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode; testId?: string; busy?: boolean }) {
  return (
    <Tooltip text={label} side="bottom">
      <button className={s.bannerBtn} aria-label={label} onClick={onClick} data-testid={testId} disabled={busy} aria-busy={busy || undefined}>
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
export function ProfileCard({ userId, variant, onClose, preview, serverId, visitor }: Props) {
  const nav = useNavigate();
  const inServer = useServerInView(serverId);
  const me = useAuth((a) => a.me);
  const stored = useUsers((u) => u.byId[userId]);
  const upsertUser = useUsers((u) => u.upsert);
  const users = useUsers((u) => u.byId);
  const rel = useRelationships((r) => r.byUser[userId]);
  const setRel = useRelationships((r) => r.set);
  // a friend request can wait on a captcha check: the button says it is on its way
  const busy = useBusyWith(userId);
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
  const isMe = !visitor && me?.id === userId;
  const base: PublicUser | undefined = visitor ? visitor.user : isMe && me ? me : stored;
  const user: PublicUser | undefined = base ? { ...base, ...preview } : undefined;
  const panel = variant === "panel";

  useEffect(() => {
    if (preview || visitor) return;
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
  }, [userId, upsertUser, preview, visitor]);

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

  // A profile without colours of its own takes a glow from its banner, or its
  // picture: every card then looks like the person's own, not like the next one.
  const themed = !!user && !!profileThemeOf(user.accent_color, user.accent_color_2);
  const tintFrom = !user || themed ? null : (bannerUrl(user.banner_id, 64) ?? avatarUrl(user.avatar_id, 64));
  const tint = useDominantColor(tintFrom);

  if (!user) return null;
  // the system account is not a person, and says so
  if (isSystemAccount(user.flags)) return <NexaProfile variant={variant} onClose={onClose} />;
  // a visitor sees nothing of where someone is right now
  const st = visitor ? null : preview ? "online" : statusOf(presence);
  const cs = visitor ? null : preview ? (user.status_text || user.status_emoji ? { text: user.status_text, emoji: user.status_emoji } : null) : customStatus(presence);
  const activities = preview || visitor ? [] : activitiesOf(presence);
  const theme = profileThemeOf(user.accent_color, user.accent_color_2);
  const banner = bannerUrl(user.banner_id, panel ? 340 : 600);
  const friend = !visitor && rel?.type === "friend";
  const interactive = !preview && !visitor;
  const avatarSize = panel ? 80 : 120;

  const colours: Record<string, string> = theme ? { "--profile-top": theme.top, "--profile-bottom": theme.bottom } : tint ? { "--profile-tint": tint } : {};
  const cardStyle = { "--av": `${avatarSize}px`, ...colours } as CSSProperties;
  // with a theme and no picture the banner is see-through, so the gradient runs unbroken from the top
  const bannerStyle: CSSProperties = banner ? { backgroundImage: `url(${banner})` } : { background: theme ? "transparent" : profileTheme(user.accent_color, null, user.id) };

  const message = async () => {
    try {
      const ch = await channelsApi.createDM([userId]);
      upsertChannel(ch);
      onClose?.();
      nav(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(dmOpenError(err, t("profile.profileCard.couldNotOpenAConversation")), "error");
    }
  };
  const addFriend = () => void sendFriendRequest(user);
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
      // asked first, as the friends list asks: neither is quick to take back
      items.push({ id: "rm", label: t("profile.profileCard.removeFriend"), danger: true, onSelect: () => confirmRemoveFriend(user) });
    }
    // one block dialog everywhere, with its choices about their messages
    if (rel?.type === "blocked") items.push({ id: "unblock", label: t("friends.unblock"), onSelect: () => void unblockUser(userId) });
    else items.push({ id: "block", label: t("profile.profileCard.block"), danger: true, onSelect: () => openBlockDialog(userId) });
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: t("chat.groupMemberMenu.copyUserId"), onSelect: () => void copyText(userId, t("clipboard.idCopied")) });
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
  const copyLink = () => copyProfileLink(user.username);

  // the full profile leads with one clear action; the preview keeps its buttons on the banner
  // (a request either way, or a block, is said by the bar under the names, with its own buttons)
  const primary = !buttons ? null : isMe ? (
    <button className={s.primary} onClick={() => { onClose?.(); openModal("settings", { page: "profiles" }); }}><Pencil size={16} /> {t("profile.profileCard.editProfile")}</button>
  ) : rel?.type === "blocked" ? null : rel ? (
    <button className={s.primary} onClick={() => void message()}><MessageCircle size={16} /> {t("profile.profileCard.message")}</button>
  ) : (
    <button className={s.primary} onClick={addFriend} disabled={busy} aria-busy={busy || undefined} data-testid="profile-add-friend">
      {busy ? <LoaderCircle size={16} className={s.spin} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />} {busy ? t("people.request.sending") : t("profile.profileCard.addFriend")}
    </button>
  );

  return (
    <div className={s.card} data-variant={variant} data-themed={theme?.text} data-tinted={!theme && tint ? "" : undefined} style={cardStyle} data-testid={`profile-${variant}`}>
      <div className={s.top}>
        <div className={s.banner} style={bannerStyle} />
        <div className={s.bannerBtns}>
          {!interactive ? null : panel ? (
            isMe ? (
              <>
                <BannerButton label={t("profile.profileCard.editProfile")} onClick={() => openModal("settings", { page: "profiles" })}><Pencil size={16} /></BannerButton>
                <BannerButton label={t("profileLink.copy")} onClick={copyLink} testId="profile-copy-link"><Link2 size={18} /></BannerButton>
              </>
            ) : (
              <>
                {!rel ? (
                  <BannerButton label={busy ? t("people.request.sending") : t("profile.profileCard.addFriend")} onClick={addFriend} busy={busy} testId="profile-add-friend">
                    {busy ? <LoaderCircle size={18} className={s.spin} /> : <UserPlus size={18} />}
                  </BannerButton>
                ) : null}
                <BannerButton label={t("profileLink.copy")} onClick={copyLink} testId="profile-copy-link"><Link2 size={18} /></BannerButton>
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
          {/* A nickname you gave hides their own name, so it is added here; a name the line already shows is not said twice. */}
          {friend && rel.nickname && user.display_name && user.display_name !== rel.nickname && user.display_name.toLowerCase() !== user.username.toLowerCase() ? (
            <>
              <span>{user.display_name}</span>
              <span className={s.sep} aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{user.username}</span>
          {user.pronouns ? (
            <>
              <span className={s.sep} aria-hidden="true">·</span>
              <Tooltip text={t("settings.profile.pronouns")} side="top">
                <span className={s.pronouns} data-testid="profile-pronouns">{user.pronouns}</span>
              </Tooltip>
            </>
          ) : null}
          {isOwner(user.id) ? <OwnerBadge /> : user.flags & 1 ? <AdminBadge /> : null}
        </div>
        </div>

        {interactive && !isMe ? <RelationshipBar user={user} rel={rel} /> : null}
        {/* read out when it changes: the button pressed has gone, and this is what took its place */}
        {interactive && !isMe ? <span className="visually-hidden" aria-live="polite">{relationshipLine(rel)}</span> : null}

        {visitor ? <div className={s.actions} data-testid="profile-visitor-actions">{visitor.actions}</div> : null}
        {buttons ? (
          <div className={s.actions}>
            {primary}
            {!isMe && !rel ? (
              <Tooltip text={t("profile.profileCard.message")} side="top">
                <button className={s.square} aria-label={t("profile.profileCard.message")} onClick={() => void message()}><MessageCircle size={18} /></button>
              </Tooltip>
            ) : null}
            <Tooltip text={t("profileLink.copy")} side="top">
              <button className={s.square} aria-label={t("profileLink.copy")} onClick={copyLink} data-testid="profile-copy-link"><Link2 size={18} /></button>
            </Tooltip>
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

        <div className={s.sheet}>
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
              <h3>{t("settings.profile.aboutMe")}</h3>
              <div ref={bioRef} className={s.about} data-clamp={panel || undefined} data-overflow={(panel && bioClamped) || undefined}>
                <Markdown source={user.about_me} ctx={ctx} />
              </div>
              {panel && bioClamped && interactive ? (
                <button className={s.moreLink} onClick={viewFull} data-testid="view-full-bio">{t("profile.profileCard.viewFullBio")}</button>
              ) : null}
            </div>
          ) : null}

          {inServer && interactive ? <ServerRoles serverId={inServer} userId={userId} /> : null}

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
        </div>

        {interactive && panel ? (
          <button className={s.fullBtn} onClick={viewFull} data-testid="view-full-profile">{t("profile.profileCard.viewFullProfile")}</button>
        ) : null}
      </div>
    </div>
  );
}
