import { Check, Link, LoaderCircle } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Tooltip } from "@/components/common/Tooltip";
import { joinRequestError, newGroupLink, sendJoinRequest } from "@/lib/joinRequest";
import { useUI } from "@/stores/ui";
import s from "./GroupAdd.module.css";

import { t } from "@/i18n";

export type JoinRequestState = "idle" | "sending" | "sent";

/**
 * The join requests sent from one menu: who is being sent one, who has been,
 * and the one way to send one. `linkFor` gives the group's invite link, made
 * when the menu has none yet. A failure is said in a toast, with the reason.
 */
export function useJoinRequests(groupId: string, linkFor: () => Promise<string>, onSent?: (name: string) => void) {
  const [sending, setSending] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  // a second press before the first has drawn "Sending…" must not send twice
  const going = useRef(new Set<string>());
  const done = useRef(new Set<string>());
  const send = async (userId: string, name: string) => {
    if (going.current.has(userId) || done.current.has(userId)) return;
    going.current.add(userId);
    setSending((l) => [...l, userId]);
    try {
      await sendJoinRequest(groupId, userId, await linkFor());
      done.current.add(userId);
      setSent((l) => [...l, userId]);
      onSent?.(name);
    } catch (err) {
      const why = joinRequestError(err, name);
      if (why) useUI.getState().toast(why, "error");
    } finally {
      going.current.delete(userId);
      setSending((l) => l.filter((x) => x !== userId));
    }
  };
  const stateOf = (userId: string): JoinRequestState => (sent.includes(userId) ? "sent" : sending.includes(userId) ? "sending" : "idle");
  return { send, stateOf, sent };
}

/**
 * The link for join requests from a dialog that shows none: made on the first
 * one, with the invite menu's first settings, and the same for every one after.
 */
export function useLazyGroupLink(groupId: string): () => Promise<string> {
  const job = useRef<Promise<string> | null>(null);
  return useCallback(() => {
    job.current ??= newGroupLink(groupId).catch((err: unknown) => {
      // a failure is not kept: the next press tries again
      job.current = null;
      throw err;
    });
    return job.current;
  }, [groupId]);
}

/**
 * In place of an Add button for a friend who joins group chats only from an
 * invite link: one press sends them the group's link in a direct message, and
 * it reads Sent from then on. Why there is no Add is its tooltip, and its
 * description for a screen reader. Like Add, it is never disabled outright,
 * which would drop the keyboard's focus.
 */
export function JoinRequestButton({ name, state, onSend }: { name: string; state: JoinRequestState; onSend: () => void }) {
  const hintId = useId();
  const tip = t("groupAdd.linkOnlyTip", { name });
  const done = state === "sent";
  const busy = state === "sending";
  return (
    <>
      <Tooltip text={tip}>
        <Button
          size="sm"
          variant={done ? "ghost" : "secondary"}
          className={s.joinBtn}
          aria-label={done ? t("groupAdd.joinRequest.sentTo", { name }) : t("groupAdd.joinRequest.sendTo", { name })}
          aria-describedby={hintId}
          aria-disabled={done || busy || undefined}
          aria-busy={busy || undefined}
          onClick={done || busy ? undefined : onSend}
          data-testid="join-request"
          data-state={state}
        >
          {done ? <Check size={14} aria-hidden="true" /> : busy ? <LoaderCircle size={14} className={s.spin} aria-hidden="true" /> : <Link size={14} aria-hidden="true" />}
          {done ? t("groupAdd.joinRequest.sent") : busy ? t("people.request.sending") : t("groupAdd.joinRequest.send")}
        </Button>
      </Tooltip>
      <span id={hintId} className="visually-hidden">
        {tip}
      </span>
    </>
  );
}
