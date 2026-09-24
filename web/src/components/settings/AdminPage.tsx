import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { admin as adminApi, type ClientErrorReport } from "@/api/admin";
import { ApiError } from "@/api/client";
import type { AdminSettings, AdminStats, LegalReport } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { formatBytes, formatFull } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useNexa } from "@/stores/nexa";
import { useUI } from "@/stores/ui";
import st from "./Settings.module.css";
import s from "@/components/server/ServerSettings.module.css";

import { t as tr_ } from "@/i18n";
/** User settings → Instance Admin (admins only): stats, registration policy, users. */
export default function AdminPage() {
  const toast = useUI((u) => u.toast);
  const meId = useAuth((a) => a.me?.id);
  const isOwner = useNexa((n) => !!meId && n.state?.staff?.owner_id === meId);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [key, setKey] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    adminApi.stats().then(setStats).catch(() => setStats(null));
    adminApi.settings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const setMode = async (mode: AdminSettings["registration"]) => {
    const before = settings;
    setSettings((cur) => (cur ? { ...cur, registration: mode } : cur)); // optimistic: the radio moves at once
    try {
      setSettings(await adminApi.patchSettings({ registration: mode }));
    } catch (err) {
      setSettings(before);
      toast(err instanceof ApiError ? err.message : tr_("settings.admin.couldNotChangeThePolicy"), "error");
    }
  };
  const saveKey = async () => {
    try {
      setSettings(await adminApi.patchSettings({ registration_key: key }));
      setKey("");
      toast(tr_("settings.admin.registrationKeySaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : tr_("settings.admin.couldNotSaveTheKey"), "error");
    }
  };
  const clearKey = async () => {
    try {
      setSettings(await adminApi.patchSettings({ registration_key: "" }));
      toast(tr_("settings.admin.registrationKeyCleared"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : tr_("settings.admin.couldNotClearTheKey"), "error");
    }
  };
  return (
    <>
      <h2 className={st.title}>{tr_("settings.admin.instanceAdmin")}</h2>
      <p className={st.hint}>{tr_("settings.admin.youRunThisInstanceTheseSettings")}</p>
      <h5 className={st.h5}>{tr_("server.channelSettings.overview")}</h5>
      {stats ? (
        <div className={st.rows} style={{ margin: 0 }}>
          <div className={st.row}><span className={st.rowLabel}>{tr_("settings.admin.users")}</span><span className={st.rowValue}>{tr_("settings.admin.usersOnline", { users: stats.users, online: stats.online })}</span></div>
          <div className={st.row}><span className={st.rowLabel}>{tr_("rail.rail.servers")}</span><span className={st.rowValue}>{stats.servers}</span></div>
          <div className={st.row}><span className={st.rowLabel}>{tr_("modals.quickSwitcher.messages")}</span><span className={st.rowValue}>{stats.messages}</span></div>
          <div className={st.row}><span className={st.rowLabel}>{tr_("settings.admin.storedFiles")}</span><span className={st.rowValue}>{stats.blobs} · {formatBytes(stats.blob_bytes)}</span></div>
          <div className={st.row}><span className={st.rowLabel}>{tr_("settings.admin.version")}</span><span className={st.rowValue}>{stats.version}</span></div>
        </div>
      ) : <Spinner />}
      <h5 className={st.h5}>{tr_("settings.admin.registration")}</h5>
      {settings ? (
        <>
          {(["open", "invite", "closed"] as const).map((m) => (
            <label key={m} className={st.radio} data-on={settings.registration === m}>
              <input type="radio" checked={settings.registration === m} onChange={() => void setMode(m)} />
              <span className={st.radioText}>
                <span className={st.radioLabel}>{m === "open" ? tr_("settings.admin.open") : m === "invite" ? tr_("settings.admin.inviteOnly") : tr_("settings.admin.closed")}</span>
                <span className={st.radioDesc}>{m === "open" ? tr_("settings.admin.regOpen") : m === "invite" ? tr_("settings.admin.regInvite") : tr_("settings.admin.regClosed")}</span>
              </span>
            </label>
          ))}
          <p className={st.hint}>{tr_("settings.admin.configSays", { value: settings.config_registration })}</p>
          <Field label={settings.registration_key_set ? tr_("settings.admin.registrationKeySet") : tr_("settings.admin.registrationKeyNotSet")} hint={tr_("settings.admin.shareThisWithPeopleYouWant")}>
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder={tr_("settings.admin.newKey")} maxLength={128} />
              <Button size="sm" onClick={() => void saveKey()}>{tr_("chat.editMessage.save")}</Button>
              {settings.registration_key_set ? <Button size="sm" variant="ghost" onClick={() => void clearKey()}>{tr_("modals.quickSwitcher.clear")}</Button> : null}
            </div>
          </Field>
          <p className={st.hint} style={{ marginTop: 12 }}>{tr_("settings.admin.configLimits", { uploads: formatBytes(settings.max_upload_bytes), avatars: formatBytes(settings.max_avatar_bytes), emoji: formatBytes(settings.max_emoji_bytes), stickers: formatBytes(settings.max_sticker_bytes), gif: settings.gif_search ? tr_("settings.admin.on") : tr_("settings.admin.off"), turn: settings.turn ? tr_("settings.admin.configured") : tr_("settings.admin.notConfigured") })}</p>
        </>
      ) : <Spinner />}
      <h5 className={st.h5}>{tr_("settings.admin.users")}</h5>
      <div className={st.panelLink} data-testid="admin-panel-link">
        <span className={st.panelLinkIcon} aria-hidden="true"><Shield size={22} /></span>
        <span className={st.panelLinkText}>
          <span className={st.panelLinkTitle}>{tr_("moderation.title")}</span>
          <span className={st.hint} style={{ margin: 0 }}>{tr_("settings.admin.panelMoved")}</span>
        </span>
        <Button
          size="sm"
          onClick={() => {
            useUI.getState().closeAllModals();
            nav("/channels/@admin");
          }}
        >
          {tr_("settings.admin.openPanel")}
        </Button>
      </div>
      {/* the server compiles these for the instance owner alone */}
      {isOwner ? <LegalResponse /> : null}
      <CrashLog />
    </>
  );
}

/**
 * Answering legal process about one account.
 *
 * Every platform of any size can tell an officer what it holds; this does the
 * same for whoever runs this instance. The button reads the rows that already
 * exist and writes a document out of them — it collects nothing new, and the
 * document says in plain terms which categories are end-to-end encrypted and
 * therefore cannot be produced at all, so the same request does not come back.
 *
 * The document itself is English legal prose written by the server. It is not
 * translated: it may be attached to a filing, and wording that changed with the
 * operator's interface language would be worth less there.
 */
function LegalResponse() {
  const toast = useUI((u) => u.toast);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<LegalReport | null>(null);
  const [copied, setCopied] = useState(false);

  const compile = async () => {
    const asked = who.trim();
    if (!asked) return;
    setBusy(true);
    try {
      setReport(await adminApi.legalReport(asked));
    } catch (err) {
      setReport(null);
      toast(err instanceof ApiError ? err.message : tr_("settings.admin.legal.couldNotCompileTheReport"), "error");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.document], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = report.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.document);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast(tr_("settings.admin.legal.couldNotReachTheClipboardSelect"), "error");
    }
  };

  return (
    <>
      <h5 className={st.h5}>{tr_("settings.admin.legal.lawEnforcementResponse")}</h5>
      <p className={st.hint}>{tr_("settings.admin.legal.compileWhatThisInstanceHolds")}</p>
      <div className={s.searchRow} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <TextInput
          value={who}
          onChange={(e) => setWho(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void compile()}
          placeholder={tr_("settings.admin.legal.usernameOrAccountId")}
          data-testid="legal-report-account"
        />
        <Button size="sm" loading={busy} disabled={!who.trim()} onClick={() => void compile()} data-testid="legal-report-compile">
          {tr_("settings.admin.legal.compileReport")}
        </Button>
      </div>
      {report ? (
        <>
          <p className={st.hint} style={{ marginTop: 8 }}>
            {tr_("settings.admin.legal.compiledForOn", { username: report.username, when: formatFull(report.generated_at) })}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={download}>{tr_("settings.admin.legal.download")}</Button>
            <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? tr_("settings.admin.legal.copied") : tr_("settings.admin.legal.copy")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setReport(null)}>{tr_("modals.quickSwitcher.clear")}</Button>
          </div>
          <pre
            data-testid="legal-report-document"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", background: "var(--bg-raised)", borderRadius: "var(--radius-sm)", padding: 12, margin: "8px 0 0", maxHeight: 420, overflow: "auto" }}
          >
            {report.document}
          </pre>
        </>
      ) : null}
    </>
  );
}

/** What has been breaking, for whoever runs this instance. */
function CrashLog() {
  const [list, setList] = useState<ClientErrorReport[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useUI((u) => u.toast);
  const load = () => adminApi.errors(100).then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []);
  const clear = async () => {
    try {
      await adminApi.clearErrors();
      setList([]);
      toast(tr_("settings.admin.crashLogCleared"), "success");
    } catch {
      toast(tr_("settings.admin.couldNotClearTheLog"), "error");
    }
  };
  return (
    <>
      <h5 className={st.h5}>{tr_("settings.admin.crashes")}</h5>
      <p className={st.hint}>
        What the app reported from people's browsers: the error, where in the code it happened and which build it was. Nothing from a conversation is sent. The newest {list?.length ?? 0} are kept.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <Button size="sm" variant="secondary" onClick={() => void load()}>{tr_("settings.admin.refresh")}</Button>
        {list?.length ? <Button size="sm" variant="danger" onClick={() => void clear()}>{tr_("modals.quickSwitcher.clear")}</Button> : null}
      </div>
      {list === null ? <Spinner /> : null}
      {list?.length === 0 ? <p className={st.hint}>{tr_("settings.admin.nothingHasCrashedGood")}</p> : null}
      {list?.map((e) => (
        <div key={e.id} className={s.memberRow} style={{ alignItems: "flex-start", cursor: "pointer" }} onClick={() => setOpen(open === e.id ? null : e.id)}>
          <div className={s.memberText}>
            <span className={s.memberName} style={{ color: "var(--danger)" }}>{e.message}</span>
            <span className={s.memberSub}>{e.kind} · {e.path || "/"} · {tr_("settings.admin.buildVersion", { version: e.version || tr_("settings.admin.unknown") })} · {formatFull(e.created_at)}</span>
            {open === e.id ? (
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", margin: "8px 0 0", maxHeight: 260, overflow: "auto" }}>
                {e.stack || tr_("settings.admin.noStack")}{e.component ? `\n\ncomponents:${e.component}` : ""}{`\n\n${e.user_agent}`}
              </pre>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}
