import { create } from "zustand";
import { ApiError } from "@/api/client";
import { keys as keysApi } from "@/api/keys";
import { users as usersApi } from "@/api/users";
import type { KeyGrant } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { newRootKey } from "@/crypto/conv";
import { keystore } from "@/crypto/keystore";
import { unwrapGrant, wrapGrant, type Identity } from "@/crypto/keys";
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

export const useKeys = create<KeysState>()((set, get) => ({
  userId: null,
  identity: null,
  waiting: {},
  init: async (userId, identity) => {
    set({ userId, identity, waiting: {} });
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
        await keystore.saveRoot(userId, g.conv_id, g.epoch, root);
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
        const created = await keysApi.createEpoch(conv);
        const root = newRootKey();
        ring.set(conv, created.epoch, root);
        await keystore.saveRoot(userId, conv, created.epoch, root);
        const targets = created.user_ids.includes(userId) ? created.user_ids : [...created.user_ids, userId];
        await get().grantTo(conv, created.epoch, targets);
        return { epoch: created.epoch, root };
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
  },
  reconcile: async () => {
    const needs = await keysApi.needs();
    for (const n of needs) {
      if (ring.get(n.conv_id, n.epoch)) await get().grantTo(n.conv_id, n.epoch, n.user_ids);
    }
  },
  rotate: async (conv, reason) => {
    const { userId } = get();
    if (!userId) return;
    try {
      const created = await keysApi.createEpoch(conv, reason);
      const root = newRootKey();
      ring.set(conv, created.epoch, root);
      await keystore.saveRoot(userId, conv, created.epoch, root);
      const targets = created.user_ids.includes(userId) ? created.user_ids : [...created.user_ids, userId];
      await get().grantTo(conv, created.epoch, targets);
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
