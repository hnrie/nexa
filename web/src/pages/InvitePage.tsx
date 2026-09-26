import { KeyRound, Lock } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { NexaWordmark } from "@/components/common/Brand";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { InviteGone, InviteSkeleton, InviteView, targetOfPreview } from "@/components/invite/InviteView";
import { useInviteJoin } from "@/components/invite/useInviteJoin";
import v from "@/components/invite/Invite.module.css";
import LockPage from "@/pages/LockPage";
import PasscodePage from "@/pages/PasscodePage";
import OfflinePage from "@/pages/OfflinePage";
import { parseInviteFragment } from "@/lib/inviteLink";
import { loadInvitePreview, useInvitePreview } from "@/lib/invitePreviews";
import { useAuth } from "@/stores/auth";
import { usePageTitle } from "./AuthLayout";
import s from "./InvitePage.module.css";

import { t } from "@/i18n";
/**
 * Where a link's key waits while its visitor logs in or registers. The key
 * cannot ride along in `?next=`: a query string reaches the server, in the
 * Referer of every request those pages make.
 */
function keyStoreName(code: string): string {
  return `ec.inviteKey.${code}`;
}

function storedFragment(code: string): string {
  try {
    return sessionStorage.getItem(keyStoreName(code)) ?? "";
  } catch {
    return "";
  }
}

function forgetFragment(code: string): void {
  try {
    sessionStorage.removeItem(keyStoreName(code));
  } catch {
    /* nothing was stored */
  }
}

/** The public invite landing page for a server or a group chat. */
export default function InvitePage() {
  const { code = "" } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  const entry = useInvitePreview(code);
  const preview = entry?.status === "ready" ? entry.preview : null;
  const target = preview ? targetOfPreview(preview, "page") : null;
  const fragment = parseInviteFragment(loc.hash) ? loc.hash : storedFragment(code);
  const { member, busy, error, join, open } = useInviteJoin(code, fragment, target, { replace: true, onDone: () => forgetFragment(code) });
  // the lock and offline screens drawn in its place name the tab themselves
  usePageTitle(entry?.status === "invalid" ? t("invite.invalidInvite") : target?.name, status !== "locked" && status !== "pinlocked" && status !== "offline");

  useEffect(() => {
    if (!parseInviteFragment(loc.hash)) return;
    try {
      sessionStorage.setItem(keyStoreName(code), loc.hash);
    } catch {
      /* private mode: the key is only lost if the visitor has to log in first */
    }
  }, [code, loc.hash]);

  // the page lives outside the authed shell, so it restores the session itself
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  useEffect(() => {
    // the gateway (and the stores behind it) only for someone signed in
    if (status === "ready") void import("@/gateway/session").then((m) => m.startSession());
  }, [status]);

  if (status === "locked") return <LockPage />;
  if (status === "pinlocked") return <PasscodePage />;
  if (status === "offline") return <OfflinePage />;
  const next = encodeURIComponent(loc.pathname);
  const isGroup = target?.kind === "group";

  let actions;
  if (status === "ready") {
    actions = member ? (
      <Button size="lg" block variant="secondary" onClick={open} data-testid="invite-open">{isGroup ? t("invite.openGroup") : t("invite.openServer")}</Button>
    ) : (
      <>
        <Button size="lg" block variant="positive" loading={busy} onClick={() => void join()} data-testid="invite-join">{isGroup ? t("invite.joinGroup") : t("invite.joinServer")}</Button>
        {error ? <p className={v.error} role="alert">{error}</p> : null}
      </>
    );
  } else if (status === "anonymous") {
    actions = (
      <>
        <Button size="lg" block onClick={() => nav(`/login?next=${next}`)} data-testid="invite-login">{t("invite.logInToJoin")}</Button>
        <Link to={`/register?next=${next}&invite=${encodeURIComponent(code)}`} className={v.link}>{t("invite.createAnAccount")}</Link>
      </>
    );
  } else {
    actions = <div className={s.waiting}><Spinner /></div>;
  }

  let card;
  if (entry?.status === "invalid") {
    card = (
      <InviteGone variant="page">
        <Link to="/channels/@me" className={v.link}>{t("invite.continueToTheApp")}</Link>
      </InviteGone>
    );
  } else if (!target && entry?.status === "failed") {
    card = (
      <div className={v.view} data-variant="page" data-gone="true">
        <div className={v.gone}>
          <div className={v.goneText}>
            <h1 className={v.goneTitle}>{t("invite.couldNotLoadTheInvite")}</h1>
            <p className={v.goneBody}>{t("invite.checkYourConnection")}</p>
          </div>
        </div>
        <div className={v.goneMore}>
          <Button block onClick={() => void loadInvitePreview(code, { force: true })}>{t("invite.tryAgain")}</Button>
        </div>
      </div>
    );
  } else if (!target) {
    card = <InviteSkeleton variant="page" />;
  } else {
    const inviter = preview?.inviter;
    card = (
      <InviteView
        target={target}
        variant="page"
        lead={inviter ? t("invite.invitedYouToJoin", { name: inviter.display_name || inviter.username }) : t("invite.youveBeenInvited")}
        actions={actions}
      >
        {!member && fragment.includes("k=") ? <p className={v.note}><KeyRound size={14} aria-hidden="true" />{t("invite.thisLinkCarriesTheEncryptionKey")}</p> : null}
        {!member && isGroup ? <p className={v.note}><Lock size={14} aria-hidden="true" />{t("invite.groupChatsAreEndToEnd")}</p> : null}
      </InviteView>
    );
  }

  return (
    <div className={s.page}>
      {/* what this is, for someone who has never heard of it, and a way on from a dead link */}
      <Link to="/" className={s.brand} aria-label="Nexa"><NexaWordmark height={32} /></Link>
      <main className={s.invite} data-testid="invite-page">{card}</main>
    </div>
  );
}
