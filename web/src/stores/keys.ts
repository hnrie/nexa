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
import { clearKeyring, ring } from "@/lib/keyring";
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

async function publicKeyOf(userId: string): Promise<Uint8Array> {
  const cached = useUsers.getState().byId[userId]?.public_key;
  if (cached) return b64.dec(cached);
  const res = await usersApi.publicKey(userId);
  return b64.dec(res.public_key);
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

/** Wraps a root for each user and uploads the grants; users without a public key are skipped. */
async function putGrantsFor(conv: string, epoch: number, root: Uint8Array, userIds: string[]): Promise<void> {
  const uploads: { conv_id: string; epoch: number; user_id: string; wrapped_key: string }[] = [];
  for (const uid of userIds) {
    try {
      const pub = await publicKeyOf(uid);
      uploads.push({ conv_id: conv, epoch, user_id: uid, wrapped_key: b64.enc(await wrapGrant(pub, root)) });
    } catch {
      /* unknown user: skip */
    }
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
    for (const g of grants) {
      if (ring.get(g.conv_id, g.epoch)) continue;
      try {
        const root = await unwrapGrant(identity.privateKey, identity.publicKey, b64.dec(g.wrapped_key));
        ring.set(g.conv_id, g.epoch, root);
        await persistRoot(userId, g.conv_id, g.epoch, root);
        changed.push(g.conv_id);
      } catch {
        /* a grant we cannot open is ignored; another holder may send a good one */
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
    const job = (async () => {
      const { userId } = get();
      if (!userId) return null;
      try {
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
    const needs = await keysApi.needs();
    for (const n of needs) {
      if (!ring.get(n.conv_id, n.epoch)) continue;
      await get().grantTo(n.conv_id, n.epoch, n.user_ids);
      // someone lost access while no holder was online; the server lets only
      // the first device that asks create the new key
      if (n.rotate) await get().rotate(n.conv_id, "membership change");
    }
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
    pendingEnsure.clear();
    set({ userId: null, identity: null, waiting: {} });
  },
}));
