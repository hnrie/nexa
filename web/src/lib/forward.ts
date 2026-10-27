import type { Channel } from "@/api/types";
import { sendMessage } from "@/components/composer/send";
import type { DecryptedMessage } from "./decrypt";
import { idTime } from "./ids";
import { P } from "./perms";
import { selectDMs, selectServerChannels, useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";

/**
 * Whether a message can be passed on: one of a person's, decrypted here,
 * with words, files, a sticker or link previews to carry. A poll belongs to
 * its conversation and stays there.
 */
export function canForward(msg: DecryptedMessage): boolean {
  const p = msg.payload;
  if (!p || msg.local || msg.hook || msg.decryptError || p.poll) return false;
  if (msg.type !== "default" && msg.type !== "reply") return false;
  return !!(p.t || p.att?.length || p.sticker || p.embeds?.length);
}

/** Where a message can be forwarded: conversations first, then server channels this account may write in (and send files in, for one with files). */
export function forwardTargets(withFiles: boolean): Channel[] {
  const byId = useChannels.getState().byId;
  const out: Channel[] = selectDMs(byId).filter((c) => c.type === "dm" || c.type === "group_dm");
  for (const st of Object.values(useServers.getState().byId)) {
    for (const ch of selectServerChannels(byId, st.server.id)) {
      if (ch.type !== "text" && ch.type !== "announcement") continue;
      if (!canI(st, P.VIEW_CHANNEL | P.SEND_MESSAGES, ch.id)) continue;
      if (withFiles && !canI(st, P.ATTACH_FILES, ch.id)) continue;
      out.push(ch);
    }
  }
  return out;
}

/**
 * Passes a message on to one conversation or channel: its words, files,
 * sticker and link previews as they were, marked forwarded. One at a time, so
 * forwarding is for passing something on, not spreading it everywhere (the
 * server limits how often, too). The files are the original's
 * own (the same uploads, opened by the same keys, sealed into the new
 * message), so nothing is uploaded again and nobody's monthly allowance is
 * spent. A forward pings nobody.
 */
export async function forwardMessage(msg: DecryptedMessage, to: string, comment = ""): Promise<void> {
  const p = msg.payload ?? {};
  const attachments = (p.att ?? []).map((meta) => ({ meta, blob_id: meta.blob_id, size: meta.size }));
  const forward = { channelId: msg.channel_id, messageId: msg.id, at: p.fwd?.at ?? idTime(msg.id), comment: comment.trim() };
  await sendMessage(to, p.t ?? "", {
    forward,
    ping: false,
    ...(attachments.length ? { attachments } : {}),
    ...(p.sticker ? { sticker: p.sticker } : {}),
    ...(p.embeds?.length ? { embeds: p.embeds } : {}),
  });
}
