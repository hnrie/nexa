import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { NexaWordmark } from "@/components/common/Brand";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { NoteLinkView, linkSecret } from "@/components/notes/NoteLinkView";
import LockPage from "@/pages/LockPage";
import OfflinePage from "@/pages/OfflinePage";
import PasscodePage from "@/pages/PasscodePage";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { usePageTitle } from "./AuthLayout";
import s from "./InvitePage.module.css";
import { t } from "@/i18n";

/**
 * Where a link's key waits while its visitor signs in or makes an account.
 * The key cannot ride along in `?next=`: a query string reaches the server,
 * and the key is the part of the link the server must never see.
 */
function keyStoreName(token: string): string {
  return `ec.noteKey.${token}`;
}

function storedHash(token: string): string {
  try {
    return sessionStorage.getItem(keyStoreName(token)) ?? "";
  } catch {
    return "";
  }
}

/**
 * The page a note's share link lands on: what the note is, and joining it.
 * Someone not signed in is asked to sign in first and comes back here, with
 * the link's key kept on this tab meanwhile.
 */
export default function NoteLinkPage() {
  const { token = "" } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  // the link's key opens the note on this device; this account's own keys seal it to the account
  const keysOpen = useKeys((k) => k.identity !== null);
  const hash = loc.hash.length > 1 ? loc.hash : storedHash(token);
  const secret = linkSecret(token, hash);
  usePageTitle(t("notes.link.pageTitle"), status !== "locked" && status !== "pinlocked" && status !== "offline");

  useEffect(() => {
    if (!linkSecret(token, loc.hash)) return;
    try {
      sessionStorage.setItem(keyStoreName(token), loc.hash);
    } catch {
      /* private mode: the key is only lost if the visitor has to sign in first */
    }
  }, [token, loc.hash]);

  // the page lives outside the app's shell, so it restores the session itself
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  useEffect(() => {
    if (status === "ready") void import("@/gateway/session").then((m) => m.startSession());
  }, [status]);

  if (status === "locked") return <LockPage />;
  if (status === "pinlocked") return <PasscodePage />;
  if (status === "offline") return <OfflinePage />;

  const next = encodeURIComponent(loc.pathname);
  const forget = () => {
    try {
      sessionStorage.removeItem(keyStoreName(token));
    } catch {
      /* nothing was stored */
    }
  };

  let body;
  if (status === "anonymous") {
    body = (
      <main className={s.card} data-testid="note-link-page">
        <p className={s.kicker}>{t("notes.link.shared")}</p>
        <h1 className={s.title}>{t("notes.link.pageTitle")}</h1>
        <p className={s.sub}>{t("notes.link.signInToOpen")}</p>
        <div className={s.actions}>
          <Button size="lg" block onClick={() => nav(`/login?next=${next}`)} data-testid="note-link-login">
            {t("invite.logInToJoin")}
          </Button>
          <Link to={`/register?next=${next}`} className={s.link}>
            {t("invite.createAnAccount")}
          </Link>
        </div>
      </main>
    );
  } else if (status !== "ready" || !keysOpen) {
    body = (
      <main className={s.card}>
        <div className={s.waiting}>
          <Spinner label={t("notes.link.opening")} />
        </div>
      </main>
    );
  } else {
    body = (
      <main className={s.invite} data-testid="note-link-page">
        <NoteLinkView secret={secret} variant="page" onDone={forget} />
      </main>
    );
  }

  return (
    <div className={s.page}>
      {/* what this is, for someone who has never heard of it, and a way on from a dead link */}
      <Link to="/" className={s.brand} aria-label="Nexa">
        <NexaWordmark height={32} />
      </Link>
      {body}
    </div>
  );
}
