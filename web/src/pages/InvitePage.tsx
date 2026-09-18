import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { InvitePreview } from "@/api/types";
import { iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { startSession } from "@/gateway/session";
import LockPage from "@/pages/LockPage";
import PasscodePage from "@/pages/PasscodePage";
import { hasLock } from "@/lib/appLock";
import OfflinePage from "@/pages/OfflinePage";
import { initials } from "@/lib/avatarColor";
import { parseInviteFragment } from "@/lib/inviteLink";
import { keystore } from "@/crypto/keystore";
import { ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useServers } from "@/stores/servers";
import { useUsers } from "@/stores/users";
import s from "./InvitePage.module.css";
import { guarded } from "@/lib/captcha";

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

/** The public invite landing page for a server or a group chat. */
export default function InvitePage() {
  const { code = "" } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const alreadyIn = useServers((st) => (preview?.server ? !!st.byId[preview.server.id] : false));
  const inGroup = useChannels((c) => (preview?.group ? !!c.byId[preview.group.id] : false));
  const [error, setError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fragment = parseInviteFragment(loc.hash) ? loc.hash : storedFragment(code);

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
    if (status === "ready") void startSession();
  }, [status]);

  useEffect(() => {
    let alive = true;
    serversApi
      .invitePreview(code)
      .then((p) => alive && setPreview(p))
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 404 ? t("invite.thisInviteIsInvalidOrHasExpired") : t("invite.couldNotLoadTheInvite")));
    return () => {
      alive = false;
    };
  }, [code]);

  const accept = async () => {
    if (busy || !preview) return;
    setBusy(true);
    setAcceptError(null);
    try {
      const res = await guarded("join", (captcha) => serversApi.join(code, captcha));
      // What came back decides, rather than what the preview said and a cast
      // through `unknown`: a field that is absent or renamed used to navigate
      // to /channels/@me/undefined and bounce home with no explanation.
      if ("channel" in res) {
        if (res.users) useUsers.getState().upsert(res.users);
        useChannels.getState().upsert(res.channel);
        nav(`/channels/@me/${res.channel.id}`, { replace: true });
        return;
      }
      if (!("server" in res)) throw new Error(t("invite.couldNotAcceptTheInvite"));
      useUsers.getState().upsert(res.users);
      useChannels.getState().upsert(res.server.channels);
      useServers.getState().setFromView(res.server);
      const key = parseInviteFragment(fragment);
      const userId = useKeys.getState().userId;
      if (key && userId && !ring.get(res.server.id, key.epoch)) {
        ring.set(res.server.id, key.epoch, key.root);
        // behind a passcode the key stays off the disk; the self-grant brings it back
        if (!hasLock(userId)) await keystore.saveRoot(userId, res.server.id, key.epoch, key.root);
        // a self-grant records the key server-side so other devices and later logins have it
        await useKeys.getState().grantTo(res.server.id, key.epoch, [userId]);
      }
      try {
        sessionStorage.removeItem(keyStoreName(code));
      } catch {
        /* nothing was stored */
      }
      const first = res.server.channels.find((c) => c.type === "text");
      nav(first ? `/channels/${res.server.id}/${first.id}` : `/channels/${res.server.id}`, { replace: true });
    } catch (err) {
      // the invite itself is still fine, so this sits by the button rather than replacing the card
      setAcceptError(err instanceof ApiError ? err.message : t("invite.couldNotAcceptTheInvite"));
    } finally {
      setBusy(false);
    }
  };

  if (status === "locked") return <LockPage />;
  if (status === "pinlocked") return <PasscodePage />;
  if (status === "offline") return <OfflinePage />;
  const next = encodeURIComponent(loc.pathname);
  const target = preview?.server ?? preview?.group;
  const icon = target ? iconUrl(target.icon_id, 96) : null;
  const isGroup = !!preview?.group;
  const member = isGroup ? inGroup : alreadyIn;
  return (
    <div className={s.page}>
      <div className={s.card}>
        {!preview && !error ? <Spinner /> : null}
        {error ? (
          <>
            <div className={s.iconBox} data-invalid="true">!</div>
            <h1 className={s.title}>{t("invite.inviteInvalid")}</h1>
            <p className={s.sub}>{error}</p>
            <Link to="/channels/@me" className={s.link}>{t("invite.continueToTheApp")}</Link>
          </>
        ) : null}
        {preview && target ? (
          <>
            <p className={s.kicker}>{preview.inviter ? t("invite.invitedYouToJoin", { name: preview.inviter.display_name || preview.inviter.username }) : t("invite.youveBeenInvited")}</p>
            <div className={s.iconBox}>{icon ? <img src={icon} alt="" /> : initials(target.name)}</div>
            <h1 className={s.title}>{target.name}</h1>
            {preview.server?.description ? <p className={s.sub}>{preview.server.description}</p> : null}
            <div className={s.counts}>
              {preview.server ? <span><i className={s.online} /> {t("invite.onlineCount", { count: preview.server.online_count })}</span> : null}
              <span><i className={s.offline} /> {isGroup ? t("invite.inThisGroupCount", { count: target.member_count }) : t("invite.membersCount", { count: target.member_count })}</span>
            </div>
            {status === "ready" ? (
              member ? (
                <Button block onClick={() => nav(isGroup ? `/channels/@me/${target.id}` : `/channels/${target.id}`)}>{t("invite.youReAlreadyInOpen")}</Button>
              ) : (
                <>
                  <Button block loading={busy} onClick={() => void accept()}>{isGroup ? t("invite.joinGroup") : t("invite.acceptInvite")}</Button>
                  {acceptError ? <p className={s.acceptError} role="alert">{acceptError}</p> : null}
                </>
              )
            ) : status === "anonymous" ? (
              <div className={s.authRow}>
                <Button block onClick={() => nav(`/login?next=${next}`)}>{t("invite.logInToAccept")}</Button>
                <Link to={`/register?next=${next}&invite=${encodeURIComponent(code)}`} className={s.link}>{t("invite.needAnAccountRegister")}</Link>
              </div>
            ) : (
              <Spinner />
            )}
            {fragment.includes("k=") ? <p className={s.note}>{t("invite.thisLinkCarriesTheEncryptionKey")}</p> : null}
            {isGroup ? <p className={s.note}>{t("invite.groupChatsAreEndToEnd")}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
