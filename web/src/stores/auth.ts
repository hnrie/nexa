import { create } from "zustand";
import { auth as authApi } from "@/api/auth";
import { api, ApiError } from "@/api/client";
import type { KdfParamsJson, MeUser } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { b64, randomBytes } from "@/crypto/bytes";
import { DEFAULT_KDF, deriveAuthKey, deriveEncKey, deriveMaster, deriveSettingsKey, newRecoveryKey, recoveryKeyToBytes, recoveryToKeys, type KdfParams } from "@/crypto/kdf";
import { generateIdentity, unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { keystore } from "@/crypto/keystore";
import { storage } from "@/lib/storage";

export type AuthStatus = "idle" | "loading" | "anonymous" | "locked" | "ready";

const TOKEN_KEY = "ec.token";

interface AuthState {
  status: AuthStatus;
  me: MeUser | null;
  token: string | null;
  identity: Identity | null;
  settingsKey: Uint8Array | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  register: (username: string, displayName: string, password: string, extra?: { invite_code?: string; registration_key?: string }) => Promise<{ recoveryKey: string }>;
  login: (username: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  recover: (username: string, recoveryKey: string, newPassword: string) => Promise<{ recoveryKey: string }>;
  changePassword: (current: string, next: string) => Promise<void>;
  newRecoveryKey: (password: string) => Promise<string>;
  logout: () => Promise<void>;
  setMe: (me: MeUser) => void;
}

async function deriveAll(password: string, salt: Uint8Array, params: KdfParams) {
  const master = await deriveMaster(password, salt, params);
  return { authKey: deriveAuthKey(master), encKey: deriveEncKey(master) };
}

function toParams(p: KdfParamsJson): KdfParams {
  return { m: p.m, t: p.t, p: p.p, v: 1 };
}

async function finishLogin(set: (s: Partial<AuthState>) => void, me: MeUser, token: string, identity: Identity): Promise<void> {
  storage.set(TOKEN_KEY, token);
  api.setToken(token);
  await keystore.saveIdentity(me.id, identity);
  set({ status: "ready", me, token, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: "idle",
  me: null,
  token: storage.get(TOKEN_KEY),
  identity: null,
  settingsKey: null,
  error: null,

  bootstrap: async () => {
    const token = storage.get(TOKEN_KEY);
    if (!token) {
      set({ status: "anonymous", token: null });
      return;
    }
    api.setToken(token);
    set({ status: "loading", token });
    try {
      const me = await usersApi.me();
      const identity = await keystore.loadIdentity(me.id);
      if (!identity) {
        set({ status: "locked", me });
        return;
      }
      set({ status: "ready", me, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        storage.remove(TOKEN_KEY);
        api.setToken(null);
        set({ status: "anonymous", token: null, me: null });
        return;
      }
      set({ status: "anonymous", error: "Could not reach the server." });
    }
  },

  register: async (username, displayName, password, extra) => {
    const salt = randomBytes(16);
    const params = DEFAULT_KDF;
    const { authKey, encKey } = await deriveAll(password, salt, params);
    const identity = generateIdentity();
    const recovery = newRecoveryKey();
    const rk = recoveryToKeys(recovery.bytes);
    const res = await authApi.register({
      username,
      display_name: displayName,
      auth_key: b64.enc(authKey),
      kdf_salt: b64.enc(salt),
      kdf_params: params,
      public_key: b64.enc(identity.publicKey),
      enc_private_key: b64.enc(await wrapPrivateKey(identity.privateKey, encKey)),
      enc_private_key_recovery: b64.enc(await wrapPrivateKey(identity.privateKey, rk.encKey)),
      recovery_auth_key: b64.enc(rk.authKey),
      ...(extra ?? {}),
    });
    await finishLogin(set, res.user, res.token, identity);
    return { recoveryKey: recovery.display };
  },

  login: async (username, password) => {
    const kdf = await authApi.kdf(username);
    const { authKey, encKey } = await deriveAll(password, b64.dec(kdf.salt), toParams(kdf.params));
    const res = await authApi.login(username, b64.enc(authKey));
    const privateKey = await unwrapPrivateKey(b64.dec(res.enc_private_key), encKey);
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(res.public_key), privateKey });
  },

  unlock: async (password) => {
    const me = get().me;
    const token = get().token;
    if (!me || !token) throw new Error("not logged in");
    const bundle = await usersApi.myKeys();
    const { encKey } = await deriveAll(password, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const privateKey = await unwrapPrivateKey(b64.dec(bundle.enc_private_key), encKey);
    await finishLogin(set, me, token, { publicKey: b64.dec(bundle.public_key), privateKey });
  },

  recover: async (username, recoveryKey, newPassword) => {
    const rkBytes = recoveryKeyToBytes(recoveryKey);
    const rk = recoveryToKeys(rkBytes);
    const begin = await authApi.recoverBegin(username, b64.enc(rk.authKey));
    const privateKey = await unwrapPrivateKey(b64.dec(begin.enc_private_key_recovery), rk.encKey);
    const salt = randomBytes(16);
    const { authKey, encKey } = await deriveAll(newPassword, salt, DEFAULT_KDF);
    const fresh = newRecoveryKey();
    const frk = recoveryToKeys(fresh.bytes);
    const res = await authApi.recoverFinish({
      username,
      recovery_auth_key: b64.enc(rk.authKey),
      new_auth_key: b64.enc(authKey),
      new_kdf_salt: b64.enc(salt),
      new_kdf_params: DEFAULT_KDF,
      new_enc_private_key: b64.enc(await wrapPrivateKey(privateKey, encKey)),
      new_recovery_auth_key: b64.enc(frk.authKey),
      new_enc_private_key_recovery: b64.enc(await wrapPrivateKey(privateKey, frk.encKey)),
    });
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(begin.public_key), privateKey });
    return { recoveryKey: fresh.display };
  },

  changePassword: async (current, next) => {
    const { identity } = get();
    if (!identity) throw new Error("locked");
    const bundle = await usersApi.myKeys();
    const cur = await deriveAll(current, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const salt = randomBytes(16);
    const nxt = await deriveAll(next, salt, DEFAULT_KDF);
    await authApi.changePassword({
      auth_key: b64.enc(cur.authKey),
      new_auth_key: b64.enc(nxt.authKey),
      new_kdf_salt: b64.enc(salt),
      new_kdf_params: DEFAULT_KDF,
      new_enc_private_key: b64.enc(await wrapPrivateKey(identity.privateKey, nxt.encKey)),
    });
  },

  newRecoveryKey: async (password) => {
    const { identity } = get();
    if (!identity) throw new Error("locked");
    const bundle = await usersApi.myKeys();
    const cur = await deriveAll(password, b64.dec(bundle.kdf_salt), toParams(bundle.kdf_params));
    const fresh = newRecoveryKey();
    const frk = recoveryToKeys(fresh.bytes);
    await authApi.replaceRecovery({
      auth_key: b64.enc(cur.authKey),
      recovery_auth_key: b64.enc(frk.authKey),
      enc_private_key_recovery: b64.enc(await wrapPrivateKey(identity.privateKey, frk.encKey)),
    });
    set((s) => (s.me ? { me: { ...s.me, has_recovery: true } } : s));
    return fresh.display;
  },

  logout: async () => {
    const me = get().me;
    try {
      await authApi.logout();
    } catch {
      /* the token may already be invalid */
    }
    storage.remove(TOKEN_KEY);
    api.setToken(null);
    if (me) await keystore.clear(me.id);
    set({ status: "anonymous", me: null, token: null, identity: null, settingsKey: null, error: null });
  },

  setMe: (me) => set({ me }),
}));
