import { useState } from "react";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import { Select } from "@/components/common/Select";
import { Field } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { formatSpan } from "@/lib/moderation";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import { SaveBar } from "../SettingsLayer";

const ACCOUNT_WAITS = [0, 10, 60, 24 * 60, 7 * 24 * 60, 30 * 24 * 60];
const MEMBER_WAITS = [0, 5, 10, 30, 60, 24 * 60];

function waitLabel(minutes: number): string {
  return minutes === 0 ? t("safety.noWait") : formatSpan(minutes * 60_000);
}

/**
 * Safety for a server: how long newcomers wait before they can talk (an
 * account that new, or a membership that new), with the other tools a
 * moderator reaches for when trouble comes, AutoMod and pausing invites.
 */
export default function SafetyPage({ serverId, go }: { serverId: string; go: (page: string) => void }) {
  const server = useServers((x) => x.byId[serverId]?.server);
  const toast = useUI((u) => u.toast);
  const [account, setAccount] = useState<number | null>(null);
  const [member, setMember] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!server) return null;
  const acc = account ?? server.verify_account_minutes ?? 0;
  const mem = member ?? server.verify_member_minutes ?? 0;
  const dirty = acc !== (server.verify_account_minutes ?? 0) || mem !== (server.verify_member_minutes ?? 0);
  const save = async () => {
    setBusy(true);
    try {
      const srv = await serversApi.patch(serverId, { verify_account_minutes: acc, verify_member_minutes: mem });
      useServers.getState().updateServer(srv);
      setAccount(null);
      setMember(null);
      toast(t("safety.saved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("safety.failed"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className={st.title}>{t("safety.title")}</h2>
      <div className={st.form}>
        <div>
          <h3 className={st.h5} style={{ marginTop: 0 }}>{t("safety.newcomers")}</h3>
          <p className={st.hint}>{t("safety.newcomersDesc")}</p>
        </div>
        <Field label={t("safety.accountAge")} hint={t("safety.accountAgeHint")}>
          <Select value={acc} onChange={(e) => setAccount(Number(e.target.value))}>
            {ACCOUNT_WAITS.map((m) => <option key={m} value={m}>{waitLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label={t("safety.memberAge")} hint={t("safety.memberAgeHint")}>
          <Select value={mem} onChange={(e) => setMember(Number(e.target.value))}>
            {MEMBER_WAITS.map((m) => <option key={m} value={m}>{waitLabel(m)}</option>)}
          </Select>
        </Field>
        <div>
          <h3 className={st.h5}>{t("safety.more")}</h3>
          <p className={st.hint}>
            <button type="button" className={st.inlineLink} onClick={() => go("automod")}>{t("safety.toAutomod")}</button>
          </p>
          <p className={st.hint}>
            <button type="button" className={st.inlineLink} onClick={() => go("invites")}>{t("safety.toInvites")}</button>
          </p>
        </div>
      </div>
      <SaveBar dirty={dirty} busy={busy} onReset={() => { setAccount(null); setMember(null); }} onSave={() => void save()} />
    </>
  );
}
