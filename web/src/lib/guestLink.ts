import { guests as guestsApi } from "@/api/guests";
import { GUEST_FLAG, type GuestLink } from "@/api/types";
import { convForChannel } from "@/components/composer/send";
import { voiceFrameKey } from "@/crypto/conv";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { encodeInviteKey } from "./inviteLink";

/** Whether a user is a guest in a call rather than an account. */
export function isGuest(u: { flags: number } | null | undefined): boolean {
  return !!u && (u.flags & GUEST_FLAG) !== 0;
}

/**
 * The address of a guest link. Its fragment carries the call's key for the
 * link's epoch, in the same shape invite links carry a server's key; a
 * fragment never reaches the server.
 */
export function guestCallUrl(code: string, epoch: number, callKey: Uint8Array): string {
  return `${window.location.origin}/call/${code}#${encodeInviteKey({ epoch, root: callKey })}`;
}

/** A link made less than this long before it runs out is not handed out again. */
const REUSE_LEFT_MS = 60 * 60_000;

/**
 * A guest link into a channel's call: the caller's own current one while it
 * has a while left, otherwise a new one. `fresh` always makes a new one.
 */
export async function guestLinkFor(channelId: string, opts: { fresh?: boolean; maxAge?: number } = {}): Promise<{ url: string; link: GuestLink }> {
  const conv = convForChannel(channelId);
  const latest = await useKeys.getState().ensureConvKey(conv).catch(() => null);
  if (!latest) throw new Error("This conversation's keys have not reached this device yet. Try again in a moment.");
  const callKey = voiceFrameKey(latest.root, channelId);
  const me = useAuth.getState().me?.id;
  if (!opts.fresh) {
    const mine = (await guestsApi.links(channelId)).find((l) => l.creator_id === me && l.epoch === latest.epoch && l.expires_at - Date.now() > REUSE_LEFT_MS);
    if (mine) return { url: guestCallUrl(mine.code, mine.epoch, callKey), link: mine };
  }
  const link = await guestsApi.createLink(channelId, latest.epoch, opts.maxAge);
  return { url: guestCallUrl(link.code, link.epoch, callKey), link };
}
