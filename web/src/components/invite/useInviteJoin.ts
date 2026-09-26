import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "@/i18n";
import { describeError } from "@/lib/errors";
import { loadInvitePreview } from "@/lib/invitePreviews";
import { acceptInvite } from "@/lib/joinInvite";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import type { InviteTarget } from "./InviteView";

interface Options {
  /** Called once the invite is accepted or the joined place is opened, before going there. */
  onDone?: () => void;
  /** Where a failure is told; without it, `error` holds it for the view to show. */
  onError?: (message: string) => void;
  /** Go there in place of this page in the history: the invite page, which has nothing to come back to. */
  replace?: boolean;
}

/**
 * Joining through an invite, and opening what it leads to once joined:
 * whether this account is already in, the request with its busy state and
 * its error, and the way there afterwards.
 */
export function useInviteJoin(code: string, hash: string, target: InviteTarget | null, opts: Options = {}) {
  const nav = useNavigate();
  const inServer = useServers((st) => (target?.kind === "server" && target.id ? !!st.byId[target.id] : false));
  const inGroup = useChannels((c) => (target?.kind === "group" && target.id ? !!c.byId[target.id] : false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = await acceptInvite(code, hash);
      // the cards for this invite count one more member now
      void loadInvitePreview(code, { force: true });
      opts.onDone?.();
      nav(path, { replace: !!opts.replace });
    } catch (err) {
      // the invite itself may still be fine, so this stays by the button rather than replacing the view
      const message = describeError(err, t("invite.couldNotAcceptTheInvite"));
      if (opts.onError) opts.onError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    if (!target?.id) return;
    opts.onDone?.();
    nav(target.kind === "group" ? `/channels/@me/${target.id}` : `/channels/${target.id}`, { replace: !!opts.replace });
  };
  return { member: inServer || inGroup, busy, error, join, open };
}
