import { ApiError } from "@/api/client";
import { messages as messagesApi } from "@/api/messages";
import type { SendMessageRequest } from "@/api/types";
import { encryptMessage, type AttachmentMeta, type MessagePayload } from "@/crypto/message";
import { decryptForStore } from "@/lib/decrypt";
import { nonce as newNonce, tmpId } from "@/lib/ids";
import { channelKeyFor } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useSlowmode } from "@/stores/slowmode";
import { extractMentions } from "./mentions";

export interface SendOptions {
  replyTo?: string;
  ping?: boolean;
  attachments?: { meta: AttachmentMeta; blob_id: string; size: number }[];
  embeds?: unknown[];
  sticker?: { id: string };
  flags?: number;
}

/** The conversation whose keys encrypt a channel: the server tells us (itself for DMs and private channels, the server root otherwise). */
export function convForChannel(channelId: string): string {
  const ch = useChannels.getState().byId[channelId];
  if (ch?.key_conv_id) return ch.key_conv_id;
  if (ch?.server_id && ch.type !== "dm" && ch.type !== "group_dm") return ch.server_id;
  return channelId;
}

/** Encrypts and sends a message, with an optimistic pending copy in the store. */
export async function sendMessage(channelId: string, rawText: string, opts: SendOptions = {}): Promise<void> {
  const me = useAuth.getState().me;
  if (!me) return;
  const { text, mentions, everyone } = extractMentions(rawText, useUsers.getState().byId);
  const payload: MessagePayload = {};
  if (text) payload.t = text;
  if (opts.attachments?.length) payload.att = opts.attachments.map((a) => a.meta);
  if (opts.embeds?.length) payload.embeds = opts.embeds;
  if (opts.sticker) payload.sticker = opts.sticker;
  if (!payload.t && !payload.att && !payload.sticker) return;
  const nonce = newNonce();
  const tmp = tmpId();
  const messages = useMessages.getState();
  messages.addPending({ tmpId: tmp, nonce, channelId, authorId: me.id, payload, createdAt: Date.now(), status: "sending", ...(opts.replyTo ? { replyToId: opts.replyTo } : {}) });
  try {
    const conv = convForChannel(channelId);
    const key = await useKeys.getState().ensureConvKey(conv);
    if (!key) throw new Error("waiting_for_key");
    const chanKey = channelKeyFor(conv, key.epoch, channelId);
    if (!chanKey) throw new Error("waiting_for_key");
    const ciphertext = await encryptMessage(chanKey, { conv, epoch: key.epoch, channelId, authorId: me.id }, payload);
    const body: SendMessageRequest = { ciphertext, key_conv_id: conv, key_epoch: key.epoch, mentions: opts.ping === false ? mentions.filter((id) => !opts.replyTo || id !== replyAuthor(channelId, opts.replyTo)) : mentions, nonce };
    if (opts.replyTo) {
      body.reply_to_id = opts.replyTo;
      const author = replyAuthor(channelId, opts.replyTo);
      if (opts.ping !== false && author && author !== me.id && !body.mentions.includes(author)) body.mentions = [...body.mentions, author];
    }
    if (everyone) body.mention_everyone = true;
    if (opts.attachments?.length) body.attachments = opts.attachments.map((a) => ({ blob_id: a.blob_id, size: a.size }));
    if (opts.flags) body.flags = opts.flags;
    const sent = await messagesApi.send(channelId, body);
    const decrypted = await decryptForStore(sent);
    if (!decrypted.payload) decrypted.payload = payload;
    useMessages.getState().insert(channelId, [decrypted]);
    useChannels.getState().setLastMessage(channelId, sent.id);
    useMessages.getState().removePending(channelId, tmp);
    useSlowmode.getState().markSent(channelId);
  } catch (err) {
    useMessages.getState().failPending(channelId, tmp);
    const ui = useUI.getState();
    if (err instanceof Error && err.message === "waiting_for_key") ui.toast("Waiting for the encryption key for this conversation. Someone who has it needs to be online.", "error");
    else if (err instanceof ApiError && err.code === "slowmode") {
      const secs = Number(err.retryAfter ?? 0) || 5;
      useSlowmode.getState().setUntil(channelId, Date.now() + secs * 1000);
      ui.toast(`Slow mode is on. Try again in ${secs}s.`, "error");
    } else if (err instanceof ApiError) ui.toast(err.code === "rate_limited" ? "You are sending messages too quickly." : err.message, "error");
    else ui.toast("Your message could not be sent.", "error");
    throw err;
  }
}

function replyAuthor(channelId: string, messageId: string): string | undefined {
  return useMessages.getState().channels[channelId]?.byId[messageId]?.author_id;
}

/** Re-encrypts and saves an edit. */
export async function editMessage(channelId: string, messageId: string, rawText: string): Promise<void> {
  const me = useAuth.getState().me;
  const existing = useMessages.getState().channels[channelId]?.byId[messageId];
  if (!me || !existing) return;
  const { text, mentions, everyone } = extractMentions(rawText, useUsers.getState().byId);
  const payload: MessagePayload = { ...(existing.payload ?? {}) };
  if (text) payload.t = text;
  else delete payload.t;
  if (!payload.t && !payload.att?.length && !payload.sticker) return;
  const conv = existing.key_conv_id ?? convForChannel(channelId);
  const epoch = existing.key_epoch ?? 0;
  let chanKey = channelKeyFor(conv, epoch, channelId);
  let useEpoch = epoch;
  if (!chanKey) {
    const latest = await useKeys.getState().ensureConvKey(conv);
    if (!latest) throw new Error("waiting_for_key");
    useEpoch = latest.epoch;
    chanKey = channelKeyFor(conv, latest.epoch, channelId);
  }
  if (!chanKey) throw new Error("waiting_for_key");
  const ciphertext = await encryptMessage(chanKey, { conv, epoch: useEpoch, channelId, authorId: me.id }, payload);
  const updated = await messagesApi.edit(channelId, messageId, { ciphertext, key_conv_id: conv, key_epoch: useEpoch, mentions, mention_everyone: everyone });
  const decrypted = await decryptForStore(updated);
  useMessages.getState().update(channelId, decrypted);
}
