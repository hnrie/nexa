import { AppWindow } from "lucide-react";
import { useEffect, useState } from "react";
import { apps as appsApi, type AuthorizedApp } from "@/api/apps";
import { AppIcon } from "@/components/apps/AppIcon";
import { HookTags } from "@/components/chat/webhook/HookHeader";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { Spinner } from "@/components/common/Spinner";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";
import { formatShortDate } from "@/lib/time";
import { useAppCommands } from "@/stores/appCommands";
import { useUI } from "@/stores/ui";
import p from "./portal/Portal.module.css";
import s from "./Settings.module.css";

/** What an app was let do, in words, from the scopes it was given. */
export function scopeWords(scopes: readonly string[], installed: boolean): string[] {
  const out: string[] = [];
  if (installed || scopes.includes("applications.commands")) out.push(t("apps.authorized.commands"));
  if (scopes.includes("identify")) out.push(t("apps.authorized.identify"));
  if (scopes.includes("email")) out.push(t("apps.authorized.email"));
  if (scopes.includes("guilds")) out.push(t("apps.authorized.guilds"));
  if (scopes.includes("guilds.join")) out.push(t("apps.authorized.guildsJoin"));
  if (scopes.includes("guilds.members.read")) out.push(t("apps.authorized.membersRead"));
  if (scopes.includes("connections")) out.push(t("apps.authorized.connections"));
  return out;
}

/**
 * Settings, Authorized Apps: the apps this account let in, on itself rather
 * than on a server, with what each may do, and a way to take it back.
 */
export default function AuthorizedAppsPage() {
  const [list, setList] = useState<AuthorizedApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const openModal = useUI((u) => u.openModal);
  const toast = useUI((u) => u.toast);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    appsApi
      .authorized()
      .then((l) => alive && setList(l))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const remove = (a: AuthorizedApp) =>
    openModal("confirm", {
      title: t("apps.authorized.removeNamed", { name: a.application.name }),
      body: t("apps.authorized.removeBody", { name: a.application.name }),
      confirmLabel: t("apps.authorized.remove"),
      danger: true,
      onConfirm: async () => {
        try {
          await appsApi.deauthorize(a.application.id);
          setList((cur) => cur?.filter((x) => x.application.id !== a.application.id) ?? cur);
          useAppCommands.getState().forget();
          toast(t("apps.authorized.removed", { name: a.application.name }), "success");
        } catch (err) {
          toast(describeError(err, t("apps.authorized.removeFailed")), "error");
        }
      },
    });
  return (
    <>
      <h2 className={s.title}>{t("apps.authorized.title")}</h2>
      <p className={p.intro}>{t("apps.authorized.intro")}</p>
      {list === null && !failed ? <Spinner label={t("apps.portal.loading")} /> : null}
      {failed ? <LoadError message={t("apps.authorized.couldNotLoad")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {list && list.length === 0 ? (
        <div className={p.empty}>
          <span className={p.emptyIcon} aria-hidden="true">
            <AppWindow size={24} />
          </span>
          <span className={p.emptyText}>{t("apps.authorized.none")}</span>
        </div>
      ) : null}
      {list?.map((a) => {
        const words = scopeWords(a.scopes, a.installed);
        return (
          <div key={a.application.id} className={s.device} data-testid="authorized-app">
            <div className={s.deviceMain}>
              <AppIcon app={a.application} size={40} />
              <div className={s.deviceText}>
                <div className={s.deviceName} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span dir="auto">{a.application.name}</span>
                  <HookTags app />
                </div>
                {words.length ? <div className={s.deviceSub}>{words.join(" ")}</div> : null}
                <div className={s.deviceSub}>{t("apps.authorized.since", { date: formatShortDate(a.authorized_at) })}</div>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => remove(a)} data-testid="authorized-remove">{t("apps.authorized.remove")}</Button>
          </div>
        );
      })}
    </>
  );
}
