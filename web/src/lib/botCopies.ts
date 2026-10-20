import { BOT_FLAG, type PublicUser } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { seal } from "@/crypto/keys";
import type { MessagePayload } from "@/crypto/message";
import { useChannels } from "@/stores/channels";
import { useUsers } from "@/stores/users";

/**
 * Copies of a message for the apps it is addressed to.
 *
 * An app reads only what is meant for it: a message in a conversation with
 * its bot, one that mentions its bot, or a reply to its bot. Nothing else is
 * ever readable to it unless its app reads every message (the Message Content
 * intent, marked wherever it applies). So the sender's app seals the message
 * a second time, to each such bot's key, and the server hands that copy to the
 * app (internal/api/bot_crypto.go). The server keeps only copies for bots that
 * are addressed and can see the channel, and drops any other.
 */

/** As many apps as one message carries copies for (store.MaxBotCopies). */
export const MAX_BOT_COPIES = 10;

/** Whether an account is an app's bot. */
export function isBot(u: Pick<PublicUser, "flags"> | undefined | null): boolean {
  return !!u && (u.flags & BOT_FLAG) !== 0;
}

/**
 * The bots a message is addressed to: the other side of a conversation with
 * one, the ones it mentions, and the one it replies to. In that order, at
 * most MAX_BOT_COPIES, never the sender.
 */
export function addressedBots(channelId: string, mentions: readonly string[], replyAuthorId: string | undefined, meId: string): PublicUser[] {
  const users = useUsers.getState().byId;
  const ch = useChannels.getState().byId[channelId];
  const ids: string[] = [];
  if (ch?.type === "dm") ids.push(...ch.recipient_ids);
  ids.push(...mentions);
  if (replyAuthorId) ids.push(replyAuthorId);
  const out: PublicUser[] = [];
  const seen = new Set<string>([meId]);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const u = users[id];
    if (!isBot(u) || !u!.public_key) continue;
    out.push(u!);
    if (out.length >= MAX_BOT_COPIES) break;
  }
  return out;
}

/** Seals a message's content to each bot's key: base64 copies by bot id, for `bot_copies`. */
export async function sealCopies(bots: readonly PublicUser[], payload: MessagePayload): Promise<Record<string, string>> {
  if (!bots.length) return {};
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const out: Record<string, string> = {};
  await Promise.all(
    bots.map(async (bot) => {
      try {
        out[bot.id] = b64.enc(await seal(b64.dec(bot.public_key), data));
      } catch {
        // a bot whose key cannot be read goes without; the message still goes
      }
    }),
  );
  return out;
}
