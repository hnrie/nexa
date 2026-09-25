import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { bannerUrl, users as usersApi } from "@/api/users";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { profileTheme } from "@/lib/avatarColor";
import { Button } from "@/components/common/Button";
import { CustomColorIcon } from "./CustomColorIcon";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
import { SaveBar } from "@/components/server/SettingsLayer";
const PRESETS = ["#8000ff", "#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#607d8b"];

/** A colour column may be missing entirely on an older server, so treat anything but a number as unset. */
function hexOf(v: number | null | undefined): string | null {
  return typeof v === "number" ? `#${v.toString(16).padStart(6, "0")}` : null;
}

/** The longest About me the server keeps (internal/api/user_handlers.go maxAboutMe). */
const ABOUT_MAX = 1000;

export default function ProfilePage() {
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const toast = useUI((u) => u.toast);
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [pronouns, setPronouns] = useState(me?.pronouns ?? "");
  const [about, setAbout] = useState(me?.about_me ?? "");
  const [accent, setAccent] = useState<string | null>(hexOf(me?.accent_color));
  const [accent2, setAccent2] = useState<string | null>(hexOf(me?.accent_color_2));
  const [crop, setCrop] = useState<{ file: File; kind: "avatar" | "banner" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(me.about_me);
    setAccent(hexOf(me.accent_color));
    setAccent2(hexOf(me.accent_color_2));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;
  const currentAccent = hexOf(me.accent_color);
  const currentAccent2 = hexOf(me.accent_color_2);
  const dirty = displayName !== me.display_name || pronouns !== me.pronouns || about !== me.about_me || accent !== currentAccent || accent2 !== currentAccent2;
  const hex = (v: string | null) => (v ? parseInt(v.slice(1), 16) : null);
  const themeCss = profileTheme(hex(accent), hex(accent2), me.id);

  const save = async () => {
    setSaving(true);
    try {
      const u = await usersApi.patchMe({ display_name: displayName.trim(), pronouns: pronouns.trim(), about_me: about, accent_color: hex(accent), accent_color_2: hex(accent2) });
      setMe(u);
      // the server trims and cleans what it stores, so take its copy back or the form stays "unsaved"
      setDisplayName(u.display_name);
      setPronouns(u.pronouns);
      setAbout(u.about_me);
      setAccent(hexOf(u.accent_color));
      setAccent2(hexOf(u.accent_color_2));
      toast(t("settings.profile.profileSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("settings.privacy.couldNotSave"), "error");
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(me.about_me);
    setAccent(currentAccent);
    setAccent2(currentAccent2);
  };
  const upload = async (kind: "avatar" | "banner", file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast(t("settings.profile.imagesAreLimitedTo10Mb"), "error");
    setUploading(kind);
    try {
      const res = kind === "avatar" ? await usersApi.uploadAvatar(file) : await usersApi.uploadBanner(file);
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
  const banner = bannerUrl(me.banner_id, 600);

  return (
    <>
      <h2 className={s.title}>{t("settings.profile.profiles")}</h2>
      <div className={s.twoCol}>
        <div className={s.form}>
          <Field label={t("settings.account.displayName")}><TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} /></Field>
          <Field label={t("settings.profile.pronouns")}><TextInput value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder={t("settings.profile.addYourPronouns")} /></Field>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>{t("settings.profile.avatar")}</div>
            <div className={s.uploadRow}>
              <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "avatar" }); e.target.value = ""; }} />
              <Button size="sm" loading={uploading === "avatar"} onClick={() => avatarRef.current?.click()}>{t("settings.profile.changeAvatar")}</Button>
              {me.avatar_id ? <Button size="sm" variant="ghost" onClick={() => void remove("avatar")}>{t("settings.profile.removeAvatar")}</Button> : null}
            </div>
            <p className={s.hint}>{t("settings.profile.pngJpegGifOrWebpUp")}</p>
          </div>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>{t("settings.profile.profileBanner")}</div>
            <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "banner" }); e.target.value = ""; }} />
            <div className={s.bannerPick} style={banner ? { backgroundImage: `url(${banner})` } : { background: themeCss }}>
              <Button size="sm" variant="secondary" loading={uploading === "banner"} onClick={() => bannerRef.current?.click()}>{t("settings.profile.changeBanner")}</Button>
              {me.banner_id ? <Button size="sm" variant="ghost" onClick={() => void remove("banner")}>{t("composer.composer.remove")}</Button> : null}
            </div>
          </div>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>{t("settings.profile.profileTheme")}</div>
            <p className={s.hint} style={{ margin: "0 0 6px" }}>{t("settings.profile.topColourOnItsOwnIt")}</p>
            <div className={s.swatches}>
              <button className={s.swatch} data-on={accent === null} aria-pressed={accent === null} style={{ background: "var(--bg-active)" }} title={t("server.roles.default")} aria-label={t("server.roles.default")} onClick={() => { setAccent(null); setAccent2(null); }} />
              {PRESETS.map((c, i) => <button key={c} className={s.swatch} data-on={accent === c} aria-pressed={accent === c} style={{ background: c }} title={c} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: PRESETS.length })} onClick={() => setAccent(c)} />)}
              <label className={s.swatch} data-on={!!accent && !PRESETS.includes(accent)} title={t("settings.appearance.custom")}>
                <CustomColorIcon color={accent && !PRESETS.includes(accent) ? accent : null} />
                <input type="color" value={accent ?? "#8000ff"} aria-label={t("settings.appearance.custom")} onChange={(e) => setAccent(e.target.value)} />
              </label>
              <HexInput value={accent} fallback="#8000ff" label={t("settings.profile.primaryColourHex")} testId="accent-hex" onChange={setAccent} />
            </div>
            <p className={s.hint} style={{ margin: "12px 0 6px" }}>{t("settings.profile.bottomColourPickOneTooAnd")}</p>
            <div className={s.swatches}>
              <button className={s.swatch} data-on={accent2 === null} aria-pressed={accent2 === null} style={{ background: "var(--bg-active)" }} title={t("settings.profile.none")} aria-label={t("settings.profile.none")} onClick={() => setAccent2(null)} disabled={!accent} />
              {PRESETS.map((c, i) => <button key={c} className={s.swatch} data-on={accent2 === c} aria-pressed={accent2 === c} style={{ background: c }} title={c} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: PRESETS.length })} onClick={() => setAccent2(c)} disabled={!accent} />)}
              <label className={s.swatch} data-on={!!accent2 && !PRESETS.includes(accent2)} style={{ opacity: accent ? 1 : 0.4 }} title={t("settings.appearance.custom")}>
                <CustomColorIcon color={accent2 && !PRESETS.includes(accent2) ? accent2 : null} />
                <input type="color" value={accent2 ?? "#eb459e"} disabled={!accent} aria-label={t("settings.appearance.custom")} onChange={(e) => setAccent2(e.target.value)} />
              </label>
              <HexInput value={accent2} fallback="#eb459e" label={t("settings.profile.secondColourHex")} testId="accent2-hex" disabled={!accent} onChange={setAccent2} />
            </div>
          </div>
          {/* counts down as it is typed, as the channel topic does, rather than only naming the cap */}
          <Field label={t("settings.profile.aboutMe")} hint={t("settings.profile.aboutHintLeft", { count: ABOUT_MAX - about.length })}>
            <TextArea value={about} onChange={(e) => setAbout(e.target.value)} rows={6} maxLength={ABOUT_MAX} placeholder={t("settings.profile.tellPeopleAboutYourself")} />
          </Field>
        </div>
        <div className={s.preview}>
          <div className={s.h5} style={{ marginTop: 0 }}>{t("settings.profile.preview")}</div>
          {/* the profile exactly as others will see it, theme and all, with the changes not yet saved */}
          <div className={s.previewCard} data-testid="profile-preview">
            <ProfileCard userId={me.id} variant="panel" preview={{ display_name: displayName || me.display_name, pronouns, about_me: about, accent_color: hex(accent), accent_color_2: hex(accent2) }} />
          </div>
        </div>
      </div>
      {crop ? (
        <ImageCropModal
          file={crop.file}
          aspect={crop.kind === "avatar" ? 1 : 600 / 240}
          round={crop.kind === "avatar"}
          maxSize={crop.kind === "avatar" ? 1024 : 1920}
          title={crop.kind === "avatar" ? t("settings.profile.cropYourAvatar") : t("settings.profile.cropYourBanner")}
          onClose={() => setCrop(null)}
          onDone={({ blob }) => {
            const kind = crop.kind;
            setCrop(null);
            void upload(kind, new File([blob], kind + (blob.type === "image/png" ? ".png" : ""), { type: blob.type }));
          }}
        />
      ) : null}
      <SaveBar dirty={dirty} busy={saving} onReset={reset} onSave={() => void save()} label={t("settings.profile.saveChanges")} />
    </>
  );
}

/** A hex field for people who know the colour they want. */
function HexInput({ value, fallback, label, testId, disabled, onChange }: { value: string | null; fallback: string; label: string; testId: string; disabled?: boolean; onChange: (v: string) => void }) {
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
      className={s.hex}
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
