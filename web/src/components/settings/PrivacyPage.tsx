import { ApiError } from "@/api/client";
import { users as usersApi } from "@/api/users";
import type { MeUser } from "@/api/types";
import { Toggle } from "@/components/common/Toggle";
import { Button } from "@/components/common/Button";
import { useState } from "react";
import { downloadBytes, exportMyData } from "@/lib/export";
import { useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Settings.module.css";

const DM: { value: MeUser["dm_privacy"]; label: string; desc: string }[] = [
  { value: "everyone", label: "Everyone", desc: "Anyone on this server can message you." },
  { value: "friends", label: "Friends only", desc: "Only your friends can start a conversation with you." },
  { value: "nobody", label: "Nobody", desc: "Nobody can start a new direct message with you. Existing conversations keep working." },
];

export default function PrivacyPage() {
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const runExport = async () => {
    setExporting(true);
    try {
      const bytes = await exportMyData(setExportStatus);
      downloadBytes(`evilion-chat-export-${new Date().toISOString().slice(0, 10)}.zip`, bytes);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not export your data.", "error");
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
      toast(err instanceof ApiError ? err.message : "Could not save.", "error");
    }
  };
  return (
    <>
      <h2 className={s.title}>Privacy & Safety</h2>
      <h3 className={s.h5}>Direct messages</h3>
      {DM.map((o) => (
        <label key={o.value} className={s.radio} data-on={me.dm_privacy === o.value}>
          <input type="radio" name="dm" checked={me.dm_privacy === o.value} onChange={() => void setDM(o.value)} />
          <span className={s.radioText}><span className={s.radioLabel}>{o.label}</span><span className={s.radioDesc}>{o.desc}</span></span>
        </label>
      ))}
      <h3 className={s.h5}>Encryption</h3>
      <p className={s.hint}>Every message and file you send is encrypted on your device with keys the server never sees. Profiles, reactions and who-talks-to-whom are visible to the server so the app can work; message contents are not.</p>
      <h3 className={s.h5}>Link previews</h3>
      <Toggle checked={settings.linkPreviews} onChange={(v) => patch({ linkPreviews: v })} label="Fetch link previews when I send links" description="Your device asks the server to look up the page you linked and attaches the preview to your encrypted message. Turn this off if you do not want the server to see the links you send." />
      <Toggle checked={settings.imagePreviews} onChange={(v) => patch({ imagePreviews: v })} label="Show embedded images and GIFs from links" description="Direct image links load straight from their site, which reveals your address to that site, as in any browser." />
      <h3 className={s.h5}>Your data</h3>
      <p className={s.hint} style={{ marginBottom: 8 }}>Download everything: your profile, friends, servers and every message you hold keys for, decrypted on this device into a zip. Nothing is decrypted on the server.</p>
      <Button size="sm" variant="secondary" loading={exporting} onClick={() => void runExport()} data-testid="export-data">Export my data</Button>
      {/* the button hides its label while loading, so the progress goes under it */}
      {exporting && exportStatus ? <p className={s.hint} aria-live="polite">{exportStatus}</p> : null}
      <h3 className={s.h5}>Advanced</h3>
      <Toggle checked={settings.developerMode} onChange={(v) => patch({ developerMode: v })} label="Developer Mode" description="Adds Copy ID options to context menus." />
    </>
  );
}
