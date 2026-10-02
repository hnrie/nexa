import { RotateCw, UserX } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { PublicUser, UnfurlResult } from "@/api/types";
import { bannerUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import v from "@/components/invite/Invite.module.css";
import { t } from "@/i18n";
import { MAX_PROFILE_CARDS, profileLinksIn, type ProfileLinkRef } from "@/lib/appLinks";
import { profileTheme } from "@/lib/avatarColor";
import { useRenderCtx } from "@/lib/markdownCtx";
import { loadSharedProfile, useSharedProfile } from "@/lib/profileLinks";
import { Markdown } from "@/markdown";
import { useUI } from "@/stores/ui";
import s from "./ProfileCards.module.css";

/** One card per profile a message links to, even when the sender's device made no preview for it. */
function cardLinks(nodes: unknown, embeds: UnfurlResult[] | null | undefined): ProfileLinkRef[] {
  const out = profileLinksIn(nodes);
  for (const e of embeds ?? []) {
    if (!e || e.type !== "profile" || typeof e.username !== "string" || !/^[a-z0-9_.]{2,32}$/.test(e.username)) continue;
    if (!out.some((l) => l.username === e.username) && out.length < MAX_PROFILE_CARDS) out.push({ username: e.username, url: e.url });
  }
  return out;
}

/**
 * The profiles under a message, each drawn as the person's card: their
 * banner (or their colours), their picture, their names and the start of
 * their about me, with View Profile. Each card asks the server itself, so it
 * shows the profile as it is now and a link sent without a preview gets one
 * too. It wears the invite card's frame, so every link to Nexa reads alike.
 */
export function ProfileCards({ nodes, embeds }: { nodes: unknown; embeds: UnfurlResult[] | null | undefined }) {
  const links = useMemo(() => cardLinks(nodes, embeds), [nodes, embeds]);
  if (links.length === 0) return null;
  return (
    <div className={s.cards}>
      {links.map((l) => <ProfileLinkCard key={l.username} username={l.username} />)}
    </div>
  );
}

function ProfileLinkCard({ username }: { username: string }) {
  const entry = useSharedProfile(username);
  if (entry?.status === "missing") {
    return (
      <div className={v.view} data-variant="card" data-gone="true" role="group" aria-label={t("profileLink.missingTitle")} data-testid="profile-card" data-profile-state="missing">
        <div className={v.gone}>
          <span className={v.goneIcon} aria-hidden="true"><UserX size={22} /></span>
          <div className={v.goneText}>
            <p className={v.goneTitle}>{t("profileLink.missingTitle")}</p>
            <p className={v.goneBody}>{t("profileLink.missingBody")}</p>
          </div>
        </div>
      </div>
    );
  }
  if (entry?.status === "failed") {
    return (
      <div className={v.view} data-variant="card" data-gone="true" data-testid="profile-card" data-profile-state="failed">
        <div className={v.gone}>
          <div className={v.goneText}>
            <p className={v.goneTitle}>{t("profileLink.couldNotLoad")}</p>
            <p className={v.goneBody}>{t("invite.checkYourConnection")}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void loadSharedProfile(username, { force: true })}><RotateCw size={14} aria-hidden="true" /> {t("invite.tryAgain")}</Button>
        </div>
      </div>
    );
  }
  if (entry?.status !== "ready") return <ProfileCardSkeleton />;
  return <ProfileCardView user={entry.user} />;
}

function ProfileCardView({ user }: { user: PublicUser }) {
  const ctx = useRenderCtx();
  const [bannerFailed, setBannerFailed] = useState(false);
  const banner = bannerFailed ? null : bannerUrl(user.banner_id, 480);
  const name = user.display_name || user.username;
  const open = () => useUI.getState().openModal("profile", { userId: user.id });
  return (
    <div className={v.view} data-variant="card" role="group" aria-label={t("profileLink.cardLabel", { name })} data-testid="profile-card" data-profile-state="ready">
      {banner ? (
        <div className={v.band} data-kind="banner">
          <img className={v.bandImg} src={banner} alt="" draggable={false} onError={() => setBannerFailed(true)} />
        </div>
      ) : (
        // their colours, as their profile shows them without a banner
        <div className={v.band} data-kind="plain" style={{ "--band-color": profileTheme(user.accent_color, user.accent_color_2, user.id) } as CSSProperties} />
      )}
      <div className={v.top}>
        <button type="button" className={s.ring} onClick={open} aria-label={t("profile.profileCard.viewFullProfileOf", { name })} tabIndex={-1}>
          <Avatar id={user.id} avatarId={user.avatar_id} name={name} size={56} />
        </button>
      </div>
      <div className={v.body}>
        <div className={v.main}>
          <p className={v.name}><bdi>{name}</bdi></p>
          <p className={s.handle}>
            <bdi>{user.username}</bdi>
            {user.pronouns ? (
              <>
                <span aria-hidden="true">·</span>
                <bdi>{user.pronouns}</bdi>
              </>
            ) : null}
          </p>
        </div>
        <div className={v.cardActions}>
          <Button size="sm" variant="secondary" onClick={open} data-testid="profile-card-view">{t("profileLink.viewProfile")}</Button>
        </div>
        {user.about_me ? (
          <div className={s.about} dir="auto">
            <Markdown source={user.about_me} ctx={ctx} inline />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The same frame while the server is asked, so nothing jumps when it answers. */
function ProfileCardSkeleton() {
  return (
    <div className={v.view} data-variant="card" data-loading="true" aria-busy="true" data-testid="profile-card" data-profile-state="loading">
      <span className="visually-hidden">{t("profileLink.loading")}</span>
      <div className={v.band} data-kind="plain" />
      <div className={v.top}>
        <span className={s.ring}><span className={s.blank} /></span>
      </div>
      <div className={v.body}>
        <div className={v.main}>
          <span className={v.bar} data-w="name" />
          <span className={v.bar} data-w="counts" />
        </div>
      </div>
    </div>
  );
}
