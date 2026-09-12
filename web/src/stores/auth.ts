import { create } from "zustand";
import { auth as authApi } from "@/api/auth";
import { api, ApiError } from "@/api/client";
import { isMfaChallenge, type KdfParamsJson, type MeUser } from "@/api/types";
import { users as usersApi } from "@/api/users";
import { b64, randomBytes } from "@/crypto/bytes";
import { DEFAULT_KDF, deriveAuthKey, deriveEncKey, deriveMaster, deriveSettingsKey, newRecoveryKey, recoveryKeyToBytes, recoveryToKeys, type KdfParams } from "@/crypto/kdf";
import { generateIdentity, unwrapPrivateKey, wrapPrivateKey, type Identity } from "@/crypto/keys";
import { keystore } from "@/crypto/keystore";
import { clearLock, enableLock, hasLock, loadLock, unlockIdentity, type LockConfig } from "@/lib/appLock";
import { storage } from "@/lib/storage";

export type AuthStatus = "idle" | "loading" | "anonymous" | "locked" | "pinlocked" | "ready";

/** What a password got us: either we are in, or the account wants a code. */
export type LoginOutcome = { mfa: false } | { mfa: true; backupCodesLeft: number };

/** Kept out of the store so a half-finished sign-in never lands in a snapshot. */
let pendingMfa: { username: string; encKey: Uint8Array; ticket: string } | null = null;

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
  login: (username: string, password: string) => Promise<LoginOutcome>;
  /** Finishes a sign-in that stopped for a second factor. */
  completeMfa: (proof: { code?: string; backupCode?: string }) => Promise<void>;
  cancelMfa: () => void;
  unlock: (password: string) => Promise<void>;
  /** Rebuilds the keys from this device's passcode. */
  unlockWithPasscode: (passcode: string) => Promise<void>;
  /** Forgets the keys held in memory and shows the passcode screen. */
  lockApp: () => void;
  /** Wraps the identity with a passcode and drops the plaintext copy. */
  setPasscode: (passcode: string, opts?: Partial<Pick<LockConfig, "autoLockMs" | "lockOnBlur" | "blurDelayMs">>) => Promise<void>;
  /** Removes the passcode and goes back to keeping the keys on this device. */
  removePasscode: () => Promise<void>;
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
  // With a passcode set, the only copy of the key on this device is the wrapped
  // one, so the plaintext must never go back into the key store.
  if (!hasLock(me.id)) await keystore.saveIdentity(me.id, identity);
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
      if (hasLock(me.id)) {
        set({ status: "pinlocked", me, identity: null, settingsKey: null });
        return;
      }
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
    if (isMfaChallenge(res)) {
      pendingMfa = { username, encKey, ticket: res.ticket };
      return { mfa: true, backupCodesLeft: res.backup_codes_left };
    }
    pendingMfa = null;
    const privateKey = await unwrapPrivateKey(b64.dec(res.enc_private_key), encKey);
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(res.public_key), privateKey });
    return { mfa: false };
  },

  completeMfa: async ({ code, backupCode }) => {
    const pending = pendingMfa;
    if (!pending) throw new Error("Start again from your password.");
    const body = backupCode ? { backup_code: backupCode } : { code: (code ?? "").replace(/\s/g, "") };
    const res = await authApi.loginMfa(pending.ticket, body);
    const privateKey = await unwrapPrivateKey(b64.dec(res.enc_private_key), pending.encKey);
    pendingMfa = null;
    await finishLogin(set, res.user, res.token, { publicKey: b64.dec(res.public_key), privateKey });
  },

  cancelMfa: () => {
    pendingMfa = null;
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

  unlockWithPasscode: async (passcode) => {
    const { me, token } = get();
    if (!me || !token) throw new Error("not logged in");
    const identity = await unlockIdentity(me.id, passcode);
    set({ status: "ready", me, identity, settingsKey: deriveSettingsKey(identity.privateKey), error: null });
  },

  lockApp: () => {
    const { me, status } = get();
    if (!me || status !== "ready" || !hasLock(me.id)) return;
    set({ status: "pinlocked", identity: null, settingsKey: null });
  },

  setPasscode: async (passcode, opts) => {
    const { me, identity } = get();
    if (!me || !identity) throw new Error("Unlock your keys first.");
    await enableLock(me.id, identity, passcode, opts);
    // The wrapped copy is now the only one on this device; drop the readable one.
    await keystore.forgetIdentity(me.id);
  },

  removePasscode: async () => {
    const { me, identity } = get();
    if (!me) return;
    clearLock(me.id);
    if (identity) await keystore.saveIdentity(me.id, identity);
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
    pendingMfa = null;
    if (me) {
      clearLock(me.id);
      await keystore.clear(me.id);
    }
    set({ status: "anonymous", me: null, token: null, identity: null, settingsKey: null, error: null });
  },

  setMe: (me) => set({ me }),
}));
