import { Bot, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apps as appsApi, type OwnedApp } from "@/api/apps";
import { AppIcon } from "@/components/apps/AppIcon";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { HookTags } from "@/components/chat/webhook/HookHeader";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";
import { unlessUnsaved } from "@/stores/unsaved";
import st from "../Settings.module.css";
import { AppDetail } from "./AppDetail";
import { LibrarySnippets, SecretReveal } from "./portalParts";
import s from "./Portal.module.css";

/** This server's own address, which bot libraries are pointed at. */
export function serverBase(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/**
 * Settings, Developer Portal: the apps this account made, and the way to make
 * one. An app is a program with a bot account, which people add to their
 * servers or their own account; its bot is run by a bot library made for
 * Discord (discord.py, discord.js, discordgo and the rest), pointed at this
 * server with the lines shown here.
 */
export default function DeveloperPortalPage() {
  const [list, setList] = useState<OwnedApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    appsApi
      .mine()
      .then((l) => alive && setList(l))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const changed = useCallback((app: OwnedApp | null, id?: string) => {
    setList((cur) => {
      if (!cur) return cur;
      if (!app) return cur.filter((a) => a.id !== id);
      return cur.some((a) => a.id === app.id) ? cur.map((a) => (a.id === app.id ? app : a)) : [app, ...cur];
    });
  }, []);

  const current = open ? list?.find((a) => a.id === open) : undefined;
  if (current) {
    return (
      <AppDetail
        app={current}
        onBack={unlessUnsaved(() => setOpen(null))}
        onChange={(a) => changed(a)}
        onDeleted={() => {
          changed(null, current.id);
          setOpen(null);
        }}
      />
    );
  }
  return (
    <>
      <h2 className={st.title}>{t("apps.portal.title")}</h2>
      <p className={s.intro}>{t("apps.portal.intro")}</p>
      <div className={s.bar}>
        <Button onClick={() => setMaking(true)} data-testid="app-new">
          <Plus size={16} aria-hidden="true" /> {t("apps.portal.newApp")}
        </Button>
        {list ? <span className={s.count}>{t("apps.portal.count", { count: list.length, max: 25 })}</span> : null}
      </div>
      <h3 className={st.h5}>{t("apps.portal.yourApps")}</h3>
      {list === null && !failed ? <Spinner label={t("apps.portal.loading")} /> : null}
      {failed ? <LoadError message={t("apps.portal.couldNotLoad")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {list && list.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">
            <Bot size={24} />
          </span>
          <span className={s.emptyText}>{t("apps.portal.empty")}</span>
        </div>
      ) : null}
      <div className={s.list}>
        {list?.map((app) => (
          <button key={app.id} type="button" className={s.appRow} onClick={() => setOpen(app.id)} data-testid="app-row">
            <AppIcon app={app} size={40} />
            <span className={s.appText}>
              <span className={s.appName}>
                <span dir="auto">{app.name}</span>
                {app.intents.message_content ? (
                  <span className={s.readsAll}>
                    <TriangleAlert size={11} aria-hidden="true" />
                    {t("apps.portal.readsEverything")}
                  </span>
                ) : null}
              </span>
              <span className={s.appMeta}>
                {reach(app).map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </span>
            </span>
            <ChevronRight size={18} className={s.chev} aria-hidden="true" />
          </button>
        ))}
      </div>
      <h3 className={st.h5}>{t("apps.portal.connect")}</h3>
      <p className={st.hint} style={{ marginBottom: 12 }}>{t("apps.portal.connectHint")}</p>
      <LibrarySnippets base={serverBase()} />
      {making ? (
        <NewAppDialog
          onClose={() => setMaking(false)}
          onMade={(app) => {
            changed(app);
            setMaking(false);
            setOpen(app.id);
          }}
        />
      ) : null}
    </>
  );
}

/** Where an app is: how many servers and accounts it is in, each said on its own. */
function reach(app: OwnedApp): string[] {
  if (!app.server_count && !app.user_install_count) return [t("apps.portal.nowhere")];
  const parts: string[] = [];
  if (app.server_count) parts.push(t("apps.portal.inServers", { count: app.server_count }));
  if (app.user_install_count) parts.push(t("apps.portal.onAccounts", { count: app.user_install_count }));
  return parts;
}

/**
 * Making an app: its name first, then its bot's token, shown this once. The
 * app opens once the token has been dealt with.
 */
function NewAppDialog({ onClose, onMade }: { onClose: () => void; onMade: (app: OwnedApp) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ app: OwnedApp; token: string } | null>(null);
  const create = async () => {
    const n = name.trim();
    if ([...n].length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appsApi.create(n);
      setMade({ app: res.application, token: res.token });
    } catch (err) {
      setError(describeError(err, t("apps.portal.createFailed")));
    } finally {
      setBusy(false);
    }
  };
  if (made) {
    return (
      <Modal open onClose={() => onMade(made.app)} closeOnOverlay={false} width={500} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{made.app.name} <HookTags app /></span>}>
        <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: "21px", color: "var(--text-subtle)" }}>{t("apps.portal.madeIntro")}</p>
        <SecretReveal value={made.token} note={t("apps.portal.tokenNote")} onDone={() => onMade(made.app)} testId="new-token" />
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t("apps.portal.newApp")}
      onSubmit={() => void create()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t("apps.cancel")}</Button>
          <Button loading={busy} disabled={[...name.trim()].length < 2} onClick={() => void create()} data-testid="app-create">{t("apps.portal.create")}</Button>
        </>
      }
    >
      <Field label={t("apps.portal.name")} error={error} hint={t("apps.portal.nameHint")}>
        <TextInput autoFocus value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-testid="app-name" />
      </Field>
    </Modal>
  );
}
