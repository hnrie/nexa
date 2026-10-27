import { useMediaAnimation } from "@/lib/mediaAnimation";
import { useRef, useState } from "react";
import { servers as serversApi } from "@/api/servers";
import { describeError } from "@/lib/errors";
import { bannerUrl, iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { Select } from "@/components/common/Select";
import { Field, TextInput } from "@/components/common/TextInput";
import { FormattedText } from "@/components/common/FormattedText";
import { initials } from "@/lib/avatarColor";
import { selectServerChannels, useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import { SaveBar } from "../SettingsLayer";
import s from "../ServerSettings.module.css";

import { t } from "@/i18n";
import { isolate } from "../bidi";
export default function ServerOverviewPage({ serverId }: { serverId: string }) {
  useMediaAnimation();
  const server = useServers((x) => x.byId[serverId]?.server);
  const updateServer = useServers((x) => x.updateServer);
  const channels = useChannels((c) => c.byId);
  const toast = useUI((u) => u.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [system, setSystem] = useState(server?.system_channel_id ?? "");
  const [notif, setNotif] = useState(server?.default_notifications ?? 0);
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<{ file: File; kind: "icon" | "banner" } | null>(null);
  if (!server) return null;
  const texts = selectServerChannels(channels, serverId).filter((c) => c.type === "text");
  const dirty = name !== server.name || description !== server.description || (system || "") !== (server.system_channel_id ?? "") || notif !== server.default_notifications;
  const reset = () => {
    setName(server.name);
    setDescription(server.description);
    setSystem(server.system_channel_id ?? "");
    setNotif(server.default_notifications);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body: Parameters<typeof serversApi.patch>[1] = {};
      if (name !== server.name) body.name = name;
      if (description !== server.description) body.description = description;
      if ((system || "") !== (server.system_channel_id ?? "")) body.system_channel_id = system || null;
      if (notif !== server.default_notifications) body.default_notifications = notif;
      const srv = await serversApi.patch(serverId, body);
      updateServer(srv);
      // the server tidies whitespace, so show what it kept or the save bar never goes away
      setName(srv.name);
      setDescription(srv.description);
      setSystem(srv.system_channel_id ?? "");
      setNotif(srv.default_notifications);
      toast(t("server.serverOverview.serverSaved"), "success");
    } catch (err) {
      toast(describeError(err, t("server.serverOverview.couldNotSaveTheServer")), "error");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (kind: "icon" | "banner", file: File, crop?: { x: number; y: number; w: number; h: number } | null) => {
    setBusy(true);
    try {
      updateServer(await (kind === "icon" ? serversApi.uploadIcon(serverId, file, crop) : serversApi.uploadBanner(serverId, file, crop)));
    } catch (err) {
      toast(describeError(err, kind === "icon" ? t("server.serverOverview.couldNotUploadTheIcon") : t("server.serverOverview.couldNotUploadTheBanner")), "error");
    } finally {
      setBusy(false);
    }
  };
  const removeBanner = async () => {
    setBusy(true);
    try {
      await serversApi.deleteBanner(serverId);
      updateServer({ ...server, banner_id: null });
    } catch (err) {
      toast(describeError(err, t("server.serverOverview.couldNotRemoveTheBanner")), "error");
    } finally {
      setBusy(false);
    }
  };
  const removeIcon = async () => {
    setBusy(true);
    try {
      await serversApi.deleteIcon(serverId);
      updateServer({ ...server, icon_id: null });
    } catch (err) {
      // Its two siblings above catch; this one only had `finally`, so a
      // rejected delete stopped the spinner, left the icon where it was, and
      // said nothing.
      toast(describeError(err, t("server.serverOverview.couldNotRemoveTheIcon")), "error");
    } finally {
      setBusy(false);
    }
  };
  const icon = iconUrl(server.icon_id, 128);
  const banner = bannerUrl(server.banner_id, 600);
  return (
    <>
      <h2 className={st.title}>{t("server.serverOverview.serverOverview")}</h2>
      <div className={st.form}>
        <div className={s.iconWrap}>
          <div className={s.serverIcon}>{icon ? <img src={icon} alt="" /> : initials(server.name)}</div>
          <div className={st.form} style={{ gap: 8 }}>
            <p className={st.hint} style={{ margin: 0 }}>{t("server.serverOverview.weRecommendAnImageOfAt")}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>{t("server.serverOverview.uploadImage")}</Button>
              {server.icon_id ? <Button variant="ghost" size="sm" onClick={() => void removeIcon()} disabled={busy}>{t("composer.composer.remove")}</Button> : null}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "icon" }); e.target.value = ""; }} />
          </div>
        </div>
        <Field as="div" label={t("server.serverOverview.serverBanner")} hint={t("server.serverOverview.serverBannerHint")}>
          <div className={s.serverBanner} style={banner ? { backgroundImage: `url(${banner})` } : undefined} data-testid="server-banner">
            <Button variant="secondary" size="sm" onClick={() => bannerRef.current?.click()} disabled={busy}>{server.banner_id ? t("settings.profile.changeBanner") : t("server.serverOverview.uploadImage")}</Button>
            {server.banner_id ? <Button variant="secondary" size="sm" onClick={() => void removeBanner()} disabled={busy}>{t("composer.composer.remove")}</Button> : null}
          </div>
          <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setCrop({ file: f, kind: "banner" }); e.target.value = ""; }} data-testid="server-banner-file" />
        </Field>
        <Field label={t("modals.createServer.serverName")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="server-settings-name" />
        </Field>
        <Field as="div" label={t("server.serverOverview.serverDescription")} hint={t("server.serverOverview.shownOnInvitePagesSoPeople")}>
          <FormattedText value={description} onChange={setDescription} max={1000} placeholder={t("server.serverOverview.whatIsThisServerAbout")} title={t("server.serverOverview.serverDescription")} serverId={serverId} testId="server-description" />
        </Field>
        <Field label={t("server.serverOverview.systemMessagesChannel")} hint={t("server.serverOverview.joinMessagesArePostedHere")}>
          <Select value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">{t("server.serverOverview.noSystemMessages")}</option>
            {texts.map((c) => <option key={c.id} value={c.id}>{isolate(`#${c.name}`)}</option>)}
          </Select>
        </Field>
        <Field as="div" label={t("server.serverOverview.defaultNotificationSettings")} hint={t("server.serverOverview.whatNewMembersGetUntilThey")}>
          <div role="radiogroup" aria-label={t("server.serverOverview.defaultNotificationSettings")}>
            <label className={st.radio} data-on={notif === 0}><input type="radio" name="server-default-notifications" checked={notif === 0} onChange={() => setNotif(0)} /><span className={st.radioText}><span className={st.radioLabel}>{t("server.serverOverview.allMessages")}</span></span></label>
            <label className={st.radio} data-on={notif === 1}><input type="radio" name="server-default-notifications" checked={notif === 1} onChange={() => setNotif(1)} /><span className={st.radioText}><span className={st.radioLabel}>{t("server.serverOverview.onlyMentions")}</span></span></label>
          </div>
        </Field>
      </div>
      {crop ? (
        <ImageCropModal
          file={crop.file}
          aspect={crop.kind === "icon" ? 1 : 16 / 9}
          round={crop.kind === "icon"}
          maxSize={crop.kind === "icon" ? 1024 : 1280}
          title={crop.kind === "icon" ? t("server.serverOverview.cropTheServerIcon") : t("server.serverOverview.cropTheServerBanner")}
          serverCrop
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            const kind = crop.kind;
            setCrop(null);
            void upload(kind, new File([blob], `${kind}.png`, { type: blob.type }), area ?? null);
          }}
        />
      ) : null}
      <SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => void save()} />
    </>
  );
}
