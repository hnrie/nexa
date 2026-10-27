import { ArrowLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { ColourInput } from "@/components/common/ColourInput";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { StyledTyping } from "@/components/chat/TypingLine";
import { ServerTagChip } from "@/components/servertag/ServerTagChip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { t } from "@/i18n";
import { RoleIcon } from "@/components/common/RoleIcon";
import { nameClass, nameStyle, type RoleLook } from "@/lib/roleLook";
import { formatTimestamp } from "@/lib/time";
import type { TypingStyle } from "@/lib/typingStyle";
import { useAuth } from "@/stores/auth";
import { AboutMeEditor } from "./AboutMeEditor";
import { CustomColorIcon } from "./CustomColorIcon";
import st from "./Settings.module.css";
import d from "./Designer.module.css";

/*
 * The pieces both profile designers are made of (Settings, Profiles): the
 * account's own profile, and the one for each server.
 */

export const PRESETS = ["#8000ff", "#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#607d8b"];

/** The longest About Me the server keeps (internal/api/user_handlers.go maxAboutMe). */
export const ABOUT_MAX = 1000;

/** A colour column may be missing entirely on an older server, so treat anything but a number as unset. */
export function hexOf(v: number | null | undefined): string | null {
  return typeof v === "number" ? `#${v.toString(16).padStart(6, "0")}` : null;
}

/** A word of the profile written where it is shown: Enter keeps it, Escape puts it back. */
export function InlineText({ value, onChange, onDone, max, label, placeholder, className, testId }: { value: string; onChange: (v: string) => void; onDone: () => void; max: number; label: string; placeholder?: string; className?: string | undefined; testId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const before = useRef(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className={className}
      value={value}
      maxLength={max}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      size={Math.max(6, Math.min(max, (value || placeholder || "").length + 1))}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone();
        } else if (e.key === "Escape") {
          // back as it was, and the settings stay open
          e.preventDefault();
          e.stopPropagation();
          onChange(before.current);
          onDone();
        }
      }}
      data-testid={testId}
    />
  );
}

/** About Me written where it is shown, ready to type into as it opens. */
export function InlineAbout({ value, onChange, outLength, onDone }: { value: string; onChange: (v: string) => void; outLength: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current?.querySelector("textarea");
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, []);
  return (
    <div ref={ref} className={d.aboutEdit} data-testid="designer-about">
      <AboutMeEditor value={value} onChange={onChange} max={ABOUT_MAX} placeholder={t("settings.profile.tellPeopleAboutYourself")} label={t("settings.profile.aboutMe")} />
      <div className={d.aboutFoot}>
        <span className={d.count}>{t("composer.limit.left", { count: ABOUT_MAX - outLength })}</span>
        <Button size="sm" onClick={onDone} data-testid="designer-about-done">{t("pick.done")}</Button>
      </div>
    </div>
  );
}

/** A hex field for people who know the colour they want. */
export function HexInput({ value, fallback, label, testId, disabled, onChange }: { value: string | null; fallback: string; label: string; testId: string; disabled?: boolean; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  const commit = (raw: string) => {
    const hex = raw.trim().replace(/^#?/, "#").toLowerCase();
    const short = /^#([0-9a-f]{3})$/.exec(hex);
    const full = /^#([0-9a-f]{6})$/.exec(hex);
    if (short) {
      const [r, g, b] = short[1]!.split("");
      onChange(`#${r}${r}${g}${g}${b}${b}`);
    } else if (full) {
      onChange(hex);
    }
    setDraft(null);
  };
  return (
    <input
      className={st.hex}
      value={shown}
      disabled={disabled}
      spellCheck={false}
      maxLength={7}
      placeholder={fallback}
      aria-label={label}
      data-testid={testId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The profile's two colours: the top one alone colours the banner; both make the whole card a gradient. */
export function ColoursPicker({ accent, accent2, setAccent, setAccent2 }: { accent: string | null; accent2: string | null; setAccent: (v: string | null) => void; setAccent2: (v: string | null) => void }) {
  return (
    <div className={d.colours}>
      <p className={d.popHint}>{t("settings.profile.topColourOnItsOwnIt")}</p>
      <div className={st.swatches}>
        <button className={st.swatch} data-on={accent === null} aria-pressed={accent === null} style={{ background: "var(--bg-active)" }} title={t("server.roles.default")} aria-label={t("server.roles.default")} onClick={() => { setAccent(null); setAccent2(null); }} />
        {PRESETS.map((c, i) => <button key={c} className={st.swatch} data-on={accent === c} aria-pressed={accent === c} style={{ background: c }} title={c} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: PRESETS.length })} onClick={() => setAccent(c)} />)}
        <label className={st.swatch} data-on={!!accent && !PRESETS.includes(accent)} title={t("settings.appearance.custom")}>
          <CustomColorIcon color={accent && !PRESETS.includes(accent) ? accent : null} />
          <ColourInput value={accent ?? "#8000ff"} label={t("settings.appearance.custom")} onChange={setAccent} />
        </label>
        <HexInput value={accent} fallback="#8000ff" label={t("settings.profile.primaryColourHex")} testId="accent-hex" onChange={setAccent} />
      </div>
      <p className={d.popHint}>{t("settings.profile.bottomColourPickOneTooAnd")}</p>
      <div className={st.swatches}>
        <button className={st.swatch} data-on={accent2 === null} aria-pressed={accent2 === null} style={{ background: "var(--bg-active)" }} title={t("settings.profile.none")} aria-label={t("settings.profile.none")} onClick={() => setAccent2(null)} disabled={!accent} />
        {PRESETS.map((c, i) => <button key={c} className={st.swatch} data-on={accent2 === c} aria-pressed={accent2 === c} style={{ background: c }} title={c} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: PRESETS.length })} onClick={() => setAccent2(c)} disabled={!accent} />)}
        <label className={st.swatch} data-on={!!accent2 && !PRESETS.includes(accent2)} style={{ opacity: accent ? 1 : 0.4 }} title={t("settings.appearance.custom")}>
          <CustomColorIcon color={accent2 && !PRESETS.includes(accent2) ? accent2 : null} />
          <ColourInput value={accent2 ?? "#eb459e"} disabled={!accent} label={t("settings.appearance.custom")} onChange={setAccent2} />
        </label>
        <HexInput value={accent2} fallback="#eb459e" label={t("settings.profile.secondColourHex")} testId="accent2-hex" disabled={!accent} onChange={setAccent2} />
      </div>
    </div>
  );
}

/**
 * A conversation as others see it: their message, then yours with your name
 * and tag, then you typing. In a server it is one of its channels, with your
 * name in your roles' colours and icon.
 */
export function ChatPreview({ name, avatarId, userId, typing, channel = "general", look }: { name: string; avatarId: string | null; userId: string; typing: TypingStyle | null; channel?: string; look?: RoleLook | undefined }) {
  const me = useAuth((a) => a.me);
  // two messages from a few minutes ago, in the reader's own way of writing times
  const when = useMemo(() => Date.now() - 4 * 60 * 1000, []);
  const friend = t("designer.chat.friend");
  return (
    <div className={d.chat} data-testid="designer-chat">
      <div className={d.chatHead} aria-hidden="true" dir="auto">#{channel}</div>
      <div className={d.chatBody}>
        <div className={d.msg}>
          <Avatar id="designer-friend" avatarId={null} name={friend} size={40} />
          <div className={d.msgMain}>
            <div className={d.msgHead}>
              <span className={d.msgName} dir="auto">{friend}</span>
              <span className={d.msgTime}>{formatTimestamp(when - 60 * 1000)}</span>
            </div>
            <p className={d.msgText}>{t("designer.chat.theirs")}</p>
          </div>
        </div>
        <div className={d.msg}>
          <Avatar id={userId} avatarId={avatarId} name={name} size={40} />
          <div className={d.msgMain}>
            <div className={d.msgHead}>
              <span className={[d.msgName, nameClass(look)].join(" ")} style={nameStyle(look)} dir="auto">{name}</span>
              {look?.icon ? <RoleIcon icon={look.icon} size={16} /> : null}
              {me?.server_tag ? <ServerTagChip tag={me.server_tag} open={false} /> : null}
              <span className={d.msgTime}>{formatTimestamp(when)}</span>
            </div>
            <p className={d.msgText}>{t("designer.chat.yours")}</p>
          </div>
        </div>
      </div>
      <div className={d.chatTyping}>
        <StyledTyping style={typing} name={name} userId={userId} />
      </div>
      <div className={d.chatComposer} aria-hidden="true">{t("typing.editor.composer")}</div>
    </div>
  );
}


/** One part of the profile in the panel: what it is called and what it holds now (null: nothing yet, "Add"). */
export interface PanelRow<P extends string> { id: P; label: string; value: ReactNode; setting?: string | undefined }
export interface PanelGroup<P extends string> { title: string; rows: PanelRow<P>[] }

/** Narrower than this, the panel's list goes above the profile and its pages open as sheets. */
const PANEL_BESIDE = 820;
/** Where this browser remembers the panel folded away, so the profile has the whole width. Both designers share it. */
const FOLDED_KEY = "nexa.profilePanelFolded";
function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the panel stands beside the profile (measured on the designer
 * itself), and whether it is folded away; a page it has to show opens it again.
 */
export function usePanelLayout(page: string | null) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [beside, setBeside] = useState(true);
  const [folded, setFoldedState] = useState(readFolded);
  const setFolded = (v: boolean) => {
    setFoldedState(v);
    try {
      localStorage.setItem(FOLDED_KEY, v ? "1" : "0");
    } catch {
      // only this browser's convenience
    }
  };
  useEffect(() => {
    if (page) setFoldedState(false);
  }, [page]);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const measure = () => setBeside(el.clientWidth >= PANEL_BESIDE);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { layoutRef, beside, folded, setFolded };
}

/**
 * The designer's two halves: the panel of every part (grouped, each row
 * showing what the part holds) with the pages its rows open, and beside it
 * (or under it, without room) the profile in `children`. Without room the
 * pages open as sheets.
 */
export function DesignerLayout<P extends string, Pg extends P>({
  layout,
  groups,
  current,
  onRow,
  page,
  pageTitle,
  pageBody,
  onBack,
  children,
}: {
  layout: ReturnType<typeof usePanelLayout>;
  groups: PanelGroup<P>[];
  /** Whether a row is the one being worked on. */
  current: (id: P) => boolean;
  onRow: (id: P) => void;
  page: Pg | null;
  pageTitle: (page: Pg) => string;
  pageBody: (page: Pg) => ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  const { layoutRef, beside, folded, setFolded } = layout;
  const partList = (
    <nav className={d.partList} aria-label={t("designer.parts")} data-testid="designer-parts">
      {groups.map((g) => (
        <section key={g.title} className={d.group}>
          <h3 className={d.groupTitle}>{g.title}</h3>
          <div className={d.rows}>
            {g.rows.map((row) => (
              <button key={row.id} type="button" className={d.row} aria-current={current(row.id) || undefined} onClick={() => onRow(row.id)} data-setting={row.setting} data-testid={`designer-part-${row.id}`}>
                <span className={d.rowLabel}>{row.label}</span>
                <span className={d.rowValue} data-empty={row.value === null || undefined} dir="auto">{row.value ?? t("designer.value.add")}</span>
                <ChevronRight size={16} className={d.rowChevron} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
  return (
    <>
      <div ref={layoutRef} className={d.layout} data-beside={beside || undefined} data-folded={(beside && folded) || undefined}>
        <aside className={d.panel} data-testid="designer-panel">
          {beside && folded ? (
            <button type="button" className={d.fold} onClick={() => setFolded(false)} aria-label={t("designer.showPanel")} title={t("designer.showPanel")} aria-expanded={false} data-testid="designer-unfold">
              <ChevronsRight size={18} aria-hidden="true" />
            </button>
          ) : page && beside ? (
            <div className={d.page} data-testid={`designer-page-${page}`}>
              <div className={d.pageHead}>
                <button type="button" className={d.back} onClick={onBack} aria-label={t("designer.back")} data-testid="designer-page-back">
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h3 className={d.pageTitle}>{pageTitle(page)}</h3>
              </div>
              {pageBody(page)}
            </div>
          ) : (
            <>
              {beside ? (
                <button type="button" className={[d.fold, d.foldOpen].join(" ")} onClick={() => setFolded(true)} aria-label={t("designer.hidePanel")} title={t("designer.hidePanel")} aria-expanded data-testid="designer-fold">
                  <ChevronsLeft size={18} aria-hidden="true" />
                </button>
              ) : null}
              {partList}
            </>
          )}
        </aside>
        <div className={d.main}>{children}</div>
      </div>
      {page && !beside ? (
        <Modal open onClose={onBack} title={pageTitle(page)} width={520}>
          <div className={d.sheetPage} data-testid={`designer-page-${page}`}>{pageBody(page)}</div>
        </Modal>
      ) : null}
    </>
  );
}
