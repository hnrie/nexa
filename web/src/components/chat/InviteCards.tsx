import { RotateCw } from "lucide-react";
import { useMemo } from "react";
import type { UnfurlResult } from "@/api/types";
import { Button } from "@/components/common/Button";
import { InviteGone, InviteSkeleton, InviteView, targetOfEmbed, targetOfPreview } from "@/components/invite/InviteView";
import { useInviteJoin } from "@/components/invite/useInviteJoin";
import { t } from "@/i18n";
import { MAX_INVITE_CARDS, inviteLinksIn, type InviteLinkRef } from "@/lib/appLinks";
import { loadInvitePreview, useInvitePreview } from "@/lib/invitePreviews";
import { useUI } from "@/stores/ui";
import s from "@/components/invite/Invite.module.css";

interface CardLink extends InviteLinkRef {
  /** The card the sender's device sealed into the message, drawn until the server answers. */
  sealed?: UnfurlResult;
}

function fragmentOf(url: string): string {
  const at = url.indexOf("#");
  return at >= 0 ? url.slice(at) : "";
}

/** One card per invite a message links to, whether or not the sender's device made a preview for it. */
function cardLinks(nodes: unknown, embeds: UnfurlResult[] | null | undefined): CardLink[] {
  const out: CardLink[] = inviteLinksIn(nodes);
  for (const e of embeds ?? []) {
    if (!e || e.type !== "invite" || typeof e.invite_code !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(e.invite_code)) continue;
    const known = out.find((l) => l.code === e.invite_code);
    if (known) known.sealed = e;
    else if (out.length < MAX_INVITE_CARDS) out.push({ code: e.invite_code, hash: fragmentOf(e.url), url: e.url, sealed: e });
  }
  return out;
}

/**
 * The invites under a message. Each card asks the server about its invite on
 * this device, so a message sent with link previews off, or before cards
 * existed, still gets one, and every card shows the banner and the counts as
 * they are now rather than when the message was sent.
 */
export function InviteCards({ nodes, embeds }: { nodes: unknown; embeds: UnfurlResult[] | null | undefined }) {
  const links = useMemo(() => cardLinks(nodes, embeds), [nodes, embeds]);
  if (links.length === 0) return null;
  return (
    <div className={s.cards}>
      {links.map((l) => <InviteCard key={l.code} link={l} />)}
    </div>
  );
}

function InviteCard({ link }: { link: CardLink }) {
  const entry = useInvitePreview(link.code);
  const target = entry?.status === "ready" ? targetOfPreview(entry.preview, "card") : link.sealed && entry?.status !== "invalid" ? targetOfEmbed(link.sealed) : null;
  const { member, busy, join, open } = useInviteJoin(link.code, link.hash, target, { onError: (m) => useUI.getState().toast(m, "error") });
  if (entry?.status === "invalid") {
    return (
      <div role="group" aria-label={t("invite.invalidInvite")} data-testid="invite-card" data-invite-state="invalid">
        <InviteGone variant="card" />
      </div>
    );
  }
  if (!target) {
    if (entry?.status === "failed") {
      return (
        <div className={s.view} data-variant="card" data-gone="true" data-testid="invite-card" data-invite-state="failed">
          <div className={s.gone}>
            <div className={s.goneText}>
              <p className={s.goneTitle}>{t("invite.couldNotLoadTheInvite")}</p>
              <p className={s.goneBody}>{t("invite.checkYourConnection")}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void loadInvitePreview(link.code, { force: true })}><RotateCw size={14} aria-hidden="true" /> {t("invite.tryAgain")}</Button>
          </div>
        </div>
      );
    }
    return <div data-testid="invite-card" data-invite-state="loading"><InviteSkeleton variant="card" /></div>;
  }
  // until the server answers there is nothing to be a member of, and joining still works by the code
  const action = member ? (
    <Button size="sm" variant="secondary" onClick={open} data-testid="invite-card-open">{t("chat.embeds.open")}</Button>
  ) : (
    <Button size="sm" variant="positive" loading={busy} onClick={() => void join()} data-testid="invite-card-join">{t("chat.embeds.join")}</Button>
  );
  return (
    <div role="group" aria-label={t("invite.inviteTo", { name: target.name })} data-testid="invite-card" data-invite-state={entry?.status === "ready" ? "ready" : "sealed"} data-member={member || undefined}>
      <InviteView target={target} variant="card" actions={action} />
    </div>
  );
}
