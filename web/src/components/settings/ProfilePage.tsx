import { useMediaAnimation } from "@/lib/mediaAnimation";
import { touchFirst } from "@/lib/touch";
import { ImagePlus, LoaderCircle, Palette, Pin, Plus } from "lucide-react";
import { parse, plainText } from "@/markdown/parse";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { avatarUrl, bannerUrl, users as usersApi } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { ProfileCard, type ProfileDesign, type ProfilePart, type ProfileTab } from "@/components/profile/ProfileCard";
import { widgetName, type WidgetDesign } from "@/components/profile/Widgets";
import { SaveBar } from "@/components/server/SettingsLayer";
import { t } from "@/i18n";
import { avatarColor, profileThemeOf } from "@/lib/avatarColor";
import { useDominantColor } from "@/lib/dominantColor";
import { describeError } from "@/lib/errors";
import { readTypingStyle, sameTypingStyle, type TypingStyle } from "@/lib/typingStyle";
import { isGameWidget, isMusicType, isMusicWidget, newWidgetId, readWidgets, type Widget, type WidgetType } from "@/lib/widgets";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { unlessUnsaved } from "@/stores/unsaved";
import { aboutToEdit, aboutToSave } from "./AboutMeEditor";
import { ChatPreview, ColoursPicker, DesignerLayout, hexOf, InlineAbout, InlineText, usePanelLayout, type PanelGroup } from "./designerParts";
import { ServerProfileDesigner } from "./ServerProfileDesigner";
import { ServerTagList, wearServerTag } from "./ServerTagChooser";
import { TypingStyleEditor } from "./TypingStyleEditor";
import { NameStyleEditor } from "./NameStyleEditor";
import { nameClass, nameStyle } from "@/lib/roleLook";
import { typingStyleText } from "@/lib/typingStyle";
import { readNameStyle, sameNameStyle, type NameStyle } from "@/lib/nameStyle";
import { AddWidgetDialog, CardDialog, GameWidgetDialog, MusicWidgetDialog } from "./WidgetsEditor";
import st from "./Settings.module.css";
import d from "./Designer.module.css";

type View = "full" | "card" | "chat";
/** What the panel's rows and the profile's own parts open. */
type Part = ProfilePart | "colours" | "widgets" | "typing" | "nameStyle";
/** The parts edited on a page of their own: in the panel beside the profile, or a sheet where there is no room for it. */
type Page = "nameStyle" | "avatar" | "banner" | "colours" | "tag";
const PAGES: Part[] = ["nameStyle", "avatar", "banner", "colours", "tag"];

/** Where the designer opens when Settings was asked for one of its parts (its search, a typing line's Make Your Own). */
function viewFor(anchor: string | null | undefined): View {
  return anchor === "typingStyle" ? "chat" : "full";
}

/**
 * Settings, Profiles: the profile designer. What is edited is the profile
 * itself, as others see it: every part of it opens what changes it, written
 * in place or chosen beside it, and every empty part shows what it could
 * hold. Three views show it where people meet it (the full profile, the card
 * a name opens, and a conversation), and a strip of every part is the way to
 * each for anyone who would rather pick from a list. Words, colours, widgets
 * and the typing line wait for Save Changes; pictures, the server tag worn
 * and the status change at once, as they always have.
 */
export default function ProfilePage({ anchor, serverId }: { anchor?: string | null; serverId?: string | null | undefined }) {
  const [scope, setScope] = useState<"main" | "server">(serverId ? "server" : "main");
  const [picked, setPicked] = useState<string | null>(serverId ?? null);
  // opened for one server (its menu's Edit Server Profile), or for a part of the main profile (Settings' search)
  useEffect(() => {
    if (!serverId) return;
    setScope("server");
    setPicked(serverId);
  }, [serverId]);
  useEffect(() => {
    if (anchor) setScope("main");
  }, [anchor]);
  return (
    <>
      <h2 data-setting="profile" className={st.title}>{t("settings.profile.profiles")}</h2>
      <div className={d.scopeTabs} role="tablist" aria-label={t("settings.profile.profiles")}>
        <button type="button" role="tab" className={d.scopeTab} aria-selected={scope === "main"} onClick={unlessUnsaved(() => setScope("main"))} data-testid="profiles-main">{t("settings.profile.mainProfile")}</button>
        <button type="button" role="tab" className={d.scopeTab} aria-selected={scope === "server"} onClick={unlessUnsaved(() => setScope("server"))} data-testid="profiles-servers">{t("settings.profile.serverProfiles")}</button>
      </div>
      {scope === "main" ? <MainDesigner anchor={anchor} /> : <ServerProfileDesigner serverId={picked} onServer={setPicked} />}
    </>
  );
}

/** The account's own profile, as it shows everywhere a server has not been given one of its own. */
function MainDesigner({ anchor }: { anchor?: string | null | undefined }) {
  useMediaAnimation();
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [pronouns, setPronouns] = useState(me?.pronouns ?? "");
  // written with custom emoji as their :name:, saved with them as the emoji (AboutMeEditor)
  const [about, setAbout] = useState(() => aboutToEdit(me?.about_me ?? ""));
  const [accent, setAccent] = useState<string | null>(hexOf(me?.accent_color));
  const [accent2, setAccent2] = useState<string | null>(hexOf(me?.accent_color_2));
  const [typing, setTyping] = useState<TypingStyle | null>(() => readTypingStyle(me?.typing_style));
  const [nameLook, setNameLook] = useState<NameStyle | null>(() => readNameStyle(me?.name_style));
  const [crop, setCrop] = useState<{ file: File; kind: "avatar" | "banner" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  // the widgets come with the whole profile, not with the account; null until they have
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [savedWidgets, setSavedWidgets] = useState<Widget[] | null>(null);
  const [widgetsFailed, setWidgetsFailed] = useState(false);
  // the designer: what is shown, what is written in place, what is open beside a part
  const [view, setView] = useState<View>(() => viewFor(anchor));
  const [inline, setInline] = useState<"name" | "pronouns" | "about" | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const layout = usePanelLayout(page);
  const { beside } = layout;
  const [tab, setTab] = useState<{ tab: ProfileTab; n: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ widget: Widget; isNew: boolean } | null>(null);
  // every part outlined once as the designer opens, to show what can be pressed
  const [intro, setIntro] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const meId = me?.id;

  const loadWidgets = useCallback(() => {
    if (!meId) return;
    setWidgetsFailed(false);
    usersApi.profile(meId).then(
      (p) => {
        const list = readWidgets(p.widgets);
        setWidgets(list);
        setSavedWidgets(list);
      },
      () => setWidgetsFailed(true),
    );
  }, [meId]);
  useEffect(loadWidgets, [loadWidgets]);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 1800);
    return () => clearTimeout(timer);
  }, []);
  // asked for a part while already here (Settings' search): show the view it is in
  useEffect(() => {
    if (anchor === "typingStyle") setView("chat");
    else if (anchor === "widgets") {
      setView("full");
      setTab((cur) => ({ tab: "widgets", n: (cur?.n ?? 0) + 1 }));
    } else if (anchor) setView("full");
  }, [anchor]);
  useEffect(() => {
    if (!me) return;
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(aboutToEdit(me.about_me));
    setAccent(hexOf(me.accent_color));
    setAccent2(hexOf(me.accent_color_2));
    setTyping(readTypingStyle(me.typing_style));
    setNameLook(readNameStyle(me.name_style));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const savedAbout = me?.about_me ?? "";
  const loadedAbout = useMemo(() => aboutToEdit(savedAbout), [savedAbout]);
  const aboutOut = useMemo(() => aboutToSave(about), [about]);
  const hex = (v: string | null) => (v ? parseInt(v.slice(1), 16) : null);
  // the stage glows in the profile's own colour, as the card does: its theme, or its banner's or picture's
  const theme = profileThemeOf(hex(accent), hex(accent2));
  const tint = useDominantColor(theme || !me ? null : (bannerUrl(me.banner_id, 64) ?? avatarUrl(me.avatar_id, 64)));

  if (!me) return null;
  const currentAccent = hexOf(me.accent_color);
  const currentAccent2 = hexOf(me.accent_color_2);
  const savedTyping = readTypingStyle(me.typing_style);
  const typingChanged = !sameTypingStyle(typing, savedTyping);
  const savedNameLook = readNameStyle(me.name_style);
  const nameLookChanged = !sameNameStyle(nameLook, savedNameLook);
  const profileChanged = displayName !== me.display_name || pronouns !== me.pronouns || about !== loadedAbout || accent !== currentAccent || accent2 !== currentAccent2 || typingChanged || nameLookChanged;
  const widgetsChanged = savedWidgets !== null && JSON.stringify(widgets) !== JSON.stringify(savedWidgets);
  const dirty = profileChanged || widgetsChanged;
  const shownName = displayName.trim() || me.display_name;
  const glow = theme?.top ?? tint ?? "var(--brand)";

  const save = async () => {
    setSaving(true);
    try {
      if (profileChanged) {
        const u = await usersApi.patchMe({ display_name: displayName.trim(), pronouns: pronouns.trim(), about_me: aboutOut, accent_color: hex(accent), accent_color_2: hex(accent2), ...(typingChanged ? { typing_style: typing } : {}), ...(nameLookChanged ? { name_style: nameLook } : {}) });
        setMe(u);
        // the server trims and cleans what it stores, so take its copy back or the form stays "unsaved"
        setDisplayName(u.display_name);
        setPronouns(u.pronouns);
        setAbout(aboutToEdit(u.about_me));
        setAccent(hexOf(u.accent_color));
        setAccent2(hexOf(u.accent_color_2));
        setTyping(readTypingStyle(u.typing_style));
        setNameLook(readNameStyle(u.name_style));
      }
      if (widgetsChanged) {
        const res = await usersApi.setWidgets(widgets);
        const list = readWidgets(res.widgets);
        setWidgets(list);
        setSavedWidgets(list);
      }
      toast(t("settings.profile.profileSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? describeError(err, t("settings.privacy.couldNotSave")) : t("settings.privacy.couldNotSave"), "error");
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(loadedAbout);
    setAccent(currentAccent);
    setAccent2(currentAccent2);
    setTyping(savedTyping);
    setNameLook(savedNameLook);
    if (savedWidgets) setWidgets(savedWidgets);
    setInline(null);
    setPage(null);
  };
  const upload = async (kind: "avatar" | "banner", file: File, crop?: { x: number; y: number; w: number; h: number } | null) => {
    if (file.size > 10 * 1024 * 1024) return toast(t("settings.profile.imagesAreLimitedTo10Mb"), "error");
    setUploading(kind);
    try {
      const res = kind === "avatar" ? await usersApi.uploadAvatar(file, crop) : await usersApi.uploadBanner(file, crop);
      setMe(res.user);
      toast(kind === "avatar" ? t("settings.profile.avatarUpdated") : t("settings.profile.bannerUpdated"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("composer.composer.uploadFailed"), "error");
    } finally {
      setUploading(null);
    }
  };
  const remove = async (kind: "avatar" | "banner") => {
    try {
      if (kind === "avatar") await usersApi.deleteAvatar();
      else await usersApi.deleteBanner();
      setMe(await usersApi.me());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("settings.profile.couldNotRemove"), "error");
    }
  };

  const showTab = (next: ProfileTab) => setTab((cur) => ({ tab: next, n: (cur?.n ?? 0) + 1 }));
  // what pressing a part does, in the panel or on the profile
  const open = (part: Part) => {
    if ((PAGES as string[]).includes(part)) {
      if (view === "chat" && part !== "colours" && part !== "tag" && part !== "nameStyle") setView("full");
      setPage(part as Page);
      return;
    }
    switch (part) {
      case "name":
      case "pronouns":
      case "about":
        if (view === "chat") setView("full");
        // one column (a phone) keeps About Me behind its own tab
        if (part === "about" && stageRef.current?.querySelector('[data-layout="narrow"]')) showTab("about");
        setInline(part);
        // the name and its style go together: the style opens beside the name being written
        if (part === "name" && beside) setPage("nameStyle");
        return;
      case "status":
        openModal("customStatus");
        return;
      case "typing":
        setView("chat");
        return;
      case "widgets":
        setView("full");
        showTab("widgets");
        requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
        return;
    }
  };
  const widgetTools: WidgetDesign = {
    edit: (id) => {
      const w = widgets.find((x) => x.id === id);
      if (w) setEditing({ widget: w, isNew: false });
    },
    move: (id, delta) =>
      setWidgets((list) => {
        const at = list.findIndex((w) => w.id === id);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= list.length) return list;
        const next = [...list];
        const [w] = next.splice(at, 1);
        next.splice(to, 0, w!);
        return next;
      }),
    remove: (id) => setWidgets((list) => list.filter((w) => w.id !== id)),
    feature: (id) =>
      setWidgets((list) => {
        const w = list.find((x) => x.id === id);
        return w ? [w, ...list.filter((x) => x.id !== id)] : list;
      }),
    add: () => setAdding(true),
  };
  const design: ProfileDesign = {
    edit: (part) => open(part),
    inline: {
      ...(inline === "name"
        ? { name: <InlineText className={d.nameInput} value={displayName} onChange={setDisplayName} onDone={() => setInline(null)} max={32} label={t("settings.account.displayName")} testId="designer-name" /> }
        : {}),
      ...(inline === "pronouns"
        ? { pronouns: <InlineText className={d.pronounsInput} value={pronouns} onChange={setPronouns} onDone={() => setInline(null)} max={40} label={t("settings.profile.pronouns")} placeholder={t("settings.profile.addYourPronouns")} testId="designer-pronouns" /> }
        : {}),
      ...(inline === "about" ? { about: <InlineAbout value={about} onChange={setAbout} outLength={aboutOut.length} onDone={() => setInline(null)} /> } : {}),
    },
    widgets: savedWidgets === null ? undefined : widgetTools,
  };
  const startWidget = (type: WidgetType) => {
    setAdding(false);
    const id = newWidgetId();
    setEditing({ widget: type === "custom" ? { id, type, title: "" } : isMusicType(type) ? { id, type, music: [] } : { id, type, games: [] }, isNew: true });
  };
  const doneWidget = (w: Widget) => {
    if (!editing) return;
    setWidgets((list) => (editing.isNew ? [...list, w] : list.map((x) => (x.id === w.id ? w : x))));
    setEditing(null);
    if (editing.isNew && view === "full") showTab("widgets");
  };

  const preview = { display_name: shownName, pronouns, about_me: aboutOut, accent_color: hex(accent), accent_color_2: hex(accent2), typing_style: typing, name_style: nameLook };
  const status = [me.status_emoji, me.status_text].filter(Boolean).join(" ");
  const typingWords = typingStyleText(typing);
  const nameLookShown = nameLook ? { own: nameLook } : undefined;
  // every part of the profile, grouped by what it changes, each showing what it holds now; with the anchor Settings' search knows it by
  const groups: PanelGroup<Part>[] = [
    {
      title: t("designer.group.name"),
      rows: [
        { id: "name", label: t("settings.account.displayName"), value: <span>{shownName}</span> },
        { id: "nameStyle", label: t("nameStyle.title"), value: nameLook ? <span className={nameClass(nameLookShown)} style={nameStyle(nameLookShown)}>{shownName}</span> : t("designer.value.plain"), setting: "nameStyle" },
        { id: "pronouns", label: t("settings.profile.pronouns"), value: pronouns ? <span>{pronouns}</span> : null },
      ],
    },
    {
      title: t("designer.group.look"),
      rows: [
        { id: "avatar", label: t("settings.profile.avatar"), value: <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={28} />, setting: "avatar" },
        { id: "banner", label: t("settings.profile.profileBanner"), value: <span className={d.rowBanner} style={me.banner_id ? { backgroundImage: `url(${bannerUrl(me.banner_id, 128)})` } : { background: theme ? `linear-gradient(180deg, ${theme.top}, ${theme.bottom})` : (accent ?? avatarColor(me.id)) }} />, setting: "banner" },
        { id: "colours", label: t("settings.profile.profileTheme"), value: accent ? <span className={d.rowSwatches}><i style={{ background: accent }} />{accent2 ? <i style={{ background: accent2 }} /> : null}</span> : null, setting: "profileTheme" },
      ],
    },
    {
      title: t("designer.group.about"),
      rows: [
        { id: "about", label: t("settings.profile.aboutMe"), value: aboutOut.trim() ? <span>{plainText(parse(aboutOut)).replace(/\s+/g, " ").trim()}</span> : null },
        { id: "status", label: t("designer.part.status"), value: status ? <span>{status}</span> : null },
        { id: "widgets", label: t("widgets.title"), value: widgets.length ? String(widgets.length) : null, setting: "widgets" },
        { id: "tag", label: t("serverTag.choose.title"), value: me.server_tag ? <span>{me.server_tag.text}</span> : null, setting: "serverTag" },
        { id: "typing", label: t("typing.editor.title"), value: typingWords ? <span>{typingWords}</span> : null, setting: "typingStyle" },
      ],
    },
  ];
  const pageTitle: Record<Page, string> = {
    nameStyle: t("nameStyle.title"),
    avatar: t("settings.profile.avatar"),
    banner: t("settings.profile.profileBanner"),
    colours: t("settings.profile.profileTheme"),
    tag: t("serverTag.choose.title"),
  };
  const pageBody = (part: Page): ReactNode => {
    switch (part) {
      case "nameStyle":
        return <NameStyleEditor value={nameLook} onChange={setNameLook} name={shownName} plate={!beside} />;
      case "avatar":
        return (
          <>
            <div className={d.popRow}>
              <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={64} />
              <div className={d.popBtns}>
                <Button size="sm" loading={uploading === "avatar"} onClick={() => avatarRef.current?.click()} data-testid="designer-upload-avatar">
                  <ImagePlus size={15} aria-hidden="true" /> {t("settings.profile.changeAvatar")}
                </Button>
                {me.avatar_id ? <Button size="sm" variant="ghost" onClick={() => void remove("avatar")}>{t("settings.profile.removeAvatar")}</Button> : null}
              </div>
            </div>
            <p className={d.popHint}>{t("designer.imageHint")}</p>
          </>
        );
      case "banner":
        return (
          <>
            <div className={d.bannerThumb} style={me.banner_id ? { backgroundImage: `url(${bannerUrl(me.banner_id, 340)})` } : { background: theme ? `linear-gradient(180deg, ${theme.top}, ${theme.bottom})` : (accent ?? avatarColor(me.id)) }} aria-hidden="true" />
            <div className={d.popBtns}>
              <Button size="sm" loading={uploading === "banner"} onClick={() => bannerRef.current?.click()} data-testid="designer-upload-banner">
                <ImagePlus size={15} aria-hidden="true" /> {me.banner_id ? t("settings.profile.changeBanner") : t("designer.addBanner")}
              </Button>
              {me.banner_id ? <Button size="sm" variant="ghost" onClick={() => void remove("banner")}>{t("composer.composer.remove")}</Button> : null}
            </div>
            <p className={d.popHint}>{t("designer.imageHint")}</p>
            {!me.banner_id ? (
              <button type="button" className={d.popLink} onClick={() => setPage("colours")}>
                <Palette size={14} aria-hidden="true" /> {t("designer.bannerColour")}
              </button>
            ) : null}
          </>
        );
      case "colours":
        return <ColoursPicker accent={accent} accent2={accent2} setAccent={setAccent} setAccent2={setAccent2} />;
      case "tag":
        return (
          <>
            <p className={d.popHint}>{t("serverTag.choose.hint")}</p>
            <ServerTagList />
            {me.server_tag ? (
              <Button size="sm" variant="ghost" onClick={() => void wearServerTag(null)} data-testid="designer-tag-off">
                {t("serverTag.takeOff")}
              </Button>
            ) : null}
          </>
        );
    }
  };
  const views: { id: View; label: string }[] = [
    { id: "full", label: t("designer.view.full") },
    { id: "card", label: t("designer.view.card") },
    { id: "chat", label: t("designer.view.chat") },
  ];
  const first = widgets[0];

  return (
    <>
      <p className={d.intro}>{t(touchFirst() ? "designer.introTouch" : "designer.intro")}</p>

      <DesignerLayout
        layout={layout}
        groups={groups}
        current={(id) => page === id || (id === "typing" && view === "chat")}
        onRow={open}
        page={page}
        pageTitle={(p) => pageTitle[p]}
        pageBody={pageBody}
        onBack={() => setPage(null)}
      >
          <div className={d.views} role="tablist" aria-label={t("designer.view.label")}>
            {views.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={d.viewBtn} data-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`designer-view-${v.id}`}>
                {v.label}
              </button>
            ))}
          </div>
          {widgetsFailed ? (
            <div className={d.notice} role="status">
              <span>{t("widgets.couldNotLoad")}</span>
              <Button size="sm" variant="secondary" onClick={loadWidgets}>{t("invite.tryAgain")}</Button>
            </div>
          ) : null}

          <div ref={stageRef} className={d.stage} data-view={view} data-intro={intro || undefined} style={{ "--glow": glow } as CSSProperties} data-testid="designer-stage">
            {view === "full" ? (
              <div className={d.frame}>
                <ProfileCard key={tab ? `${tab.tab}-${tab.n}` : "profile"} userId={me.id} variant="modal" preview={preview} previewWidgets={widgets} design={design} initialTab={tab?.tab} />
              </div>
            ) : view === "card" ? (
              <div className={d.cardView}>
                <div className={d.cardFrame}>
                  <ProfileCard userId={me.id} variant="popout" preview={preview} previewWidgets={widgets} design={design} />
                </div>
                <aside className={d.aside}>
                  <h3 className={d.asideTitle}><Pin size={15} aria-hidden="true" /> {t("designer.card.title")}</h3>
                  <p className={d.asideText}>{t("designer.card.hint")}</p>
                  {widgets.length ? (
                    <div className={d.choices} role="radiogroup" aria-label={t("designer.card.title")}>
                      {widgets.map((w) => (
                        <button key={w.id} type="button" role="radio" aria-checked={first?.id === w.id} className={d.choice} onClick={() => widgetTools.feature(w.id)} data-testid={`designer-card-${w.type}`}>
                          <span className={d.choiceDot} aria-hidden="true" />
                          <span className={d.choiceText} dir="auto">{widgetName(w)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className={d.asideText}>{t("designer.card.none")}</p>
                      <Button size="sm" onClick={() => setAdding(true)} disabled={savedWidgets === null}>
                        <Plus size={15} aria-hidden="true" /> {t("widgets.addOne")}
                      </Button>
                    </>
                  )}
                </aside>
              </div>
            ) : (
              <div className={d.chatView}>
                <ChatPreview name={shownName} avatarId={me.avatar_id} userId={me.id} typing={typing} look={nameLook ? { own: nameLook } : undefined} />
                <section className={d.typingPanel} aria-labelledby="designer-typing-title">
                  <h3 className={d.panelTitle} id="designer-typing-title">{t("typing.editor.title")}</h3>
                  <p className={d.panelHint}>{t("typing.editor.hint")}</p>
                  <TypingStyleEditor value={typing} onChange={setTyping} name={shownName} preview={false} />
                </section>
              </div>
            )}
          </div>
          <p className={d.caption}>{t(`designer.caption.${view}`)}</p>
      </DesignerLayout>
      {uploading ? (
        <p className={d.uploading} role="status"><LoaderCircle size={14} className={d.spin} aria-hidden="true" /> {t("common.working")}</p>
      ) : null}

      <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "avatar" }); e.target.value = ""; }} />
      <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "banner" }); e.target.value = ""; }} />

      {adding ? <AddWidgetDialog widgets={widgets} onPick={startWidget} onClose={() => setAdding(false)} /> : null}
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
            void upload(kind, new File([blob], kind + (blob.type === "image/png" ? ".png" : ""), { type: blob.type }), area ?? null);
          }}
        />
      ) : null}
      <SaveBar dirty={dirty} busy={saving} onReset={reset} onSave={() => void save()} label={t("settings.profile.saveChanges")} />
    </>
  );
}
