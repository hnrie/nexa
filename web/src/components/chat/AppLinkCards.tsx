import { Bot } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apps as appsApi, type AuthorizeInfo } from "@/api/apps";
import { AppIcon } from "@/components/apps/AppIcon";
import { Button } from "@/components/common/Button";
import v from "@/components/invite/Invite.module.css";
import w from "@/components/chat/webhook/Webhook.module.css";
import pk from "./PackCards.module.css";
import a from "./AppLinkCards.module.css";
import { t } from "@/i18n";
import { appInstallLinksIn, type AppInstallLinkRef } from "@/lib/appLinks";

/** What each app link said, asked once a session: the app as its install page shows it, or null when it cannot be added. */
const asked = new Map<string, Promise<AuthorizeInfo | null>>();

function lookUp(link: AppInstallLinkRef): Promise<AuthorizeInfo | null> {
  let p = asked.get(link.clientId);
  if (!p) {
    p = appsApi.authorizeInfo(`client_id=${link.clientId}`).catch(() => null);
    asked.set(link.clientId, p);
  }
  return p;
}

/**
 * The apps under a message that links to their install page: each app's
 * picture, name and description, with Add App, which opens the install page
 * and comes back to this conversation once it is done.
 */
export function AppLinkCards({ nodes }: { nodes: unknown }) {
  const links = useMemo(() => appInstallLinksIn(nodes), [nodes]);
  if (links.length === 0) return null;
  return (
    <div className={pk.cards}>
      {links.map((l) => <AppLinkCard key={l.clientId} link={l} />)}
    </div>
  );
}

function AppLinkCard({ link }: { link: AppInstallLinkRef }) {
  const [info, setInfo] = useState<AuthorizeInfo | null | undefined>(undefined);
  const nav = useNavigate();
  const here = useLocation();
  useEffect(() => {
    let alive = true;
    void lookUp(link).then((res) => alive && setInfo(res));
    return () => {
      alive = false;
    };
  }, [link]);
  if (info === undefined) {
    return (
      <div className={[v.view, pk.card, a.card].join(" ")} data-variant="card" data-loading="true" aria-busy="true" data-testid="app-link-card" data-app-state="loading">
        <span className="visually-hidden">{t("apps.linkCard.loading")}</span>
        <div className={pk.head}>
          <span className={pk.cover} />
          <div className={v.main}>
            <span className={v.bar} data-w="name" />
            <span className={v.bar} data-w="counts" />
          </div>
        </div>
      </div>
    );
  }
  if (info === null) {
    return (
      <div className={v.view} data-variant="card" data-gone="true" data-testid="app-link-card" data-app-state="gone">
        <div className={v.gone}>
          <span className={v.goneIcon} aria-hidden="true"><Bot size={22} /></span>
          <div className={v.goneText}>
            <p className={v.goneTitle}>{t("apps.linkCard.goneTitle")}</p>
            <p className={v.goneBody}>{t("apps.linkCard.goneBody")}</p>
          </div>
        </div>
      </div>
    );
  }
  const app = info.application;
  // the invite card's frame and type with no band, as a pack's card: the
  // app's picture, its name with the APP tag, Add App beside them, and what it says about itself
  return (
    <div className={[v.view, pk.card, a.card].join(" ")} data-variant="card" role="group" aria-label={app.name} data-testid="app-link-card" data-app-state="ready">
      <div className={pk.head}>
        <span className={a.picture}><AppIcon app={app} size={56} square /></span>
        <div className={v.main}>
          <p className={v.name}>
            <bdi>{app.name}</bdi> <span className={w.appTag}>{t("webhook.appTag")}</span>
          </p>
        </div>
        <div className={v.cardActions}>
          <Button size="sm" onClick={() => nav(link.path, { state: { from: here.pathname + here.search } })} data-testid="app-link-add">
            {t("apps.profile.addApp")}
          </Button>
        </div>
      </div>
      {app.description ? <p className={[v.desc, pk.desc].join(" ")} dir="auto">{app.description}</p> : null}
    </div>
  );
}
