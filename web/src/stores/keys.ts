import { create } from "zustand";
import { ApiError } from "@/api/client";
import { keys as keysApi } from "@/api/keys";
import { users as usersApi } from "@/api/users";
import type { KeyGrant } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { newRootKey } from "@/crypto/conv";
import { keystore } from "@/crypto/keystore";
import { unwrapGrant, wrapGrant, type Identity } from "@/crypto/keys";
import { hasLock } from "@/lib/appLock";
import { checkRecipients } from "@/lib/convMembers";
import { closePins, openPins } from "@/lib/keyPins";
import { clearKeyring, ring } from "@/lib/keyring";
import { judgeKey, useKeyAlerts } from "./keyAlerts";
import { useMessages } from "./messages";
import { useUsers } from "./users";

interface KeysState {
  userId: string | null;
  identity: Identity | null;
  waiting: Record<string, true>;
  init: (userId: string, identity: Identity) => Promise<void>;
  ingestGrants: (grants: KeyGrant[]) => Promise<string[]>;
  ensureConvKey: (conv: string) => Promise<{ epoch: number; root: Uint8Array } | null>;
  grantTo: (conv: string, epoch: number, userIds: string[]) => Promise<void>;
  reconcile: () => Promise<void>;
  rotate: (conv: string, reason?: string) => Promise<void>;
  markWaiting: (conv: string) => void;
  reset: () => void;
}

const pendingEnsure = new Map<string, Promise<{ epoch: number; root: Uint8Array } | null>>();

/**
 * Called when the keys are forgotten (a lock, a sign-out). The search index
 * holds decrypted messages; it registers here and closes with them, or the
 * next person on this tab could read a conversation they have no grant for by
 * typing a word into search.
 */
export const keysGoneHooks: (() => void)[] = [];

/**
 * The key to seal to, as base64 — the shape the pin file keeps, so the two can
 * be compared without decoding either.
 */
async function publicKeyOf(userId: string): Promise<string> {
  const cached = useUsers.getState().byId[userId]?.public_key;
  if (cached) return cached;
  const res = await usersApi.publicKey(userId);
  return res.public_key;
}

/**
 * Caches a root on this device, except behind a passcode: a root at rest reads
 * its messages without one, so a locked device takes its roots from the grants
 * that come with every ready instead.
 */
async function persistRoot(userId: string, conv: string, epoch: number, root: Uint8Array): Promise<void> {
  if (hasLock(userId)) return;
  await keystore.saveRoot(userId, conv, epoch, root);
}

/** Grants opened at a time: enough to overlap their decryptions, few enough to keep the tab drawing. */
const UNWRAP_BATCH = 32;

/**
 * Narrows a server-supplied recipient list to the accounts this device is
 * willing to hand a conversation key to.
 *
 * Nothing about who gets a key was ever the client's decision before: the
 * `user_ids` in a `keys_needed` event, in `/keys/needs` and in the answer to
 * creating an epoch went straight into the wrapping. Here they are held against
 * the membership this device already knows and draws, and anything outside it
 * is dropped and written down where it can be seen.
 */
function recipientsFor(conv: string, epoch: number, userIds: string[]): string[] {
  const seen = checkRecipients(conv, userIds);
  // Never this account. A membership list that has not caught up with a join
  // would otherwise leave a device holding a root with no grant of its own,
  // which is the one way this check could lock somebody out of their own
  // conversation.
  const me = useKeys.getState().userId;
  const outsiders = me ? seen.outsiders.filter((id) => id !== me) : seen.outsiders;
  const allowed = me && userIds.includes(me) && !seen.allowed.includes(me) ? [...seen.allowed, me] : seen.allowed;
  if (outsiders.length > 0) {
    console.warn(`keys: refusing to wrap ${conv} epoch ${epoch} for ${outsiders.join(", ")} — not in this conversation`);
    useKeyAlerts.getState().report({ kind: "outsider_refused", conv, epoch, count: outsiders.length, ...(outsiders.length === 1 ? { userId: outsiders[0]! } : {}) });
  }
  // Fail open, and say so. A large server's members arrive a page at a time, so
  // an id missing from the list in hand may simply not have been fetched yet;
  // refusing there would leave real members unable to read messages they are
  // entitled to, which is the worse of the two failures.
  if (!seen.checked && userIds.length > 0) useKeyAlerts.getState().report({ kind: "unchecked", conv, epoch, count: userIds.length });
  return allowed;
}

/** Wraps a root for each user and uploads the grants; users without a public key are skipped. */
async function putGrantsFor(conv: string, epoch: number, root: Uint8Array, wanted: string[]): Promise<void> {
  // The one place every grant this client ever makes passes through, so the
  // recipient check cannot be forgotten by a path added later: createEpoch,
  // /keys/needs and the keys_needed event all end up here.
  const userIds = recipientsFor(conv, epoch, wanted);
  const uploads: { conv_id: string; epoch: number; user_id: string; wrapped_key: string }[] = [];
  const wrap = async (uid: string): Promise<boolean> => {
    try {
      const pub = await publicKeyOf(uid);
      // A key that is not the one this device pinned for that person does not
      // get a copy of the conversation until a human has looked at it. The
      // question is raised by judgeKey; this path just declines quietly, and
      // the grant is made on the next reconcile once it is answered.
      if (judgeKey(uid, pub) === "changed") {
        useKeyAlerts.getState().report({ kind: "grant_withheld", conv, epoch, userId: uid });
        return true;
      }
      uploads.push({ conv_id: conv, epoch, user_id: uid, wrapped_key: b64.enc(await wrapGrant(b64.dec(pub), root)) });
      return true;
    } catch (err) {
      // An account that is genuinely gone is skipped for good; anything else —
      // a 500, a timeout, an offline fetch — says nothing about that person,
      // and dropping them silently costs them every message of this epoch.
      return err instanceof ApiError && err.status === 404;
    }
  };
  const again: string[] = [];
  // a few keys looked up at a time: a large server's members are not all known here
  for (let i = 0; i < userIds.length; i += 16) {
    const batch = userIds.slice(i, i + 16);
    const ok = await Promise.all(batch.map(wrap));
    for (const [j, fine] of ok.entries()) if (!fine) again.push(batch[j]!);
  }
  if (again.length > 0) {
    await new Promise((r) => setTimeout(r, 500));
    // The rotation itself still goes ahead if this fails: it is what takes the
    // key away from whoever just left, and holding it back for one unreachable
    // lookup would be worse. The server keeps track of who is still owed a
    // grant, and reconcile() hands it over on the next connection.
    const healed = await Promise.all(again.map(wrap));
    const missed = again.filter((_, j) => !healed[j]);
    if (missed.length > 0) console.warn(`keys: ${missed.length} member(s) could not be granted ${conv} epoch ${epoch}; the server will ask again`);
  }
  for (let i = 0; i < uploads.length; i += 200) {
    await keysApi.putGrants(uploads.slice(i, i + 200));
  }
}

/**
 * Creates the next epoch and hands it out. The root only goes into use once
 * its grants are uploaded: an epoch nobody holds a grant for is never passed
 * on, so anything written under it would stay unreadable to everyone else.
 */
async function createAndGrant(conv: string, userId: string, reason?: string): Promise<{ epoch: number; root: Uint8Array }> {
  const created = await keysApi.createEpoch(conv, reason);
  const root = newRootKey();
  const targets = created.user_ids.includes(userId) ? created.user_ids : [...created.user_ids, userId];
  await putGrantsFor(conv, created.epoch, root, targets);
  ring.set(conv, created.epoch, root);
  await persistRoot(userId, conv, created.epoch, root);
  return { epoch: created.epoch, root };
}

export const useKeys = create<KeysState>()((set, get) => ({
  userId: null,
  identity: null,
  waiting: {},
  init: async (userId, identity) => {
    set({ userId, identity, waiting: {} });
    // Before anything else, and before the gateway connects: the first ready
    // upserts every user the account can see, and each of those keys has to be
    // judged against what this device remembers rather than pinned late.
    openPins(userId);
    if (hasLock(userId)) {
      // Roots cached before the passcode was set would read messages without it.
      await keystore.forgetRoots(userId);
      return;
    }
    const roots = await keystore.loadRoots(userId);
    for (const r of roots) ring.set(r.conv, r.epoch, r.root);
  },
  ingestGrants: async (grants) => {
    const { identity, userId } = get();
    if (!identity || !userId) return [];
    const changed: string[] = [];
    const opened: { conv: string; epoch: number; root: Uint8Array }[] = [];
    const fresh = grants.filter((g) => !ring.get(g.conv_id, g.epoch));
    // A first sign-in on a device brings every grant the account holds, and
    // each used to be opened and written to disk on its own, one after the
    // other, while ready and every event behind it waited.
    for (let i = 0; i < fresh.length; i += UNWRAP_BATCH) {
      const batch = fresh.slice(i, i + UNWRAP_BATCH);
      // a grant this device cannot open is left; another holder may send a good one
      const roots = await Promise.all(batch.map((g) => unwrapGrant(identity.privateKey, identity.publicKey, b64.dec(g.wrapped_key)).catch(() => null)));
      // Locked or signed out meanwhile: these keys belong to a session that has
      // ended, and putting them back would undo the forgetting it just did.
      if (get().identity !== identity) return [];
      for (const [j, root] of roots.entries()) {
        const g = batch[j]!;
        if (!root || ring.get(g.conv_id, g.epoch)) continue;
        // In memory the key works at once, whether or not the disk takes it: a
        // dead database handle (iOS after a long time in the background) must
        // not leave messages saying "waiting for key" with the key right here.
        ring.set(g.conv_id, g.epoch, root);
        changed.push(g.conv_id);
        opened.push({ conv: g.conv_id, epoch: g.epoch, root });
      }
    }
    if (opened.length > 0 && !hasLock(userId)) {
      try {
        await keystore.saveRoots(userId, opened);
      } catch {
        /* kept for this session; the next grant or sign-in stores them again */
      }
    }
    if (changed.length > 0) {
      const set_ = new Set(changed);
      set((s) => {
        const waiting = { ...s.waiting };
        for (const c of changed) delete waiting[c];
        return { waiting };
      });
      await useMessages.getState().redecrypt((m) => m.decryptError === "no_key" && !!m.key_conv_id && set_.has(m.key_conv_id));
    }
    return changed;
  },
  ensureConvKey: async (conv) => {
    const latest = ring.latest(conv);
    if (latest) return latest;
    const inflight = pendingEnsure.get(conv);
    if (inflight) return inflight;
    // Signed out or locked, there is nothing to make a key with — and a job
    // that ended before it was stored below would be stored finished, and
    // answer null to everyone after the unlock.
    if (!get().userId) return null;
    const job = (async () => {
      const { userId } = get();
      // inside the try, so the finally below always takes the job back out of
      // the map: a null cached here answered every later caller for good
      try {
        if (!userId) return null;
        return await createAndGrant(conv, userId);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 409 || err.code === "epoch_race")) {
          const mine = await keysApi.grants();
          await get().ingestGrants(mine.filter((g) => g.conv_id === conv));
          const now = ring.latest(conv);
          if (now) return now;
          get().markWaiting(conv);
          return null;
        }
        throw err;
      } finally {
        pendingEnsure.delete(conv);
      }
    })();
    pendingEnsure.set(conv, job);
    return job;
  },
  grantTo: async (conv, epoch, userIds) => {
    const root = ring.get(conv, epoch);
    if (!root || userIds.length === 0) return;
    await putGrantsFor(conv, epoch, root, userIds);
  },
  reconcile: async () => {
    // Every conversation stands on its own: one that throws used to end the
    // walk, so everybody who joined the ones after it while this device was
    // away kept seeing "encrypted message" until another holder came online.
    let needs: Awaited<ReturnType<typeof keysApi.needs>>;
    try {
      needs = await keysApi.needs();
    } catch (err) {
      console.warn("keys: could not ask what needs granting", err);
      return;
    }
    let failed = 0;
    for (const n of needs) {
      if (!ring.get(n.conv_id, n.epoch)) continue;
      try {
        await get().grantTo(n.conv_id, n.epoch, n.user_ids);
        // someone lost access while no holder was online; the server lets only
        // the first device that asks create the new key
        if (n.rotate) await get().rotate(n.conv_id, "membership change");
      } catch (err) {
        failed += 1;
        console.warn("keys: could not reconcile a conversation", n.conv_id, err);
      }
    }
    if (failed > 0) console.warn(`keys: ${failed} conversation(s) still need granting`);
  },
  rotate: async (conv, reason) => {
    const { userId } = get();
    if (!userId) return;
    try {
      await createAndGrant(conv, userId, reason);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "epoch_race")) return;
      throw err;
    }
  },
  markWaiting: (conv) => set((s) => (s.waiting[conv] ? s : { waiting: { ...s.waiting, [conv]: true } })),
  reset: () => {
    clearKeyring();
    for (const h of keysGoneHooks) h();
    pendingEnsure.clear();
    // The pins themselves stay on the device — that is the point of them — but
    // this session's unanswered questions and its log go with the session.
    closePins();
    useKeyAlerts.getState().reset();
    set({ userId: null, identity: null, waiting: {} });
  },
}));
