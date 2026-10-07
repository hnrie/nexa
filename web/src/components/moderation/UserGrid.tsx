import { Ban, CalendarDays, Clock, Crown, Ellipsis, FolderOpen, Gavel, MessageSquareOff, Search, ShieldCheck, UserRoundX, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { moderation as modApi, type GridShow, type GridSort, type ModUser } from "@/api/moderation";
import { bannerUrl } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Spinner } from "@/components/common/Spinner";
import { Tooltip } from "@/components/common/Tooltip";
import { profileTheme } from "@/lib/avatarColor";
import { describeError } from "@/lib/errors";
import { FLAG_ADMIN, FLAG_DISABLED, previewText, relativeTo } from "@/lib/moderation";
import { formatRelative } from "@/lib/time";
import { useModEvents, useModeration } from "@/stores/moderation";
import { usePresence } from "@/stores/presence";
import { useUI } from "@/stores/ui";
import { formatStamp } from "@/lib/time";
import { copyAndSay } from "@/lib/copyText";
import { t } from "@/i18n";
import { button, defineMenu } from "@/lib/contextMenus/registry";

interface UserGridMenuCtx {
  user: ModUser;
  /** The account is the instance's owner, whom nobody changes. */
  owner: boolean;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
  setAccess: (body: { admin?: boolean; disabled?: boolean }) => Promise<void>;
}

/** What staff can do to an account from the users grid. */
const userGridMenu = defineMenu<UserGridMenuCtx>("userGrid", [
  [
    button("viewModUserProfile", ({ user, openModal }) => ({ id: "profile", label: t("moderation.menu.profile"), onSelect: () => openModal("profile", { userId: user.id }) })),
    button("copyModUserId", ({ user }) => ({ id: "copy", label: t("moderation.menu.copyId"), onSelect: () => copyAndSay(user.id, t("moderation.copied")) })),
  ],
  [
    button("toggleStaffAdmin", ({ user: u, owner, openModal, setAccess }) => {
      if (u.blocked === "self" || owner) return null;
      const admin = (u.admin_flags & FLAG_ADMIN) !== 0;
      return {
        id: "admin",
        label: admin ? t("moderation.menu.removeAdmin") : t("moderation.menu.makeAdmin"),
        onSelect: () =>
          openModal("confirm", {
            title: admin ? t("moderation.menu.removeAdminTitle", { name: u.display_name }) : t("moderation.menu.makeAdminTitle", { name: u.display_name }),
            body: admin ? t("moderation.menu.removeAdminBody") : t("moderation.menu.makeAdminBody"),
            confirmLabel: admin ? t("moderation.menu.removeAdmin") : t("moderation.menu.makeAdmin"),
            danger: admin,
            onConfirm: () => setAccess({ admin: !admin }),
          }),
      };
    }),
    button("toggleAccountDisabled", ({ user: u, owner, openModal, setAccess }) => {
      if (u.blocked === "self" || owner) return null;
      const disabled = (u.admin_flags & FLAG_DISABLED) !== 0;
      return {
        id: "disable",
        label: disabled ? t("moderation.menu.enable") : t("moderation.menu.disable"),
        danger: !disabled,
        onSelect: () =>
          disabled
            ? void setAccess({ disabled: false })
            : openModal("confirm", {
                title: t("moderation.menu.disableTitle", { name: u.display_name }),
                body: t("moderation.menu.disableBody"),
                confirmLabel: t("moderation.menu.disable"),
                danger: true,
                onConfirm: () => setAccess({ disabled: true }),
              }),
      };
    }),
  ],
]);
import { ModerateModal } from "./ModerateModal";
import { modStatus, StatusSummary } from "./ModStatus";
import m from "./Moderation.module.css";

const PAGE = 60;

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
 * Every account on Nexa, as cards: who they are, where they stand,
 * and the two ways in — act on them, or read their cases.
 */
export function UserGrid() {
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const ownerId = useModeration((s) => s.ownerId);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<GridShow>("all");
  const [sort, setSort] = useState<GridSort>("newest");
  const [users, setUsers] = useState<ModUser[] | null>(null);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moderating, setModerating] = useState<ModUser | null>(null);
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (from: string) => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      try {
        const r = await modApi.users({ q, show, sort, cursor: from, limit: PAGE });
        if (id !== request.current) return;
        setUsers((cur) => (from ? [...(cur ?? []), ...r.users.filter((u) => !cur?.some((x) => x.id === u.id))] : r.users));
        setCursor(r.next_cursor);
        // a list that starts again is read from its top, not from where the old one was left
        if (!from) scroller.current?.scrollTo({ top: 0 });
      } catch {
        if (id === request.current) setFailed(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [q, show, sort],
  );

  // A new search, filter or order starts the list again (typing waits a
  // moment). The old list's pages stop at once: its cursor means nothing in
  // the new order, and a page still coming would land in the new list.
  useEffect(() => {
    request.current++;
    setCursor("");
    const h = setTimeout(() => {
      setUsers(null);
      void load("");
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [q, show, sort, load]);

  // the next page loads as the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current;
    // after a failed page it waits to be asked: the sentinel is still in view,
    // and asking again at once looped as fast as the failures came back
    if (!el || !cursor || failed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) void load(cursor);
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, load, failed]);

  /** Reads one account again after something happened to it. */
  const refresh = useCallback(async (id: string) => {
    try {
      const r = await modApi.user(id);
      setUsers((cur) => cur?.map((u) => (u.id === id ? r.user : u)) ?? cur);
    } catch {
      // gone: a deleted account leaves the grid
      setUsers((cur) => cur?.filter((u) => u.id !== id) ?? cur);
    }
  }, []);

  useModEvents((e) => {
    if (e.type === "case" && users?.some((u) => u.id === e.case.user_id)) void refresh(e.case.user_id);
    if (e.type === "log" && e.entry.target_id && e.entry.action.startsWith("admin_") && users?.some((u) => u.id === e.entry.target_id)) void refresh(e.entry.target_id);
  });

  const setAccess = async (u: ModUser, body: { admin?: boolean; disabled?: boolean }) => {
    try {
      await modApi.access(u.id, body);
      await refresh(u.id);
      toast(t("moderation.accessChanged"), "success");
    } catch (err) {
      toast(describeError(err, t("moderation.failed")), "error");
    }
  };

  const menu = (e: MouseEvent, u: ModUser) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    userGridMenu.open(
      { user: u, owner: u.id === ownerId, openModal, setAccess: (body) => setAccess(u, body) },
      {
        // from the button's start edge, which is its right one in a right-to-left language
        x: e.type === "contextmenu" ? e.clientX : document.documentElement.dir === "rtl" ? r.right : r.left,
        y: e.type === "contextmenu" ? e.clientY : r.bottom + 4,
        label: u.display_name,
      },
    );
  };

  const shows: { id: GridShow; label: string }[] = [
    { id: "all", label: t("moderation.show.all") },
    { id: "online", label: t("moderation.show.online") },
    { id: "cases", label: t("moderation.show.cases") },
    { id: "muted", label: t("moderation.show.muted") },
    { id: "banned", label: t("moderation.show.banned") },
    { id: "staff", label: t("moderation.show.staff") },
    { id: "disabled", label: t("moderation.show.disabled") },
  ];

  return (
    <div className={m.scroll} ref={scroller} data-testid="user-grid">
      <div className={m.toolbar}>
        <label className={m.search}>
          <Search size={17} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("moderation.searchUsers")} aria-label={t("moderation.searchUsers")} data-testid="grid-search" />
        </label>
        <div className={m.chips} role="radiogroup" aria-label={t("moderation.show.label")}>
          {shows.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={show === x.id} className={m.chip} data-selected={show === x.id} onClick={() => setShow(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <Select className={m.sort} value={sort} onChange={(e) => setSort(e.target.value as GridSort)} aria-label={t("moderation.sort.label")}>
          <option value="newest">{t("moderation.sort.newest")}</option>
          <option value="oldest">{t("moderation.sort.oldest")}</option>
          <option value="name">{t("moderation.sort.name")}</option>
        </Select>
      </div>

      {users === null && !failed ? (
        <div className={m.grid} aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={m.skeleton} />
          ))}
        </div>
      ) : null}
      {failed && !users?.length ? (
        <div className={m.empty}>
          <p>{t("moderation.loadFailed")}</p>
          <Button size="sm" variant="secondary" onClick={() => void load("")}>
            {t("moderation.retry")}
          </Button>
        </div>
      ) : null}
      {users && users.length === 0 ? (
        <div className={m.empty}>
          <Users size={40} aria-hidden="true" />
          <span className={m.emptyTitle}>{q ? t("moderation.noMatches") : t("moderation.noneHere")}</span>
          {q || show !== "all" ? (
            <Button size="sm" variant="secondary" onClick={() => { setQ(""); setShow("all"); }}>
              {t("moderation.clearFilters")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {users && users.length > 0 ? (
        <div className={m.grid}>
          {users.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              owner={u.id === ownerId}
              onModerate={() => setModerating(u)}
              onCases={() => nav(`/channels/@admin/users/${u.id}/cases`)}
              onProfile={() => nav(`/channels/@admin/users/${u.id}`)}
              onMenu={(e) => menu(e, u)}
            />
          ))}
        </div>
      ) : null}
      <div ref={sentinel} className={m.sentinel} />
      {failed && users?.length && cursor ? (
        <div className={m.loadingRow}>
          <Button size="sm" variant="secondary" onClick={() => void load(cursor)} loading={loading}>
            {t("moderation.retry")}
          </Button>
        </div>
      ) : null}
      {loading && users ? (
        <div className={m.loadingRow}>
          <Spinner size={24} label={t("chat.pins.loading")} />
        </div>
      ) : null}
      {moderating ? <ModerateModal user={moderating} onClose={() => setModerating(null)} onDone={(c) => (c.action === "delete" ? setUsers((cur) => cur?.filter((x) => x.id !== c.user_id) ?? cur) : void refresh(c.user_id))} /> : null}
    </div>
  );
}

function UserCard({ u, owner, onModerate, onCases, onProfile, onMenu }: { u: ModUser; owner: boolean; onModerate: () => void; onCases: () => void; onProfile: () => void; onMenu: (e: MouseEvent) => void }) {
  const live = usePresence((p) => p.byUser[u.id]);
  const st = modStatus(u, live);
  const banner = bannerUrl(u.banner_id, 320);
  const staff = (u.admin_flags & FLAG_ADMIN) !== 0;
  const disabled = (u.admin_flags & FLAG_DISABLED) !== 0;
  const state = u.ban ? "banned" : u.mute ? "muted" : undefined;
  const blocked = blockedText(u.blocked);
  const moderate = (
    <Button size="sm" variant="primary" onClick={onModerate} disabled={!!u.blocked} data-testid="card-moderate">
      <Gavel size={15} aria-hidden="true" /> {t("moderation.moderate")}
    </Button>
  );
  return (
    <article className={m.card} data-state={state} onContextMenu={onMenu} data-testid="user-card" data-user={u.id}>
      <div className={m.cardBanner} style={banner ? { backgroundImage: `url(${banner})` } : { background: profileTheme(u.accent_color, u.accent_color_2, u.id) }} />
      <div className={m.cardFlags}>
        {u.ban ? (
          <span className={m.flag} data-tone="danger" title={u.ban.expires_at ? relativeTo(u.ban.expires_at) : undefined}>
            <Ban size={12} aria-hidden="true" />
            {u.ban.expires_at ? t("moderation.state.bannedUntil", { when: relativeTo(u.ban.expires_at) }) : t("moderation.state.bannedForever")}
          </span>
        ) : null}
        {u.mute ? (
          <span className={m.flag} data-tone="warn">
            <MessageSquareOff size={12} aria-hidden="true" />
            {u.mute.expires_at ? t("moderation.state.mutedUntil", { when: relativeTo(u.mute.expires_at) }) : t("moderation.state.muted")}
          </span>
        ) : null}
        {disabled ? (
          <span className={m.flag} data-tone="muted">
            <UserRoundX size={12} aria-hidden="true" />
            {t("moderation.state.disabled")}
          </span>
        ) : null}
      </div>
      <div className={m.cardAvatarWrap}>
        <Avatar id={u.id} avatarId={u.avatar_id} name={u.display_name} size={64} status={st.status} />
      </div>
      <div className={m.cardBody}>
        <div className={m.cardName}>
          <button type="button" className={[m.cardNameText, m.cardNameLink].join(" ")} onClick={onProfile} data-testid="card-profile">
            {u.display_name}
          </button>
          {owner ? (
            <span className={m.staffBadge} title={t("profile.profileCard.owner")}>
              <Crown size={12} aria-hidden="true" />
              {t("profile.profileCard.owner")}
            </span>
          ) : staff ? (
            <span className={m.staffBadge}>
              <ShieldCheck size={12} aria-hidden="true" />
              {t("moderation.staff")}
            </span>
          ) : null}
          {u.awaiting_cases > 0 ? (
            <Tooltip text={t("moderation.awaitingTip", { count: u.awaiting_cases })}>
              <span className={m.dot} aria-label={t("moderation.awaitingTip", { count: u.awaiting_cases })} />
            </Tooltip>
          ) : null}
        </div>
        <span className={m.cardUser}>
          @{u.username}
          {u.pronouns ? ` · ${u.pronouns}` : ""}
        </span>
        <StatusSummary st={st} />
        {/* plain words, whatever formatting the about me has: the full profile shows it formatted */}
        <p className={m.cardAbout} data-empty={!u.about_me || undefined} dir="auto">
          {u.about_me ? previewText(u.about_me) : t("moderation.noAbout")}
        </p>
        <div className={m.cardMeta}>
          <span>
            <CalendarDays size={13} aria-hidden="true" />
            {t("moderation.joined", { when: formatStamp(new Date(u.created_at), "d") })}
          </span>
          {u.last_seen_at ? (
            <span>
              <Clock size={13} aria-hidden="true" />
              {t("moderation.lastSeen", { when: formatRelative(u.last_seen_at) })}
            </span>
          ) : null}
        </div>
        <div className={m.cardActions}>
          {blocked ? (
            <Tooltip text={blocked}>
              <span className={m.tipWrap} tabIndex={0}>
                {moderate}
              </span>
            </Tooltip>
          ) : (
            moderate
          )}
          <Button size="sm" variant="secondary" onClick={onCases} data-testid="card-cases" aria-label={t("moderation.viewCases", { count: u.case_count })}>
            <FolderOpen size={15} aria-hidden="true" /> {t("moderation.cases")}
            <span className={m.btnCount}>{u.case_count}</span>
          </Button>
          <button type="button" className={m.iconBtn} onClick={onMenu} aria-label={t("moderation.more")}>
            <Ellipsis size={18} />
          </button>
        </div>
        {blocked ? <p className={m.blockedNote} aria-hidden="true">{blocked}</p> : null}
      </div>
    </article>
  );
}
