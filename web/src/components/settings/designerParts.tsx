import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Popout } from "@/components/common/Popout";
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

/** What changes a part: beside it on a computer, a sheet from the bottom on a phone. */
export function EditPop({ anchor, title, onClose, children, testId }: { anchor: HTMLElement; title: string; onClose: () => void; children: ReactNode; testId: string }) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Modal open onClose={onClose} title={title} width={440}>
        <div className={d.popBody} data-testid={testId}>{children}</div>
      </Modal>
    );
  }
  return (
    <Popout anchor={anchor} onClose={onClose} label={title} prefer="below" className={d.pop} testId={testId}>
      <div className={d.popHead}>
        <h3 className={d.popTitle}>{title}</h3>
        <button type="button" className={d.popClose} aria-label={t("chat.attachments.close")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className={d.popBody}>{children}</div>
    </Popout>
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
          <input type="color" value={accent ?? "#8000ff"} aria-label={t("settings.appearance.custom")} onChange={(e) => setAccent(e.target.value)} />
        </label>
        <HexInput value={accent} fallback="#8000ff" label={t("settings.profile.primaryColourHex")} testId="accent-hex" onChange={setAccent} />
      </div>
      <p className={d.popHint}>{t("settings.profile.bottomColourPickOneTooAnd")}</p>
      <div className={st.swatches}>
        <button className={st.swatch} data-on={accent2 === null} aria-pressed={accent2 === null} style={{ background: "var(--bg-active)" }} title={t("settings.profile.none")} aria-label={t("settings.profile.none")} onClick={() => setAccent2(null)} disabled={!accent} />
        {PRESETS.map((c, i) => <button key={c} className={st.swatch} data-on={accent2 === c} aria-pressed={accent2 === c} style={{ background: c }} title={c} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: PRESETS.length })} onClick={() => setAccent2(c)} disabled={!accent} />)}
        <label className={st.swatch} data-on={!!accent2 && !PRESETS.includes(accent2)} style={{ opacity: accent ? 1 : 0.4 }} title={t("settings.appearance.custom")}>
          <CustomColorIcon color={accent2 && !PRESETS.includes(accent2) ? accent2 : null} />
          <input type="color" value={accent2 ?? "#eb459e"} disabled={!accent} aria-label={t("settings.appearance.custom")} onChange={(e) => setAccent2(e.target.value)} />
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
        <StyledTyping style={typing} name={name} />
      </div>
      <div className={d.chatComposer} aria-hidden="true">{t("typing.editor.composer")}</div>
    </div>
  );
}

