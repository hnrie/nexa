import type { Message } from "@/api/types";
import { decryptMessage, isEnvelope, type MessagePayload } from "@/crypto/message";
import { decryptCallLine, type CallSummary } from "@/voice/callSummary";
import { openCopy } from "./follows";
import { channelKeyFor, missingKeyListeners } from "./keyring";
import { listedAttachments, sanitizeHook, type HookContent } from "./webhookMessage";

/** no_key: not opened yet; bad: could not be opened; invalid: opened, and past what any app sends (crypto/message.ts MESSAGE_LIMITS). */
export type DecryptError = "no_key" | "bad" | "invalid";

export interface DecryptedMessage extends Message {
  payload?: MessagePayload;
  decryptError?: DecryptError;
  /** On a call's line: how the call went, sealed by its caller (voice/callSummary.ts). */
  call?: CallSummary;
  /** A webhook's or an app's message: what it said, as it came (not encrypted; see lib/webhookMessage). */
  hook?: HookContent;
  /** Made on this device and known to no one else: an app's failure, said where it was used (lib/interactions). */
  local?: boolean;
}

/** Whether a message's content came readable: a webhook's, or an app's (`application_id` in it). */
function cameReadable(msg: Message): boolean {
  if (msg.webhook === undefined || msg.webhook === null) return false;
  if (msg.webhook_id) return true;
  const w = msg.webhook as { application_id?: unknown };
  return typeof w === "object" && typeof w.application_id === "string";
}

/** Decrypts a message with the keys currently in the ring. Never throws. */
export async function decryptForStore(msg: Message): Promise<DecryptedMessage> {
  const out: DecryptedMessage = { ...msg };
  delete out.payload;
  delete out.decryptError;
  delete out.call;
  delete out.hook;
  // A webhook's or an app's message comes readable, with nothing to decrypt:
  // its text and files stand where a decrypted message's would, and the rest
  // of it (embeds, components, a poll) rides along for the views that draw them.
  if (cameReadable(msg)) {
    const hook = sanitizeHook(msg.webhook);
    if (!hook) {
      out.decryptError = "bad";
      return out;
    }
    out.hook = hook;
    if (msg.type.startsWith("system_")) return out;
    const payload: MessagePayload = {};
    if (hook.content) payload.t = hook.content;
    const att = listedAttachments(hook);
    if (att.length) payload.att = att;
    const sticker = hook.stickers[0];
    if (sticker) payload.sticker = { id: sticker.id, blob: sticker.blob_id, name: sticker.name, ...(sticker.format ? { format: sticker.format } : {}) };
    out.payload = payload;
    return out;
  }
  // a post published from an announcement channel this one follows, sealed to the follow
  if (msg.type === "crosspost") {
    if (msg.ciphertext === null || msg.ciphertext === undefined) return out;
    try {
      out.payload = await openCopy(msg);
    } catch (e) {
      out.decryptError = e instanceof Error && e.message === "no_key" ? "no_key" : "bad";
    }
    return out;
  }
  if (msg.ciphertext === null || msg.ciphertext === undefined) return out;
  // a call's line carries its caller's sealed summary of the call, not a message
  if (msg.type === "system_call") return decryptCallLine(out);
  if (!isEnvelope(msg.ciphertext) || msg.key_conv_id === null || msg.key_epoch === null) {
    out.decryptError = "bad";
    return out;
  }
  const key = channelKeyFor(msg.key_conv_id, msg.key_epoch, msg.channel_id);
  if (!key) {
    out.decryptError = "no_key";
    for (const l of missingKeyListeners) l(msg.key_conv_id, msg.key_epoch);
    return out;
  }
  try {
    out.payload = await decryptMessage(key, msg.ciphertext, {
      conv: msg.key_conv_id,
      epoch: msg.key_epoch,
      channelId: msg.channel_id,
      authorId: msg.author_id,
    });
  } catch (e) {
    out.decryptError = e instanceof Error && e.message === "over_limits" ? "invalid" : "bad";
  }
  return out;
}
