import { CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apps as appsApi, type AuthorizeInfo } from "@/api/apps";
import { AppIcon } from "@/components/apps/AppIcon";
import { PermissionPicker } from "@/components/apps/PermissionPicker";
import { ReadingGlass } from "@/components/apps/ReadingGlass";
import { NexaWordmark } from "@/components/common/Brand";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { HookTags } from "@/components/chat/webhook/HookHeader";
import { t } from "@/i18n";
import { scopeWords } from "@/components/settings/AuthorizedAppsPage";
import { describeError } from "@/lib/errors";
import { P, parsePerm, permString } from "@/lib/perms";
import { formatShortDate } from "@/lib/time";
import { useAppCommands } from "@/stores/appCommands";
import { usePageTitle } from "./AuthLayout";
import s from "./InvitePage.module.css";
import a from "./AuthorizePage.module.css";

/**
 * The page a link that adds an app opens: what the app is, where it goes (a
 * server this account manages, or the account itself), what it will be able
 * to do there, and what it can read. Each permission its bot asks for can be
 * taken away before saying yes; none can be added.
 */
export default function AuthorizePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState(() => location.search.replace(/^\?/, ""));
  const [info, setInfo] = useState<AuthorizeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guild, setGuild] = useState<string | null>(null);
  const [granted, setGranted] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ guildId?: string; redirecting?: boolean } | null>(null);
  usePageTitle(info ? t("apps.consent.pageTitle", { app: info.application.name }) : t("apps.consent.pageTitleBare"));

  useEffect(() => {
    let alive = true;
    setError(null);
    appsApi
      .authorizeInfo(query)
      .then((res) => {
        if (!alive) return;
        setInfo(res);
        setGranted(parsePerm(res.permissions));
        const usable = (res.servers ?? []).filter((sv) => !sv.banned);
        setGuild((cur) => cur ?? res.guild_id ?? (usable.length === 1 ? usable[0]!.id : null));
      })
      .catch((err) => alive && setError(describeError(err, t("apps.consent.couldNotLoad"))));
    return () => {
      alive = false;
    };
  }, [query]);

  const toAccount = info?.integration_type === 1;
  const ways = info?.application.install_types ?? [];
  // a link that did not say how, for an app that goes both ways, lets the person choose
  const canChoose = !!info && !info.type_chosen && ways.includes(0) && ways.includes(1);
  const choose = (type: number) => {
    const q = new URLSearchParams(query);
    q.set("integration_type", String(type));
    if (type === 1) q.set("scope", (q.get("scope") ?? "applications.commands").split(/[ +]/).filter((x) => x && x !== "bot" && x !== "webhook.incoming").join(" ") || "applications.commands");
    setInfo(null);
    setQuery(q.toString().replace(/\+/g, "%20"));
  };
  const asksBot = !!info?.scopes.includes("bot");
  const requested = parsePerm(info?.permissions);
  // what it may do: on an account, its commands go everywhere; in a server, they are the server's
  const words = useMemo(() => {
    if (!info) return [];
    if (toAccount) return scopeWords(info.scopes, true);
    const rest = scopeWords(info.scopes.filter((x) => x !== "bot" && x !== "applications.commands"), false);
    return info.scopes.includes("applications.commands") ? [t("apps.consent.serverCommands"), ...rest] : rest;
  }, [info, toAccount]);
  const servers = info?.servers ?? [];
  const pickedServer = servers.find((sv) => sv.id === guild);

  const authorize = async () => {
    if (!info || busy) return;
    if (!toAccount && !guild) return;
    setBusy(true);
    try {
      const res = await appsApi.authorize(query, { ...(guild && !toAccount ? { guild_id: guild } : {}), ...(asksBot ? { permissions: permString(granted) } : {}) });
      useAppCommands.getState().forget();
      if (res.location) {
        setDone({ redirecting: true });
        window.location.href = res.location;
        return;
      }
      setDone(res.guild_id ? { guildId: res.guild_id } : {});
    } catch (err) {
      setError(describeError(err, t("apps.consent.failed")));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    // the app is told it was turned down, where it said to send people back
    if (info?.redirect_uri) {
      const u = new URL(info.redirect_uri);
      u.searchParams.set("error", "access_denied");
      const state = new URLSearchParams(query).get("state");
      if (state) u.searchParams.set("state", state);
      window.location.href = u.toString();
      return;
    }
    navigate("/channels/@me");
  };

  return (
    <div className={s.page}>
      <Link to="/channels/@me" className={s.brand} aria-label="Nexa">
        <NexaWordmark />
      </Link>
      <main className={[s.card, a.card].join(" ")} data-testid="authorize-page">
        {!info && !error ? <Spinner /> : null}
        {error && !info ? (
          <>
            <div className={s.iconBox} data-invalid="true">!</div>
            <h1 className={s.title}>{t("apps.consent.unavailable")}</h1>
            <p className={s.sub}>{error}</p>
            <Link to="/channels/@me" className={s.link}>{t("stickerPack.backToTheApp")}</Link>
          </>
        ) : null}
        {info && done ? (
          <>
            <CheckCircle2 size={56} className={a.doneIcon} aria-hidden="true" />
            <h1 className={s.title}>{done.redirecting ? t("apps.consent.redirecting", { app: info.application.name }) : toAccount ? t("apps.consent.addedToAccount", { app: info.application.name }) : t("apps.consent.addedToServer", { app: info.application.name, server: pickedServer?.name ?? "" })}</h1>
            {done.redirecting ? <Spinner /> : null}
            {!done.redirecting ? (
              <div className={s.actions}>
                {done.guildId ? <Button size="lg" onClick={() => navigate(`/channels/${done.guildId}`)} data-testid="go-to-server">{t("apps.consent.goToServer", { server: pickedServer?.name ?? "" })}</Button> : <Button size="lg" onClick={() => navigate("/channels/@me")}>{t("stickerPack.backToTheApp")}</Button>}
              </div>
            ) : null}
          </>
        ) : null}
        {info && !done ? (
          <>
            <div className={a.who}>
              <AppIcon app={info.application} size={72} square />
              <h1 className={[s.title, a.name].join(" ")}>
                <span dir="auto">{info.application.name}</span>
                <HookTags app />
              </h1>
              <p className={a.asks}>{toAccount ? t("apps.consent.wantsAccount") : t("apps.consent.wantsServer")}</p>
              {info.application.description ? <p className={a.desc} dir="auto">{info.application.description}</p> : null}
            </div>
            {canChoose ? (
              <div className={a.ways} role="tablist" aria-label={t("apps.consent.howToAdd")}>
                <button type="button" role="tab" aria-selected={!toAccount} className={a.way} onClick={() => choose(0)}>{t("apps.consent.addToServer")}</button>
                <button type="button" role="tab" aria-selected={toAccount} className={a.way} onClick={() => choose(1)}>{t("apps.consent.addToAccount")}</button>
              </div>
            ) : null}
            {!toAccount ? (
              <section className={a.section}>
                <h2 className={a.head}>{t("apps.consent.pickServer")}</h2>
                {servers.length === 0 ? <p className={a.muted}>{t("apps.consent.noServers")}</p> : null}
                <div className={a.servers} role="radiogroup" aria-label={t("apps.consent.pickServer")}>
                  {servers.map((sv) => {
                    const locked = sv.banned || (info.disable_guild_select && !!info.guild_id && sv.id !== info.guild_id);
                    return (
                      <label key={sv.id} className={a.server} data-on={guild === sv.id || undefined} data-locked={locked || undefined}>
                        <input type="radio" name="server" checked={guild === sv.id} disabled={locked} onChange={() => setGuild(sv.id)} />
                        <Avatar id={sv.id} avatarId={sv.icon_id} name={sv.name} size={32} kind="icon" square />
                        <span className={a.serverText}>
                          <span className={a.serverName} dir="auto">{sv.name}</span>
                          {sv.banned ? <span className={a.serverNote}>{t("apps.consent.banned")}</span> : sv.has_bot ? <span className={a.serverNote}>{t("apps.consent.alreadyThere")}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {words.length ? (
              <section className={a.section}>
                <h2 className={a.head}>{t("apps.consent.itCan")}</h2>
                <ul className={a.list}>
                  {words.map((w) => (
                    <li key={w}><CheckCircle2 size={16} aria-hidden="true" />{w}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {asksBot && requested ? (
              <section className={a.section}>
                <h2 className={a.head}>{t("apps.consent.botCan")}</h2>
                {(requested & P.ADMINISTRATOR) !== 0n ? (
                  <p className={a.warn}>
                    <ShieldAlert size={16} aria-hidden="true" />
                    {t("apps.consent.adminWarning")}
                  </p>
                ) : null}
                <PermissionPicker value={granted} onChange={setGranted} only={requested} columns={1} />
              </section>
            ) : null}
            {asksBot ? (
              <section className={a.section}>
                <h2 className={a.head}>{t("apps.glass.title", { app: info.application.name })}</h2>
                <ReadingGlass name={info.application.name} everything={info.application.intents.message_content} compact />
              </section>
            ) : null}
            {error ? (
              <p className={a.error} role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                {error}
              </p>
            ) : null}
            <div className={a.actions}>
              <Button variant="secondary" size="lg" onClick={cancel}>{t("apps.cancel")}</Button>
              <Button size="lg" loading={busy} disabled={!toAccount && !guild} onClick={() => void authorize()} data-testid="authorize">{t("apps.consent.authorize")}</Button>
            </div>
            <p className={a.fine}>
              {info.application.terms_url || info.application.privacy_url ? (
                <>
                  {t("apps.consent.theirTerms", { app: info.application.name })}{" "}
                  {info.application.terms_url ? <a href={info.application.terms_url} target="_blank" rel="noopener noreferrer">{t("apps.consent.terms")}</a> : null}
                  {info.application.terms_url && info.application.privacy_url ? " " : null}
                  {info.application.privacy_url ? <a href={info.application.privacy_url} target="_blank" rel="noopener noreferrer">{t("apps.consent.privacy")}</a> : null}
                </>
              ) : null}
              {info.application.created_at ? <span>{t("apps.consent.madeOn", { date: formatShortDate(info.application.created_at) })}</span> : null}
              {info.redirect_uri ? <span>{t("apps.consent.redirectTo", { host: hostOf(info.redirect_uri) })}</span> : null}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
