import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { servers as serversApi } from "@/api/servers";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { Field, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { ServerTagChip, forgetTagPreview } from "@/components/servertag/ServerTagChip";
import st from "@/components/settings/Settings.module.css";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";
import { DEFAULT_TAG_BADGE, readTagText, tagColorCss, tagImageUrl, TAG_ICONS } from "@/lib/serverTags";
import { useAuth } from "@/stores/auth";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { SaveBar } from "../SettingsLayer";
import s from "./ServerTagPage.module.css";

/** The colours on offer beside the accent; any other is a click on the last swatch away. */
const COLORS = [0x5865f2, 0x3d9e60, 0xfdb833, 0xda3e44, 0xeb459f, 0x1abc9c, 0xe67e22, 0x607d8b, 0xffffff];

interface Draft {
  text: string;
  badge: string;
  color: number | null;
  limited: boolean;
  roles: string[];
  join: boolean;
}

/**
 * Server Settings, Server Tag: the letters, badge and colour the server's
 * members can wear next to their name, who may wear it, and whether anyone
 * who presses it can join. The preview on the side is the tag beside the
 * name of whoever is making it, as a message and as a member list shows it.
 */
export default function ServerTagPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const updateServer = useServers((x) => x.updateServer);
  const me = useAuth((a) => a.me);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const saved = server?.server.tag ?? null;
  const fromSaved = (): Draft => ({
    text: saved?.text ?? "",
    badge: saved?.badge ?? DEFAULT_TAG_BADGE,
    color: saved?.color ?? null,
    limited: saved?.limited ?? false,
    roles: saved?.roles ?? [],
    join: saved?.join ?? false,
  });
  const [draft, setDraft] = useState<Draft>(fromSaved);
  // the server's own picture, kept as a choice while another badge is tried
  const [picture, setPicture] = useState<string | null>(saved && saved.badge.startsWith("image:") ? saved.badge : null);
  const [crop, setCrop] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!server || !me) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const letters = readTagText(draft.text);
  const base = fromSaved();
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const roles = Object.values(server.roles)
    .filter((r) => r.id !== serverId)
    .sort((a, b) => b.position - a.position);
  const lettersChange = !!saved && letters.text !== saved.text;

  const save = async () => {
    if (!letters.ok) {
      toast(t("serverTag.page.tagHint"), "error");
      return;
    }
    setBusy(true);
    try {
      const srv = await serversApi.setTag(serverId, { text: letters.text, badge: draft.badge, color: draft.color, limited: draft.limited, roles: draft.limited ? draft.roles : [], join: draft.join });
      updateServer(srv);
      forgetTagPreview(serverId);
      const tag = srv.tag;
      if (tag) setDraft({ text: tag.text, badge: tag.badge, color: tag.color, limited: tag.limited, roles: tag.roles, join: tag.join });
      toast(t("serverTag.page.saved"), "success");
    } catch (err) {
      toast(describeError(err, t("serverTag.page.couldNotSave")), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    openModal("confirm", {
      title: t("serverTag.page.removeTitle"),
      body: t("serverTag.page.removeBody"),
      confirmLabel: t("serverTag.page.remove"),
      danger: true,
      onConfirm: async () => {
        await serversApi.deleteTag(serverId);
        updateServer({ ...server.server, tag: null });
        forgetTagPreview(serverId);
        setDraft({ text: "", badge: DEFAULT_TAG_BADGE, color: null, limited: false, roles: [], join: false });
        setPicture(null);
        toast(t("serverTag.page.removed"), "success");
      },
    });
  const upload = async (file: Blob, area: { x: number; y: number; w: number; h: number } | null) => {
    setUploading(true);
    try {
      const res = await serversApi.uploadTagBadge(serverId, file, area);
      setPicture(res.badge);
      set({ badge: res.badge });
    } catch (err) {
      toast(describeError(err, t("serverTag.page.uploadFailed")), "error");
    } finally {
      setUploading(false);
    }
  };

  const tag = { text: letters.text || "TAG", badge: draft.badge, color: draft.color };
  const style = { "--tag": tagColorCss(draft.color) } as CSSProperties;
  return (
    <>
      <h2 className={st.title}>{t("serverTag.page.title")}</h2>
      <p className={st.hint} style={{ margin: "-10px 0 22px" }}>{t("serverTag.page.intro")}</p>
      <div className={st.twoCol}>
        <div className={st.form}>
          <Field label={t("serverTag.page.tagLabel")} hint={lettersChange ? t("serverTag.page.lettersChange") : t("serverTag.page.tagHint")} error={draft.text && !letters.ok ? t("serverTag.page.tagHint") : null}>
            <TextInput value={draft.text} maxLength={16} onChange={(e) => set({ text: e.target.value.replace(/\s/g, "") })} placeholder={t("serverTag.page.tagPlaceholder")} spellCheck={false} autoComplete="off" data-testid="tag-text" />
          </Field>

          <div>
            <div className={st.h5} style={{ marginTop: 0 }} id="tag-badge-label">{t("serverTag.page.badge")}</div>
            <div className={s.badges} role="radiogroup" aria-labelledby="tag-badge-label" style={style}>
              <button
                type="button"
                className={s.upload}
                role="radio"
                aria-checked={!!picture && draft.badge === picture}
                aria-label={picture ? t("serverTag.page.yourPicture") : t("serverTag.page.upload")}
                data-on={(!!picture && draft.badge === picture) || undefined}
                onClick={() => (picture && draft.badge !== picture ? set({ badge: picture }) : fileRef.current?.click())}
                disabled={uploading}
                data-testid="tag-upload"
              >
                {picture ? <img src={tagImageUrl(picture, 32) ?? ""} alt="" draggable={false} /> : <ImagePlus size={20} aria-hidden="true" />}
              </button>
              {TAG_ICONS.map(([name, Icon], i) => {
                const badge = `icon:${name}`;
                return (
                  <button key={name} type="button" className={s.tile} role="radio" aria-checked={draft.badge === badge} aria-label={t("serverTag.page.badgeIndex", { index: i + 1, count: TAG_ICONS.length })} data-on={draft.badge === badge || undefined} onClick={() => set({ badge })} data-testid={`tag-icon-${name}`}>
                    <Icon size={20} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop(f); e.target.value = ""; }} />
            <p className={st.hint}>
              {t("serverTag.page.uploadHint")}{" "}
              {picture ? <button type="button" className={st.inlineLink} onClick={() => fileRef.current?.click()}>{t("serverTag.page.changePicture")}</button> : null}
            </p>
          </div>

          <div>
            <div className={st.h5} style={{ marginTop: 0 }} id="tag-color-label">{t("serverTag.page.color")}</div>
            <div className={st.swatches} role="radiogroup" aria-labelledby="tag-color-label">
              <button type="button" className={st.swatch} role="radio" aria-checked={draft.color === null} data-on={draft.color === null} style={{ background: "var(--brand)" }} title={t("serverTag.page.accent")} aria-label={t("serverTag.page.accent")} onClick={() => set({ color: null })} />
              {COLORS.map((c, i) => (
                <button key={c} type="button" className={st.swatch} role="radio" aria-checked={draft.color === c} data-on={draft.color === c} style={{ background: tagColorCss(c) }} title={tagColorCss(c)} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: COLORS.length })} onClick={() => set({ color: c })} />
              ))}
              <label className={st.swatch} data-on={draft.color !== null && !COLORS.includes(draft.color)} style={{ background: draft.color !== null && !COLORS.includes(draft.color) ? tagColorCss(draft.color) : "var(--bg-surface)", border: "2px dashed var(--border-strong)" }} title={t("server.roles.customColour")}>
                <input type="color" value={draft.color !== null ? tagColorCss(draft.color) : "#8000ff"} aria-label={t("server.roles.customColour")} onChange={(e) => set({ color: parseInt(e.target.value.slice(1), 16) })} />
              </label>
            </div>
          </div>

          <div>
            <div className={st.h5} style={{ marginTop: 0 }}>{t("serverTag.page.who")}</div>
            <div role="radiogroup" aria-label={t("serverTag.page.who")}>
              <label className={st.radio} data-on={!draft.limited}>
                <input type="radio" name="tag-who" checked={!draft.limited} onChange={() => set({ limited: false })} />
                <span className={st.radioText}><span className={st.radioLabel}>{t("serverTag.page.everyone")}</span></span>
              </label>
              <label className={st.radio} data-on={draft.limited}>
                <input type="radio" name="tag-who" checked={draft.limited} onChange={() => set({ limited: true })} data-testid="tag-limited" />
                <span className={st.radioText}>
                  <span className={st.radioLabel}>{t("serverTag.page.someRoles")}</span>
                  <span className={st.radioDesc}>{t("serverTag.page.someRolesHint")}</span>
                </span>
              </label>
            </div>
            {draft.limited ? (
              roles.length ? (
                <div className={s.roles} role="group" aria-label={t("serverTag.page.someRoles")}>
                  {roles.map((r) => {
                    const on = draft.roles.includes(r.id);
                    return (
                      <button key={r.id} type="button" className={s.role} aria-pressed={on} data-on={on || undefined} onClick={() => set({ roles: on ? draft.roles.filter((x) => x !== r.id) : [...draft.roles, r.id] })}>
                        <span className={s.roleDot} style={r.color ? { background: `#${r.color.toString(16).padStart(6, "0")}` } : undefined} aria-hidden="true" />
                        <span dir="auto">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className={st.hint}>{t("serverTag.page.noRoles")}</p>
              )
            ) : null}
          </div>

          <Toggle setting="tagJoin" checked={draft.join} onChange={(v) => set({ join: v })} label={t("serverTag.page.join")} description={t("serverTag.page.joinHint")} />

          {saved ? (
            <div>
              <Button variant="danger" size="sm" onClick={remove} data-testid="tag-remove"><Trash2 size={15} aria-hidden="true" /> {t("serverTag.page.remove")}</Button>
            </div>
          ) : null}
        </div>

        <div className={st.preview}>
          <div className={st.h5} style={{ marginTop: 0 }}>{t("serverTag.page.preview")}</div>
          <div className={s.stage} data-testid="tag-preview">
            <div className={s.msg}>
              <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={36} />
              <div className={s.msgText}>
                <div className={s.msgHead}>
                  <span className={s.msgName}>{me.display_name}</span>
                  <ServerTagChip tag={tag} open={false} />
                </div>
                <p className={s.msgBody}>{t("serverTag.page.previewMessage")}</p>
              </div>
            </div>
            <div className={s.member}>
              <Avatar id={me.id} avatarId={me.avatar_id} name={me.display_name} size={32} status="online" />
              <span className={s.memberName}>{me.display_name}</span>
              <ServerTagChip tag={tag} size="sm" open={false} />
            </div>
            <div className={s.big}>
              <ServerTagChip tag={tag} size="lg" open={false} />
            </div>
          </div>
        </div>
      </div>

      {crop ? (
        <ImageCropModal
          file={crop}
          aspect={1}
          maxSize={96}
          serverCrop
          title={t("serverTag.page.cropTitle")}
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            setCrop(null);
            void upload(blob, area ?? null);
          }}
        />
      ) : null}
      <SaveBar dirty={dirty} busy={busy} onReset={() => setDraft(base)} onSave={() => void save()} />
    </>
  );
}
