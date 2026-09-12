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

/** The public invite landing page: preview, then accept (logging in first if needed). */
export default function InvitePage() {
  const { code = "" } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const status = useAuth((a) => a.status);
  const bootstrap = useAuth((a) => a.bootstrap);
  const meId = useAuth((a) => a.me?.id);
  // the page lives outside the authed shell, so it restores the session itself
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  useEffect(() => {
    if (status === "ready") void startSession();
  }, [status]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const member = useServers((st) => (preview ? st.byId[preview.server.id] : undefined));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    serversApi
      .invitePreview(code)
      .then((p) => alive && setPreview(p))
      .catch((err) => alive && setError(err instanceof ApiError && err.status === 404 ? "This invite is invalid or has expired." : "Could not load the invite."));
    return () => {
      alive = false;
    };
  }, [code]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await serversApi.join(code);
      useUsers.getState().upsert(res.users);
      useChannels.getState().upsert(res.server.channels);
      useServers.getState().setFromView(res.server);
      const key = parseInviteFragment(loc.hash);
      const userId = useKeys.getState().userId;
      if (key && userId && !ring.get(res.server.id, key.epoch)) {
        ring.set(res.server.id, key.epoch, key.root);
        await keystore.saveRoot(userId, res.server.id, key.epoch, key.root);
        // a self-grant records the key server-side so other devices and later logins have it
        await useKeys.getState().grantTo(res.server.id, key.epoch, [userId]);
      }
      const first = res.server.channels.find((c) => c.type === "text");
      nav(first ? `/channels/${res.server.id}/${first.id}` : `/channels/${res.server.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the server.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "locked") return <LockPage />;
  const next = encodeURIComponent(loc.pathname + loc.hash);
  const icon = preview ? iconUrl(preview.server.icon_id) : null;
  return (
    <div className={s.page}>
      <div className={s.card}>
        {!preview && !error ? <Spinner /> : null}
        {error ? (
          <>
            <div className={s.iconBox} data-invalid="true">!</div>
            <h1 className={s.title}>Invite Invalid</h1>
            <p className={s.sub}>{error}</p>
            <Link to="/channels/@me" className={s.link}>Continue to the app</Link>
          </>
        ) : null}
        {preview ? (
          <>
            <p className={s.kicker}>{preview.inviter ? `${preview.inviter.display_name || preview.inviter.username} invited you to join` : "You've been invited to join"}</p>
            <div className={s.iconBox}>{icon ? <img src={icon} alt="" /> : initials(preview.server.name)}</div>
            <h1 className={s.title}>{preview.server.name}</h1>
            {preview.server.description ? <p className={s.sub}>{preview.server.description}</p> : null}
            <div className={s.counts}>
              <span><i className={s.online} /> {preview.server.online_count} Online</span>
              <span><i className={s.offline} /> {preview.server.member_count} Members</span>
            </div>
            {status === "ready" ? (
              member && meId ? (
                <Button block onClick={() => nav(`/channels/${preview.server.id}`)}>You're already a member — Open</Button>
              ) : (
                <Button block loading={busy} onClick={() => void accept()}>Accept Invite</Button>
              )
            ) : status === "anonymous" ? (
              <div className={s.authRow}>
                <Button block onClick={() => nav(`/login?next=${next}`)}>Log in to accept</Button>
                <Link to={`/register?next=${next}&invite=${encodeURIComponent(code)}`} className={s.link}>Need an account? Register</Link>
              </div>
            ) : (
              <Spinner />
            )}
            {loc.hash.includes("k=") ? <p className={s.note}>This link carries the server's encryption key, so you can read its history as soon as you join.</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
