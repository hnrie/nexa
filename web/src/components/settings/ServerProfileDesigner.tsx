import { AlignLeft, ChevronDown, CircleUserRound, Image as ImageIcon, ImagePlus, LayoutGrid, LoaderCircle, Palette, Pin, Plus, Type, UserRound, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi, type MemberPatch } from "@/api/servers";
import type { PublicUser } from "@/api/types";
import { avatarUrl, bannerUrl, users as usersApi } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { menuAnchor } from "@/components/common/ContextMenu";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { ProfileCard, type ProfileDesign, type ProfilePart, type ProfileTab } from "@/components/profile/ProfileCard";
import { widgetName, type WidgetDesign } from "@/components/profile/Widgets";
import { SaveBar } from "@/components/server/SettingsLayer";
import { t } from "@/i18n";
import { button, defineMenu } from "@/lib/contextMenus/registry";
import { profileThemeOf } from "@/lib/avatarColor";
import { useDominantColor } from "@/lib/dominantColor";
import { describeError } from "@/lib/errors";
import { P } from "@/lib/perms";
import { memberLook } from "@/lib/roleLook";
import { readTypingStyle } from "@/lib/typingStyle";
import { isGameWidget, isMusicType, isMusicWidget, newWidgetId, readWidgets, type Widget, type WidgetType } from "@/lib/widgets";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { unlessUnsaved } from "@/stores/unsaved";
import { aboutToEdit, aboutToSave } from "./AboutMeEditor";
import { ChatPreview, ColoursPicker, EditPop, hexOf, InlineAbout, InlineText } from "./designerParts";
import { AddWidgetDialog, CardDialog, GameWidgetDialog, MusicWidgetDialog } from "./WidgetsEditor";
import d from "./Designer.module.css";

type View = "full" | "card" | "chat";
type Part = ProfilePart | "colours" | "widgets";
type Pop = { part: "banner" | "avatar" | "colours"; anchor: HTMLElement };

/** A status and a server tag are the account's, the same in every server. */
const FIXED: ProfilePart[] = ["status", "tag"];

const hex = (v: string | null) => (v ? parseInt(v.slice(1), 16) : null);

/**
 * Settings, Profiles, Server Profiles: the profile designer for one server.
 * The same stage as the main profile's, drawing the profile as people in
 * that server see it, with every part that can differ there: the nickname,
 * pronouns, picture, banner, theme, About Me and widgets. Whatever is left
 * empty is the main profile's, and the preview shows it so.
 */
export function ServerProfileDesigner({ serverId, onServer }: { serverId: string | null; onServer: (id: string) => void }) {
  const order = useServers((x) => x.order);
  const byId = useServers((x) => x.byId);
  const servers = useMemo(() => order.filter((id) => byId[id]), [order, byId]);
  const current = serverId && byId[serverId] ? serverId : (servers[0] ?? null);
  if (!current) {
    return (
      <div className={d.empty} data-testid="server-profiles-empty">
        <p className={d.emptyTitle}>{t("serverProfile.designer.noServers")}</p>
        <p className={d.emptyText}>{t("serverProfile.designer.noServersHint")}</p>
      </div>
    );
  }
  // a server of its own each: what was being edited for one never leaks into the next
  return <Designer key={current} serverId={current} servers={servers} onServer={onServer} />;
}

/** Which server's profile the designer edits. */
const serverProfilePickMenu = defineMenu<{ servers: string[]; current: string; pick: (id: string) => void }>("serverProfilePick", [
  [button("pickProfileServer", ({ servers, current, pick }) => {
    const byId = useServers.getState().byId;
    return servers.map((id) => ({ id, label: byId[id]?.server.name ?? id, checked: id === current, onSelect: () => pick(id) }));
  })],
]);

function ServerPicker({ serverId, servers, onServer }: { serverId: string; servers: string[]; onServer: (id: string) => void }) {
  const byId = useServers((x) => x.byId);
  const server = byId[serverId]?.server;
  if (!server) return null;
  const open = (el: HTMLElement) => {
    const anchor = menuAnchor(el, "start");
    serverProfilePickMenu.open({ servers, current: serverId, pick: (id) => unlessUnsaved(() => onServer(id))() }, { x: anchor.left, y: anchor.bottom + 4, anchor, label: t("serverProfile.designer.choose") });
  };
  return (
    <button type="button" className={d.serverPick} onClick={(e) => open(e.currentTarget)} aria-haspopup="menu" aria-label={t("serverProfile.designer.chooseNamed", { name: server.name })} data-testid="server-profile-picker">
      <Avatar id={server.id} avatarId={server.icon_id} name={server.name} size={28} kind="icon" square />
      <span className={d.serverPickName} dir="auto">{server.name}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}

function Designer({ serverId, servers, onServer }: { serverId: string; servers: string[]; onServer: (id: string) => void }) {
  const me = useAuth((a) => a.me);
  const st = useServers((x) => x.byId[serverId]);
  const upsertMember = useServers((x) => x.upsertMember);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const channels = useChannels((c) => c.byId);
  const member = st?.me;
  const [nick, setNick] = useState(member?.nickname ?? "");
  const [pronouns, setPronouns] = useState(member?.pronouns ?? "");
  const [about, setAbout] = useState(() => aboutToEdit(member?.bio ?? ""));
  const [accent, setAccent] = useState<string | null>(hexOf(member?.accent_color));
  const [accent2, setAccent2] = useState<string | null>(hexOf(member?.accent_color_2));
  // null: the main profile's widgets show here
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [savedWidgets, setSavedWidgets] = useState<Widget[] | null | undefined>(undefined);
  const [mainWidgets, setMainWidgets] = useState<Widget[]>([]);
  const [widgetsFailed, setWidgetsFailed] = useState(false);
  const [view, setView] = useState<View>("full");
  const [inline, setInline] = useState<"name" | "pronouns" | "about" | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [tab, setTab] = useState<{ tab: ProfileTab; n: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ widget: Widget; isNew: boolean } | null>(null);
  const [crop, setCrop] = useState<{ file: File; kind: "avatar" | "banner" } | null>(null);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [saving, setSaving] = useState(false);
  const [intro, setIntro] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const meId = me?.id;

  const loadWidgets = useCallback(() => {
    if (!meId) return;
    setWidgetsFailed(false);
    Promise.all([usersApi.profile(meId), usersApi.profile(meId, serverId)]).then(
      ([main, here]) => {
        setMainWidgets(readWidgets(main.widgets));
        const own = here.server_widgets ? readWidgets(here.widgets) : null;
        setWidgets(own);
        setSavedWidgets(own);
      },
      () => setWidgetsFailed(true),
    );
  }, [meId, serverId]);
  useEffect(loadWidgets, [loadWidgets]);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  const aboutOut = useMemo(() => aboutToSave(about), [about]);
  const savedAbout = useMemo(() => aboutToEdit(member?.bio ?? ""), [member?.bio]);
  const theme = profileThemeOf(accent ? hex(accent) : (me?.accent_color ?? null), accent ? hex(accent2) : (me?.accent_color_2 ?? null));
  const pictureId = member?.avatar_id ?? me?.avatar_id ?? null;
  const bannerId = member?.banner_id ?? me?.banner_id ?? null;
  const tint = useDominantColor(theme ? null : (bannerUrl(bannerId, 64) ?? avatarUrl(pictureId, 64)));

  if (!me || !st || !member) return null;
  const server = st.server;
  const canNick = canI(st, P.CHANGE_NICKNAME) || canI(st, P.MANAGE_NICKNAMES);
  const savedAccent = hexOf(member.accent_color);
  const savedAccent2 = hexOf(member.accent_color_2);
  const wordsChanged = nick !== (member.nickname ?? "") || pronouns !== (member.pronouns ?? "") || about !== savedAbout;
  const themeChanged = accent !== savedAccent || (accent !== null && accent2 !== savedAccent2);
  const widgetsChanged = savedWidgets !== undefined && JSON.stringify(widgets) !== JSON.stringify(savedWidgets);
  const dirty = wordsChanged || themeChanged || widgetsChanged;
  const shownName = nick.trim() || me.display_name;
  const glow = theme?.top ?? tint ?? "var(--brand)";
  const shownWidgets = widgets ?? mainWidgets;
  const hasOwn = !!(member.nickname || member.avatar_id || member.banner_id || member.bio || member.pronouns || typeof member.accent_color === "number" || savedWidgets);
  // the first text channel the server has, for the chat view's header
  const channelName = Object.values(channels).filter((c) => c.server_id === serverId && c.type === "text").sort((a, b) => a.position - b.position)[0]?.name ?? "general";

  const save = async () => {
    setSaving(true);
    try {
      const body: MemberPatch = {};
      if (nick !== (member.nickname ?? "")) body.nick = nick.trim() || null;
      if (pronouns !== (member.pronouns ?? "")) body.pronouns = pronouns.trim();
      if (about !== savedAbout) body.bio = aboutOut.trim();
      if (themeChanged) {
        body.accent_color = hex(accent);
        body.accent_color_2 = accent ? hex(accent2) : null;
      }
      if (widgetsChanged) body.widgets = widgets;
      const m = await serversApi.patchMember(serverId, "@me", body);
      upsertMember(m);
      // the server cleans what it keeps, so its copy is the one shown from now on
      setNick(m.nickname ?? "");
      setPronouns(m.pronouns ?? "");
      setAbout(aboutToEdit(m.bio ?? ""));
      setAccent(hexOf(m.accent_color));
      setAccent2(hexOf(m.accent_color_2));
      if (widgetsChanged) loadWidgets();
      toast(t("serverProfile.saved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? describeError(err, t("serverProfile.uploadFailed")) : t("serverProfile.uploadFailed"), "error");
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setNick(member.nickname ?? "");
    setPronouns(member.pronouns ?? "");
    setAbout(savedAbout);
    setAccent(savedAccent);
    setAccent2(savedAccent2);
    if (savedWidgets !== undefined) setWidgets(savedWidgets);
    setInline(null);
  };
  const upload = async (kind: "avatar" | "banner", file: File, crop?: { x: number; y: number; w: number; h: number } | null) => {
    if (file.size > 10 * 1024 * 1024) return toast(t("settings.profile.imagesAreLimitedTo10Mb"), "error");
    setUploading(kind);
    try {
      upsertMember(await serversApi.uploadMemberImage(serverId, kind, file, crop));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("serverProfile.uploadFailed"), "error");
    } finally {
      setUploading(null);
    }
  };
  const remove = async (kind: "avatar" | "banner") => {
    setUploading(kind);
    try {
      upsertMember(await serversApi.deleteMemberImage(serverId, "@me", kind));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("serverProfile.uploadFailed"), "error");
    } finally {
      setUploading(null);
    }
  };
  // everything set for this server goes, and the main profile shows there again
  const useMain = () =>
    openModal("confirm", {
      title: t("serverProfile.designer.useMainTitle", { name: server.name }),
      body: t("serverProfile.designer.useMainBody"),
      confirmLabel: t("serverProfile.designer.useMain"),
      onConfirm: async () => {
        try {
          let m = await serversApi.patchMember(serverId, "@me", { ...(canNick ? { nick: null } : {}), pronouns: "", bio: "", accent_color: null, accent_color_2: null, widgets: null });
          if (m.avatar_id) m = await serversApi.deleteMemberImage(serverId, "@me", "avatar");
          if (m.banner_id) m = await serversApi.deleteMemberImage(serverId, "@me", "banner");
          upsertMember(m);
          setNick(m.nickname ?? "");
          setPronouns("");
          setAbout("");
          setAccent(null);
          setAccent2(null);
          setWidgets(null);
          setSavedWidgets(null);
          toast(t("serverProfile.designer.useMainDone", { name: server.name }), "success");
        } catch (err) {
          toast(err instanceof ApiError ? err.message : t("serverProfile.uploadFailed"), "error");
        }
      },
    });

  const partOnStage = (part: string): HTMLElement | null => stageRef.current?.querySelector<HTMLElement>(`[data-spot="${part}"]`) ?? null;
  const showTab = (next: ProfileTab) => setTab((cur) => ({ tab: next, n: (cur?.n ?? 0) + 1 }));
  const open = (part: Part, anchorEl: HTMLElement | null) => {
    setPop(null);
    switch (part) {
      case "name":
        if (!canNick) return toast(t("serverProfile.designer.nickLocked"), "info");
        if (view === "chat") setView("full");
        setInline("name");
        return;
      case "pronouns":
      case "about":
        if (view === "chat") setView("full");
        if (part === "about" && stageRef.current?.querySelector('[data-layout="narrow"]')) showTab("about");
        setInline(part);
        return;
      case "widgets":
        setView("full");
        showTab("widgets");
        requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
        return;
      case "avatar":
      case "banner":
      case "colours": {
        if (view === "chat" && part !== "colours") setView("full");
        const at = (part !== "colours" ? partOnStage(part) : null) ?? anchorEl;
        if (at) setPop({ part, anchor: at });
        return;
      }
      default:
        return;
    }
  };
  // widgets changed here become this server's own, starting from the ones shown
  const changeWidgets = (fn: (list: Widget[]) => Widget[]) => setWidgets((cur) => fn(cur ?? mainWidgets));
  const widgetTools: WidgetDesign = {
    edit: (id) => {
      const w = shownWidgets.find((x) => x.id === id);
      if (w) setEditing({ widget: w, isNew: false });
    },
    move: (id, delta) =>
      changeWidgets((list) => {
        const at = list.findIndex((w) => w.id === id);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= list.length) return list;
        const next = [...list];
        const [w] = next.splice(at, 1);
        next.splice(to, 0, w!);
        return next;
      }),
    remove: (id) => changeWidgets((list) => list.filter((w) => w.id !== id)),
    feature: (id) =>
      changeWidgets((list) => {
        const w = list.find((x) => x.id === id);
        return w ? [w, ...list.filter((x) => x.id !== id)] : list;
      }),
    add: () => setAdding(true),
  };
  const design: ProfileDesign = {
    edit: (part, anchorEl) => open(part, anchorEl),
    fixed: canNick ? FIXED : [...FIXED, "name"],
    inline: {
      ...(inline === "name"
        ? { name: <InlineText className={d.nameInput} value={nick} onChange={setNick} onDone={() => setInline(null)} max={32} label={t("modals.serverProfile.nickname")} placeholder={me.display_name} testId="designer-name" /> }
        : {}),
      ...(inline === "pronouns"
        ? { pronouns: <InlineText className={d.pronounsInput} value={pronouns} onChange={setPronouns} onDone={() => setInline(null)} max={40} label={t("settings.profile.pronouns")} placeholder={me.pronouns || t("settings.profile.addYourPronouns")} testId="designer-pronouns" /> }
        : {}),
      ...(inline === "about" ? { about: <InlineAbout value={about} onChange={setAbout} outLength={aboutOut.length} onDone={() => setInline(null)} /> } : {}),
    },
    widgets: savedWidgets === undefined ? undefined : widgetTools,
  };
  const startWidget = (type: WidgetType) => {
    setAdding(false);
    const id = newWidgetId();
    setEditing({ widget: type === "custom" ? { id, type, title: "" } : isMusicType(type) ? { id, type, music: [] } : { id, type, games: [] }, isNew: true });
  };
  const doneWidget = (w: Widget) => {
    if (!editing) return;
    changeWidgets((list) => (editing.isNew ? [...list, w] : list.map((x) => (x.id === w.id ? w : x))));
    setEditing(null);
    if (editing.isNew && view === "full") showTab("widgets");
  };

  // whatever is left empty here is the main profile's, and is drawn so
  const preview: Partial<PublicUser> = {
    display_name: shownName,
    pronouns: pronouns.trim() || me.pronouns,
    about_me: aboutOut.trim() ? aboutOut : me.about_me,
    accent_color: accent ? hex(accent) : me.accent_color,
    accent_color_2: accent ? hex(accent2) : me.accent_color_2,
  };
  const parts: { id: Part; icon: LucideIcon; label: string }[] = [
    { id: "name", icon: Type, label: t("modals.serverProfile.nickname") },
    { id: "pronouns", icon: UserRound, label: t("settings.profile.pronouns") },
    { id: "avatar", icon: CircleUserRound, label: t("serverProfile.picture") },
    { id: "banner", icon: ImageIcon, label: t("serverProfile.banner") },
    { id: "colours", icon: Palette, label: t("settings.profile.profileTheme") },
    { id: "about", icon: AlignLeft, label: t("settings.profile.aboutMe") },
    { id: "widgets", icon: LayoutGrid, label: t("widgets.title") },
  ];
  const views: { id: View; label: string }[] = [
    { id: "full", label: t("designer.view.full") },
    { id: "card", label: t("designer.view.card") },
    { id: "chat", label: t("designer.view.chat") },
  ];
  const first = shownWidgets[0];

  return (
    <>
      <div className={d.serverHead}>
        <ServerPicker serverId={serverId} servers={servers} onServer={onServer} />
        {hasOwn ? (
          <Button size="sm" variant="ghost" onClick={useMain} data-testid="server-profile-use-main">{t("serverProfile.designer.useMain")}</Button>
        ) : null}
      </div>
      <p className={d.intro}>{t("serverProfile.designer.intro", { name: server.name })}</p>

      <div className={d.toolbar}>
        <div className={d.views} role="tablist" aria-label={t("designer.view.label")}>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={d.viewBtn} data-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`designer-view-${v.id}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className={d.parts} role="toolbar" aria-label={t("designer.parts")}>
          {parts.map((p) => {
            const Icon = p.icon;
            const locked = p.id === "name" && !canNick;
            return (
              <button key={p.id} type="button" className={d.part} onClick={(e) => open(p.id, e.currentTarget)} aria-disabled={locked || undefined} data-testid={`designer-part-${p.id}`}>
                <Icon size={15} aria-hidden="true" /> {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {widgetsFailed ? (
        <div className={d.notice} role="status">
          <span>{t("widgets.couldNotLoad")}</span>
          <Button size="sm" variant="secondary" onClick={loadWidgets}>{t("invite.tryAgain")}</Button>
        </div>
      ) : widgets !== null && savedWidgets !== undefined ? (
        <div className={d.notice} role="status">
          <span>{t("serverProfile.designer.ownWidgets", { name: server.name })}</span>
          <Button size="sm" variant="secondary" onClick={() => setWidgets(null)} data-testid="server-profile-main-widgets">{t("serverProfile.designer.mainWidgets")}</Button>
        </div>
      ) : null}

      <div ref={stageRef} className={d.stage} data-view={view} data-intro={intro || undefined} style={{ "--glow": glow } as CSSProperties} data-testid="designer-stage">
        {view === "full" ? (
          <div className={d.frame}>
            <ProfileCard key={tab ? `${tab.tab}-${tab.n}` : "profile"} userId={me.id} serverId={serverId} variant="modal" preview={preview} previewWidgets={shownWidgets} design={design} initialTab={tab?.tab} />
          </div>
        ) : view === "card" ? (
          <div className={d.cardView}>
            <div className={d.cardFrame}>
              <ProfileCard userId={me.id} serverId={serverId} variant="popout" preview={preview} previewWidgets={shownWidgets} design={design} />
            </div>
            <aside className={d.aside}>
              <h3 className={d.asideTitle}><Pin size={15} aria-hidden="true" /> {t("designer.card.title")}</h3>
              <p className={d.asideText}>{t("designer.card.hint")}</p>
              {shownWidgets.length ? (
                <div className={d.choices} role="radiogroup" aria-label={t("designer.card.title")}>
                  {shownWidgets.map((w) => (
                    <button key={w.id} type="button" role="radio" aria-checked={first?.id === w.id} className={d.choice} onClick={() => widgetTools.feature(w.id)}>
                      <span className={d.choiceDot} aria-hidden="true" />
                      <span className={d.choiceText} dir="auto">{widgetName(w)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <p className={d.asideText}>{t("designer.card.none")}</p>
                  <Button size="sm" onClick={() => setAdding(true)} disabled={savedWidgets === undefined}>
                    <Plus size={15} aria-hidden="true" /> {t("widgets.addOne")}
                  </Button>
                </>
              )}
            </aside>
          </div>
        ) : (
          <div className={d.chatView} data-single="">
            <ChatPreview name={shownName} avatarId={pictureId} userId={me.id} typing={readTypingStyle(me.typing_style)} channel={channelName} look={memberLook(st, me.id)} />
          </div>
        )}
      </div>
      <p className={d.caption}>{t(`serverProfile.caption.${view}`, { name: server.name })}</p>
      {uploading ? (
        <p className={d.uploading} role="status"><LoaderCircle size={14} className={d.spin} aria-hidden="true" /> {t("common.working")}</p>
      ) : null}

      <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "avatar" }); e.target.value = ""; }} />
      <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "banner" }); e.target.value = ""; }} />

      {pop?.part === "avatar" ? (
        <EditPop anchor={pop.anchor} title={t("serverProfile.picture")} onClose={() => setPop(null)} testId="designer-pop-avatar">
          <div className={d.popRow}>
            <Avatar id={me.id} avatarId={pictureId} name={shownName} size={64} />
            <div className={d.popBtns}>
              <Button size="sm" loading={uploading === "avatar"} onClick={() => avatarRef.current?.click()} data-testid="designer-upload-avatar">
                <ImagePlus size={15} aria-hidden="true" /> {t("serverProfile.changePicture")}
              </Button>
              {member.avatar_id ? <Button size="sm" variant="ghost" onClick={() => { setPop(null); void remove("avatar"); }}>{t("serverProfile.useOwnPicture")}</Button> : null}
            </div>
          </div>
          <p className={d.popHint}>{t("designer.imageHint")}</p>
        </EditPop>
      ) : null}
      {pop?.part === "banner" ? (
        <EditPop anchor={pop.anchor} title={t("serverProfile.banner")} onClose={() => setPop(null)} testId="designer-pop-banner">
          <div className={d.bannerThumb} style={bannerId ? { backgroundImage: `url(${bannerUrl(bannerId, 340)})` } : { background: theme ? `linear-gradient(180deg, ${theme.top}, ${theme.bottom})` : "var(--brand)" }} aria-hidden="true" />
          <div className={d.popBtns}>
            <Button size="sm" loading={uploading === "banner"} onClick={() => bannerRef.current?.click()} data-testid="designer-upload-banner">
              <ImagePlus size={15} aria-hidden="true" /> {member.banner_id ? t("settings.profile.changeBanner") : t("designer.addBanner")}
            </Button>
            {member.banner_id ? <Button size="sm" variant="ghost" onClick={() => { setPop(null); void remove("banner"); }}>{t("serverProfile.useOwnBanner")}</Button> : null}
          </div>
          <p className={d.popHint}>{t("designer.imageHint")}</p>
          {!bannerId ? (
            <button type="button" className={d.popLink} onClick={() => setPop({ part: "colours", anchor: pop.anchor })}>
              <Palette size={14} aria-hidden="true" /> {t("designer.bannerColour")}
            </button>
          ) : null}
        </EditPop>
      ) : null}
      {pop?.part === "colours" ? (
        <EditPop anchor={pop.anchor} title={t("settings.profile.profileTheme")} onClose={() => setPop(null)} testId="designer-pop-colours">
          <ColoursPicker accent={accent} accent2={accent2} setAccent={setAccent} setAccent2={setAccent2} />
          <p className={d.popHint}>{t("serverProfile.designer.themeHint")}</p>
        </EditPop>
      ) : null}

      {adding ? <AddWidgetDialog widgets={shownWidgets} onPick={startWidget} onClose={() => setAdding(false)} /> : null}
      {editing && isGameWidget(editing.widget) ? <GameWidgetDialog initial={editing.widget} onDone={doneWidget} onClose={() => setEditing(null)} /> : null}
      {editing && isMusicWidget(editing.widget) ? <MusicWidgetDialog initial={editing.widget} onDone={doneWidget} onClose={() => setEditing(null)} /> : null}
      {editing && editing.widget.type === "custom" ? <CardDialog initial={editing.widget} isNew={editing.isNew} onDone={doneWidget} onClose={() => setEditing(null)} /> : null}

      {crop ? (
        <ImageCropModal
          file={crop.file}
          aspect={crop.kind === "avatar" ? 1 : 600 / 240}
          round={crop.kind === "avatar"}
          maxSize={crop.kind === "avatar" ? 1024 : 1920}
          title={crop.kind === "avatar" ? t("settings.profile.cropYourAvatar") : t("settings.profile.cropYourBanner")}
          serverCrop
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            const kind = crop.kind;
            setCrop(null);
            setPop(null);
            void upload(kind, new File([blob], kind + (blob.type === "image/png" ? ".png" : ""), { type: blob.type }), area ?? null);
          }}
        />
      ) : null}
      <SaveBar dirty={dirty} busy={saving} onReset={reset} onSave={() => void save()} label={t("settings.profile.saveChanges")} />
    </>
  );
}
