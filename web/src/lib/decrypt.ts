import type { Message } from "@/api/types";
import { decryptMessage, isEnvelope, type MessagePayload } from "@/crypto/message";
import { channelKeyFor } from "./keyring";

export type DecryptError = "no_key" | "bad";

export interface DecryptedMessage extends Message {
  payload?: MessagePayload;
  decryptError?: DecryptError;
}

/** Decrypts a message with the keys currently in the ring. Never throws. */
export async function decryptForStore(msg: Message): Promise<DecryptedMessage> {
  const out: DecryptedMessage = { ...msg };
  delete out.payload;
  delete out.decryptError;
  if (msg.ciphertext === null || msg.ciphertext === undefined) return out;
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
