import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { bannerUrl, users as usersApi } from "@/api/users";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { useRenderCtx } from "@/lib/markdownCtx";
import { Markdown } from "@/markdown";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

const PRESETS = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#9b59b6", "#607d8b"];

export default function ProfilePage() {
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const toast = useUI((u) => u.toast);
  const ctx = useRenderCtx();
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [pronouns, setPronouns] = useState(me?.pronouns ?? "");
  const [about, setAbout] = useState(me?.about_me ?? "");
  const [accent, setAccent] = useState<string | null>(me?.accent_color !== null && me?.accent_color !== undefined ? `#${me.accent_color.toString(16).padStart(6, "0")}` : null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(me.about_me);
    setAccent(me.accent_color !== null ? `#${me.accent_color.toString(16).padStart(6, "0")}` : null);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;
  const currentAccent = me.accent_color !== null ? `#${me.accent_color.toString(16).padStart(6, "0")}` : null;
  const dirty = displayName !== me.display_name || pronouns !== me.pronouns || about !== me.about_me || accent !== currentAccent;

  const save = async () => {
    setSaving(true);
    try {
      setMe(await usersApi.patchMe({ display_name: displayName.trim(), pronouns: pronouns.trim(), about_me: about, accent_color: accent ? parseInt(accent.slice(1), 16) : null }));
      toast("Profile saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save.", "error");
    } finally {
      setSaving(false);
    }
  };
  const reset = () => {
    setDisplayName(me.display_name);
    setPronouns(me.pronouns);
    setAbout(me.about_me);
    setAccent(currentAccent);
  };
  const upload = async (kind: "avatar" | "banner", file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast("Images are limited to 10 MB.", "error");
    setUploading(kind);
    try {
      const res = kind === "avatar" ? await usersApi.uploadAvatar(file) : await usersApi.uploadBanner(file);
      setMe(res.user);
      toast(kind === "avatar" ? "Avatar updated." : "Banner updated.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Upload failed.", "error");
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
      toast(err instanceof ApiError ? err.message : "Could not remove.", "error");
    }
  };
  const banner = bannerUrl(me.banner_id);

  return (
    <>
      <h2 className={s.title}>Profiles</h2>
      <div className={s.twoCol}>
        <div className={s.form}>
          <Field label="Display Name"><TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} /></Field>
          <Field label="Pronouns"><TextInput value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={40} placeholder="Add your pronouns" /></Field>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>Avatar</div>
            <div className={s.uploadRow}>
              <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("avatar", f); e.target.value = ""; }} />
              <Button size="sm" loading={uploading === "avatar"} onClick={() => avatarRef.current?.click()}>Change Avatar</Button>
              {me.avatar_id ? <Button size="sm" variant="ghost" onClick={() => void remove("avatar")}>Remove Avatar</Button> : null}
            </div>
            <p className={s.hint}>PNG, JPEG, GIF or WebP up to 10 MB. Animated avatars play everywhere, for everyone.</p>
          </div>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>Profile Banner</div>
            <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("banner", f); e.target.value = ""; }} />
            <div className={s.bannerPick} style={banner ? { backgroundImage: `url(${banner})` } : accent ? { background: accent } : undefined}>
              <Button size="sm" variant="secondary" loading={uploading === "banner"} onClick={() => bannerRef.current?.click()}>Change Banner</Button>
              {me.banner_id ? <Button size="sm" variant="ghost" onClick={() => void remove("banner")}>Remove</Button> : null}
            </div>
          </div>
          <div>
            <div className={s.h5} style={{ marginTop: 0 }}>Profile Theme</div>
            <div className={s.swatches}>
              <button className={s.swatch} data-on={accent === null} style={{ background: "var(--bg-active)" }} title="Default" onClick={() => setAccent(null)} />
              {PRESETS.map((c) => <button key={c} className={s.swatch} data-on={accent === c} style={{ background: c }} title={c} onClick={() => setAccent(c)} />)}
              <label className={s.swatch} data-on={!!accent && !PRESETS.includes(accent)} style={{ background: accent && !PRESETS.includes(accent) ? accent : "linear-gradient(135deg,#f00,#0f0,#00f)" }} title="Custom">
                <input type="color" value={accent ?? "#5865f2"} onChange={(e) => setAccent(e.target.value)} />
              </label>
            </div>
          </div>
          <Field label="About Me" hint="Markdown works here. There is no length limit.">
            <TextArea value={about} onChange={(e) => setAbout(e.target.value)} rows={6} placeholder="Tell people about yourself" />
          </Field>
        </div>
        <div className={s.preview}>
          <div className={s.h5} style={{ marginTop: 0 }}>Preview</div>
          <div className={s.card}>
            <div className={s.cardBanner} style={banner ? { backgroundImage: `url(${banner})` } : accent ? { background: accent } : undefined} />
            <div className={s.cardHead} style={{ paddingLeft: 16, paddingTop: 48, display: "block" }}>
              <div className={s.cardAvatar}><Avatar id={me.id} avatarId={me.avatar_id} name={displayName || me.display_name} size={80} status="online" /></div>
              <div className={s.cardName} style={{ paddingTop: 0 }}>{displayName || me.display_name}</div>
              <div className={s.cardUser}>{me.username}{pronouns ? ` • ${pronouns}` : ""}</div>
            </div>
            {about ? <div className={s.rows} style={{ fontSize: 14 }}><Markdown source={about} ctx={ctx} /></div> : null}
          </div>
        </div>
      </div>
      {dirty ? (
        <div className={s.saveBar}>
          <span>Careful — you have unsaved changes!</span>
          <span className={s.saveBtns}>
            <Button variant="ghost" onClick={reset}>Reset</Button>
            <Button variant="positive" loading={saving} onClick={() => void save()}>Save Changes</Button>
          </span>
        </div>
      ) : null}
    </>
  );
}
