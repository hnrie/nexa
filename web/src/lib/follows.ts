import { follows as followsApi, type SealedCopy } from "@/api/follows";
import type { Channel, Follow, Message } from "@/api/types";
import { IV_LEN, gcmDecrypt, gcmEncrypt } from "@/crypto/aes";
import { b64, randomBytes, utf8 } from "@/crypto/bytes";
import { DecryptError, generateIdentity, open, publicKeyOf, seal } from "@/crypto/keys";
import { decryptMessage, encryptMessage, isEnvelope, sanitizePayload, type Aad, type Envelope, type MessagePayload } from "@/crypto/message";
import { channelKeyFor, ring } from "./keyring";

/**
 * Following announcement channels, end-to-end encrypted. A follow has a key
 * pair of its own: the public half is what a publisher's app seals each copy
 * to, and the private half travels sealed with the following channel's key,
 * so only the people of that channel can open what is published into it.
 */

/** What a follow's sealed key is bound to: the channel it opens posts in, and the channel they come from. */
function secretAad(conv: string, epoch: number, targetId: string, sourceId: string): Aad {
  return { conv, epoch, channelId: targetId, authorId: `follow:${sourceId}` };
}

/** What a copy is bound to: the follow it was sealed for, and the post it is a copy of. */
function copyAad(followId: string, sourceMessageId: string): Uint8Array {
  return utf8.enc(`crosspost|${followId}|${sourceMessageId}`);
}

/** Follows an announcement channel into a channel this account manages webhooks in. */
export async function followInto(source: Channel, target: Channel): Promise<Follow> {
  const conv = target.key_conv_id ?? target.server_id;
  if (!conv) throw new DecryptError("no key for that channel");
  const latest = ring.latest(conv);
  const key = latest ? channelKeyFor(conv, latest.epoch, target.id) : undefined;
  if (!latest || !key) throw new DecryptError("no key for that channel");
  const pair = generateIdentity();
  const secret = await encryptMessage(key, secretAad(conv, latest.epoch, target.id, source.id), { t: b64.enc(pair.privateKey) });
  const follow = await followsApi.create(source.id, { target_channel_id: target.id, public_key: b64.enc(pair.publicKey), secret });
  forgetFollows(target.id);
  return follow;
}

interface FollowKey {
  priv: Uint8Array;
  pub: Uint8Array;
}

/** The follows of each channel this app has opened, by follow. */
const keys = new Map<string, Promise<Map<string, FollowKey>>>();
/** When each channel's follows were last fetched, so a copy that cannot be opened does not fetch them every time. */
const fetchedAt = new Map<string, number>();
/** Follows whose key this app has sealed again under a newer channel key. */
const resealed = new Set<string>();

/** What a channel follows changed (or the keys did): opened again when next needed. */
export function forgetFollows(channelId: string): void {
  keys.delete(channelId);
}

export function clearFollows(): void {
  keys.clear();
  fetchedAt.clear();
  resealed.clear();
}

async function openSecret(f: Follow): Promise<FollowKey | null> {
  let env: unknown;
  try {
    env = JSON.parse(f.secret);
  } catch {
    return null;
  }
  if (!isEnvelope(env)) return null;
  const key = channelKeyFor(env.conv, env.epoch, f.target_id);
  if (!key) return null;
  try {
    const p = await decryptMessage(key, env, secretAad(env.conv, env.epoch, f.target_id, f.source_id));
    if (!p.t) return null;
    const priv = b64.dec(p.t);
    const pub = publicKeyOf(priv);
    if (b64.enc(pub) !== f.public_key) return null;
    void resealIfOld(f, env, priv);
    return { priv, pub };
  } catch {
    return null;
  }
}

/**
 * People who join after a channel's key changes only get its newest key, so
 * a follow's key sealed under an older one is sealed again under the newest
 * by whoever can still open it.
 */
async function resealIfOld(f: Follow, env: Envelope, priv: Uint8Array): Promise<void> {
  const latest = ring.latest(env.conv);
  if (!latest || latest.epoch <= env.epoch || resealed.has(f.id)) return;
  const key = channelKeyFor(env.conv, latest.epoch, f.target_id);
  if (!key) return;
  resealed.add(f.id);
  try {
    const secret = await encryptMessage(key, secretAad(env.conv, latest.epoch, f.target_id, f.source_id), { t: b64.enc(priv) });
    await followsApi.reseal(f.id, secret);
  } catch {
    resealed.delete(f.id);
  }
}

function followKeys(channelId: string): Promise<Map<string, FollowKey>> {
  let job = keys.get(channelId);
  if (!job) {
    fetchedAt.set(channelId, Date.now());
    if (fetchedAt.size > 200) fetchedAt.delete(fetchedAt.keys().next().value as string);
    job = followsApi
      .into(channelId)
      .then(async (list) => {
        const out = new Map<string, FollowKey>();
        for (const f of list) {
          const k = await openSecret(f);
          if (k) out.set(f.id, k);
        }
        return out;
      })
      .catch((e: unknown) => {
        keys.delete(channelId);
        throw e;
      });
    keys.set(channelId, job);
    if (keys.size > 100) keys.delete(keys.keys().next().value as string);
  }
  return job;
}

function isCopy(x: unknown): x is SealedCopy {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return c["v"] === 2 && typeof c["key"] === "string" && typeof c["iv"] === "string" && typeof c["ct"] === "string";
}

/**
 * Opens a published copy in a following channel. Throws DecryptError when it
 * cannot be read here (no key for its follow: "no_key", anything else: "bad").
 */
export async function openCopy(msg: Message): Promise<MessagePayload> {
  const info = msg.crosspost;
  const sealed: unknown = msg.ciphertext;
  if (!info || !isCopy(sealed)) throw new DecryptError("bad");
  let fk = (await followKeys(msg.channel_id)).get(info.follow_id);
  if (!fk && Date.now() - (fetchedAt.get(msg.channel_id) ?? 0) > 30_000) {
    // a follow made (or its key sealed again) since the list was fetched
    forgetFollows(msg.channel_id);
    fk = (await followKeys(msg.channel_id)).get(info.follow_id);
  }
  if (!fk) throw new DecryptError("no_key");
  let plaintext: Uint8Array;
  try {
    const k = await open(fk.priv, fk.pub, b64.dec(sealed.key));
    plaintext = await gcmDecrypt(k, b64.dec(sealed.iv), b64.dec(sealed.ct), copyAad(info.follow_id, info.message_id));
  } catch {
    throw new DecryptError("bad");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.dec(plaintext));
  } catch {
    throw new DecryptError("bad");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new DecryptError("bad");
  return sanitizePayload(parsed as Record<string, unknown>);
}

/** What of a post goes out with it: what it says, its files and embeds, its sticker. */
function copyPayload(p: MessagePayload): MessagePayload {
  const out: MessagePayload = {};
  if (p.t) out.t = p.t;
  if (p.att?.length) out.att = p.att;
  if (p.embeds?.length) out.embeds = p.embeds;
  if (p.sticker) out.sticker = p.sticker;
  if (p.flags) out.flags = p.flags;
  return out;
}

/**
 * Publishes a post of an announcement channel to every channel following it
 * (or brings the copies up to date after an edit): each copy sealed with a
 * key of its own, that key sealed to the follow.
 */
export async function publishPost(channelId: string, messageId: string, payload: MessagePayload): Promise<{ copies: number }> {
  const { followers } = await followsApi.keys(channelId);
  const body = utf8.enc(JSON.stringify(copyPayload(payload)));
  const copies: { follow_id: string; ciphertext: SealedCopy }[] = [];
  for (const f of followers) {
    let pub: Uint8Array;
    try {
      pub = b64.dec(f.public_key);
    } catch {
      continue;
    }
    if (pub.length !== 32) continue;
    const k = randomBytes(32);
    const iv = randomBytes(IV_LEN);
    const ct = await gcmEncrypt(k, iv, body, copyAad(f.id, messageId));
    copies.push({ follow_id: f.id, ciphertext: { v: 2, key: b64.enc(await seal(pub, k)), iv: b64.enc(iv), ct: b64.enc(ct) } });
  }
  const res = await followsApi.publish(channelId, messageId, copies);
  return { copies: res.copies };
}
