import type { Message } from "@/api/types";
import { decryptMessage, isEnvelope, type MessagePayload } from "@/crypto/message";
import { decryptCallLine, type CallSummary } from "@/voice/callSummary";
import { channelKeyFor } from "./keyring";
import { listedAttachments, sanitizeHook, type HookContent } from "./webhookMessage";

export type DecryptError = "no_key" | "bad";

export interface DecryptedMessage extends Message {
  payload?: MessagePayload;
  decryptError?: DecryptError;
  /** On a call's line: how the call went, sealed by its caller (voice/callSummary.ts). */
  call?: CallSummary;
  /** A webhook's message: what it said, as it came (not encrypted; see lib/webhookMessage). */
  hook?: HookContent;
}

/** Decrypts a message with the keys currently in the ring. Never throws. */
export async function decryptForStore(msg: Message): Promise<DecryptedMessage> {
  const out: DecryptedMessage = { ...msg };
  delete out.payload;
  delete out.decryptError;
  delete out.call;
  delete out.hook;
  // A webhook's message comes readable, with nothing to decrypt: its text
  // and files stand where a decrypted message's would, and the rest of it
  // (embeds, components, a poll) rides along for the views that draw them.
  if (msg.webhook_id && msg.webhook !== undefined) {
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
    out.payload = payload;
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
    return out;
  }
  try {
    out.payload = await decryptMessage(key, msg.ciphertext, {
      conv: msg.key_conv_id,
      epoch: msg.key_epoch,
      channelId: msg.channel_id,
      authorId: msg.author_id,
    });
  } catch {
    out.decryptError = "bad";
  }
  return out;
}
