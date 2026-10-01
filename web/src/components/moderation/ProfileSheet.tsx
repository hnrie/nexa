import { CalendarDays, ChevronRight, Clock, Copy, Crown, Eraser, ImageOff, ShieldCheck, UserRoundX } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ModMembership, ModUser, ResetField } from "@/api/moderation";
import { bannerUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Twemoji } from "@/components/common/Twemoji";
import { profileTheme } from "@/lib/avatarColor";
import { copyAndSay } from "@/lib/copyText";
import { useRenderCtx } from "@/lib/markdownCtx";
import { FLAG_ADMIN, FLAG_DELETED, FLAG_DISABLED, fieldLabel, fullDate, previewText } from "@/lib/moderation";
import { formatRelative, formatShortDate } from "@/lib/time";
import { Markdown } from "@/markdown";
import { usePresence } from "@/stores/presence";
import { t } from "@/i18n";
import { modStatus } from "./ModStatus";
import type { ModerateIntent } from "./PersonPage";
import p from "./Sheet.module.css";

/** The parts of a profile the preview can point at while a field is looked at. */
type Part = "avatar" | "banner" | "display_name" | "username" | "pronouns" | "about_me" | "status" | null;

interface Props {
  user: ModUser;
  servers: ModMembership[];
  /** The owner of Nexa, whom nobody can moderate. */
  owner: boolean;
  onModerate: (intent: ModerateIntent) => void;
  onOpenServer: (id: string) => void;
}

function blockedText(b: ModUser["blocked"]): string {
  switch (b) {
    case "self":
      return t("moderation.blocked.self");
    case "owner":
      return t("moderation.blocked.owner");
    case "staff":
      return t("moderation.blocked.staff");
    default:
      return "";
  }
}

/**
 * A person's profile for the staff: on one side as everyone sees it, on the
 * other every part of it that anyone can see, each with the way to take it
 * down. Looking at a part lights it up on the profile, so what an action
 * touches is never in doubt.
 */
export function ProfileSheet({ user, servers, owner, onModerate, onOpenServer }: Props) {
  const [hl, setHl] = useState<Part>(null);
  const deleted = (user.admin_flags & FLAG_DELETED) !== 0;
  const blocked = deleted ? t("moderation.user.deleted") : blockedText(user.blocked);
  const locked = !!blocked;
  const reset = (f: ResetField) => onModerate({ action: "field_reset", preset: { fields: [f] } });
  const status = [user.status_emoji, user.status_text].filter(Boolean).join(" ");
  const nicknamed = servers.filter((s) => s.nickname);
  const owned = servers.filter((s) => s.owner);

  const rows: { part: Part; label: string; value: ReactNode; empty: boolean; action: string; icon: ReactNode; danger?: boolean; run: () => void; testid: string }[] = [
    {
      part: "avatar",
      label: t("moderation.field.avatar"),
      value: user.avatar_id ? <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={36} /> : t("moderation.sheet.notSet"),
      empty: !user.avatar_id,
      action: t("moderation.sheet.remove"),
      icon: <ImageOff size={15} aria-hidden="true" />,
      run: () => onModerate({ action: "avatar_remove", preset: { images: { avatar: true, banner: false } } }),
      testid: "sheet-avatar",
    },
    {
      part: "banner",
      label: t("moderation.field.banner"),
      value: user.banner_id ? <span className={p.bannerThumb} style={{ backgroundImage: `url(${bannerUrl(user.banner_id, 240)})` }} role="img" aria-label={t("moderation.field.banner")} /> : t("moderation.sheet.notSet"),
      empty: !user.banner_id,
      action: t("moderation.sheet.remove"),
      icon: <ImageOff size={15} aria-hidden="true" />,
      run: () => onModerate({ action: "avatar_remove", preset: { images: { avatar: false, banner: true } } }),
      testid: "sheet-banner",
    },
    { part: "display_name", label: fieldLabel("display_name"), value: <bdi>{user.display_name}</bdi>, empty: false, action: t("moderation.sheet.reset"), icon: <Eraser size={15} aria-hidden="true" />, run: () => reset("display_name"), testid: "sheet-display_name" },
    { part: "username", label: fieldLabel("username"), value: <bdi>@{user.username}</bdi>, empty: false, action: t("moderation.sheet.reset"), icon: <Eraser size={15} aria-hidden="true" />, run: () => reset("username"), testid: "sheet-username" },
    { part: "pronouns", label: fieldLabel("pronouns"), value: user.pronouns ? <bdi>{user.pronouns}</bdi> : t("moderation.sheet.notSet"), empty: !user.pronouns, action: t("moderation.sheet.reset"), icon: <Eraser size={15} aria-hidden="true" />, run: () => reset("pronouns"), testid: "sheet-pronouns" },
    {
      part: "about_me",
      label: fieldLabel("about_me"),
      value: user.about_me ? <span className={p.clip2} dir="auto">{previewText(user.about_me)}</span> : t("moderation.sheet.notSet"),
      empty: !user.about_me,
      action: t("moderation.sheet.reset"),
      icon: <Eraser size={15} aria-hidden="true" />,
      run: () => reset("about_me"),
      testid: "sheet-about_me",
    },
    {
      part: "status",
      label: fieldLabel("status"),
      value: status ? (
        <span className={p.inline}>
          {user.status_emoji ? <Twemoji text={user.status_emoji} className={p.emoji} /> : null}
          <bdi>{user.status_text}</bdi>
        </span>
      ) : (
        t("moderation.sheet.notSet")
      ),
      empty: !status,
      action: t("moderation.sheet.clear"),
      icon: <Eraser size={15} aria-hidden="true" />,
      run: () => reset("status"),
      testid: "sheet-status",
    },
    {
      part: null,
      label: fieldLabel("nicknames"),
      value: nicknamed.length ? (
        <ul className={p.nickList}>
          {nicknamed.map((s) => (
            <li key={s.server_id}>
              <span className={p.nickServer}>{s.name}</span>
              <bdi className={p.nick}>{s.nickname}</bdi>
            </li>
          ))}
        </ul>
      ) : (
        t("moderation.sheet.none")
      ),
      empty: nicknamed.length === 0,
      action: t("moderation.sheet.resetAll"),
      icon: <Eraser size={15} aria-hidden="true" />,
      run: () => reset("nicknames"),
      testid: "sheet-nicknames",
    },
  ];

  return (
    <div className={p.scroll}>
      <div className={p.sheet} data-testid="profile-sheet">
        <PublicFace user={user} hl={hl} />

        <div className={p.column}>
          <section className={p.panel} aria-labelledby="sheet-public">
            <header className={p.panelHead}>
              <h3 id="sheet-public" className={p.panelTitle}>{t("moderation.sheet.publicTitle")}</h3>
              <p className={p.panelHint}>{locked ? blocked : t("moderation.sheet.publicHint")}</p>
            </header>
            <ul className={p.rows}>
              {rows.map((r) => (
                <li
                  key={r.label}
                  className={p.row}
                  data-empty={r.empty || undefined}
                  onMouseEnter={() => setHl(r.part)}
                  onMouseLeave={() => setHl(null)}
                  onFocus={() => setHl(r.part)}
                  onBlur={() => setHl(null)}
                >
                  <span className={p.rowLabel}>{r.label}</span>
                  <span className={p.rowValue}>{r.value}</span>
                  <Button size="sm" variant="secondary" className={p.rowAction} disabled={locked || r.empty} onClick={r.run} data-testid={r.testid} aria-label={`${r.action}: ${r.label}`}>
                    {r.icon} {r.action}
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          {owned.length ? (
            <section className={p.panel} aria-labelledby="sheet-owned">
              <header className={p.panelHead}>
                <h3 id="sheet-owned" className={p.panelTitle}>{t("moderation.sheet.ownedTitle", { count: owned.length })}</h3>
              </header>
              <ul className={p.rows}>
                {owned.map((s) => (
                  <li key={s.server_id}>
                    <button type="button" className={p.serverRow} onClick={() => onOpenServer(s.server_id)} data-testid="sheet-owned-server">
                      <ServerIcon id={s.server_id} iconId={s.icon_id} name={s.name} size={36} />
                      <span className={p.serverText}>
                        <span className={p.serverName}>{s.name}</span>
                        <span className={p.serverMeta}>{t("moderation.servers.members", { count: s.member_count })}</span>
                      </span>
                      <ChevronRight size={18} className={p.flip} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={p.panel} aria-labelledby="sheet-account">
            <header className={p.panelHead}>
              <h3 id="sheet-account" className={p.panelTitle}>{t("moderation.sheet.accountTitle")}</h3>
            </header>
            <dl className={p.facts}>
              <div>
                <dt><CalendarDays size={14} aria-hidden="true" /> {t("moderation.sheet.joined")}</dt>
                <dd title={fullDate(user.created_at)}>{formatShortDate(user.created_at)}</dd>
              </div>
              <div>
                <dt><Clock size={14} aria-hidden="true" /> {t("moderation.sheet.lastActive")}</dt>
                <dd>{user.last_seen_at ? formatRelative(user.last_seen_at) : t("moderation.sheet.never")}</dd>
              </div>
              <div>
                <dt><ShieldCheck size={14} aria-hidden="true" /> {t("moderation.sheet.access")}</dt>
                <dd>
                  {owner ? (
                    <span className={p.inline}><Crown size={14} aria-hidden="true" /> {t("profile.profileCard.owner")}</span>
                  ) : (user.admin_flags & FLAG_ADMIN) !== 0 ? (
                    t("moderation.staff")
                  ) : (user.admin_flags & FLAG_DISABLED) !== 0 ? (
                    <span className={p.inline}><UserRoundX size={14} aria-hidden="true" /> {t("moderation.state.disabled")}</span>
                  ) : (
                    t("moderation.sheet.member")
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("moderation.sheet.userId")}</dt>
                <dd>
                  <button type="button" className={p.copy} onClick={() => copyAndSay(user.id, t("moderation.copied"))} aria-label={t("moderation.menu.copyId")}>
                    <code>{user.id}</code>
                    <Copy size={13} aria-hidden="true" />
                  </button>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The profile as everyone sees it: banner, picture, names, status and about
 * me, drawn the way the app draws a profile. The part a field row is about
 * lights up while that row is looked at.
 */
function PublicFace({ user, hl }: { user: ModUser; hl: Part }) {
  const ctx = useRenderCtx();
  const live = usePresence((x) => x.byUser[user.id]);
  const st = modStatus(user, live);
  const banner = bannerUrl(user.banner_id, 680);
  const aboutRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [folds, setFolds] = useState(false);
  useLayoutEffect(() => {
    const el = aboutRef.current;
    if (!el || open) return;
    setFolds(el.scrollHeight > el.clientHeight + 1);
  }, [user.about_me, open]);
  const status = [user.status_emoji, user.status_text].filter(Boolean).join(" ");
  return (
    <section className={p.face} aria-label={t("moderation.sheet.asSeen")} data-testid="public-face">
      <span className={p.faceCaption}>{t("moderation.sheet.asSeen")}</span>
      <div className={p.faceBanner} data-hl={hl === "banner" || undefined} style={banner ? { backgroundImage: `url(${banner})` } : { background: profileTheme(user.accent_color, user.accent_color_2, user.id) }} />
      <div className={p.faceBody}>
        <div className={p.faceAvatar} data-hl={hl === "avatar" || undefined}>
          <Avatar id={user.id} avatarId={user.avatar_id} name={user.display_name} size={84} status={st.status} />
        </div>
        <div className={p.faceNames}>
          <span className={p.faceName} data-hl={hl === "display_name" || undefined} dir="auto">{user.display_name}</span>
          <span className={p.faceHandle}>
            <span data-hl={hl === "username" || undefined}>@{user.username}</span>
            {user.pronouns ? (
              <>
                {" · "}
                <span data-hl={hl === "pronouns" || undefined} dir="auto">{user.pronouns}</span>
              </>
            ) : null}
          </span>
        </div>
        {status ? (
          <div className={p.faceStatus} data-hl={hl === "status" || undefined}>
            {user.status_emoji ? <Twemoji text={user.status_emoji} className={p.emoji} /> : null}
            <span dir="auto">{user.status_text}</span>
          </div>
        ) : null}
        <div className={p.faceSection} data-hl={hl === "about_me" || undefined}>
          <h4 className={p.faceLabel}>{t("moderation.sheet.aboutMe")}</h4>
          {user.about_me ? (
            <>
              <div ref={aboutRef} className={p.faceAbout} data-open={open} dir="auto">
                <Markdown source={user.about_me} ctx={ctx} />
              </div>
              {folds || open ? (
                <button type="button" className={p.more} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                  {open ? t("chat.embeds.showLess") : t("chat.embeds.showMore")}
                </button>
              ) : null}
            </>
          ) : (
            <p className={p.faceEmpty}>{t("moderation.noAbout")}</p>
          )}
        </div>
        <div className={p.faceSection}>
          <h4 className={p.faceLabel}>{t("moderation.sheet.memberSince")}</h4>
          <p className={p.faceText}>{formatShortDate(user.created_at)}</p>
        </div>
      </div>
    </section>
  );
}

/** A server's icon as the app draws it everywhere, its initials on a tile where it has none. */
export function ServerIcon({ id, iconId, name, size }: { id: string; iconId: string | null; name: string; size: number }) {
  return <Avatar id={id} avatarId={iconId} name={name} size={size} kind="icon" square />;
}
