import { ApiError } from "@/api/client";
import { describeError } from "@/lib/errors";
import { users as usersApi } from "@/api/users";
import type { MeUser } from "@/api/types";
import { Toggle } from "@/components/common/Toggle";
import { Button } from "@/components/common/Button";
import { SearchSettings } from "@/components/search/SearchSettings";
import { useState } from "react";
import { downloadBytes, exportMyData } from "@/lib/export";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

import { t } from "@/i18n";
function dmChoices(): { value: MeUser["dm_privacy"]; label: string; desc: string }[] {
  return [
  { value: "everyone", label: t("settings.privacy.everyone"), desc: t("settings.privacy.anyoneWithAnAccountCanMessage") },
  { value: "friends_servers", label: t("settings.privacy.friendsAndServerMembers"), desc: t("settings.privacy.friendsAndServerMembersDesc") },
  { value: "friends", label: t("settings.privacy.friendsOnly"), desc: t("settings.privacy.onlyYourFriendsCanStartA") },
  { value: "nobody", label: t("settings.privacy.nobody"), desc: t("settings.privacy.nobodyCanStartANewDirect") },
];
}

export default function PrivacyPage() {
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const runExport = async () => {
    setExporting(true);
    try {
      const bytes = await exportMyData(setExportStatus);
      downloadBytes(`evilion-chat-export-${new Date().toISOString().slice(0, 10)}.zip`, bytes);
    } catch (err) {
      toast(describeError(err, t("settings.privacy.couldNotExportYourData")), "error");
    } finally {
      setExporting(false);
      setExportStatus("");
    }
  };
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const toast = useUI((u) => u.toast);
  const settings = useSettings((st) => st.settings);
  const patch = useSettings((st) => st.patch);
  if (!me) return null;
  const setDM = async (value: MeUser["dm_privacy"]) => {
    try {
      setMe(await usersApi.patchMe({ dm_privacy: value }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("settings.privacy.couldNotSave"), "error");
    }
  };
  return (
    <>
      <h2 className={s.title}>{t("settings.privacy.privacySafety")}</h2>
      <h3 className={s.h5}>{t("settings.privacy.directMessages")}</h3>
      {dmChoices().map((o) => (
        <label key={o.value} className={s.radio} data-on={me.dm_privacy === o.value}>
          <input type="radio" name="dm" checked={me.dm_privacy === o.value} onChange={() => void setDM(o.value)} />
          <span className={s.radioText}><span className={s.radioLabel}>{o.label}</span><span className={s.radioDesc}>{o.desc}</span></span>
        </label>
      ))}
      <h3 className={s.h5}>{t("server.encryption.encryption")}</h3>
      <p className={s.hint}>{t("settings.privacy.everyMessageAndFileYouSend")}</p>
      <SearchSettings />
      <h3 className={s.h5}>{t("settings.privacy.linkPreviews")}</h3>
      <Toggle checked={settings.linkPreviews} onChange={(v) => patch({ linkPreviews: v })} label={t("settings.privacy.fetchLinkPreviewsWhenISend")} description={t("settings.privacy.yourDeviceAsksTheServerTo")} />
      <Toggle checked={settings.imagePreviews} onChange={(v) => patch({ imagePreviews: v })} label={t("settings.privacy.showEmbeddedImagesAndGifsFrom")} description={t("settings.privacy.picturesGifsAndVideosFromLinks")} />
      <h3 className={s.h5}>{t("settings.privacy.activity")}</h3>
      <Toggle checked={settings.shareActivity !== false} onChange={(v) => patch({ shareActivity: v })} label={t("settings.privacy.shareMyActivity")} description={t("settings.privacy.inTheDesktopAppYourRich")} />
      <Toggle checked={settings.autoIdle !== false} onChange={(v) => patch({ autoIdle: v })} label={t("settings.privacy.goIdleWhenAway")} description={t("settings.privacy.goIdleWhenAwayHint")} />
      <h3 className={s.h5}>{t("settings.privacy.yourData")}</h3>
      <p className={s.hint} style={{ marginBottom: 8 }}>{t("settings.privacy.downloadEverythingYourProfileFriendsServers")}</p>
      <Button size="sm" variant="secondary" loading={exporting} onClick={() => void runExport()} data-testid="export-data">{t("settings.privacy.exportMyData")}</Button>
      {/* the button hides its label while loading, so the progress goes under it */}
      {exporting && exportStatus ? <p className={s.hint} aria-live="polite">{exportStatus}</p> : null}
      <h3 className={s.h5}>{t("settings.privacy.advanced")}</h3>
      <Toggle checked={settings.developerMode} onChange={(v) => patch({ developerMode: v })} label={t("settings.privacy.developerMode")} description={t("settings.privacy.addsCopyIdOptionsToContext")} />
    </>
  );
}
